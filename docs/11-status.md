# 11 — Status & Where to Continue

> **Living handoff doc — update it at the end of each working session.**
> Snapshot: **2026-06-09**. Branch: `karachi`. Latest: the **route schematic** + collapsing glass header
> (ADR-030); **favourite route-at-stop** design recorded as **ADR-032** (not yet built); a further
> **route-header refinement** is queued (see Next steps). The Design Workbench + app icon landed via PRs #5/#6.

## TL;DR
Scaffold, **Slice 1 (Nearby)**, the **design system** (fonts/type/elevation/themed nav + single **Ink**
theme, light/dark/auto), **Slice 2 (Stop · Route · Favorites · language picker)**, and **Citybus** are complete and
**verified end-to-end against live HK open data**. Nearby/stop/route are **multi-operator (KMB + CTB)**,
computed **server-side** from the hkbus consolidated static dataset ([ADR-021](./08-decision-log.md)); live
ETAs come direct from the official APIs. Co-located KMB+CTB stops are **merged into one same-kerb place**
([ADR-022](./08-decision-log.md)). Pick up at **own crawl → KV**, the **Routes tab**, or **map view**.

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
  save) · **Route detail** `/route/[id]` (**vertical schematic line-strip** with per-stop times + moving
  bus tokens — [ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)) · **Favorites** tab · **Settings** (language +
  appearance + livery pickers) · components `StopCard`, `EtaBadge`, `RouteChip`, `SaveButton`, `Card`,
  `Text`, `Skeleton`.
- **Verified:** `pnpm typecheck` 7/7 · live `/v1/nearby` · `/v1/stop` · `/v1/route` · `/v1/etas` return
  real data · **full Slice 2 flow walked in-browser** (Nearby→Stop→Route, save→Favourites, language re-localizes).
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
  (live ETAs, rider-duplicate routes collapsed, favourite toggle), Route detail (ordered stops), Favourites
  (Zustand store, reuses theme persistence), Settings language picker (persisted, live re-localization).
  Fixed an etabus **3-concurrent-fetch 403** quirk (route fetched solo, then the pair, + backoff retry).
- **Citybus — multi-operator** ([ADR-021](./08-decision-log.md)): static layer for **KMB + CTB** now built
  from the hkbus **consolidated dataset** (one 8 MB fetch, memoized) → `data-normalize/dataset.ts` +
  `edge/static-index.ts`; `nearby`/`stop`/`route` dispatch ETAs per operator. **Verified in-browser/curl**:
  Central nearby = 4 CTB + 2 KMB with live ETAs; CTB stop/route detail render (yellow Citybus chip); KMB intact.
- **Same-kerb stop-merge** ([ADR-022](./08-decision-log.md)): our own cross-operator clustering
  (`data-normalize/dataset.ts` → `buildPlaces`; 30 m + landmark-name match, ≤1 member/operator) groups a
  shared KMB+CTB kerb into one `Place`. Merged stops reuse the canonical `Stop` (`sources[]` spans both
  operators); place id is self-describing `P:<id>+<id>`. `nearby` collapses, `stop`/`etas` fan out per
  operator. **Verified:** Central's "Jardine House" now one merged card; merged stop detail shows CTB(yellow)
  + KMB(red) routes with live ETAs in-browser; the distinct 10.8 m-apart "Alexandra House"/"The Landmark"
  correctly stay separate; single-stop + Favorites unaffected.
- **Route schematic line-strip** ([ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)):
  `RouteDetail.stops[]` now carries a per-stop `eta`, filled from KMB **`route-eta`** (every stop in one
  upstream call → `fetchKmbRouteEta`); `/v1/route/:id` TTL dropped to 8 s. The route page is a **vertical
  schematic** — fixed glass header (lens back button + RouteChip title + origin→dest subtext), seq-in-node
  rail, up to 3 upcoming times per stop, **two-state bus tokens** (`inferBusMarkers` in `@nextbus/core`,
  drop-off detection), and **auto-scroll** to the opened-from stop. CTB stays static-only (no bulk
  route-eta). **Verified in-browser** against live route 1: 25/25 stops with ETAs, tokens on arriving
  stops, auto-scroll lands on the origin stop; typecheck 7/7, Biome clean.
- **Design Workbench + app icon** (branch `design-workbench`, uncommitted): a dev-facing
  **`/workbench`** route (`apps/mobile/app/workbench.tsx`) — a live gallery of the type scale, colour
  tokens, radius/elevation, and every component in each state, driven by the real theme store (the
  "mockup system" for revising components + the rules in `docs/09`). **App icon** finalized: a
  road-sign side-profile double-decker, white-on-ink, −8° lean, centred round wheels — master
  `apps/mobile/assets/icon.svg`, assets via `scripts/gen-icons.mjs`, wired in `app.json` (incl. iOS
  light/dark/tinted), `BRAND.ink` token added. Verified: icon rasterizes correctly, web export emits
  the favicon, `expo config` validates. Deferred (needs the name): 巴士 wordmark/splash lockup.
- **Lucide icons** ([ADR-025](./08-decision-log.md)): `lucide-react-native` (+ SDK-pinned `react-native-svg`)
  behind one **`<Icon icon tone>`** primitive (`apps/mobile/components/Icon.tsx`) — `tone` is a semantic
  role resolved via `useTheme().color()`, so icons follow the livery/appearance. In use: favourite **star**
  (`SaveButton`), **tab-bar icons** (MapPin/Route/Star/Settings), optional `Button` icon, stop-heading
  `ChevronRight`; Workbench has an ICONS gallery. **Verified in-browser** (icons re-theme on livery+mode switch).
- **Nearby is a flat list, not cards** ([ADR-026](./08-decision-log.md)): new **`StopRow`** replaces
  `StopCard` (deleted) — full-bleed, hairline dividers, heading = name + `MapPin` + "{distance} · {n} min
  walk" + chevron. Surfaces `NearbyStop.distanceM` (was unused) via new pure `@nextbus/core/geo` helpers
  (`formatDistance`/`walkMinutes`/`formatWalk`, distance rounded — ADR-008 honesty). Nearby sorts by
  distance; Favorites reuses `StopRow` (distance hidden). **Verified in-browser against live data.**
- **Floating tab bar** ([ADR-027](./08-decision-log.md)): the tab bar is now a `position:absolute`
  rounded **pill** (side + bottom margins, full border on dark / `e3` shadow on light) that **content
  scrolls underneath** — a new "layered & immersive" design principle (docs/09 §1). Geometry centralized
  in `apps/mobile/lib/tabBarLayout.ts` (`useTabBarLayout()` → safe-area `bottom` offset + `contentInset`);
  Nearby/Favorites/Settings pad their scroll content by it. Also fixed a label-descender clip (bar padding
  was shrinking the icon+label item). **Verified in mobile-emulation, light + dark.**
- **Liquid-glass material + Ink livery** ([ADR-028](./08-decision-log.md)): new **`GlassView`** primitive
  (`apps/mobile/components/GlassView.tsx`) — a translucent pane whose tint follows the appearance + active
  livery. On **web** it does **true SVG refraction**, **ported from nikdelvin/liquid-glass**
  (`apps/mobile/lib/liquidGlass.ts`): a smooth vector-SVG displacement map (gradients + blurred
  neutral-centre mask → soft rim, no pixelation) in a data-URI filter (3-pass chromatic aberration, `sRGB`)
  applied via `backdrop-filter: blur() url('…#displace') brightness() saturate()`. **Chromium-only**
  (Safari/Firefox → frosted `blur()`); **native** → `expo-blur`. Props: `depth`/`strength`/`blur`/`chroma`;
  `lens` = magnifier vs. subtle panel glass. Backs the **floating tab bar**; shown in the Workbench GLASS
  section. New **Ink** livery (`themes.ts` + `liveryInk`): ink-on-paper (light) / deep ink + indigo accent
  (dark). iOS-26 true Liquid Glass (`expo-glass-effect`) stays a deferred drop-in. **Verified in Chrome
  (Ink, light + dark):** bus chips scroll under the tab bar with a clean frosted transition (the earlier
  "white box"/pixelation is gone); lens magnifies the chips behind it.
- **Theming simplified to one Ink theme** ([ADR-029](./08-decision-log.md)): **retired the multi-livery
  axis** (Classic/KMB/Citybus/CMB/Dot-Matrix/Split-Flap). Now a single **Ink** theme in **light/dark/auto**
  (appearance only) — a monochrome "ink & paper" system: accent = ink on light, **paper on dark** (replaced
  the old indigo-on-deep-slate dark). `themes` is `Record<Mode, ThemeVars>`; `LiveryId`/`LIVERIES`/
  `DISPLAY_LIVERIES` removed; `preferences` drops `livery`; Settings/Workbench livery pickers + i18n
  `livery*`/`settingsTheme` removed; `global.css` resynced. **Verified in Chrome (light + dark).**
- **Docs:** plan `01–10`, ADRs `001–029`, `CLAUDE.md` / `AGENTS.md`, pre-commit docs-check skill + hook.

## 🚧 Not done yet / known limitations
- All data is **server-side** (no [on-device index](./08-decision-log.md), ADR-007). KMB + CTB only;
  other operators (NLB/GMB/MTR) are in the consolidated set but out of v1 scope.
- Same-kerb merge is **conservative** ([ADR-022](./08-decision-log.md)): stops whose landmark strings differ
  (e.g. KMB stop-code-only names) won't merge. Follow-up: token-overlap matching / own-crawl coordinates.
- ETA lists are de-duplicated **once, server-side** ([ADR-023](./08-decision-log.md)): `stopArrivals` (one
  upstream call per route+serviceType, then `dedupeEtas` → one rider line per route+direction) backs both
  `/v1/nearby` and `/v1/etas`. Fixed the "two A41, same time" double-count. Favorites' summary reuses the
  shared `dedupeEtas`; future: store the name in the Favorites store so it reads `/v1/etas` directly.
- **Stop-card navigation** ([ADR-024](./08-decision-log.md)): in `StopCard` the **stop name** → Stop detail
  and **each route row** → `/route/:id?stop=:stopId` are sibling tap targets (not nested). `/route/[id]`
  reads `?stop=` to show an **"arrivals here"** card (the route's next few arrivals at that stop) and
  highlights the current stop. **Verified in-browser**: route-row tap → route view with "Arriving / 9 / 17
  min" + ST141 highlighted; name tap → stop detail; no nested-`<button>` warning.
- **Simplified (zh-Hans) static names fall back to Traditional** (consolidated dataset has en + 繁 only);
  live ETA text still has all three. Backlog: true zh-Hans via own crawl.
- Static layer **depends on the hkbus gh-pages artifact** at runtime (no KV cache yet → their outage = stale once isolates recycle). Backlog: KV/R2 cache + own crawl.
- The **daily crawl cron is a stub**; no offline.
- The **Routes tab** is still a placeholder (no route search yet); stop/route detail are reached by tapping.
- Stop detail's ETA fan-out is **capped** (`MAX_ETA_ROUTES`) and refreshes via `refetchInterval` polling,
  not the `watch()` socket (v2). No map · no push · no native build has been run.
- `Skeleton` is static; the number-flip / split-flap ETA animation isn't built; **CJK uses the platform
  face by decision** (no Noto bundled — [ADR-019](./08-decision-log.md)); `font-display` (dot-matrix) face
  not added; display-livery character treatments (LED / flip-tile) are colour-only. (Lucide icons now
  shipped — [ADR-025](./08-decision-log.md).)

## ▶️ How to resume
1. Read [`CLAUDE.md`](../CLAUDE.md) → [`docs/README.md`](./README.md).
2. `pnpm install`, then `pnpm dev` (or `pnpm dev:edge` / `pnpm dev:web`). Verify per [`docs/10`](./10-scaffold-and-running.md).

## 🔜 Next steps (priority order)
0. **Favourite routes-at-a-stop** ([ADR-032](./08-decision-log.md#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes), *designed, not built*) —
   add a route-at-stop favourite primitive: a `favoriteRoutes` list in the prefs store (recommended key
   `"${stopId}|${routeId}"`), a glass-lens **star top-right** in the route header (favourites *this route at
   the `?stop=` you came from*) mirrored as a per-row star in Stop detail, and a Favourites-tab section
   grouping saved pairs under their stop heading (reuse `StopRow` with a filtered `etas`; fetch via
   `getEtas(stopId,[routeId])`). Bare-route favourites stay deferred.
0b. **Refine the route header further** (open design, not yet an ADR — supersedes part of the ADR-030 header):
   drop the glass **background behind the back button + header** (no header bar fill); the header content (the
   stop badge + the `A → B` route) should, on scroll, **resolve into a pill that sits to the right of the back
   button** (rather than shrinking-in-place centred as it does today in `RouteHeader.tsx`). Capture as an ADR
   once the behaviour is settled.
1. **Own crawl → KV/R2** (+ snapshot cache) — replace the runtime hkbus dependency; enables offline +
   resilience + true zh-Hans. Retires the cron stub. (ADR-021 backlog; `DATASET` binding already stubbed.)
2. **Routes tab** — route-number search → `/route/[id]` (the screen already exists).
3. **Map view** (MapLibre) for Nearby.
4. **Honest-motion slice** — number-flip / split-flap ETA animation, freshness pulse, shimmer skeleton,
   reduced-motion + a11y pass (Reanimated is installed/wired but unused), swipe-to-favourite + haptics.
5. **Departure-board mode** (ADR-026 follow-up) — an alternate Nearby view: one ETA-sorted stream of next
   departures across nearby stops; the natural home for the Split-Flap / Dot-Matrix display liveries.
6. **Looser stop-merge** (ADR-022 follow-up) — token-overlap name matching so landmark-only/code-only
   names also merge; ideally on the own-crawl's first-party coordinates.

## 📍 Key file pointers
- DataSource seam → `packages/core/src/datasource.ts`; EdgeClient → `packages/api-client/src/index.ts`
- Edge logic → `apps/edge/src/{nearby,stop-route,static-index}.ts` (`stop-route.ts` has `resolveMembers`/
  `toMergedStop` for `P:` place ids); multi-op index + same-kerb `buildPlaces` →
  `packages/data-normalize/src/dataset.ts` (KMB own-crawl in `kmb-static.ts`, for the future)
- Screens → `apps/mobile/app/(tabs)/index.tsx` (Nearby), `app/stop/[id].tsx`, `app/route/[id].tsx`,
  `app/(tabs)/favorites.tsx`; tab shell + floating bar → `app/(tabs)/_layout.tsx` (geometry in
  `apps/mobile/lib/tabBarLayout.ts`); location → `apps/mobile/lib/useLocation.ts`
- Theme tokens → `packages/ui/src/themes.ts`, type scale → `packages/ui/src/typography.ts`,
  elevation/operator tokens → `packages/ui/src/tokens.ts` (spec: [`docs/09`](./09-theme.md))
- Design-system primitives → `apps/mobile/components/Text.tsx`, `Card.tsx`, **`Icon.tsx`** (Lucide),
  **`GlassView.tsx`** (liquid-glass; web SVG refraction via `apps/mobile/lib/liquidGlass.ts`, ported from
  nikdelvin/liquid-glass),
  **`StopRow.tsx`** (flat nearby/favorites item); distance/walk helpers → `packages/core/src/geo.ts`;
  theme resolver → `apps/mobile/lib/useTheme.ts`; fonts/splash → `apps/mobile/app/_layout.tsx`
- Prefs (theme/appearance/locale/**favorites**, Zustand+persist) → `apps/mobile/lib/preferences.ts`;
  Settings (language + appearance) → `apps/mobile/app/(tabs)/settings.tsx`; Ink theme (`themes[mode]`) → `packages/ui/src/themes.ts`
- Decisions → [`docs/08`](./08-decision-log.md)
