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
| **Green Minibus (GMB)** | `data.gov.hk` dataset (all routes since Oct 2022) | [backlog](./07-backlog.md) |
| **Light Rail / MTR** | `data.gov.hk` datasets | [backlog](./07-backlog.md) |

### KMB / LWB — `data.etabus.gov.hk` (in our v1 scope)
- Endpoints: **Route**, **Route-Stop**, **Stop**, **ETA** (by stop+route+service type), **Route-ETA** (all stops on a route).
- ETA refreshed **~every 1 minute** upstream. JSON. Names in EN / 繁中 / 简中.
- Spec: `https://data.etabus.gov.hk/datagovhk/kmb_eta_api_specification.pdf`

### Citybus — `rt.data.gov.hk/v2/transport/citybus` (in our v1 scope)
- Endpoints: route, route-stop list, stop, ETA (e.g. `/v2/transport/citybus/eta/CTB/{stopId}/{route}`).
- **Use V2** — V1.x is being discontinued. JSON, keyless.
- Spec: `https://www.citybus.com.hk/datagovhk/bus_eta_api_specifications.pdf`

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
  reference for the normalization mapping (license-permitting; verify before reuse).

> **Current static source ([ADR-021](./08-decision-log.md)).** The static layer for **KMB + CTB** is built
> from the hk-bus-crawling **consolidated dataset** (`routeFareList.min.json`, one ~8 MB daily-updated fetch,
> memoized at the edge) — because the **official CTB API has no bulk stop/route-stop endpoint** (building a
> CTB index from it is a ~6,800-call crawl). The dataset's stop ids in `routeList.stops` are the raw,
> directly-ETA-callable operator ids; its `stopMap` over-clusters and is **not** used (it breaks ETA
> resolution). **Live ETAs still come direct from the official KMB/CTB APIs.** Our own crawl + same-kerb
> stop-merge + true Simplified static names are [backlog](./07-backlog.md) items.

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

### Stop merging (the interesting hard part)
For "nearby" to feel right, a single physical bus stop served by both KMB and Citybus should
appear **once**, listing both operators' routes. We build a `Place` grouping by:
1. **Proximity** — cluster operator stops whose coordinates fall within ~25–40 m.
2. **Name similarity** — fuzzy-match localized names to disambiguate close-but-distinct stops.
3. Manual override table for known tricky cases.

This runs **offline in the daily crawl pipeline**, not at request time, so it never costs the
user latency. (See [Architecture](./03-architecture.md) for where it runs.)

### Geospatial / "nearby"
The full canonical stop list is only on the order of tens of thousands of points — small enough
to ship to the device and query **locally** (distance over a typed array, or a geohash index).
So "nearby" is **instant and offline**: no server round-trip to find stops; we only hit the
network to fetch live ETAs for the routes at those stops.

## Licensing / attribution
data.gov.hk content is provided under the Government's open-data terms — **attribution required**.
We will display a "Data: Transport Department / KMB / Citybus via DATA.GOV.HK" credit and review
the terms before launch. Static crawled data may be redistributed within those terms.
