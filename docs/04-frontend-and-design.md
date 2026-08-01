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
- **A bus parked at the terminus is not an arrival.** Every journey starts at stop 0, so the origin
  always reports a next departure — drawn faithfully that is a token permanently parked on the first
  node, which reads as a bus you could catch. The route rail only shows it once it is within
  **120 s** of leaving (`ORIGIN_BUS_DEPARTS_WITHIN_SEC` / `visibleBusMarkers` in
  `@nextbus/core/route-detail`, alongside `upcoming`, `isOriginStop` and the circular-route
  header naming). The threshold is a judgement about honest presentation, not a property of the
  feed, so it is named, pinned by `spec/route-detail.spec.json`, and hand-ported with the rest of
  the kernel rather than re-invented per platform.

### Accessibility (non-negotiable)
- Dynamic type / font scaling; screen-reader labels on every interactive element and ETA.
- WCAG-AA contrast in both themes.
- **Respect reduced-motion** (OS setting / `prefers-reduced-motion`): downgrade delight
  animations to simple fades or none.

### Localization
- **EN / 繁體中文 / 简体中文** from day one (`packages/i18n`). Cheap to do early: the upstream APIs
  already return all three name variants (`name_en` / `name_tc` / `name_sc`) for every route, stop,
  and destination, so localized **data** is free — only our own UI chrome strings need translating.
  All data names carry i18n variants from the canonical model. Locale auto-detected,
  user-overridable. See [ADR-014](./08-decision-log.md) and ADR-054.

**One declaration: `packages/i18n/src/catalogue.ts`.** Every UI string, in all three locales,
authored in an ICU subset. It is **key-major** — the three renderings of a message sit together, so
a translator compares them without scrolling and a gate can compare them at all. Everything else is
derived from it: the `MessageKey` union, the argument types, and the native artefacts below.

```
pnpm --filter @nextbus/i18n strings:emit   # → packages/i18n/generated/
pnpm --filter @nextbus/i18n test           # parity + ICU + drift gates, and their selftest
```

**The ICU subset** is `{name}` and `{n, plural, one{…} other{…}}` (`#` is the count) — no `select`,
no skeletons, no ICU apostrophe quoting, so an apostrophe is always literal. The runtime is ~120
hand-written lines in `src/icu.ts` over **`Intl.PluralRules`**, not `intl-messageformat`: the
`tokens` layer's npm allowlist is closed (`layers.json`), and a PWA should not ship ~40 kB of parser
to format three placeholders. `Intl` is banned in the **kernel** only, where a rule must be
reproducible from a fixture; picking a plural category is precisely the job to leave to the host's
CLDR data. `validateMessage` rejects anything outside the subset and the gate runs it over all
351 strings, so the parser never meets input it cannot describe.

**Arguments are typed from the message text itself.** `t()`'s third parameter is derived from the
`en` literal by a template-literal type, so `t(locale, 'stopCount')` with no count, or with the wrong
argument name, is a compile error. This is why the subset forbids a placeholder *nested inside* a
plural branch: the type-level extractor cannot see one, so the gate bans it rather than silently
missing it.

**`LocalizedString` — the display boundary.** `t()` returns a branded `string`; nothing else
constructs one. The brand is assignable **to** `string` but not **from** it, so every existing call
site still compiles while a bare literal is rejected wherever localized copy is required. Applied
to UI-chrome props (`Button.label`, `Section.title`, `Empty.label`, `SheetAction.label`,
`accessibilityLabel` on our own components, `NumberField.placeholder`, …). Bus **data** props —
stop names, route numbers, fares, formatted ETAs — stay `string`; they are localized upstream, and
`@nextbus/core` cannot import the brand without breaking the layer graph.

Three documented escape hatches, each named for what it is:
`endonym(locale)` (language names must *not* follow the locale — a Chinese UI still shows
"English"), `localeRecord(key)` (the `Record<Locale, …>` shape the `TileSource` port wants), and
`dataText(i18nText, locale)` (takes the canonical record, never a bare string, so a literal cannot
be laundered through it).

**Two gates, because one cannot reach everywhere.** The type brand is primary. The second net is
`bannedSyntax` on the `view` layer in `layers.json`, covering what the brand provably cannot: React
Native's *own* props are typed `string`, so `accessibilityLabel="Back"` on a `Pressable` is legal
TypeScript. It bans literal `accessibilityLabel`, literal `placeholder`, and `.replace('{…'`
message interpolation. Both are watched failing — `pnpm boundaries:selftest` (fixture
`view-hardcoded-copy`, which pairs each violation with the correct form so the rules must
discriminate) and `check-i18n.mts --selftest`.

Known gaps, stated rather than implied: `Text`'s **children** are not branded, because glue (`·`,
`→`), numbers and core-formatted strings all legitimately render there and `@nextbus/core`'s
formatters cannot return a branded type from the `kernel` layer. `app/workbench.tsx` (a dev-only
design gallery) keeps its ~84 specimen literals — inventing catalogue keys for them would ship fake
copy in three locales to describe a screen no user reaches — though it is still bound by the brand
wherever it uses a real component.

**`packages/core` owns the rule, `packages/i18n` owns the word.** `formatStopCount` was deleted from
the kernel: a pure label with no rule, whose `en` output was `"1 stops"` — the corpus row's own
`why` prescribed a plural-aware i18n key over a per-platform `n === 1` branch. The other six label
tables (`DUE_LABEL`, `MIN_LABEL`, `EVERY_LABEL`, `ABOUT_LABEL`, `WALK_LABEL`, `COMPASS_LABELS`)
stay: each is an uninflected unit word attached to a real rule that a port reproduces from the
corpus. See ADR-054.

#### `packages/i18n/generated/` — what a native developer needs to know
Committed so a reviewer sees it in the diff and a consumer with no Node toolchain can read it, and
drift-gated by `test`. **Nothing here is verified by a compiler in this repo** — there is no Xcode
or Gradle on the build machine, so these files are checked for drift against the catalogue and for
escaping, and nothing more. Expect to fix something the first time they are consumed.

| | |
|---|---|
| iOS | `generated/ios/{en,zh-Hant,zh-Hans}.lproj/Localizable.strings` + `.stringsdict` for plurals |
| Android | `generated/android/{values,values-b+zh+Hant,values-b+zh+Hans}/strings.xml`, plurals as `<plurals>` |

- **Resource names are the catalogue keys verbatim** — `stopCount`, not `stop_count`. Android
  convention is snake_case, but a name transformation is a second place for the two sides to
  disagree, and `R.string.stopCount` is legal.
- **Named ICU arguments become positional**, numbered by first appearance in the `en` message:
  `{place}` → `%1$@` (iOS) / `%1$s` (Android). Every parameterised entry carries the mapping as a
  comment, because a positional format string is unreadable without it.
- **Simple arguments are string specifiers (`%@`/`%s`) — pass a count as a string.** Only a plural
  rule variable is numeric (`%d`), because ICU `{n}` carries no type and this subset adds none.
- Escaping is handled for `&`/`<`/`>` (XML entities) and `'`/`"` (backslash, Android) — but the
  generator **throws** rather than guess on a literal `%` or a leading `@`/`?`. No message contains
  one today; the first that does should be a decision, not a guess inside a generated file.

## State & data on the client
- **TanStack Query (React Query)** — server-state caching, dedupe, background refresh; a live
  subscription pushes updates straight into the query cache. Built in Wave 5 (ADR-056):
  `lib/useLiveEtas.ts` subscribes through `DataSource.watch()` and writes the merged result with
  `setQueryData` on **the key `useQuery` already owns** (`['stop', id]`), never a key of its own —
  that is what keeps ADR-058's persisted cache and its cold-start replay working, and the seam proof
  fails when it is changed. Place detail is the first adopter; its `refetchInterval` is gone — **and the
  hook hands back the clock that went with it.** `refetchInterval` re-rendered as well as fetched, and a
  screen's `const now = Date.now()` only advances when something re-renders it, so deleting it froze
  `etaReadout`'s staleness cue: the times stayed confident for ever. `useLiveEtas` returns a `now` ticking on
  the served `refreshAfterMs` (ADR-056 decision 16), so any screen converted off `refetchInterval` gets its
  clock back in the same call rather than remembering to ask for one. The interval survives for the *failure*
  case only, because otherwise one lost packet on open is permanent.
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
`snapFix` (`@nextbus/core`, `src/geo-snap.ts`) grid-snaps every fix to a **25 m** cell before it
leaves the device. One small pure
function buys three things: privacy (we ask about a cell, not a doorstep), edge-cacheability (raw
coordinates jitter metres between readings, so `/v1/nearby` was a fresh cache key nearly every
request), and offline (the query key is stable enough for a persisted Nearby result to be replayed
at all). 25 m is well inside urban-canyon GPS accuracy and small against the 500 m radius, so it
changes nothing about which stops come back. `lib/useLocation.ts` remembers the last fix and returns
`stale: true` when it falls back to it; Nearby then reads "Last known location" in place of the app
name, rather than implying a live position.

### What a place screen shows, and in what order (`@nextbus/core`, `src/stop-detail.ts`)
A place is N poles at one kerb ([ADR-042](./08-decision-log.md#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant));
a lone stop is a place with one. Five rules turn that payload into a screen, and all five are pure
functions in the kernel rather than closures inside `app/stop/[id].tsx`, because Swift and Kotlin
will hand-port them and a rule living inside a React tree cannot be asserted (ADR-060). The screen
keeps the rendering and the hooks.
- **`boardingPoleId`** — which pole's *heading* a route row is grouped under. It matters only where
  upstream published one physical pole under two stop ids: the build folds those onto one member
  (WP5-11) but the wire keeps both ids, because the folded one is a key riders have starred, and this
  is the map back. 80 poles in the build. **It is used to group and to key, never to rewrite a row:**
  a row's `stopId` is what `SaveStar` persists and what the Favourites tab matches, so a rewritten row
  would mint a favourite key that matches nothing.
- **`dedupeRoutes`** — one row per *rider line* (`operator|routeNo|bound`) **at one pole**, keeping the
  one carrying a live reading. Citybus lists 969 three times at one Tin Shui Wai pole; a rider does not
  choose a service type. The operator is in the key so a merged kerb keeps KMB-104 and CTB-104 apart;
  the bound is in it so a loop route whose two directions share a destination (Citybus 26 at Statue
  Square) does not collapse into one misleading row; and the pole is in it because two different
  minibus services can share a number at one place (Wave 5 — fusing them took a pole's whole group off
  the list while its map dot stayed). Pass the place's `members` and that pole is the row's *boarding
  point*, so a line boarding at two ids of one physical pole is one row — the display half of the fold.
  The surviving row comes back with its own raw id untouched.
- **`operatorsOf`** — the "served by" line, first-seen order, derived from the routes because a
  merged `P:` id has no operator of its own.
- **`orderPoles`** — pole groups (and their map dots) in three tiers: the pole the rider arrived
  from (`?pole=` — they have already named their kerb, so it outranks a nearer one they cannot board
  at), then nearest, then the server's own member order, which is arbitrary but *stable*, so the
  list does not rearrange itself when the GPS fix lands.
- **`poleSideOctants`** — a compass side on the heading of the poles that would otherwise print an
  identical one, and *nothing* where a side would be fake precision: no side under 10 m apart, and none
  at all for a group where two poles fall in the same octant. It labels 226 places and declines the
  rest on purpose (WP5-10).

`packages/core/spec/stop-detail.spec.json` pins all five against the shipped dataset. **One row is
`knownDefect`**: a later service-type variant with a *sooner* bus loses to the first one that merely
has a reading, so Nearby and Place detail can disagree about the next 269D. Read it before touching
the dedupe key.

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
