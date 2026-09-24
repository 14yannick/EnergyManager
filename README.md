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
VZEV/vZEV. Consumption is tracked per party, grid-tariff positions are configured per
category (énergie, utilisation du réseau, mesure, redevances) with an allocation rule
each — per kWh drawn from the grid, per kWh consumed in total, shared across the pool,
or a flat charge per participant — and the app produces a per-participant invoice, with
a comparison against what the same consumption would have cost billed directly by the
grid operator. Invoices print to PDF from the browser.

The per-participant figures — what each party drew from the local pool and from
the grid — arrive **by CSV import only**. The Home Assistant sync deliberately
cannot map them: one statistic cannot say which party it belongs to. Until the
grid operator's own metering feed (ebIX) is imported, billing is fed by hand,
and a party whose grid series was not imported is invoiced for local energy and
standing charges alone.

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
reading their vZEV invoice therefore meets the same terms as on the bill it
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
| `participant` | **Rates: yes. Consumption: only their own.** Two pages — **Consumption** (their own, split local/grid, with what the vZEV saved them, and the site's live export and solar forecast) and **Billing** (their own invoices, plus the rates those invoices are built from: every grid provider tariff position, and the vZEV rate for locally produced energy). One site-level figure besides: how much the site produced and how much of it went into the local pool, so a participant can see where their local share came from — with no per-party breakdown, no battery, no export, no money. Never another participant's consumption or invoice, and never your production detail, battery, grid export, feed-in tariff or investment data. |

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

Each party carries one of four roles. Administering the vZEV and being billed
by it are independent, which is why there are two admin values: the owner
normally consumes from the same connection, pays a share of the fixed costs
and imports from the grid like anybody else, but whoever runs the app might
instead sit outside the vZEV entirely.

| Role | App access | Invoiced | Counts towards shared costs |
|---|---|---|---|
| `rcp_party` *(default)* | participant — the rates, and only their own consumption | yes | yes |
| `rcp_admin` | admin | yes | yes |
| `rcp_admin_only` | admin | no | no |
| `viewer` | viewer — reads everything | no | no |

At most one party per site may hold an admin role, enforced by a partial
unique index; that party is also the QR-bill's payee. An `rcp_admin` still
receives their own invoice — running the vZEV does not exempt you from paying
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

### Keeping Cloudflare's allow-list in step (optional)

Access decides who reaches the app before this app ever sees the request, so
adding a party here doesn't let them in — they also need their address on the
Access application's policy in Cloudflare, added by hand today.

Set `CF_API_TOKEN` and `CF_ACCOUNT_ID` and that step happens automatically:
every party save (and every change to `AUTH_ADMIN_EMAILS`, picked up on the
next sync) pushes the addresses that should be allowed into a Cloudflare
Access policy, and pulls out any it no longer wants there. A manual "Sync
now" button on the Settings page covers the case where the automatic push
failed.

No policy id to configure. The policy is found — or, the very first time,
created — by a name derived from the first `AUTH_ADMIN_EMAILS` address: e.g.
`14yannick@gmail.com` names it `em_14yannick`. Once it exists it is entirely
this app's own, so a sync freely recomputes its *whole* email list from what
Cloudflare currently has, rather than needing to track locally what it added
before — there is no local table for this at all. Anything that isn't an
email rule (a domain restriction, a country requirement added by hand on top
of it) is left exactly as it was; see the doc comment on `mergeIncludeRules`
in `apps/api/src/modules/cfAccess/engine.ts`.

**A newly created policy is inert until it's wired to the app — once, by
hand.** Creating a *reusable* policy through the API doesn't attach it to
anything: it sits on the account doing nothing until it's added as a rule on
the actual Access application that gates this app's hostname. After the
first sync (the Settings page says when it had to create one, naming it), go
to Zero Trust → Access → Applications → your application → Policies, and add
the policy by that name. From then on, every sync keeps updating the same
policy in place — nothing further to wire up.

If a policy already existed before this feature was turned on — created by
hand, the way onboarding does it — the sync won't find or touch it unless
its name happens to match exactly. Simplest fix: rename the existing one to
match (Settings tells you the name it's looking for) rather than ending up
with two policies, only one of which is actually attached to the app.

**The token is more powerful than this feature strictly needs.** Cloudflare
has no way to scope an API token to a single Access policy — a token with
*Access: Apps and Policies* write access can edit or delete any Access app or
policy on the whole account, not just the one this creates. Leave both
variables unset and the feature — and that risk — simply doesn't exist; the
rest of the app is unaffected either way.

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

## Google Drive (optional)

Archives each generated invoice PDF to a Drive folder, alongside the zip
every Generate click already downloads. Leave `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`
unset and the feature simply doesn't exist — invoices still generate
normally, just without a Drive copy.

Each PDF lands in a period subfolder under the folder you connect — "Q1.2027"
for a calendar quarter, "2027" for a whole year, "2027-01" for a month, or
the raw date range for anything else (a custom period, say) — created on
first use and reused after. The file itself is named the same way, e.g.
`Q1.2027_592971.pdf`, so it reads the same whether you're looking at it
inside that folder or after downloading the zip.

**A service account, not an OAuth app.** There is no per-site "sign in with
Google" step. One long-lived credential (like `HA_TOKEN` or `CF_API_TOKEN`)
gives the server a fixed identity, and that identity's *only* access boundary
is Drive's own sharing model: it can see a folder if, and only if, someone
explicitly shared that folder with it. Nothing else in anyone's Drive is ever
reachable, regardless of how broad the requested scope is.

**No Google Cloud IAM role is needed on the service account itself** — this
trips people up because Drive doesn't follow the same access model as most
other Google Cloud resources. The two things that actually matter are steps
1 and 3 below (the Drive API enabled on the project, and the folder shared
with the service account's address); nothing in Cloud Console's "IAM & Admin"
needs to name this service account at all. Domain-wide delegation (a Google
Workspace admin feature) is unrelated and unnecessary here too.

**A regular "My Drive" folder does not work, even shared with the service
account.** This only surfaced by actually testing it: Drive refuses the
upload with *"Service Accounts do not have storage quota"* — a bare service
account has no storage of its own on a personal (non-Workspace) account, and
a shared folder in someone's My Drive doesn't give it any. A **Shared
Drive** does have its own pooled storage the service account can write into,
but Shared Drives are a **Google Workspace** feature — unavailable on a plain
`@gmail.com` account. If you don't have Workspace, this feature currently has
no working setup on a personal account; that's a Drive platform limitation,
not something this app's code can route around.

1. **Create a service account and download its JSON key.** Google's own guide
   covers this end to end:
   [Create a service account](https://cloud.google.com/iam/docs/service-accounts-create).
   Enable the Google Drive API on the same project
   ([console.cloud.google.com/apis/library/drive.googleapis.com](https://console.cloud.google.com/apis/library/drive.googleapis.com)).
2. **Set `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` to the key file's whole
   contents**, as one line — not a path to a mounted file, since not every
   host running this app can easily get an extra file into the container.
   This is a server credential like `HA_TOKEN` or `CF_API_TOKEN`; never typed
   into the app itself.
3. **Create a Shared Drive** (requires Google Workspace) for invoices, and
   add the service account's email as a member with at least Content Manager
   access — that address is shown under Settings → Google Drive once the
   credential is configured, something like
   `energymanager@your-project.iam.gserviceaccount.com`.
4. **Paste the Shared Drive's id** (from its URL:
   `drive.google.com/drive/folders/`**`<this part>`**, or
   `drive.google.com/drive/u/0/folders/`**`<this part>`** — either way, the
   part after the last `/`) into Settings → Google Drive → Connect. The app
   verifies access before saving anything.

**Every archived PDF is set to "anyone with the link can view".** A
participant is a different Google identity than the admin — often with no
Google account at all — so without this, the Account page's download link
would 403 for everyone but the admin. The link itself is a long, unguessable
file id: not listed, not indexed, not discoverable by browsing the folder
from outside it — the same trade-off an "unlisted" video or doc link makes —
but anyone who does obtain that exact URL can open it.

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
   docker compose -f docker-compose.ghcr.yml exec api env | grep -E 'HA_URL|HA_SYNC'
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

Everything else has a working default: `PORT`, `HA_SYNC_ENABLED`,
`HA_SYNC_INTERVAL_MINUTES` and `HA_SYNC_LOOKBACK_HOURS`. Pass them only to
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

### Does the battery charge from the grid?

Every stored kWh is priced as export forgone — what the grid would have paid
for it — which is only right if it came from the panels. A kWh that came *in*
through the meter cost the purchase rate instead, roughly three times as much.
The engine cannot tell the two apart, so before pricing it that way, the
question was checked against the data.

It doesn't, or not measurably. Over Feb–Sep 2026 (232 days, 1,884 kWh
charged) the battery took **0.3 kWh** from the grid with the panels dark, and
the hours in which charge exceeded PV output coincided with the import meter
recording 2.6 kWh in total — a third of them while the site was exporting.
Those hours are the PV and battery counters ticking at different moments
within the hour, not grid energy. The earlier CSV-imported winter (Oct 2025 –
Jan 2026) carries no `pv_dc` series, so it cannot be answered either way.

So the pricing stands as it is. Two things follow from it:

- **Revisit this the day the battery is charged on purpose** — a cheap-tariff
  schedule, or arbitrage against the day-ahead price. The mispricing that is
  immaterial today becomes the whole story then, and `import_grid` per
  interval is what would let charge be split between the two sources.
- **`import_grid` is synced and, for now, read by nothing.** It was the meter
  that could say no here, which is a reason to keep it. It may yet be replaced
  by the import figure the grid operator submits through ebIX, which is the
  number the invoice reconciles against — at which point the Home Assistant
  mapping for it can go.

### Currency

Everything stored and displayed by the app is **CHF**: tariff periods, surcharges,
and the dynamic feed-in rates read from the Home Assistant sensor chosen for the
site under Settings → Home Assistant (its `price` attributes, in CHF/kWh).

The app does no EUR→CHF conversion of its own on this path — it trusts that
entity's own values, whatever produced them. That used to be a direct call to
BKW's API, which does the conversion described below; pointing the setting at a
sensor with a different source, or a misconfigured one, would have its dynamic
feed-in rates silently wrong. The sync does refuse to write anything if the
entity's `price_component` isn't `"feed_in"` — but it cannot tell a
correctly-labelled bad price from a good one.

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
      allocation and per-participant invoices are in place; an admin can now
      generate and store a dated batch of invoices for a period — one PDF per
      participant, a QR-bill included, downloaded as a zip — and track paid/unpaid
      per invoice on the Account tab. Optionally archived to Google Drive at
      generation time, with a real download link from the Account tab (see
      [Google Drive](#google-drive-optional) above)
- [ ] Phase 3: real-time monitoring. Live ingestion is partly here already — interval
      data and dynamic feed-in rates both sync from Home Assistant, on a timer
      rather than on demand

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0-or-later](LICENSE).
