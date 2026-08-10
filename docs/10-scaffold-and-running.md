# 10 — Scaffold & Running It

The monorepo skeleton described in [`05`](./05-monorepo-and-tooling.md) now exists. This is the
"how do I run it" guide.

## What's in place

```
apps/
  mobile/          Expo app (iOS / Android / Web-PWA) — NativeWind + expo-router + reanimated
  web/             Vite + React DOM — ONE screen (Nearby) from the identical packages/core
                   functions, the proof that the kernel is renderer-agnostic (ADR-068/069)
  edge/            Cloudflare Worker — cached ETA proxy, LandsD tile proxy, precomputed dataset
                   reader (KV/R2), and the /v1/live socket served by a sharded `EtaHub` Durable
                   Object; the daily build runs in GitHub Actions, not in the Worker
packages/
  contract/        Zod = the ONE declaration of every wire shape → openapi.json (ADR-052) and the
                   /v1/live frames → asyncapi.json (ADR-056); both committed and staleness-gated
  core/            canonical types (z.infer of contract), DataSource interface, honest-ETA helpers,
                   and the domain rules under a JSON fixture corpus (ADR-060)
  ports/           the 7 type-only platform interfaces — `ls packages/ports/src` IS the iOS/Android
                   porting checklist (ADR-051); imports nothing, emits no JS
  data-normalize/  KMB + Citybus fetch adapters (zod-validated) → canonical Eta
  api-client/      EdgeClient (v1 DataSource) + watch() as a real frame protocol over a
                   pluggable transport: poll emulator (default) · memory fake · WebSocket
  i18n/            en / zh-Hant / zh-Hans UI strings
  ui/              NativeWind preset + themes.ts (light/dark + liveries) + tokens
  tsconfig/        shared TS configs
```

Internal packages are **source-only** (`main` → `src/index.ts`); Metro and esbuild transpile the
TypeScript directly, so there's no per-package build step — `typecheck` is just `tsc --noEmit`.

## Prerequisites
- Node ≥ 20 (a `.nvmrc` pins 22), pnpm 10. `corepack enable` will provide pnpm.

## Install
```bash
pnpm install
```

## Everyday commands (run from the repo root)

**The single run command (use this in your IDE):**
```bash
pnpm dev                            # turbo runs the WHOLE project: edge worker + Expo, concurrently
```
This is a long-running process (two dev servers) — it does not exit. Turbo's UI shows both panes.

Per-target, or if you prefer one server per terminal (and want Expo's interactive keys w/i/a to work
cleanly, run mobile on its own):
```bash
pnpm dev:edge                       # Cloudflare Worker on http://localhost:8787
pnpm dev:mobile                     # Expo (press w = web/PWA, i = iOS, a = Android)
pnpm dev:web                        # Expo straight to web/PWA
pnpm dev:dom                        # apps/web — the plain React (Vite) renderer on http://localhost:8082
`pnpm dev:dom` also serves **`http://localhost:8082/lab/`** — the rail motion lab, a dev-only page
([ADR-112](./08-decision-log.md#adr-112--a-dev-page-lives-in-the-app-and-a-gate-keeps-it-out-of-the-app)).
It drives the real `RouteStopRow`, `RailBusToken` and `useRailFlip` from a timer over mock rows, so the one
thing no test and no headless browser can answer — *does the bus move nicely, and does it move on the right
occasions?* — can be answered by looking. Buttons for stepping a bus by hand, ragged row heights, a reflow
above the bus, spawn/despawn and a direction flip. **It is never built:** `vite build`'s only entry is the
root `index.html`, and two gates say so (`apps/web/test/dev-pages.test.mjs`, and `build:web` over the emitted
`dist/`).

```
`dev:web` and `dev:dom` are **two different apps serving the same screens**, which is the whole of Wave 6:
`dev:web` is the Expo/`react-native-web` PWA that WP0-5 ships, `dev:dom` is the plain-React app that
replaces it ([ADR-075](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)).
Since **WP6-0** the latter has the whole shell — router, persisted query cache, locale override,
appearance, service worker — but only **one ported screen**; every other destination renders a "coming
soon" placeholder that names the work package porting it
([ADR-082](./08-decision-log.md#adr-082--the-web-shell-before-the-web-screens-a-router-over-a-declared-destination-set-and-one-pwa-policy-for-two-apps)).

Checks (one-shot, not part of "running"):
```bash
pnpm typecheck                      # tsc --noEmit across every package (turbo)
pnpm test                           # vitest in every package that has tests (turbo)
pnpm lint                           # Biome
pnpm format                         # Biome --write

pnpm --filter @nextbus/ui tokens:emit   # regenerate the design-token artefacts from
                                        # packages/ui/tokens.json (docs/09 §1.1). Committed and
                                        # gated: `pnpm test` fails if any of them is stale.
```
`pnpm --filter @nextbus/edge test` runs the Worker suite on its own. Those specs execute **inside
workerd** (`@cloudflare/vitest-pool-workers`) against simulated KV/R2 bindings, so the dataset,
coalescing and tile paths are exercised the way they actually run — not against a node stub.

### Try the edge endpoints
With the worker running, hit a real KMB stop+route (live open data, no key):
```bash
# /v1/health — is this isolate serving the precomputed dataset? (see below)
curl "http://localhost:8787/v1/health"

# /v1/eta/:operator/:stop/:route[/:serviceType]
curl "http://localhost:8787/v1/eta/kmb/<16-char-stop-id>/1A/1"
curl "http://localhost:8787/v1/eta/ctb/<stop-id>/720"

# /v1/nearby?lat=&lng=[&radius=]  → NearbyStop[] with live ETAs (KMB; Mong Kok example)
curl "http://localhost:8787/v1/nearby?lat=22.3193&lng=114.1694&radius=500"

# Slice 2 — canonical-id endpoints (ids are URL-encoded, e.g. KMB%3A<stopId>)
curl "http://localhost:8787/v1/stop/KMB%3A<stopId>"            # → StopDetail (routes + next ETA)
curl "http://localhost:8787/v1/route/KMB%3A6%3Aoutbound%3A1"   # → RouteDetail (ordered stops)
curl "http://localhost:8787/v1/etas/KMB%3A<stopId>"            # → { etas, failed? } — what getEtas calls
# …and the batch (WP5-7): the parameter REPEATS, and each id is percent-encoded. A place id contains
# `+`, which a query string decodes as a space — so `%2B` or the id is rejected. `,` would be ambiguous:
# it is a legal `idchar`, and `%2C` is decoded before any delimiter could be split on.
curl "http://localhost:8787/v1/etas?ids=KMB%3A<stopId>&ids=P%3AKMB%3A<a>%2BCTB%3A<b>"   # → { reports: […] }

# /v1/index → SearchIndex (compact routes + stops for on-device search and the keypad)
curl -s "http://localhost:8787/v1/index" | head -c 200

# /v1/tiles/... → LandsD basemap + per-locale label overlay, proxied and made publicly cacheable
curl -sI "http://localhost:8787/v1/tiles/basemap/16/53550/28598.png"
curl -sI "http://localhost:8787/v1/tiles/label/tc/16/53550/28598.png"   # {lang} = en | tc | sc

# /v1/live?targets=… → the live-ETA socket (ADR-056). curl can only see the refusals, which is who
# the taxonomy envelope is for: a browser can read neither the status nor the body of a failed
# WebSocket handshake. Targets must be **percent-encoded** — `+` decodes to a space, and a place id
# is `P:<member>+<member>`.
curl -i "http://localhost:8787/v1/live"                                  # 400: needs Upgrade: websocket
curl -i -H "Upgrade: websocket" "http://localhost:8787/v1/live"          # 400: needs ?targets=
curl -i -H "Upgrade: websocket" "http://localhost:8787/v1/live?targets=KMB%3A<stopId>"   # 101
```
Responses are normalized and edge-cached, so many users on one stop = one upstream call. TTLs
([ADR-057](./08-decision-log.md)): **30 s for every live endpoint** (`/v1/eta`, `/v1/etas`,
`/v1/nearby`, `/v1/stop`, `/v1/route` — they all carry live ETAs), 6 h for `/v1/index`, 12 h for
tiles, and no caching at all for `/v1/health`. 30 s rather than the old 8 s because upstream only
refreshes about once a minute: at 8 s the cache almost never hit, so it wasn't saving an upstream
call — and staleness is still surfaced honestly from each reading's own `observedAt` (ADR-008).

### Three things about the dev loop that will waste a cycle if you do not know them

All three were established by hitting them, and none is guessable from the code.

**Warm the dataset before you open a `/v1/live` socket.** In `wrangler dev` there is no KV, so the
Worker falls back to building the 8.3 MB index in-isolate (ADR-055's degrade-to-slow path — `/v1/health`
says `"dataset":"inline"`). The `EtaHub` shard reads the dataset **inside its alarm**, and on a cold
isolate that build does not finish inside the alarm's window: the round never completes, so a socket
opened first sits there answering `snapshot etas=0` + `status live` for ever and looks like a broken
shard. One `curl "http://localhost:8787/v1/nearby?lat=22.3193&lng=114.1694"` first memoizes it and the
next round fires within seconds. Symptom to recognise: `wrangler dev`'s log shows the `101 Switching
Protocols` and then nothing at all.

**Metro dies if you edit a file while `pnpm dev:web` is running.** Not always, but often enough to plan
around: `TypeError: Cannot read properties of undefined (reading 'addedFiles')` out of
`metro/src/node-haste/DependencyGraph.js`, via NativeWind's Tailwind watcher. It kills the process
rather than recovering, so the port goes dead mid-verification. Make the edit, *then* start Metro; if it
does die, just restart it — nothing is corrupted.

**Two PWAs on one port means the first page you see is the other app.** A service worker's scope is the
**origin**, not the build — so if you verified `apps/mobile/dist` on `localhost:4173` last week and serve
`apps/web/dist` there today, the worker still registered for that origin answers your first navigation
from *its* precache. It looks like your new build silently did nothing: the header and the tab bar are the
other app's. The new worker does install and claim (both configs set `skipWaiting` + `clientsClaim`), so
**one reload fixes it** — the tell is the script tag, `/_expo/static/js/web/entry-*.js` versus
`/assets/index-*.js`. This is the same class of trap `lib/serviceWorker.ts` refuses to register in dev for,
one level up. Belt and braces: serve the two on **different ports**, and unregister when you are done —
DevTools → Application → Service workers → Unregister, or in the console
`navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))`.

### Point the app at the edge
The **Nearby** screen is wired to live data: it requests location permission, geolocates, and calls
`dataSource.getNearby(...)` → the Worker's `/v1/nearby`. Run both together and grant location:
```bash
pnpm dev                                   # edge + app together
# or run the app alone against a deployed/other API:
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm dev:mobile
```
On web, the browser will prompt for location. `EXPO_PUBLIC_API_URL` defaults to `http://localhost:8787`.

## The static dataset — build & publish ([ADR-055](./08-decision-log.md))
Routes, stops, places, aliases and geo cells are **precomputed outside the Worker** by a node
script, then read back as content-addressed shards from KV (+ the search index from R2). A request
costs a handful of KV point reads instead of an 8.3 MB fetch and a full re-normalization in the
isolate.

```bash
pnpm dataset:build              # fetch + normalize + cluster + shard → apps/edge/.dataset/<hash>/
pnpm dataset:publish            # build, then write the shards and flip build:current (remote)
pnpm dataset:publish --local    # …into the Miniflare state `wrangler dev` uses — the local KV path
pnpm dataset:publish --force    # republish even when the upstream source hash is unchanged
```
A real build measured **10,118 places · 6,351 aliases · 3,653 routes · 486 cells** (14,072 stops)
— ≈20.6k KV keys; about 2.6 s to build and ~70 s to publish locally. A remote publish needs
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment; without `--force` it skips
the write entirely when the upstream source hash hasn't moved (KV writes are the metered side).

Every key is namespaced by the build hash — `place:<hash>:<id>`, `alias:<hash>:<stopId>`,
`route:<hash>:<id>`, `geo:<hash>:<cell>` — and R2 holds `builds/<hash>/search-index.json` plus
`manifest.json`. The one mutable key, `build:current`, is flipped **last**, so a failed publish
leaves an unreachable orphan rather than a half-served dataset, and a rollback is a single key
write. In production the job is `.github/workflows/dataset.yml` (daily, 19:00 UTC = 03:00 HKT);
the Worker has **no cron trigger and no `scheduled` handler**.

**To exercise the KV path locally:** `pnpm dataset:publish --local`, then `pnpm dev:edge` — the
same Miniflare state, so `/v1/health` should report `"dataset":"kv"`.

### Read `/v1/health` after every deploy
```bash
curl "http://localhost:8787/v1/health"
# {"ok":true,"dataset":"kv","buildHash":"…","datasetBuildsThisIsolate":0}
```
- **`dataset`** — `"kv"` means precomputed shards. `"inline"` means there are no bindings or no
  current build, so the Worker builds the whole index **in-request**: fine for dev, never for
  production.
- **`datasetBuildsThisIsolate: 0` is the production invariant.** It counts how many times this
  isolate built the index itself; anything above zero means the expensive path has crept back into
  a request. The dataset workflow asserts both fields against the deployed Worker after every
  publish (whenever the `EDGE_URL` repo variable is set), and the edge test suite asserts the
  counter stays 0 across a full endpoint sweep.

## Build the PWA ([ADR-058](./08-decision-log.md))

**Two apps, one command each, one policy.**
```bash
pnpm --filter @nextbus/mobile build:web       # expo export -p web → apps/mobile/dist/ (incl. dist/sw.js)
pnpm --filter @nextbus/web    build:web       # vite build         → apps/web/dist/    (incl. dist/sw.js)
```
Each is its exporter **plus** a Workbox `generateSW` pass over that output, in one command so the
precache manifest can't drift from the bundle it describes. The Workbox runtime is inlined into
`dist/sw.js`, so the offline service worker doesn't need a CDN on its first run. **A bare
`expo export -p web` or `vite build` produces no service worker** — always go through `build:web`.

The **caching policy is one declaration** for both, in
[`scripts/pwa/workbox.config.mjs`](../scripts/pwa/workbox.config.mjs) since WP6-0
([ADR-082](./08-decision-log.md#adr-082--the-web-shell-before-the-web-screens-a-router-over-a-declared-destination-set-and-one-pwa-policy-for-two-apps)) —
it is ADR-058's decisions in data, so two copies could disagree about what a rider sees with no network.
`apps/web/test/pwa-policy.test.mjs` asserts its shape on every `pnpm test`; `assertServiceWorker` (same
file) asserts the emitted `sw.js` at build time. Both apps' PWA icons and `manifest.webmanifest` come from
one run of `node scripts/gen-icons.mjs`, whose two colours are read from the ink **token**.

Set `EXPO_PUBLIC_API_URL` / `VITE_API_URL` to the deployed Worker when you build a real one: it is baked
into the bundle *and* into the service worker's runtime-caching routes (app shell precached; `/v1/index`
stale-while-revalidate; live endpoints network-first with an offline fallback; tiles cached only once
actually seen).

To check offline behaviour: serve `dist/` over any static server (`npx serve dist`, or `npx vite preview`
for `apps/web` — it does the SPA fallback online that the service worker does offline), load the app once,
then kill **both** that server and the Worker and reload. Verified this way for `apps/mobile` — a cold load
of `/search` still opens the app and searches from cache — and for `apps/web` at WP6-0, where the tell that
it is genuinely the worker answering is `performance.getEntriesByType('navigation')[0].deliveryType ===
'cache-storage'`. **Read the third dev-loop trap above before you serve both apps on one port.**

## Configuration & secrets
*The reasoning behind all of this — including why there is no staging tier — is
[ADR-061](./08-decision-log.md#adr-061--environments-and-configuration-topology-local--production-ephemeral-previews-and-no-staging-tier).*

**The headline fact: this project has two secrets, and neither is needed to run it.** Every
upstream we depend on is keyless — the bus APIs (`docs/02`) and the LandsD basemap tiles
([ADR-049](./08-decision-log.md)) alike — so a fresh clone runs end-to-end with nothing configured.
The only credentials that exist are the ones that let CI *publish* the dataset.

**The inventory is [`.env.example`](../.env.example) at the repo root** — every variable in the repo, with
its default and its reader. Nothing loads it; it exists so this table has one machine-readable twin rather
than four scattered ones. The files that *are* loaded sit next to the thing that reads them:
`apps/mobile/.env.local` (Expo), `apps/web/.env.local` (Vite), `apps/edge/.dev.vars` (Wrangler).

| Variable | Secret? | Who reads it | Where it lives |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **yes** | `dataset:publish`, and `wrangler deploy` in `ci.yml` | GitHub Actions **secret** |
| `CLOUDFLARE_ACCOUNT_ID` | it's an identifier, treat as one | as above | GitHub Actions **secret** |
| `DATASET_PUBLISH_ARMED` | no | `.github/workflows/dataset.yml` | GitHub Actions **variable** — `true` once the KV namespace exists |
| `DEPLOY_ARMED` | no | `ci.yml`'s deploy job, which is inert without it | GitHub Actions **variable** — `true` once the domain and secrets exist |
| `EDGE_URL` | no | both workflows' `/v1/health` check | GitHub Actions **variable**. Unset ⇒ the check **does not run** and both workflows now say so with a `::warning::`, because a skipped acceptance check that stays quiet is a gate looking at nothing |
| KV namespace id | no | the Worker | committed, in `apps/edge/wrangler.toml` (with a commented `preview_id` — ADR-061 decision 2) |
| `EXPO_PUBLIC_API_URL` | **no, and cannot be** | `apps/mobile`, at build time — the data source, the tile source **and** `build:web`, which bakes it into `dist/sw.js` | `apps/mobile/.env.local` (see `.env.example`) or the build env |
| `VITE_API_URL` | **no, and cannot be** | `apps/web`, at build time (`src/adapters/datasource.ts`) | `apps/web/.env.local` (see `.env.example`) or the build env |
| `LIVE_ALLOWED_ORIGINS` | no | the Worker, on a `/v1/live` upgrade | optional `[vars]` in `wrangler.toml`, or `apps/edge/.dev.vars` locally. Unset ⇒ **no origin filtering**, which is today's state (ADR-056 decision 9) |
| `EXPO_PUBLIC_LIVE_URL` / `VITE_LIVE_URL` | no | both app shells, at build time (`lib/datasource.ts` · `src/adapters/datasource.ts`) | the escape hatch for a socket tier on a different host, passed to `EdgeClientOptions.liveUrl`. **Unset is the normal case** and means `wss://<same host>/v1/live`, derived by `liveSocketUrl` ([ADR-076](./08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll)) |
| `EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT` | no | both app shells, at build time | `poll` (**the shipped default**) \| `socket`. One declaration of the mapping, in `@nextbus/api-client`'s `live/select.ts`; there is deliberately no `auto`, and an unrecognised value falls back to `poll` with a `console.warn` naming it. Since WP5-7 it is **not** inert in `apps/web` either — `Nearby` holds a subscription there, so this variable decides which engine feeds its arrivals in both renderers ([ADR-076](./08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll), [ADR-079](./08-decision-log.md#adr-079--one-request-per-round-the-batch-eta-endpoint-and-nearby-as-a-live-adopter)) |

**One variable per renderer, and the socket URL is not one of them.** `EXPO_PUBLIC_API_URL` and
`VITE_API_URL` are the *only* endpoint configuration; `wss://<same host>/v1/live` is **derived** from each
by `liveSocketUrl` in `@nextbus/core`, corpus-pinned, because the `https:`→`wss:` half of that derivation is
the one that ships a rider's location in cleartext when forgotten, works perfectly against
`http://localhost:8787`, and shows no symptom anywhere ([ADR-056](./08-decision-log.md#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)
decision 8). Both default to `DEFAULT_API_URL` in `packages/api-client/src/endpoint.ts` — the **one**
declaration, down from four copies under two variable names, and
`scripts/check-one-endpoint-declaration.mjs` (in the `pnpm boundaries` chain) fails the build if a second
one appears or if an env read falls back to a literal instead of to it.

### Three homes, split by who consumes the value

1. **CI credentials → GitHub Actions secrets.** The two Cloudflare values, and nothing else. Free,
   encrypted, and already wired into `dataset.yml`.
2. **Worker runtime secrets → `wrangler secret put`.** There are **none today**. When one appears
   (an error-reporting DSN, a metered upstream), it goes here — encrypted at rest, never in
   `wrangler.toml`, which is committed. `apps/edge/.dev.vars` is the local mirror and is gitignored;
   Wrangler loads it automatically.
3. **Your own machine → `wrangler login`.** OAuth, credentials in `~/.wrangler`. You only ever need
   to *mint* an API token for CI to use — don't keep one lying around in a shell profile.

**Only a bundler loads a `.env` file, and only from its own project directory.** Expo reads
`apps/mobile/.env*`; Vite reads `apps/web/.env*`. Nothing in the repo depends on `dotenv`, **nothing reads a
`.env` at the repo root** (`.env.example` there is an inventory, not a configuration), and
`publish-dataset.mts` reads `process.env` directly — so `CLOUDFLARE_API_TOKEN` must come from the real
environment (CI, or `export` in the shell for a one-off).

### Two traps

- **`EXPO_PUBLIC_*` is public.** Expo inlines it into the bundle; it is readable in DevTools by
  anyone using the app. Fine for the API URL, fatal for a key. There is no way to hide a secret in
  a client bundle — anything needing one is proxied through the Worker instead. That is already why
  the tile proxy exists.
- **The KV namespace id is not a credential.** It's inert without an authenticated token, and it's
  committed on purpose so the Worker's bindings resolve. Don't let it drag you towards a secrets
  manager.

### Minting the Cloudflare token

Use the dashboard's **"Edit Cloudflare Workers"** template as the starting point and add
**Workers KV Storage: Edit** and **Workers R2 Storage: Edit**; the publish job needs nothing more
than those plus the Workers Scripts permission the template already grants. Scope it to the one
account. **Don't use the Global API Key** — it can't be scoped and can't be revoked in isolation.
Keep the master copy in whatever password manager you already use; GitHub can't show it back to
you after it's set.

A dedicated secrets service (Doppler, Infisical, Vault, SOPS) would be more machinery than two
values justify. Revisit it if a second environment, a second person, or ~10 secrets appear.

### Environments: local and production, and that's it
There is **no staging tier**, on purpose ([ADR-061](./08-decision-log.md#adr-061--environments-and-configuration-topology-local--production-ephemeral-previews-and-no-staging-tier)).
`pnpm dataset:publish --local` writes into the same Miniflare state `wrangler dev` reads and the edge
suite runs inside workerd, so the local KV path is genuinely exercised — that is what staging would
have been for. For per-change review, Cloudflare Pages gives preview URLs per branch and Workers
gives them per version (`wrangler versions upload`): disposable, tied to a PR, nothing to keep in sync.

**One exception, and it's about the prune rather than about environments.** Before the first
production publish, make a *preview* namespace and rehearse there:
```bash
wrangler kv namespace create DATASET --preview    # → preview_id, alongside the real id
# publish TWICE against it, then confirm the prune kept the allowlist and the rollback target
```
Step 4 of `publish-dataset.mts` deletes ~20k keys per superseded build and has only ever run against
Miniflare. The failure mode is deleting the live build, so it earns a rehearsal against a real
backend.

## Deploy (later)
**CI runs on every PR and every push to `main`** (`.github/workflows/ci.yml`, added in Wave 5): a clean
checkout, `pnpm install --frozen-lockfile`, `typecheck` · `lint` · `test` (which includes the whole
`boundaries` chain), `wrangler deploy --dry-run` to prove the Worker bundle and its Durable Object still
compile, and `git diff --exit-code` to prove no gate rewrote a committed artefact. It needs **no
credentials**. The workflow's own deploy job is written out in full and **deliberately inert** — it runs only
when the `DEPLOY_ARMED` variable is `true`, so arming it is a settings change rather than a new file.
- **Edge:** `pnpm --filter @nextbus/edge deploy` (Wrangler). First time, create the storage the
  dataset lives in, uncomment the `[[routes]]` / `workers_dev = false` block in `wrangler.toml` with the
  real hostname, and wire it up:
  ```bash
  wrangler kv namespace create DATASET       # → replace REPLACE_WITH_KV_NAMESPACE_ID in wrangler.toml
  wrangler r2 bucket create nextbus-builds
  pnpm dataset:publish                       # so build:current exists before the first request
  ```
  Then confirm `/v1/health` reports `"dataset":"kv"` and `datasetBuildsThisIsolate: 0`. The
  bindings are optional in `Env`, so a Worker deployed without them still runs — it just falls
  back to the slow inline build and says so.
- **Web/PWA:** `pnpm --filter @nextbus/mobile build:web` → deploy `apps/mobile/dist/` to
  Cloudflare Pages (with `EXPO_PUBLIC_API_URL` pointing at the deployed Worker).
- **Native:** hand-written Swift / Kotlin apps in **separate repos**, each with its own store pipeline
  — **no EAS, no OTA** ([ADR-075](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels),
  Phase 3 — see [roadmap](./06-roadmap.md)). They start from
  [`packages/contract/README.md`](../packages/contract/README.md).

## Status / next steps
- **Slice 1 (Nearby) is live** — KMB only, computed **server-side** in the Worker (ADR-016).
  Verified end-to-end against real HK open data.
- The daily crawl → KV/R2 half now ships as the **dataset build** above (ADR-055), which is what
  removed the Worker's `scheduled` stub.
- Next: **Citybus** nearby; the **on-device** nearby index (ADR-007); **Stop detail + Favorites**
  (Slice 2); then Routes search, the map, and the livery/locale pickers.
