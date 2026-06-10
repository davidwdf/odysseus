# 06 — Feature & Data-Display Ideas

> The idea menu: how to turn the [data we can get](./02-data-availability-matrix.md) into features
> that make this **the best bus app in HK** — both by **augmenting existing features** and by adding
> new ones, with **progressive disclosure** so power-user depth never clutters the glance-and-go path.
> The curated, sequenced, effort-rated subset is in [`../proposals/`](../proposals/README.md).

## Design stance (so ideas stay on-brand)
- **Glance first, depth on demand.** The hero path (Nearby → next bus) stays one-tap; richer data
  (fares, frequency, accessibility, fleet) lives **one level down** — tap a row → detail; tap an
  "ℹ️"/chevron → a sheet. Nest the nerdy stuff; never gate the essential.
- **Honesty tiers (extends ADR-008).** Label data by confidence: **Live** (ETA), **Scheduled**
  (timetable/`rmk`), **Static** (fares/hours), **Estimated** (bus position, walk time), **Info**
  (accessibility/electric — dated, best-effort). Different visual weight per tier.
- **Free data first.** Prefer the data we **already download** (fares/freq/jt) and official feeds
  over scraping; community/scraped data is opt-in, dated, and clearly sourced.

---

## A. Augment EXISTING features

### Nearby (list)
- **Fare on the route row** — "$6.8" beside the chip (from the fares array we already fetch). Tiny, high-utility.
- **Frequency badge** — "every ~10 min" when no live ETA yet, so a stop never looks dead (uses `freq`).
- **Departure-board toggle** — flip Nearby from "by stop" to **one ETA-sorted stream** of the next departures across all nearby stops (the backlog's "departure-board mode"; great for "just get me on something soon").
- **Filter chips** — operator (KMB/CTB), "step-free", night routes (`N…`), "to <area>". Most are cheap predicates over data in hand.
- **Surface remarks inline** — a small "⚠ last bus" / "scheduled" tag using the `rmk_*` we already parse.
- **"Covered walk" hint** — if a Highways covered-walkway/footbridge is on the path, note it (rain-friendly; HK loves this).

### Stop detail
- **Per-route fare + journey time** — "$6.8 · ~25 min to terminus" under each route (data in hand).
- **First/last bus & frequency** — "Runs 05:30–00:30, every 8–15 min" (GTFS/consolidated).
- **"Last bus gone" / "service ended"** state instead of an empty list (honesty + clarity).
- **Direction/headsign clarity** — we already stamp `→ destination`; add a direction flip where a stop is served both ways.
- **Accessibility line** (progressive) — "♿ step-free (most buses)" as a dated, tappable info row; NLB routes get the real per-departure flag.
- **ETA toggle** — countdown ⇄ clock time (Citybus-style; cheap, loved).

### Route detail (the schematic — already our best surface)
- **Fare-by-segment** — tap two stops → "$6.8 between these" (section fares). A standout few apps do well.
- **Per-stop running fare/time** — show the stage fare and cumulative minutes down the line.
- **Frequency & service span in the header** — "every ~12 min · 05:40–23:50".
- **Direction toggle** in-screen (both bounds are in the index).
- **Map tab** for the route — derived polyline (snap stops→road/OSM) beside the schematic, with the estimated bus tokens on it.
- **Diversion banner** — Special Traffic News matched to this route.
- **"Often electric 🌱"** chip (progressive, dated, hand-curated) — a delighter for the eco-curious and bus fans, clearly "best-effort".

### Favourites
- **Route-at-stop favourites** (ADR-032) — finish it; group saved pairs under their stop.
- **Custom labels & reorder** — "Home", "Office"; drag to order.
- **Time-aware surfacing** — float "Going home" stops in the evening (commute presets).
- **Fare/frequency on saved rows** — so a glance shows cost + how long till the next.

### Settings / chrome
- **Data attribution & "About the data" screen** — required by licence; also a trust moment (explain honest ETAs, what's live vs estimated).
- **Accessibility mode / large-type "Elderly Mode"** (HKeMobility-style) — cheap goodwill.
- **Units & ETA-style prefs** — minutes vs clock default; distance units.

---

## B. New features the data unlocks

### Search (the missing basic — see [04](./04-feature-gaps.md))
- **Omnibox**: route number **and** stop/place name **and** destination, one box, fuzzy + recents.
- **Smart filters**: operator, night, express, "serves my favourite stop", "to <district>".
- **"Routes to here"** from a place — reverse search over origin/destination text.

### Map view
- **Nearby on a map** (MapLibre) — stop pins, walk radius, tap → ETAs.
- **Route on a map** — derived polyline + estimated bus tokens; "where exactly is this kerb" disambiguation.
- **Frequency heat** — visualise which nearby stops have the most buses arriving soon (backlog idea; uses ETA density).

### Fares & money
- **Journey fare calculator** — pick board + alight → fare (+ holiday variant). Sort route options by **cheapest** (App1933/Citybus do this).
- **"Fare changes here"** markers on the route (section-fare boundaries are interesting and rarely shown).

### Smart timing (utility that feels magic — all from ETA + walk time)
- **"Leave now / leave in N min"** — combine walk time to the stop with the ETA.
- **Catch probability** — "likely if you leave now" (honest, fuzzy).
- **Get-off / arrival alarm** — the big table-stakes gap; geofence or stops-remaining countdown (native push in Phase 3; in-session now).

### Trust & disruptions
- **Diversion / special-traffic banner** per route/area (Special Traffic News).
- **"Ghost bus" flag** — surface a bus that vanished from ETA without arriving (data-quality + oddly satisfying; backlog).
- **Confidence over time** — "usually on time here" from our own logged ETA accuracy (longer-term).

### Reach & accessibility
- **Step-free routing/filter** where data allows (NLB live; franchised = static annotation).
- **Spoken arrivals / glance mode** — giant countdown, eyes-free (backlog).
- **More UI languages** for tourists (chrome only; data stays en/繁/简).

---

## C. Progressive-disclosure map ("dig deeper" without clutter)
```
Nearby row        →  [chip] → dest · next ETA · "$6.8" · (⚠ if remark)
  └ tap stop      →  Stop detail: routes × {ETA toggle, fare, ~freq, first/last}
       └ tap route→  Route schematic: per-stop time+fare, direction toggle, [Map]
            └ Map  →  derived polyline + estimated bus tokens + diversion banner
            └ ℹ️    →  "About this route": operator, service span, accessibility (dated),
                       "often electric" (best-effort), data sources
```
Each downward step adds depth for the curious; the top row stays glanceable.

## D. Bus-fan & delight layer (巴士迷) — mostly already in the backlog
- **Fleet/spotting cards** (community data, opt-in, dated): deck type, model, "often electric".
- **Route collection / badges**, **commute streaks**, **shareable arrival "boarding-pass" card**.
- **Dot-matrix / split-flap ETA display** liveries (flip on real data change = honest animation).
- **"Bus bell" chime + haptic** on Due (easter egg).
- **Crowd-sourced crowding** — 1-tap "how full is it?" (the only realistic occupancy path, since it's not in open data).

## E. Explicitly *don't* build (data isn't there — [02](./02-data-availability-matrix.md))
- A **live moving-bus dot from real GPS** (none exists — only our *estimated* tokens).
- **Live occupancy from a feed** (closed/absent — crowd-source instead).
- **Per-trip exact bus model** (allocations rotate; community "usually" only).
- **Child/elderly fare amounts** (only full adult fares are data; show the $2-scheme *rule* as info).

> Sequencing & effort/impact for all of the above → [`../proposals/00-fast-and-fun-wins.md`](../proposals/00-fast-and-fun-wins.md).
