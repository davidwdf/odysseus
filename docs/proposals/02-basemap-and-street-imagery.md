# 02 — Basemap & street-level imagery sourcing

> **Status: DECIDED 2026-07-26 → [ADR-049](../08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)
> (basemap = LandsD, self-cached) and [ADR-050](../08-decision-log.md#adr-050--stop-imagery-google-street-view-deep-link-now-hk-streetscape-360-as-the-inline-target)
> (imagery = Google deep link now, Streetscape 360 next). Neither is implemented yet.**
> This doc is retained as the **research record** — the costed comparison, the rejected options and the
> verbatim licence clauses behind those two ADRs. Every price, quota and licence clause was read off the
> vendor's own page on **2026-07-26** and is cited.
>
> **What the decision changed vs. this doc's original recommendation:** §4 treated LandsD's dense survey
> cartography as a drawback and made "can it be dark-themed?" the decision gate. It isn't a drawback —
> the footbridges, subways and landmark buildings are precisely what tells a rider which side of a road
> they're on, which is the hardest part of finding an HK stop. So we take the **raster** path (z10–20, no
> renderer change) and the dark-restyle spike (§9 Q1) drops off the critical path. Protomaps becomes the
> documented fallback, not the frontrunner.

## 0. Why this doc exists

Two separate questions came up together and turned out to share one answer:

1. **Street-level imagery** — HK bus stops are often one of several poles outside a mall exit or
   across a flyover. A photo of the kerb answers *"am I at the right pole?"* faster than a map pin
   ever will. (Originally raised as "could we use Google Street View?")
2. **The basemap** — [`MiniMap`](../../apps/mobile/components/MiniMap.tsx) currently draws
   **OpenStreetMap's public raster tiles** ([ADR-041](../08-decision-log.md), [ADR-045](../08-decision-log.md)).
   That is fine for development and **cannot ship** (see [§7](#7-why-the-current-osm-tiles-cannot-ship)).

The headline finding is that the **Hong Kong Lands Department (地政總署)**, via the
[CSDI Portal](https://portal.csdi.gov.hk/csdi-webpage/apilist), answers *both* — keylessly, free,
with real `en`/`tc`/`sc` labels, **and** with its own territory-wide street-level panorama service
(**Streetscape 360**). It is also, as far as any published term goes, the **only** provider here that
lets us cache tiles ourselves.

---

## 1. TL;DR recommendation

| # | Decision | Status | Why |
|---|---|---|---|
| 1 | **Ship the free Google Street View *deep link* now** | ✅ ADR-050 | £0, keyless, no ToS exposure, no billing account. Slots in beside the existing "Open in Maps" hand-off. Gets the feature this week. |
| 2 | **Adopt LandsD as the production basemap**, Worker-cached, **raster** | ✅ ADR-049 | Keyless, $0, authoritative HK geometry, and **`en`/`tc`/`sc` labels as a separate overlay** — one tile URL per locale. Caching is permitted (§3). |
| 3 | **Spike Streetscape 360** as the inline photo | 🔴 blocked on Q1 | HK-gov street panoramas, territory-wide since Mar 2025, free API key. Beats Google on licence *and* on our ability to cache. |
| 4 | **Keep Protomaps/PMTiles on R2 as the documented fallback** | 📋 recorded | A measured **38 MB** for all of HK at z0–15. Real dark flavour, verified zh-Hant/zh-Hans, native support since Jan 2025. Take it if we later need true dark or offline packs. |
| 5 | **Do not embed any Google imagery** | ✅ ADR-050 | Caching *and* re-hosting are expressly prohibited, and the no-mixing clause bans Google imagery on the same screen as a MapLibre map. |

**Net cost of the recommended path: $0/month.** Google's paid products are not merely expensive
relative to the alternatives — they are the only options here whose terms actively fight our
architecture.

---

## 2. Direct feature comparison — basemap

| | **LandsD / CSDI** | **Protomaps → R2** | **Protomaps hosted** | **MapTiler** | **Google Maps** | **OSM public tiles** |
|---|---|---|---|---|---|---|
| **Cost at our scale** | **$0** | **$0–5/mo** | **$14/mo** (commercial) | $30/mo | ~$350/mo @1k DAU (JS API) | $0 |
| **Free tier** | unlimited, keyless | n/a (self-host) | 1M req/mo non-commercial | 5k sessions/mo | 10k map loads/mo | unlimited-ish |
| **Free tier allows commercial?** | ✅ **explicitly** | ✅ | ❌ → $14/mo sponsor | ❌ | ✅ | ⚠️ "access may be withdrawn" |
| **API key** | ❌ **none** | ❌ none | ✅ | ✅ | ✅ + billing account | ❌ |
| **May we cache/proxy?** | ✅ **yes** (§3) | ✅ it's our file | ✅ | ⚠️ vendor terms | ❌ **prohibited** | ⚠️ must cache ≥7d, no prefetch |
| **Raster or vector** | both | vector | vector | vector | both | raster |
| **Dark theme** | ⚠️ see §4 | ✅ real dark flavour | ✅ | ✅ | ✅ | ❌ (we CSS-invert) |
| **zh-Hant labels** | ✅ **official** | ✅ verified in HK tiles | ✅ | ✅ | ✅ | ❌ baked-in mixed |
| **zh-Hans labels** | ✅ **official** | ✅ verified | ✅ | ✅ | ✅ | ❌ |
| **HK accuracy / freshness** | ✅ **best** — the surveyor | OSM (volunteer) | OSM, <weekly | OSM | very good | OSM |
| **Max zoom** | 20 raster / 15–19 vector | 15 (overzoom above) | 15 | 22 | 22 | 19 |
| **Works in MapLibre** | ✅ style is **GL spec v8** | ✅ | ✅ | ✅ | ❌ **prohibited** | ✅ |
| **Native (iOS/Android)** | ✅ plain XYZ | ✅ since Jan 2025 | ✅ | ✅ | own SDK only | ⚠️ UA blocked |
| **Offline capable** | ✅ (cacheable) | ✅ bundle 38 MB | ✅ | paid | ❌ | ❌ **prohibited** |
| **Attribution burden** | **logo on map face** + text | text only | text only | text + logo | baked into image | text + link |
| **Withdrawal risk** | low (statutory body) | **none** — our file | low | contractual | low | ⚠️ **explicit warning** |

### The two decisive columns
- **Caching.** LandsD is the only *hosted* provider whose licence affirmatively grants
  reproduction/distribution with no caching prohibition. Google bans it outright. Protomaps is moot
  because the file is ours.
- **Chinese labels.** LandsD serves labels as a **separate overlay layer** keyed on
  `{lang}` = `en`/`tc`/`sc` — which is *exactly* our three locales. `useLocale()` swaps one URL and
  the map relabels, with zero restyling. This is also the fix for the thing OSM does worst: its HK
  Chinese names are volunteer-contributed and uneven, which is what you noticed when panning the
  Protomaps demo.

---

## 3. LandsD terms — can we cache? **Yes.**

The governing licence is the [CSDI Terms and Conditions of Use](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC)
(no version number; footer "Copyright © 2024"). The operative grant, **verbatim**:

> You are allowed to browse, download, distribute, reproduce, hyperlink to and print the Data for
> both **commercial and non-commercial purposes on a free-of-charge basis** on the condition that:-
> you shall comply with the Terms of Use; you shall identify clearly the Government and the CSDI
> Portal as the source of the Data and acknowledge the Government and the relevant organisations'
> ownership of the intellectual property rights in the Data and in all copies thereof including but
> not limited to paper copies, **digital copies and copies placed on other websites**; you shall
> indemnify the Government …

"Data" is defined to include the API itself:

> "Spatial Data" include all data in the form of digital maps, text, graphics, drawings, diagrams,
> photographs, compilation of data, data specifications, metadata and **Application Programming
> Interface ("API")**.

**There is no caching, bulk-download, scraping or mirroring prohibition anywhere in the terms.**
(Keyword-scanned for `cach*`, `bulk`, `scrap*`, `systematic*`, `mirror*`, `crawl*` — zero hits in
the licence text.) The phrase *"copies placed on other websites"* is the closest the document comes
to our scenario, and it treats it as **permitted with attribution**. This is a materially broader
grant than any commercial vendor here, most of which ban caching explicitly.

**The only stated limit** is one sentence, identical on all four Map API docs:

> In order to maintain the quality of the Map API service, your application shall not invoke the API
> with large amount of requests within a short period.

No numbers. Note that **caching helps us comply** with this rather than straining it — which is the
"good for them and good for us" point exactly. The one thing that *would* be risky is
pre-warming a whole-territory tile pyramid, since that is literally "large amount of requests within
a short period". **Demand-driven caching only; no speculative crawl.**

### Conditions we must meet
| Requirement | Detail |
|---|---|
| **Logo on the map face** | Mandatory, stated on every API doc: *"You are required to include Lands Department logo on the map face and Copyright Notice"*. Asset: `https://api.hkmapservice.gov.hk/mapapi/landsdlogo.jpg` (undocumented — **self-host a copy**). Their own sample renders it **28×28 px**, bottom-right. No size/placement rules are published. |
| **Copyright notice** | `Map from Lands Department` / `地圖由地政總署提供`, linked to `https://api.portal.hkmapservice.gov.hk/disclaimer`. |
| **Indemnity** | Mandatory and unbounded. Standard for HK gov open data (same as the bus data we already use). |
| **`Cache-Control: private`** | Tiles return `cache-control: private, must-revalidate, max-age=43200`. `private` means a Worker/CDN cache **no-ops unless we deliberately override it**. This is an HTTP hint, not a licence term; their own 12 h `max-age` is a defensible TTL to adopt, and the upstream dataset is documented as updating **weekly**. |
| **Pin the version, expect churn** | *"The version number may be updated in the future. Old version will be removed at any time without notice."* |
| **No warranty, may be withdrawn** | Standard gov disclaimer. Low practical risk from a statutory survey body. |

### Two caveats worth knowing
1. **The "IP Rights Notice of LandsD Map API"** is incorporated by reference on every API doc but
   **could not be located as a published document** (all plausible URLs 404). The CSDI T&C is the
   only rights grant that exists; `.../disclaimer` is the de-facto copyright wording.
2. **A conflicting 2006 LandsD page** ([copyright.html](https://www.landsd.gov.hk/en/resources/mapping-information/mapping-teaching-resources/copyright.html))
   says data *"should not be disseminated … to a third party"* and that *"royalty charges will be
   levied against firms … who reproduce our mapping products for commercial … purposes."* It sits
   under *mapping-teaching-resources*, concerns LandsD's **paid** products, and predates the CSDI
   open-data regime by ~16 years. **Reading it as superseded for API data is an interpretation, not a
   stated fact.** If this ever becomes commercially material, email `mapapi@landsd.gov.hk` — that
   is the documented contact, and getting a one-line written confirmation is cheap insurance.

**Verified live, keyless, 2026-07-26:**
```
✅ HTTP 200  16 KB  image/png       …/xyz/label/hk/tc/WGS84/15/26775/14299.png
✅ HTTP 200  22 KB  image/png       …/xyz/basemap/WGS84/15/26775/14299.png
✅ HTTP 200 288 KB  vector tile     …/vt/basemap/WGS84/tile/15/14299/26775.pbf
✅ HTTP 200  61 KB  vector labels   …/vt/label/hk/tc/WGS84/tile/15/14299/26775.pbf
   access-control-allow-origin: *   ← CORS open, no key, no referrer check
```

---

## 4. LandsD endpoints, and the dark-mode question

All patterns pinned at `v1.0.0`, `{sr}` = `WGS84` (matches our coordinates) or `HK80`.

| Service | URL pattern | Zooms |
|---|---|---|
| **Topographic** (raster basemap) | `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/{sr}/{z}/{x}/{y}.png` | 10–20 |
| **Map Label** (raster labels, overlay) | `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/{lang}/{sr}/{z}/{x}/{y}.png` | 0–20 |
| **Vector Map** | `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/{sr}/tile/{z}/{y}/{x}.pbf` | 9–15 documented (source declares 19) |
| **Vector Map Label** | `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/label/hk/{lang}/{sr}/tile/{z}/{y}/{x}.pbf` | — |
| **Vector style** | `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/{sr}/resources/styles/root.json` | — |

⚠️ **Note the vector tile axis order is `{z}/{y}/{x}`, not `{z}/{x}/{y}`** — an ESRI convention, and
an easy bug to ship.

### Can it be dark-themed? Probably — better news than the docs suggest
The docs say nothing about custom styling, but I fetched and parsed the style file:

```
"version": 8          ← Mapbox GL Style Spec v8 → MapLibre can load it
813 layers
sources.esri:  vector, bounds [113.246, 21.6687, 114.968, 23.0422], maxzoom 19
sprite:  …/resources/sprites/sprite
glyphs:  ../fonts/{fontstack}/{range}.pbf
layers[].layout.text-field:  "{_name}"
```

So: **it is a standard GL style we can programmatically recolour** — which means dark mode is
achievable and would fit the `@nextbus/ui` value-swap model ([ADR-015](../08-decision-log.md)).
The honest caveats:
- **813 layers** is a lot to recolour. This wants a scripted transform (walk the style, map source
  colours → semantic tokens), not hand-editing. That is the spike in §9.
- The cartography is **survey-styled** — dense, technical, contour lines and lot boundaries — rather
  than the clean transit-friendly look of a Protomaps flavour. Recolouring fixes luminance, not
  information density. We would likely also want to *drop* layers.
- Labels come from a **separate** layer whose `text-field` is a generic `{_name}`; the basemap tile
  itself carries no CJK. Language selection therefore happens by **choosing the `{lang}` label
  service**, not by a style expression — which is simpler for us, and works identically on the
  raster and vector paths (both `tc` variants verified above).
- **Raster path has no dark option at all.** If we take the raster (simplest, zoom 10–20, no
  renderer change), we lose dark mode unless we keep a CSS filter — the very hack we'd like to retire.

**This was framed as the deciding trade-off** — LandsD wins on accuracy, licence, cost and official
Chinese labels; Protomaps wins on cartography and a genuine dark flavour.

**Resolved in favour of LandsD (ADR-049).** The premise above — that dense survey cartography is a
cost to be minimised — is wrong for our use case. The footbridges, subways and landmark buildings
that make this map "busy" are the very features that tell a rider *which side of the road they are
on*, which is the single hardest part of finding an HK stop. Information density is the product
feature here, not visual noise. So we take the **raster** path (z10–20, no renderer change, no
restyle work) and accept keeping the `DARK_TILE_FILTER` CSS-invert for dark mode until/unless a
vector migration earns its keep. Protomaps stays documented as the fallback for the day we want true
dark theming or offline packs.

---

## 5. Bonus features that come along for free

This is the part that makes LandsD more than a tile swap. All keyless unless noted, all verified to
exist on the [API list](https://portal.csdi.gov.hk/csdi-webpage/apilist).

| API | What it gives us | Relevance |
|---|---|---|
| **Streetscape 360** | 360° street-level panoramas, **territory-wide** (HK Island + all NT completed Mar 2025) | ⭐⭐⭐⭐⭐ The kerb photo — see §6 |
| **Location Search** | Text → HK addresses, building names, place names, facility names | ⭐⭐⭐⭐ Could extend our search beyond stop/route names to *"search for a building"* |
| **Search Nearby** | Facilities within 1 km of a coordinate, `lang=en|zh` | ⭐⭐⭐ Landmark context on a stop card ("outside Langham Place") |
| **3D Indoor MTR Station Map** | Indoor geometry for MTR stations | ⭐⭐⭐ Bus↔MTR interchange walking guidance |
| **3D Pedestrian Route Search** | Pedestrian routing incl. footbridges/subways | ⭐⭐⭐⭐ **The right way to do "leave now" walking time** in HK, where a 50 m straight-line gap can be a 400 m footbridge detour. Would make [ADR-008](../08-decision-log.md)-honest walk estimates genuinely accurate. |
| **Identify / Lot Index / Land Parcel** | Cadastral lookups | ✩ Not useful to us |
| **3D Visualisation Map** (+ non-textured) | Textured 3D city models | ✩ Fun, not useful |
| **Imagery Map** | Aerial/satellite raster | ⚠️ Avoid — drags in Copernicus Sentinel-2/Landsat third-party citation obligations. A plain topographic/vector basemap has **no** third-party layer. |

**Live check of Location Search**, keyless, `q=Mong Kok`:
```json
[{"nameEN":"Mong Kok","nameZH":"旺角","districtEN":"Yau Tsim Mong District",
  "districtZH":"油尖旺區","x":835713.0,"y":820122.0}, …]
```
⚠️ **Location Search and Search Nearby return HK80 Easting/Northing, not WGS84 lat/lng.** Using
them means adding an **HK80 ↔ WGS84 conversion** to `@nextbus/core`. Worth noting because it also
unlocks the *"towards {district}"* wording that
[ADR-042 follow-up #1](../07-backlog.md) wanted an 18-district gazetteer for — `districtEN`/`districtZH`
is right there in the response.

---

## 6. Street-level imagery compared

| | **Google deep link** | **Streetscape 360** (LandsD) | **Street View Static** | **Mapillary / KartaView** |
|---|---|---|---|---|
| **Cost** | **$0** | **$0** | $7/1k after 10k/mo | $0 |
| **API key** | ❌ none | ✅ free, by email | ✅ + billing account | ✅ token |
| **HK coverage** | excellent | **territory-wide** (Mar 2025) | excellent | patchy, unverified |
| **Inline in our UI?** | ❌ leaves the app | ✅ | ✅ | ✅ |
| **May we cache?** | n/a | ⚠️ likely (§3 grant) | ❌ **prohibited** | ⚠️ per-licence |
| **Same screen as MapLibre?** | ⚠️ it's a link, so fine | ✅ | ❌ **prohibited** | ✅ |
| **Effort** | **hours** | days (SDK, key, HK80) | days | days |

### Option A — Google deep link (do this now)
Free, keyless, and confirmed: *"You don't need a Google API key to use Maps URLs."* No SKU, no
quota, no billing account, and because Google renders the imagery in its own app the caching,
attribution and no-mixing clauses simply don't apply to us.

```
https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat}%2C{lng}&heading={bearingDeg}
```

We already carry `Stop.bearingDeg` (ADR-042 follow-up #1), so **the panorama opens facing the
direction the bus travels** — which is precisely the view that identifies the right pole.
Optional polish: the **Street View metadata endpoint is free and unmetered** (*"No quota is consumed
when you request metadata"*), so we can hide the button where no panorama exists rather than
sending the rider to a grey screen. That does need a key + billing account, so it's a later
refinement, not part of the first cut.

### Option B — Streetscape 360 (the interesting one)
```
https://data.map.gov.hk/api/3d-mms-data/{panorama}?key={key}
```
- **Free API key** from the Lands Department GIS Projects Section: `3dmap@landsd.gov.hk`.
- Published limits: **5 GB/s bandwidth, 100 concurrent users** — generous, and far more concrete
  than the tile APIs' hand-wave.
- Same CSDI grant as §3, so **we can very likely cache the panoramas** — which no Google option
  permits, and which is the difference between a per-stop photo being free forever versus metered.
- **Unknowns:** the docs don't document a *"nearest panorama to this lat/lng"* lookup — panorama
  paths are said to be *"returned using the JavaScript SDK included in the demonstration code"*, and
  the image format looks like a bespoke `.pano`. Whether we can resolve a stop coordinate → panorama
  **without** running their JS SDK is the decisive unknown, and the SDK may be a poor fit for React
  Native. This is spike #2 in §9.

### Option C — Street View Static: **ruled out, and not on price**
Two clauses in the [Maps Platform ToS](https://cloud.google.com/maps-platform/terms) kill it:

> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape Google Maps Content for
> use outside the Services. For example, Customer will not: (i) pre-fetch, index, store, reshare, or
> **rehost** Google Maps Content outside the services; (ii) **bulk download Google Maps tiles, Street
> View images** …

> **(e) No Use With Non-Google Maps.** … Customer will not … (ii) **display Street View imagery and
> non-Google Maps on the same screen** …

So a Worker cache or R2 store of panoramas is squarely offside, *and* we could not put a Street View
thumbnail on the same screen as a MapLibre/LandsD map — which is exactly the Place-detail layout we
have. Note the widely-cited "30-day caching rule" is **not** an imagery allowance: it applies to
lat/lng values on specific APIs. The **only** thing we may store indefinitely is the `pano_ID`
(*"pano_ID, from Street View Static API"* is named in the ID-caching carve-out).

Corrections to what I told you earlier in this conversation, now that I've read the actual terms:
- I said a 30-day rolling cache of Street View images would be workable. **It isn't** — caching
  those images is prohibited outright, so the "~free-tier to ~$20/month" figure I gave was wrong in
  kind, not just in degree. Without caching, cost scales with *views*, not unique stops.
- The **$200/month universal credit is gone** (ended 1 March 2025), replaced by **per-SKU** free
  allowances of 10,000/month at the Essentials tier. Because the allowances no longer compete with
  each other, this is *more* generous for a low-volume app than I implied. Google's own
  `get-started` page still advertises the $200 credit — it's stale.
- **Native mobile map loads really are unmetered**, so the Google-basemap cost would land almost
  entirely on the PWA. But **Dynamic Street View** is a separate billed Pro SKU even on mobile.

---

## 7. Why the current OSM tiles cannot ship

⚠️ **The OSMF Tile Usage Policy was rewritten on 22 July 2026 — four days ago — and is now
materially stricter.** The comment at
[`MiniMap.tsx:18`](../../apps/mobile/components/MiniMap.tsx) says the policy *"discourages heavy
embedding"*. It now **prohibits**, under a heading literally titled *"Prohibited"*:

> ### 4. Prohibited: bulk downloading ("scraping") and offline use
> Bulk downloading is any pre-emptive fetching of tiles other than those a user is actively
> viewing. This includes … "Pre-seeding" large areas or multiple zoom levels in advance … Automated
> scans across wide bounding boxes, especially at high zoom (z≥14).

And the clause that blocks a native build outright:

> Many HTTP clients and SDKs use a generic User-Agent header (e.g. okhttp/x.y, … ). **Traffic that
> uses these defaults will be blocked** because we cannot identify or contact the actual application.
> … You must not: Use the library's generic default User-Agent. **Hide behind a generic proxy
> User-Agent** … **Strip Referer** on web traffic or tunnel all clients behind a single, anonymous
> identity.

RN's `<Image>` sends exactly those defaults on iOS/Android — and proxying through our Worker to fix
the UA trips the anti-proxy clause instead. Plus:

> **Commercial services, or those that seek donations, should be especially aware that access may be
> withdrawn at any point** … Access may be blocked without prior notice.

And plainly, from [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright):

> Although OpenStreetMap is open data, we cannot provide a free-of-charge map API or map tiles for
> third-parties.

### Two fixes worth doing *now*, before any vendor decision
1. **`MiniMap.tsx:211` renders `© OpenStreetMap` as plain text with no link.** The
   [Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) require
   making clear the data is ODbL, *"done by making the text 'OpenStreetMap' a link to
   openstreetmap.org/copyright"*. **Two-line fix.** (Also note the commonly-cited wiki URL for these
   guidelines now 404s; the live one is linked here.)
2. **`TILE_URL` is hard-coded at `MiniMap.tsx:26`.** The policy's "should" list says *"Avoid
   hard-coding the tile URL; allow switching without needing a software update."* Move it to config
   so we can repoint without an app release — which we'll want for the migration anyway.

---

## 8. If we go Protomaps instead — the numbers, measured not guessed

I ran a real extract against today's planet build rather than estimating:

```
pmtiles extract https://build.protomaps.com/20260725.pmtiles hk.pmtiles \
  --bbox=113.82,22.13,114.45,22.58
```

| | Size |
|---|---|
| **Hong Kong, z0–15** | **38.0 MB** |
| HK z0–14 | 19.0 MB |
| Full planet | 137 GB (HK = **0.028%**) |

Extraction took **18.6 s / 37 HTTP requests / 40 MB transferred**. At 38 MB the whole HK basemap sits
inside R2's 10 GB free tier — storage cost **$0.0006/month** — and is small enough to bundle into a
native binary for offline use later.

- **Cost $0–5/mo.** R2 egress is free; Workers free tier is 100k req/day. Protomaps' own
  [calculator](https://docs.protomaps.com/deploy/cost) models 10M tiles/mo at **$11.45 on
  Cloudflare** vs **$3,640 on Google Maps**.
- **Serve via the official Cloudflare Worker adapter** (`serverless/cloudflare` in the PMTiles repo),
  not `r2.dev` — Cloudflare's docs say `r2.dev` *"should only be used for development purposes"*, and
  range requests on a big object return `cf-cache-status: DYNAMIC` (uncached). The Worker gives
  edge-cached ZXY tiles. It must be on our own zone, not `workers.dev`, for the cache to work.
- **Dark mode is a real flavour**, not a filter: `@protomaps/basemaps@5.7.2` ships
  `light`/`dark`/`white`/`grayscale`/`black` as spreadable objects — `{...namedFlavor("dark"), …}` —
  which retires the `DARK_TILE_FILTER` invert hack at `MiniMap.tsx:35`.
- **Chinese labels verified in a real HK tile**, not just claimed: one z14 Hong Kong tile carries
  **759 distinct CJK strings** with both scripts present for the same features
  (`中國人壽大廈`/`中国人寿大厦`, `東區走廊`/`东区走廊`), via `name:zh-Hant` / `name:zh-Hans` keys.
  A single `lang=` param maps 1:1 onto `useLocale()`.
- **Native works since Jan 2025** — MapLibre Native reads `pmtiles://` in C++
  (iOS 6.10.0 / Android 11.8.0), and `@maplibre/maplibre-react-native@11.3.6` declares
  `expo >=54` / RN `>=0.80`, a clean match for SDK 56. This was the risk that would have forced a
  paid vendor; it's gone.
- ⚠️ **Gotcha:** the Protomaps glyph server has **no Han glyphs** (the CJK Unified Ideographs range
  returns 39 bytes, empty). MapLibre solves it client-side — leave web's `localIdeographFontFamily`
  at its default, set `MLNIdeographicFontFamilyName` (iOS) / `localIdeographFontFamily` (Android).
- ⚠️ **Gotcha:** maplibre-native OOMs if a Range request is answered `200` instead of `206`. R2
  returns `206` correctly — just don't let a Worker collapse it. Also `pmtiles://asset://` crashes on
  Android, and PMTiles sources don't work with MapLibre **offline packs** yet.
- **Bridge option:** the Protomaps **hosted API at $14/month** covers commercial use to 1M
  tiles/month with byte-identical tiles and an explicit no-lock-in promise — cheaper than any
  commercial vendor, and migration to our own R2 is a URL change.

### Vendors ruled out
- **CARTO** — the widely-copied `basemaps.cartocdn.com` Positron/Dark Matter URLs are **not** free
  any more: *"access to CARTO's basemap tile services is restricted to CARTO enterprise customers
  and Non-Profit GRANTS only and is not available for free public use."* The *design* is CC-BY, so we
  could reimplement that cartography on our own tiles with a credit.
- **MapTiler / Stadia / Jawg** — all three **forbid commercial use on the free tier**; first paid
  tiers $30 / $20 / €250 per month.
- **Mapbox** — logo can never be removed (fights golden rule 4), and the Oct 2025 "Qualified
  Renderer" terms make MapLibre compatibility unclear.
- **OpenFreeMap** — genuinely unlimited and commercial-friendly, but donation-funded with no SLA;
  same structural fragility as OSM's tiles with friendlier terms. Reasonable emergency fallback.
- **Thunderforest / AWS Location** — commercial-OK but no language parameter / free tier expires
  after 3 months.

---

## 9. Open questions

**Q1 is no longer a blocker** (see the status note at the top): we take the raster path, so nothing
here gates starting the migration. Remaining, in priority order:

1. 🔴 **Can Streetscape 360 be used without their JS SDK?** Is there a coordinate → panorama-id
   lookup, and is the `.pano` format renderable in React Native? Email `3dmap@landsd.gov.hk` to
   request the key and ask both. **This is the one live blocker** — it decides whether ADR-050's
   inline panorama is buildable or whether the Google deep link remains the whole feature.
2. 🟡 **Confirm the 2006 royalty page is superseded** for API data — one email to
   `mapapi@landsd.gov.hk`. Cheap, and removes the only real legal ambiguity in ADR-049.
3. 🟢 **Dark mode.** The raster service has no dark variant, so the existing `DARK_TILE_FILTER`
   CSS-invert hack stays for now. If we want a true dark map, either script a recolour of the
   813-layer vector GL style or take the Protomaps fallback. Not urgent.
4. 🟢 **Vector zoom ceiling.** Docs say z9–15 but the style's source declares `maxzoom: 19`. Only
   matters if we move to vector — the raster path reaches z20 and our mini-map sits at z16–17.
5. 🟢 **Never researched:** Mapillary / KartaView terms and real HK coverage. The two agents covering
   them hit a session limit. Moot unless both Streetscape 360 and the Google deep link fall through.

## 10. Suggested sequencing

| Step | Work | Blocked on |
|---|---|---|
| 0 | OSM attribution link + `TILE_URL` → config | nothing — **do now** |
| 1 | Street View **deep-link** button on Place/Stop detail | nothing |
| 2 | Repoint `MiniMap` raster at **LandsD Topographic + Map Label `{lang}`**, Worker-cached (12 h TTL), logo + notice on the map face | nothing |
| 3 | Spike Q1 (dark restyle) and Q2 (Streetscape 360) | — |
| 4 | Interactive map: MapLibre + whichever source wins Q1 | Q1 |
| 5 | Bonus: pedestrian routing for honest walk times; district names from Search Nearby | HK80 conversion in `@nextbus/core` |

Steps 0–2 are small, unblock nothing, and take us from *"ships something we're not licensed for"* to
*"ships the government's own map, in the rider's own language, for free."*

---

## Sources

**LandsD / CSDI** — [API list](https://portal.csdi.gov.hk/csdi-webpage/apilist) ·
[Terms & Conditions](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC) ·
[Topographic](https://portal.csdi.gov.hk/csdi-webpage/apidoc/TopographicMapAPI) ·
[Map Label](https://portal.csdi.gov.hk/csdi-webpage/apidoc/MapLabelAPI) ·
[Vector Map](https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapAPI) ·
[Vector Map Label](https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapLabelAPI) ·
[Streetscape 360](https://portal.csdi.gov.hk/csdi-webpage/apidoc/streetscape-360-api) ·
[Location Search](https://portal.csdi.gov.hk/csdi-webpage/apidoc/LocationSearchAPI) ·
[Search Nearby](https://portal.csdi.gov.hk/csdi-webpage/apidoc/SearchNearbyAPI) ·
[3D Pedestrian Route Search](https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-pedestrian-route-search) ·
[FAQ](https://portal.csdi.gov.hk/csdi-webpage/info/FAQ) ·
[LandsD open data](https://www.landsd.gov.hk/en/spatial-data/open-data.html) ·
[official OpenLayers sample](https://api.hkmapservice.gov.hk/mapapi/sandbox/demos/osm84olbasemap-en.html) ·
[2006 copyright page](https://www.landsd.gov.hk/en/resources/mapping-information/mapping-teaching-resources/copyright.html) ·
[3D maps territory-wide, Mar 2025](https://www.info.gov.hk/gia/general/202503/27/P2025032700173.htm) ·
[data.gov.hk terms v1.2](https://data.gov.hk/en/terms-and-conditions)

**Google** — [ToS](https://cloud.google.com/maps-platform/terms) ·
[Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) ·
[pricing SKUs](https://developers.google.com/maps/billing-and-pricing/pricing) ·
[March 2025 changes](https://developers.google.com/maps/billing-and-pricing/march-2025) ·
[Street View policies](https://developers.google.com/maps/documentation/streetview/policies) ·
[Street View metadata](https://developers.google.com/maps/documentation/streetview/metadata) ·
[Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)

**Protomaps / OSM / vendors** — [Protomaps docs](https://docs.protomaps.com) ·
[flavors](https://docs.protomaps.com/basemaps/flavors) ·
[localization](https://docs.protomaps.com/basemaps/localization) ·
[Cloudflare deploy](https://docs.protomaps.com/deploy/cloudflare) ·
[cost calculator](https://docs.protomaps.com/deploy/cost) ·
[maplibre-native PMTiles PR #2882](https://github.com/maplibre/maplibre-native/pull/2882) ·
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) (rev. 2026-07-22) ·
[OSM Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) ·
[CARTO basemap licence](https://github.com/CartoDB/basemap-styles)
