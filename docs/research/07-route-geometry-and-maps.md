# 07 — Route Geometry & Maps

> Commissioned 2026-08-22, after the owner noticed that **Transit** (transitapp.com) draws minibus route
> paths, and hkbus.app draws bus ones. The question was *"that data must be out there somewhere?"*
> It is. Everything below was **verified by download or live query on 2026-08-22**, not read off a
> catalogue page.
>
> This doc supersedes the route-geometry claims in [`01 §0`](./01-open-data-catalog.md) and
> [`02 §4`](./02-data-availability-matrix.md), both of which have been corrected in place.
> The decision is [ADR-151](../08-decision-log.md#adr-151--the-route-line-geometry-we-said-hong-kong-did-not-publish-has-existed-since-2021);
> the plan that acts on it is [`proposals/06`](../proposals/06-maps-and-route-geometry.md).

---

## 0. The correction, stated plainly

Three docs said Hong Kong publishes no route polylines. All three were wrong, and they were wrong in the
same way: **the right department's wrong file was measured.**

The `data.gov.hk` "Routes and fares of public transport (GeoJSON)" bundle really is 56,048 `Point`
features with zero `LineString` — that measurement was correct. But the route **lines** are not in that
bundle. They are two *separate* Transport Department datasets on the **CSDI portal**
(`portal.csdi.gov.hk`), a different site with a different catalogue, which the original survey never
opened.

The bus lines have been public since **December 2021** — before this project started. The green-minibus
lines since **October 2023**, which is the more forgivable miss and probably explains why Transit can
draw minibus routes: the dataset landed after most HK transit apps were built.

---

## 1. The source

| Dataset | CSDI id | Features | Geometry | Published |
|---|---|---|---|---|
| **Bus Route** (KMB · LWB · CTB · NLB) | `td_rcd_1638844988873_41214` | 2,255 | `MultiLineString` | 2021-12-07 |
| **Green Minibus Route** | `td_rcd_1697082463580_57453` | 1,161 | `LineString` | 2023-10-12 |

Publisher: **Transport Department**. Licence: the standard
[DATA.GOV.HK Terms of Use](https://data.gov.hk/en/terms-and-conditions) — free commercial and
non-commercial use, redistribution and caching **permitted**, attribution to the Government required,
data `AS IS`. Update frequency: biweekly (bus), and the mirrored versions we can see moved on
2026-07-27 (bus) and 2026-08-03 (GMB).

**It is genuine road alignment, not stops joined up.** KMB route 1 outbound carries 391 vertices; the
30 km GMB 69 circular carries 1,405. Median GMB route: 365 vertices. Coordinates are WGS84 lon/lat
(CSDI moved its GeoJSON to RFC 7946 compliance on 2025-12-08).

### Feature properties

```jsonc
// Green Minibus Route — one feature
{ "OBJECTID": 1, "ROUTE_ID": 2000410, "ROUTE_SEQ": 1, "PUBLIC_TRANSPORT": "GMB",
  "ROUTE_NAME": "69",
  "ST_STOP_ID": 20003337, "ST_STOP_NAMEE": "Cyberport Public Transport Interchange",
  "ST_STOP_NAMEC": "數碼港公共運輸交匯處", "ST_STOP_NAMES": "数码港公共运输交汇处",
  "ED_STOP_ID": 20003337, "ED_STOP_NAMEE": "…", "Shape_Length": 30406.61 }
```

The bus file is the same shape with `ROUTE_NAMEE` instead of `ROUTE_NAME` and a `COMPANY_CODE` of
`KMB` · `CTB` · `LWB` · `NLB` · `KMB+CTB` · `LWB+CTB` (a joint route is **one** feature naming both
operators, which matters — see §4).

### The join we already have

**CSDI `ROUTE_ID` is the consolidated dataset's `gtfsId`.** Verified end to end: `ROUTE_ID 2000410` →
GMB route 69, Cyberport ↔ Quarry Bay (Shipyard Lane) circular, with CSDI's `ST_STOP_NAMEE` /
`ED_STOP_NAMEE` matching our own terminus names exactly.

We already carry `gtfsId` — it is the disambiguating component of the GMB canonical id
(`GMB:{no}:{bound}:{gtfsId}`, ADR-047) and it survives into `dataset.ts`. It is **dropped for
KMB/CTB/NLB**. Retaining it there is the single prerequisite for any of this.

---

## 2. Coverage — measured, not estimated

Against our own route list (the consolidated `routeFareList`, 3,765 route-directions):

| Operator | route-directions | with a path | coverage |
|---|---:|---:|---:|
| **GMB** | 1,147 | 1,143 | **100%** |
| **KMB** (incl. LWB) | 1,611 | 1,468 | **91%** |
| **CTB** | 764 | 659 | **86%** |
| **NLB** | 103 | 86 | **83%** |
| **bus + minibus** | **3,625** | **3,356** | **93%** |
| MTR feeder · Light Rail · ferries | 140 | 0 | **0%** |

Adding a fallback that matches on **operator + route number** rather than `gtfsId` lifts the total to
**96%** (KMB 93%, CTB 95%, NLB 96%, GMB 100%) — but that match is ambiguous and needs the resolver in
§4 to be safe.

### What the 7% actually is

Almost none of it is missing from CSDI. It is missing a **join key**: of the 269 uncovered
route-directions, **258 have no `gtfsId` at all** in the consolidated dataset, and only 11 have a
`gtfsId` that CSDI does not know.

The shape of the gap is recognisable at a glance — these are **special and supplementary departures**:

| suffix | count | what it is |
|---|---:|---|
| *(none)* | 143 | mostly `serviceType ≠ 1` variants and short-workings |
| `R` | 36 | racecourse / special event |
| `S` | 28 | school and special |
| `A` `P` `M` `B` `X` `C` `K` | 58 | airport, peak-hour, MTR-feeder, and lettered branches |

TD registers the *parent* route; the racecourse extra that runs six times a year is not separately
registered. That is a reasonable thing for a government dataset to do, and it means the gap is
structural rather than a data-quality problem that will improve.

---

## 3. What other apps do with the gap — they do **not** hide it

The owner's guess was *"I assume we just don't show it?"* — that is not what hkbus.app does, and the
answer is worth knowing before we copy anyone.

From their [`useRoutePath.tsx`](https://github.com/hkbus/hk-independent-bus-eta/blob/master/src/hooks/useRoutePath.tsx):

```ts
const setFallbackGeoJson = () => {
  setGeoJson({ features: [{ type: "Feature", geometry: {
    type: "LineString",
    coordinates: stops.reduce((acc, { location: { lat, lng } }) => {
      acc.push([lng, lat]); return acc }, [])   // ← the stops, in order, joined by straight lines
  }}], type: "FeatureCollection" })
}
if (waypointsFile === "") { setFallbackGeoJson() }
else { fetch(...).then(setGeoJson).catch(setFallbackGeoJson) }
```

So: **no geometry, or any fetch error, silently degrades to a straight line through the ordered
stops.** There is no marker, no styling change, and no message. A rider cannot tell a surveyed
alignment from a crow-flies approximation.

**This is the design question, not a technical one.** A straight line between two stops either side of
the harbour draws a bus swimming across Victoria Harbour; a straight line down South Lantau draws one
flying over a mountain. Under our own rule 3 — *never fake precision* (ADR-008) — copying that
fallback unmarked would be the map-shaped version of a client-side per-second countdown. Options are
weighed in [`proposals/06 §5`](../proposals/06-maps-and-route-geometry.md).

### Sample routes to see it for yourself

Open these in **hkbus.app** (and Transit, for the minibus ones). Every route in the first block has
**no `gtfsId`**, so hkbus falls back to straight lines; the second block is the control.

**Straight-line fallback — the failure is visible:**

| Operator | Route | Direction | Stops | What to look for |
|---|---|---|---:|---|
| **CTB** | `20R` | Kai Tak Cruise Terminal → TST / High Speed Rail | **4** | The most dramatic: 4 stops over 7.6 km, so the "route" is 3 long chords straight across Kowloon Bay. |
| **KMB** | `101R` | Happy Valley Racecourse → Kwun Tong | 21 | Crosses the harbour by tunnel; the fallback line goes **through the water**. |
| **KMB** | `259R` | Hong Kong Coliseum → Tuen Mun Pier Head | 14 | 27 km with 14 stops — huge chords across the western New Territories. |
| **NLB** | `1` | Mui Wo Ferry Pier → Tai O | 56 | South Lantau Road is hairpins the whole way; the fallback cuts over the hills. |
| **CTB** | `11` | Jardine's Lookout → Central (Ferry Piers) | 31 | Mid-Levels switchbacks flattened into chords. |

**Control — real surveyed geometry:**

| Operator | Route | `gtfsId` | Vertices |
|---|---|---|---:|
| **KMB** | `1` Chuk Yuen Estate ↔ Star Ferry | `1001` | 391 out / 422 back |
| **GMB** | `69` Cyberport ↔ Quarry Bay (circular) | `2000410` | 1,405 |

**Ambiguity cases — useful for testing the resolver:** KMB `101` (two variants, → Des Voeux Rd Central
and → Belcher's Street), CTB `11` (a circular *and* a Loong Fung Terrace short-working *and* a Canal
Road East working), NLB `1` (five candidate `ROUTE_ID`s for one route number).

---

## 4. The resolver — two traps, both measured

### Trap 1: `ROUTE_SEQ` does not reliably mean outbound/inbound

hkbus flags this in `waypoints.py` and it is their issue #14:

> `ROUTE_SEQ` doesn't track the operators' outbound/inbound, so labelling by it swaps some routes.

Their fix matches each line's **first vertex** against each direction's **first stop** by haversine,
with a 500 m guard. That works, but it decides a whole route's direction on a single point — and a
terminus where both directions board within 40 m of each other is common in Hong Kong.

**A stronger metric, measured:** score a candidate line by the **mean distance from every one of the
rider's ordered stops to the nearest point on the line**. On KMB 101:

| candidate | mean stop → line |
|---|---:|
| `ROUTE_ID 1482` **SEQ 1** | **8.6 m** |
| `ROUTE_ID 1482` SEQ 2 (reverse) | 41.9 m |
| `ROUTE_ID 8663` (wrong route) | 432.0 m |

A 5× separation for direction and a 50× separation for wrong-route rejection. This is not a marginal
test, and it uses all the evidence rather than one endpoint.

### Trap 2: a short-working scores identically to the route it runs along

The same metric **cannot** separate KMB 101's two variants — `1482 SEQ 1` and `8341 SEQ 1` both score
**8.6 m**. That is not a tuning failure, it is the metric being the wrong shape: mean stop-to-line
distance measures *"does the line cover my stops"*, and a short-working's stops all lie on its parent's
line, so the parent covers them perfectly. Endpoint distance does slightly better (CTB 11's circular
and its Loong Fung Terrace working differ by 4 m at the differing end) but ties on KMB 101 at 90 vs
92 m — a coin flip.

**The fix is not a better score.** Pick the best-covering line, then **trim it to the rider's own first
and last stop** by projecting both onto the line and cutting. Then it stops mattering which variant
won: the drawn line is the road the rider's own stops sit on, bounded by the rider's own terminals.
It handles circulars and short-workings with the same code, and it is the only version that cannot
draw a tail past the terminus the rider is looking at.

### The algorithm, end to end

```
resolveRoutePath(route):
  candidates ← CSDI features where ROUTE_ID = route.gtfsId          # exact, 93%
              ∪ CSDI features where (operator, ROUTE_NAME) matches  # fallback, +3%
  if none → no path
  best ← argmin over candidates of mean(distance(stop, line) for stop in route.stops)
  if best.score > REJECT_THRESHOLD → no path      # guards a bad name match
  line ← trim(best.line, from: nearest point to route.stops.first,
                           to: nearest point to route.stops.last)
  return line
```

`REJECT_THRESHOLD` wants calibrating against the corpus — the observed good scores cluster under
10 m and the observed bad one was 432 m, so there is a wide gap to put it in, but it should be
pinned by fixtures rather than guessed.

---

## 5. Three ways to fetch it — all verified

| | How | Size | Verdict |
|---|---|---|---|
| **A. Per-route, on demand** | ArcGIS FeatureServer: `…/FeatureServer/0/query?where=ROUTE_ID=1001&outFields=*&returnGeometry=true&outSR=4326&f=geojson` | **33 KB** for both directions of KMB 1 | Verified working, returns both directions in one call. No bulk pipeline. **The owner's preference and the right start.** |
| **B. Bulk, into our dataset** | `https://static.csdi.gov.hk/csdi-webpage/download/{fileid}/geojson`, where `fileid` comes from `portal.csdi.gov.hk/geoportal/rest/metadata/item/{datasetId}` (`_source.fileid`, dashes stripped) | bus **1.53 GB** unzipped / 240 MB zip; GMB 21 MB / 3.5 MB zip. FGDB is 38 MB but needs GDAL | The honest cost of self-hosting. Fits `dataset:build` but it is a big new step. |
| **C. Piggyback hkbus** | `https://hkbus.github.io/route-waypoints/{gtfsId}-{O\|I}.json` | ~2–8 KB, pre-truncated + gzipped | Daily-synced, already solves direction. But it is *their* uptime, *their* direction call, and citation is required. Good for a spike, poor as a dependency. |

**Payload after our own truncation** — 5 decimal places (±1 m) plus gzip, which is what hkbus does and
what we should do too: KMB 1 **both** directions = **4 KB**. All 1,161 GMB route-directions together =
**2.8 MB**. Per-route average 2.4 KB. Route geometry is small; it is only the *bulk archive* that is
large.

The FeatureServer also answers `WFS` and `WMS` (`links_s` in the metadata), and there is a
`FeatureServer` REST endpoint per dataset — so option A has room to grow (bbox queries for a
"routes through this area" view) without changing source.

---

## 6. Interactive basemaps — the provider question

The owner wants draggable/zoomable maps, and wants providers swappable. Today `MiniMap` is a
hand-composited grid of `<img>` raster tiles with no interaction at all, and the `TileSource` port
(`packages/ports/src/tile-source.ts`) describes **how to fetch one tile** — `basemap(z, x, y)`.

That port is well-built for what it does, but its shape presumes *the renderer composites tiles
itself*. An interactive map delegates compositing to an engine (MapLibre, MapKit, Google Maps), and
what an engine wants is a **style** or an **archive**, not a tile URL. So the seam has to widen; see
[`proposals/06 §2`](../proposals/06-maps-and-route-geometry.md).

### The two candidate basemaps

|  | **LandsD raster** (today, ADR-049) | **Protomaps vector** (hkbus's choice) |
|---|---|---|
| Source | TD/LandsD raster XYZ, proxied by our Worker | PMTiles archive self-built from OSM with planetiler |
| Detail | Surveyor's own: footbridges, subways, landmark buildings | OSM: no footbridge/subway detail |
| Labels | Separate per-locale `en`/`tc`/`sc` raster overlay | hkbus uses **LandsD's label raster on top** — their style has *zero* `symbol` layers |
| Dark mode | None; must be derived by CSS invert (`invertForDark`) | Native — restyle without new tiles |
| Rotation / pitch / smooth zoom | No (raster) | Yes |
| First-visit cost | Per-tile, incremental | hkbus downloads the **whole 29.6 MB archive** and blocks tiles for 5–30 s |
| Licence | Keyless, free commercial, caching permitted | OSM ODbL — attribution + share-alike on derived tiles |

The important discovery from [`proposals/02 §11`](../proposals/02-basemap-and-street-imagery.md) still
holds and is now more useful: because hkbus puts **LandsD's label raster over an OSM base**, the
per-locale label layer is **orthogonal to which base sits underneath**. We can switch base without
touching labels, or keep LandsD raster and gain interaction, and neither decision constrains the
other.

**Both are just sources to MapLibre.** `maplibre-gl` renders a raster XYZ source as happily as a
vector one, so adopting MapLibre does *not* commit us to leaving LandsD — it makes LandsD the
`raster` source in a style we own, and Protomaps becomes a one-file swap later if it earns it.

### Versions, checked 2026-08-22

| Package | Version | Note |
|---|---|---|
| `maplibre-gl` | 6.5.0 | web renderer for `apps/web` |
| `@maplibre/maplibre-react-native` | 11.3.6 | peer `expo >= 54` — our Expo is `~56.0.12`, **compatible**. Needs a config plugin (adds `$MLRN.post_install` to the iOS Podfile); not part of the Expo SDK, so a dev-client build, not Expo Go |
| `pmtiles` | 4.5.0 | only if we go vector |

`maplibre-react-native` is the one engine that covers web **and** native, which is what makes
"swappable provider" and "one map component per renderer" compatible goals rather than competing ones.

---

## 7. Street view — feasible, with a dependency to clear first

LandsD's **Streetscape 360** is real and documented on CSDI
([API doc](https://portal.csdi.gov.hk/csdi-webpage/apidoc/streetscape-360-api)): panoramic street-level
imagery plus point cloud from their Mobile Mapping System.

- **Endpoint:** `https://data.map.gov.hk/api/3d-mms-data/{panorama}?key={key}`
- **A key is required.** It is **free** but must be requested — Lands Department, GIS Projects
  Section, `3dmap@landsd.gov.hk`. The docs publish a sample key
  (`3967f8f365694e0798af3e7678509421`), which is fine for a spike and **not** something to ship on.
- **Panorama locations ship as a downloadable GeoJSON**, so "is there a panorama near this stop" is a
  spatial lookup we can precompute into the dataset rather than a live call.
- Terms: free for commercial and non-commercial use with attribution, same family as the rest.

Contrast with the alternative in memory: **Google Street View's terms forbid caching and forbid
placing it near a non-Google map**, so it can only ever be a deep link out. LandsD's can actually be
embedded. That makes the street-view tab a *LandsD* feature or nothing.

**The blocking item is an email**, not code. Worth sending early since it gates the nice-to-have.

---

## 8. Open questions this research did not settle

1. **What does Transit actually use?** Their minibus paths are consistent with the CSDI GMB dataset
   (right vintage, right coverage) but Transit publishes no feed provenance, so this is inference.
   It does not change what *we* should do.
2. **`REJECT_THRESHOLD` and the trim tolerance** need pinning against a corpus, not choosing by eye.
3. **MTR feeder / Light Rail / ferry geometry** (140 route-directions, 0%) — hkbus hand-maintains
   static files. Unresolved whether we copy, hand-draw, or leave those without a line.
4. **Does the bulk archive belong in `dataset:build`?** 1.53 GB per build is a real CI cost, and
   option A may make it unnecessary. Deferred deliberately.
