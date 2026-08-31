# Research — HK bus open data, our app, the competition

> Commissioned 2026-06-09. A deep dive into **all** public Hong Kong bus open data, an honest
> inventory of where NextBus HK stands, the competitive landscape, and ideas to make this the
> best bus app in HK. Findings are mostly **verified against live APIs / official spec PDFs**.
> Acting on these → see [`../proposals/`](../proposals/README.md).

| # | Doc | What's in it |
|---|-----|--------------|
| 01 | [Open-Data Catalog](./01-open-data-catalog.md) | Every HK bus data source by provider — endpoints, formats, fields, freshness, licence. KMB/LWB · Citybus · NLB · GMB · MTR Bus · TD GTFS & Routes-and-Fares · traffic feeds. |
| 02 | [Data Availability Matrix](./02-data-availability-matrix.md) | Provider × data-category grid + per-category deep dives (fares, accessibility, electric, GPS, occupancy, geometry, fleet…) incl. honest gaps & community sources. |
| 03 | [App Feature Inventory](./03-app-feature-inventory.md) | What NextBus HK has today — **and the data we already download but discard**. |
| 04 | [Feature Gaps](./04-feature-gaps.md) | The basic/table-stakes features we're still missing. |
| 05 | [Competitive Analysis](./05-competitive-analysis.md) | What the incumbents & community apps do; table-stakes vs delighters; what to borrow. |
| 06 | [Feature & Data-Display Ideas](./06-feature-improvement-ideas.md) | How to integrate & display the new + currently-unused data, incl. progressive-disclosure ("dig deeper") designs. |
| 07 | [Route Geometry & Maps](./07-route-geometry-and-maps.md) | **The CSDI route lines** (2026-08-22) — the source, the join, per-operator coverage, the resolver, what other apps do with the gaps, and the interactive-map provider options. |

## Three headline takeaways
1. **The biggest wins need no new data source.** The dataset we already fetch carries **fares, frequency and journey-time** we currently throw away ([03 §11](./03-app-feature-inventory.md)).
2. **Hong Kong has no live bus GPS — but it *does* publish route polylines** ([07](./07-route-geometry-and-maps.md)).
   This takeaway used to read *"no live bus GPS **and no route polylines**"*; the second half was **wrong**, and it
   was load-bearing — it is why B2 sat 🟥 and why the backlog called a real route line "a data question before it is a
   rendering one". The Transport Department has published road-following route lines on the **CSDI portal** since
   Dec 2021 (buses) and Oct 2023 (green minibuses), covering **93%** of our route-directions and **100%** of GMB.
   The GPS half stands: moving buses must still be *approximated*, and ADR-030 already does the hard part.
   See [ADR-151](../08-decision-log.md#adr-151--the-route-line-geometry-we-said-hong-kong-did-not-publish-has-existed-since-2021).
3. **The visible gaps vs competitors are concrete and cheap-ish:** route/stop **search**, a **map**, **fares**, **get-off alarms**, and surfacing **remarks/freshness** ([04](./04-feature-gaps.md), [05](./05-competitive-analysis.md)).
