# 02 — Data Availability Matrix & Category Deep-Dives

> The honest answer to *"what data can we actually get, for which operators, and from where?"*
> Verified 2026-06-09 (live API hits + spec PDFs + actual file downloads). Provider endpoints
> and field tables are in [`01`](./01-open-data-catalog.md). This doc is organised by **data
> category** (the user's "fares, accessibility, seating, electric, GPS, maps, bus type, etc.").

## Legend
- ✅ **Official inline** — in the operator's own real-time/route API.
- 🟦 **Official (TD static)** — in a Transport Department dataset (GTFS / Routes-&-Fares), joinable by route.
- ⚠️ **Partial** — exists but limited, derived, or coarse.
- 🟡 **Community only** — enthusiast wikis / crawlers; copyleft + scraping; not authoritative/live.
- ❌ **None** — not available as data anywhere.

## Master matrix

| Category | KMB·LWB | Citybus (CTB) | NLB | GMB | MTR Bus | Best source |
|---|:--:|:--:|:--:|:--:|:--:|---|
| **Real-time ETA (times)** | ✅ | ✅ | ✅ | ✅ (mixed live/sched) | ✅ (mostly sched) | operator APIs |
| **Live vehicle GPS (lat/lng)** | ❌ | ❌ | ❌ | ❌ | ❌ (`busLocation`=`0,0`) | — *none in HK* |
| **Stop coordinates** | ✅ | ✅ | ✅ | ✅ | 🟦 | operator APIs / GTFS (WGS84) |
| **Ordered stop sequence** | ✅ | ✅ | ⚠️ (array order) | ✅ | ✅ | operator APIs |
| **Route line geometry (polyline)** | 🟦 91% | 🟦 86% | 🟦 83% | 🟦 100% | ❌ | **CSDI** Bus Route + GMB Route (§4) |
| **Section/stage fares (adult)** | 🟦 | 🟦 | ✅ inline | 🟦 | 🟦 | GTFS `fare_*` / Routes-&-Fares / NLB inline |
| **Holiday fare variant** | 🟦 | 🟦 | ✅ inline | 🟦 | ⚠️ | as above (+ consolidated `faresHoliday`) |
| **Concessions ($2, BBI, passes, Octopus)** | ❌ | ❌ | ❌ | ❌ | ❌ | policy/prose only |
| **Service hours (first/last)** | ⚠️ 🟦 | ⚠️ 🟦 | ⚠️ (`overnight`) | ✅ (Route API) | ⚠️ | GMB inline / GTFS `calendar`+`frequencies` |
| **Headway / frequency** | 🟦 | 🟦 | ❌ | ✅ (Route API) | ❌ | GMB inline / GTFS `frequencies` / consolidated `freq` |
| **Journey time (whole route)** | 🟦 | 🟦 | ❌ | ⚠️ | ❌ | Routes-&-Fares `JOURNEY_TIME` / consolidated `jt` |
| **Remarks / special departures** | ✅ | ✅ | ✅ | ✅ | ⚠️ | operator APIs (`rmk_*`) |
| **Service disruptions / diversions** | 🟦 | 🟦 | 🟦 | 🟦 | 🟦 | TD Special Traffic News |
| **Wheelchair / accessibility** | ❌ | ❌ | ✅ inline (`wheelChair`) | ❌ | ❌ | NLB only; else operator web (scrape) |
| **Seating / capacity / deck / amenities** | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | fan wikis (per-model, CC-BY-SA) |
| **Electric / hydrogen / emission class** | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | press / LegCo / enthusiast (fluid) |
| **Bus model → route mapping** | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | fan wikis ("usually", not live) |
| **Crowdedness / occupancy** | ❌ | ❌ | ❌ | ❌ | ❌ | KMB App1933 in-app trial only (closed) |
| **Bilingual/trilingual names** | ✅ | ✅ | ✅ | ✅ (3) | ⚠️ (2) | operator APIs |

> **The shape of it:** Real-time = **times only, no positions, for everyone.** **Fares, stops, sequences,
> frequency, journey time, names** are solid (official). **Route lines** are derivable but not published.
> **Accessibility, seating, electric, model, occupancy** are essentially **not data** — community scrape or
> nothing. Build confidently on the first group; treat the last group as "best-effort, clearly labelled".

---

## Category deep-dives

### 1. Real-time ETA — the only real-time primitive ✅ (all operators)
Every operator publishes **predicted arrival times** at stops (up to 3 per line), refreshed ~1 min (MTR Bus ~10 s). Caveats that matter for honesty (ADR-008): **GMB & MTR Bus mix live and schedule-based** entries (`remarks:"Scheduled"`, `isScheduled:"1"`) — surface the distinction; **KMB/CTB `rmk_*`** flags "Scheduled Bus"/"Last Bus". We already normalize KMB+CTB; NLB/GMB/MTR are adapters away.

### 2. Live vehicle GPS — **does not exist in HK** ❌
There is **no GTFS-Realtime feed** and **no published per-vehicle position** for any operator. MTR Bus's spec has a `busLocation` field but it returns `0,0` in practice (verified live on K12/506). Operators have GPS internally; it is not exposed. **Implication:** never promise a live moving-bus dot. Our "bus tokens" (ADR-030) correctly **approximate** position from successive-stop ETAs — that is the only honest path, and it should always read as estimated.

### 3. Fares — a genuinely strong area 🟦 / ✅
- **Section (stage) fares, adult**, are official: GTFS `fare_attributes.txt`+`fare_rules.txt` (~880k OD pairs; `fare_id` = route+bound+boardSeq+alightSeq), mirrored in Routes-&-Fares (`FARE_*`, `FULL_FARE`, `JOURNEY_TIME`) and the GeoJSON (`fullFare`). **NLB carries `fare`+`fareHoliday` inline per stop.**
- **The consolidated dataset we already fetch** carries `fares`/`faresHoliday` arrays per route ([03 §11](./03-app-feature-inventory.md)).
- **Not data:** Octopus-vs-cash, the **$2 concession** (note: from **3 Apr 2026** it's "$2 flat *or* 80% off" for elderly/PwD), monthly/day passes, **bus-bus interchange (BBI)** discounts, PTFSS, Fare Saver machine locations — all **prose** on TD/operator pages. Only **full adult fares** exist as data (no child/elderly/student fare field anywhere).

### 4. Route geometry "on a map" — lines DO exist, on CSDI 🟦

> **Corrected 2026-08-22.** This section used to say *"Official 'geometry' is stop points only … a road-following
> route line must be derived."* That was wrong. It was measured on the right department's **wrong file**: the
> `data.gov.hk` routes-and-fares GeoJSON really is 56,048 `Point` features with zero `LineString` — but the route
> **lines** are published as two *separate* datasets on the **CSDI portal**, which that survey never opened.
> Full write-up, resolver algorithm and per-route coverage: [`07`](./07-route-geometry-and-maps.md);
> [ADR-151](../08-decision-log.md#adr-151--the-route-line-geometry-we-said-hong-kong-did-not-publish-has-existed-since-2021).

- **The lines are official, free and road-following.** Transport Department, on CSDI:

  | Dataset | CSDI id | Features | Geometry | Published |
  |---|---|---|---|---|
  | **Bus Route** (KMB · LWB · CTB · NLB) | `td_rcd_1638844988873_41214` | 2,255 | `MultiLineString` | Dec 2021 |
  | **Green Minibus Route** | `td_rcd_1697082463580_57453` | 1,161 | `LineString` | Oct 2023 |

  These are true road alignments, not stops joined up: KMB route 1 outbound is **391 vertices**, a 30 km GMB circular
  is **1,405**. Median GMB route: 365. Same [DATA.GOV.HK terms](https://data.gov.hk/en/terms-and-conditions) as
  everything else — commercial use, redistribution and caching permitted, attribution required.
- **It joins to a key we already carry.** CSDI `ROUTE_ID` **is** the consolidated dataset's `gtfsId` — verified on
  `ROUTE_ID 2000410` → GMB 69 Cyberport↔Quarry Bay circular, start/end stop names matching exactly. `gtfsId` is
  already the GMB canonical-id component (ADR-047); it is **dropped for KMB/CTB/NLB** today, and retaining it is the
  one prerequisite.
- **Coverage, against our own route list:** GMB **100%**, KMB **91%**, CTB **86%**, NLB **83%** — **93%** of the 3,625
  bus + minibus route-directions. A fallback that matches on operator + route number instead of `gtfsId` lifts it to
  **96%**, at the cost of ambiguity that needs resolving (§4a).
- **Three ways to fetch it**, all verified: per-route via the ArcGIS **FeatureServer**
  (`…/FeatureServer/0/query?where=ROUTE_ID=1001&outSR=4326&f=geojson`, 33 KB for both directions — no bulk download);
  **bulk** GeoJSON from `static.csdi.gov.hk` (the bus file is **1.53 GB** unzipped, 240 MB zipped — the FGDB is 38 MB
  but needs GDAL); or piggybacking **hkbus's** daily-synced, 5dp-truncated mirror at
  `hkbus.github.io/route-waypoints/{gtfsId}-{O|I}.json`.
- **Payload is small once truncated.** 5 decimal places (±1 m) + gzip: KMB route 1 **both** directions = **4 KB**. All
  1,161 GMB route-directions together = **2.8 MB**.
- **What is still genuinely absent:** MTR feeder buses, Light Rail and ferries are **0%** — hkbus hand-maintains static
  files for those in its own repo. And there is still no `shapes.txt` in the TD GTFS.
- Stop-point coverage remains as before (KMB 26k, CTB 17.5k, joint 4.9k, LWB 3.6k, NLB 2.6k, MTR-feeder 0.8k points).

### 4a. Two traps in the route-line data

Both are real, both are cheap to handle, and both were found by measurement rather than by reading the schema.

1. **`ROUTE_SEQ` (1/2) does not reliably mean outbound/inbound.** hkbus hit this too (their issue #14) and it silently
   swaps some routes' directions. Resolve it geometrically instead: score each candidate line against the *rider's own
   ordered stops*. Measured on KMB 101, mean stop-to-line distance is **8.6 m** for the correct direction and **41.9 m**
   for the reverse — a 5× separation, so this is not a marginal test.
2. **A route number can match several lines, and a short-working scores the same as its parent.** NLB 1 matches five
   CSDI `ROUTE_ID`s; CTB 11 matches five. Endpoint matching separates most of them (CTB 11 circular vs the Loong Fung
   Terrace short-working differ by 4 m at the differing end), but *mean stop-to-line distance cannot tell a
   short-working from the full route it runs along* — both score 8.6 m, because the short-working's stops all lie on
   the parent's line. The fix is not a better score: **pick by coverage, then trim the line to the rider's own first and
   last stop.** That also handles circulars and makes variant selection stop mattering.

### 5. Service hours / frequency / journey time 🟦 / ✅
- **GMB Route API** gives these inline (`start_time`/`end_time`/`frequency` + weekday/PH flags) — best-in-class.
- For franchised buses: **GTFS `frequencies.txt`** (headway per band) + `calendar`/`calendar_dates` (service days); **Routes-&-Fares `JOURNEY_TIME`**; **consolidated `freq`/`jt`** (already in hand). NLB exposes only an `overnightRoute` flag.
- These power "every 8–12 min", "≈45 min end-to-end", "first/last bus", and **"service has ended"** states.

### 6. Remarks & disruptions ✅ / 🟦
- `rmk_*` (KMB/CTB/GMB/NLB) carry "Scheduled", "Last Bus", "KMB Cycle", Sunday-only, diversion notes — **we capture these but don't show them** ([03 §11](./03-app-feature-inventory.md)).
- **Route-level disruptions/diversions** come from TD **Special Traffic News** (live text feed) — a separate, joinable source for a "⚠ diversion" banner.

### 7. Accessibility / wheelchair ❌ (mostly)
- **No machine-readable per-route/per-vehicle flag** for franchised buses. GTFS deliberately omits `wheelchair_boarding`/`wheelchair_accessible`. The only official accessibility data is **MTR's rail-station** barrier-free dataset (lifts/toilets/wide gates) — not buses.
- **NLB is the exception:** its ETA carries a per-departure **`wheelChair`** flag.
- **Reality:** ~90%+ of the franchised fleet is low-floor wheelchair-accessible; a few hospital routes are specially designated. This lives as **per-route icons on operator websites** (scrape-only) — fine for a static, clearly-dated annotation, not a live feed.

### 8. Seating / capacity / deck / amenities 🟡
- **Zero official data** (no deck-type, seat count, USB, Wi-Fi). `route_type` only distinguishes mode, not deck.
- **Community:** the fandom fleet wikis (**香港巴士大典** / **Hong Kong Buses Wiki**) document per-**model** specs (chassis/body/deck/seats/standees/amenities). **Caveats:** per-model not per-route; **no API/bulk export** (HTML scrape); **CC-BY-SA** text (viral copyleft) + per-file image licences.

### 9. Electric / hydrogen / low-carbon 🟡
- **Not a dataset.** Only government prose (LegCo: ~65 e-buses end-Aug-2023, target ~700 by 2027) and press (KMB BYD fleet; Citybus hydrogen double-decker). 
- **Which routes run electric/hydrogen is press/enthusiast-tracked and fluid** — *illustrative only, not authoritative*: KMB BYD reportedly on 2, 5D, 6, 6D, 11, 24, 49M, 62X, 85K, 213M, 234X, 238X; Citybus hydrogen on 20/20A/22M (Kai Tak). Use only as a hand-curated, clearly-dated "🌱 often electric" tag if at all.

### 10. Bus model → route 🟡
- **No official roster or vehicle-to-route assignment**; APIs return no vehicle/model id. Community fleet wikis give model rosters and "usually operates on…" notes, but **daily allocations rotate** and there's no live truth. Scrape-only, copyleft.

### 11. Crowdedness / occupancy ❌
- **No open data, live or historical.** GTFS has no `occupancy_status`; no ETA field. **KMB App1933** shows live occupancy / remaining upper-deck seats via a **SmarTone × KMB** deployment (announced 6 Sep 2023 — IoT door + upper-deck sensors → 5G → cloud ML, on **2,300+ buses**), but it's served from KMB's **private app backend, not the open API**. (Same shape as the per-trip electric "green leaf" — an App1933-only signal; both are explicitly **ruled out for scraping** in [ADR-040](../08-decision-log.md).) A crowd-sourced "how full is it?" is the only realistic path for us — [06](./06-feature-improvement-ideas.md).

---

## Sources & formats summary
- **Operator real-time APIs** (JSON, keyless): `data.etabus.gov.hk` (KMB/LWB), `rt.data.gov.hk/v2/transport/citybus`, `rt.data.gov.hk/v2/transport/nlb`, `data.etagmb.gov.hk`, `rt.data.gov.hk/v1/transport/mtr/bus` (+ batch `…/v1/transport/batch` for CTB/NLB).
- **TD static** (data.gov.hk): **GTFS** zip (fares+frequency+calendar, biweekly), **Routes-&-Fares** MDB/CSV/**GeoJSON**/KML/XML (biweekly), **Special Traffic News**, **Journey Time Indicators / TDAS**, **Road Network 2nd-gen**, Highways **Footbridge / Covered Walkway**.
- **Community** (copyleft, attribution): `hkbus/hk-bus-crawling` `routeFareList.min.json` (merged routes+stops+fares; **stops-only, no geometry**); fandom fleet wikis (CC-BY-SA, scrape).
- **Coordinates:** APIs/GTFS/GeoJSON are **WGS84**; Routes-&-Fares master `STOP_*` is **HK1980 Grid** (convert).
- **Licence:** [DATA.GOV.HK Terms](https://data.gov.hk/en/terms-and-conditions) — free reuse, **attribution required**, AS-IS. Community data is GPL/CC-BY-SA — verify before vendoring.

## What this means for the app (design constraints)
1. **Lean on the solid tier:** ETA, stops, sequence, **fares**, **frequency**, **journey time**, names, remarks, disruptions. Most are already downloaded.
2. **Approximate, label, and move on** for: route lines (derive), bus position (interpolate — ADR-030), accessibility/electric (static, dated, "ℹ️ info" tone).
3. **Don't build on absent data:** no live GPS dot, no live occupancy, no per-trip model. Where riders want these, **crowd-source** or **omit honestly**.
