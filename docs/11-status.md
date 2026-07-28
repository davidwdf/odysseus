# 11 — Status & Where to Continue

> **Living handoff doc — update it at the end of each working session.**
> Snapshot: **2026-07-28**. Wave 0 (PRs #11–#13) is on `main`; **Wave 1 is complete and in review as PR #14**.
> Latest: **Wave 1 — the contract foundation, WP1-1 … WP1-5**
> ([ADR-051](./08-decision-log.md#adr-051--layered-package-boundaries-packagesports-is-declaration-only-and-imports-nothing) ·
> [ADR-052](./08-decision-log.md#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe) ·
> ADR-059 · ADR-060). `packages/contract` is the single declaration of every wire shape and `packages/core`'s
> types are `z.infer` of it through **`import type` only**, so zod never reaches the client's runtime graph;
> `packages/ports` is the porting checklist; the id grammar has one parser and an **empty** ad-hoc-parsing
> allowlist; `layers.json` generates both boundary configs; and a **331-case corpus at 100% branch coverage**
> pins the domain rules that no schema can generate. **Every gate was watched failing on an injected
> violation.** Two shipped bugs fell out of it — a bus could vanish from the route view, and `formatClock` read
> the device timezone. Next: **Wave 2**; WP0-5/deploy is deferred on purpose (see *Next steps*).
> Four things changed, all of them load-bearing for launch. **(1) The dataset left the request path**
> ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)): a daily GitHub Action precomputes content-addressed shards into KV + R2 and the
> Worker reads a handful of point keys — cold `/v1/nearby` went **3.97 s → 0.74 s**. `static-index.ts` and the Worker
> cron are **deleted**. **(2) The basemap is the HK Lands Department's** ([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)),
> proxied and self-cached by our own Worker behind a `TileSource` seam — **no OSM tile anywhere in the app**.
> **(3) The PWA works offline** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)): a Workbox service worker + a persisted TanStack
> Query cache, with live ETAs network-first (never cache-first — ADR-008). **(4) Live ETAs are coalesced per pole**
> on a 30 s TTL ([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole)), so one pole is fetched once per isolate per window however many
> riders ask. Also: `apps/edge` now has a **vitest suite that runs inside workerd** (18 tests; `apps/mobile` 17;
> root `pnpm test` runs both).
> ⚠️ **WP0-5 — deploy + CI + custom domain — is NOT done.** It needs a real domain and a Cloudflare account, and
> **there is no Cloudflare auth in this environment**: the KV namespace id in `wrangler.toml` is a placeholder and
> the publish pipeline has **never run against real remote KV/R2** (only Miniflare-local, verified end-to-end).
> It is the only thing between here and a live URL, but it is **deliberately not the next job** — owner's call,
> 2026-07-27: we launch after most of the other waves land. The nightly publish is disarmed until then
> ([ADR-061](./08-decision-log.md#adr-061--environments-and-configuration-topology-local--production-ephemeral-previews-and-no-staging-tier)).
> Earlier: **Green Minibus (GMB) — third operator**
> ([ADR-047](./08-decision-log.md#adr-047--green-minibus-gmb-a-third-operator-keyed-on-gtfsid-with-per-arrival-livescheduled-honesty)).
> GMB is now a v1 operator. Static geometry/fares/frequency come free from the consolidated dataset (one line in
> `CO_TO_OPERATOR`); a new `packages/data-normalize/src/gmb.ts` adapter fetches the live **stop board**
> (`data.etagmb.gov.hk/eta/stop/{id}`, one call per pole like KMB). GMB numbers repeat across regions, so routes are
> keyed on the globally-unique `gtfsId` (canonical `GMB:{no}:{bound}:{gtfsId}`); the edge resolves the live board's
> numeric `route_id`+`route_seq` back via a `gmbCanonicalByLive` map. Live-vs-**Scheduled** honesty rides the existing
> remark path (no new `Eta` flag). UI is data-driven — a green accent + `OPERATOR_LABEL` entry were the only UI edits;
> chips/Nearby/fare+frequency sheets lit up automatically. **Verified end-to-end on the edge** (etas, nearby, index);
> the app UI (`pnpm dev:web`) still wants an eyeball. **Gotcha for next time:** the GMB host 403s an empty
> `User-Agent` (Workers-runtime default) — the adapter sends one. Follow-ups in [docs/07](./07-backlog.md): friendlier
> "Minibus" label, a region tag in search, GMB route-level live ETAs (static-only today), GMB stop-merge edge cases.
> Earlier: **Route-detail direction toggle**
> ([ADR-046](./08-decision-log.md#adr-046--route-detail-direction-toggle-server-resolved-reverse-an-in-card-fromto-header-and-a-circular-route-treatment)) —
> a server-resolved `RouteDetail.reverse` (edge picks the opposite bound + service-type variant; absent for circular /
> one-way routes) drives an **in-card from/to header** whose reverse toggle flips direction *in place* (local state +
> `keepPreviousData` + prefetch → no skeleton), with a `GitCompareArrows` glyph, a lyrics-style name swap, a staggered
> list cascade, and bus tokens that slide down from the first stop. **Circular routes** (flagged `(CIRCULAR)` in the
> destination name) show a loop glyph + "Circular via <turnaround>" and no toggle. Verified on web (KMB 1 + KMB 10).
> Earlier: **Core navigation-animation system**
> ([ADR-043](./08-decision-log.md#adr-043--a-core-navigation-animation-system-cross-fade-tabs-slide-and-reveal-stack-web-swipe-back)) —
> rules centralised in **`lib/navTransitions.ts`** (+ the two `_layout`s), reduced-motion aware. **On web:** tab↔tab
> **cross-fade** (flash fixed by painting the theme bg on the tabs wrapper + `sceneStyle`) and a left-edge
> **swipe-back** gesture (`components/WebSwipeBack`). The **slide-in / reveal-on-back is native-only** (an instant cut
> on web for now): a JS stack *did* animate it on web but **broke `Animated.ScrollView` scrolling** inside its cards,
> so it was **tried and reverted** — we're back on the native `<Stack>` (scrolling/chrome/overlays solid). A
> `usePageRevealReady()` hook is wired for the route page's **two-step reveal** (mechanism only). **Known gaps
> (pre-existing / separate):** the route auto-scroll doesn't land on web, and `components/BottomSheet`'s slide-up
> entrance doesn't complete on web — both [docs/07](./07-backlog.md). Earlier: **Stop-detail enrichment**
> ([ADR-041](./08-decision-log.md#adr-041--stop-detail-a-collapsing-header-shared-with-route-a-keyless-static-mini-map-and-an-enriched-summary)) —
> the route header was generalised into a shared **`CollapsingHeader`** so Stop detail now collapses its name into the
> glass pill exactly like Route; a **keyless static `MiniMap`** (standard **OSM** raster tiles laid down as `<Image>`s
> — *the OSM tiles have since been replaced by LandsD, WP0-2/ADR-049; everything else here still stands* —
> **dark mode derived via a CSS `filter`** on the same tiles, white-haloed pin, no map lib/key, tap → platform maps)
> sits at the top; and a **"served by · N routes · distance"** summary + per-row **boarding fares** enrich it.
> *A deliberate first pass — to iterate (interactive MapLibre map, the route-at-stop star).*
> Earlier: **Route-detail design pass**
> (ADR-036 refinement) — the static service facts are now a wrapping **pill** row (fare framed **high → low**,
> frequency, service hours, stop count; **whole-route journey time hidden** — data kept); range dashes spaced
> ("10 – 25", "05:35 – 23:40"); per-stop **fare aligned to the name's top line**, with the **stop code inline**
> at the end of the name (wraps rather than overlapping the fare); `EtaTimes` shows the unit **per slot**
> ("4 min 20 min 32 min"); the **origin
> bus token** only appears ≤2 min before departure; and the consolidated-dataset fetch is repointed to its
> canonical host `https://data.hkbus.app/` (old gh-pages path now 301-redirects). Earlier: **Search is live**
> (**ADR-037**). The
> empty *Routes* tab is gone; search is now its **own page** (`app/search.tsx`, no tab bar) **pushed from a
> glass search button that shares the tab bar's row at the far right** (the bar fills the space to its left) —
> bottom tabs are now Nearby / Favourites / Settings. The route-header back lens is now a shared
> **`GlassIconButton`** (`BackButton`), reused by the search launcher and search's back button.
> A new edge **`/v1/index`** ships a compact route+stop index; the app caches it stale-while-revalidate (the
> first **on-device index**, ADR-007) and queries it locally. *(Since WP0-1 the index is read straight out of
> R2 — `builds/<hash>/search-index.json` — and the service worker gives it a second stale-while-revalidate
> layer, so search paints instantly and works offline.)* Header = back button left of a Routes/Stops
> segment (icon per item): a **smart keypad** (prefix-trie → only valid next keys lit, dead keys dimmed;
> letters in a compact scroll row above the pad) for route numbers, a
> text field for stop/place names (matches any locale), **extensible filter chips** (operator chips
> data-driven from the index so GMB/MTR light up automatically when added; Night/Airport/Express predicates),
> and recents. Earlier: **Fares · frequency · journey time · remarks** (**ADR-036**, proposals P1–P3) — we
> parse the `fares`/`faresHoliday`/`freq`/`jt` the consolidated dataset already gave us (and the `rmk_*` we
> already fetched) and surface them across Nearby/Stop/Route.
> A research dive + proposals also landed in [`docs/research`](./research/README.md) + [`docs/proposals`](./proposals/README.md).
> Earlier: **Nearby polish** (**ADR-034**) —
> route rows now show **`[chip] → destination`** (server-stamped `Eta.destination`), and a single shared
> **`StopName`** title-cases stop names + splits the muted operator code **everywhere** (Nearby, Favourites,
> route schematic, Stop-detail header). Earlier: **route-header refinement** built
> (**ADR-033** — no bar background; title morphs into a pill beside the back lens; frosted-not-lens glass over
> scrolling content). **Favourite route-at-stop** design recorded as **ADR-032** (not yet built).

## TL;DR
Scaffold, **Slice 1 (Nearby)**, the **design system** (fonts/type/elevation/themed nav + single **Ink**
theme, light/dark/auto), **Slice 2 (Stop · Route · Favorites · language picker)**, and **Citybus** are complete and
**verified end-to-end against live HK open data**. Nearby/stop/route are **multi-operator (KMB + CTB + GMB)**,
served **server-side** from **precomputed KV/R2 shards** built daily outside the Worker
([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path); the shards are still derived from the hkbus consolidated dataset — an own crawl
of the operator APIs remains backlog); live ETAs come direct from the official APIs, coalesced per pole
([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole)). Co-located stops are **merged into one same-kerb place**
([ADR-022](./08-decision-log.md) → [ADR-042](./08-decision-log.md)). The web build is an **installable PWA that
opens offline** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)) on a **LandsD basemap**
([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)).
Pick up at **Wave 1 of [`proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md) — the contract
foundation**. **WP0-5 (deploy + CI + custom domain) is deliberately deferred** — owner's call, 2026-07-27:
we come back to it once most of the other waves have landed, so do **not** treat it as the next job even
though it is the only thing between here and a live URL. After Wave 1: Wave 2, **map view**, or **Search
polish** (walk it in-browser; Nearby filter chips; omnibox).

## ✅ Done & verified
- **Monorepo:** pnpm + Turborepo + Biome; 8 packages; internal packages are source-only (no build step).
- **packages:** `core` (canonical types, `DataSource` seam, honest-ETA helpers) · `data-normalize`
  (KMB + Citybus ETA adapters · **multi-operator static index** from the consolidated dataset `dataset.ts` ·
  KMB bulk crawl `kmb-static.ts` kept for the future own-crawl) · `api-client` (`EdgeClient` + `watch()`
  shim) · `i18n` (en / 繁 / 简 + `resolveLocale`) · `ui` (NativeWind preset + livery×mode themes + tokens) · `tsconfig`.
- **apps/edge:** `/v1/nearby`, **`/v1/stop/:id`**, **`/v1/route/:id`**, **`/v1/etas/:id`** (canonical),
  `/v1/index`, **`/v1/health`**, **`/v1/tiles/…`**, and the low-level `/v1/eta/:co/:stop/:route` —
  **multi-operator (KMB + CTB + GMB)** read through the **`DatasetSource` seam** (`dataset.ts`: precomputed
  KV/R2 shards in production, an in-isolate build as the dev fallback) + per-pole coalesced ETA fetch +
  edge cache. **No `scheduled` handler and no cron** — the daily build is a GitHub Action (ADR-055).
- **apps/mobile:** tabs shell · `QueryProvider` (**`PersistQueryClientProvider`** + AsyncStorage
  persister — ADR-058) · `LocaleProvider` (device detection + **persisted**
  override) · **Nearby** (live, tappable cards) · **Stop detail** `/stop/[id]` (**collapsing header + keyless static
  mini-map + served-by/route-count/distance summary**, live ETAs with boarding fares, route dedup, flat route rows —
  [ADR-041](./08-decision-log.md#adr-041--stop-detail-a-collapsing-header-shared-with-route-a-keyless-static-mini-map-and-an-enriched-summary)) ·
  **Route detail** `/route/[id]` (**vertical schematic line-strip** with per-stop times + moving
  bus tokens — [ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)) · **Favorites** tab · **Settings** (language +
  appearance + livery pickers) · components `CollapsingHeader` (shared by `RouteHeader`/`StopHeader`), `MiniMap`,
  `StopCard`, `EtaBadge`, `RouteChip`, `Fare`, `Card`, `Text`, `Skeleton`. *(The stop-level `SaveButton` was removed —
  favourites move to route-at-stop, [ADR-032](./08-decision-log.md#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes).)*
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
  from the hkbus **consolidated dataset** → `data-normalize/dataset.ts` (originally memoized in-Worker via
  `edge/static-index.ts`; **since WP0-1 that file is deleted** and the derivations are precomputed into KV/R2
  shards by `data-normalize/shards.ts`); `nearby`/`stop`/`route` dispatch ETAs per operator. **Verified in-browser/curl**:
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
  upstream call → `fetchKmbRouteEta`); `/v1/route/:id` moved onto the short live-ETA TTL (8 s then, **30 s
  since ADR-057** — at 8 s the cache hit rate was ~0% because upstream only refreshes ~1/min). The route page is a **vertical
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
  role resolved via `useTheme().color()`, so icons follow the livery/appearance. In use: **tab-bar icons**
  (MapPin/Route/Star/Settings), optional `Button` icon, stop-heading
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
- **Route header refinement** ([ADR-033](./08-decision-log.md#adr-033--route-header-no-bar-background-title-morphs-into-a-pill-beside-the-back-lens)):
  `RouteHeader` dropped its full-width glass bar — the chrome now floats over scrolling content. A big
  **centred badge over `A → B`** at the top **morphs** on scroll into a **glass pill beside the back lens**
  (single travelling/scaling badge; the route label cross-fades centred-below → inline; pill glass fades in).
  Back lens + pill use a **frosted, zero-chroma** glass (not the `lens` magnifier) so high-contrast stop text
  scrolling underneath doesn't refract into rainbow fringing. Also fixed a **backdrop-filter isolation** bug —
  the pill's fade opacity had to move off a wrapper onto the `GlassView` root (now an `Animated.View`), or an
  opacity-<1 ancestor isolated the blur and it flickered on/off during scroll. **Verified in-browser**
  (expanded, mid-morph, collapsed at phone width; DOM-confirmed blur present across the fade); typecheck 7/7,
  Biome clean.
- **Fares · frequency · journey time · remarks** ([ADR-036](./08-decision-log.md), proposals P1–P3): the
  consolidated dataset's `fares`/`faresHoliday`/`freq`/`jt` are now parsed (`data-normalize/dataset.ts` →
  `RouteServiceInfo` + sectional `routeFareAtSeq`) and threaded through `/v1/nearby` · `/v1/stop` · `/v1/route`
  (boarding fare per stop, route full-fare/journey/frequency/hours). New `Fare`/`RemarkTag`/`RouteMeta`
  primitives; the parsed-but-unshown `Eta.remark` now renders (`classifyRemark` tints "Scheduled" as
  lower-confidence); Stop detail shows "every N–M min" for no-ETA routes. **Verified against the live worker**
  (route 1 → fare $6.7, ~45 min, every 10–30 min, 05:35–23:40; Nearby/Stop boarding fares); typecheck 7/7, Biome clean.
- **Research + proposals docs** (2026-06-10): a deep dive into all HK bus open data, our feature inventory/gaps,
  competitive analysis, and data-display ideas in [`docs/research`](./research/README.md); fast-win + bigger-bet
  proposals in [`docs/proposals`](./proposals/README.md). Key facts: no live GPS / no GTFS-RT / no route polylines in HK open data.
- **Search — its own page** ([ADR-037](./08-decision-log.md#adr-037--search-on-device-index-a-smart-route-keypad-and-extensible-filter-chips)):
  edge **`/v1/index`** (`apps/edge/src/search-index.ts`) ships a compact `SearchIndex` (2002 routes collapsed to
  one per operator+number+direction, 8126 stops with 1179 same-kerb places pre-merged, ~2 MB) off the shared
  memoized static index. New `DataSource.getSearchIndex()` (`EdgeClient`); the app caches it in AsyncStorage
  stale-while-revalidate (`apps/mobile/lib/searchIndex.ts`) — the first **on-device index** (ADR-007). Pure
  search/keypad logic in **`@nextbus/core/search`** (`buildRouteTrie`/`nextValidChars`/`searchRoutes`/
  `searchStops`/`routeCategories`). UI: a standalone **`app/search.tsx`** (no tab bar) pushed from a **floating
  search button** in `app/(tabs)/_layout.tsx` (Routes tab removed → tabs are Nearby/Favourites/Settings);
  header = back button + Routes/Stops segment; **`RouteKeypad`** (trie-driven valid-next-key lighting; letters
  in a scroll row above the pad), stop text search (any-locale), **`FilterChips`** (operator chips data-driven
  from the index; Night/Airport/Express predicates), recents (`preferences`). **Verified:** live `/v1/index`
  returns 2002/8126; keypad/category logic checked against real numbers (79 night, 93 airport, 137 express;
  `next("")`=digits+start-letters, `next("26")`=`0,1,3,4,5,7,8,9,M,X`). typecheck 7/7, Biome clean.
  *Not yet walked in-browser (visual pass pending).*
- **About section: "About the data" + "FAQ"** ([ADR-038](./08-decision-log.md#adr-038--about-the-data-screen-open-data-attribution--honesty-notes), proposals P10):
  two new no-tab-bar screens (shared `BackButton` glass lens), reached from an **About** section in Settings.
  **`app/about-data.tsx`** — **full-width rows (not cards)**: a **Sources** group of tappable **link rows**
  (DATA.GOV.HK / KMB·LWB / Citybus) that open the source in a **new tab** (`lib/openExternal.ts`) with an
  external-link icon, a **Licence** link row to the locale-aware **data.gov.hk terms**, and the app **version**
  (`expo-constants`) — satisfying the launch-blocking attribution requirement. **`app/faq.tsx`** — an
  **accordion** (collapsed by default, no dividers; tap to expand) owning the **freshness/honesty notes** plus a
  broader rider set: operator coverage, same-kerb merges, offline, no-live-map (no HK GPS/polylines), and what
  "Scheduled"/"Last bus" remarks mean. Trilingual strings in `@nextbus/i18n`. typecheck 7/7, Biome clean.
  *(The **offline** answer — `faqOfflineA` — predates ADR-058 and now **understates** what the app does: the
  shell opens offline and the last-seen arrivals replay, labelled stale. Refresh the three locale strings.)*
  **Verified in-browser** (all three screens render; FAQ expand/collapse works; Settings → both rows).
- **Precompute → KV/R2: the dataset leaves the request path** ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path), WP0-1):
  the Worker no longer builds the 8.3 MB index in-request. A **daily GitHub Action**
  (`.github/workflows/dataset.yml` → `apps/edge/scripts/build-dataset.mts` + `publish-dataset.mts`) does the
  fetch, the normalization and the ADR-042 clustering, then writes **content-addressed** shards — KV
  `place:<hash>:<id>` · `alias:<hash>:<stopId>` · `route:<hash>:<id>` · `geo:<hash>:<cell>`, R2
  `builds/<hash>/search-index.json` + `manifest.json` — and flips the single mutable **`build:current`** key
  **last**, so a half-written crawl is unreachable and a rollback is one key write. Every endpoint reads
  through the new **`DatasetSource`** seam (`apps/edge/src/dataset.ts`), which has a KV implementation and an
  in-isolate fallback so `pnpm dev:edge` still needs no remote state. Shard shapes are pure functions of a
  `StaticIndex` in **`packages/data-normalize/src/shards.ts`**, so the publisher and the fallback agree by
  construction. **`GET /v1/health`** returns `{ok, dataset:'kv'|'inline', buildHash, datasetBuildsThisIsolate}`
  — that counter must be **0** in production, and `apps/edge/test/dataset-kv.test.ts` sweeps every endpoint
  against a seeded build and asserts it. **Measured:** cold `/v1/nearby` **3.97 s → 0.74 s**, warm **6 ms**;
  the build emits **10,118 places · 6,351 aliases · 3,653 routes · 486 cells** (14,072 stops), ≈**20.6k KV
  keys**. **Wire change worth knowing:** `/v1/stop/:id` returns route `service` **without `patterns`**
  (summary tier — `fareFull`/`journeyMin`/`headway`/`hours`); `/v1/route/:id` keeps the full per-day-type
  profiles. Duplicating `patterns` into every place a route touches was **54 MB of an 82 MB build** and
  nothing on the Place screen reads it. **Deleted:** `apps/edge/src/static-index.ts`, the Worker `scheduled`
  handler, and `[triggers] crons`. **New:** `apps/edge/src/{dataset,env,tiles,eta-cache}.ts` + `bindings.d.ts`.
  **Not done:** the shards are still derived from the hkbus consolidated dataset (own crawl = backlog); the KV
  namespace id in `wrangler.toml` is a **placeholder**; the pipeline has **only ever run against
  Miniflare-local KV/R2** (verified end-to-end there), never real remote resources — no Cloudflare auth here.
- **Basemap → HK Lands Department** ([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay), WP0-2 — the decision was recorded 2026-07-26 and is **now implemented**):
  `components/MiniMap.tsx` names **no tile host**. It goes through **`apps/mobile/lib/tileSource.ts`** (a
  `TileSource` interface + `landsdTileSource`) to our own Worker routes **`/v1/tiles/basemap/:z/:x/:y.png`**
  and **`/v1/tiles/label/:lang/:z/:x/:y.png`** (`apps/edge/src/tiles.ts`, 12 h TTL, deliberately overriding
  LandsD's `cache-control: private` so a shared cache can actually work — caching is expressly permitted by
  the CSDI licence). Two raster layers stack: a **language-free basemap** plus a **label overlay chosen by
  `useLocale()`**, so switching language relabels the map with no restyling. Attribution obligations are
  satisfied — a self-hosted `apps/mobile/assets/landsd-logo.png` on the map face plus a **linked** "Map from
  Lands Department" notice (the mistake the old plain-text OSM credit made). The two pre-migration fixes the
  backlog asked for are **moot**: the OSM credit is gone and there is no `TILE_URL`. Dark mode still uses the
  CSS invert filter (`TileSource.invertForDark`) — LandsD's raster service has no dark variant.
  **Verified in the running app** on a multi-pole Mong Kok place.
- **Service worker + offline PWA** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier), WP0-3): new
  `apps/mobile/workbox.config.mjs` + `apps/mobile/scripts/build-web.mjs`, run as
  **`pnpm --filter @nextbus/mobile build:web`** (`expo export -p web` then `generateSW` over the output — one
  command, because a precache manifest generated against a different build is worse than none).
  `lib/serviceWorker.ts` registers `/sw.js` on **production web only** — never in dev, where a stale worker
  intercepting Metro is a genuinely nasty bug. Strategies: **precache** the hashed app shell (**59 files,
  ~10.6 MB**); **`/v1/index`** stale-while-revalidate; **live ETA endpoints network-first with a 4 s timeout**
  (never cache-first — a bus that left four minutes ago is worse than no answer, ADR-008); **tiles**
  cache-first and **never prefetched**. `providers/QueryProvider.tsx` is now a **`PersistQueryClientProvider`**
  over an AsyncStorage persister (24 h, **successes only**). New **`lib/geoSnap.ts`** (`snapFix`, **25 m**
  grid) — this is **WP2-6 landed early**, because the offline acceptance needs a stable query key; Wave 2 still
  has to move it into `packages/core`. `lib/useLocation.ts` remembers the last fix and returns `stale: true`
  when it uses it; Nearby then shows the new `lastKnownLocation` string instead of the app name.
  **Verified:** with **both** the static server and the edge Worker killed, a cold load of `/search` opened
  the app and searched from cache, and `/v1/nearby` was replayed from the SW cache **with its original
  `observedAt` intact**. **Not verified:** the Nearby *screen* offline — Chrome's geolocation in this
  environment resolves outside Hong Kong, so the **data path** was verified instead of the screen.
- **Per-pole ETA coalescer + 30 s TTL** ([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole), WP0-4): new
  **`apps/edge/src/eta-cache.ts`** — an isolate-level cache keyed per *upstream call*, so a pole is fetched
  **once per 30 s per isolate** no matter how many concurrent requests want it, and the second caller awaits
  the first caller's promise rather than opening a connection (the fan-out is throttled by a
  6-simultaneous-connection ceiling, so a duplicate call displaces a real one). **Failures are not cached** —
  the entry is evicted and the caller gets a fallback, so an upstream blip degrades a card instead of erroring
  a screen. **`ETA_TTL_SEC = 30`** replaces the old 8 s (ETAs) and 10 s (nearby): at 8 s the hit rate was ~0%
  because upstream only refreshes ~1/min. The KMB bulk `route-eta` feed is coalesced too.
  **`apps/edge/test/eta-coalescing.test.ts`** proves `/v1/nearby` at a 20-pole coordinate issues *exactly*
  distinct-pole-count upstream calls, and that two concurrent requests issue one set.
- **Tests: there is a suite now.** `apps/edge` runs **`@cloudflare/vitest-pool-workers`** — real workerd with
  simulated KV/R2 — **18 tests** across `dataset-kv` · `eta-cache` · `eta-coalescing` · `tiles`;
  `apps/mobile` has **17** (`stopName`, `geoSnap`). Root **`pnpm test`** runs both, and
  `.github/workflows/dataset.yml` runs typecheck + tests *before* it is allowed to touch KV.
  **Gotcha worth remembering:** root `package.json` now pins `pnpm.overrides.esbuild = "0.27.3"`. `.npmrc`
  sets `node-linker=hoisted`, so wrangler's exact-pinned esbuild and vitest's newer one fought over the single
  hoisted platform binary and `wrangler dev` died with
  `Host version "0.27.3" does not match binary version "0.28.1"`.
- **Upstream data bug found while precomputing every route:** the consolidated dataset declares `serviceType`
  as a string, but a minority of entries carry a **number**, which crashed `localeCompare`.
  `packages/data-normalize/src/dataset.ts` now coerces with `String(...)`. The old per-request path had only
  ever touched the string-typed majority — precomputing *everything* is what surfaced it.
- **The wire contract — WP1-1** ([ADR-052](./08-decision-log.md#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)):
  new **`packages/contract`** holds the Zod schemas that are the **single declaration** of every shape crossing
  the network (`src/wire/{primitives,stop,route,eta,detail,search,responses}.ts`), plus the OpenAPI 3.1
  assembly (`src/openapi.ts` → committed **`openapi.json`**, 6 paths · 28 component schemas). No
  `zod-to-openapi`: OpenAPI 3.1's Schema Object *is* JSON Schema 2020-12, which Zod 4 emits natively.
  `packages/core/src/types.ts` + the three search shapes are now **`z.infer` re-exports imported with
  `import type`**, so `types.js` emits `export {};` and **zod never enters the client bundle** — `core`'s
  runtime dependency list stays empty, which is what keeps it hand-portable to Swift/Kotlin.
  **The one decision that makes the schema adjustable** is `WIRE_JSON_SCHEMA_OPTIONS` in
  `src/json-schema.ts`: it strips `additionalProperties: false` from the emit, so adding an optional field is
  a deploy rather than a migration — otherwise a strict generated decoder on an already-installed phone would
  reject any payload containing a field it didn't know. Closed enums carry `x-unknown-tolerant` so a fourth
  operator can't brick deployed clients. **Three gates, each verified to fail on an injected violation:**
  the type-only boundary check (`packages/core/scripts/check-type-only-contract.mjs`), the response-conformance
  suite (`apps/edge/test/wire-conformance.test.ts` — asserts responses satisfy their schema **and carry no
  undocumented field**), and the OpenAPI staleness check
  (`packages/contract/scripts/check-openapi-current.mjs`). All three run under `pnpm test`.
  **Verified:** typecheck 8/8 · **22 edge + 17 mobile tests + both script gates** · Biome clean (only the 7
  pre-existing findings) · **`apps/mobile` diff vs `main` is empty**, the WP1-1 acceptance criterion.
  **The conformance gate found a real bug on its first run:** `/v1/nearby` used
  `Number(url.searchParams.get('lat'))`, and `Number(null)` is `0` — so a request with *missing* coordinates
  was served as 0, 0 and returned an empty list with a **200** instead of a 400. Fixed.
  **Known-wrong-but-faithful** (left alone deliberately; WP1-1 changes no shapes — see ADR-052): errors are
  `{error}` not `{code, message, retryable}`, and `Route.service` is served at two fidelities under one type.
- **Wave 1 complete — WP1-2 · WP1-3 · WP1-4 · WP1-5** (ADR-051 · ADR-059 · ADR-060), built by four agents in
  parallel worktrees and integrated one at a time:
  - **`packages/ports`** — the six platform seams (`KeyValueStore`, `LocationProvider`, `LocaleProvider`,
    `LinkOpener`, `Clock`, `TileSource`) as **declaration-only** interfaces; `ls packages/ports/src` is the
    iOS/Android porting checklist. Imports nothing, so ports take domain types as *type parameters* —
    `TileSource<LocaleId, ImageAsset>`. `apps/mobile/lib/tileSource.ts` now **binds** the port rather than
    re-declaring it, so the compiler checks the equivalence. **Nothing is wired to the other five yet** — that is
    Wave 2/3, one adapter at a time.
  - **The id grammar** — one parser in `packages/core/src/ids.ts` (not in `contract`, because `core/src/eta.ts`
    needs it and ADR-052's type-only gate forbids that edge at runtime); ABNF + a 60-row corpus in
    `packages/contract/src/ids/`. The plan listed **8** ad-hoc parse sites; a grep found **12**. All drained —
    **the allowlist is empty** — and the gate is keyed on file + snippet, not line numbers, which had already
    drifted.
  - **The boundary engine** — `layers.json` is the single declaration, generating both the dependency-cruiser
    ruleset and `biome.json`'s overrides, with drift gated. **13 injected violations, every gate fires**,
    including the two transitive cases. Two tools because neither suffices: the cruiser sees paths, `import type`
    and reach; Biome is textual and catches platform globals that need no import.
  - **The fixture corpus** — `@spec <module>#<export>` + `scripts/check-spec-coverage.mjs`, **36 rules, 274
    language-neutral JSON cases, 100% branch coverage gated**, both rot directions checked, 18 named boundary
    rows asserted by name. This is the equivalence mechanism for the *hand-ported* half that no schema can cover.
  - **Two real bugs fixed as a result.** `formatClock` used `toLocaleTimeString`, whose output depends on the
    host ICU build *and the device timezone* — a rider abroad saw their own local time on a Hong Kong board; now
    computed arithmetically from a fixed HK offset, and the kernel bans the `toLocale*` pattern. And
    **`inferBusMarkers` could drop a bus entirely** — a stale departed reading acted as its successor's
    predecessor, so a bus one minute away vanished from the route view; departed readings are now discarded
    before the discontinuity scan. Six further defects are recorded as `knownDefect` corpus rows.
  - **Verified:** typecheck 9/9 · 22 edge + 88 mobile + 282 core · 4 script gates · 13 boundary self-tests ·
    100% `core` branch coverage · Biome at the 7 pre-existing findings. WP1-2 also drove the Worker by `curl`
    and walked the PWA in a browser.
- **Docs:** plan `01–10`, the full ADR set in [`docs/08`](./08-decision-log.md) (Wave 0 adds **055** ·
  **057** · **058** and implements **049**), research + proposals sets, `CLAUDE.md` / `AGENTS.md`,
  pre-commit docs-check skill + hook.

## 🚧 Not done yet / known limitations
- **Not deployed** (WP0-5). There is **no CI, no Cloudflare Pages deploy and no domain**, so nothing is
  reachable outside a dev machine. It needs a real domain **and** a Cloudflare account, and **this environment
  has no Cloudflare auth at all** — hence the placeholder KV namespace id in `wrangler.toml` and the fact that
  `dataset:publish` has only ever been exercised against Miniflare-local KV/R2. **Deferred on purpose**
  (owner's call, 2026-07-27): we launch after most of the other waves land, so this is *not* the next job.
- **Live ETA / nearby data is server-side**; the **search index is on-device** (ADR-037 — first step of
  [ADR-007](./08-decision-log.md)), but it's still **server-computed** and fetched. The static data is now
  precomputed into KV/R2 (ADR-055), but it is still **derived from the hkbus consolidated dataset** — the own
  crawl of the operator APIs is still backlog. KMB + CTB + GMB; other operators (NLB/MTR) are in the
  consolidated set but out of v1 scope — search's operator filter chips are data-driven, so they appear the
  moment those adapters land.
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
- Static layer no longer depends on hkbus **at runtime** (ADR-055) — an outage there means the *build* is
  skipped and the Worker keeps serving the last good `build:current`, i.e. **stale, not broken**. The
  remaining dependency is on their data as a *source*; backlog: own crawl.
- Offline is **shipped** (ADR-058) but the **Nearby screen offline is unverified** — the data path was proved
  instead, because Chrome geolocation in this environment resolves outside Hong Kong. Worth an eyeball on a
  real device. Offline is also **web-only**: native has no service worker, though the persisted query cache
  and last-known-fix work on all three targets.
- **Search** (the `/search` page, ADR-037) ships but **hasn't been walked in-browser** yet (logic + edge
  endpoint verified by curl; visual/interaction pass on the floating button, keypad, chips and result lists is
  pending). Route results navigate to a representative variant id (direction toggle / service-type picker =
  follow-up). Filter chips live only on Search, not yet on Nearby (rest of proposals P8).
- Stop detail's ETA fan-out is **coalesced** per pole (ADR-057) and **bounded** per place
  (`DEFAULT_CTB_BUDGET` in `stop-route.ts` — only CTB needs it; a KMB pole costs one `stop-eta` call for every
  route). It still refreshes via `refetchInterval` polling, not the `watch()` socket (v2). No **interactive**
  map (the static `MiniMap` is there) · no push · no native build has been run.
- `Skeleton` is static; the number-flip / split-flap ETA animation isn't built; **CJK uses the platform
  face by decision** (no Noto bundled — [ADR-019](./08-decision-log.md)); `font-display` (dot-matrix) face
  not added; display-livery character treatments (LED / flip-tile) are colour-only. (Lucide icons now
  shipped — [ADR-025](./08-decision-log.md).)

## ▶️ How to resume
1. Read [`CLAUDE.md`](../CLAUDE.md) → [`docs/README.md`](./README.md).
2. `pnpm install`, then `pnpm dev` (or `pnpm dev:edge` / `pnpm dev:web`). Verify per [`docs/10`](./10-scaffold-and-running.md).
3. `pnpm test` (18 edge + 17 mobile) and `curl localhost:8787/v1/health` — locally that reports
   `"dataset":"inline"`, which is the expected dev fallback; in production it must read `"kv"` with
   `datasetBuildsThisIsolate: 0`.
4. For the PWA specifically: `pnpm --filter @nextbus/mobile build:web`, serve `apps/mobile/dist`, then kill
   both the static server and the Worker to check the offline path.

## 🔜 Next steps (priority order)
0. **Favourite routes-at-a-stop** ([ADR-032](./08-decision-log.md#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes) + [ADR-042](./08-decision-log.md#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant), **✅ done 2026-06-15**) —
   the store + tab are on the route-at-stop model (stop-only favourites **removed**, 2026-06-10):
   `favoriteRoutes: string[]` keyed `"${memberStopId}|${routeId}"` with `toggleFavoriteRoute`. **Save UI =
   a bottom sheet** (`components/BottomSheet.tsx` + `SheetAction`): tapping a stop on the **route schematic**
   opens **Favourite / Remove favourite** (this route at the tapped pole) + **View stop**. *(A glass save-star
   in the route header was prototyped then dropped — didn't feel right.)* **Place detail** keeps a per-row
   `SaveStar` as a saved-state **indicator only** (`hideWhenEmpty` — only saved routes show a filled star).
   **Keys on the raw *member* pole id, never the `P:` place id** (place ids churn under clustering and would
   orphan favourites). The **Favourites tab groups by place**: each saved pole resolves via `getStop` (the
   server promotes a member id to its place), grouped by the returned place id, so a multi-pole place shows
   once with its starred routes from every pole. Browser-verified end-to-end. Bare-route favourites deferred.
1. **Wave 2 of [`proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)** ← **start here.**
   **Wave 1 is ✅ complete — WP1-1 … WP1-5 all landed and verified** (ADR-051, ADR-052, ADR-059, ADR-060); see
   *Done & verified*. Wave 2 is the parity-guarded domain extraction, and it is now much safer than the plan
   assumed, because the *"near-zero test coverage"* risk it was written against is closed: `packages/core` has a
   274-case corpus at 100% branch coverage, so a "mechanical, zero-behaviour-change" move is now checkable
   rather than asserted. **WP2-6 (`snapFix`) already landed** in `apps/mobile/lib/geoSnap.ts` and just needs
   moving; **WP2-5 is a known-broken-scheme migration** — fix the favourite id scheme before ADR-032 ships, and
   note WP1-2 left `apps/mobile/lib/preferences.ts`'s own `favoriteRouteKey` template in place precisely because
   folding it into the shared formatter *is* that migration.
   **Highest-value loose ends Wave 1 left, in priority order:**
   - ✅ **Done 2026-07-28:** five of the six `knownDefect` rows are fixed (`formatDistance` 995–999 m,
     `estimateChildFare('')`, `estimateElderlyFare('')`, `formatServiceHours`' past-midnight wrap,
     `buildRouteTrie('')`), and the corpus format is converged. **One `knownDefect` remains on purpose:**
     `formatStopCount(1, 'en')` → `"1 stops"` needs a plural-aware key and belongs to **WP3-2** (i18n → ICU),
     not a per-platform patch.
   - **WP2-8 — the error taxonomy** (newly added to the plan; nothing owned it before). `{error}` →
     `{code, message, retryable}` *and* the status codes: a malformed id returns `502` where `400` is right, and
     `502` reads as retryable, so a Widget holding a stale favourite retries forever. Ship additively per
     ADR-052 §5.
   - **WP2-9 — split `RouteServiceInfo` by fidelity** (also newly added). A native client currently cannot tell
     "no frequency table" from "you asked the summary endpoint".
   - **`layers.json` is 44% over its line budget** — per the plan's own risk row that is the signal to simplify
     the generator when it next needs to change, not to grow it. Not worth touching working, self-testing code
     for a line count alone.
2. **Search polish** (ADR-037 follow-ups) — walk it in-browser; a content-hash `version`; an **omnibox**
   (route + stop in one box); "routes to <place>" reverse search; direction toggle (P11) on the landed route.
3. **WP0-5 — deploy + CI + custom domain** (the one thing between here and a live URL, and **deliberately
   deferred until most other waves land** — owner's call, 2026-07-27). Create the real
   resources (`wrangler kv namespace create DATASET`, `wrangler r2 bucket create nextbus-builds`), replace the
   placeholder id in `apps/edge/wrangler.toml`, add the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
   secrets and the `EDGE_URL` repo variable the dataset workflow already reads, **rehearse the publish against
   a `--preview` namespace first** — two builds, so the ~20k-key prune runs for real once before it can touch
   production ([ADR-061](./08-decision-log.md) decision 2) — then run `pnpm dataset:publish`
   against **real** KV/R2 for the first time, **then set `DATASET_PUBLISH_ARMED=true`** to re-enable the
   nightly cron (it is skipped until then — see `docs/10` "Configuration & secrets"; a
   `workflow_dispatch` run is the way to test the credentials first), then add a `ci.yml` (typecheck · lint · test ·
   `wrangler deploy` · `build:web` → Pages). Confirm `GET /v1/health` reports `"dataset":"kv"` and
   `datasetBuildsThisIsolate: 0`. Also **blocked** on a domain + a Cloudflare account (no auth in this
   environment). *(**Own crawl → KV/R2** is now a separate, smaller job: the KV/R2 pipeline exists — only the
   source needs swapping, in `scripts/build-dataset.mts`. It buys self-reliance and true zh-Hans.)*
4. **Street-level stop photos** ([ADR-050](./08-decision-log.md#adr-050--stop-imagery-google-street-view-deep-link-now-hk-streetscape-360-as-the-inline-target)) —
   the Google Street View **deep link** is hours of work, keyless and free; do it with or before the map work.
   Then **Streetscape 360** inline, once we know whether a coordinate→panorama lookup works without their JS
   SDK (email `3dmap@landsd.gov.hk` for the free key and ask).
5. **Map view** (MapLibre) for Nearby — the tiles are already solved: consume `lib/tileSource.ts` and it
   inherits the LandsD basemap + label overlay that `MiniMap` uses.
6. **Honest-motion slice** — number-flip / split-flap ETA animation, freshness pulse, shimmer skeleton,
   reduced-motion + a11y pass (Reanimated is installed/wired but unused), swipe-to-favourite + haptics.
7. **Departure-board mode** (ADR-026 follow-up) — an alternate Nearby view: one ETA-sorted stream of next
   departures across nearby stops; the natural home for the Split-Flap / Dot-Matrix display liveries.
8. **Direction-aware stop clustering** ([ADR-042](./08-decision-log.md#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant) — study in `.context/stop-merge-study/`).
   **Quick win ✅ done (2026-06-11):** the existing cross-operator pair merge now applies a **direction gate** —
   reject a candidate whose stops' **mean travel bearings** disagree by >45°, unless a co-run KMB+CTB route lists
   both at the same sequence position (`directionAgrees`/`bearingDeg` in `dataset.ts`). **Backend now fully built
   & verified (2026-06-11):** N-member single-linkage clustering (`buildPlaces`) with cluster-level vetoes +
   bearing-spread cap + same-operator members; per-place ETA fetch (KMB `stop-eta` 1 call/pole, CTB per-route to a
   budget, dedupe) returning an honest `routeCount`; `/v1/stop` carries member poles + per-route pole ids; name
   chosen once. Belair → 2 kerb-split places (live + snapshot); ≈2,010 clusters / 5,461 stops. **Place UI now built
   (2026-06-11):** Nearby cards show soonest ≤6 + "+N more routes" (honest `routeCount`); **Place detail** groups
   routes under their pole with a multi-pin `MiniMap`, a walk *range*, and route→stop→place nav (`?pole` anchor).
   **Member-keyed favourites ✅ done (2026-06-15):** per-route saving keyed on the member pole id
   (`${operator}:${eta.stopId}`) — favourite via the route-schematic bottom sheet + a per-row `SaveStar` in Place
   detail; Favourites-tab groups by place (resolve each saved pole → place via `getStop`). See item 0.
   **Direction tag ✅ done (2026-06-15):** a place's `meanBearingDeg` rides on the wire `Stop.bearingDeg`;
   `formatBearing` (`@nextbus/core`) renders a localized 8-point "-bound" label preceded by a `BearingArrow`
   (rotated compass arrow) on the Nearby card + Place summary — Belair now reads "↗ Northeast-bound" vs
   "↙ Southwest-bound" (browser-confirmed). Same pass: operators comma-separate ("Citybus, KMB"); `formatDistance`
   drops the unit space ("200m"). **Confidence + audit ✅ done (2026-06-15):** every `IndexPlace` carries a 0–100
   `confidence` + `bearingSpreadDeg` (`placeConfidence`); high-spread audit cleared the risky tail (22 GOOD / 1
   UNCERTAIN / 0 direction fusions — `.context/stop-merge-study/high-spread-audit.md`).
   **Remaining (ADR-042 "Open follow-ups"):** (a) **circular-route heading** — a "which way round" cue for loop
   routes like KMB 284; (b) **cluster-review UI** — a one-off internal tool to eyeball/accept-split groupings,
   sorted by `confidence` worst-first; (c) optional **18-district gazetteer** to upgrade the direction tag to the
   friendlier "towards {district}" wording (compass ships now; "towards X" isn't otherwise derivable).

## 📍 Key file pointers
- DataSource seam → `packages/core/src/datasource.ts`; EdgeClient → `packages/api-client/src/index.ts`
- Edge logic → `apps/edge/src/{nearby,stop-route,search-index}.ts` (`stop-route.ts` has `resolveMembers`/
  `toMergedStop` for `P:` place ids); multi-op index + same-kerb `buildPlaces` →
  `packages/data-normalize/src/dataset.ts` (KMB own-crawl in `kmb-static.ts`, for the future)
- **Dataset pipeline (ADR-055)** → seam + KV reads `apps/edge/src/dataset.ts`; shard shapes/keys
  `packages/data-normalize/src/shards.ts`; build + publish `apps/edge/scripts/{build-dataset,publish-dataset}.mts`
  (`pnpm dataset:build` / `pnpm dataset:publish`); schedule `.github/workflows/dataset.yml`; bindings
  `apps/edge/wrangler.toml` + `src/{env.ts,bindings.d.ts}`. Health check → `GET /v1/health`
- **ETA coalescing (ADR-057)** → `apps/edge/src/eta-cache.ts` (`coalesce`, `ETA_TTL_SEC`)
- **Tiles (ADR-049)** → Worker proxy `apps/edge/src/tiles.ts`; client seam `apps/mobile/lib/tileSource.ts`;
  consumer `apps/mobile/components/MiniMap.tsx`
- **PWA / offline (ADR-058)** → `apps/mobile/workbox.config.mjs` · `apps/mobile/scripts/build-web.mjs`
  (`pnpm --filter @nextbus/mobile build:web`) · `apps/mobile/lib/serviceWorker.ts` ·
  `apps/mobile/providers/QueryProvider.tsx` · fix snapping `apps/mobile/lib/geoSnap.ts`
- Tests → `apps/edge/test/*.test.ts` (workerd + simulated KV/R2) · `apps/mobile/lib/*.test.ts`; `pnpm test`
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
