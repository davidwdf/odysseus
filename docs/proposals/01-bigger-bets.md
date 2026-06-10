# 01 — Bigger Bets

> Larger, higher-ceiling work that needs new infrastructure, a native build, or a derivation
> pipeline. These are where the app goes from "great HK ETA app" to "the one people recommend".
> Scored as in the [proposals README](./README.md). Most build on the [fast wins](./00-fast-and-fun-wins.md).

## B1 — Map view (Nearby + Route) 🗺️ — ⭐⭐⭐⭐⭐ · L
The expected mental model, and a gap vs every polished competitor.
- **Nearby map** (MapLibre, per roadmap Phase 2): stop pins, walk radius, tap → ETAs.
- **Route map:** we must **derive the polyline** — there are **no official route shapes**
  ([research 02 §4](../research/02-data-availability-matrix.md)). Snap the ordered stop coordinates to
  a road graph (TD **Road Network 2nd-gen** or **OSM** via a routing engine), cache per route. Place
  the **estimated bus tokens** (ADR-030) on the line — labelled estimated.
- Self-hosted tiles only if provider limits bite (backlog infra item).

## B2 — Get-off / arrival alarm (native push) 🔔 — ⭐⭐⭐⭐⭐ · L
The biggest table-stakes feature we lack ([05](../research/05-competitive-analysis.md)). The
**in-session** version is a [fast win (P13)](./00-fast-and-fun-wins.md); the full version needs
**native** (Phase 3): background location/geofence + push ("3 stops away"), iOS **Live Activity /
Dynamic Island** + Android ongoing notification counting down. "Bus Times" is the bar to clear.

## B3 — Own crawl → KV/R2 + offline 📦 — ⭐⭐⭐⭐ · L
Replace the runtime dependency on the hkbus gh-pages artifact (their outage = our stale/broken)
with our **own daily crawl** to KV/R2 (KMB bulk endpoints exist in `kmb-static.ts`; CTB via a
GitHub-Action crawl beyond the Worker subrequest cap). Unlocks **offline** (on-device index, ADR-007
→ also powers search P7), **resilience**, and **true zh-Hans** static names. Retires the cron stub.
Pull **fares/frequency/journey-time straight from official TD GTFS + Routes-&-Fares** while we're in
there, so we stop depending on the community file for those too.

## B4 — Multimodal point-to-point planning 🧭 — ⭐⭐⭐⭐⭐ · L
The one area where even operator apps are weak and Google/Citymapper win
([05](../research/05-competitive-analysis.md)). HK has **no open PT routing API** — we'd build it on
GTFS (stops, sequences, frequency, fares). Start **bus-only, single-leg + one-interchange** with
smart sorting (**fastest / cheapest / least-walking**, walk-time-aware), then add MTR/ferry. Big, but
hugely differentiating; fares (fast wins) feed the "cheapest" ranking directly.

## B5 — Engagement surfaces: widgets · watch · Live Activities ⌚ — ⭐⭐⭐⭐ · L
Where the community apps (hkbus.app, LOOHP) beat the operators and most rivals.
- **Home-screen widgets** for favourite stops (iOS WidgetKit / Android App Widgets).
- **Apple Watch / Wear OS** with Tiles/complications (glanceable wrist ETA).
- **Live Activities / Dynamic Island** (overlaps B2).
Needs native (Phase 3) + a stable favourites/data contract — finish route-at-stop favourites first.

## B6 — Realtime push layer (Durable Objects + WebSockets) ⚡ — ⭐⭐⭐⭐ · L
Phase 2 architecture behind `DataSource.watch()` (today a polling shim): push ETA updates to watched
stops/favourites, wire freshness to live pushes, handle upstream-outage gracefully. Makes the app
feel alive and cuts redundant polling.

## B7 — Crowd-sourced crowding 👥 — ⭐⭐⭐ · M–L
Occupancy **isn't in open data** ([02 §11](../research/02-data-availability-matrix.md)), so the only
honest path is **community reports**: 1-tap "how full is it?" on a boarding card, aggregated per
route/time-band. Light backend (D1/KV), abuse-resistant, clearly "rider-reported". A genuine
differentiator since even most operator apps lack open occupancy.

## B8 — Confidence from our own history 📈 — ⭐⭐⭐ · M (after logging)
Log ETA readings vs actual disappearance over time → "usually on time here" / "ETAs here tend to
jump". Also powers **"ghost bus" flagging** (a bus that vanishes without arriving — data-quality and
oddly satisfying). Privacy-respecting, aggregate.

## Dependency notes
- **B3 (own crawl/offline)** unblocks search P7, true zh-Hans, and first-party fares/geometry inputs — a high-leverage enabler; do it early among the bets.
- **B1 (map)** needs derived polylines (B3's crawl is a natural place to precompute & cache them).
- **B2/B5 (alarms/widgets/watch)** need the **native build** (Phase 3) and the finished **route-at-stop favourites** (ADR-032).
- **B4 (planner)** and **B7 (crowding)** are independent and could be parallel tracks once the fast wins land.
