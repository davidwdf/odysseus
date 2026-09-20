# 07 — Home, and a shared design language

> **Brainstorm, nothing built.** Written 2026-09-09 at the owner's request: *"revamp and improve the
> Nearby/Favourites sections — or replace Nearby with a Home that merges both"*, and *"I really like where
> we've gone with the route detail page — the rail design, map integration, collapsing glass header — I want
> to pull some of those elements into a more consistent design language across the other pages."* Followed
> by: *"I am open to revamping more of this app/UI components and data structures (if need be), but as a
> reference point, I quite like the Route detail UI & UX."*
>
> This resumes [`docs/07`](../07-backlog.md)'s row **"Does the app need a bottom tab bar? — the owner's
> brainstorm, and the biggest question on this list"** (2026-08-12), which listed five pieces and has been
> sitting since. Route detail has been built in the meantime, which changes the answer: we now know what the
> app's design language *is*, so this is no longer speculation about a shape — it is a question about how far
> to carry a shape that exists.
>
> **§0 carries the owner's answers (2026-09-09): merge, rungs 1–3, Home gets a map, and the saved list is
> *checked* — from two different situations, which changes the ranking. Two questions are still open and
> are restated plainly in §11; nothing starts until they are answered.**
>
> §§1–3 are the diagnosis and the fork. §4 is the ladder of how far to go. §§5–9 are the pieces, including
> **§7e — one map for the whole app**, the owner's Transit model, costed. §10 is what to reject.

---

## 0. Answered by the owner (2026-09-09)

The five questions in §11 went back the same day. Three are settled, and one of the answers changes a
recommendation rather than confirming it. Recorded here at the top because everything below was written
before them.

**Q1 — how far up the ladder? → rungs 1–3.** Rung 4 (the departure board / `DepartureView`) is not in
scope; it stays behind mockups. §6's data-structure question is therefore **deferred, not rejected** —
`StopCardView` stands for this slice.

**Q2 — is the saved list checked or tended? → checked, often. And there are *two* occasions, not one:**

> *"finding them quickly when you're nearby — or to check when the next bus is coming before leaving the
> office/house."*

This is the answer that moves things. §9's "curation surface" reading is **wrong** and is withdrawn. But
the more useful half is the second occasion, because **it is not a nearby query at all**: a rider standing
in an office checking the stop 400 m away is asking *when should I leave*, about a place they are
deliberately not at yet. Three consequences:

- **§5's section 4 ("Saved elsewhere", collapsed to a count) is wrong** and is revised below. Collapsing a
  saved place *because it is not underfoot* hides exactly the row the office case exists to read. Distance
  is the **reason** that row is being checked, not a reason to demote it.
- **Proximity is the wrong primary sort for the saved section.** A saved place should be ranked by *"is
  something due there soon"*, with distance as the caption it already carries.
- **"Catch it" (§5a) has a twin.** *Can I still make it* (you are near, the bus is close) and *when do I
  leave* (you are far, the bus is far) are the same arithmetic read from opposite ends. §5a's band rule was
  designed only for the first. See the note added there.

**Q3 — does Home get a map? → yes.** With an architectural steer that is better than what §7a assumed:

> *"I think I've seen some apps (like Transit) where there's just 1 map shared through the whole app and
> then different chrome depending on what you are viewing."*

That is a real and different proposal — the map as a **shell-level layer** rather than a screen's child.
Costed as **§7e**, which is new. It is the right model and it makes rung 3 bigger and rungs after it much
smaller.

**Q4 and Q5 — answered 2026-09-20, and Q4's answer reframes the question.** Round-2 mockups built:
[`q4b-what-is-this-screen-for.html`](./mockups/home/q4b-what-is-this-screen-for.html) and
[`q5b-elastic-axis.html`](./mockups/home/q5b-elastic-axis.html). See §0a.

---

## 0a. Round 2 — the owner on the mockups (2026-09-20)

**Q4 → the card was the wrong question.**

> *"I struggle with this design, because I'm not 100% clear on what I'm supposed to be doing on this screen.
> I guess that can be where lists really shine — browsable. What if we only showed nearby stops and not buses
> specifically?"*

**Taken as the finding it is.** Which words go in a floating card cannot be settled while the board under it
is unclear, so Q4 is **parked** and the card is held constant in round 2 while the *board* varies. The
diagnosis, stated so it is not lost: round 1's Home asked a rider to do **triage**. Three sections, all the
same row shape, each stop showing two or three of its routes with a time and hiding the rest behind
`+N more`, over a map. Route detail is legible because it answers *one* question; round 1's Home answered
three and ranked them.

**The proposed resolution — §5's sections keep their names, but not their row shape.** The owner's two
occasions (§0 Q2) are *checking*; "what's around me" is *browsing*, and they want different rows:

| Section | Job | Row |
|---|---|---|
| Catch it · Saved | **checking** — you already know the route, so a time is the whole answer, and we can be specific because you told us which ones matter | place, then its saved routes **with arrivals** |
| Around you | **browsing** — we do not know which of a stop's 26 routes you want | **place only**, plus a strip of route-number chips and **no claimed times** |

Two things this buys beyond legibility. It makes the map mean something — one row, one pin, in the half of
the screen that is about *where things are*. And it **deletes `+N more routes`** from the discovery half,
which `docs/07` has an open question about precisely because picking three of twenty-six is a guess dressed
as an answer — nothing is capped when nothing claims to be a shortlist.

⚠️ **The cost, and the thing the mockup exists to judge: two row shapes on one screen.** If the seam reads
as two unrelated lists stapled together, the split fails and the owner's stops-only board (option B) is the
honest fallback — at the price of Home no longer answering *"is my bus coming"* without a tap.

**Settled, not re-asked: the tab bar is centred**, with the search lens floating separately at the bottom
right. *"Having it centered is nice and will work better on larger screens."* That is a change to the
shipping bar, which today shares its row with the lens.

**Q5 → keep going, with three corrections.**

> *"This is actually pretty cool. How would we handle shifting positions? … The timeline can be flexible
> right? … The ±2 min band is no good really — bus info is an estimate and on a busy route the overlap only
> creates confusion."*

- **The ± band is withdrawn**, and the owner's reasoning is better than the proposal's defence of it:
  drawing uncertainty as an overlapping smear adds confusion without adding information. It was **ADR-123
  proposed a third time in a new costume** — that ADR withdrew a fade and then a muted `~` for the same
  reason, that staleness and imprecision are properties of the *board*, not of each figure.
- **Shifting positions are safe, and the rule already exists.** ADR-008 forbids a client-side per-second
  countdown, so the axis never slides under a fixed "now": it is a **snapshot that re-lays out when a round
  lands**, exactly as the list's numerals re-render. No new exposure; what it adds is that a change becomes
  *visible* — a numeral going 11 → 8 is easy to miss, a bus moving is not. A departing bus reuses
  `useRailFlip`'s existing exit.
  · 🟢 **The mockup found the cue's definition.** Marking "reordered" by array index lit up **16 of 16** rows
  at an interchange, because one bus departing shifts every index behind it. Overtaking is what the cue
  means, so it must be computed over the **buses present in both rounds**, ranked within that intersection —
  6 of 16, which is the truth. A per-figure cue that fires on everything is a per-figure cue that says
  nothing, which is the same trap as the fade.
- **The elastic axis works, and it is the owner's idea.** Give every interval a minimum height so a clump
  can breathe, share the remaining height proportionally, and — the part that keeps it honest — **apply the
  same mapping to the ruler's ticks**, drawing a stretched interval's rule dashed. Position still equals
  time *as read against the ticks*. The nudge count goes to **zero at every density**.
  · **Its honest cost:** the axis is no longer uniformly readable, so the *shape* of bunching — the thing the
  axis existed to show — is flattened by the mechanism that makes it fit.
  · **Which is why the lean is the hybrid:** a short elastic axis as a **headline** over the full list as a
  **reference**. The axis answers *"what is the shape of the next ten minutes"*; the list answers *"when is
  my 73X"*, which is the lookup an axis is structurally bad at because its sort key is not what you are
  searching by. Neither is asked to do the other's job, which is where both previous rounds broke.

**Still rung 4.** None of Q5 is in the 1–3 slice; it is exploration the owner asked to continue.

---

## 0b. Round 3 — option C chosen, and it collapses into one card shape (2026-09-20)

Mockups: [`q4c-one-card-shape-and-the-chrome.html`](./mockups/home/q4c-one-card-shape-and-the-chrome.html)
and [`q5c-place-detail-merge.html`](./mockups/home/q5c-place-detail-merge.html).

**The board: option C, with two corrections from the owner, and the second one is the better idea.**

🔴 **The star was on the wrong object, and that was a real error.** A favourite is
`formatFavoriteRouteKey(stopId, routeId)` — a **route at a pole**
([ADR-032](./08-decision-log.md)/[ADR-042](./08-decision-log.md)). A place is never starred, so round 2's
star on the card heading was claiming something the data model cannot express. Worth recording rather than
quietly fixing: a mockup can assert a relationship the kernel has no way to store, and nothing catches it
but a reader who knows the id grammar.

🟢 **Chip strips belong on saved places too, and that dissolves round 2's open risk.** The owner's
suggestion — *"show the badges (but without times) for the other buses at the favourited stops"* — means
there is no longer a saved row shape and a discovery row shape. There is **one card**:

> a heading · any routes you starred **here**, with times · then everything else at this place, as chips

A nearby card is that same card with no starred rows *yet*. The seam round 2 was worried about is gone
because the two halves stopped being different objects — and the card now says something true that neither
old shape did: *these are the routes you chose, and this is everything else that stops here.*

**The expanding strip — feasible, with one rule.** `+14` is a tappable badge; expanded, every route wraps
and a chevron-up ends the list. Built and it costs less height than the rows it replaces. The rule:
**how many chips show while collapsed is the kernel's number, not the view's.** "Show the first N and count
the rest" is arithmetic over rows, which `check-no-derivation` bans and which `stopCardView` already owns
for `+N more routes`. So `homeView` hands over the full ordered chip list *and* the collapsed count; the
view renders `expanded ? all : first(collapsed)`; the label comes from the catalogue with the kernel's
number in it. **Expanding is a rider's tap — interaction, not a domain rule — so that half is legitimately
the view's.** Open: one collapsed line or two (the mockup shows two).

**The tab bar — asked by the owner, and I think the answer is no.** Walk §8's three candidates against this
design and two of them dissolve: **Saved** is now a section of Home, so a tab for it is a second door to
something already on screen; **Map** is the sheet dragged to its lowest detent, which is better than a tab
because it keeps the board one *gesture* away rather than one navigation. That leaves Home, and a one-tab
bar is not a bar.

⚠️ **Three costs, and the third is a decision rather than a trade.** (1) Discoverability — two unlabelled
lenses replace three labelled tabs, and Search is the app's second-most-used surface; the mockup's option C
answers it with a **labelled** search pill instead of a lens, which costs nothing. (2) A future home for
ferries, rail or a full-city map — the backlog's own reason to keep a bar; adding one back later is a bigger
change than keeping one. (3) **It amends [ADR-100](./08-decision-log.md)**: the floating glass tab bar is
*identity*, ported value-for-value at the owner's own direction after the parity review. Retiring it is the
owner's call, but it wants an ADR saying the bar went because **its destinations dissolved**, not because
the chrome was disliked.

**Q5 → the timeline moves to Place detail, and that is a better home than Home.** The owner's shape —
*timeline · your saved routes here · the existing list grouped by kerb* — works, for two reasons beyond
taste. **Density is bounded**: one place rather than an aggregate, so the interchange that killed the
uniform axis is the worst case rather than the normal one. And **the timeline is the only view on that
screen that ignores kerb boundaries** — the grouped list exists precisely to respect them, so a rider at a
merged place who just wants the next bus has until now had to read three kerbs and merge them in their head.
That is what makes it earn its space rather than decorate.

⚠️ **Its risk: one bus can appear three times** — a token on the axis, a row in the saved block, a row under
its kerb. Three mitigations, in the order they are believed: keep the timeline **short** (10 minutes, four
or five tokens, a headline not a second list); **put the kerb code on the token**, which stops it being a
duplicate *because* it carries the one fact the list below is organised around; and **do not dim or hide
duplicates** — that is the silent filter ADR-008 forbids. Open: whether a one-kerb, three-route place should
get a timeline at all, or whether it wants a floor — which would be a kernel rule, not a view's.

---

## 0c. Round 4 — the refinements, and the chrome is settled (2026-09-20)

**Settled and no longer open:**

- **No tab bar.** *"Let's go with no tabbar for now and see how far we get. That does feel a bit tidier."*
  Settings is a floating lens top-right; **Search is an unlabelled lens** bottom-right — the owner declined
  the labelled pill (*"search is a well known icon"*), so the discoverability mitigation §0b proposed is
  withdrawn. ⚠️ This **amends [ADR-100](./08-decision-log.md)** and wants its own ADR when H-5 lands,
  recording that the bar went because **its destinations dissolved** rather than because the chrome was
  disliked. "For now" is in the owner's words and belongs in that ADR too.
- **Navigation.** Tapping a **place** opens Place detail. Tapping a **route** — starred row or a chip in the
  strip — opens Route detail. Both are the paths that already exist; the chip strip is a new *source* of the
  second, not a new destination.
- **No label above the chip strip.** *"I feel like the badges should be obvious enough."* §0b's *"Also
  here"* / *"Routes at this stop"* are gone. Correct: a row of route badges is not ambiguous enough to need
  naming, and a heading for something already obvious is noise on the screen that is meant to be scannable.

**The saved flag — and the treatment already existed in this repo.** The owner's description — *"primary
colour star with a border made by a slightly bigger star behind it, where the background star matches the
background colour of the item so it appears like a bit of a cut out"* — is, word for word, what
`RouteStopRow` has been drawing on a saved stop's rail node since WP6-6: *"Two stars, not one: a slightly
larger `--surface` one behind the accent one, which is what gives the flag its outline."* So this is an
**extraction, not a new mark**: `apps/web/src/components/SavedFlag.tsx`, with the rail's own 15 : 11 ratio
kept rather than re-derived, and `halo` as the caller's choice (`surface` on a row, `bg` on a chip in a
card) because only the caller knows what it is standing on. Applies to Place detail too.

> 🟡 **Not yet on `RouteChip`.** The prop has no consumer until Home exists, and building a prop ahead of
> its caller is how a component grows options nobody uses. The flag is in `/lab/#gallery` on **all four
> operator liveries in both haloes**, which is the open question `docs/07`'s standing row has carried for
> months (*"does it survive the operator liveries and dark mode at chip size?"*) — answerable now by
> looking. `PlaceRow`'s trailing `SaveStar` is **untouched**: it is the only way to un-save from that
> screen, and moving the indicator to the chip without first replacing the control would remove a rider's
> only exit.

**Q5 refinements, all applied:**

- **The bus glyph is out of the timeline.** *"It looks fun but it makes it a little too busy."* The node is
  a plain mark on the line now. `busGlyph` is **parked rather than deleted** in the mockup, with the owner's
  note beside it — the drawing is good and wants a home, just not this one.
- **"now" → "Due"**, matching the app's own vocabulary (CLAUDE.md rule 3: *"Arriving/Due"* under a minute).
  The tick at the origin is the moment a bus is due, so the word is not a substitution — it is the right one.
- **Boarding-point codes are 5–6 characters** (`ST510`, `GM1247`), not the two-character placeholders the
  round-3 mockup invented. This matters more than it looks: the kerb badge on a timeline token is what stops
  the axis duplicating the list below it, and it has to fit a real code.
- **The map is the shell's, not the screen's.** *"We are switching to have an underlying map that is shared
  throughout the app (not embedded like this)."* Confirms §7e as the model, and it has a consequence for the
  header taxonomy: **Place detail stops being `collapsing` and becomes `map`**, which is the second screen
  to fill the cell §7a said Home would widen. `docs/09` §10's table will need that row when H-7b lands.

---

## 1. Three findings, and the first one settles the merge question

### 1a. Each screen's worst state is the other screen's content

This is the strongest argument for the merge and it is not an aesthetic one. Put the two published specs
side by side ([`nearby.spec.json`](../../packages/contract/ui/nearby.spec.json), nine states;
[`favourites.spec.json`](../../packages/contract/ui/favourites.spec.json), eight):

| Nearby's state | What Nearby shows | What Favourites would have been showing |
|---|---|---|
| `undetermined` | a permission prompt and nothing else | every saved place, live |
| `denied` | "location is off, what that costs" and nothing else | every saved place, live |
| `locationError` | a timeout message and nothing else | every saved place, live |
| `loading` | "locating", and three grey bars | every saved place, live |

| Favourites' state | What Favourites shows | What Nearby would have been showing |
|---|---|---|
| `empty` | "what this tab is for, and how to put something in it" | the six stops you are standing next to |

**Five of the seventeen declared states across the two screens are an apology that the other screen could
have answered.** Four of those five are the *first thing a new rider sees*, because a cold install has no
location permission and no favourites. That is the app's front door, and today it is a permission prompt on
one tab and an onboarding sentence on the other.

A merged Home is the only shape in which "I don't know where you are" and "you haven't saved anything" are
both non-events. And it costs nothing to say so: both screens already render `StopCardView[]` from the same
kernel functions through the same `StopCard`. The merge is a **ranking rule and a set of section captions**,
not a screen.

### 1b. The front door is the oldest screen in the app

`Nearby.tsx` is 219 lines and is essentially WP4-1, unchanged in shape since it was the first thing ported.
`Favourites.tsx` is 153 lines and is WP6-4b. Both are: `<main className="min-h-dvh bg-bg">`, an `h1` in a
static `<header>`, a flat run of `StopCard` sections divided by hairlines, and the tab bar floating over the
bottom. No map. No sheet. No floating chrome. No motion. No shared element on navigation.

Meanwhile Route detail is `fixed inset-0` with a full-bleed map, a floating back lens, a context card that
FLIPs its badge and animates its height into a pill, a three-detent draggable sheet that owns the only
scroll on the screen, a rail with live bus tokens positioned on it, fact pills that open a fact sheet, and a
row menu that opens an action sheet.

**Every screen the rider reaches *through* Home is better designed than Home.** That is backwards, and it is
worth saying plainly because it explains why the owner's instinct to pull route detail's language outward is
right rather than merely consistent: Nearby is not under-designed relative to a style guide, it is
under-designed relative to *the screen one tap away from it*.

### 1c. Route detail's shell is a shape, not a screen

The thing worth copying is already factored as if it were meant to be reused:

| Piece | File | What it knows about routes |
|---|---|---|
| `DraggableSheet` + `detents.ts` | `components/sheet/` | nothing |
| `BackButton` (floating lens) | `shell/BackButton.tsx` | nothing |
| `useFlip` / `useHeightFlip` | `hooks/useFlip.ts` | nothing |
| `RouteMap` | `components/RouteMap.tsx` | the polyline and the stop markers |
| `RouteContextCard` | `screens/route/` | the badge and the journey |
| `FeedNotice` | `components/FeedNotice.tsx` | nothing |

Four of the six are already route-agnostic. `RouteMap` needs its polyline made optional to become
`Map`. `RouteContextCard` is the one genuinely route-shaped thing, and §7 argues its *shape* generalises
even though its content does not.

So "pull those elements into the other pages" is, mechanically, cheaper than it sounds. **The expensive part
is not the components — it is deciding what Home's equivalent of the context card says.**

---

## 2. The fork: merge, or keep two tabs

**Recommendation: merge, and call it Home.** §1a is the reason and it is sufficient on its own. Three
secondary reasons:

- **The rider's question is one question.** *"What can I get on, from here, soon?"* Saved-or-not is one input
  to that answer, not a different question. Today the rider has to know which tab their answer is in — and
  the answer is frequently split across both, because the bus you take every day is also the bus at the stop
  you are standing at.
- **A saved route is a ranking signal, not a filing cabinet.** It is the strongest signal we have about what
  a rider cares about, and it is currently used only to populate a separate list.
- **It frees a tab slot**, and the backlog's own reframing — *"the tab bar is probably not the question, what
  is in it is"* — has an obvious answer once the slot is free (§8).

**What the merge must not lose**, and this is the real design work rather than the merge itself:

1. **The curated list as a thing you can see whole.** A rider who saved eleven routes must be able to see
   eleven, not "the four we ranked up today". §9.
2. **Honesty about ranking.** [ADR-008](../08-decision-log.md) forbids fake precision; the same instinct
   forbids a silent filter. A ranked Home must never be the *only* path to something, and each section must
   say what it is. See `StopCard`'s existing note on `remaining > 0` — *"hiding an honest total because the
   affordance is unavailable is the silent filter ADR-008 forbids"*. That rule now applies to a whole screen.
3. **`/favorites` as a URL.** It is in the destination set, it is deep-linkable, and riders may have
   bookmarked or installed to it. It redirects; it does not 404. (`shell-parity.test.ts` is gone with
   `apps/mobile` — ADR-157 — so the destination set is now ours to change with an ADR rather than a gate to
   renegotiate.)

---

## 3. What Home is actually for — the content question, before the shape question

Worth settling first, because every layout below is downstream of it. Three candidate theses:

**(i) Home is Nearby with favourites floated to the top.** The conservative reading. Cheap, obviously
correct, and does not earn the word "Home".

**(ii) Home is a departure board.** The unit is not a *place*, it is a *departure*: `route × pole × time`.
"KMB 1 from Nathan Rd/Jordan Rd, 4 min, 3 min walk" is one row. Saved routes and nearby routes are the same
kind of row, ranked together, and the place is a caption on the row rather than a card heading. **This is the
one that makes the merge feel like a new screen rather than two old ones stapled together** — and it is the
shape that makes route detail's rail generalise (§7c).

**(iii) Home is a map with a board on it.** The spatial reading: you are a dot, the poles around you are
markers, and the sheet lists what leaves from them. Route detail's shell, applied literally.

These are not exclusive — (ii) is a content decision and (iii) is a shape decision, and the best version of
Home is probably both. (i) is the fallback if the appetite is small.

**Recommendation: (ii) + (iii).** With a caveat worth stating now: **the departure-board unit is a data
change, not a view change.** `StopCardView` is place-shaped (a name, a caption, and `rows`), and a departure
board wants the transpose. That is exactly the kind of thing the owner's "open to revamping data structures"
unlocks, and §6 costs it.

---

## 4. The ladder — four rungs, each shippable, each a real improvement

Written as rungs rather than options because they compose, and because the owner should be able to stop at
any of them.

### Rung 1 — Chrome parity (S, no ADR beyond the header taxonomy)

Nearby and Favourites keep their flat lists and gain route detail's *chrome*: the floating collapsing header
in place of the static `h1`, Settings as a floating top-right lens, the glass material, the same type scale
and the same motion curve. Nothing structural. This alone closes the visual gap that prompted the ask, and it
finally answers `docs/07`'s **"Header rules, written down and testable"** row, because you cannot give three
screens a header without deciding which kind of header each screen gets.

### Rung 2 — The merge (M, one ADR, one new spec)

`/` becomes Home. `/favorites` redirects. `homeView` in `packages/core` ranks and sections the list;
`home.spec.json` declares its states — and the state count *drops*, because §1a's five apologies collapse
into two ("we have neither", "we have one of the two"). The screen is still a flat list.

### Rung 3 — The shell (M/L, one ADR)

Home moves into route detail's shell: a map base layer, the floating chrome over it, the board in a
`DraggableSheet` at `half`. `RouteMap` loses its route-specific assumptions and becomes `Map`. This is the
rung where the app becomes visually one app.

### Rung 4 — The departure board (L, kernel work + a new view type)

The unit becomes a departure rather than a place (§3 ii, §6). This is the rung that earns "smart enough to
know what to prioritise" and the rung where the rail generalises (§7c). It is also the rung with real
honesty risk, and §10 lists what to reject.

**Suggested stopping point if the appetite is one slice: rungs 1–3.** Rung 4 wants its own round of
mockups.

---

## 5. The ranking rule belongs in the kernel, and it is the product

`homeView` in `packages/core`, corpus-pinned, exactly as `nearbyView` and `favouritesView` are. Not because
of a boundary rule (though [ADR-068/069](../08-decision-log.md) is that rule) but because **ranking is the
one part of this that is genuinely hard to get right, and a rule in a screen cannot be measured.** A corpus
of twenty ranking cases is the difference between "smart" and "unpredictable".

**The inputs all exist and are all already persisted or already fetched:**

| Signal | Where it is today |
|---|---|
| saved-or-not | `preferences.favoriteRoutes`, keyed `pole:route` |
| distance & walk time | `stopCardCaption` computes both from the snapped fix |
| due soon | the live round, per pole (`useLiveNearby`) / per route |
| recency | `preferences.recentRoutes` / `recentStops` (written by Search, read by Search) |
| direction of travel | `bearingDeg` on a merged place; `routeMarkers`' terminus/interchange kinds |
| time of day | nothing reads it yet |

**Proposed sections, in order** — captions matter as much as the ranking, because a caption is what makes a
rank honest:

1. **"Catch it"** — a *saved* route at a *reachable* pole, due in more than the walk time. See §5a; this is
   the headline feature and the reason Home is worth building.
2. **"Saved"** — the rider's whole curated list, **at any distance**, ranked by what is due soonest rather
   than by how near it is. Distance stays in the caption, where it already is.
3. **"Around you"** — today's Nearby list, minus anything already shown above.

**Three sections, not four, and that is Q2's doing.** The first draft had a fourth — *"Saved elsewhere"*,
collapsed to a count — on the assumption that a saved place across town should not outrank the stop
underfoot. The owner's second occasion (*"check when the next bus is coming before leaving the
office/house"*) says that is exactly backwards: a rider checking a stop 400 m away is asking about a place
they are **deliberately not at**, and the distance is why they are asking rather than a reason to fold the
row away. So the saved list is one section, whole, always open, and proximity is not its sort key.

The rule this leaves is worth stating on its own, because it is the ranking's whole personality:

> **Saved outranks near. Due-soon outranks far.** A saved place is never demoted for being distant, and
> within the saved section the next departure decides the order.

**With no location fix**, sections 1 and 3 are absent and section 2 is the whole screen — which is precisely
the office case, and it is now the *same* screen rather than a degraded one. **With no favourites**, sections
1 and 2 are absent and section 3 is the whole screen. Both are ordinary content states rather than
apologies — which is §1a's finding, made concrete.

**One thing to watch at mockup time.** A long saved list plus a nearby list is a long screen, and section 3
is the one that gets pushed below the fold. That is probably right — a rider who has saved things has told
us what they care about — but "probably right" is what a mockup is for. The candidate lever if it reads
badly is capping section 3 with `StopCard`'s existing honest-overflow pattern (`remaining` + a tap), never a
silent truncation.

### 5a. "Catch it" — the one new rule, and the honesty problem it carries

`etaMinutes - walkMinutes > 0` is arithmetic over two numbers we already compute. It is also the most
useful sentence this app could say, and the one most able to lie: a walk estimate is a straight-line
estimate over a snapped position, and an ETA is an approximation by [ADR-008](../08-decision-log.md)'s own
insistence. Subtracting one from the other compounds two errors and prints them as a decision.

**Proposed rule — three bands, no number:**

| Band | Condition | What it says |
|---|---|---|
| comfortable | `eta - walk >= 3 min` | nothing (the row is simply in the section) |
| tight | `0 < eta - walk < 3 min` | a marker meaning *"only if you leave now"* |
| gone | `eta - walk <= 0` | the row is **not** in "Catch it" — it is in section 2, unmarked |

Three properties this has that a "leave in 2 minutes" countdown does not: it never prints a derived number,
so it cannot claim a precision neither input has; it degrades to *ordering* rather than to a false claim; and
a rider who misses one sees a bus they were never told they would catch. **A pole with no walk estimate — no
fix, or a fix too stale — has no band and does not enter section 1 at all.** Absence of the section is
honest; a "catch it" computed from a remembered position is not.

This wants an ADR of its own. It is the first place in the app where two approximations are combined into
advice, and the rule for that should be written down once rather than rediscovered.

**Q2's twin, and the tension it opens.** The table above was designed for one occasion — *you are near, the
bus is close, can you still make it*. The owner's second occasion is the same arithmetic read from the other
end: *you are in the office, the bus is eight minutes out, the stop is a five-minute walk — when do I leave?*
The bands still work (that row is `comfortable`), but "comfortable" is not the answer to the question being
asked; **"leave in about three minutes" is**, and that is the derived number this section just spent four
paragraphs refusing to print.

Two candidate resolutions, both for the mockups rather than for an argument here:

- **Print both inputs, band neither.** The row already carries the ETA, and the caption already carries the
  walk time. Putting them on one line — *"in 8 min · 5 min walk"* — states the two things we actually know
  and lets the rider do the subtraction they were going to do anyway. No new claim; arguably the most honest
  thing on the screen.
- **Band the gap coarsely and say it in words** — *"leave soon"* / *"leave now"* — which is the same
  three-band rule with copy written for the far case instead of the near one.

What is **not** acceptable either way is a live-decrementing "leave in 3:42". That is the per-second
countdown ADR-008 forbids, wearing a hat.

---

## 6. The data-structure question: `StopCardView` is place-shaped, and a board wants the transpose

Taking the owner's opening seriously. Today:

```
StopCardView { name, caption, bearingDeg, rows: StopCardRow[], remaining, incomplete }
StopCardRow  { routeId, routeNo, operator, headline, remark, label, urgency }
```

A place with its routes under it. Nearby, Favourites and Place detail all render this, and it is right for
all three: they each answer *"what is at this place"*.

A departure board (§3 ii) answers *"what leaves soonest"*, which cuts across places. The natural shape:

```
DepartureView { routeNo, operator, headline, poleName, poleCaption, bearingDeg,
                label, urgency, saved, band, poleId, routeId }
```

**Do not delete `StopCardView`.** Place detail needs it, `stop-row.spec.json` is the app's first zero-defect
spec, and it is the shape both `nearbyView` and `favouritesView` produce. The proposal is a *second* view
type produced by a *second* kernel function, sharing `EtaReadout` and the caption helpers. Home would then be
the only consumer, and Home would be able to interleave a saved route in Yau Ma Tei with an unsaved one
across the road — which is precisely what a place-keyed list cannot express.

**The honest cost, stated:** a departure board loses the thing the card gets for free — *"these six routes
all leave from the same kerb, so walk there once"*. Poles are the unit a rider physically visits. That is a
real argument for keeping (i)/(ii) as a **toggle on one screen** rather than picking one, and the toggle is
cheap because both come from one round of data. It is also an argument for building rung 4 last, behind
mockups, rather than assuming the transpose is an upgrade.

---

## 7. The design-language transfer, piece by piece

### 7a. The header — and the taxonomy this finally forces

`docs/07` already carries the row, with a starting taxonomy: (1) root/tab screen, (2) pushed detail, (3)
sheet. Route detail has since invented a fourth — the **context card**, which is not a header at all but a
floating pane that collapses by width — and ADR-156 recorded it as *"the two screens stop being one family
here on purpose, because only this one has a map underneath to get out of the way of."*

**If Home gains a map (rung 3), that sentence stops being true, and Home joins the context-card family.**
Which resolves the taxonomy neatly:

| Kind | Chrome | Screens |
|---|---|---|
| **Map-backed** | floating lens + context card over a full-bleed map, content in a sheet | Route detail, **Home**, (a future Map tab) |
| **Pushed detail** | `CollapsingHeader`, back lens, scrolling content | Place detail, Route… no — Place detail, Search |
| **Static page** | plain header, no collapse | Settings, About, FAQ |

> ✅ **Built 2026-09-20 (H-1, ADR-169), and the table above was wrong by one row.** The taxonomy is **four**
> kinds, not three: *"a static page"* is one thing when it is a tab root that owes the rider no way back
> (`root`) and another when it is pushed and must offer one at any scroll offset (`pushed`). The eight
> screens already were four kinds; this section had merged two of them. It also turned out that **scroll
> ownership is a second, independent axis** — Search is `pushed` and owns an inner scroller. See
> `docs/09` §10 and `apps/web/src/shell/headers.ts`.

Three kinds, each with a stated rule, and the ⚠️ from the backlog still applies: **no suite in this repo can
see a collapse** (jsdom has no `IntersectionObserver`), so whatever is agreed needs its enforcement designed
with it. The `useHeightFlip` work on this branch is a hint at the shape — the collapse's *arithmetic* can be
extracted and tested even when the collapse itself cannot be observed.

### 7b. Home's context card — what it says

Route detail's card says *which bus, going where, and four facts about it*. Home's equivalent should answer
the same question one level up: **where you are, how fresh that is, and what you can do about it.**

Proposed, expanded: the locality name (LandsD's gazetteer, or the nearest place's district), the fix's age
if it is not live, and a recentre control. Collapsed by any drag or scroll: a pill with the locality and the
recentre glyph. It also gives `lastKnownLocation` — today a grey subtitle nobody reads — a home where it is
actually legible.

**The alternative worth testing:** Home has no context card, and the collapsed pill slot carries the
**section the sheet is scrolled to** ("Catch it" / "Around you"), the way a sectioned list on iOS carries a
sticky header. That is a different and possibly better use of the same 44 px. Mockups.

### 7c. The rail — and the one honest way to generalise it

The rail is the strongest visual idea in the app and the temptation is to spray it everywhere. It works on
Route detail because a route *is* a line: the spine is real geography and the nodes are real stops in real
order. **A rail on a list of unrelated poles would be decoration** — a line drawn between things that are not
connected, which is the same species of lie as fake precision.

There is exactly one honest generalisation, and it is rung 4's: **the spine is time.** A vertical axis of the
next 30 minutes, with each departure as a token at its own position, is a spine whose ordering means
something. It reuses `RailBusToken`, the token motion, and `useRailFlip`'s enter/exit — a bus that departs is
drawn out of the top exactly as one that leaves a route is drawn out today.

**Two objections to sit with before anyone builds it:**

- Position-on-an-axis is a continuous claim built from a value ADR-008 insists is approximate. It may
  actually be *more* honest than "4 min" (a position reads as approximate where a numeral reads as exact) —
  or it may be worse. That is a question for a mockup and the owner's eye, not for an argument.
- Hong Kong frequencies are high. A 30-minute axis at a Nathan Road interchange is forty tokens in a column,
  and the axis becomes a queue. It probably wants to be a 10–15 minute window, which is a different and
  smaller idea.

**Recommendation: do not put a rail on Home at rungs 1–3.** Carry the rail's *vocabulary* instead (7d), and
keep the time-rail as rung 4's mockup.

### 7d. The cheap, high-value pieces — carry these regardless of rung

- **The marker glyph on the card matches the marker on the map.** `routeMarkers` already decides
  terminus/interchange/stop and Route detail's own note explains why: *"a rider who sees a hexagon on the map
  and scrolls down to find a circle in the list is looking at two claims about one stop."* Home's cards
  currently draw a generic `MapPin` or a `BearingArrow`; over a map they must draw the map's own glyph.
- **Skeletons shaped like the thing that is coming.** Route detail's `arrivalsPending` is sized to the box
  the figure will occupy; Nearby's is three generic grey bars and Favourites' is two. Same fix, already
  designed, on the two screens where the wait is longest (Favourites fans out one query per saved pole).
- **The row menu.** `RouteStopSheet` — "save this route here" / "view this stop" — is the answer to
  `docs/07`'s standing row *"from Stop/Place detail there is currently no way to save a route at all"*. Home's
  rows want the same sheet, which also makes Home a place you can *curate* from, which is what lets
  Favourites-as-a-tab go away without losing anything.
- **Continuous motion instead of boolean CSS transitions.** Round 3 of `proposals/06` diagnosed the web
  header as snapping at a threshold where the RN one interpolated. Whatever Home's header is, it should be
  built on the `useFlip`/`useHeightFlip` shape rather than on `data-collapsed`.
- **The shared element on navigation.** The data router was chosen for `useViewTransitionState` — *"the
  difference between a page that cross-fades and a route badge that flies from a list row into the header"* —
  and nothing uses it yet. Home → Route detail is the single best candidate in the app: the `RouteChip` a
  rider taps is the same chip that lands in the context card.

---

### 7e. One map for the whole app — the owner's Transit model, costed

> *"I think I've seen some apps (like Transit) where there's just 1 map shared through the whole app and
> then different chrome depending on what you are viewing. Not sure programmatically what is the best way
> to do it."*

This is the right model and it is a bigger idea than "Home gets a map". Worth separating the two, because
they can ship in that order.

**Today** the map is a screen's child: `RouteDetail` renders `<RouteMap>`, Place detail renders a
`MiniMap` (a hand-composited grid of `<img>` tiles — a different renderer entirely), and Nearby renders
nothing. Navigate and the map unmounts, the GL context is thrown away, the tiles are re-requested and the
camera starts from nothing.

**The model.** One map instance mounted **once, in the shell, above the router outlet**; screens never
render a map. Instead each screen **declares what the map should be showing** and the layer reconciles —
camera, overlays, and the inset that keeps "centred" honest under a sheet.

```ts
// The declaration a screen makes. Data, not commands.
interface MapIntent {
  focus: { bounds: LatLngBounds } | { centre: LatLng; zoom: number } | 'rider'
  overlays: { poles?: MapPin[]; path?: LatLng[]; rider?: boolean; focusedIndex?: number }
  inset: { top: number; bottom: number }   // the fraction of the viewport the chrome + sheet cover
}
```

`useMapIntent(intent)` from the active screen; the layer diffs the last intent against the new one and
animates between them. **Declarative, never imperative**, and that is the load-bearing choice rather than a
style preference: a screen that calls `map.flyTo()` has put a decision in a view, which is the shape
[ADR-068/069](../08-decision-log.md) and `check-no-derivation` exist to catch. A screen that returns a
`MapIntent` has produced a **value**, which can be corpus-pinned and compared across renderers exactly as
`routeMarkers` and `nearbyView` are — and which a native port can consume unchanged, since the intent says
nothing about MapLibre.

**What it buys, in order of how much it matters:**

1. **Continuity, which is the whole Transit feel.** Home → Place detail → Route detail becomes one camera
   moving, not three maps mounting. The map stops being an illustration on each screen and becomes the
   thing you are navigating *within*. This is not achievable any other way.
2. **The GL context, the worker and the tile cache are paid for once.** Today Route detail pays them on
   every entry.
3. **`MiniMap` can eventually go.** It exists because Place detail needed *a* map before there was a real
   one. Two map renderers is two answers to "what does a pole look like" — the same species of split the
   marker-glyph note in §7d is about.
4. **The camera inset generalises for free.** Route detail already insets by the sheet fraction (its own
   note explains why: a `fitBounds` that ignores the sheet centres the route *behind* it). That becomes a
   field of the intent rather than a prop threaded through one screen.

**Five things that will bite, listed because four of them are easy to miss:**

- ⚠️ **View Transitions and a persistent canvas.** The shell moved to a data router for
  `useViewTransitionState`, and a View Transition **snapshots the DOM**. A persistent WebGL canvas
  underneath the outlet will be captured and cross-faded — expensive, and visually wrong, since the one
  element that should *not* cross-fade is the one that is continuous. It needs `view-transition-name: none`
  or to sit outside the transition root. **Prototype this first**; it is the cheapest thing to test and the
  most annoying to discover late.
- **Who owns the camera when two things want it.** Rule: **only the topmost matched route declares an
  intent**; sheets and modals do not. Without a stated rule this becomes the bug where a closing sheet
  fights an opening screen for the camera.
- **Back should restore the camera you left.** The intent wants keying by history entry, the same shape
  ADR-109 used to restore Search's scroll offset against the history key. Otherwise Back re-frames from
  scratch and the continuity that justified the whole exercise is lost on the most common navigation.
- **Testability.** jsdom has no WebGL, and today that is fine because the map is a screen child a test can
  ignore. A shell-level map means every screen test mounts the shell. Two mitigations, both needed: the
  layer renders `null` without a GL context, and — the one that actually matters — **the intent is pure
  data and gets a corpus**, so what each screen asks of the map is measured even though no suite can see a
  tile. Note the standing lesson in `docs/07`: *a healthy basemap once hid a dead MapLibre worker*, so
  "the map looks fine" is not the check.
- **Cold start.** Home is the PWA's first paint. The layer must mount **after** the board renders, and
  ideally not at all at the `list` detent. Persisting one map makes this easier than mounting per screen,
  but only if the mount is deferred rather than eager.

**Staging, and this is the recommendation.** Do not build the shared layer first. Two steps inside rung 3:

- **3a — `RouteMap` → `Map`**, polyline optional, and Home renders it as a child the way Route detail does.
  Home gets its map; the chrome, the detents and the camera inset all get proven on a second screen.
- **3b — lift it to the shell.** Now there are two real consumers with two different intents, so the
  `MapIntent` shape is derived from what two screens actually ask for rather than guessed from one. Place
  detail becomes the third and `MiniMap` retires.

3a is worth shipping on its own; 3b is where the Transit feel arrives. Splitting them means the risky part
is designed against evidence, and it means a bad week on 3b does not block Home.

---

## 8. What the tab bar becomes

The bar itself is **identity** under [ADR-100](../08-decision-log.md), ported value-for-value at the owner's
own direction. Removing it is out of scope here. What is in it is the question.

Merging frees one slot; moving Settings to a floating top-right lens (cheap since the safe-area work landed
with the back lens) frees a second. Two slots for:

| Candidate | Argument |
|---|---|
| **Map** | Home's sheet is a board with a map behind it; a Map tab is the same data with the ratio inverted. It is also where a future full-city view, ferries and rail belong. The backlog names it as the reason to keep a bar at all. |
| **Saved** | Keeps the curated list one tap away — and Q2 says it *is* checked, often, from two different situations. The counter-argument is now the interesting one: if Home's saved section is whole, always open and ranked by what is due, a Saved tab is a second door to a list already on screen. |
| **Lines** | Route-first browsing: the routes you ride, the ones near you. Overlaps Search. |

**Recommendation: Home · Map · Saved**, with Settings as a floating lens and Search staying as the lens
beside the bar. Two tabs feels thin, and Map is the tab with a future in it (a full-city view, ferries,
rail). **Saved keeps its slot for this slice** — Q2 settled that it is checked rather than tended, and
removing a door to something a rider checks daily is not a change to make on the same day as the merge. If
Home's saved section does its job, the tab can be reconsidered later from evidence rather than from a
guess; that ordering is cheap, and the reverse is not.

**Search stays a route** regardless. ADR-102 put the query, mode and chips in the URL and ADR-109 restores
its scroll offset against the history key; a shareable search is a feature. A modal *route* keeps all of
that. A component opening over the shell loses it.

---

## 9. What happens to Favourites — answered, and the answer has two halves

**Q2: checked, often.** The "curation surface" reframe this section originally proposed is withdrawn — it
was a plausible guess about a rider's habits and it was wrong, which is exactly the class of thing no amount
of code-reading settles.

What survives, and is more useful than the guess was, is that **the owner named two occasions and they want
different things from the same list:**

| Occasion | Where the rider is | What they are asking | What the screen owes them |
|---|---|---|---|
| **At the stop** | standing at, or beside, a saved pole | *which of my routes is next, right now* | the saved rows for **this place**, first, big, with a live reading — this is "Catch it" (§5a) |
| **Before leaving** | office or home, the stop 3–8 min away | *when is the next one, so when do I leave* | the saved rows for a place they are **not** at, with the ETA and the walk time both legible |

The second is the one the app currently serves worst, and it is the one that reframes the ranking (§0, §5).
It also has a quiet implication worth flagging: **the "before leaving" rider is often checking the *same two
or three* places every day, at roughly the same times.** `recentStops` and time-of-day are both available
and neither is read by anything today. That is not in scope for rungs 1–3 — a Home that reorders itself by
hour needs a corpus and a lot of care before it stops feeling haunted — but it is the natural next signal
after distance and due-soon, and it is worth not designing it out.

**So Favourites stays a board.** Its tab is a separate question (§8), and one worth deciding *after* Home
ships rather than with it.

Two smaller things this settles:

- The backlog's *"where should +X more routes go from the Favourites page"* question stands, unchanged and
  still open — it does not dissolve, because there is still a card with an overflow on it.
- `favouritesView`'s standing decision not to name a kerb per row should be **revisited** for the
  "before leaving" case specifically: a rider deciding when to walk out of the door cares which side of the
  road they are walking to. That is a kernel question, and it is the one place Q2 argues for changing a view
  model rather than a screen.

---

## 10. What to reject early

- **A rail on a list of unrelated stops.** §7c. A spine that connects nothing is decoration wearing the
  app's best idea.
- **A "leave in N minutes" countdown.** §5a. Two approximations subtracted and printed as a number, on the
  screen a rider glances at while walking.
- **Ranking as a filter.** Anything the ranker demotes must still be reachable and countable on the same
  screen. `StopCard`'s `remaining` note is the precedent and it was a real bug.
- **A map that mounts on cold start.** Home is the first paint of a PWA on a phone on the MTR. If rung 3
  lands, the map must be lazy at the `list` detent and the board must render before a single tile does.
  `pwa-policy` and the persisted query cache both assume the front door is cheap.
- **Merging the two *specs* into one file without merging the states.** A `home.spec.json` that is the union
  of seventeen states has learnt nothing. The point of §1a is that the merged screen has *fewer* states.
- **Deleting `StopCardView`.** §6.

---

## 11. Still open — Q4 and Q5, restated plainly

Q1–Q3 are answered in §0. These two were badly explained the first time; here they are in concrete terms.
**Nothing starts until they are answered**, because both change what gets drawn in H-0's mockups.

### Q4 — what does Home's floating card say?

On Route detail there is a floating pane at the top left, tucked behind the back lens: the route badge, the
destination, and four fact pills. Drag the sheet or scroll the list and it **collapses sideways into a
pill** — badge, arrow, destination — and tapping it opens it again. That is `RouteContextCard`.

Home has the same slot and the same collapse. The question is only **what goes in it**, and there are three
candidates:

**(a) Where you are.** Expanded: the locality name — *"Yau Ma Tei"* — the fix's age if it is not live
(*"last known position, 6 min ago"*), and a recentre control. Collapsed: a pill with the locality and the
recentre glyph. *Argument:* on a screen whose entire content is ranked by where you are standing, the card
should say where the app thinks you are standing — and it gives `lastKnownLocation` somewhere legible
instead of the grey subtitle nobody reads today.

**(b) Where you are in the list.** The pill carries the section the sheet is currently scrolled to —
*"Catch it"*, then *"Saved"*, then *"Around you"* — changing as you scroll, the way a sectioned iOS list
carries a sticky header. *Argument:* it is the only piece of information that changes as you use the
screen, and section captions are what make a ranked list legible (§5); a caption that scrolls away is a
caption you cannot check.

**(c) Both, split by state.** Expanded = where you are; collapsed = the section you are in. The card is
open when you land and have not started reading, and by the time it is a pill you are scrolling, which is
exactly when the section matters. *This is my lean*, but it is one more moving part and it needs to be seen
rather than argued.

**What I need from you:** a, b, or c — or "draw all three and I'll look".

### Q5 — is a "time axis" honest, and do you even want one?

Two ways to show the same six departures. Today, and everywhere in the app, it is **a list**: one row per
route, the arrival as a figure on the right — *4 min*, *11 min*, *12 min*.

The alternative — the "time axis" — is a **ruler down the side of the sheet** marked *now · 5 · 10 · 15*,
with each departure drawn as one of our bus tokens **at its position on that ruler** rather than as a
number in a row. Three buses bunched at 11–13 minutes appear as a visible clump; a fifteen-minute gap
appears as an actual gap. It reuses `RailBusToken` and the rail's enter/exit motion, so a bus that departs
is drawn off the top exactly as one leaving a route is today.

**The reason I flagged it rather than just proposing it** is [ADR-008](../08-decision-log.md): ETAs are
approximations and we never fake precision. Drawing a bus at a *position* on a ruler is a continuous claim
built from a value we insist is fuzzy. It could go either way:

- **The optimistic read:** a token sitting *between* the 10 and 15 marks visibly says "about then", where
  the numeral `11 min` reads as exact. The axis would be **more** honest than what we ship.
- **The pessimistic read:** a precise pixel position is a precise pixel position, and riders read it as one.
  Plus Hong Kong frequency is brutal — a Nathan Road interchange over 30 minutes is forty tokens in a
  column, and the axis becomes a queue. It probably only works over 10–15 minutes.

**What I need from you:** is this worth drawing at all? It is **rung 4** — explicitly not in the 1–3 slice
you approved — so the only cost right now is one mockup panel. If it looks wrong on real Hong Kong
frequencies, that is a five-minute answer and we drop it for good; if it looks right, it is the most
distinctive thing the app could do.

**Not at stake in Q5:** the rail on Home. A rail down a list of unrelated stops is decoration (§7c) and is
rejected regardless of how Q5 goes. The only honest spine for a list of unrelated departures is time, which
is what Q5 is asking about.

---

## 12. Suggested rows

Scoped to the owner's answer: **rungs 1–3**. H-10 stays listed and stays out of the slice.

| # | Row | Rung | Effort | Notes |
|---|---|---|---|---|
| H-0 | Mockups: Home at rungs 2 and 3, on a real fix and real favourites, plus Q4's three cards and Q5's axis | — | M | `docs/proposals/mockups/home/`, the shape `06` used. **First.** |
| ~~H-1~~ | ~~Header taxonomy written down, with its enforcement designed~~ | 1 | S | ✅ **done 2026-09-20** — ADR-169, `docs/09` §10, `shell/headers.ts` + `test/header-taxonomy.test.tsx`. **Four kinds, not three** (§7a's guess merged the pushed cases), and it found that scroll ownership is a second axis — Search is `pushed` with an inner scroller |
| H-2 | Settings to a floating top-right lens; free the tab slot | 1 | S | |
| H-3 | Chrome parity on Nearby + Favourites: floating header, glass, motion | 1 | S/M | shippable alone |
| H-4a | ~~Skeletons shaped like their content~~ | 1 | S | ✅ **done 2026-09-20** — `StopCardSkeleton` on Nearby + Favourites, its box held against `StopCard`'s by test, a `pending` panel in the gallery, and `docs/09` §11 carries the rule. Found and fixed a rule in the gallery's own gate (`wordless`) |
| H-4b | Map-matching marker glyph on the card; the row menu (`RouteStopSheet`) | 1 | S | §7d. Deferred behind Q4's board decision — the discovery row's shape changes what the glyph sits next to |
| H-5a | ~~`homeView` + corpus~~ | 2 | M | ✅ **done 2026-09-20** — ADR-177. Three exclusive sections, one card shape, 18 corpus rows at 100 % branch coverage. `savedRows` extracted so Favourites and Home cannot disagree. 🟠 Found a wire gap: `/v1/nearby` sends `routeCount` but no route list, so a discovery card's strip is its readings plus an honest remainder (`docs/07`) |
| H-5b | `home.spec.json` (the UI spec), `/` becomes Home, `/favorites` redirects, the tab bar retires | 2 | M | needs its own ADR for the ADR-100 amendment |
| ~~H-6~~ | ~~The walk-vs-ETA band rule, its ADR and its corpus~~ | 2 | M | ✅ **done 2026-09-20** — ADR-177 decision 4. Three bands, no derived number; a bus that cannot be made has no band and does not enter the section. 🟡 The *far*-case wording (§5a's "leave in about 3 min") is still open and is deliberately not in the kernel |
| H-7a | `RouteMap` → `Map` (polyline optional); Home renders it as a child, lazily | 3 | M | proves the chrome on a second screen |
| H-7b | Lift the map to a shell layer; `MapIntent` + its corpus; camera keyed by history entry | 3 | L | §7e. **Prototype the View Transitions interaction first** |
| H-8 | Shared-element transition: list `RouteChip` → context card badge | 3 | S | the data router's whole reason for existing |
| H-9 | Revisit `favouritesView`'s per-row kerb for the "before leaving" case | 2 | S | §9; kernel, not screen |
| H-10 | `DepartureView` + the time axis | 4 | L | **out of slice**; gated on Q5 and on H-0's panel |
