# Route detail — interaction mockups

Clickable prototypes for [`proposals/06 §8`](../../06-maps-and-route-geometry.md). Four paradigms for
what a tap on a stop row *means* once there is a real map on the screen.

```bash
cd docs/proposals/mockups/route-detail
python3 -m http.server 8099
open http://localhost:8099
```

Serve it over HTTP — opening `index.html` from the filesystem makes the browser refuse the `fetch` of
`kmb1.json`.

## What is real

- **The route line is KMB route 1's actual surveyed alignment** — 391 vertices outbound, from the
  Transport Department's CSDI Bus Route dataset (`ROUTE_ID 1001`), fetched 2026-08-22. It follows Nathan
  Road because that is where the bus goes, not because anyone drew it.
- **The 25 stops are the real ones**, with their real names in English and Chinese, from the consolidated
  route list we already fetch.
- **The basemap is the real Lands Department raster**, with the real English label overlay.
- **The camera flight is the real shape** — `flyTo` with a zoom dip proportional to distance, which is
  what MapLibre gives you by default and what hkbus relies on.

ETAs are invented. Your location is a simulated fix.

## What to try

| | |
|---|---|
| **Switch paradigm** (A/B/C/D) | The whole point. Watch what a tap on a row does, and where favouriting goes. |
| **Tap a stop row** | In A it opens the sheet; in B/C/D it flies the camera and selects the row. |
| **Scroll the stop list** | The camera follows — scroll-spy → `flyTo`. |
| **Drag the map while scrolling** | Following **suspends** and a *Recentre* button appears. This is the loop-avoidance from §6, and the thing most likely to feel wrong if it is not designed. |
| **Route geometry → hkbus's unmarked straight line** | The §5 question, made visual. Same stops, no notice. |
| **Route geometry → dashed approximation** | The recommended option (c): honest and still useful. |
| **Direction arrowheads off/on** | ADR-080's *"which side of the road do I wait on"* answered with cartography. |

## What is deliberately wrong, and must not be copied

1. **Tiles are fetched straight from the Lands Department.** The shipped app goes through our Worker
   (`/v1/tiles/…`) — caching and licence compliance live there (ADR-049), and rule 2 forbids a view
   knowing a URL at all. A static file in `docs/` has no Worker to talk to.
2. **Colours are raw hex.** The app uses semantic tokens only (rule 4). This file has no build step.
3. **The map is a hand-rolled slippy map.** The real one should be MapLibre behind the `MapProvider`
   seam (§2). This exists to make the *behaviour* arguable, not to be a starting point for the code.

---

## `round-2.html` — after the first review

`index.html` is the record of round 1 (A/B/C/D). `round-2.html` is the follow-up, once C and D were
dropped and the real constraint set turned out to be **no permanent per-row chrome · one tap to see a
stop on the map · unbounded room for future actions**.

It has **two independent controls**, so the combinations can be felt rather than argued about:

| Action surface | |
|---|---|
| **E** | The tapped row expands in place to reveal Save · Notify me · Stop |
| **H′** | A floating card appears at the map/list seam, naming the stop and carrying the same actions |
| **A** | The sheet, for contrast |

| Screen shape | |
|---|---|
| **List-dominant** | Close to today. The recommended default. |
| **Half** | Map and list share; the camera flight finally reads as following |
| **Map-first** | The "peek" idea — map is the shell, the list rests over it |

**Drag the grab handle** to move between shapes; it snaps to the nearest detent.

The one thing worth doing deliberately: select **E**, then tick **"…and scroll also opens the row"** in
Behaviour and scroll the list. That is the failure mode that decides E vs H′, and it is much more obvious
felt than described.

> Note when driving this from an automated browser: a backgrounded tab **freezes CSS transitions**, so
> the sheet appears not to move and `getComputedStyle(...).top` lags the inline style. Inject
> `*{transition:none!important}` before measuring. This is a property of the harness, not the mockup.

---

## `round-3.html` — the collapsing header over a map shell

Answers "how does this meet the existing route header?". The map is **full bleed**; the header floats
over it with no bar background, exactly as `apps/mobile/components/CollapsingHeader.tsx` (ADR-033)
intends. The badge morphs into a glass pill beside the floating back lens.

**Scroll with the wheel over the list** — the sheet rises first, then the list scrolls. One motion.

Two toggles that each demonstrate a decision:

- **Chain list scroll → sheet.** Off, the sheet only moves by its grab handle and the header collapse
  decouples from scrolling. On is the Apple-Maps behaviour and the reason the header still reads as
  "collapse on scroll".
- **Continuous morph.** On, the badge tracks the gesture (what `apps/mobile` does with a Reanimated
  shared value). Off, it flips at a threshold with a 200 ms cross-fade — **what `apps/web` does today**,
  and the most likely reason the DOM header feels wrong.

Tile resolution here is fixed at the recommended **base z+1, labels z** (see `round-2.html` to compare
all three).

---

## `round-4.html` — the owner's counter-proposal (current front-runner)

One **floating context card** behind the back lens: badge centred on the back button's row, route facts
inside. **Any map drag or list scroll shrinks it by width** into a pill; **tap to expand**. 50/50 split.

Expanded, the card runs full width and tucks **behind** the back lens, with a large centred badge that
pushes the destination clear of the button. Collapsed, the card's left edge steps **right** to clear the
lens, its content shifts **left**, the badge shrinks and the body folds — leaving a **full-width pill** so
the destination gets all the room there is.

Tapping a stop opens the **action sheet**, as today. (Reusing the card for the selected stop was tried and
rejected: a sheet is modal so a mis-tap dismisses, whereas a card that silently swaps contents has no way
back to the route facts.)

One toggle: **Re-expand when the list returns to the top** — restores the "scroll back up and the header
comes back" reflex without making the collapse continuous.

Note: HK destination names are long, so the pill relies on ellipsis. `CollapsingHeader` already exports a
`Marquee` for exactly this and should be reused rather than re-solved.

---

## `round-5.html` — path & marker styling

`round-4`'s layout with a styling panel instead of the interaction one. Colours are the real
`OPERATOR_ACCENT` tokens, not hand-picked hex.

- **Operator** — KMB · LWB · CTB · GMB. **Try CTB**: its accent is `#F6C700`, the same yellow LandsD
  uses for major roads, and the line all but disappears. That single case is what decides whether the
  route line can be the operator colour straight.
- **Line** — operator accent · map-safe accent (same hue, darkened) · neutral dark · hairline.
- **Direction marks** — chevron · casing chevron (reads as a notch in the line, not a symbol on it) ·
  filled triangle (what round 1–4 used) · flowing dash (animated) · none.
- **Stop markers** — haloed · graded (termini square, selection large, intermediate small and quiet) ·
  declutter by zoom · plain.
- **Label size** — native `z`, or `z−1` for larger, sparser, softer text. LandsD bakes label size into
  the raster, so this is the only lever short of a vector basemap.

Round 5 also carries a **zoom readout** (top of the panel, and logged on every change), so a zoom at
which the stop markers stack unhelpfully can be named precisely rather than described.

**Round 5 defaults after review:** neutral-dark line · casing chevron at its own (thinner) weight ·
smooth corners · hybrid markers — haloed circles for stops, squares for termini, each with a thin dark
hairline on its outside edge — bigger, and tappable. Termini are squares in the stop list too.
The **Dark map** toggle exists to show why the line colour needs a light/dark pair.

**Round 5, later passes.** Zoom buttons ease rather than jump, and hold the *visible* centre.
Direction marks are placed by **arc length on the rendered path** (`getPointAtLength`), so spacing is
exact and double/triple chevrons stay on the curve — 0.08 px worst deviation over a 4,603 px route,
where vertex placement drifted visibly at bends. Stop markers can **snap to their own side of the
line**: tidy like a centre-snap, but it still says which kerb. Termini are squares sized to match the
circles. A stop whose name contains `BBI` is drawn as a **hexagon** — KMB 1 has exactly one, Tsim Sha
Tsui BBI · Middle Road.

**Settled in round 5:** neutral-dark line, medium width · double chevron at fine weight, spaced
*between stops* · smooth corners · hybrid markers at the largest size, **no halo** · termini as squares
sized to match the circles · BBI stops as hexagons · markers offset to the **left of travel**, which is
the kerb a Hong Kong rider boards from · direction marks reduced to **double chevron** and **dart**.

**Dark mode is done too.** The tiles invert by filter and the overlay inverts by design: a light line,
dark marker fills, light borders and hairlines, and chevrons that follow the casing. Label size stays at
native `z` — with a raster basemap that is the ceiling, and only a vector base would lift it.

The **dark line is its own choice**, not a tint: inverting the tiles turns LandsD's label text white and
its road fills warm tan, so a near-white line reads as a label and an amber one collides with the roads.
The default is simply the **inverted light colour** — cyan and mint are the better chromatic options
and are one click away, but that choice belongs against the app's real tokens, not a prototype. The **double chevron is one glyph** — a
single rotated group with both halves offset inside it — the gap between them is adjustable, and
placement is **bend-aware**: a mark slides along its slot to the straightest spot it can reach, and is
dropped if even that is a corner.

**Final settled interaction (round 5).** Tapping a stop row **focuses it on the map** and does nothing
else; a permanent `⋯` at the far right of every row opens the action sheet; tapping a marker selects the
stop and scrolls its row into view. Scrolling collapses the context card but **no longer changes the
selection** — the scroll-spy was built, demonstrated and cut, because having the camera chase the scroll
read as finicky in use.
