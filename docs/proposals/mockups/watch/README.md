# Watch a stop — pill & card mockups

A clickable prototype for [`proposals/07`](../../07-watch-a-stop.md): **five shapes** the floating watch
element could take, and **three shapes** for what it expands into.

```bash
open docs/proposals/mockups/watch/index.html    # round 1 — five pills, three cards
open docs/proposals/mockups/watch/round-2.html  # round 2 — A with no tab bar, cards restyled
open docs/proposals/mockups/watch/round-3.html  # round 3 — the settled shape, measured at 390 px
```

No server needed — it fetches nothing.

## What to try

| | |
|---|---|
| **Tap any pill** | It expands into its card. Tap again to collapse. |
| **Board says → Due / Nothing due / Board failed / Offline** | **The point of the page.** Most of the difference between the five shapes is in the unhappy arms, not in *"3 min"*. Watch what B and E do when the readout becomes a sentence. |
| **Board says → Stale feed** | The staleness sentence, said once per board rather than marked on a figure (ADR-123/133/150). |
| **Expand all** | Every card open at once, for comparing heights against the content they cover. |

## What is real

- **The tab bar's geometry**: 54 px tall, 12 px inset, 24 px radius, and a search lens the same size as the
  bar is tall — `apps/web/src/shell/layout.ts`. So the crowding you see at the bottom edge is honest, and it
  is the main thing the five variants trade against each other.
- **The arms and their order** — loading → incomplete → readings → no service (ADR-088), and the four
  unhappy states a real board can be in.
- **The stop, route and destination** are a real KMB 1 pole on Nathan Road.

## What is deliberately wrong, and must not be copied

- **Raw hex, not `@nextbus/ui` tokens.** `check-no-raw-colours` would reject every colour in this file.
- **English-only strings.** The real thing reads `@nextbus/i18n` in three locales, and the stop and
  destination are `I18nText` from the canonical model.
- **The ETAs are invented and never change** — there is no data layer here, so nothing ticks. The real pill
  updates only when a frame lands (ADR-008: no client-side countdown).
- **`max-height` expansion.** The real card animates a measured height; this one animates to a guess, which
  is why the motion is slightly wrong on the taller cards.
- **Nothing here is accessible yet.** §5.6 of the proposal is the open question about what a screen reader
  should hear from a figure that changes every 45–60 s, and this page does not attempt an answer.

## Round 2

`round-2.html`, after the owner's round-1 read. The tab bar is **removed**, so the pill inherits the bar's
inset and radius rather than stacking on it; the search lens moves **above** the pill (beside it, it costs
the stop name at 360 px). D's rail is gone and what varies is how much of D's *information* A can carry —
A1 (as it was) · **A2 (“2 stops away” as a clause)** · A3 (progress as the pill's own bottom edge) ·
A4 (the next time too, which also costs the stop name). Cards: C1 boxed slots · **C2 one big figure with the
named next stops** · C3 no rail at all.

Two rules were found by drawing the unhappy arms rather than argued for: **a sentence arm rides the
sub-line**, never the figure slot (the stop's name must not truncate — it is what you are watching), and
**“Stop watching” is not red** (accent is a livery colour here; ending a watch is not destructive).

## Round 3

`round-3.html`, at **390 px** so the truncation is real. The pill **shares the bottom row with the search
lens** and rises above it to open at full width (§1); the **podcasts-style dock** is measured (§2); and the
second line's candidates are compared (§3) now that *"2 stops away"* is withdrawn — a stop count is not a
duration when HK stops sit 1 to 10 minutes apart.

The two numbers that decided the design: **296 px** of pill beside the lens, where the chevron is the 19 px
that makes *"Nathan Road / Jordan Road"* fit or not; and **226 px** inside a tabs+pill+lens dock, where the
stop name does not fit in **any** arrangement — so at that width the pill should show the badge and the
figure and nothing else.
