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
- **MMKV** (native) / **IndexedDB** (web) — persist the static dataset + favorites for offline.

## Maps
- **MapLibre GL** (open-source, free tiles via a provider like MapTiler, or self-hosted) — works
  RN (`@maplibre/maplibre-react-native`) + web (`maplibre-gl`). Avoids Google Maps fees.
- Map view is **v1.5** — the v1 "nearby" can launch as a fast **list** first, map added shortly after.
