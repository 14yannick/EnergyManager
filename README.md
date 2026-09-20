# EnergyManager

An open-source, self-hosted energy manager for households with solar and battery
storage. Started as a replacement for a manual spreadsheet-based solar payback
calculator; the roadmap grows toward broader home energy management (in the spirit
of commercial products like Solar Manager) and, eventually, invoicing for a Swiss
VZEV (Virtueller Zusammenschluss zum Eigenverbrauch).

## Features (phase 1)

- **Tariff periods** with per-period purchase/sell rates in CHF/kWh, surcharges, and a
  pricing mode per period: a flat rate, or the dynamic day-ahead rate
- **Dynamic feed-in rates** synced from a Home Assistant price-forecast sensor and
  stored per interval, so revenue is priced at the rate that actually applied at
  that hour
- **Interval data from Home Assistant** (long-term statistics over the websocket API)
  or from a CSV import — the CSV path takes a long-format file (one row per
  timestamp + metric) in either per-interval or cumulative-meter form
- **PV/battery split**: the inverter reports one AC figure covering both panels and
  battery discharge. It is split proportionally by the DC shares behind it, so
  night-time discharge is no longer counted as direct solar use — see
  [`apps/api/src/modules/homeAssistant/split.ts`](apps/api/src/modules/homeAssistant/split.ts)
- **Savings & payback dashboard**: revenue by category (direct consumption, direct
  export, battery, neighbour sales) at hourly/daily/monthly/yearly resolution, in CHF,
  kWh or both; KPIs; and simple payback + breakeven computed three ways — with battery,
  without battery (counterfactual), and battery-only
- **Calculation detail** page showing one day at a time: where production went (direct
  use, the parties, the grid) and what the battery cost and earned, each line carrying
  the energy-weighted average rate it was priced at. Any line expands into the metering
  intervals behind it, so an average can be traced to the slots that produced it. The
  full engine output over a range, and its CSV export, is folded away underneath
- **Settings** holding the Home Assistant connection and entity mapping, investment
  costs (battery vs. solar, subsidies, tax reductions), the production start date, and
  the battery's round-trip conversion loss
- **Role-based access** via Cloudflare Access — admin, read-only, and a
  participant role: a neighbour sees the rates they are billed at, but only
  their own consumption and invoices. Off by default; see
  [Access control](#access-control)
- **French, German and English**, switched from the header and remembered per
  browser. A new browser starts in its own language when we speak it, French
  otherwise; see [Language](#language)

## VZEV billing (phase 2, in progress)

Beyond the owner's own payback, the app bills the other participants of a Swiss
VZEV/RCP. Consumption is tracked per party, grid-tariff positions are configured per
category (énergie, utilisation du réseau, mesure, redevances) with an allocation rule
each — per kWh drawn from the grid, per kWh consumed in total, shared across the pool,
or a flat charge per participant — and the app produces a per-participant invoice, with
a comparison against what the same consumption would have cost billed directly by the
grid operator. Invoices print to PDF from the browser.

The billing UI is in **French**, unlike the rest of the app: it is the one screen a
participant actually reads, and the participants here are French-speaking.

## Language

The interface is available in French, German and English, switched from the
buttons in the header. The choice is remembered in the browser, so it is
per-device rather than per-account; a browser with no stored choice starts in
its own language when that is one of the three, and in French otherwise.

The catalogues live in [`apps/web/src/i18n`](apps/web/src/i18n). `en.ts`
defines what keys exist; `fr.ts` and `de.ts` are typed against it, so a key
added to one and not the others fails the build — a half-translated string
cannot reach a page. Invoices follow the same switch, including the QR-bill's
own headings, so a printed document is in one language throughout.

The German billing wording follows a real BKW electricity bill — *Energie*,
*Netznutzung*, *Messung*, *Abgaben & Leistungen* as the sections,
*Zwischentotal* and *Zu bezahlender Betrag* for the sums, *Bezug* / *Preis* /
*Betrag in CHF* as the line columns, and *Rp.* for cents. A participant
reading their RCP invoice therefore meets the same terms as on the bill it
replaces.

Two things deliberately do not follow it. Dates and amounts stay in Swiss form
(DD.MM.YYYY, 24-hour) in both languages, because that is what a bill printed
here has to look like. And text that is stored rather than displayed — a cost
item's label, a tariff period's name — is data entered by the user, so it
stays as typed. Errors returned by the API are also still English.

## Access control

Off by default (`AUTH_ENABLED=false`), which treats every request as admin —
right for local development and for an instance only reachable on the LAN.

**Leaving it off changes nothing.** No token is looked for, no key set is
fetched, no role lookup runs; every caller is an admin, exactly as before this
feature existed. An existing deployment upgrades without touching its
environment. (One thing does apply either way: the app refuses to start if a
route has no policy entry — see below.)

Turn it on when the app is exposed publicly. With it on, the API trusts exactly one thing: the signed JWT that Cloudflare
Access puts in `Cf-Access-Jwt-Assertion`. The `Cf-Access-Authenticated-User-Email`
header that Access also sets is **deliberately ignored** — it is unsigned, so
anything reaching the origin without passing through Cloudflare could forge it
and become an admin. The token's `aud` is checked against `CF_ACCESS_AUD`,
which is what scopes it to this application rather than to any other Access
app in the same account.

Three roles, resolved from the verified address:

| Role | Sees |
|---|---|
| `admin` | Everything, read and write. |
| `viewer` | Everything, read only — no writes anywhere. |
| `participant` | **Rates: yes. Consumption: only their own.** Two pages — **Consumption** (their own, split local/grid, with what the RCP saved them) and **Billing** (their own invoices, plus the rates those invoices are built from: every grid provider tariff position, and the RCP rate for locally produced energy). Never another participant's consumption or invoice, and never your production, battery, grid export, feed-in tariff or investment data. |

The API is the enforcement point — every route is denied by default and listed
explicitly in `apps/api/src/auth/policy.ts`. The web app follows it where a
page would otherwise offer a control that can only fail: **Settings** and the
billing tariff positions render read-only for anyone who is not an admin, and
a participant's navigation holds only the two pages they can use.

Addresses are matched in that order, and the first match wins:

1. `AUTH_ADMIN_EMAILS` on the api container
2. an address on a party's `emails` — the same list the invoices go to, so
   there is nothing extra to maintain. The party's own role decides what it
   grants: read-only access is a party with the `viewer` role, not a separate
   list of addresses
3. anything else gets a 403

An address Cloudflare authenticated but neither of those recognises gets a
403 from every endpoint, including `/api/me`. The app shows it who it is
signed in as and a sign-out button, rather than a dashboard full of failed
requests — otherwise somebody added to Access but not yet to a party is stuck
in an account they can neither use nor leave.

The environment lists are consulted first so that adding yourself as a
participant to preview their view cannot demote you. Granting from the parties
table needs no container restart, which is the easier path for a demo.

An address listed on two parties is refused rather than guessed, since "their
own data" then has no single answer.

### Party roles

Each party carries one of four roles. Administering the RCP and being billed
by it are independent, which is why there are two admin values: the owner
normally consumes from the same connection, pays a share of the fixed costs
and imports from the grid like anybody else, but whoever runs the app might
instead sit outside the RCP entirely.

| Role | App access | Invoiced | Counts towards shared costs |
|---|---|---|---|
| `rcp_party` *(default)* | participant — the rates, and only their own consumption | yes | yes |
| `rcp_admin` | admin | yes | yes |
| `rcp_admin_only` | admin | no | no |
| `viewer` | viewer — reads everything | no | no |

At most one party per site may hold an admin role, enforced by a partial
unique index; that party is also the QR-bill's payee. An `rcp_admin` still
receives their own invoice — running the RCP does not exempt you from paying
for what you consumed — but it carries no payment slip, since a slip payable
from and to the same account is meaningless.

The participant count adds one for an unlisted owner only while no party holds
an admin role, which is how every site looked before parties carried one.

Two properties are enforced structurally rather than by review:

- **Default deny.** Permissions live in one table in
  [`apps/api/src/auth/policy.ts`](apps/api/src/auth/policy.ts), keyed by the
  route pattern. A route missing from it is denied to everyone.
- **The app refuses to start** if any registered route has no policy entry, so
  a new endpoint fails at boot rather than quietly answering 403 — or, worse,
  being added to a future permissive default.

Note that `registerAuth` is called directly on the root instance rather than
through `app.register()`. Fastify encapsulates hooks added inside a registered
plugin, so registering it would have left every sibling route module unguarded
with nothing to indicate it.

### Previewing a role locally

With `AUTH_ENABLED=false` every request is an anonymous admin. To see the app
as somebody else, set `AUTH_DEV_AS` to an address on one of the parties and
restart the api:

```sh
AUTH_DEV_AS=neighbour@example.com
```

Every request is then resolved exactly as that person's Cloudflare sign-in
would be — a participant gets their two pages and the API scopes every answer
to their party, a viewer party gets read-only access. An address no party
carries gets the same 403 a stranger would. The header shows *local preview*
instead of a sign-out button. Clear the variable to be admin again.

The api refuses to start with `AUTH_DEV_AS` and `AUTH_ENABLED=true` together:
on a real deployment it would make every visitor that person.

### Turning it on

1. **Put the app behind a Cloudflare Access application** covering the whole
   hostname. `/api/` must be inside it — a path-scoped policy that protects
   only the UI leaves the API open.
2. **Copy the Application Audience (AUD) tag** from the application's settings
   into `CF_ACCESS_AUD`.
3. **Set the variables together** and restart:

   | Variable | |
   |---|---|
   | `AUTH_ENABLED` | `true` |
   | `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com`, no scheme |
   | `CF_ACCESS_AUD` | the AUD tag from step 2 |
   | `AUTH_ADMIN_EMAILS` | your address; comma- or space-separated |

   The app **refuses to start** on a partial configuration. Half-enabled auth
   would otherwise fail open on every request while looking enabled, and a
   missing AUD would accept tokens minted for any other Access application in
   the same account.

4. **Add participants to the Access application** — and not before. While
   `AUTH_ENABLED` is false, Access decides who gets in and everyone who does is
   an admin, so a neighbour added early would be able to edit tariffs, change
   settings and delete metering history.

Participants need no account here beyond their address being on their party
(the Facturation page). Their client reads `GET /api/me` to learn its own role
and site id — `/api/sites` is closed to them, because a site row carries your
investment figures.

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

Running on a server rather than a laptop is not cosmetic here: the dynamic
feed-in sync reads a rolling window of prices from a Home Assistant entity
(itself re-polling BKW, typically) with **no history endpoint on either side**,
so every interval missed while the app — or Home Assistant — is down is lost
permanently.

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
   docker compose -f docker-compose.ghcr.yml exec api env | grep -E 'HA_URL|HA_DYNAMIC_TARIFF|BKW_SYNC'
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

### Without compose, using Unraid's built-in Docker UI

Compose is not required. The published images take all configuration from
environment variables passed at run time, so no `.env` file is involved.

The web image forwards `/api/` to whatever `API_UPSTREAM` points at, defaulting
to `http://api:3000`. Override it and the API container can be named anything.

First create a user-defined network — Unraid's default `bridge` gives containers
no DNS for each other, so without this the web container cannot resolve the API
and every request returns 502:

```bash
docker network create energymanager
```

Apply migrations once. This exits when finished, so it wants running by hand
rather than as a container Unraid keeps restarting:

```bash
docker run --rm --network energymanager \
  -e DATABASE_URL='postgres://energymanager:PASS@10.0.0.10:65432/energymanager' \
  ghcr.io/14yannick/energymanager-api:latest pnpm db:migrate
```

Then the two long-running containers:

```bash
docker run -d --name EnergyManager-api --network energymanager \
  --restart unless-stopped \
  -e DATABASE_URL='postgres://energymanager:PASS@10.0.0.10:65432/energymanager' \
  -e HA_URL='http://10.0.0.11:8123' \
  -e HA_TOKEN='<long-lived access token>' \
  ghcr.io/14yannick/energymanager-api:latest

docker run -d --name EnergyManager-web --network energymanager \
  --restart unless-stopped \
  -p 8080:80 \
  -e API_UPSTREAM='http://EnergyManager-api:3000' \
  ghcr.io/14yannick/energymanager-web:latest
```

Everything else has a working default: `PORT`, `BKW_SYNC_ENABLED`,
`BKW_SYNC_INTERVAL_MINUTES`, `HA_SYNC_ENABLED`, `HA_SYNC_INTERVAL_MINUTES`,
`HA_SYNC_LOOKBACK_HOURS` and `HA_DYNAMIC_TARIFF_ENTITY_ID`. Pass them only to
change them.

`AUTH_ENABLED` defaults to `false`, so the api container above accepts every
request as admin — fine while the port is only reachable on the LAN. Exposing
it publicly means adding `AUTH_ENABLED`, `CF_ACCESS_TEAM_DOMAIN`,
`CF_ACCESS_AUD` and `AUTH_ADMIN_EMAILS` as further `-e` flags; see
[Access control](#access-control).

In the **Add Container** form the same thing maps to: *Repository* =
`ghcr.io/14yannick/energymanager-api:latest`, *Network Type* = `energymanager`,
and one Variable row per `-e` above. Repeat for the web image, adding a Port
mapping of host `8080` to container `80`.

## Architecture

- **Backend**: Node.js + TypeScript, [Fastify](https://fastify.dev), [Drizzle ORM](https://orm.drizzle.team)
- **Database**: PostgreSQL + [TimescaleDB](https://www.timescale.com) — interval
  metrics are stored in a hypertable, one row per `(timestamp, metric kind)` rather
  than a fixed column per flow, and aggregated at query time. The original daily
  continuous aggregate was dropped once the savings engine moved to interval
  resolution: rates change within a day, so a daily rollup cannot price them
- **Frontend**: React + Vite, TanStack Query, React Hook Form, Recharts, Tailwind CSS
- **Deployment**: Docker Compose (`migrate`, `api`, `web` — the database is external
  by default)

See the doc comments in
[`apps/api/src/modules/savings/engine.ts`](apps/api/src/modules/savings/engine.ts)
for how the savings formulas work, and where the interval-data model deliberately
diverges from the cruder approximations the app started out with.

### Currency

Everything stored and displayed by the app is **CHF**: tariff periods, surcharges,
and the dynamic feed-in rates read from the Home Assistant entity configured as
`HA_DYNAMIC_TARIFF_ENTITY_ID` (its `price` attributes, in CHF/kWh).

The app does no EUR→CHF conversion of its own on this path — it trusts that
entity's own values, whatever produced them. That used to be a direct call to
BKW's API, which does the conversion described below; a household pointing
`HA_DYNAMIC_TARIFF_ENTITY_ID` at a sensor with a different source, or a
misconfigured one, would have its dynamic feed-in rates silently wrong. The
sync does refuse to write anything if the entity's `price_component` isn't
`"feed_in"` — but it cannot tell a correctly-labelled bad price from a good
one.

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

- [x] Phase 1: tariff/cost tracking, readings import, savings & payback dashboard
- [ ] Phase 2: VZEV invoicing — *in progress*. Parties, per-party consumption
      allocation and per-participant invoices are in place; invoices are computed
      on demand from a date range, so there is no stored history and no payment
      tracking yet
- [ ] Phase 3: real-time monitoring. Live ingestion is partly here already — interval
      data and dynamic feed-in rates both sync from Home Assistant, on a timer
      rather than on demand

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE).
