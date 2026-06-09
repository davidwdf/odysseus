# CLAUDE.md — read this before doing any work

This is the agent onboarding guide for **NextBus HK**, a fast, mobile-first Hong Kong bus
arrival-times app. Its job is to make sure every agent works the same way and we stay on the
same page. **Read this, then skim [`docs/README.md`](./docs/README.md).**

## What this is
A pnpm + Turborepo monorepo. One Expo codebase ships a PWA now and iOS/Android later; a Cloudflare
Worker is the edge data layer. HK bus open-data APIs (keyless) are normalized into one model.

The **plan is the source of truth** and lives in [`docs/`](./docs/README.md):
- New here? Read `docs/01` (vision) → `docs/03` (architecture) → `docs/08` (decision log) → `docs/10` (run it).
- Theme/design system: `docs/09`. Data sources: `docs/02`.

## Run it (always the same commands, from the repo root)
```bash
pnpm install            # first time
pnpm dev                # EVERYTHING: edge worker + Expo, concurrently (the IDE run command)
pnpm dev:edge           # just the Cloudflare Worker  → http://localhost:8787
pnpm dev:mobile         # just Expo (press w = web/PWA, i = iOS, a = Android)
pnpm dev:web            # Expo straight to web/PWA
pnpm typecheck          # tsc --noEmit across all packages — MUST pass before commit
pnpm lint               # Biome
pnpm format             # Biome --write
```
Full guide incl. deploy: [`docs/10`](./docs/10-scaffold-and-running.md).

## Repo map
```
apps/mobile          Expo app (iOS/Android/Web-PWA)
apps/edge            Cloudflare Worker (ETA proxy, /v1/nearby, daily-crawl cron)
packages/core        canonical types · DataSource interface · ETA helpers
packages/data-normalize  KMB + Citybus adapters (upstream → canonical)
packages/api-client  EdgeClient (the v1 DataSource) + watch() polling shim
packages/i18n        en / zh-Hant / zh-Hans UI strings
packages/ui          NativeWind preset + themes + tokens
packages/tsconfig    shared TS configs
```

## Golden rules (don't break these)
1. **Internal packages are source-only** (`main → src/index.ts`); there is **no build step**.
   Metro/esbuild transpile the TS. So `typecheck` is just `tsc --noEmit` per package. Import via
   `@nextbus/*`.
2. **All data goes through the `DataSource` seam** (`@nextbus/core` → `@nextbus/api-client`). UI
   and screens NEVER call upstream HK APIs directly. Swapping the v1 client for the v2 socket
   engine must not touch the UI. See `docs/03`, ADR-004.
3. **ETAs are approximations — never fake precision** (ADR-008). No client-side per-second
   countdown. Update the value only when fresh data arrives; use tabular figures; show
   "Arriving/Due" under a minute; indicate staleness. Use the helpers in `@nextbus/core/eta`.
4. **Styling = NativeWind + semantic tokens only.** Use `bg-bg`, `text-text`, `text-muted`,
   `text-accent`, `bg-positive`, etc. — never raw hex in components. Themes (incl. liveries) are
   value-swaps in `@nextbus/ui` (`docs/09`, ADR-015). **Radix/shadcn are web-only — do NOT use
   them.** For RN primitives use **react-native-reusables** (copy-in, NativeWind-based).
5. **Bilingual is core.** UI strings live in `@nextbus/i18n` (en / zh-Hant / zh-Hans). All bus
   data names are `I18nText` from the canonical model. Never hard-code English labels. Screens read
   the active locale via **`useLocale()`** (device-detected through `expo-localization` +
   `resolveLocale`, with a manual-override hook) — never hard-code a locale constant in a screen.
   **English prose and user-facing `en` strings use British English (Oxford `-ize` spelling)**
   (ADR-031): write `colour`/`centre`/`grey`/`favourite`/`behaviour`/`licence` (noun); keep the
   `-ize`/`-ization` ending (`normalize`, `optimize`, `memoize`) — that's Oxford British, not US, and
   matches `@nextbus/data-normalize`. **Code is exempt:** identifiers, props, CSS/Tailwind keywords
   (`color`, `text-center`, `bg-gray-*`), upstream API fields, and route/file names keep their existing
   spelling (e.g. the `favorites` store key stays — only its UI *label* is "Favourites").
6. **Pin SDK-aligned dependency versions — don't guess.** Expo packages are version-aligned to the
   SDK (e.g. `expo-router@56.x`). For RN-ecosystem libs, read the versions from
   `expo@<ver>/bundledNativeModules.json` (we did this for the scaffold). Tailwind stays on **3.4**
   (NativeWind), TypeScript on **5.9** for shared packages.
7. **Docs are the source of truth and must stay in sync.** A pre-commit hook
   (`scripts/precommit-docs-check.mjs` + the `check-docs` skill) **blocks** a commit that stages
   code without `docs/` changes. Either update the relevant doc (and add an ADR in `docs/08` for any
   new cross-cutting decision), or — if truly no doc change is needed — include `[docs-ok]` in the
   commit message. Don't reach for `--no-verify`.

## Definition of done (for any change)
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` clean (or justified).
- [ ] If you changed behaviour, you ran it: worker via `curl`, app via `pnpm dev:web`.
- [ ] Docs updated (or `[docs-ok]`); new decisions recorded as an ADR in `docs/08`.
- [ ] No raw hex / no English-only strings / no direct upstream calls from UI.

## How to verify a change
- **Edge:** `pnpm dev:edge`, then `curl "http://localhost:8787/v1/eta/kmb/<stopId>/<route>/1"` or
  `curl "http://localhost:8787/v1/nearby?lat=22.3193&lng=114.1694"`.
- **App:** `pnpm dev:web` and open `http://localhost:8081`.
- **Types/bundle:** `pnpm typecheck`; `pnpm --filter @nextbus/edge exec wrangler deploy --dry-run`.

## Current status
**The living status/handoff doc is [`docs/11`](./docs/11-status.md) — read it to resume.** Summary:
Scaffold complete and verified. **Slice 1 — Nearby — is live and verified end-to-end**: the app
geolocates → `DataSource.getNearby` → Worker `/v1/nearby` (memoized KMB index + bounded live ETAs)
→ themed `StopCard`/`EtaBadge`. KMB only and **server-side** for now (ADR-016). Next: Citybus
nearby, on-device index (ADR-007), Stop detail + Favorites (Slice 2). Roadmap/backlog: `docs/06`,
`docs/07`. Cloudflare agent skills are installed — prefer the `cloudflare` / `wrangler` /
`durable-objects` skills for edge work.
