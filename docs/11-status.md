# 11 — Status & Where to Continue

> **Living handoff doc — update it at the end of each working session.**
> Snapshot: **2026-06-02**. Branch: `hk-bus-arrival-app`. Last commit: Citybus (multi-operator static index).

## TL;DR
Scaffold, **Slice 1 (Nearby)**, the **design system** (fonts/type/elevation/themed nav + two-axis livery
picker), **Slice 2 (Stop · Route · Favorites · language picker)**, and **Citybus** are complete and
**verified end-to-end against live HK open data**. Nearby/stop/route are **multi-operator (KMB + CTB)**,
computed **server-side** from the hkbus consolidated static dataset ([ADR-021](./08-decision-log.md)); live
ETAs come direct from the official APIs. Pick up at **same-kerb stop-merge**, **own crawl → KV**, or the **Routes tab**.

## ✅ Done & verified
- **Monorepo:** pnpm + Turborepo + Biome; 8 packages; internal packages are source-only (no build step).
- **packages:** `core` (canonical types, `DataSource` seam, honest-ETA helpers) · `data-normalize`
  (KMB + Citybus ETA adapters · **multi-operator static index** from the consolidated dataset `dataset.ts` ·
  KMB bulk crawl `kmb-static.ts` kept for the future own-crawl) · `api-client` (`EdgeClient` + `watch()`
  shim) · `i18n` (en / 繁 / 简 + `resolveLocale`) · `ui` (NativeWind preset + livery×mode themes + tokens) · `tsconfig`.
- **apps/edge:** `/v1/nearby`, **`/v1/stop/:id`**, **`/v1/route/:id`**, **`/v1/etas/:id`** (canonical),
  and the low-level `/v1/eta/:co/:stop/:route` — **multi-operator (KMB + CTB)** off one **shared memoized
  index** (`static-index.ts`, built from the consolidated dataset) + bounded ETA fetch + edge cache;
  daily-crawl cron is a **stub**.
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
- **Citybus — multi-operator** ([ADR-021](./08-decision-log.md)): static layer for **KMB + CTB** now built
  from the hkbus **consolidated dataset** (one 8 MB fetch, memoized) → `data-normalize/dataset.ts` +
  `edge/static-index.ts`; `nearby`/`stop`/`route` dispatch ETAs per operator. **Verified in-browser/curl**:
  Central nearby = 4 CTB + 2 KMB with live ETAs; CTB stop/route detail render (yellow Citybus chip); KMB intact.
- **Docs:** plan `01–10`, ADRs `001–021`, `CLAUDE.md` / `AGENTS.md`, pre-commit docs-check skill + hook.

## 🚧 Not done yet / known limitations
- All data is **server-side** (no [on-device index](./08-decision-log.md), ADR-007). KMB + CTB only;
  other operators (NLB/GMB/MTR) are in the consolidated set but out of v1 scope.
- **No same-kerb stop-merge yet** — a shared KMB+CTB kerb shows as two nearby entries ([ADR-021](./08-decision-log.md) / backlog).
- **Simplified (zh-Hans) static names fall back to Traditional** (consolidated dataset has en + 繁 only);
  live ETA text still has all three. Backlog: true zh-Hans via own crawl.
- Static layer **depends on the hkbus gh-pages artifact** at runtime (no KV cache yet → their outage = stale once isolates recycle). Backlog: KV/R2 cache + own crawl.
- The **daily crawl cron is a stub**; no offline.
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
1. **Same-kerb stop-merge (`Place`)** — cluster co-located KMB/CTB stops (~25–40 m + name) so a shared kerb
   shows once with both operators' routes (own clustering; the dataset's `stopMap` over-clusters — ADR-021).
2. **Own crawl → KV/R2** (+ snapshot cache) — replace the runtime hkbus dependency; enables offline +
   resilience + true zh-Hans. Retires the cron stub. (ADR-021 backlog; `DATASET` binding already stubbed.)
3. **Routes tab** — route-number search → `/route/[id]` (the screen already exists).
4. **Map view** (MapLibre) for Nearby.
5. **Polish** — number-flip / split-flap ETA animation, freshness pulse, shimmer skeleton,
   reduced-motion + a11y pass, Lucide icons (incl. a real favorite star), swipe-to-favorite + haptics.

## 📍 Key file pointers
- DataSource seam → `packages/core/src/datasource.ts`; EdgeClient → `packages/api-client/src/index.ts`
- Edge logic → `apps/edge/src/{nearby,stop-route,static-index}.ts`; multi-op index →
  `packages/data-normalize/src/dataset.ts` (KMB own-crawl in `kmb-static.ts`, for the future)
- Screens → `apps/mobile/app/(tabs)/index.tsx` (Nearby), `app/stop/[id].tsx`, `app/route/[id].tsx`,
  `app/(tabs)/favorites.tsx`; location → `apps/mobile/lib/useLocation.ts`
- Theme tokens → `packages/ui/src/themes.ts`, type scale → `packages/ui/src/typography.ts`,
  elevation/operator tokens → `packages/ui/src/tokens.ts` (spec: [`docs/09`](./09-theme.md))
- Design-system primitives → `apps/mobile/components/Text.tsx`, `Card.tsx`; theme resolver →
  `apps/mobile/lib/useTheme.ts`; fonts/splash → `apps/mobile/app/_layout.tsx`
- Prefs (theme/appearance/locale/**favorites**, Zustand+persist) → `apps/mobile/lib/preferences.ts`;
  Settings pickers → `apps/mobile/app/(tabs)/settings.tsx`; livery matrix + `LIVERIES` → `packages/ui/src/themes.ts`
- Decisions → [`docs/08`](./08-decision-log.md)
