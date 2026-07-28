# 02 — Data Sources & Canonical Model

## The good news

Hong Kong publishes **free, keyless, open** real-time arrival APIs for essentially every bus
operator, via the Transport Department and [DATA.GOV.HK](https://data.gov.hk). No registration,
no API key, JSON responses. This is the single most important fact about the project: **we do
not have to scrape anything.**

## The operators & their APIs

| Operator | Realtime ETA API | Status in our plan |
|---|---|---|
| **KMB / LWB** (Kowloon Motor Bus / Long Win) | `https://data.etabus.gov.hk/v1/transport/kmb/…` | **v1** |
| **Citybus (CTB)** — incl. former NWFB routes (merged 2023) | `https://rt.data.gov.hk/v2/transport/citybus/…` | **v1** |
| **New Lantao Bus (NLB)** | `data.gov.hk` dataset | [backlog](./07-backlog.md) |
| **MTR Bus / Feeder Bus** | `data.gov.hk` dataset | [backlog](./07-backlog.md) |
| **Green Minibus (GMB)** | `https://data.etagmb.gov.hk/…` (all routes since Oct 2022) | **v1** (ADR-047) |
| **Light Rail / MTR** | `data.gov.hk` datasets | [backlog](./07-backlog.md) |

### KMB / LWB — `data.etabus.gov.hk` (in our v1 scope)
- Endpoints: **Route**, **Route-Stop**, **Stop**, **ETA** (by stop+route+service type), **Route-ETA** (all stops on a route).
- ETA refreshed **~every 1 minute** upstream. JSON. Names in EN / 繁中 / 简中.
- Spec: `https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf`

### Citybus — `rt.data.gov.hk/v2/transport/citybus` (in our v1 scope)
- Endpoints: route, route-stop list, stop, ETA (e.g. `/v2/transport/citybus/eta/CTB/{stopId}/{route}`).
- **Use V2** — V1.x is being discontinued. JSON, keyless.
- Spec: `https://www.citybus.com.hk/datagovhk/bus_eta_api_specifications.pdf`

### Green Minibus (GMB) — `data.etagmb.gov.hk` (in our v1 scope, ADR-047)
- Endpoints: route list `/route/{region}`, route detail (hours/headway) `/route/{region}/{code}` or `/route/{route_id}`,
  stop `/stop/{id}`, route-stop `/route-stop/{route_id}/{route_seq}`, and the **stop board** `/eta/stop/{stop_id}` — the
  one we use (all routes at a pole in one call, like KMB's `stop-eta`). JSON, keyless, trilingual.
- **Identity quirks:** routes are keyed by a numeric `route_id` (globally unique) + `route_seq` (1/2); the public
  `route_code` is **only unique within a region** (`HKI`/`KLN`/`NT`). We take the `route_id` straight from the
  consolidated dataset's `gtfsId`, fold it into the canonical id (`GMB:{no}:{bound}:{gtfsId}`), and never do the
  two-step code→id resolution live. `route_seq` 1 → outbound, 2 → inbound.
- **Live + scheduled mixed:** the ETA feed marks timetable (not tracked) arrivals with `remarks:"Scheduled"/未開出`; we
  pass the remark through and `classifyRemark` tags it so the UI styles it honestly (ADR-008). Whole route-stops can be
  `enabled:false` (we skip them).
- **Gotcha:** the host **403s an empty `User-Agent`** (the Workers-runtime default). The adapter sends one. See ADR-047.
- Spec: `https://data.etagmb.gov.hk/static/GMB_ETA_API_Specification.pdf`

### Why the hosts & versions differ (KMB `v1` vs Citybus `v2`, and the `rt.` subdomain)
Each operator publishes **independently**, so base host and API version differ per operator. They
are **not comparable** to each other and don't mean "older vs newer tech":

- **KMB/LWB** run their **own dedicated host** `data.etabus.gov.hk`, at **API v1**.
- **Citybus** publishes through the Government's **shared real-time data gateway** `rt.data.gov.hk`
  (the `rt` literally stands for **real-time**), at **API v2** (its v1.x is being retired).
- **`rt.` ≠ "realtime only".** That gateway serves **both static *and* realtime** endpoints for the
  operators on it — Citybus's `route`, `route-stop`, `stop` **and** `eta` all live under
  `…/v2/transport/citybus/`. Some other operators (e.g. NLB) also publish via `rt.data.gov.hk`;
  others (e.g. GMB) have their own host (`data.etagmb.gov.hk`).
- **Yes, KMB has the realtime equivalent.** KMB's live ETAs are
  `…/v1/transport/kmb/eta/{stop}/{route}/{serviceType}` and `…/route-eta/{route}/{serviceType}` on
  `data.etabus.gov.hk` — the same role as Citybus's `/eta/` on `rt.data.gov.hk`. Both operators
  expose static **and** realtime; they just sit on different hosts with different version numbers.
- **Why this matters for us:** every operator adapter in `packages/data-normalize` targets a
  *different* base host + API version + ID scheme. That divergence is exactly why the canonical
  normalization layer exists ([ADR-005](./08-decision-log.md)).

### Static reference data
- **GTFS** + "Routes and Fares of Public Transport" on data.gov.hk give a standardized,
  cross-operator static model (routes, stops, sequences, fares). We use this as the **backbone**
  of our canonical static dataset, then map its IDs to each operator's realtime API IDs.
- Useful open-source prior art: [`hkbus/hk-bus-crawling`](https://github.com/hkbus/hk-bus-crawling)
  already consolidates KMB/CTB route/stop/fare data aligned to the data.gov.hk ETA APIs. Great
  reference for the normalization mapping (licence-permitting; verify before reuse).

> **Current static source ([ADR-021](./08-decision-log.md)).** The static layer for **KMB + CTB** is built
> from the hk-bus-crawling **consolidated dataset** (`routeFareList.min.json`, one ~8 MB daily-updated fetch,
> made **once a day in CI, never per request** — from its canonical host `https://data.hkbus.app/`, since
> the older `hkbus.github.io/hk-bus-crawling/` path now 301-redirects there) — because the **official CTB
> API has no bulk stop/route-stop endpoint** (building a CTB index from it is a ~6,800-call crawl). The
> dataset's stop ids in `routeList.stops` are the raw, directly-ETA-callable operator ids; its `stopMap` over-clusters and is **not** used (it breaks ETA
> resolution). **Live ETAs still come direct from the official KMB/CTB APIs.** Same-kerb KMB↔CTB merge is
> now done with **our own** clustering ([ADR-022](./08-decision-log.md)). The fetch, the normalization and
> that clustering all run in the **daily dataset build** ([ADR-055](./08-decision-log.md)), which writes
> content-addressed shards to KV/R2; the Worker reads a handful of keys per request and keeps the in-isolate
> build only as a dev fallback (`/v1/health` says which it is served from — see
> [`10`](./10-scaffold-and-running.md)). Our own crawl + true Simplified
> static names remain [backlog](./07-backlog.md) items.
>
> **We now also read the dataset's `fares`/`faresHoliday`/`freq`/`jt`** ([ADR-036](./08-decision-log.md)) —
> previously parsed-and-dropped. The edge surfaces a **boarding fare** per stop (sectional: `fares[seq-1]`),
> a route **full fare**, **journey time**, a **frequency** range, and **service hours** on the route/stop/ETA
> responses; the live `rmk_*` ETA remark is now rendered too. This is the **Static** honesty tier (shown
> plainly, never animated as live). HK open data has **no fares-by-passenger-type, no live bus GPS, and no
> route polylines** — see [`research/02`](./research/02-data-availability-matrix.md).

## The two kinds of data (they have opposite needs)

### 1. Static-ish — routes, stops, sequences, fares, names
- Changes ~**daily**. Large but highly cacheable.
- **This is where normalization pays off most.** We crawl all (v1) operators **once a day**,
  merge into one canonical model, and ship a compact snapshot to the CDN + on-device cache.
- Enables **offline** browse/search and **instant** "nearby" (computed on-device).

### 2. Real-time ETAs
- Change ~**every minute**, **pull-only** (no upstream push feed), per stop/route.
- Delivered via the [phased hybrid data layer](./03-architecture.md): edge-cached proxy in v1,
  Durable-Object-backed WebSocket push in v2.
- **Hard ceiling:** we can never be fresher than the source's ~1-min refresh. "Instant" means
  we render cached data immediately and push a correction the moment upstream changes.

## Canonical data model

The operators use **different, incompatible IDs** — KMB and Citybus each have their own stop IDs
even for the same physical kerb. We normalize into one model:

```
Operator      { id: "KMB" | "LWB" | "CTB", name_i18n }
Route         { id, operator, routeNo, bound: "I"|"O", serviceType,
                origin_i18n, dest_i18n, stopSeq: StopRef[] }
Stop          { id (canonical), name_i18n, lat, lng,
                sources: { operator, operatorStopId }[] }   // ← the merge mapping
RouteStop     { routeId, seq, stopId }
Eta           { routeId, stopId, source, etaTimes: ISO8601[], // up to 3 upcoming
                remarks_i18n, dataTimestamp, generatedAt }
Place         { id, stopIds: [] }   // physical-location grouping (see below)
i18n          { en, "zh-Hant", "zh-Hans" }   // all three; upstream supplies name_en/_tc/_sc
```

### Stop merging (the interesting hard part) — implemented, [ADR-022](./08-decision-log.md)
For "nearby" to feel right, a single physical bus stop served by both KMB and Citybus should
appear **once**, listing both operators' routes. `buildPlaces` (`data-normalize/dataset.ts`) groups by:
1. **Cross-operator only** — two same-operator stops that close are opposite-direction kerbs; never merged
   (invariant: ≤ 1 member per operator per place).
2. **Proximity** — within `MERGE_RADIUS_M` = **30 m**.
3. **Landmark name match** — the two operators name a kerb differently (`怡和大廈 (CW112)` vs
   `怡和大廈, 干諾道中`), so we match the **landmark head** (before the first `,`/`(`) in en **or** zh, not
   the full string. Greedy nearest-first; conservative by design (under-merge over over-merge).

A merged place reuses the canonical `Stop` (its `sources[]` carries both operator ids); the place id is
self-describing (`P:<memberId>+<memberId>`) so the edge resolves members from the id alone. Future: looser
token-overlap matching and a manual override table for tricky cases.

This runs **offline in the daily dataset build**, not at request time, so it never costs the user
latency — since [ADR-055](./08-decision-log.md) that build is a GitHub Action
(`.github/workflows/dataset.yml`) writing precomputed shards to KV/R2, not a Worker cron. (See
[Architecture](./03-architecture.md) for where it sits, and [`10`](./10-scaffold-and-running.md)
for the `pnpm dataset:build` / `dataset:publish` commands.)

### Geospatial / "nearby"
The full canonical stop list is only on the order of tens of thousands of points — small enough
to ship to the device and query **locally** (distance over a typed array, or a geohash index).
So "nearby" is **instant and offline**: no server round-trip to find stops; we only hit the
network to fetch live ETAs for the routes at those stops.

## Map tiles & street imagery — HK Lands Department (ADR-049, ADR-050)
Not bus data, but the same keyless-HK-gov shape, so it belongs here. The basemap comes from the
**Lands Department (地政總署)** via the [CSDI Portal](https://portal.csdi.gov.hk/csdi-webpage/apilist) —
**no API key, free, commercial use explicitly permitted, and cacheable by us**. Pin `v1.0.0`; the docs
warn old versions are removed without notice.

**Clients never call `mapapi.geodata.gov.hk` directly.** The endpoints below are *upstream*: the Worker
proxies them at `/v1/tiles/basemap/{z}/{x}/{y}.png` and `/v1/tiles/label/{lang}/{z}/{x}/{y}.png`
(`apps/edge/src/tiles.ts`), and the app builds only those URLs (`apps/mobile/lib/tileSource.ts`). That
keeps the pinned version and the cache override in one place, and lets us repoint the basemap without an
app release.

| Service | Endpoint (upstream) | Notes |
|---|---|---|
| **Topographic** (basemap) | `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png` | z10–20. Dense survey cartography — footbridges/subways/landmarks, which is *why* we chose it (ADR-049). |
| **Map Label** (labels overlay) | `.../xyz/label/hk/{lang}/WGS84/{z}/{x}/{y}.png` | `{lang}` = `en`\|`tc`\|`sc` — **our three locales exactly**. Separate layer, so `useLocale()` swaps one URL. |
| **Vector** (later) | `.../vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf` | ⚠️ axis order is **`{z}/{y}/{x}`** (ESRI). Style is Mapbox GL spec v8, 813 layers. Docs say z9–15. |
| **Streetscape 360** | `https://data.map.gov.hk/api/3d-mms-data/{panorama}?key={key}` | Gov 360° street panoramas, territory-wide since Mar 2025. **Different host, and this one needs a key** — free, by emailing `3dmap@landsd.gov.hk` (no form, no vetting). See ADR-050. |

**Keyless is a property of the tier, not of LandsD.** Verified by live request 2026-07-28, because ADR-049
rests on it:

| Host | Key? |
|---|---|
| `mapapi.geodata.gov.hk` — the tiles above, i.e. everything we actually use | **keyless** (200 with no credential) |
| `data.map.gov.hk` — 3D + Streetscape 360 | key required (401 without) |
| `api.hkmapservice.gov.hk` — LandsD Map API (ArcGIS REST) | key required; its portal is branded for government departments. **We don't need it** — the public equivalents are on `mapapi.geodata.gov.hk`. |

The one thing we borrow from `api.hkmapservice.gov.hk` is the mandatory LandsD logo
(`/mapapi/landsdlogo.jpg`), which is undocumented and unkeyed — and which we **self-host** anyway
(ADR-049), so nothing in the request path depends on a keyed host.


**Also available, keyless, and useful later** ([backlog](./07-backlog.md)): **3D Pedestrian Route Search**
(footbridge-aware walking times — the honest way to do "leave now"), **Location Search** (text → HK
addresses/buildings; its `districtEN`/`districtZH` gives us the 18-district gazetteer ADR-042 wanted) and
**Search Nearby** (facilities within 1 km). ⚠️ Both search APIs return **HK80 Easting/Northing, not
WGS84** — they need an HK80↔WGS84 conversion in `@nextbus/core`. **Avoid the Imagery/satellite layers**:
they drag in Copernicus Sentinel-2 / Landsat third-party citation obligations that the plain topographic
and vector basemaps do not.

Caching is permitted by the CSDI grant, and tiles arrive with `cache-control: private,
must-revalidate, max-age=43200` — `private` makes every shared cache a no-op, so the Worker
**deliberately re-emits them as `public, max-age=43200, stale-while-revalidate=86400`**, adopting LandsD's
own 12 h TTL. Still **no speculative territory-wide pre-warm**: we cache only tiles a rider actually
looked at, since the one stated limit is against "large amount of requests within a short period".
Attribution is stricter than for the bus data — the **LandsD logo on the map face** plus a "Map from
Lands Department" notice — and is satisfied by `components/MiniMap.tsx`, which renders both **on the map
face**: the self-hosted `assets/landsd-logo.png` beside a localized notice that is a real link to LandsD's
disclaimer, not plain text. Full research, costs, rejected alternatives and verbatim licence clauses:
[`proposals/02`](./proposals/02-basemap-and-street-imagery.md).

## Licensing / attribution
data.gov.hk content is provided under the Government's open-data terms — **attribution required**.
This is now satisfied in-app by the **"About the data" screen** ([ADR-038](./08-decision-log.md)):
Settings → About → *About the data* opens a dedicated page whose **Sources** are tappable **link rows**
(DATA.GOV.HK, KMB/LWB, Citybus — each opening the source in a new tab) and a **Licence** link row to the
locale-aware **data.gov.hk Terms and Conditions of Use**. The honesty/freshness notes (the ~1-min source
ceiling, stale-greying, and that fares/timings are scheduled data shown as-is) live in the adjacent
**FAQ** screen. Static crawled data may be redistributed within those terms.
