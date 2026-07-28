# 04 — Frontend & Design

## The stack: Expo (React Native + React Native for Web)

**One codebase → three targets:** iOS, Android, and Web/PWA.
- **React Native** renders to *real native views* (not a webview).
- **React Native for Web** renders the same components to the DOM.
- **Expo** is the framework: unified dev/build, file-based routing (Expo Router) across all
  three targets, cloud builds (EAS), App Store submission, and **over-the-air (OTA) updates**.

### Why this beats the alternatives for *us*
- vs **PWA-only:** we get App Store presence, reliable push, and background geolocation later —
  things a transit app genuinely wants — without throwing away code.
- vs **fully-native (Swift + Kotlin) + separate web:** that's ~3× the code, 3× the bugs, 3×
  the release pipelines. RN collapses it to one. A bus app is lists + search + a map + live
  counts — squarely RN's sweet spot; we give up almost nothing.

### Our chosen path: **ship the PWA first, native later — same code**
Choosing Expo does **not** mean shipping native on day one. The Expo **web target builds an
installable PWA**. So we:
1. Ship the **PWA** as v1 (always-latest, zero install friction, no app-store gatekeeping).
2. **Flip on** iOS/Android builds in a later phase from the *same* codebase — no rewrite.

This directly resolves the two concerns you raised — see below.

---

## Answering the open questions

### Q: Can React Native do lots of delightful micro-animations, on web *and* native?
**Yes — and on native it's arguably better than the web.** The toolkit:

- **React Native Reanimated** — animations run on the **UI thread** via "worklets," so they hit
  60/120 fps even when JS is busy. Springs, timing, sequences, **layout animations**,
  enter/exit animations. Has a **web implementation**, so the same code animates in the browser.
- **React Native Gesture Handler** — native-thread gestures (pan/swipe/pinch) that drive
  animations: drag-to-dismiss bottom sheets, swipe-to-favourite, pull-to-refresh.
- **Moti** — ergonomic declarative layer on Reanimated (`<MotiView animate={…}/>`); perfect for
  small delight; web + native.
- **@shopify/react-native-skia** — 2D canvas/shaders/blur/gradients for custom visuals (animated
  route lines, fancy loaders). Runs on web via WASM.
- **Lottie** — rich vector animations (empty states, success ticks); works web + native.
- **Expo Haptics** — tactile feedback on native. **This is a delight lever the web simply can't
  match** (e.g. a tiny tap when you favourite a stop or when your bus goes "Due").

**Honest trade-off:** Reanimated-on-web is a compatibility layer. ~95% of micro-interactions
(springy transitions, list reordering, animated number-flips on ETA change, press feedback,
skeletons) work great on both. For the last ~5% (extremely bespoke web-only CSS tricks, or very
heavy Skia scenes) you may write a small platform branch. For your goal — *lots of little
delightful touches* — this stack is excellent, and native gets haptics on top.

### Q: Does AI coding reduce the cost of maintaining separate native apps?
**It lowers it, but doesn't erase it — and the math still favors one shared codebase.**
- AI genuinely helps *produce* parallel code (boilerplate, translating a SwiftUI view to
  Compose, scaffolding). That's real.
- But the duplication tax is mostly **not typing**. Two native apps = two runtimes to debug,
  two crash/perf dashboards, two store pipelines + certificates + review queues, two dependency
  trees to upgrade, **feature-parity drift**, and double the QA surface. AI doesn't halve the
  *operational and cognitive* surface of owning two apps.
- Net: AI makes "two native apps" *more feasible* than before — but "one RN codebase" is still
  less total work and less drift, **and AI accelerates the RN path too.** So the relative
  advantage of one codebase largely persists. We keep one codebase.

### Q: Users not having the latest version → should we just do a PWA?
A smart, real concern — and the reason it pushes you toward PWA is exactly the thing Expo fixes:
- **EAS Update (OTA):** push JS/asset updates that installed apps adopt **on next launch, with
  no App Store review.** For the vast majority of changes (features, fixes, copy), everyone
  converges to latest fast — *much like the web*. You only need a store build when you add or
  upgrade **native** modules.
- And since **we ship the PWA first anyway**, v1 is literally "always-latest web." Native comes
  later with OTA already keeping it current.
- Why not pure PWA forever? On iOS, PWAs have **restricted push** (better since iOS 16.4 for
  home-screen installs, still limited) and **essentially no background geolocation** — and a
  transit app really wants "your bus is 2 stops away" alerts and location. Expo gets us there
  later **without a rewrite**. So: PWA-first ✅, but on the Expo codebase, not a dead-end PWA.

---

## Design system & "the feel"

### Styling / component layer
- **NativeWind** (Tailwind for RN + Web) — utility classes over a semantic design-token system,
  with **react-native-reusables** for accessible shadcn-style primitives. Chosen for implementation
  reliability (fewer bugs, simple mental model); performance is more than enough here because the
  perf-critical path (animation) runs through Reanimated regardless. (See [ADR-009](./08-decision-log.md).)
- Motion via **Reanimated + Moti** (+ **Skia** for custom drawing). Themes are CSS-variable token
  sets swapped at runtime — full spec in **[`docs/09` — Theme & Design System](./09-theme.md)**.

### Design tokens (shared in `packages/ui`)
- **Colour:** semantic tokens (`bg`, `surface`, `text`, `accent`, per-operator brand accents —
  KMB red, Citybus yellow — used sparingly). Full **light & dark** themes (transit happens
  outdoors, day and night — dark mode is not optional).
- **Type scale & spacing:** one modular scale; large, thumb-friendly tap targets.
- **Motion tokens:** standard spring/duration presets so animations feel consistent.

### Signature interactions (the delight)
- **Animated ETA updates:** when a real new value arrives, the minutes **flip/spring** to the
  new number (never a fake per-second tick — see the ETA principle).
- **Pull-to-refresh** with a springy, branded indicator.
- **Bottom sheet** for stop detail; drag to expand/dismiss (Gesture Handler).
- **Swipe-to-favourite** with a haptic tick (native).
- **Skeleton shimmer** while first data loads; content **fades/slides** in.
- **Map markers** that gently animate in; **"Due"/"Arriving"** state pulses subtly.
- **Shared-element / spring page transitions** via Expo Router.

### How ETAs are displayed (honest, per the core principle)
- Show source value, refreshed only on real data: **relative minutes** (`~10 min`) and/or an
  **absolute arrival time** (`3:42 pm`). For long waits, the clock time reads better; we may show
  minutes when small and clock when large (configurable).
- **"Arriving" / "Due"** for sub-minute, instead of a fake `0:59…`.
- A small **"updated 12s ago"** chip; data older than a threshold is **greyed/flagged stale**.
- Animate the **change**, not a clock.

### Accessibility (non-negotiable)
- Dynamic type / font scaling; screen-reader labels on every interactive element and ETA.
- WCAG-AA contrast in both themes.
- **Respect reduced-motion** (OS setting / `prefers-reduced-motion`): downgrade delight
  animations to simple fades or none.

### Localization
- **EN / 繁體中文 / 简体中文** from day one (`packages/i18n`). Cheap to do early: the upstream APIs
  already return all three name variants (`name_en` / `name_tc` / `name_sc`) for every route, stop,
  and destination, so localized **data** is free — only our own UI chrome strings need translating
  (one extra locale file). All data names carry i18n variants from the canonical model. Locale
  auto-detected, user-overridable. See [ADR-014](./08-decision-log.md).

## State & data on the client
- **TanStack Query (React Query)** — server-state caching, dedupe, background refresh; the v2
  socket pushes updates straight into the query cache.
- **Zustand** — light local UI state (selected direction, theme, favorites).
- **AsyncStorage** — one persistence API across all three targets (`localStorage` on web, the
  native store on iOS/Android). It backs the preferences store (theme · appearance · locale ·
  favourites), the on-device search index (`lib/searchIndex.ts`, stale-while-revalidate), the last
  known location, **and** the persisted query cache below. MMKV stays a native-only optimisation to
  reach for if profiling ever asks for it — one store beats two.

### Offline & the service worker
See [ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier).
Offline is not a nicety for a transit app: the moment you most need the next departure is often the
moment you're underground or out of data. Four caching strategies, one per kind of thing — the
differences between them *are* the design:

- **App shell → precache.** `apps/mobile/workbox.config.mjs` + `scripts/build-web.mjs` generate
  `dist/sw.js` over Expo's static export (`pnpm --filter @nextbus/mobile build:web`). Expo's output
  is content-hashed, so cache-first with no revalidation is both safe and the fastest cold start —
  this is what makes the app *open* with no network. `lib/serviceWorker.ts` registers it on
  **production web only**; never in dev, where a stale worker intercepting Metro serves yesterday's
  bundle and no amount of reloading fixes it.
- **`/v1/index` → stale-while-revalidate.** Large, changes about daily: serve the cached copy
  instantly, refresh behind it.
- **Live ETA endpoints → network-first, 4 s timeout.** Never cache-first — a bus that left four
  minutes ago is worse than no answer (ADR-008). The cached copy is the *fallback*, and it carries
  its original `observedAt`, so the ETA helpers age it and the UI labels it stale.
- **Tiles → cache-first, never prefetched.** A tile already seen redraws offline; nothing is fetched
  speculatively (both LandsD's and the OSMF's policies prohibit exactly that).

**The query cache is persisted too** — `providers/QueryProvider.tsx` is a
`PersistQueryClientProvider` over an AsyncStorage persister (24 h, **successes only**, so a
persisted error can't replay as "the app is broken"). A cold start paints the last known arrivals
instead of a spinner. This is an exception to ADR-008's *presentation* rule, not to its principle: a
replayed reading arrives with its own `observedAt` and is shown as the labelled old reading it is.

### Location: snap the fix, remember the fix
`lib/geoSnap.ts` grid-snaps every fix to a **25 m** cell before it leaves the device. One small pure
function buys three things: privacy (we ask about a cell, not a doorstep), edge-cacheability (raw
coordinates jitter metres between readings, so `/v1/nearby` was a fresh cache key nearly every
request), and offline (the query key is stable enough for a persisted Nearby result to be replayed
at all). 25 m is well inside urban-canyon GPS accuracy and small against the 500 m radius, so it
changes nothing about which stops come back. `lib/useLocation.ts` remembers the last fix and returns
`stale: true` when it falls back to it; Nearby then reads "Last known location" in place of the app
name, rather than implying a live position.

## Maps
- The basemap is the **Hong Kong Lands Department's** keyless raster, proxied and cached by our own
  Worker — see [ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay).
  Components never name a tile host: they go through the **`TileSource`** seam
  (`apps/mobile/lib/tileSource.ts`), so the source can be repointed without an app release and a
  future iOS/Android client implements one interface instead of re-deriving Web Mercator plumbing.
- Labels are a **separate per-locale overlay** (`en`/`tc`/`sc`), so switching language relabels the
  map with no restyling. Dark mode is derived with a CSS invert filter (`invertForDark`) because the
  raster service ships no dark cartography.
- **One framing rule, in metres, not zoom levels.** `fitZoom` frames a multi-pole place so every pin
  fits inside 70% of the viewport (poles sit ≤30 m apart, so it lands z18–19). A **lone** stop has
  nothing to fit, and used to fall back to a flat `DEFAULT_ZOOM = 16` — eight times the ground per
  axis, so every single-pole stop (all of GMB, most of Citybus) looked conspicuously zoomed-out next
  to its multi-pole neighbour. It now asks for a **minimum ground span** (`SINGLE_PIN_MIN_SPAN_M`,
  100 m) and takes the highest zoom that still shows it, which keeps the two agreeing on a tablet,
  where a fixed zoom covers far more ground than on a phone.
- **The projection and that framing rule are `@nextbus/core/mercator`, not the component** (WP2-4).
  `lngToWorldX`, `latToWorldY`, `worldScale`, `metresPerPixel`, `clampZoom` and `fitZoom` are pure
  and platform-free, pinned by `packages/core/spec/mercator.spec.json` — so a MapKit or MapLibre
  client frames a stop identically instead of re-deriving Web Mercator against its own SDK. The tile
  source's zoom bounds are an argument (LandsD serves z10–20, ADR-049); `MiniMap` keeps only the
  layout — which tiles cover the viewport, where each dot and label chip goes.
- **Known, recorded in the corpus:** at the width the map is actually handed (the window minus two
  16 px gutters) z19 covers 98.8 m, just under the 100 m minimum, so on a ≤394 px-wide phone a lone
  stop still frames one step wider (z18) than the multi-pole place next door — the very difference
  the rule was written to remove. The fix is a smaller span or measuring it against the hero width;
  until then `mercator#fitZoom:lone-stop-on-a-390px-phone-frames-a-step-wider` holds every platform
  to the same wrong answer rather than three different ones.
- Today's map is the static `MiniMap` on Stop/Place detail. **MapLibre GL**
  (`@maplibre/maplibre-react-native` + `maplibre-gl`) remains the route to a real interactive map in
  Phase 2; it consumes the same `TileSource`, so the tile question is already settled.
