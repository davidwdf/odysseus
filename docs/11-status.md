# 11 — Status & Where to Continue

> **Living handoff doc — update it at the end of each working session.**
> Snapshot: **2026-06-02**. Branch: `hk-bus-arrival-app`. Last commit: scaffold + Slice 1.

## TL;DR
Scaffold **and Slice 1 (Nearby)** are complete and **verified end-to-end against live HK open data**.
KMB only; nearby is computed **server-side** for now. The **design system is now realized** in the
app (fonts, type primitive, elevation, themed nav — [ADR-017](./08-decision-log.md)). Pick up at
**Slice 2 (Stop detail + Favorites)**.

## ✅ Done & verified
- **Monorepo:** pnpm + Turborepo + Biome; 8 packages; internal packages are source-only (no build step).
- **packages:** `core` (canonical types, `DataSource` seam, honest-ETA helpers) · `data-normalize`
  (KMB + Citybus ETA adapters, **KMB static index** via bulk endpoints + haversine) · `api-client`
  (`EdgeClient` + `watch()` polling shim) · `i18n` (en / 繁 / 简 + `resolveLocale`) · `ui`
  (NativeWind preset + `themes.ts` light/dark + liveries + tokens) · `tsconfig`.
- **apps/edge:** `/v1/eta/:co/:stop/:route[/:serviceType]` and `/v1/nearby?lat&lng[&radius]` (KMB,
  memoized index + bounded ETA fetch + edge cache); daily-crawl cron is a **stub**.
- **apps/mobile:** tabs shell (Nearby/Routes/Favorites/Settings) · `QueryProvider` · `LocaleProvider`
  (device-locale detection, override hook) · **Nearby screen live** with contextual location priming
  + Settings deep-link on permanent denial · components `StopCard`, `EtaBadge`, `Button`, `Skeleton`.
- **Verified:** `pnpm typecheck` 7/7 · worker bundles (`wrangler deploy --dry-run`) · `expo config`
  loads · live `/v1/nearby` returns real stops + ETAs.
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
- **Docs:** plan `01–10`, ADRs `001–019`, `CLAUDE.md` / `AGENTS.md`, pre-commit docs-check skill + hook.

## 🚧 Not done yet / known limitations
- Nearby is **server-side & KMB-only** ([ADR-016](./08-decision-log.md)). Citybus nearby and the
  **on-device index** ([ADR-007](./08-decision-log.md)) are pending.
- The **daily crawl is a stub** — no canonical static dataset in KV/R2 yet (no offline).
- Only **Nearby** is real; Routes / Favorites / Settings are placeholder screens.
- `EdgeClient.getRoute` / `getStop` exist, but the worker has **no `/v1/route` or `/v1/stop`** yet.
  Also reconcile `EdgeClient.getEtas` (canonical stopId) vs the worker's `:co/:stop/:route` form.
- No favorites/persistence · no map · no Settings **language** picker yet (the theme/livery picker is
  done) · no push · no native build has been run. `Skeleton` is static; the number-flip / split-flap
  ETA animation isn't built; **CJK uses the platform face by decision** (no Noto bundled — [ADR-019](./08-decision-log.md),
  for bundle-size + rare-HK-glyph coverage); `font-display` (dot-matrix) face not added; the display-livery character
  treatments (LED / flip-tile) are colour-only so far. Lucide tab icons pending.

## ▶️ How to resume
1. Read [`CLAUDE.md`](../CLAUDE.md) → [`docs/README.md`](./README.md).
2. `pnpm install`, then `pnpm dev` (or `pnpm dev:edge` / `pnpm dev:web`). Verify per [`docs/10`](./10-scaffold-and-running.md).

## 🔜 Next steps (priority order)
1. **Slice 2 — Stop detail + Favorites**
   - *Worker:* add `/v1/stop/:id` (+ `/v1/route/:id`) returning `StopDetail` / `RouteDetail` — reuse
     the memoized KMB index (`apps/edge/src/nearby.ts`); pull route origin/dest from KMB bulk `route`.
   - *App:* Stop-detail screen (tap a `StopCard` → `/stop/[id]`); **Favorites** with persistence
     (MMKV or `@react-native-async-storage/async-storage`) + the Favorites tab.
   - *Settings:* language picker using the existing `useSetLocale` (persist it); livery/theme picker.
   - Resolve the canonical-stopId vs `:co/:stop/:route` mismatch noted above.
2. **Citybus in nearby** — CTB stop crawl (per-route; no bulk stop endpoint) + stop-merge (`Place`) for
   co-located KMB/CTB stops, then include CTB in `/v1/nearby`.
3. **Daily crawl → KV/R2 + on-device index** — implement the `scheduled` crawl writing a versioned
   dataset; move nearby on-device (ADR-007); enables offline. Retires the stub.
4. **Map view** (MapLibre) for Nearby.
5. **Polish** — number-flip / split-flap ETA animation, freshness pulse, shimmer skeleton,
   reduced-motion + a11y pass, Lucide tab icons.

## 📍 Key file pointers
- DataSource seam → `packages/core/src/datasource.ts`
- Nearby logic → `apps/edge/src/nearby.ts`, `packages/data-normalize/src/kmb-static.ts`
- Nearby screen / location → `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/lib/useLocation.ts`
- Theme tokens → `packages/ui/src/themes.ts`, type scale → `packages/ui/src/typography.ts`,
  elevation/operator tokens → `packages/ui/src/tokens.ts` (spec: [`docs/09`](./09-theme.md))
- Design-system primitives → `apps/mobile/components/Text.tsx`, `Card.tsx`; theme resolver →
  `apps/mobile/lib/useTheme.ts`; fonts/splash → `apps/mobile/app/_layout.tsx`
- Theme/appearance prefs (Zustand+persist) → `apps/mobile/lib/preferences.ts`; picker UI →
  `apps/mobile/app/(tabs)/settings.tsx`; livery matrix + `LIVERIES` → `packages/ui/src/themes.ts`
- Decisions → [`docs/08`](./08-decision-log.md)
