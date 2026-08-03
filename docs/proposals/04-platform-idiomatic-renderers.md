# 04 — Platform-idiomatic renderers: one spec, three UIs

> **Status:** proposal / work plan. Drafted **2026-08-03**, owner's decision, recorded as
> [ADR-075](../08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels).
> It **supersedes [ADR-002](../08-decision-log.md#adr-002--expo-rn--rn-for-web-pwa-first-native-later-ota)**
> and replaces [`docs/06`](../06-roadmap.md) Phase 3. Nothing here is built; this document defines the
> **format** of the specs and the **order** we write them, and it is deliberately the agenda for a
> component-by-component walkthrough rather than the specs themselves.
> **Launch is not blocked by any of it** — WP0-5 ships the Expo PWA first, unchanged.

## Thesis

The repo has spent five waves making the **kernel** portable — one wire contract, 742 corpus cases,
122 generated tokens, 123 generated strings, seven declared platform seams — on the premise that a
hand-written Swift and Kotlin client would otherwise re-derive the domain rules and diverge. That
premise is right, and it is also incompatible with the plan still written down in `docs/06` Phase 3,
which says native comes from the *same Expo codebase* with *no rewrite*.

Both futures are on `main` today. This proposal picks the one the work has actually been serving, and
draws the conclusion that follows: **if the shared artefact is the spec rather than the component
tree, then React Native's only remaining job is rendering the web app — and that is a job plain React
does better.** Each platform then gets an idiomatic UI (Material 3 on Android, the iOS material of
the day, a web middle ground) built against one executable specification.

The reason this is an improvement rather than a lateral move is narrower than "native looks better",
and it is the whole argument:

> **It makes "nothing drifts" mechanically checkable for the first time.** Today that invariant means
> *all platforms look and behave the same*, which nothing enforces and `react-native-web` already
> quietly fails: the slide/reveal transition is an instant cut on web ([ADR-043](../08-decision-log.md)),
> the liquid glass is Chromium-only ([ADR-028](../08-decision-log.md)), `hitSlop` does not apply, and
> `scrollTo()` is a silent no-op under reanimated v4. Moving the invariant to *every renderer satisfies
> the same executable spec* trades visual uniformity we do not have for functional equivalence we can
> gate.

There is a **second motivation and it is co-equal**: a design language and spec method that are written
down properly become the substrate for the *other* HK open-data apps the owner wants to build — a
nicer weather app over the HKO feeds is the named next one. That is what makes the abstraction worth
paying for rather than merely tidy, and it is also the biggest risk in the plan, so it gets its own
section below and its own deferral rule.

## What changes, and what does not

| | Before (ADR-002) | After (ADR-075) |
|---|---|---|
| Web | Expo / `react-native-web` PWA | **Plain React** (`apps/web`, Vite + Tailwind) |
| iOS | `expo run:ios` from the same tree | **Hand-written Swift**, separate repo, iOS-idiomatic |
| Android | `expo run:android` from the same tree | **Hand-written Kotlin**, separate repo, M3-idiomatic |
| Shared | the component tree | **the spec**: wire · domain rules · tokens · strings · component contracts |
| "No drift" means | the UIs match | **every renderer satisfies the same spec** |
| Enforced by | nothing | corpus + per-renderer conformance suites |

Unchanged, and worth stating because it is most of the system: `apps/edge`, `packages/contract`,
`packages/core`, `packages/data-normalize`, `packages/api-client`, `packages/ports`,
`packages/i18n`, `packages/ui`'s token declaration, the dataset pipeline, and every gate in
`pnpm boundaries`. This is a **renderer** decision. The kernel was built for exactly this and does
not move.

## The invariant / idiom line

This is the one genuinely new design decision, and the one most likely to go wrong — "the design is
somewhat flexible per platform" has to be **bounded**, or three UIs become three products. The
proposed line, for the walkthrough to confirm:

| Layer | Shared, and **identity** | Platform-idiomatic |
|---|---|---|
| **Content** | every string, its order, every cap and count — `packages/core` owns these and they are corpus-pinned | — |
| **Semantic colour** | `bg` · `text` · `muted` · `accent` · `positive` · `eta-*` · operator accents | — |
| **Type scale** | the [`docs/09`](../09-theme.md) §3 scale; **tabular figures** for any ETA digit | the face (Inter / SF / Roboto / platform CJK) |
| **Spacing** | the 4 px scale; touch targets ≥ 44×44 px; adjacent tappables ≥ 8 px apart | — |
| **Honesty rules** ([ADR-008](../08-decision-log.md)) | "Arriving"/"Due" under a minute · **no client-side countdown** · a staleness cue exists · never colour alone · no silent filtering | *how* the cue is drawn |
| **States** | that each of loading / empty / error / stale / offline is distinguishable and non-blank | their visual treatment |
| **Interaction targets** | which regions are tappable and where each goes | gesture idiom (swipe-back, predictive back, edge dismiss) |
| **Navigation** | the destination set and back semantics | bottom tabs vs nav rail vs whatever the platform does |
| **Accessibility** | every element's role and its label *content* | how focus order is expressed |
| **Material & elevation** | that depth is communicated at all | glass vs M3 surface tint vs shadow |
| **Motion** | intent, and reduced-motion behaviour | curve, duration, physics, whether it moves at all |
| **Shape** | — | radius and corner style |
| **Icons** | which concept each glyph denotes | the set (Lucide / SF Symbols / Material Symbols) |

**There is precedent for this exact split in the token layer already**, which is the best evidence it
will hold. `elevation` is declared once and consumed as `elevationStyle(level, Platform.OS)` — a
shadow geometry *plus Android's Material dp where the platform wants one instead* — and `glassShadow`
is declared **web-only**, with the note *"native glass lifts via its container's `e3`"*. One
declaration, per-platform recipe. WP3-1 made `ELEVATION` platform-neutral at source; this generalises
that shape rather than inventing one.

## What is already spec, and what has never been declared

The gap is much narrower than "specify the UI", and naming it precisely is what makes this affordable.
**Content is largely specified already. Structure, state, interaction and accessibility are not
specified anywhere, for any component.**

| Component (`apps/mobile/components`) | Content already pinned in `packages/core` | Corpus |
|---|---|---|
| `StopRow` | `displayName` · `stopCardCaption` · `stopCardView` · `nearbyView` | `stop-card` |
| `EtaBadge` · `EtaTimes` | `etaUrgency` · `etaReadout` · `etaLabelParts` · `isStale` · `formatClock` | `eta` |
| `RemarkTag` | `remarkView` · `classifyRemark` | `eta` |
| `StopName` | `splitStopCode` · `titleCaseName` | `stop-name` |
| `BearingArrow` | `bearingOctant` · `bearingOctantDeg` | `geo` |
| `Fare` | `formatFare` · `fareRange` · `fareStages` · `estimateChildFare` · `estimateElderlyFare` | `eta` |
| `RouteMeta` · `RouteFactSheets` | `formatJourney` · `formatHeadway` · `formatServiceHours` | `eta` |
| `BusToken` · `BusGlyph` | `inferBusMarkers` · `visibleBusMarkers` · `upcoming` | `route-position` |
| `RouteHeader` | `routeTerminusNames` · `isCircular` · `stripCircular` | `route-detail` |
| `MiniMap` | `lngToWorldX` · `latToWorldY` · `fitZoom` + the `TileSource` port | `mercator` |
| `RouteKeypad` · `FilterChips` | `buildRouteTrie` · `nextValidChars` · `searchRoutes` · `routeCategories` | `search` |
| `SaveStar` | `favoriteRouteKey` · `boardingPoleId` | `stop-detail` |
| Place-detail rows | `dedupeRoutes` · `operatorsOf` · `orderPoles` · `poleSideOctants` | `stop-detail` |
| `CollapsingHeader` · `StopHeader` | — | **none** |
| `BottomSheet` | — | **none** |
| `GlassView` · `GlassIconButton` | — | **none** (becomes idiom) |
| `Card` · `Text` · `Button` · `Icon` · `Skeleton` | — | **none** (token-level) |
| `WebSwipeBack` · `tabBarLayout` · `navTransitions` | — | **none** (becomes idiom) |

**The proof that the missing half is load-bearing is a bug this repo already shipped and found the
expensive way.** ADR-069's second finding — `remaining > 0 && onPress`, so a card showed 6 of 26
routes and *said nothing* when the count could not be tapped — was caught by **diffing two
renderers**, not by reading a specification, because no specification existed to violate. Under this
model it is one declared invariant: *the overflow count is rendered whether or not it can be tapped.*

The same hole explains two of the open items in [`docs/11`](../11-status.md): a favourite whose route
has no current arrival renders an **empty card**, and WP5-4's upstream outage **blanks a screen**.
Neither is a rendering bug. Both are states that nothing ever declared.

## The spec format

Prose is not an option, and this repo has the receipts. Its gate history is a list of checks that
passed because they were looking at nothing: `turbo` cached a gate whose input lay outside the
package hash ([ADR-070](../08-decision-log.md)); the literal rules fired on a stale `dist/` bundle,
i.e. yesterday's source; the generated native artefacts would have been compared only on the machine
that made them; and a field-reference gate was **built, tested against the failure it was for, and
deleted** because *"referenced" is not "rendered"*. `docs/09` §6 is already titled *"ETA display spec
(the signature component)"* and is already prose — and the imminence band it describes was
simultaneously written down **four times** with two different values until WP4-0 hoisted it.

So a component spec is **data, validated by a schema, consumed by a conformance suite per renderer** —
the shape `packages/core/spec/*.spec.json` already proves and that `packages/contract/native/`
templates already teach a porter to consume.

**Proposed location — deliberately two places, because they have different lifetimes:**

- **the format and the harness** in a new `packages/ui-spec`: the Zod schema a component spec must
  satisfy, plus the conformance walker each renderer drives. It carries **no NextBus vocabulary** —
  no stop, no route, no ETA — and it is the first thing a second app would copy. `packages/ports`
  was created for exactly this kind of reason (a declaration with no dependants of its own), and the
  precedent is worth reusing rather than re-arguing.
- **NextBus's own specs** in `packages/contract/ui/<component>.spec.json`, published beside
  `openapi.json` and `asyncapi.json`, because a native reader already starts at
  `packages/contract/README.md` and a component contract belongs in the same shipment.

Splitting them costs one small package now and saves an extraction later; both need a `layers.json`
entry before they have a file, the way `apps/web` did. A malformed spec is then a test failure rather
than a surprise in Xcode.

**Proposed shape**, mirroring the corpus (`module` / `doc` / `version` / named groups, each case
carrying a `why`):

```jsonc
{
  "component": "StopRow",
  "version": 1,
  "doc": "The compact stop card — the unit Nearby and Favourites are both lists of.",
  "viewModel": { "module": "stop-card", "type": "StopCardView", "corpus": "stop-card.spec.json" },
  "slots": [
    { "name": "headline", "source": "view.name.label", "required": true },
    { "name": "code",     "source": "view.name.code",  "required": false,
      "why": "Absent for a place whose upstream name carries no printed code." },
    { "name": "caption",  "source": "view.caption",    "required": false,
      "invariant": "Rendered verbatim — its two separator widths are semantic (ADR-069)." },
    { "name": "rows",     "source": "view.rows",       "required": true, "cap": "view.maxRows" },
    { "name": "overflow", "source": "view.remaining",  "required": false,
      "invariant": "Rendered whenever remaining > 0, WHETHER OR NOT it is tappable (ADR-069)." }
  ],
  "states": {
    "loading":  { "must": "a skeleton in the shape of the card", "mustNot": "an empty card" },
    "empty":    { "must": "the static timetable band or an explicit 'no service' line",
                  "mustNot": "a card with a name and nothing under it",
                  "why": "docs/11: a peak-only favourite renders blank and cannot be told from a broken key." },
    "failed":   { "must": "an explicit 'could not reach' cue and a retry affordance",
                  "mustNot": "reading as 'no buses' (WP5-4)" },
    "stale":    { "must": "the opacity.etaStale treatment AND a relative age", "mustNot": "colour alone" }
  },
  "interactions": [
    { "target": "headline", "goes": "place-detail", "note": "sibling of rows, never nested — invalid HTML on web" },
    { "target": "row",      "goes": "route-detail-at-stop" },
    { "target": "overflow", "goes": "place-detail", "optional": true }
  ],
  "a11y": {
    "role": "list item",
    "label": { "i18nKey": "a11yStopCard", "reads": "{name}, {n} routes, nearest {eta}" },
    "reducedMotion": "no entrance animation; content identical"
  },
  "idiom": ["material", "elevation", "shape", "motion", "iconSet", "divider treatment"]
}
```

Each renderer then carries a conformance suite that **walks the spec** and asserts against a rendered
tree. All three mechanisms exist already: `apps/web` renders in jsdom and reads back through a
projection; `apps/mobile` does the same with `react-native` aliased to `react-native-web`; and the
XCTest/JUnit templates in `packages/contract/native/` are the pattern for platforms three and four.
The two projections are **duplicated on purpose, not shared** — ADR-069 decision 7's reasoning holds
and extends: a shared helper lets one edit silently relax every renderer at once.

## Beyond NextBus: what is meant to be reusable

The owner's second reason for wanting this, recorded because it changes packaging decisions rather
than just motivation: **a documented design language and spec method should carry to other apps built
over HK's open data** — a nicer weather app over the HKO feeds is the named next one. That reframes
part of Wave 6 as building a *portable system* whose first consumer happens to be a bus app.

Being precise about what actually travels, because "reusable" claimed too widely is how a framework
gets built for one app and fits none:

| Tier | What | Travels to a weather app? |
|---|---|---|
| **The method** | the spec format + conformance harness · the DTCG token pipeline (one `tokens.json` → CSS + Swift + Kotlin, drift-gated) · ICU strings → `.strings`/`.stringsdict`/`strings.xml` with a brand making an English literal a **compile error** · `packages/ports`' seam pattern · `layers.json` + the gate chain and its selftests · the corpus-and-projection equivalence method · the shell (router · persisted query cache · locale · service worker) | **Yes, nearly unchanged.** This is the valuable asset. |
| **The principles** | [ADR-008](../08-decision-log.md) — *never fake precision*: no invented countdown, update only when fresh data arrives, label staleness, never colour alone, no silent filtering | **Yes, and it is the strongest thing here.** A forecast band, a tide time and an air-quality index all need exactly this rule; most weather apps break it. |
| **The design language** | the 3-layer token architecture · the type scale and tabular figures · the 4 px spacing scale and touch-target rules · elevation recipes per platform · motion tokens · the invariant/idiom line itself | **Mostly.** The *structure* travels; some *values* are re-chosen (a weather app wants a temperature ramp where this one wants operator accents, and Ink may not be its theme). |
| **The domain** | `packages/core`'s rules, `packages/contract`'s wire shapes, `packages/data-normalize`'s adapters | **No.** Different data, different rules. The *shape* of "a kernel with a corpus and no runtime dependencies" travels; none of its contents do. |
| **The components** | `StopRow`, `EtaBadge`, `RouteChip`, `MiniMap`… | **Barely.** A weather app has no stop card. `MiniMap` + the `TileSource` port and the LandsD tile proxy are the real exceptions and they are worth a lot — any HK gov-data app wants a map. |

**The caution, stated plainly: extracting a shared framework while exactly one app exists is the
classic way to build the wrong abstraction.** The rule I would hold to is the rule of two — build
Wave 6 concretely for NextBus, keep the seams named and free of domain vocabulary, and **extract only
when the second app actually needs a thing**. Designing for extraction now is nearly free; extracting
now is speculative, and this repo's own standard is that a claim is exactly as large as what has been
run.

One genuine dividend worth noting, because it is an argument for doing this at all: **a plain
React + Tailwind design system is far more portable to a new app than an Expo/NativeWind one.** The
web-first stack is the one a second app would start from, and every hour of the RN-web tax itemised in
[ADR-075](../08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)
is an hour that would be paid again per app.

## The order we walk it

Two rules govern the sequence, and they are the difference between this working and this being a
rewrite with extra steps.

1. **Every spec is extracted from the working RN renderer while it still exists, and both renderers
   must pass it before the RN one goes.** Delete first and the spec becomes *what I remember the app
   did* — and an incomplete spec is worse than none, because it reads as complete. This is WP4-0 →
   WP4-1 ("hoist, then render") generalised; it has already caught two bugs.
2. **Retrofit Nearby first.** Two renderers already exist for it and already agree, so writing its
   spec validates the *format* for free: if the format cannot express a screen that demonstrably
   works, the format is wrong, and we learn that in an afternoon instead of at screen five.

| # | Screen | Why here | The interesting question it settles |
|---|---|---|---|
| 0 | *(none)* — the shell | `apps/web` has no router, no persisted query cache, no locale provider, no service worker | Nothing. It is invisible progress and it is unavoidable. |
| 1 | **Nearby** | already two renderers, already agreeing | Does the spec format hold? |
| 2 | **Place detail** | the most domain rules in the app — `orderPoles`, `dedupeRoutes`, the kerb keying, `poleSideOctants`, the live merge | Can a spec carry a *multi-level* screen, and does it close ADR-069's asymmetry (`check-no-derivation` is web-only until Place and Route detail get their own WP4-0)? |
| 3 | **Favourites** | reuses the card; owns the empty-state bug and the one-line-two-kerbs residual (WP5-12) | Do declared states actually close known bugs? |
| 4 | **Search** | the keypad, chips and recents are pure interaction over a spec'd index; never walked in a browser | Interaction-heavy specs. |
| 5 | **Route detail** | the schematic, the bus tokens, the collapsing header, the auto-scroll | **The motion test** — the first screen where "motion is idiom" is a real claim rather than a slogan. |
| 6 | **Settings · About · FAQ** | mostly chrome and prose | Cheap; last. |
| 7 | *(none)* — retire `apps/mobile` | when every screen's spec passes on both renderers | Nothing, if 1–6 were honest. |

`workbench.tsx` moves with the token layer, not with a screen; it is the cheapest place to keep the
gallery of every component in every state, and under this model it becomes the spec's own viewer.

## The walkthrough agenda

What each session produces, so a session can end somewhere. Per component, in the order its screen
appears above:

- [ ] **Confirm the view model.** Which `packages/core` function owns its content, or — if none does
      — a WP4-0-style hoist first. No spec may contain a derivation.
- [ ] **Enumerate slots**, each with its source field, whether it is optional, and *why* it can be
      absent (the `why` is the part that survives; a bare `required: false` teaches nobody).
- [ ] **Declare all five states**, including what each **must not** look like. Every known bug in
      `docs/11` becomes a `mustNot` with a citation.
- [ ] **Declare interaction targets and destinations**, plus the sibling-not-nested rule where it
      applies.
- [ ] **Declare the a11y role and label content**, sourced from an `@nextbus/i18n` key so it cannot
      be an English literal.
- [ ] **Name the invariants that a renderer could plausibly get wrong** — the ADR-069 overflow rule is
      the template. If we cannot think of one, that is a signal the component is trivial, not that it
      is safe.
- [ ] **Name what is idiom**, explicitly and by enumeration, so "flexible" has edges.
- [ ] **Write the conformance case in both suites and watch it fail** against a deliberately broken
      renderer, per the standing rule.

## Work packages

Waves 0–5 are spent; this is **Wave 6**.

| ID | What | Acceptance | Size |
|---|---|---|---|
| **WP6-0** | The `apps/web` shell: router, `PersistQueryClientProvider` + storage persister, `LocaleProvider` + override, theme store, Workbox service worker, `build:web` | The PWA opens offline on `apps/web` and switches locale, with **zero screens ported** — measured the way ADR-058 was (kill the static server *and* the Worker, cold-load) | L |
| **WP6-1** | The spec format: `packages/ui-spec` (schema + conformance walker, no domain vocabulary, in `layers.json` before it has a file), `contract/ui/*.spec.json` emitted + drift-gated, and both renderers driving the walker | `StopRow`'s spec is retrofitted to the **existing** two renderers and both pass unmodified; the gate fails on an injected slot deletion, **watched**; `tsc --outDir /tmp` proves `ui-spec` names nothing bus-shaped | M |
| **WP6-2** | Nearby: complete spec + both suites green | Every ADR-069 finding is a declared invariant with a case; `apps/web`'s Nearby is the shipping web Nearby | M |
| **WP6-3** | Place detail: WP4-0-style hoist of anything left deriving, then spec, then port | `check-no-derivation` extends to `apps/mobile`'s Place detail — closing ADR-069's recorded asymmetry | L |
| **WP6-4** | Favourites: spec + port | The empty-card bug and WP5-12's one-row-for-two-kerbs are closed **by declared states**, not by a patch | M |
| **WP6-5** | Search: spec + port | Walked in a browser for the first time — the visual pass `docs/11` has owed since ADR-037 | M |
| **WP6-6** | Route detail: spec + port; the motion contract | Reduced-motion is asserted; the schematic's intent is declared and the web curve is *chosen*, not inherited | L |
| **WP6-7** | Settings · About · FAQ | Ported; the stale `faqOfflineA` strings refreshed at the same time | S |
| **WP6-8** | Retire `apps/mobile` | Every spec green on `apps/web`; `expo`, `react-native`, `nativewind`, `reanimated`, `gesture-handler` leave the lockfile; `packages/ui` keeps generating for three platforms | M |
| **WP6-9** | The first native repo consumes `contract/ui/` | One screen in SwiftUI passing the same specs — **the honest test of the whole thesis**, and the first time the Swift/Kotlin token artefacts are compiled at all | L |
| **WP6-10** | *(deferred by the rule of two — do **not** start it during Wave 6)* Extract the portable system for a second app | A second app exists and **needs** a thing; then `ui-spec`, the token pipeline, the i18n pipeline, the gate chain, the shell and the `TileSource`/LandsD proxy move to a shared home, and NextBus consumes them at arm's length. Until then the acceptance is a **named seam**, not a package | L |

## Risks, and what we are accepting

- 🔴 **Three visual designs means design review and QA triple, forever.** This is the real recurring
  price of platform-idiomatic and it is paid every change, not once. Naming it is not mitigating it.
- 🔴 **Corpus vendoring is still unsolved and this makes it bigger.** `docs/11` already carries it as
  the one hole in the corpus-rot story: nothing here can enforce that a native repo's copy of the
  corpus is current, and a stale copy yields a *green* suite pinning a moved rule. Adding
  `contract/ui/` to what a native repo must vendor **enlarges the unenforced surface**. WP6-9 must
  not start before it is answered.
- 🟠 **A shared spec is a shared bug.** This fixes divergence, not wrongness: a spec that is wrong is
  now wrong identically on three platforms. That is the same trade Wave 2 made when it pinned four
  `knownDefect` rows rather than fixing them, and it was right then for the same reason — identical
  and visible beats different and hidden.
- 🟠 **"No drift" is being redefined**, from visual to functional. Since drift is the owner's stated
  top priority, this is a decision to take deliberately rather than discover later. It is recorded as
  ADR-075 decision 4 for exactly that reason.
- 🟠 **WP6-0 buys nothing a rider can see**, and it is the largest single package before any screen
  moves. The temptation will be to port a screen first and bolt the shell on after; that ordering
  makes every screen's spec provisional.
- 🟡 **`apps/web` stops being an independent second renderer** the moment it becomes the only web one,
  and `apps/mobile/test/stoprow-projection.test.tsx` goes with `apps/mobile`. The corpus survives as
  the specification, and WP6-9 restores genuine independence — but between WP6-8 and WP6-9 there is
  exactly one renderer measured against the spec, which is weaker than today. Sequencing WP6-9
  earlier is the mitigation if it looks affordable.
- 🟠 **Building the portable system before a second app needs it.** The reusability goal is real and it
  is also the strongest pull toward premature abstraction in this plan: every "make it generic"
  decision taken with one consumer is a guess. The discipline is WP6-10 — name the seam, keep domain
  vocabulary out of `ui-spec`, and extract on demand. A `ui-spec` that has grown a `stopId` is the
  early warning.
- 🟡 **TypeScript 6.0.3 vs 5.9.3** resolves itself: the divergence exists because `apps/mobile` follows
  the Expo SDK. Recorded as an incidental win, not a reason.

## What this proposal does not do

- **It does not block or reorder launch.** WP0-5 ships the Expo PWA. The deploy work is almost
  entirely Worker, domain, KV/R2 and the publish pipeline; the app-hosting half is
  `expo export -p web` → Pages versus `vite build` → Pages, and swapping that later is a small,
  contained change. Migrating before there are riders is how a project does not launch.
- **It does not touch the kernel, the contract, the edge or the dataset.** If a work package here
  finds itself editing `packages/core`, that is a WP4-0-shaped hoist and belongs in its own commit
  with corpus cases.
- **It does not decide the iOS or Android visual language.** "Liquid glass" and "Material 3" are the
  intent; what each actually ships is the native repo's call, bounded by the table above.
- **It does not promise the Swift and Kotlin artefacts work.** Four are generated and **none has ever
  been compiled** ([ADR-067](../08-decision-log.md)). That claim stays exactly this size until WP6-9.
- **It does not build a second app, and it does not extract a framework.** The portable system is
  designed for and seams are named; WP6-10 is where extraction happens, and it waits for a real second
  consumer. A weather app over the HKO feeds is the intent, not a Wave 6 deliverable.
