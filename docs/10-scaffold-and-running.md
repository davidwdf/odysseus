# 10 — Scaffold & Running It

The monorepo skeleton described in [`05`](./05-monorepo-and-tooling.md) now exists. This is the
"how do I run it" guide.

## What's in place

```
apps/
  mobile/          Expo app (iOS / Android / Web-PWA) — NativeWind + expo-router + reanimated
  edge/            Cloudflare Worker — cached ETA proxy, LandsD tile proxy, precomputed dataset
                   reader (KV/R2); the daily build runs in GitHub Actions, not in the Worker
packages/
  core/            canonical types, DataSource interface, honest-ETA helpers
  data-normalize/  KMB + Citybus fetch adapters (zod-validated) → canonical Eta
  api-client/      EdgeClient (v1 DataSource) + watch() polling shim
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
```

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
curl "http://localhost:8787/v1/etas/KMB%3A<stopId>"            # → Eta[] (canonical; what getEtas calls)

# /v1/index → SearchIndex (compact routes + stops for on-device search and the keypad)
curl -s "http://localhost:8787/v1/index" | head -c 200

# /v1/tiles/... → LandsD basemap + per-locale label overlay, proxied and made publicly cacheable
curl -sI "http://localhost:8787/v1/tiles/basemap/16/53550/28598.png"
curl -sI "http://localhost:8787/v1/tiles/label/tc/16/53550/28598.png"   # {lang} = en | tc | sc
```
Responses are normalized and edge-cached, so many users on one stop = one upstream call. TTLs
([ADR-057](./08-decision-log.md)): **30 s for every live endpoint** (`/v1/eta`, `/v1/etas`,
`/v1/nearby`, `/v1/stop`, `/v1/route` — they all carry live ETAs), 6 h for `/v1/index`, 12 h for
tiles, and no caching at all for `/v1/health`. 30 s rather than the old 8 s because upstream only
refreshes about once a minute: at 8 s the cache almost never hit, so it wasn't saving an upstream
call — and staleness is still surfaced honestly from each reading's own `observedAt` (ADR-008).

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
```bash
pnpm --filter @nextbus/mobile build:web       # → apps/mobile/dist/ (incl. dist/sw.js)
```
This is `expo export -p web` **plus** a Workbox `generateSW` pass over that output, in one command
so the precache manifest can't drift from the bundle it describes. The Workbox runtime is inlined
into `dist/sw.js`, so the offline service worker doesn't need a CDN on its first run. **A bare
`expo export -p web` produces no service worker** — always go through `build:web`.

Set `EXPO_PUBLIC_API_URL` to the deployed Worker when you build a real one: it is baked into the
bundle *and* into the service worker's runtime-caching routes (app shell precached; `/v1/index`
stale-while-revalidate; live endpoints network-first with an offline fallback; tiles cached only
once actually seen).

To check offline behaviour: serve `dist/` over any static server (e.g. `npx serve dist`), load the
app once, then kill **both** that server and the Worker and reload. Verified this way — a cold load
of `/search` still opens the app and searches from cache.

## Configuration & secrets
*The reasoning behind all of this — including why there is no staging tier — is
[ADR-061](./08-decision-log.md#adr-061--environments-and-configuration-topology-local--production-ephemeral-previews-and-no-staging-tier).*

**The headline fact: this project has two secrets, and neither is needed to run it.** Every
upstream we depend on is keyless — the bus APIs (`docs/02`) and the LandsD basemap tiles
([ADR-049](./08-decision-log.md)) alike — so a fresh clone runs end-to-end with nothing configured.
The only credentials that exist are the ones that let CI *publish* the dataset.

| Variable | Secret? | Who reads it | Where it lives |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **yes** | `dataset:publish`, in CI | GitHub Actions **secret** |
| `CLOUDFLARE_ACCOUNT_ID` | it's an identifier, treat as one | as above | GitHub Actions **secret** |
| `DATASET_PUBLISH_ARMED` | no | `.github/workflows/dataset.yml` | GitHub Actions **variable** — `true` once the KV namespace exists |
| `EDGE_URL` | no | the workflow's `/v1/health` check | GitHub Actions **variable** (the step self-skips when unset) |
| KV namespace id | no | the Worker | committed, in `apps/edge/wrangler.toml` |
| `EXPO_PUBLIC_API_URL` | **no, and cannot be** | the app, at build time | `apps/mobile/.env.local` (see `.env.example`) or the build env |

### Three homes, split by who consumes the value

1. **CI credentials → GitHub Actions secrets.** The two Cloudflare values, and nothing else. Free,
   encrypted, and already wired into `dataset.yml`.
2. **Worker runtime secrets → `wrangler secret put`.** There are **none today**. When one appears
   (an error-reporting DSN, a metered upstream), it goes here — encrypted at rest, never in
   `wrangler.toml`, which is committed. `apps/edge/.dev.vars` is the local mirror and is gitignored;
   Wrangler loads it automatically.
3. **Your own machine → `wrangler login`.** OAuth, credentials in `~/.wrangler`. You only ever need
   to *mint* an API token for CI to use — don't keep one lying around in a shell profile.

**No `.env` file is loaded outside the Expo app.** Nothing in the repo depends on `dotenv`:
`publish-dataset.mts` reads `process.env` directly, so `CLOUDFLARE_API_TOKEN` must come from the
real environment (CI, or `export` in the shell for a one-off). Only Expo has built-in `.env`
support, and only for its own directory.

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
- **Edge:** `pnpm --filter @nextbus/edge deploy` (Wrangler). First time, create the storage the
  dataset lives in and wire it up:
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
- **Native:** EAS Build/Submit (Phase 3 — see [roadmap](./06-roadmap.md)).

## Status / next steps
- **Slice 1 (Nearby) is live** — KMB only, computed **server-side** in the Worker (ADR-016).
  Verified end-to-end against real HK open data.
- The daily crawl → KV/R2 half now ships as the **dataset build** above (ADR-055), which is what
  removed the Worker's `scheduled` stub.
- Next: **Citybus** nearby; the **on-device** nearby index (ADR-007); **Stop detail + Favorites**
  (Slice 2); then Routes search, the map, and the livery/locale pickers.
