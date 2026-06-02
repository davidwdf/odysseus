# 10 — Scaffold & Running It

The monorepo skeleton described in [`05`](./05-monorepo-and-tooling.md) now exists. This is the
"how do I run it" guide.

## What's in place

```
apps/
  mobile/          Expo app (iOS / Android / Web-PWA) — NativeWind + expo-router + reanimated
  edge/            Cloudflare Worker — cached ETA proxy + daily-crawl cron stub
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
pnpm lint                           # Biome
pnpm format                         # Biome --write
```

### Try the edge ETA endpoint
With the worker running, hit a real KMB stop+route (live open data, no key):
```bash
# /v1/eta/:operator/:stop/:route[/:serviceType]
curl "http://localhost:8787/v1/eta/kmb/<16-char-stop-id>/1A/1"
curl "http://localhost:8787/v1/eta/ctb/<stop-id>/720"

# /v1/nearby?lat=&lng=[&radius=]  → NearbyStop[] with live ETAs (KMB; Mong Kok example)
curl "http://localhost:8787/v1/nearby?lat=22.3193&lng=114.1694&radius=500"

# Slice 2 — canonical-id endpoints (ids are URL-encoded, e.g. KMB%3A<stopId>)
curl "http://localhost:8787/v1/stop/KMB%3A<stopId>"            # → StopDetail (routes + next ETA)
curl "http://localhost:8787/v1/route/KMB%3A6%3Aoutbound%3A1"   # → RouteDetail (ordered stops)
curl "http://localhost:8787/v1/etas/KMB%3A<stopId>"            # → Eta[] (canonical; what getEtas calls)
```
Responses are normalized and edge-cached (ETAs ~8s, nearby ~10s, route 1h) — so many users on one stop =
one upstream call.

### Point the app at the edge
The **Nearby** screen is wired to live data: it requests location permission, geolocates, and calls
`dataSource.getNearby(...)` → the Worker's `/v1/nearby`. Run both together and grant location:
```bash
pnpm dev                                   # edge + app together
# or run the app alone against a deployed/other API:
EXPO_PUBLIC_API_URL=http://localhost:8787 pnpm dev:mobile
```
On web, the browser will prompt for location. `EXPO_PUBLIC_API_URL` defaults to `http://localhost:8787`.

## Deploy (later)
- **Edge:** `pnpm --filter @nextbus/edge deploy` (Wrangler; create the `DATASET` KV namespace and
  uncomment it in `wrangler.toml` first).
- **Web/PWA:** `pnpm --filter @nextbus/mobile exec expo export -p web` → deploy to Cloudflare Pages.
- **Native:** EAS Build/Submit (Phase 3 — see [roadmap](./06-roadmap.md)).

## Status / next steps
- **Slice 1 (Nearby) is live** — KMB only, computed **server-side** in the Worker (ADR-016).
  Verified end-to-end against real HK open data.
- Next: **Citybus** nearby; the daily-crawl pipeline → KV/R2 + **on-device** nearby index (ADR-007,
  also retires the `scheduled` stub); **Stop detail + Favorites** (Slice 2); then Routes search,
  the map, and the livery/locale pickers.
