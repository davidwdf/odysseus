# 01 — HK Bus Open-Data Catalog (by provider)

> Researched & largely **verified against live APIs and official spec PDFs on 2026-06-09**.
> Exhaustive per-operator catalog of Hong Kong bus open data: endpoints, formats, fields,
> freshness, licence. The **cross-provider availability matrix** and per-category deep-dives
> (fares, accessibility, electric, GPS, geometry…) live in [`02`](./02-data-availability-matrix.md).

## 0. The big picture (read this first)

HK bus open data comes in **two families**, both **keyless, JSON/CSV, free**, under the one
[DATA.GOV.HK Terms of Use](https://data.gov.hk/en/terms-and-conditions) (free commercial + non-commercial reuse, **attribution required**, data "AS IS"):

1. **Per-operator real-time ETA APIs** — each operator publishes its own (different host, version, ID scheme). These give **names, stop coordinates, stop sequence, and live ETAs** — and little else.
2. **Transport Department (TD) cross-operator static datasets** on `data.gov.hk` — **GTFS (headway+fares)**, **Routes & Fares** (MDB/CSV/GeoJSON/KML/XML), road network, traffic. These fill the gaps: **fares, frequency, journey time, service days**.

### Five facts that shape everything we can build
- **No GTFS-Realtime exists for Hong Kong.** No TripUpdates / VehiclePositions / ServiceAlerts from TD or any operator. Real-time = the proprietary JSON ETA APIs only. *(verified)*
- **No live bus GPS position is published** (one narrow exception: MTR Bus `busLocation`, usually `{0,0}`). We can show predicted **times**, not true moving-bus coordinates. To animate buses we must **approximate** from successive-stop ETAs (ADR-030 already does this).
- **No official route line geometry/polylines anywhere.** GTFS has **no `shapes.txt`**; the TD GeoJSON is **Point-only**. Route maps must be **drawn from ordered stop coordinates** (or snapped to the road network). *(verified by download)*
- **Fares ARE available** — GTFS `fare_attributes`/`fare_rules` (~880k OD pairs), the Route-Fare `FARE_*` section-fare tables, and inline in NLB + the hkbus consolidated set. **Adult full fare only** — no child/elderly/concession fares in any open dataset.
- **No accessibility, seating, capacity, bus-model, or electric/emission data** in TD open data. Tiny exceptions: NLB's per-departure `wheelChair` flag; MTR's rail-focused "barrier-free facilities". The rest is **community/operator-website only** (see [02](./02-data-availability-matrix.md)).

### Master endpoint map
| Operator | Real-time ETA API base | Spec | Coverage |
|---|---|---|---|
| **KMB / LWB** | `https://data.etabus.gov.hk/v1/transport/kmb/` | [spec](https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf) · [dict](https://data.etabus.gov.hk/datagovhk/kmb_eta_data_dictionary.pdf) | KMB + Long Win (one `co:"KMB"`) |
| **Citybus (CTB)** | `https://rt.data.gov.hk/v2/transport/citybus/` | [spec](https://www.citybus.com.hk/datagovhk/bus_eta_api_specifications.pdf) · [dict](https://www.citybus.com.hk/datagovhk/bus_eta_data_dictionary.pdf) | CTB incl. ex-NWFB (merged 2023) |
| **New Lantao Bus (NLB)** | `https://rt.data.gov.hk/v2/transport/nlb/` (`.php?action=`) | [spec](https://www.nlb.com.hk/datagovhk/BusServiceOpenAPIDocumentation2.0.pdf) | Lantau |
| **CTB + NLB batch** (all ETAs at a stop) | `https://rt.data.gov.hk/v1/transport/batch/` | [spec](https://static.data.gov.hk/ogcio/datagovhk/opendata/eta/bus-route-list-and-eta-specific-stop-api-specifications.pdf) | CTB, NLB |
| **Green Minibus (GMB)** | `https://data.etagmb.gov.hk/` | [spec](https://data.etagmb.gov.hk/static/GMB_ETA_API_Specification.pdf) | all GMB (since Oct 2022) |
| **MTR Bus / Feeder** | `https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule` (**POST**) | [spec](https://opendata.mtr.com.hk/doc/MTR_BUS_API_Spec_v1.13.pdf) | NW NT feeder only |
| **TD GTFS (all modes)** | `https://static.data.gov.hk/td/pt-headway-{en,tc,sc}/gtfs.zip` | [spec](https://static.data.gov.hk/td/pt-headway-en/dataspec/ptheadway_dataspec.pdf) | 14 agencies |

---

## 1. KMB / LWB — `data.etabus.gov.hk` (our v1 operator)

One API for both operators; `co` is **always `"KMB"`** (LWB is invisible — infer from airport/Lantau `A/E/NA/X` route patterns). All GET, JSON, CORS-open, keyless. Every payload wraps `{ type, version, generated_timestamp, data }`.

| Dataset | Path | Type |
|---|---|---|
| Route List | `/route/` | static (05:00 daily) |
| Route | `/route/{route}/{direction}/{service_type}` | static — `direction` = word `outbound`/`inbound` |
| Stop List | `/stop` | static |
| Stop | `/stop/{stop_id}` | static |
| Route-Stop List | `/route-stop` | static |
| Route-Stop | `/route-stop/{route}/{direction}/{service_type}` | static |
| **ETA** | `/eta/{stop_id}/{route}/{service_type}` | **live ~60 s** |
| **Stop ETA** | `/stop-eta/{stop_id}` | **live** (all routes at a stop) |
| **Route ETA** | `/route-eta/{route}/{service_type}` | **live** (all stops on a route — we use this for the schematic) |

**Key fields** — Stop: `stop` (16-char id), `name_en/tc/sc`, `lat`, `long` (WGS84). Route-Stop: `+ seq`. ETA: `co, route, dir(O/I), service_type, seq, dest_*, eta_seq, eta (ISO8601|null), rmk_*, data_timestamp`. Up to 3 `eta_seq` per direction.

**Gotchas** (several verified live): `bound`(static) vs `dir`(ETA); `service_type` is String in static, **int in ETA**; **ETA for service_type=1 can include other service types sharing the stop — filter on the response field**; "no data" = HTTP 200 with empty `{}`/`[]` (422 only for malformed); CDN `Cache-Control: max-age=300` so responses can be ~5 min stale → trust `data_timestamp`; the **same physical kerb has different stop ids per route/direction**. No rate limit published (be a good citizen).

**Has:** trilingual names, stop coords, live ETA, remarks. **Lacks:** fares, geometry, frequency, service hours, GPS, accessibility, bus type. (Get the rest from TD datasets §6.)

---

## 2. Citybus (CTB) — `rt.data.gov.hk/v2/transport/citybus`

**NWFB merged into Citybus on 1 Jul 2023** — only `co:"CTB"` exists now; ex-NWFB routes were renumbered into the 7xx series; the old `citybus-nwfb` path and `co:"NWFB"` are **dead** (V1.x discontinued 31 Dec 2023). **Use V2.**

| Dataset | Path |
|---|---|
| Company | `/company/{co}` |
| Route (omit `route` for full list) | `/route/{co}/{route}` |
| Stop | `/stop/{stop_id}` (6-digit zero-padded) |
| Route-Stop | `/route-stop/{co}/{route}/{direction}` (`inbound`/`outbound`) |
| **ETA** | `/eta/{co}/{stop_id}/{route}` |

**Key fields** — Route: `co, route, orig_*, dest_*` (no direction). Stop: `stop, name_*, lat, long` (WGS84, Numeric). Route-Stop: `co, route, dir(I/O), seq, stop`. ETA: `co, route, dir, seq, stop, dest_*, eta_seq, eta(ISO8601, may be ""), rmk_*, data_timestamp` — up to 3.

**Gotchas:** request uses `inbound/outbound`, response returns `dir:I/O`; **circular routes have no flag** — the mid-route turning-point stop splits outbound/inbound; **ETA needs co+stop+route together** (no "all ETAs at a stop" from the operator API → use the batch API §4); joint KMB-operated departures carry `rmk:"KMB Cycle"/"九巴時段"` with empty `eta`; HTTP 429 is the throttle signal. **No bulk route-stop crawl is cheap** (~6,800 calls) — which is exactly why we use the consolidated dataset (ADR-021).

**Has:** trilingual names, stop coords, live ETA, remarks, clean `seq`/`dir`. **Lacks:** fares, geometry, frequency, hours, GPS, accessibility, bus type.

---

## 3. New Lantao Bus (NLB) — `rt.data.gov.hk/v2/transport/nlb` (different shape!)

`.php` endpoints with `action=`, keyed on a numeric **`routeId`** (not route number). **Each direction is a separate `routeId`** ("A > B"); no inbound/outbound, no `seq` field (array order = sequence). Numbers come back as **strings**.

| Action | Path |
|---|---|
| Route list | `route.php?action=list` |
| Stops of a route | `stop.php?action=list&routeId={id}` |
| **ETA** | `stop.php?action=estimatedArrivals&routeId={id}&stopId={id}&language={en\|zh\|cn}` |

**NLB is uniquely rich inline:** the **Stops** response carries **`fare` (Mon–Sat) + `fareHoliday`** per stop; the **ETA** response carries **`wheelChair` (1=accessible)**, **`noGPS` (1 = bus HAS GPS** — inverted!), `departed`, `routeVariantName`, `generateTime`. ETA time format is `"YYYY-MM-DD HH:MM:SS"` **with no timezone** (Citybus is full ISO-8601). `estimatedArrivals` is **absent** when none available.

**Has (operator API):** trilingual names + stop location text, stop coords, live ETA, **fares**, **wheelchair flag**, GPS-presence flag, overnight/special flags. **Lacks:** geometry, headway, vehicle position.

---

## 4. CTB + NLB Batch API — `rt.data.gov.hk/v1/transport/batch`

A TD/DPO normalization over **CTB and NLB** (valid ids `CTB`, `NLB`; `NWFB` removed). Use it when you want **all routes / all ETAs at one stop** in one call (the CTB operator API can't).
- Stop-Route: `/v1.1/transport/batch/stop-route/{co}/{stop_id}`
- **Stop-ETA:** `/v1/transport/batch/stop-eta/{co}/{stop_id}` (optional `?lang=en|zh-hant|zh-hans`)

Union schema: common `co, route, dir, seq, stop, dest, eta_seq, eta, rmk, data_timestamp` + **NLB-only** `routeId, routeName, overnightRoute, specialRoute, routeVariantName, departed, noGPS, wheelChair` (null for CTB). Stop-ID namespaces are **not** interchangeable with the operator APIs. Extra code 502 = bad upstream.

---

## 5. Green Minibus (GMB) — `data.etagmb.gov.hk`

All GET, JSON, trilingual. Spec v1.1. **Region** = `HKI`/`KLN`/`NT`; `route_code` is **unique only within a region**; `route_id` (int) is globally unique and **one code → many route_id variations**; `route_seq` 1/2 (circular = 1 only).

| Dataset | Path |
|---|---|
| Route list | `/route/{region}` (region optional) |
| Route (hours/headway/orig-dest) | `/route/{region}/{route_code}` or `/route/{route_id}` |
| Stop | `/stop/{stop_id}` (WGS84 + HK80 coords) |
| Route-Stop | `/route-stop/{route_id}/{route_seq}` |
| Stop-Route | `/stop-route/{stop_id}` |
| **ETA (route-stop)** | `/eta/route-stop/{route_id}/{route_seq}/{stop_seq}` or `/{route_id}/{stop_id}` |
| **Stop ETA** | `/eta/stop/{stop_id}` (best for a stop board) |
| Last-Update | `/last-update/...` (freshness check) |

**Uniquely, the GMB Route API gives service hours + headway**: `Headway.start_time/end_time/frequency/frequency_upper` with `weekdays[]` (Mon-first) + `public_holiday`. **ETA mixes live + scheduled** — `remarks:"Scheduled"/"未開出"` = timetable, not live; whole route-stops can be `enabled:false`. **Two-step lookup required** (resolve code→route_id before ETA). Geometry only via the CSDI "Green Minibus Route" layer; fares only via the TD Routes-and-Fares dataset.

---

## 6. MTR Bus / Feeder — `rt.data.gov.hk/v1/transport/mtr/bus/getSchedule`

**POST** (not GET), body `{language:"en"|"zh", routeName:"K12"}`. **No list/nearby endpoint** — hold the route list yourself; small **NW New Territories feeder** coverage (~30 K-routes + 506). One call returns the whole route. Refresh ~10 s; HTTP 429 enforced.

Response: top-level `appRefreshTimeInSecond, busStop[], routeName, status("1"=ok), footerRemarks`; per `busStop`: `busStopId, isSuspended, bus[]`; per `bus`: `busId` (track a vehicle), `arrivalTimeInSecond` (`"108000"`=no data), `arrivalTimeText`, `departureTimeInSecond/Text`, **`isScheduled`("1"=timetable, not live)**, **`busLocation.latitude/longitude`** (the only live-GPS field in HK open data — but often `{0,0}`), `lineRef`. Many fields marked **Deprecated**. Static routes/stops/**fares** in separate CSVs (`mtr_bus_routes.csv`, `mtr_bus_stops.csv`, `mtr_bus_fares.csv`, monthly). The spec PDFs themselves are MTR-confidential — don't redistribute the PDFs (the data is open).

---

## 7. Other operators (in TD GTFS / Route-Fare, mostly no live ETA)
From the verified 14-agency GTFS `agency.txt`: **Discovery Bay Bus (DB, 12 routes)**, **Ma Wan / Park Island (PI, 9)**, **Lok Ma Chau cross-boundary coach (XB, 16)**, joint **KMB+CTB (126)** & **LWB+CTB (3)**. Also non-bus: **GMB (777)**, **Ferry (60)**, **HK Tramways (7)**, **Peak Tram (1)**. **No NWFB** (merged), **no MTR heavy rail / Light Rail trains** (only MTR's road feeder, `agency_id=LRTFeeder`). Cross-boundary coaches & non-franchised/residents' (NR) services have **no real-time ETA feed**.

---

## 8. TD cross-operator STATIC datasets (the gap-fillers)

### 8a. GTFS — "Headway information of public transport services" *(biweekly)*
[dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_11-pt-headway-en) · zip per language. **Verified contents** (10 files; **no `shapes.txt`, no `transfers.txt`, no `trip_headsign`, no `wheelchair_*`**):
`agency` (14) · `stops` (9,416; WGS84; `stop_name` packs operators with `|`/`/`; **no wheelchair col**) · `routes` (2,453; `route_type` 3=Bus+GMB, 4=Ferry, 0=Tram, 7=Peak Tram) · `trips` (82,950; no `shape_id`) · `stop_times` (1.37M; ignore absolute times for frequency trips) · `calendar`/`calendar_dates` (service days) · **`frequencies`** (76,733; `headway_secs` per band) · **`fare_attributes`** (880,159; `price`, `currency`, `payment_method`) + **`fare_rules`** (880,132; OD via zone ids) → **full adult section-fare matrix**.

### 8b. Routes & Fares of Public Transport *(twice a month)*
The cross-operator master tables, multiple encodings:
- **MDB + CSV (delta with `CHANGE`)** — [dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_3-routes-and-fares-of-public-transport) · [spec](https://static.data.gov.hk/td/routes-and-fares/dataspec/ptroutefare_dataspec.pdf). Tables: `ROUTE_*` (incl. **`JOURNEY_TIME`**, `FULL_FARE`, `SERVICE_MODE`, `SPECIAL_TYPE`, district, orig/dest), `RSTOP_*` (route-stop sequence), `STOP_*` (**coords in HK1980 Grid X/Y, not lat/long**), **`FARE_*`** (per-OD **section fares** with `DAY_CODE` bitmask), `COMPANY_CODE`.
- **GeoJSON/JSON** — [dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_23-routes-fares-geojson). `JSON_BUS/GMB/FERRY/PTRAM/TRAM.json`. **Verified: geometry is `Point`-only (no route lines)**; WGS84 `[lon,lat]`; per-stop props incl. `journeyTime`, `fullFare`, `stopPickDrop`, trilingual names. The **WGS84 twin** of the master tables — best for plotting **stops** on a map.
- Also **KML** ([dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_24-routes-fares-kml)) and **XML** ([dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_14-routes-fares-xml)).
- **CSDI portal** mirrors these as WFS/REST APIs (GeoJSON/GML/SHP/CSV): "Bus Route", "Bus Stop Location", "GMB Route/Terminus", tram/ferry/peak-tram coordinates.

### 8c. Traffic / disruption / road (for ETA confidence & alerts)
- **Special Traffic News** — live incident/diversion text feed ([2nd-gen dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_19-special-traffic-news-v2)). The source for "route diverted" surfacing.
- **Journey Time Indicators (2nd gen)** — major-road & tunnel journey times, every 2 min ([dataset](https://data.gov.hk/en-data/dataset/hk-td-sm_8-journey-time-indicators-v2)).
- **TDAS Traffic Data** — avg speed + journey time per driving segment, every 5 min ([dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_28-traffic-data-tdas)).
- **Road Network (2nd gen / IRN)** — road centrelines/directions ([dataset](https://data.gov.hk/en-data/dataset/hk-td-tis_15-road-network-v2)); could snap stop sequences to real roads for route polylines.
- **Footbridge** & **Cover to Walkway** (Highways Dept, CSDI) — pedestrian-access proxies near stops (e.g. "covered walk").

### 8d. HKeMobility (official journey planner)
Site/app at [hkemobility.gov.hk](https://www.hkemobility.gov.hk/). Its **public-transport pathfinding is NOT an open API**; only the **driving** routing is exposed (TDAS/IRN-based, `POST tdas-api.hkemobility.gov.hk/tdas/api/route`). Multimodal PT planning would be **ours to build** from GTFS.

---

## 9. The community consolidated dataset (what we use today)
[`hkbus/hk-bus-crawling`](https://github.com/hkbus/hk-bus-crawling) → `routeFareList.min.json` (gh-pages, daily, ~8 MB) merges KMB/CTB/NLB/GMB/MTR/LR/ferry route+stop+fare into one file with GTFS matching done. Its `RouteListEntry` (per [`hk-bus-eta`](https://github.com/hkbus/hk-bus-eta)) carries **`fares`, `faresHoliday`, `freq`, `jt`, `gtfsId`, `nlbId`** alongside `co/route/serviceType/bound/orig/dest/stops`. **We already fetch this and currently parse only a subset** — see [`03 §11`](./03-app-feature-inventory.md). GPL-3.0 code / attribution-bound data → consume the JSON with credit; don't vendor their code.

---

## 10. Licence & attribution (all of the above)
[DATA.GOV.HK Terms](https://data.gov.hk/en/terms-and-conditions): free reuse (commercial + non-commercial), redistribution & derived products allowed, **AS IS**, **attribution required** — credit **Transport Department / KMB / LWB / Citybus / NLB / MTR / DATA.GOV.HK**. Operator-originated feeds (Citybus, MTR Bus) note operator IP ownership. We owe a visible "Data: …" credit before launch (currently missing — [04 F3](./04-feature-gaps.md)).
