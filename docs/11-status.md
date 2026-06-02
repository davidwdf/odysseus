# 11 — Status & Where to Continue

> **Living handoff doc — update it at the end of each working session.**
> Snapshot: **2026-06-02**. Branch: `hk-bus-arrival-app`. Last commit: Slice 2 (stop/route + favorites).

## TL;DR
Scaffold, **Slice 1 (Nearby)**, the **design system** (fonts/type/elevation/themed nav + a two-axis
livery picker), and **Slice 2 (Stop detail · Route detail · Favorites · language picker)** are complete
and **verified end-to-end against live HK open data**. KMB only; nearby/stop/route computed
**server-side** for now. Pick up at **Citybus in nearby** or the **on-device index / daily crawl**.

## ✅ Done & verified
- **Monorepo:** pnpm + Turborepo + Biome; 8 packages; internal packages are source-only (no build step).
- **packages:** `core` (canonical types, `DataSource` seam, honest-ETA helpers) · `data-normalize`
  (KMB + Citybus ETA adapters, **KMB static index** via bulk endpoints + haversine) · `api-client`
  (`EdgeClient` + `watch()` polling shim) · `i18n` (en / 繁 / 简 + `resolveLocale`) · `ui`
  (NativeWind preset + `themes.ts` light/dark + liveries + tokens) · `tsconfig`.
- **apps/edge:** `/v1/nearby`, **`/v1/stop/:id`** (StopDetail), **`/v1/route/:id`** (RouteDetail),
  **`/v1/etas/:id`** (canonical Eta[]), and the low-level `/v1/eta/:co/:stop/:route` — KMB, one
  **shared memoized index** (`kmb-index.ts`) + bounded ETA fetch + edge cache; daily-crawl cron is a **stub**.
- **apps/mobile:** tabs shell · `QueryProvider` · `LocaleProvider` (device detection + **persisted**
  override) · **Nearby** (live, tappable cards) · **Stop detail** `/stop/[id]` (live ETAs, route dedup,
  save) · **Route detail** `/route/[id]` (ordered stops) · **Favorites** tab · **Settings** (language +
  appearance + livery pickers) · components `StopCard`, `EtaBadge`, `RouteChip`, `SaveButton`, `Card`,
  `Text`, `Skeleton`.
- **Verified:** `pnpm typecheck` 7/7 · live `/v1/nearby` · `/v1/stop` · `/v1/route` · `/v1/etas` return
  real data · **full Slice 2 flow walked in-browser** (Nearby→Stop→Route, save→Favorites, language re-localizes).
- **Design system realized** ([ADR-017](./08-decision-log.md)): **Inter loaded** (weight cuts +
  splash gate); **`<Text variant>`** typography primitive driving the docs/09 §3 scale (+ `text-*`
  utilities in the preset); **elevation** tokens + a **`Card`** primitive (shadow on light / surface-2
  on dark); **themed tab bar** via a new `useTheme()` hook + `themeColor()` resolver; operator-accent
  contrast text tokenized (no more raw hex in `StopCard`). All `apps/mobile` text migrated to `<Text>`.
- **Theme picker live** ([ADR-018](./08-decision-log.md)): **two-axis theme** — `themes[livery][mode]`,
  every livery (Classic/KMB/Citybus/CMB/Dot-Matrix/Split-Flap) in **light + dark**. **Settings screen**
  has an appearance segmented control (auto/light/dark) + livery list. Persisted via **Zustand +
  AsyncStorage**; splash gated on rehydration (no theme flash). **Verified in-browser**: switching
  either axis re-skins tab bar/cards/accents/surface-tint instantly; choice survives reload. Also
  verified `expo export --platform web` (Inter assets emitted) · typecheck 7/7 · Biome clean (only the
  pre-existing `ready!` / `@tailwind` warnings).
- **Slice 2 — Stop/Route/Favorites/Language** ([ADR-020](./08-decision-log.md)): KMB index extended with
  `stopById` + route origin/dest + ordered `routeToStops`; worker `/v1/stop`, `/v1/route`, `/v1/etas`
  (canonical) with a shared memoized index; **`getEtas` mismatch reconciled**. App: tappable Stop detail
  (live ETAs, rider-duplicate routes collapsed, favorite toggle), Route detail (ordered stops), Favorites
  (Zustand store, reuses theme persistence), Settings language picker (persisted, live re-localization).
  Fixed an etabus **3-concurrent-fetch 403** quirk (route fetched solo, then the pair, + backoff retry).
- **Docs:** plan `01–10`, ADRs `001–020`, `CLAUDE.md` / `AGENTS.md`, pre-commit docs-check skill + hook.

## 🚧 Not done yet / known limitations
- All data is **server-side & KMB-only** ([ADR-016](./08-decision-log.md)). Citybus and the
  **on-device index** ([ADR-007](./08-decision-log.md)) are pending.
- The **daily crawl is a stub** — no canonical static dataset in KV/R2 yet (no offline).
- The **Routes tab** is still a placeholder (no route search yet); stop/route detail are reached by tapping.
- Stop detail's ETA fan-out is **capped** (`MAX_ETA_ROUTES`) and refreshes via `refetchInterval` polling,
  not the `watch()` socket (v2). No map · no push · no native build has been run.
- `Skeleton` is static; the number-flip / split-flap ETA animation isn't built; **CJK uses the platform
  face by decision** (no Noto bundled — [ADR-019](./08-decision-log.md)); `font-display` (dot-matrix) face
  not added; display-livery character treatments (LED / flip-tile) are colour-only; Lucide icons pending
  (the favorite control is a text "Save" pill for now).

## ▶️ How to resume
1. Read [`CLAUDE.md`](../CLAUDE.md) → [`docs/README.md`](./README.md).
2. `pnpm install`, then `pnpm dev` (or `pnpm dev:edge` / `pnpm dev:web`). Verify per [`docs/10`](./10-scaffold-and-running.md).

## 🔜 Next steps (priority order)
1. **Citybus in nearby/stop** — CTB stop crawl (per-route; no bulk stop endpoint) + stop-merge (`Place`)
   for co-located KMB/CTB stops, then include CTB in `/v1/nearby` and `/v1/stop`.
2. **Daily crawl → KV/R2 + on-device index** — implement the `scheduled` crawl writing a versioned
   dataset; move nearby/stop on-device (ADR-007); enables offline. Retires the stub.
3. **Routes tab** — route-number search → `/route/[id]` (the screen already exists).
4. **Map view** (MapLibre) for Nearby.
5. **Polish** — number-flip / split-flap ETA animation, freshness pulse, shimmer skeleton,
   reduced-motion + a11y pass, Lucide icons (incl. a real favorite star), swipe-to-favorite + haptics.

## 📍 Key file pointers
- DataSource seam → `packages/core/src/datasource.ts`; EdgeClient → `packages/api-client/src/index.ts`
- Edge logic → `apps/edge/src/{nearby,stop-route,kmb-index}.ts`; KMB index → `packages/data-normalize/src/kmb-static.ts`
- Screens → `apps/mobile/app/(tabs)/index.tsx` (Nearby), `app/stop/[id].tsx`, `app/route/[id].tsx`,
  `app/(tabs)/favorites.tsx`; location → `apps/mobile/lib/useLocation.ts`
- Theme tokens → `packages/ui/src/themes.ts`, type scale → `packages/ui/src/typography.ts`,
  elevation/operator tokens → `packages/ui/src/tokens.ts` (spec: [`docs/09`](./09-theme.md))
- Design-system primitives → `apps/mobile/components/Text.tsx`, `Card.tsx`; theme resolver →
  `apps/mobile/lib/useTheme.ts`; fonts/splash → `apps/mobile/app/_layout.tsx`
- Prefs (theme/appearance/locale/**favorites**, Zustand+persist) → `apps/mobile/lib/preferences.ts`;
  Settings pickers → `apps/mobile/app/(tabs)/settings.tsx`; livery matrix + `LIVERIES` → `packages/ui/src/themes.ts`
- Decisions → [`docs/08`](./08-decision-log.md)
