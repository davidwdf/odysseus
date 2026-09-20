# Home mockups — Q4 and Q5

> Built 2026-09-20 for [`proposals/07 §11`](../../07-home-and-a-shared-design-language.md), the two questions
> left open after the owner approved rungs 1–3. Same shape as
> [`mockups/route-detail/`](../route-detail/README.md), which settled Route detail in five rounds: a
> self-contained HTML file per question, opened straight from disk, no build step and no server.

| File | Round | Question | What it is for |
|---|---|---|---|
| [`q4-context-card.html`](./q4-context-card.html) | 1 | What goes in Home's floating card? | Three Home screens, identical but for the card. **Superseded** — the card was the wrong question; see `q4b`. |
| [`q5-time-axis.html`](./q5-time-axis.html) | 1 | Is a time axis honest? | List vs uniform axis at three densities. Established that the interchange breaks a uniform axis. |
| [`q4b-what-is-this-screen-for.html`](./q4b-what-is-this-screen-for.html) | **2** | **What is this screen _for_?** | Three boards — everything-with-times, stops-only, and the split. The card is held constant. **Start here.** |
| [`q5b-elastic-axis.html`](./q5b-elastic-axis.html) | **2** | **Elastic axis, and what happens when the data moves** | Uniform vs elastic vs hybrid, with a **“Next round”** button that lands fresh data so reordering can be judged. No ± band. |

| [`q4c-one-card-shape-and-the-chrome.html`](./q4c-one-card-shape-and-the-chrome.html) | **3** | **One card shape · does the tab bar survive?** | Option C refined: star on the **route**, chip strips on saved places too, a tappable `+14` that expands. Three chrome options. **Live.** |
| [`q5c-place-detail-merge.html`](./q5c-place-detail-merge.html) | **3** | **Timeline + saved + grouped by kerb** | The owner's merge, on **Place detail** rather than Home. Shipping screen beside it. **Live.** |

**Round 3 is the live one.** Earlier rounds are kept because their findings are cited — `q5`'s nudge count
is what killed the uniform axis, `q4b` is where the board question was asked, and `q4`'s three cards are the
options the *card* question returns to once the chrome is settled.

**Open them by double-clicking.** The two `q4` files fetch LandsD basemap tiles and need a network; they
degrade to a flat colour without one, which is fine for judging a board. The `q5` files need nothing.

---

## What is real and what is faked

These are prototypes, and the gap between them and the app is deliberate — worth knowing before reading
anything off them as a decision.

**Real, and taken from the codebase:**

- Every colour, radius and type size is the emitted value from `packages/ui/tokens.json` — both modes.
- The operator accents are `OPERATOR_ACCENT`'s four, with `OPERATOR_ACCENT_TEXT`'s contrast pairing (CTB
  yellow takes dark text).
- The sheet's three detents are `ROUTE_DETENTS` — `0.22 / 0.55 / 0.88`, opening at `half`, snapping to the
  nearest on release.
- The collapse rule is the shipping one: any scroll off the top collapses the chrome, and returning to
  `scrollTop === 0` re-expands it.
- The glass is the fallback recipe both renderers actually ship — `blur(13px) saturate(1.8)` — not the
  Chromium-only displacement filter.
- Stop names, route numbers, destinations and frequencies are Hong Kong-shaped: Yau Ma Tei / Jordan / Mong
  Kok, with a 22-departure interchange because that is what Nathan Road does.

**Faked, and it matters:**

- 🔴 **Raw hex, not tokens.** These files would fail `check-no-raw-colours` instantly. They are prototypes and
  are not in the app's `content` glob.
- 🔴 **The board is hand-written.** In the app every row comes from `homeView` in `packages/core` and nothing
  in a screen decides anything. Do not read the ordering here as the proposed ranking — that is §5 of the
  proposal, in prose.
- 🟠 **The bus glyph is a simplification of `RailBusToken`.** ADR-132 spent seven rounds on the real decker and
  minibus; the one here has the right two-band / one-pane distinction and none of the tuning.
- 🟠 **The tab bar shows `Home · Map · Saved`**, which is §8's *recommendation*, not a decision. It is drawn
  because a Home screen with today's `Nearby · Favourites · Settings` bar under it would be confusing to look
  at, not because the tab set is settled.
- 🟠 **No live data, no staleness, no failure states.** Every spec state the real screen owes is absent.
  `FeedNotice` is not drawn at all.
- 🟠 **The map does not pan or zoom** and has no `MapIntent` behind it. The pins are positioned by percentage.

---

## Q4 — reading the three options

Each column is the same Home: same map, same board, same collapse, same tab bar. Only the card differs.

- **(a) Where you are** — locality, the fix's freshness, a recentre control. Collapsed: locality + glyph.
- **(b) Where you are in the list** — a section index you can tap to jump. Collapsed: the section you are
  reading, changing as you scroll.
- **(c) Both** — (a) expanded, (b) collapsed.

**The controls that matter:** *Last known, 6 min ago* is (a)'s whole argument — watch that there is nowhere
for it to go in (b). *Tsim Sha Tsui East* tests the collapse against a long name, which is the finding that
shaped Route detail's round 4 (HK destination names barely collapse; a locality is shorter and does better).

**One structural difference from Route detail, visible immediately:** Home is a tab root, so there is no back
lens for the card to tuck behind. Settings is the floating lens and it sits top-right, so Home's card
collapses by shrinking from the right rather than stepping sideways past a lens. That is a simpler motion
than `RouteContextCard`'s — no `left` transition at all — and it is worth knowing before anyone tries to
share one component between the two screens.

## Q5 — reading the axis

The left phone is what ships today. The right is the axis. The line above them counts the thing worth
counting: **how many tokens have been nudged off their true position to stay legible**, and how many
departures the window drops entirely.

Try, in order: *Man Ming Lane* at 15 min (nothing nudged — the axis is honest and rather good); *Nathan Road*
at 15 (a clump forms); *Mong Kok* at 10 (the nudge count is most of the board). The third is the case that
decides it, and it is not a rare one.

The **± 2 min band** toggle draws the uncertainty rather than a point, which is the obvious answer to the
ADR-008 worry. It works. It also costs the density the axis had left.

---

## What these do not ask

The ranking rule, the section names, the merge itself, the tab set, the map architecture (`MapIntent`,
§7e) and everything in rungs 1–3. All of those are either settled in the proposal or are prose questions
that a picture cannot answer.


---

## Round 2 — what changed, and the two things the mockups found

**`q4b`.** The owner's round-1 verdict was *"I'm not 100% clear on what I'm supposed to be doing on this
screen"*, which is a finding about the **board**, not the card. So the card is held constant across all
three phones and the board varies: **A** is round 1 (every section carries times), **B** is the owner's own
suggestion (places only, no arrivals anywhere), **C** is the split — saved content keeps arrivals, discovery
content is places with a strip of route chips and no claimed times. The controls toggle dark mode and an
empty saved list, because a cold install is the state that decides whether C is a structure or a special
case.

**`q5b`.** Three corrections from the owner's note, all built:

- The **± 2 min band is gone.** It was ADR-123's withdrawn per-figure cue proposed a third time.
- The **elastic axis** — the owner's suggestion — works, and the trick that keeps it honest is that **the
  ruler's ticks move with the content**, so position still equals time as read against them. A stretched
  interval draws its rule dashed. The nudge count reaches zero at every density.
- **Shifting positions** are driven by a *"Next round"* button rather than argued about. 🟢 **It found a
  defect in its own cue on the first run:** marking "reordered" by array index lit up 16 of 16 rows at an
  interchange, because one bus departing shifts every index behind it. Recomputed over the buses present in
  **both** rounds, ranked within that intersection, it is 6 of 16 — which is the truth. A cue that fires on
  everything says nothing.


---

## Round 3 — what changed

**`q4c`.** Two corrections from the owner, and the second is the better idea.

- 🔴 **The star was on the wrong object.** A favourite is `formatFavoriteRouteKey(stopId, routeId)` — a
  *route at a pole*. A place is never starred, so round 2's star on the card heading claimed something the
  data model cannot store. It is on the route now, and the mockup toggles the two candidate treatments: a
  **pip on the badge** (what `docs/07` has wanted for months — "saved reads as a property of *that route*,
  and the row's right edge belongs to the ETA alone") or a **star beside it**. Check both against the CTB
  yellow and the GMB green, in dark mode.
- 🟢 **Chip strips on saved places too**, which collapses round 2's open risk: there is no longer a saved row
  shape and a discovery row shape, there is **one card** — heading, your starred routes here with times,
  then everything else as chips. A nearby card is that card with no starred rows yet.
- The **expanding strip** is real: tap any `+N`. Expanded, every route wraps and a chevron-up ends the list.
  The collapsed count must come from the kernel (see the proposal's §0b); expanding is a rider's tap and is
  legitimately the view's.
- **Three chrome options**: keep the bar · two lenses · a labelled search pill. The proposal argues the bar
  has run out of destinations, and that retiring it **amends ADR-100** and wants its own ADR.

**`q5c`.** The timeline moves to **Place detail**, which is a better home than Home: the density is bounded
to one place, and the timeline is the only view on that screen that *ignores kerb boundaries* — which is
exactly what the grouped list below it exists to respect. The kerb badge on each token is what stops the
axis being a duplicate of the list. Compare against the shipping screen in the left column, and try the
quiet one-kerb place — that is the case that decides whether the timeline needs a floor.


---

## Round 4 — the refinements (2026-09-20)

Applied in place to the round-3 files rather than as new ones, because these are corrections to a design
that is now settled rather than options to compare.

**Q4 (`q4c`).**

- **No label above the chip strip.** *"I feel like the badges should be obvious enough."* Right — a heading
  for something already obvious is noise on the screen that is meant to be the scannable one.
- **The saved flag is the rail's two-star cut-out**, not a coloured pip. The owner's description turned out
  to be, word for word, what `RouteStopRow` already draws on a saved stop's node — so this became an
  extraction (`SavedFlag`) rather than a new mark. The `starLeft` toggle now shows the same flag beside the
  chip instead of on it, so the comparison is about *placement* only.
- **The labelled search pill is withdrawn.** *"I still prefer an unlabelled search button — search is a well
  known icon."* All three phones now draw a lens; the third column is kept as the place the settled chrome
  lives rather than as an option.
- **No tab bar.** Settled. Tapping a place opens Place detail; tapping a route — starred row or chip in the
  strip — opens Route detail.

**Q5 (`q5c`).**

- **The bus glyph is out of the timeline.** *"It looks fun but it makes it a little too busy."* The node is
  a plain mark now. `busGlyph` is **parked, not deleted**, with the owner's note beside it.
- **"now" → "Due"**, matching the app's own word for a bus under a minute away.
- **Boarding-point codes are real** — `ST510`, `GM1247` — not the two-character placeholders round 3
  invented. The kerb badge is what stops the timeline duplicating the list, so it has to fit a real code.
- **The map is the shell's**, drawn dashed here to say so: `proposals/07 §7e` is the model, and Place detail
  becomes the second screen in the header taxonomy's `map` row.
