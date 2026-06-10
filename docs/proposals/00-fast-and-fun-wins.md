# 00 — Fast & Fun Wins

> High impact, low-to-medium effort, mostly on data we **already download** or helpers we
> **already have**. Sequenced. See [proposals README](./README.md) for scoring. Honesty tiers
> per [research 06 §Design stance](../research/06-feature-improvement-ideas.md).

## ⭐ Start-here five (a week of work, app jumps a tier)
1. **Fares, everywhere** — we already download them; surface them. *(P1)*
2. **Frequency + journey time** — same parse, same plumbing. *(P2)*
3. **Surface remarks + freshness** — already in the model; just render. *(P3, P4)*
4. **ETA clock⇄countdown toggle** — `formatClock` already exists. *(P5)*
5. **Route search (fill the empty Routes tab)** — the most glaring missing basic. *(P6)*

> **Update (2026-06-10):** **P1–P3 shipped** ([ADR-036](../08-decision-log.md)) — fares, frequency,
> journey time, service hours and ETA remarks now surface across Nearby/Stop/Route, all from data we
> already fetched. Verified against the live worker; typecheck 7/7, Biome clean.
>
> **Update (2026-06-10):** **P6 + P7 shipped, P8 mostly** ([ADR-037](../08-decision-log.md)) — the empty
> Routes tab is now a **Search** page (its own no-tabs screen, launched from a floating button): a smart
> route-number keypad (valid-next-key lit) + stop/place text search over a cached **on-device index**
> (edge `/v1/index`), with **filter chips** (operator — data-driven so GMB/MTR appear when added — plus
> Night/Airport/Express). Filters currently live on Search, not yet on Nearby (the rest of P8).
>
> **Update (2026-06-10):** **P10 shipped** ([ADR-038](../08-decision-log.md)) — a Settings **About** section with
> an **"About the data"** screen (full-width rows; source + licence **link rows** that open in a new tab) and an
> **FAQ** screen (which owns the freshness/honesty notes). Satisfies the launch-blocking attribution requirement.
> Trilingual; typecheck 7/7, Biome clean.

## Scoreboard
| # | Win | Impact | Effort | Data in hand? | Fun |
|---|-----|:--:|:--:|:--:|:--:|
| ✅ P1 | Fares on Nearby / Stop / Route | ⭐⭐⭐⭐⭐ | M | **Yes** (consolidated `fares`) | |
| ✅ P2 | Frequency + journey time + first/last | ⭐⭐⭐⭐ | M | **Yes** (`freq`/`jt`) | |
| ✅ P3 | Surface ETA remarks (Scheduled / Last bus) | ⭐⭐⭐⭐ | S | **Yes** (`Eta.remark`) | |
| P4 | Freshness "updated Ns ago" + stale grey | ⭐⭐⭐ | S | **Yes** (`observedAt`/`isStale`) | |
| P5 | ETA countdown ⇄ clock-time toggle | ⭐⭐⭐ | S | **Yes** (`formatClock`) | 🎉 |
| ✅ P6 | Route-number search (Search tab) | ⭐⭐⭐⭐⭐ | M | index has it (+ tiny endpoint) | |
| ✅ P7 | Stop / place search | ⭐⭐⭐⭐ | M | index has it | |
| ◐ P8 | Filter chips (operator / night / airport / express) | ⭐⭐⭐ | S–M | mostly | |
| P9 | Departure-board mode (ETA-sorted stream) | ⭐⭐⭐⭐ | M | **Yes** | 🎉 |
| ✅ P10 | Data-attribution / "About the data" screen | ⭐⭐ (req.) | S | n/a | |
| P11 | Direction toggle on route detail | ⭐⭐⭐ | S–M | **Yes** (both bounds indexed) | |
| P12 | Section-fare picker (tap board→alight) | ⭐⭐⭐⭐ | M | **Yes** (`fares` array) | 🎉 |
| P13 | "Leave in N min" / get-off countdown (in-session) | ⭐⭐⭐⭐ | M | **Yes** (ETA + walk) | 🎉 |
| P14 | Split-flap / dot-matrix ETA flip on data change | ⭐⭐⭐ | M | **Yes** | 🎉 |
| P15 | "Often electric 🌱" + accessibility info rows | ⭐⭐ | S–M | curated/static | 🎉 |
| P16 | Diversion banner (Special Traffic News) | ⭐⭐⭐ | M | new feed | |

---

## The headline: P1 — Fares, everywhere 💰
**Why:** Fares are the #1 piece of info riders want that we don't show, every competitor with fare
data is loved for it, and **we already download it** ([research 01 §9](../research/01-open-data-catalog.md),
[03 §11](../research/03-app-feature-inventory.md)). This is mostly UI.

**What:** Show the route fare on the Nearby route row ("$6.8"), on Stop detail rows, and in the
Route schematic header; later, per-segment ([P12](#p12)).

**How (concrete):**
- `packages/data-normalize/src/dataset.ts` — add `fares`/`faresHoliday` to the `RawRoute` interface
  (they're already in the JSON) and carry onto `IndexRouteMeta`.
- `apps/edge/src/static-index.ts` / `stop-route.ts` / `nearby.ts` — include a `fare` on the route meta
  in `/v1/route`, `/v1/stop`, `/v1/nearby` responses.
- `packages/core/src/types.ts` — add optional `fare?: { full: string; holiday?: string }` to `Route`
  (or to the nearby/stop row), keeping the `DataSource` seam intact.
- UI: render in `StopRow.tsx`, stop/route screens. Use the **Static** honesty tier (no live pulse).

**Watch out:** the `fares` array is per **boarding-stop index** along the route — for a single
"board here" fare, index by the stop's `seq`; the whole-journey "from origin" fare is `fares[0]`.
Holiday vs weekday: pick by today (HK public-holiday calendar is in GTFS `calendar_dates`, or use a
simple weekend heuristic to start). Adult full fare only — see P15 for the $2-scheme info note.

**Done when:** a Central nearby card shows "$6.8", Stop/Route show fares, typecheck 7/7, no raw hex.

## P2 — Frequency, journey time, first/last bus 🕒
Same plumbing as P1 (`freq`/`jt` are in the consolidated file; richer service-day data in GTFS).
Show "every ~10–15 min" and "~45 min end-to-end" in the Route header, "Runs 05:30–00:30" on Stop
detail, and a **frequency badge on Nearby when there's no live ETA yet** (so a stop never looks dead).
Parse `freq` (day-type → time-band → headway) defensively; start with "typical" headway if the
band logic is fiddly.

## P3 — Surface remarks ⚠️ (already parsed, never shown)
`Eta.remark` (`rmk_*`) is captured and dropped at the UI. Render a small tag: **"Scheduled"**
(timetable, lower confidence), **"Last bus"**, diversion notes, "KMB Cycle". Pure UI; big honesty
gain. Pair with a confidence style (dashed/greyed for scheduled).

## P4 — Freshness indicator (honesty made visible)
We have `observedAt` + `isStale()` in `@nextbus/core/eta` but don't show them everywhere. Add a
subtle "updated Ns ago" and **grey out stale rows** across Nearby/Stop/Route. Directly fulfils the
ADR-008 promise; near-zero risk.

## P5 — ETA countdown ⇄ clock toggle 🎉
`formatClock` already exists beside `formatRelative`. A tap (or a Settings default) flips "9 min" ⇄
"15:42". Citybus users love this; trivial.

## P6 — Route search (fill the empty Routes tab) 🔎 — ✅ shipped ([ADR-037](../08-decision-log.md))
~~The Routes tab is a placeholder and it's the most glaring gap~~ ([04 A1](../research/04-feature-gaps.md)).
**Shipped:** a compact route+stop index ships from the edge **`/v1/index`** (we went with shipping the list
to the client over a query endpoint, since the **smart keypad** needs the route-number set on-device for
instant valid-next-key feedback). A trie-driven number keypad handles `A41`/`N691`/`971P` by construction.
**Fun extensions still open:** sort results by **cheapest** / **fewest stops** (App1933-style).

## P7 — Stop / place search 🔎 — ✅ shipped ([ADR-037](../08-decision-log.md))
**Shipped:** stop/place name search (any-locale match) over the same on-device index — which is the **first
realization of the on-device index** ([ADR-007](../08-decision-log.md)), cached stale-while-revalidate so it
also works offline ([bigger bets](./01-bigger-bets.md)). **Still open:** "routes to <place>" reverse search
over origin/destination text.

## P9 — Departure-board mode 🎉
An alternate Nearby view: **one ETA-sorted stream** of the next departures across nearby stops
(backlog item; reuses the data Nearby already fetches). It's the natural home for the **split-flap /
dot-matrix** display liveries — pairs with P14.

## P11 — Direction toggle on route detail
Both bounds are in the index; let the schematic flip inbound/outbound in place. Small, expected.

## P12 — Section-fare picker 🎉 {#p12}
On the route schematic, tap a boarding stop then an alighting stop → "$6.8 between these" (from the
`fares` array). Few apps do this well; it's genuinely useful and a little delightful. Builds on P1.

## P13 — "Leave in N min" / in-session get-off countdown 🎉
Combine walk-time-to-stop (we already compute `walkMinutes`) with the ETA → **"Leave in 3 min to
catch the 15:42."** And an **in-app get-off countdown** ("3 stops to go") while a route is open —
the alarm everyone wants, no native push needed for the in-session version (full background alarm is
a [bigger bet](./01-bigger-bets.md)).

## P14 — Honest motion: split-flap / number-flip on data change 🎉
Reanimated is installed but unused. Animate the ETA **only when real data changes** (flip-tile or
number-roll) — delightful *and* honest (ADR-008). Plus the freshness pulse and shimmer skeleton.
Doubles as the display-livery payoff.

## P15 — "Often electric 🌱" + accessibility info rows 🎉
Best-effort, clearly **dated/static** info ([02 §7–9](../research/02-data-availability-matrix.md)):
a small hand-curated table of "often electric/hydrogen" routes (eco + bus-fan delight) and a
"♿ step-free (most buses)" line (with NLB's real per-departure flag where available), plus the
**$2-scheme rule** as an info note (the amounts aren't data). Tone: **Info** tier, never "live".

> **Ruled out (2026-06-10, [ADR-040](../08-decision-log.md)):** App1933 shows a **live per-departure**
> electric-bus **green leaf** and a **seat-occupancy** display — but both come from KMB's *private*
> app backend (internal roster + SmarTone IoT sensors), **not** the open API, and scraping them loses
> on ToS/licence, fragility (auth + cert-pinning), and honesty. So P15 ships **only** the curated,
> dated route tag; **occupancy is out-of-scope** (crowd-source is the only honest path — see
> [research 06](../research/06-feature-improvement-ideas.md)).

## P16 — Diversion banner
Fetch TD **Special Traffic News**, match to route/area, show a "⚠ diversion" banner on Stop/Route.
New feed + matching, but high trust value when buses are disrupted.

---

### Suggested sequence
**Week 1 (the data-we-own unlock):** P3 → P4 → P5 → P1 → P2.
**Week 2 (the missing basics):** P6 → P11 → P8 → P10.
**Week 3 (depth + delight):** P12 → P9 → P14 → P13 → P15 → P16.

Each respects the golden rules (DataSource seam, semantic tokens, trilingual, honest ETAs) and the
docs-in-sync hook — record any cross-cutting choice as a new ADR in [`docs/08`](../08-decision-log.md).
