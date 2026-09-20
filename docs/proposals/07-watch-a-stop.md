# 07 — Watch a stop

> **Proposal, nothing built.** Written 2026-09-20 to the owner's ask: *from a stop's menu on Route detail,
> **Watch** it; a floating pill at the bottom of the screen then shows that stop and when the next bus is
> due, and a tap expands it into a richer card.* The point is to keep an eye on one route-at-stop **while
> you carry on using the app**.
>
> §§1–2 are what exists and what it costs. §3–§4 are the design rounds; **§4c ends with the shape the owner
> chose**. §5 is the eight decisions that have to be made before any of it is code; §6 records the decision;
> §7 is how it lands in the architecture.
>
> **§4b is round 2** (the tab bar's removal, and why D's rail should not exist); **§4c is round 3** — the
> settled shape: A1 sharing the row with the search lens, no chevron, opening upward into C2, with the
> widths measured at 390 px.
>
> Interactive mockups: [round 1](./mockups/watch/index.html) — five pills, three cards ·
> [round 2](./mockups/watch/round-2.html) — four readings of A with no tab bar, three restyled cards ·
> [round 3](./mockups/watch/round-3.html) — the settled shape, measured at 390 px.
> Both carry a state switcher that puts every arm (Due · stale · nothing due · board failed · offline)
> through every shape.

---

## 1. What a watch is, in one sentence

**A watch is a favourite you are using right now.** Its identity is the same pair a favourite already has —
`formatFavoriteRouteKey(poleId, routeId)`, the route-at-stop tuple of ADR-042 — and the wire already agrees:
`WatchTarget` is `{ stopId, routeIds? }` and `packages/contract/src/wire/live.ts` says out loud that *"a
Widget watching a saved favourite maps 1:1 onto a live target"*. So the feature is not a new data shape. It
is a **second place the same reading is drawn**, which outlives the screen that created it.

That framing decides two arguments before they start:

- **A watch is not a favourite.** A favourite is *"this matters to me on most days"*; a watch is *"I am
  catching this one, now"*. Different lifetimes (§5.2), different affordances, and the sheet should offer
  both — it already offers the star.
- **A watch is a board, not a figure.** It has its own `dataTimestamp`, so it owns a staleness sentence of
  its own (ADR-133/150 put that sentence at screen level and banned the per-figure cue; a floating board is
  a screen-sized thing for this purpose). §5.4.

## 2. What already exists, so this is smaller than it looks

| Need | What answers it | Note |
|---|---|---|
| Live times for one route at one pole | `source.watch([{ stopId, routeIds: [routeId] }])` | The narrowed single target the batch path was built for (ADR-079). One target is the cheapest thing the socket engine can be asked for. |
| Identity + persistence key | `formatFavoriteRouteKey` / `parseFavoriteRouteKey` (ADR-042, migration ADR-089) | Same grammar, same migration, no new id scheme. |
| Reading a time honestly | `etaReadout`, `routeStopBoard` | The pill and the sheet behind it then cannot disagree, which is what WP6-6a's *"two spellings eleven lines apart"* lesson is about. |
| The staleness sentence | `feedNotice` + `FeedNotice` | Already on four screens in both renderers. |
| "Leave in N min" | `walkMinutes` (`geo#walkMinutes`, corpus-pinned) + the location controller | The backlog's P13, unlocked by having a watched stop to measure against. |
| Where the bus is | `inferBusMarkers` / the route rail vocabulary | Only if the pill wants §3-D's rail. |
| Expanding container | `components/sheet/DraggableSheet` + `detents.ts` | Already detent-based, already has no NextBus vocabulary in it, already tested as numbers. |
| Room at the bottom of every screen | `shell/layout.ts` (`TAB_BAR_HEIGHT`, `CONTENT_INSET`) | The watch adds a second floating object, so this file grows a `WATCH_INSET` and every screen's padding is derived from it rather than re-guessed. |
| The entry point | `RouteStopSheet` | A third `SheetAction`, beside *Add favourite* and *View stop*. |

**New code is a kernel view function, one component per renderer, one store field and one layout constant.**
Nothing in `packages/ports` changes — a watch needs no platform capability the app does not already have.
(Notifications would; §5.8.)

## 3. Five pills

Open the mockup and use the **Board says** chips — most of the difference between these shows up in the
unhappy arms, not in *"3 min"*.

### A — Boarding pass
Full-width bar above the tab bar: livery badge · stop name · `→ destination` · the lead figure, with a
chevron.
**For:** says everything without being opened, which is the whole ask — you can glance and not tap. Reads as
a "now boarding" strip, which is a familiar object.
**Against:** costs ~56 px of every screen plus its gap, on top of the 54 px bar. On Nearby that is one card
row gone.

### B — Capsule
Hugs its content, centred: badge · `3 min`.
**For:** the cheapest thing that can be on screen. Never competes with content.
**Against:** no stop name, so two watches are indistinguishable and a rider who set it ten minutes ago has
to tap to remember what it was. In the failed/offline arms it either grows unpredictably or truncates a
sentence that matters.

### C — Docked to the tab bar
The pill sits flush on top of the bar, sharing its glass and its shadow: one stack, two rows.
**For:** adds no new floating object — the strongest version of "this is chrome, not content", and the
answer that keeps the screen's own bottom inset honest (one object to clear, not two).
**Against:** the floating bar is *signature* material under ADR-075/`layout.ts` — growing it changes the
app's silhouette. And **pushed screens have no tab bar to dock to** (Place, Route, Search, Settings…), so it
needs a second, undocked shape anyway, which is A.

### D — Progress rail  ★
A, plus a 3 px rail underneath: the stops between the bus and you, with the bus token positioned on it and
*"2 stops away"*.
**For:** the only variant that answers the question a watcher actually has — *is it actually coming, or is
the number just ticking down?* It reuses the schematic vocabulary the app already owns (the rail, the bus
token, ADR-093/095) rather than inventing a new one, which is also why it costs little to draw.
**Against:** ~22 px more than A. Honest only where we know the bus's position — KMB gives us a whole
route's board, Citybus and GMB do not without the route watch (ADR-116/119), so the rail has to be able to
**not be there**, and the pill must not look broken when it isn't.

### E — Bubble
A 62 px token in a corner, draggable between corners, PiP-style.
**For:** takes almost nothing and never covers a row.
**Against:** a bare number with no stop beside it is the least honest readout here — and a draggable thing
that occludes content is a new interaction to design, maintain and port. I would not ship it first.

| | Screen cost | Says the stop | Says *is it coming* | Works on pushed screens | Port cost |
|---|:--:|:--:|:--:|:--:|:--:|
| A Boarding pass | 68 px | ✅ | — | ✅ | low |
| B Capsule | 50 px | ❌ | — | ✅ | low |
| C Docked | 62 px | ✅ | — | ❌ (needs A too) | medium |
| **D Progress rail** | 90 px | ✅ | ✅ | ✅ | medium |
| E Bubble | 74 px | ❌ | — | ✅ | high |

## 4. Three cards

### 1 — Mini board
Three arrival slots, then the schematic: the stops still to come, where the bus is, which side of the road
(`ADR-080`'s *"check the sign"* line). Actions: *Open route · Open stop · Stop watching*.
The pill's content plus the thing it had no room for. Cheapest, and composes with any pill.

### 2 — "Leave in…"  ★
The board, plus one sentence: **your walk time against the lead figure** — *"Leave in 1 min · 4 min walk"*.
This is the backlog's P13 and it is the only line here that changes what a rider *does*. It needs a location
fix and must say nothing at all when it has none (never a fabricated distance — ADR-008's rule generalises).

### 3 — Drag to the whole stop
The card is a `DraggableSheet` with three detents: pill · card · full. Dragged up it becomes the pole's
**whole** board, so the watch doubles as a shortcut back to the stop.
**For:** one component, one gesture vocabulary, already built and already tested as numbers.
**Against:** the full detent duplicates Place detail. If the card can get you there in one tap, the third
detent may be a solution to a problem *Open stop* already solves.

## 4b. Round 2 — the tab bar is going, and D's rail is not the way to say D's thing

> Mockup: [`mockups/watch/round-2.html`](./mockups/watch/round-2.html). Written after the owner's round-1
> read: *A or D; D is more interesting but maybe too busy; and the tab bar is being removed.*

**Three things changed the answer.**

**1 — D's rail is a second route line, and this app has just finished making the route line mean one thing.**
[ADR-161](../08-decision-log.md#adr-161--the-rail-is-the-route-line-and-the-chevrons-come-with-it) gave the
rail `color.semantic.route` — an *alias* of the map's own line colour — precisely so the schematic in the
list and the line on the map are two views of one object, and ADR-163 then dimmed it so it reads as
geography rather than furniture. A 300 px rail in a floating pill, with five abstract dots standing for a
44-stop route, would wear that vocabulary **without being an instance of it**: same colour, same token, a
different meaning and a different scale. That is the drift the whole rail-as-route-line exercise was about,
and "too many rails everywhere" is the correct instinct.

**2 — D's *information* survives without D's rail.** The rail's real payload is one fact: **how far away the
bus is.** That fits in the sub-line the pill already has — *"2 stops away · → Chuk Yuen Estate"* — at zero
extra height, and it is **honest by omission**: where we do not know the position, the clause simply is not
there, where an empty rail would look broken. This is **A2** in round 2, and it is the recommendation.
A3 keeps a trace of the ambient version (a 3 px fill along the pill's own bottom edge, no dots, no token) for
anyone who wants the glanceable version of the same fact; my own read is that an unlabelled bar is a chart of
a number the line above it already states.

**3 — With no tab bar, the pill inherits the bar's geometry rather than stacking on it.** It sits at
`TAB_BAR_GAP` (12) with the bar's radius and material — so `shell/layout.ts` does not grow a second
constant, it **retargets the one it has**. Two consequences fell straight out of drawing it:

- **The search lens cannot share the pill's row.** The lens was never navigation, so it survives the bar's
  removal — but beside the pill at 360 px it costs the stop name (*"Nathan R…"*). It stacks **above** the
  pill instead, and fades out while the card is open.
- **A sentence must never land in the figure slot.** In the *board failed* / *offline* arms, *"Live times
  unavailable"* in the figure position squeezed the stop to *"Nathan Roa…"* — and the stop's identity is the
  one thing that must not truncate, because it is *what you are watching*. The rule the mockup now follows:
  **sentence arms ride the sub-line**, and the figure slot shows a muted `—`. That is a kernel decision
  (`watchView` returns `lead: {kind:'figure'|'absent'}` and `note`), not a CSS one.
- **A4 (the next time too) costs the stop name as well** — *"then 11 · 24"* needs the width the name is
  using. If the second figure matters more than the full name, that is a real trade; my read is it belongs
  in the card, which is one tap away.

### The card, round 2

C1 (round 1's boxed slots) is five bordered objects inside a bordered object. **C2** drops the boxes: the
lead time at 40 px, the rest as a quiet clause beside it (*"then 11 min · 24 min · last one scheduled"*), the
walk line under it, and then the named **next three stops** — which is where a rail *does* belong, because at
card width it carries **real stop names**, which makes it an instance of the route line rather than a
decoration of one. Actions demote from filled pills to a text row, and **"Stop watching" loses its red**:
`accent` is a livery colour here, not a danger colour, and nothing about ending a watch is destructive.
**C3** is C2 without the stops, for comparison — four lines, and still answers *where is it*.

## 4c. Round 3 — the settled shape, and two things measured rather than argued

> Mockup: [`mockups/watch/round-3.html`](./mockups/watch/round-3.html), at **390 px** — an iPhone 15's CSS
> width, so every truncation shown is one a rider would get.

**"2 stops away" is withdrawn.** The owner's objection is decisive and the ADR-161 argument was only half
the reason: HK stop spacing runs from about **1 to 10 minutes**, so a stop count is not a duration, and put
beside a figure that *is* one it will be read as one. *"2 stops away"* on Nathan Road is 90 seconds; on Tolo
Highway it is a quarter of an hour. **A1's second line — the destination — is the shape.** That also drops
the last reason to want a rail anywhere near the pill.

**The pill shares the row with the lens, and rises to open.** The owner's fix, and it beats round 2's
stacking: pill and lens sit in one 58 px row; a tap lifts the pill to `bottom: 82` and out to the full width,
so the card is never squeezed by a button and the lens is never covered. One motion, two properties, the
`DraggableSheet` easing.

**Measured at 390 px** (the numbers, because they decide the design):

| Layout | Pill width | What fits |
|---|--:|---|
| Pill + lens, with chevron | 296 px | *"Nathan Road / Jordan…"* — **truncates** |
| Pill + lens, **no chevron** | 296 px | *"Nathan Road / Jordan Road"* whole ★ |
| Podcasts dock: tabs + pill + lens | **226 px** | the stop name truncates in **every** arrangement |

Two conclusions follow:

- **The chevron goes.** It is 19 px of decoration on a control whose whole surface is the target, and those
  19 px are exactly the difference between a stop name fitting and not. The card's own handle is what says
  *"this opens"*.
- **The podcasts dock costs the stop name outright.** At 226 px no rearrangement recovers it — one line,
  no chevron, destination moved into the card, and it still truncates. So if that dock happens, the pill
  should stop pretending: **badge and figure only** (round 1's B), which is honest at that width and reads
  cleanly. That makes the pill **one component at two densities, chosen by the width it is given** —
  `full` when it owns the row, `compact` when a dock shares it. The kernel returns both readouts; the
  renderer picks on measured width, which is the same shape as `shell/layout.ts` deriving insets rather than
  re-guessing them. Worth knowing before the dock is built: **the dock is not free, and its price is the one
  fact the pill exists to carry.**

**The card is C2**, agreed. One change since round 2: the first line under the readout is the **stand and
direction** (*"Stand B · towards Mong Kok"*, ADR-080) — it is genuinely useful while you are walking to the
pole, and it is the thing the second line of the pill no longer says.

## 5. Eight decisions, before any of this is code

1. **One watch or several?** A pill is singular; three pills is a second tab bar. I would ship **one**, and
   choose a pill shape whose card could later hold two or three (the card can stack; the pill cannot).
   Watching a second stop replaces the first, with the swap visible rather than silent.
2. **How long does a watch live?** Three options: *session* (gone on reload — cheap, and loses a watch when
   a PWA is backgrounded on iOS); *persisted for ever* (becomes a worse favourite); **persisted with an
   expiry** — my pick, ~90 minutes of inactivity, because a watch is about a journey and a stale one on
   tomorrow's launch is chrome nobody asked for.
3. **Where does it live?** In the shell, beside `TabBar`, not inside a screen — otherwise it unmounts on
   navigation, which is the one thing it exists not to do. That also means **`shell/layout.ts` owns its
   height**, and every screen's inset is derived (the file's own note: the bar is out of flow, so the bar
   and every screen have to agree).
4. **What does it say when the board is old, empty or broken?** The four arms in the order ADR-088 fixed —
   *loading* → *incomplete* → *readings* → *no service* — never collapsing "waiting" into "nothing due".
   Staleness is **one sentence on the pill**, from `feedNotice`, never a mark on the figure (ADR-123/133/150).
   The mockup's state chips are exactly this, and are the fastest way to judge the five shapes.
5. **What happens on the screen that already shows that board?** Watching pole X while standing on X's Place
   screen (or on the route row it came from) is duplicated chrome. I think the pill should **collapse to a
   marker or hide** there, and that this is a rule in the kernel (`watchView.redundant`), not a screen-local
   `if`.
6. **What does a screen reader hear?** A figure that changes every 45–60 s must not announce every round —
   that is hostile. Proposal: the pill is a labelled `role="status"` region that is **silent by default** and
   announces only on a **threshold crossing** (becomes *Due*, becomes unavailable), with the full readout
   available on focus. This is a design decision, not a detail: `aria-live="polite"` on a ticking number is
   the default and the wrong answer. (And note ADR-097: `react-native-web` drops `accessibilityState`, so
   the native twin has to be checked separately.)
7. **What happens on a screen that already owns the bottom edge?** Route detail is a map with a
   `DraggableSheet` over it (ADR-156), and it is **the screen a watch is created from**. Only the tabs
   layout applies `CONTENT_INSET` today — every pushed screen is full-bleed — so a pill placed by the shell
   would float over that sheet and be swallowed whenever the sheet is dragged to `list` (0.88). Three
   answers: *hide* the pill on any screen that declares it owns the bottom (simplest, and on Route detail
   it is usually redundant anyway — §5.5); *compact* it to badge-and-figure and tuck it beside the sheet's
   handle; or *let the sheet know*, shortening its detents by the pill's height. My pick is **hide on a
   bottom-owning screen, declared by the screen rather than inferred**, with §5.5's redundancy rule doing
   the rest. This needs deciding before the shell component is written, because it decides whether the pill
   is placed by the shell or by each layout.
8. **Does it ever notify?** *"Tell me when it's 5 minutes away"* is the obvious next ask and is a **different
   feature**: it needs a `Notifier` port, permission, and — to work when the app is closed — a server-side
   subscription. Out of scope here; the shape above does not block it.

## 6. What I would build

**DECIDED (2026-09-20, owner): round 3's S2 and S3** — the pill shares the bottom row with the search lens,
**no chevron**, showing badge · stop · `→ destination` · lead figure; a tap **rises it above the lens** to
`bottom: 82` and out to the full width, opening into **card C2**. No third detent until someone misses it.

(Round 1 proposed pill D, round 2 A2; §4b retired the rail and §4c retired *"2 stops away"* with it. What
is left is the shape the owner described first, with two measured corrections: the pill shares the row and
rises to open, and the chevron is what pays for the stop name.)

- **A1** because every richer collapsed state has now been drawn and each costs more than it returns: a
  rail duplicates a vocabulary that means something else (§4b), a stop count is a distance dressed as a
  duration (§4c), and a second figure costs the stop's name. Badge · stop · → destination · lead figure.
- **C2** because *"leave in 1 min"* is the only line in this whole proposal that a rider would repeat to
  someone else, and because the named next stops are a rail that earns its colour. With no location fix the
  walk line is absent; with no known position the stops are.
- **One watch, expiring after ~90 minutes**, created from `RouteStopSheet` and cleared from the card.

**The smallest honest first row** is narrower than that: pill A1, card C3, one watch, session-scoped, web only
— which is `watch()` + one component + one shell constant, and is worth shipping alone because everything
above is additive to it.

## 6b. What exists now (2026-09-20) — the spec, before either renderer

The owner's call was **spec first**, and this is what that produced. It is committed and gated; no
component exists yet.

| Artefact | What it is |
|---|---|
| `packages/core/src/watch.ts` | `watchView` and `watchExpired` — every decision §5 named, in one place. |
| `packages/core/spec/watch.spec.json` | 21 corpus rows over both, replayed by `packages/core/test/watch.test.ts` and by the emitted Swift and Kotlin suites. 100 % branch coverage; no `knownDefect`. |
| `packages/contract/src/ui/watch-pill.ts` → `ui/watch-pill.spec.json` | The collapsed pill: 18 slots, 6 states. |
| `packages/contract/src/ui/watch-card.ts` → `ui/watch-card.spec.json` | The card: 28 slots, 6 states. |
| `packages/core/src/route-detail.ts` | `routeStopEta` extracted from `routeStopBoard`'s decision 3, with its own corpus group — see below. |
| `packages/i18n` | Eight catalogue keys, three locales, native strings re-emitted. |
| `apps/web/lab/specIndex.ts` | Both specs in the gallery, so the first implementer reads the contract before writing it. |

**Three things the spec-writing decided that the design rounds had not**, which is the argument for this
order — WP6-3b and WP6-4 both found real defects *while writing a spec for code that already shipped*, and
this is the first component where the finding costs nothing to act on:

1. **The pill's second line is total.** It was going to be *"a note, or `null` meaning show the
   destination"*. A `oneOf` over a discriminant that is sometimes absent has no case to select, and this
   format treats an unmatched value as a hard failure — correctly. So `subLine.kind` now includes
   `destination` as a *case*, and the fallback two renderers would each have implemented does not exist.
2. **"Leave now" is a boundary, not a floor.** `leaveInMin` had been `max(0, minutes − walk)`. Written out
   as a state, that says *"leave now"* to a rider four minutes from a kerb the bus reaches in one — a false
   reassurance of exactly the kind ADR-008 rules out. It is now absent below zero, kept at zero, and the
   card declares a `cannotCatch` state whose whole content is that there is no line.
3. **`routeStopEta` wanted extracting.** The pill needs the *reading* (for `remarkKind`, the
   timetable-versus-sighting cue), not only its formatted times. Restating the "which reading belongs to
   this pole" rule would have been two callers able to disagree about **which bus** — so it is one exported
   function now, pinned by its own corpus group, and `routeStopBoard` calls it.

**One dead branch was deleted rather than tested**: a `hasDeparted` guard in the walk arithmetic that
`upcoming` makes unreachable. ADR-155 is the reason that is worth a sentence — a module sat at 87 % branch
coverage with a dead branch in it while an ADR claimed 100 %.

**Still owed before a rider sees any of this:** the `WatchPill` / `WatchCard` components, the store field
(modelled by **both** stores in the same change — `partialize` erases what it does not model), the
`RouteStopSheet` action, the subscription wiring, and an ADR in `docs/08` recording the decisions above.
The ADR number is claimed at commit time, not now (ADR-127).

## 7. How it lands in the architecture

- **Kernel first.** `packages/core/src/watch.ts`: `watchView({ watch, etas, failed, now, locale, fix })` →
  `{ badge, stop, destination, lead, slots, notice, rail?, leaveIn?, redundant }`. Every decision in §5.4–5.5
  is in there, corpus-pinned (`spec/watch.spec.json`), because both renderers and both future native suites
  must make them identically. **Grep before writing any of it** — `routeStopBoard`, `etaReadout`,
  `feedNotice` and `walkMinutes` already exist and this function's job is to *join* them (ADR-054: the words
  are injected, not imported).
- **Then the spec.** `packages/contract/src/ui/watch-pill` and `watch-card` → `ui/*.spec.json` via
  `pnpm --filter @nextbus/contract ui:emit` (ADR-083). The states are §5.4's arms plus `redundant`.
  Spec-writing is where the defects get found — that is the record of WP6-3b and WP6-4.
- **Then the shell.** `apps/web/src/shell/WatchPill.tsx` beside `TabBar.tsx`; `WATCH_HEIGHT` /
  `CONTENT_INSET` in `shell/layout.ts` — **derived, never re-guessed**, and the RN twin reads the same
  numbers.
- **The store field is modelled by both stores in the same change.** `partialize` writes the whole blob, so
  a field one store does not model is *erased* — that is WP6-4's lesson and ADR-125's, and a watch field
  added to one store only would delete the other's watch. Merge rules are `mergePreferences`'.
- **The gates.** A new component under a policed path is automatically in scope for `check-no-derivation`
  (it must derive nothing — the view comes from the kernel), `check-no-raw-colours` and
  `check-view-transport-free`. The pill subscribes through `DataSource`, so rule 2 holds without argument.
- **One ADR when a shape is chosen** — number it against `docs/08` at commit time, not now (ADR-127: a
  number is a permanent address, and another workspace may have claimed the next one).

### Cost, honestly

One extra live subscription that runs on screens making no other request. On the socket engine that is one
extra target on a shared, hibernating `EtaHub` — negligible. On the **poll emulator** (still the default
transport for `watch()`, though the route watch now defaults to the socket) it is one `/v1/etas?ids=…` round
per cadence for as long as the watch lives, which is the argument for the expiry in §5.2 and for **one**
watch rather than five.
