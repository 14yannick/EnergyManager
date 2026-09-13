# EnergyManager

An open-source, self-hosted energy manager for households with solar and battery
storage. Started as a replacement for a manual spreadsheet-based solar payback
calculator; the roadmap grows toward broader home energy management (in the spirit
of commercial products like Solar Manager) and, eventually, invoicing for a Swiss
VZEV (Virtueller Zusammenschluss zum Eigenverbrauch).

## Features (phase 1)

- Tariff period management (purchase/sell rates in CHF/kWh, per date range)
- Investment cost tracking (battery vs. solar, subsidies, tax reductions)
- CSV import of quarter-hour interval readings (production, battery charge/discharge,
  grid export/import) — supports both per-interval and cumulative-meter CSVs
- Savings & payback dashboard: total/average-daily savings, simple payback, and
  breakeven date, computed three ways — with battery, without battery (counterfactual),
  and battery-only — mirroring the original spreadsheet's Summary sheet

## Quickstart (Docker)

```bash
git clone <this-repo>
cd EnergyManager
cp .env.example .env   # DATABASE_URL at minimum
docker compose up -d
```

The app is then available at `http://localhost:8080` (configurable via `WEB_PORT`
in `.env`). The `migrate` service runs database migrations once on startup before
the API comes up.

`docker-compose.yml` deliberately ships **no database**: it points at whatever
`DATABASE_URL` names. Starting a bundled database next to an existing one is the
easiest way to end up with a healthy-looking app writing into an empty schema
while the real data sits elsewhere. If you genuinely need a throwaway database,
add the override:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up -d
```

## Deploying to a home server (Unraid)

Running on a server rather than a laptop is not cosmetic here: BKW publishes a
rolling ~25 hour window of feed-in prices with **no history endpoint**, so every
interval missed while the app is down is lost permanently.

Images for `linux/amd64` are built and pushed to GHCR by
[`.github/workflows/publish.yml`](.github/workflows/publish.yml) on every push to
`main`, so the server pulls rather than builds. It needs no source checkout and
no toolchain.

> Unraid's **Add Container** form cannot install this app. That form pulls a
> single pre-built image; it never clones a repo or runs a Dockerfile, and this
> stack is three services that compose wires together. Use Compose Manager.

1. **Install Docker Compose Manager** from Community Applications.

2. **Create a project** with
   [`docker-compose.ghcr.yml`](docker-compose.ghcr.yml) and a `.env`
   alongside it. Two values must differ from a laptop setup:

   - `DATABASE_URL` must use an **IP**. Containers reach the existing
     TimescaleDB through the host's published port, `10.0.0.10:65432`.
   - `HA_URL` must use the Home Assistant VM's **IP**, e.g.
     `http://10.0.0.11:8123`, not `homeassistant.local`. Containers resolve
     through normal DNS, which returns NXDOMAIN for mDNS `.local` names — and an
     unreachable `HA_URL` disables the integration *silently*, so the app will
     look perfectly healthy while syncing nothing.

3. **Pick a free `WEB_PORT`.** Unraid's own UI owns 80, and 8080 collides with
   many community apps.

4. **Pull and start**, then confirm the variables actually landed:

   ```bash
   docker compose -f docker-compose.ghcr.yml pull
   docker compose -f docker-compose.ghcr.yml up -d
   docker compose -f docker-compose.ghcr.yml exec api env | grep -E 'HA_URL|BKW_SYNC'
   docker compose -f docker-compose.ghcr.yml logs -f api
   ```

If the package is private, authenticate the NAS to GHCR first with a personal
access token that has `read:packages`:

```bash
echo <token> | docker login ghcr.io -u 14yannick --password-stdin
```

To deploy a specific build rather than whatever `latest` points at, set
`IMAGE_TAG` in `.env` to a commit SHA — the publish workflow tags every image
with its full SHA as well as `latest`.

The `migrate` service is safe to leave enabled: it reuses the api image with a
different command, and Drizzle skips migrations that have already been applied.

## Architecture

- **Backend**: Node.js + TypeScript, [Fastify](https://fastify.dev), [Drizzle ORM](https://orm.drizzle.team)
- **Database**: PostgreSQL + [TimescaleDB](https://www.timescale.com) — interval
  readings are stored in a hypertable and rolled up into daily totals via a
  continuous aggregate
- **Frontend**: React + Vite, TanStack Query, React Hook Form, Recharts, Tailwind CSS
- **Deployment**: Docker Compose (`timescaledb`, `migrate`, `api`, `web`)

See the doc comments in
[`apps/api/src/modules/savings/engine.ts`](apps/api/src/modules/savings/engine.ts)
for how the savings formulas work, and where the interval-data model deliberately
diverges from the cruder approximations the app started out with.

### Currency

Everything stored and displayed by the app is **CHF**: tariff periods, surcharges,
and the dynamic feed-in rates fetched from BKW (`CHF_kWh`).

The public day-ahead spot sources are **EUR/MWh**, not CHF/kWh — both the BFE open
data series (`ogd106_preise_strom_boerse.csv`, daily baseload) and the
[Energy-Charts API](https://api.energy-charts.info/price?bzn=CH&start=2017-01-01&end=2026-09-10)
(hourly, back to 2017). Anything sourced from them needs a EUR→CHF conversion plus
a `/1000` unit change before it can be compared against or stored alongside the
CHF/kWh rates.

BKW does not document which exchange rate it applies — neither the
[dynamic feed-in product page](https://www.bkw.ch/de/strom-in-der-grundversorgung/eigenen-strom-teilen-und-verkaufen/strom-ins-oeffentliche-stromnetz-einspeisen/dynamische-abnahmeverguetung)
nor their API spec mentions it. Measured against stored rates, BKW applies **one rate
per delivery day** to the hourly EPEX price and rounds to 0.001 CHF/kWh: a single
fitted factor reproduces all 24 hours exactly on every day sampled so far. Those
fitted factors track the **ECB reference rate of the previous business day** (the
auction and BKW's ~18:00 publication both happen the day before delivery) roughly
three times more closely than the same-day rate — consistent, but inferred from only
four days, so treat it as a working assumption rather than an established fact.

For backfill, use a real daily series rather than a constant — the rate drifts by
several percent over a multi-year window. The ECB publishes daily EUR/CHF reference
rates at `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip`; the SNB
publishes only annual and monthly averages, which are too coarse here.

## Local development

Requires Node 26+ and [pnpm](https://pnpm.io). The exact pnpm version is pinned
by the `packageManager` field in `package.json`, so don't install a different one
globally. Note that Homebrew's `node` ships only npm — corepack is a separate
formula — so pick whichever suits you:

```bash
brew install corepack && corepack enable   # honours packageManager automatically
npm install -g pnpm@9.12.1                 # or pin it yourself
npx pnpm@9.12.1 <command>                  # or don't install it at all
```

```bash
pnpm install
cp .env.example .env   # point DATABASE_URL at your database

# Optional — only if you don't already have a PostgreSQL/TimescaleDB to use:
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up -d timescaledb

pnpm db:migrate
pnpm dev:api    # http://localhost:3000
pnpm dev:web    # http://localhost:5173, proxies /api to the api dev server
```

Note that the dev scripts do **not** auto-load `.env` — export the variables
into your shell, or run them through something like `dotenvx`.

Useful scripts (run from the repo root):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate   # generate a new Drizzle migration after changing apps/api/src/db/schema
```

## Roadmap

- [x] Phase 1: tariff/cost tracking, CSV readings import, savings & payback dashboard
- [ ] Phase 2: VZEV invoicing — multiple parties per site, per-party consumption
      allocation, billing documents
- [ ] Phase 3: live data ingestion (inverter/smart-meter APIs) instead of CSV import;
      real-time monitoring

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE).
