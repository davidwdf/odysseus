# 06 — Maps & Route Geometry

> **Proposal, nothing built.** Written 2026-08-22 off [`research/07`](../research/07-route-geometry-and-maps.md)
> and [ADR-151](../08-decision-log.md#adr-151--the-route-line-geometry-we-said-hong-kong-did-not-publish-has-existed-since-2021),
> which found that the Transport Department has published road-following route lines since 2021 and that
> our record said otherwise.
>
> Six asks from the owner: **draggable/zoomable maps** with **swappable providers**, **route polylines**
> (per-route on demand), **live user location**, **camera follows the stop list**, and — nice to have —
> a **map ⇄ street view** toggle. Plus: rethink the route-detail interaction, because the action sheet
> may be in the wrong place once a map is on screen.
>
> §§1–7 are the build. **§8 is the UI brainstorm** and is the part that wants an opinion before
> anything is written. Interactive mockups: [`mockups/route-detail/`](./mockups/route-detail/).

---

## 1. What we have, honestly

`MiniMap` (both renderers) is a **hand-composited grid of `<img>` raster tiles**. It does not drag, zoom,
rotate or animate. It draws pins from `PlaceDetailView.pins` and nothing else. The projection maths is
`@nextbus/core/mercator`, pinned by `mercator.spec.json` and shared by all three platforms — that part is
good and survives everything below.

`TileSource` (`packages/ports/src/tile-source.ts`) is a genuinely well-built port, but it answers **"what
is the URL of one tile"**. That is the right question only while *we* composite. Every interactive engine
composites for you and wants a **style** or an **archive** instead. So the seam has to widen — and the
widening is the whole of the owner's "swap providers without too much trouble" ask.

Route detail today is a **schematic rail**, not a map: `RailBus` is `{kind:'node', index}` or
`{kind:'segment', from, to}` (ADR-093). That is deliberate and stays — see §8.

---

## 2. The provider seam — `MapProvider` alongside `TileSource`

**Recommendation: adopt MapLibre as the engine, and make the basemap a declared provider.** MapLibre is
the only engine covering web *and* native from one style definition:

| Package | Version (checked 2026-08-22) | Note |
|---|---|---|
| `maplibre-gl` | 6.5.0 | `apps/web` |
| `@maplibre/maplibre-react-native` | 11.3.6 | peer `expo >= 54`; ours is `~56.0.12` ✅. Config plugin → **dev client**, not Expo Go |

Crucially, **adopting MapLibre does not mean leaving the Lands Department.** MapLibre renders a raster XYZ
source as happily as a vector one. LandsD becomes the `raster` source inside a style *we* own; Protomaps
becomes a later one-file swap if it earns it. That is what makes ADR-049 survive this proposal intact.

```ts
// packages/ports/src/map-provider.ts  — sketch, not final
export type MapProvider<LocaleId extends string = string, ImageAsset = unknown> = {
  id: string
  attribution: TileAttribution<LocaleId, ImageAsset>   // reused verbatim from TileSource
  minZoom: number; maxZoom: number
  invertForDark: boolean
} & (
  | { kind: 'raster-xyz'; basemap(z,x,y): string; label?(z,x,y,locale): string }  // ← today's LandsD, unchanged
  | { kind: 'vector-style'; styleUrl: string; labelOverlay?: RasterLabelLayer }   // ← Protomaps, MapTiler, …
)
```

Three things this shape buys, and they are the reasons to prefer it over a bare `styleUrl`:

1. **`TileSource` is not thrown away** — the `raster-xyz` arm *is* today's interface, so `MiniMap` keeps
   working unchanged during the migration and the LandsD implementation is re-used, not rewritten.
2. **Attribution stays a required member.** It is licence compliance, not decoration, and the existing
   port already got that right.
3. **The label overlay stays orthogonal to the base.** [`proposals/02 §11`](./02-basemap-and-street-imagery.md)
   found that hkbus puts **LandsD's label raster over an OSM base** — their style has *zero* `symbol`
   layers. So per-locale labels are independent of which base sits underneath, and switching base never
   touches localization. This is the single most useful thing we learnt from reading their map.

**Open question for the owner:** whether the vector base is worth it *at all*. Trade, stated fairly —
LandsD carries surveyor's detail (footbridges, subways, landmark buildings) that OSM does not; Protomaps
gives rotation, pitch, real dark mode and smooth zoom, but hkbus's implementation blocks all tiles for
5–30 s on a first visit while it downloads a 29.6 MB archive. **Prettier and less useful is a real
possibility.** The plan below deliberately does not require choosing: rows M1–M3 ship on LandsD raster,
and the provider swap is a later, cheap experiment.

### 2a. Two things measured while building the mockups

**The map looks pixelated, and that is our fault, not LandsD's.** Verified 2026-08-22 against their
service: they serve **256×256 tiles only**, and `@2x`, `?dpi=2` and a `basemap_hd` path all return
nothing. On a DPR-2 screen a 256 px tile drawn at 256 CSS px is upscaled 2× — exactly the softness we
see. **The first fix needs no new data source:** request one zoom level deeper and draw the tile at half
size, for true 2× density. It works up to z19 (their max is 20) and costs 4× the tile requests — cheap,
since tiles are 3–19 KB and the Worker already caches them.

**But overzooming everything makes the labels half-size**, which is worse than the softness it cures:
LandsD bakes label size into the raster, so a z17 tile shown at z16's scale has z16's ground coverage
with z17's *denser, smaller* label set. Measured on the mockup, it is a clear regression in legibility.

**The fix that works is to overzoom the base and NOT the labels** — base from z+1, labels from z, drawn
as two independently-zoomed grids. Roads, coastlines and building footprints get true 2× density (they
carry no text, so nothing shrinks), while place names stay exactly the size the cartographer intended.
**This is only possible because LandsD publishes labels as a separate service**, which is the same
property ADR-049 already relies on for per-locale labels — the overlay is now earning its keep twice.
`round-2.html` has all three modes side by side.

The residual: the label layer is still 1× on a 2× screen, so text is sharp-*ish* rather than sharp. The
only way to get both is client-rendered text — i.e. a **vector** basemap, where labels are drawn at
device resolution at any size. That is a real, concrete argument for the Protomaps option that §2 left
open, and the first one that is about legibility rather than aesthetics.

**MapLibre handles the raster half for us** via `tileSize` on a raster source, and the vector half by
definition — a third argument for the engine.

**Do not put world coordinates in CSS.** Positioning tiles at their absolute world-pixel offset works at
low zoom and tears at high zoom: at z17 a world coordinate is ~2.7×10⁷, and Chrome serialises a CSS
length that large in exponential form with about six significant figures (`2.74181e+07px`), so tiles that
belong 256 px apart land 200–300 px apart. Subtract the grid origin in JavaScript, where the value is
still a double, and put only the sub-tile remainder on the layer transform. Recorded because it is
invisible until someone zooms in, and because any hand-rolled tile layer on any platform hits it.
MapLibre does not.

---

## 3. Route polylines — per-route on demand (the owner's preference, and it holds up)

Verified: `…/FeatureServer/0/query?where=ROUTE_ID=1001&outFields=*&returnGeometry=true&outSR=4326&f=geojson`
returns **both directions of KMB route 1 in 33 KB**. Truncated to 5dp and gzipped that is **4 KB**.

**It goes through the edge, not the client.** Three reasons, all of which are existing rules rather than
new opinions: rule 2 forbids a view knowing a URL; `check-view-transport-free` would catch the literal
anyway; and the Worker is where caching and attribution compliance already live for tiles (ADR-049). So:

```
GET /v1/route/:id/path   →   { path: [[lng,lat], …], trimmedTo: {from, to}, source: 'csdi', quality: 'surveyed' }
```

with a long `Cache-Control` — this data moves biweekly. The response is a *resolved, trimmed* line, not
raw CSDI: **the resolver is a kernel decision and must not be re-implemented per renderer** (ADR-068/069,
and `check-no-derivation` would flag it).

### 3a. The resolver — this is the part with teeth

Two traps, both measured in `research/07 §4`, both of which will silently produce a wrong-looking map:

**`ROUTE_SEQ` is not a direction.** hkbus flag it (their issue #14) and it swaps some routes. Their fix
compares each line's *first vertex* to each direction's *first stop* by haversine with a 500 m guard —
one point deciding a whole route, at Hong Kong termini where both directions board within 40 m.

**Use all the evidence instead:** score a candidate by the **mean distance from every one of the rider's
ordered stops to the nearest point on the line.** Measured on KMB 101 — correct direction **8.6 m**,
reverse **41.9 m**, wrong route **432 m**. A 5× and a 50× separation.

**Then trim.** That metric provably *cannot* separate a short-working from its parent (KMB 101's two
variants both score 8.6 m — a short-working's stops all lie on the parent's line). The answer is not a
better score, it is a different final step: pick by coverage, then **cut the line at the projections of
the rider's own first and last stop**. Circulars, short-workings and variant ambiguity all collapse into
one code path, and no line can draw a tail past the terminus on screen.

```
resolveRoutePath(route, candidates):
  scored ← [(meanStopToLine(route.stops, c), c) for c in candidates]
  best   ← min(scored)
  if best.score > REJECT_THRESHOLD: return none      # guards the name-match fallback
  return trim(best.line, at: project(route.stops.first), to: project(route.stops.last))
```

`REJECT_THRESHOLD` **must be pinned by a corpus, not chosen by eye** — good scores cluster under 10 m and
the observed bad one was 432 m, so the gap is wide, but that is exactly the kind of constant that rots.
This belongs in `packages/core` with fixtures, next to `mercator.spec.json`.

### 3b. Coverage, and the fallback question

93% on `gtfsId` alone; **96%** if we also match on operator + route number (which is what makes the
resolver's reject threshold load-bearing). The prerequisite for any of it: **retain `gtfsId` for
KMB/CTB/NLB in `dataset.ts`** — the field exists on the entry type and is currently GMB-only.

**Measured once it shipped (2026-08-26, ADR-155): ~97%, and it is uniform across operators.** Over 40
sampled route-directions each, KMB resolved 37/40, CTB 39/40 and **GMB 40/40** — the CSDI dataset covers
green minibus routes, which nothing above says and which is the more useful half of the correction. GMB
is the operator with no route-level ETA board, so it is where a map earns the most. Of the four routes in
a 120-route sample with no line at all, one (`KMB R215`, 34 stops at a 433 m mean gap) is dense enough to
sketch and three are not — so **both fallback arms fire on real routes**, which is the thing a threshold
has to be true of before it is worth having.

---

## 4. Live user location

The port already exists — `packages/ports/src/location-provider.ts`, one of the seven — and Nearby
already consumes it through the location controller in `packages/api-client`. So this is **wiring, not
architecture**: the map subscribes to the same controller Nearby uses, and draws a dot.

Three things worth deciding rather than defaulting:

- **Accuracy is data.** Draw the accuracy radius, not a confident dot. This is rule 3 applied to
  position: a 60 m GPS fix rendered as an 8 px dot claims a precision we do not have — the same error as
  a per-second countdown.
- **Permission is a state, not an error.** `denied` / `prompt` / `granted` / `unavailable` need declared
  projections in the screen spec, or they will be handled twice and differently.
- **A hidden tab does not move.** Browser verification is already known to be limited here (the driven
  tab is hidden, so no scroll/IntersectionObserver events); location on the web will need the same care.

---

## 5. The missing-geometry fallback — decide, don't inherit

hkbus draws a **straight line through the ordered stops**, unmarked, whenever geometry is missing *or any
fetch fails* (`useRoutePath.tsx`, quoted in `research/07 §3`). For CTB `20R` that is four stops over
7.6 km — three chords across Kowloon Bay. For KMB `101R` the line runs through the harbour.

Under rule 3, shipping that unmarked is the cartographic twin of a fake countdown. Four options:

| | Behaviour | For | Against |
|---|---|---|---|
| **a** | **No line.** Pins only, plus a sentence. | Cannot lie. Cheapest. | Loses a useful shape on 7% of routes; a rider may read "no line" as "no data at all". |
| **b** | **hkbus's line, unmarked.** | Matches what riders see elsewhere. | Draws buses over water. Fails rule 3. |
| **c** | **Dashed//tinted line + one sentence** ("approximate path — stops shown in order"). | Honest *and* useful; reuses the `FeedNotice` pattern of saying it once per screen. | A dashed line is still a line; some riders will not read the notice. |
| **d** | **(c), plus snap to roads later.** | Best ceiling — TD's Road Network 2nd-gen or OSM could make the 7% real. | Whole extra pipeline. Not now. |

**Recommendation: (c), with (a) as the honest fallback when the route has too few stops for a chord to
mean anything** (`20R`'s four stops is exactly that case). It matches how ADR-133/150 already handle a
degraded feed: one sentence, screen-level, said once. And it keeps the door open for (d).

---

## 6. Camera follows the stop list

The owner's *"not quite sure how this would go"* is the right instinct — this is the ask with the most
ways to feel wrong. What we already know from this codebase:

- **The scroll-spy exists.** Place detail already lights the pin for the pole the list is scrolled to,
  and a tap on a pin scrolls the list back (ADR-086/087). This is the same mechanism, pointed at a
  camera instead of a highlight.
- **hkbus's camera flight is bare `map.flyTo({ center })`** — MapLibre's default curve arcs out and back
  in for free. The only authored part is that *a new stop animates and a new route jumps*
  ([`proposals/02 §11`](./02-basemap-and-street-imagery.md) (c)). Steal exactly that.
- **`reanimated` v4's `scrollTo()` is a no-op on web** (known; use the `scrollToY` helper). Any
  list↔camera coupling has to route through the existing helper on the RN side.

**The failure mode to design against is the feedback loop**: camera moves → map fires a move event →
something scrolls the list → camera moves. Whatever ships needs a single owner of "who moved last", and
user-initiated pans must **suspend** following rather than fight it. A "recentre" affordance that
reappears once the rider has panned away is the standard answer and the one to copy.

> **Superseded by §6b (2026-08-26).** The scroll-spy was cut, so there is no loop to arbitrate. The
> paragraph above is kept because the analysis is still correct *if* anything ever couples the two again
> — but nothing does today, and the camera that survived moves only on a tap.

---

## 6b. Settled (2026-08-26) — what the camera does, and what marks the rider

The owner's answers to the two questions §6 left open. Recording them so M5 and M7 can be built against
a decision rather than re-argue one.

### M6 is closed, and the camera it worried about is not

**The scroll-spy is gone** — §8d cut it after building and demonstrating it, because a camera chasing the
scroll read as finicky in use. That removes the feedback loop this whole section was written around: if
scrolling never moves the camera, there is no loop between them, no "who moved last" to arbitrate, and no
pan-to-suspend to design.

**What is *not* removed is the camera itself.** The map must still pan and zoom to a stop when the rider
makes it the focus — that is §8d's *"tap a stop row focuses it on the map"* — and to the rider's own
position when M5 lands. The distinction that matters:

| | |
|---|---|
| **Scroll-driven camera** | Cut. The rider did not ask for it, and it moved on every flick. |
| **Focus camera** | Kept, and it is **M7's**. A tap is a request; answering it is not a loop. |

`flyTo` for a new stop on the same route and a `jumpTo` for a new route, which is the distinction
`proposals/02 §11` (c) already identified and the one hkbus relies on. Pan-to-suspend and a recentre
affordance are **not needed for focus** — a rider who pans after tapping has simply looked elsewhere, and
nothing is going to move the camera again until they ask.

### M5 draws a dart when it knows the direction, and a dot when it does not

The rider's own position is one mark with two forms, and which one appears is a claim about what we know:

| | |
|---|---|
| **Dart** | Preferred. Only where a **heading** is actually available, pointed along it. |
| **Dot** | The fallback, and not a lesser one — it is the honest mark for *"here, facing unknown"*. |

This is ADR-008 applied to cartography, and the same rule as the dashed line one section up: a dart is a
*direction claim*, and a dart pointing north because north is the default is the same class of lie as a
client-side countdown. A rider orienting themselves at a bus stop will trust it.

**Heading is more conditional than it looks, and that is the design constraint.** Two sources, neither
reliable: `GeolocationPosition.coords.heading` is the *course over ground*, so it is `null` when stationary
and is exactly what a rider standing at a kerb produces; `DeviceOrientationEvent.webkitCompassHeading` is a
true compass but needs an explicit, gesture-triggered permission on iOS 13+ and is absent on most desktop
browsers. So the dot is not an edge case to tidy away later — **it is the common case on a stationary
phone**, and the dart is the enhancement.

**Precedence, settled: compass → course → dot.**

1. `webkitCompassHeading` where it is available and permitted. It answers *"which way is the rider
   facing"*, which is the question someone standing at a kerb is actually asking.
2. `coords.heading` otherwise, when it is non-null. It answers *"which way are they moving"* — a
   different question, and a good enough answer while they are moving, which is the only time it has one.
3. The dot. Not a failure state; the correct mark for a position with no direction attached.

The order is worth stating because the fallback is the *weaker* signal rather than the more common one —
so a rider who grants compass permission and then stands still keeps a dart, where course-over-ground
alone would drop them back to a dot the moment they stopped walking. Which source produced a heading
should not be visible to the rider: both are the same claim (*this is the way you are facing*) at
different confidences, and drawing two darts would be inventing a distinction they cannot act on.

Both go behind the existing `LocationProvider` seam; whether heading joins that port is M5's first
question. An accuracy radius rides with either form, since it is a claim about the *position* rather than
the direction.

---

## 8e. What M7 did not close (2026-08-26)

Recorded rather than left as a silence, because the gap is in the *spec* and a spec's whole value is
that it does not have silences.

**The `⋯` is declared and measured** — `stopActionsLabel`, a sibling repeat over the stops, projected
from its accessible name exactly as the bus tokens are. It got there by the owner dropping the parity
requirement: the control depends on there being a map to focus, `apps/mobile` has none, and the shared
spec cannot express "this control exists on one renderer". `apps/mobile`'s Route detail conformance
suite is deleted; the cost of that is written down in `docs/07`.

**The stop markers are not declared, and cannot be.** This one is environmental rather than editorial:
a marker exists only once MapLibre has a **WebGL context**, and every conformance suite in this repo
runs in jsdom, which has none — so a slot for them would be a claim no driver could ever satisfy. What
holds them instead is `route-markers.spec.json` for the rule (which glyph, which kerb) and browser
checks driven over CDP for the rendering. That is a weaker guarantee than a projection and it is the
honest one available; pretending otherwise would mean a suite that configures the environment away,
which is the failure ADR-123's sweep is named for.

**Also not built:** round 5's **bend avoidance** for the direction marks. The mockup slid each mark to
the straightest spot in its slot and dropped it if even that was a corner; MapLibre places symbols on
its own schedule and exposes no such hook, and the alternative is owning placement — which is the thing
the symbol layer exists to avoid. Its own collision handling covers the worst of it.

---

## 7. Street view — a nice-to-have gated on an email

LandsD's **Streetscape 360** is real, documented, and — unlike Google's — actually embeddable:
`https://data.map.gov.hk/api/3d-mms-data/{panorama}?key={key}`. Panorama locations ship as a downloadable
GeoJSON, so *"is there a panorama at this kerb"* is a spatial lookup we can precompute into the dataset
rather than a live call.

**A key is required. It is free but must be requested** — `3dmap@landsd.gov.hk`. The docs publish a
sample key, which is fine for a spike and not something to ship on. Google Street View is not an
alternative: its terms forbid caching *and* forbid placing it beside a non-Google map, so it can only be
a deep link out.

### What a spike found (2026-08-25) — the bill is far smaller than §7 first assumed

Tested against the published sample key. **Nothing here needs the Cesium SDK, and almost nothing needs
runtime access to LandsD at all.**

**The key works and is genuinely enforced.** HTTP 200 with a JPEG payload; 401 with no key and 401 with
a wrong one. It is a real credential published in their own docs for evaluation — fine for a spike,
not something to ship on.

**The `.pano` format is not proprietary.** It is an **8-byte header (big-endian length, then four zero
bytes) followed by a plain JPEG**. Verified across faces, tiles and two different panoramas: strip
eight bytes and you have an image any library can read.

**The tiles are a standard cubemap**, six faces `px nx py ny pz nz`, in a 2×2 grid per face, with two
pyramid levels:

| Level | Tile | Face | Whole panorama |
|---|---|---|---|
| `r0` | 128×128 | 256×256 | 24 requests, ~50 KB — a preview |
| `r2` | 1024×1024 | **2048×2048** | 24 requests, **~10.6 MB** — full quality |

(`r1`, `r3`, `r4` return 404. The level appears in both the directory and the filename and the two must
agree.) The live demo loads `r0` then upgrades to `r2`, which is where the pyramid was confirmed.

**So Cesium was never doing anything we need.** It is their 3D-globe viewer chrome. Assembling six
JPEG faces into a cubemap — or reprojecting to a flat crop — is ordinary image work.

### The two questions this raises, answered

**Can we proxy and cache to get past "100 concurrent users"?** Yes, and it is
[ADR-049](../08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)'s
pattern exactly: the terms permit caching and redistribution with attribution, so our Worker becomes
the only client LandsD sees and cache hits never reach them. But the owner's instinct goes further and
is better — **precompute at build time**. Then LandsD sees a *single sequential consumer* during
`dataset:build`, the concurrency limit stops being about our riders entirely, and at runtime we serve
our own R2 objects.

**Does that remove the need for the SDK?** Completely, and it removes more than that. If the build picks
the panorama nearest each stop, orients the view toward it and crops a still, then at runtime a street
view is **an `<img>`** — no panorama viewer, no WebView shim on native, no API call, no key on the
client, and full control over framing (which is where "avoid a lorry parked across the stop" would
live). The nice-to-have becomes genuinely cheap.

### The one real blocker, now precisely stated

**The panorama index has coordinates and no ids.** All 3,370,477 features carry an empty `properties`,
and the path (`…/20220204/r0/20220204G10799_py_r0_0_0.pano`) encodes a survey date and run number that
cannot be derived from a coordinate. Watching the demo's network traffic settles where the mapping
lives: **40 requests, every one a tile of a single hardcoded panorama — it never performs a lookup at
all**, so the mapping is not in the SDK's public surface either.

**That makes the email worth sending, and turns it into one specific question:** *the panorama-location
GeoJSON has empty properties — is there a version carrying the panorama id or path, or a documented way
to resolve a coordinate to one?* Everything else is now known and cheap. If the answer is no, the
honest fallback is a **deep link out** to their viewer and M8 closes at that; if it is yes, M8 is a
build-step and an `<img>`.

Worth asking in the same message, since it is cheap to ask and expensive to assume: whether
**5 GB/s and 100 concurrent** are per key or service-wide.

---

## 8. The interaction question — where the action sheet belongs

The owner's instinct is worth taking seriously: *"I quite like the action sheet … but now I wonder if
that's the right design flow."* Once a map is on screen, a stop row has **two** plausible meanings —
*act on this stop* and *show me this stop* — and one tap cannot mean both.

### The constraint nobody should discover late

**That sheet is the app's only favourite-creating affordance.** ADR-032 makes route-at-stop the unit of a
favourite; `RouteStopSheet`'s own doc comment records that `apps/web` once navigated straight to the
place instead, which left `toggleFavoriteRoute` with **zero callers** — a web-only rider could never fill
their Favourites tab. Four auditors found it; no gate did, because `conformStates` asserts text and
nesting and **never interaction destinations**.

So: *any* option that takes the tap away from the sheet must give favouriting a new, declared home, and
the spec cannot currently prove it. That is a real cost, not a detail — and it is the strongest argument
for the options that keep a visible, dedicated control.

### Four paradigms

|  | Tap a stop row | Long-press / overflow | Favourite lives | Feel |
|---|---|---|---|---|
| **A — Sheet stays primary** *(today)* | opens the sheet | — | in the sheet (unchanged) | Safest. But with a map on screen, the commonest wish ("where is that?") is two taps and a dismiss. |
| **B — Tap focuses the map, `⋯` opens the sheet** | flies the camera, selects the row | explicit `⋯` per row | in the sheet, reached by `⋯` | The owner's own suggestion. Direct manipulation; the map becomes the point. Cost: a per-row control on every row, and favouriting gets one step further away. |
| **C — Tap focuses, sheet moves to the header** | flies the camera | header ★ acts on *the selected stop* | one header control, retargeted by selection | Fewest controls, and the map reads as the subject. Risk: a header star whose meaning silently depends on selection is the kind of thing that reads fine to its author and confuses everyone else. |
| **D — Split row: body focuses, ★ toggles inline** | flies the camera | ★ on the row toggles directly; `⋯` only for the rest | **on the row, always visible** | Favouriting gets *closer*, not further — the ADR-032 risk inverts. Cost: two hit targets per row, so it needs real thought at 44 px and for a screen reader. |

**Recommendation: D, with B as the fallback.** D is the only one that makes the map primary *without*
weakening the affordance ADR-032 depends on, and an always-visible star is easier to declare in a spec
than a sheet action reached through an overflow. B is a perfectly good second choice and is closest to
what the owner described.

**Whichever wins, two things must land with it:** the chosen destination gets declared in
`route-detail.spec.json`, and — because `conformStates` cannot see interaction destinations — the gap
that let the original bug through gets closed or explicitly re-filed. Repeating that bug while
redesigning the very screen it happened on would be an unusually annoying way to lose a week.

### Mockups

Four clickable prototypes with the real animations —
[`mockups/route-detail/`](./mockups/route-detail/) (open `index.html`). They run on **KMB 1's real
geometry and real stops**, fetched live from CSDI, so the camera flights, the scroll-linked following and
the pan-to-suspend behaviour are all exercised against real data rather than a straight line.

### Round 2 — the owner's verdict, and what replaced it (2026-08-22)

**C and D are out. B leads, with a reservation.** The owner's reasoning, which reframes the problem:

- **D — dropped.** Two control columns per row is distracting, and other apps that do it read as cluttered.
  Decisive point: *"we may want to add other options later (e.g. notify me when the bus is approaching)"* —
  a per-row control set does not scale past about two actions.
- **C — dropped**, for the reason already stated against it.
- **B — preferred so far**, but *"I don't love the repeated menu icons."*
- **A — clean, but no easy way to find stops on the map."*

So the real constraint set is **(1) no permanent per-row chrome, (2) a one-tap way to see a stop on the
map, (3) unbounded room for future actions**. A and B each satisfy two of the three; nothing in round 1
satisfies all three. Two designs that do:

| | **E — the selected row expands in place** | **H′ — a floating stop card at the map seam** |
|---|---|---|
| Tap a row | camera flies **and** that row opens to reveal its actions | camera flies **and** a card appears over the bottom of the map |
| Chrome at rest | none | none |
| Room for actions | unbounded (the strip grows) | unbounded (the card grows) |
| Layout shift | **yes — the list moves** | **none — the list never changes shape** |
| Precedent | hkbus's `StopAccordion`; riders know accordions | Google/Apple Maps place card |

**Recommendation: H′.** Not because it is prettier but because of the one row in that table that
interacts with a feature already on the plan: **E shifts the list, and §6's scroll-linked camera means
selection changes while you scroll.** With E, following the list would open and close rows under the
rider's thumb. That can be forbidden — *expand on tap, never on scroll* — but it is a rule that has to be
held in two renderers and cannot be expressed in a spec, so it will eventually be broken. H′ has no such
rule to break, which is why it is safe to let scroll-spy drive the selection at all. It also names its
target, so it never inherits C's ambiguity.

**Pushing back on my own recommendation**, because two of these are real:

1. **H′ is a third surface.** Nav, list, and now a card — one more thing to keep identical across two
   renderers and to declare in `route-detail.spec.json`. E adds no new surface; it is a state of a row.
2. **It covers the map exactly where the selected pin is.** Solvable — offset the camera target by half
   the card's height, which the mockup does — but it is authored behaviour, not a freebie.
3. **A card that changes content as you scroll may read as noise.** Unproven either way. Worth watching
   for in the mockup before committing.

And one point *for* E that survives all of the above: if the map is small (the list-dominant shape),
H′'s card eats a serious fraction of it, whereas E's strip costs nothing that was showing map.

### Round 2 — the screen shape, and the "peek" idea

The owner's *"map as an inset, peeking through a layer of the chrome"* is worth taking literally: make
the **map the shell** and the stop list a sheet resting over it, with detents.

| Detent | Sheet top | Reads as |
|---|---|---|
| **List-dominant** | 62% | Almost exactly today's screen — map band on top, list below |
| **Half** | 42% | Camera flight finally *reads* as following; five or six stops still visible |
| **Map-first** | 20% | The map is the screen; the list peeks. Best for *choosing* a stop |

**Recommendation: ship list-dominant as the default and let the sheet be draggable.** The default must
stay close to today, because the job a rider opens this screen to do is *when is my bus*, not *where is
my bus* — map-first is the wrong default for the 90% case even though it is the nicest of the three to
look at. Making it a drag rather than a mode means nobody has to decide on the rider's behalf.

**The cost, stated plainly:** nested gestures — drag-the-sheet vs scroll-the-list vs pan-the-map — are
genuinely fiddly on React Native, and this is the one item in this proposal most likely to be
under-estimated. If it fights us, the fallback is a fixed map band with a two-state toggle, which loses
very little.

Both are in [`mockups/route-detail/round-2.html`](./mockups/route-detail/round-2.html), where the action
surface and the screen shape are **independent controls** so the combinations can be felt rather than
argued about.

---

### Round 3 — how this meets the collapsing header (2026-08-22)

The owner's attachment to the existing route header is worth honouring exactly: *"a large badge of the
route at the top and some additional information that collapses below on scroll"*, with a **floating**
back button and a floating header once collapsed — and the note that
[`apps/mobile/components/CollapsingHeader.tsx`](../../apps/mobile/components/CollapsingHeader.tsx)
(ADR-033) is closer to the intent than the `apps/web` twin.

**The good news is that the sheet model does not fight that header — it is what the header was built
for.** `CollapsingHeader`'s own doc says **"No bar background — the chrome floats over the scrolling
content."** Make the map full-bleed and the header floats over *the map* instead, which is the same
component doing the same thing over a nicer backdrop.

**The apparent conflict, and the resolution.** With a draggable sheet there are two vertical gestures
(drag the sheet, scroll the list) and only one header. Resolve it with **standard bottom-sheet
chaining**: an upward drag raises the *sheet* until it reaches the top detent, and only then does the
*list* begin to scroll. It is one continuous motion, so to a rider it still reads as *collapse on
scroll* — the behaviour the owner likes — while the three gestures stay cleanly separated:

| Gesture | Owns |
|---|---|
| Sheet position | how much map is visible, **and the header's collapse fraction `t`** |
| List scroll | which stop is selected (the camera follows) |
| Map pan | suspends following until recentre |

Three consequences worth writing down:

1. **`topSpacer` goes away, and that is a simplification.** Today the list must reserve the expanded
   header's height at the top of its scroll content. Once the header floats over the map and the list
   lives in a separate surface, the sheet's own top edge is what content scrolls under. One less number
   to keep in sync across two renderers.
2. **`RouteMeta` stays exactly where it is** — the first thing in the scroll content, scrolling away
   under the chrome. That is precisely *"additional information that collapses below on scroll"*, and it
   needs no redesign.
3. **The `H′` card and the collapsed pill never collide** — pill at the top, card at the map/list seam.

**Why the `apps/web` header "isn't quite right", concretely.** `apps/mobile` interpolates the morph
**continuously** off a Reanimated `scrollY` shared value. `apps/web` drives it from a **boolean**
`data-collapsed` attribute with a 200 ms CSS transition (`index.css`, `.collapsing-header[data-collapsed]`),
so it *snaps* between two states at a threshold instead of tracking the gesture. That is almost certainly
the difference the owner is feeling, and it is a fixable one: a CSS custom property updated on scroll
gives the DOM the same continuous interpolation. `round-3.html` has both, behind a **Continuous morph**
toggle, so the difference can be felt rather than argued about.

This is not a new ADR — ADR-033 already decided the header. It is a note that the header survives the map
shell unchanged, and that closing the web twin's continuity gap is a prerequisite for M3 rather than a
separate nicety.

---

### Round 4 — the owner's counter-proposal, which is better than mine (2026-08-22)

Round 3 was rejected on **layer count**, and the objection is right: map base · back button · header ·
list · action sheet is five stacked surfaces, and the action sheet lands on top of four things that are
already floating.

**The counter-proposal.** One **floating card** tucked behind the back lens, badge centred on the back
button's row, fare/frequency/journey-time/schedule *inside it*. **Any map drag or list scroll shrinks it
by width** into a pill — badge left, destination after. **Tap to expand.** Split starts 50/50.

Built as [`round-4.html`](./mockups/route-detail/round-4.html). Three things it gets right that round 3
did not:

1. **Width-collapse is a single transition, so renderer parity is cheap.** The round-3 badge-morph
   interpolated position *and* scale *and* cross-faded two labels — which is precisely why
   `apps/web`'s version drifted into a boolean threshold while `apps/mobile` interpolates continuously
   (§8, round 3). A card that changes *width* keeps badge and destination in one row that never
   re-flows. Both renderers can express that identically, and the ADR-033 parity gap stops being a
   thing we have to fix to ship the map.
2. **Binary + tap-to-expand is predictable.** Nothing re-expands under the rider's thumb, which was the
   unresolved risk in every scroll-linked variant.
3. **The facts move to where they are actually read.** Fare and frequency are *route* facts, and a
   route-level card is a more honest home for them than the top of a stop list.

**One addition was tried and rejected.** Once collapsed the card is a pill with no purpose, so it could
carry **the selected stop** — 4 layers instead of 5, measured. The owner rejected it and was right: an
action sheet is modal, so a mis-tap dismisses; a card that silently swaps its contents has no dismissal
ritual, and *"how do I get back to the fare?"* has no obvious answer. **The action sheet stays.** Recorded
because the layer-count argument was genuinely tempting and someone will propose it again.

### The settled header behaviour

After one more round, this is what `round-4.html` now does and what should be built:

| | Expanded (on landing) | Collapsed |
|---|---|---|
| Card left edge | `14` — tucks **behind** the back lens | `68` — steps **right**, clear of the lens |
| Card width | full (`W − 28`) | **still full** (`W − 82`), so the destination gets all the room there is |
| Content padding-left | `56` (clears the lens) | `15` — content shifts **left** |
| Badge | `48` px tall, `23` px type, centred | `28` px tall, `15.5` px type, left |
| Row height | `70` px — the taller badge pushes the destination clear of the back button | `48` px |
| Body (dest · sub · four facts) | open | folded |

Everything animates on one shared easing, and the whole thing is **`left` · `width` · `height` ·
`padding` · `min-width` · `font-size` · `max-height` · `opacity`** — all straightforwardly expressible in
both renderers, which was the point.

**Two findings from building it, both worth knowing before anyone commits:**

- **The pill shrinks less than you would hope, because Hong Kong destination names are long.** With
  *"towards STAR FERRY, HARBOUR CITY"* the collapsed card measured **341 px against an expanded 360 px** —
  a 19 px "collapse". It only becomes a real pill (**193 px**) once the label is the bare destination and
  is ellipsised at ~158 px. `CollapsingHeader` already exports a **`Marquee`** for exactly this problem,
  which is the existing answer and should be reused rather than re-solved.
- **Losing scroll-linked collapse also loses the "scroll back to the top and the header returns"
  reflex.** Restoring it costs one rule — *re-expand when the list is at `scrollTop === 0`* — which keeps
  the collapse binary while making the gesture feel two-way. It is a toggle in the mockup and I would
  ship it on.

---

## 8d. Settled (2026-08-25)

After five rounds, the route-detail design is fixed. Recording it as an outcome so M4/M7 can be written
against it rather than re-litigating.

**Interaction — this is option B from round 1, arrived at the long way round.** §8 recommended D, then
B as the fallback; the owner rejected both, we explored E, H′, the context card and a reuse-the-card
idea, and landed back on B. That is not wasted work — B was rejected in round 1 for *"repeated menu
icons"*, and it is acceptable now because everything around it changed: the map became the point of
the screen, so a tap that focuses the map is worth a permanent control, which it was not when the map
was a decorative band.

| | |
|---|---|
| **Tap a stop row** | Focuses that stop on the map. Nothing else. |
| **`⋯` on the far right of every row** | Opens the action sheet — Save · Notify me · Stop |
| **Tap a marker on the map** | Selects the stop and scrolls its row into view |
| **Scrolling the list** | Collapses the context card. **Does not change the selection.** |

**The scroll-spy is deliberately gone.** Letting the selection — and therefore the camera — chase the
scroll position was built, demonstrated and then cut: every flick of the list moved the map, which read
as finicky. Selection is now something the rider does, never something scrolling does to them. §6's
"camera follows the stop list" is answered by *tap*, not by scroll, and the loop-avoidance machinery
that row worried about is unnecessary as a result.

**Styling.** Neutral-dark line (`#33322F`) at medium width, dark mode simply **the inverted light
colour** — the chromatic alternatives (cyan, mint) are recorded below and are better chosen against the
app's real tokens than against a prototype · **double
chevron**, normal gap, **strict 10° bend avoidance** · smooth corners · hybrid markers at the largest
size, no halo, thin dark hairline on the outside edge · squares for termini, sized to match the circles
· hexagons for `BBI` stops · markers offset to the **left of travel**. Base tiles at z+1, labels at z.

**Two things this leaves for M4:** the `available: false` state still needs declaring in
`route-detail.spec.json` (§5's dashed approximation), and the whole styling set above needs to become
tokens rather than the literals the mockup uses.

---

## 8b. Build now, or keep refining? — split it

The design is not finished, but **most of this plan does not depend on the design**. Recommended split:

**Start building — none of it touches a screen spec:**

| Row | Why it is safe to start |
|---|---|
| **M0** `gtfsId` for KMB/CTB/NLB | A field that already exists on the entry type. Unblocks everything. |
| **M1** `resolveRoutePath` + corpus | Pure kernel. Both traps are measured (§3a); the corpus is the deliverable. Zero UI. |
| **M2** `/v1/route/:id/path` | Pure edge, verifiable by `curl`. Long-cached. |
| **M3** `MapProvider` seam + MapLibre on LandsD raster | Independent of every open question, and carries the §2a tile rules. |

**Keep in the mockup — all of it lands against `route-detail.spec.json`:** the context card, what a stop
tap does, and the detent set.

**The reason to split rather than wait** is specific to this repo: a screen spec is expensive to change
(ADR-083/084 — the spec, both renderers' drivers and the coverage control all move together), so writing
one against a design still in motion means churning it. M0–M3 have **no spec implications at all**.

**The reason to split rather than build everything** is that M3 adds `maplibre-gl` and
`@maplibre/maplibre-react-native`, and the native side needs a **dev-client build** — MapLibre is not in
Expo Go. That has a long tail of setup surprises, and it is much better to hit them while the UI is still
fluid than to hit them when it is the last thing blocking a release. (It does not make things worse:
Expo Go already cannot run this app on a physical device under SDK 56.)

**Suggested order:** M0 → M1 → M2 (each with its ADR), then M3 in parallel with continued header
refinement. Revisit the interaction rows once the mockup stops moving.

---

## 8c. What M3 owes before it is ready (2026-08-24)

M0–M2 are built. **M3 is not ready**, and the owner's list of what is missing is the substance of why.
Four of the five were reproduced in the mockup and fixed there, which is the cheapest place to find
out what the real thing has to do.

| Owed | Status | Note |
|---|---|---|
| **The line drifts against the basemap on zoom** | ✅ diagnosed + fixed in mockup | Measured **2.81 m per wheel event** — sub-pixel each time, so it only shows as accumulated drift. Cause: holding the camera centre as **lat/lng** means every zoom-about-a-point does two Mercator round-trips, and `log`/`exp` lose ~0.3 px each. Fix: hold the centre in **normalised Mercator units** and convert only for display; the same operation is then exact arithmetic. Verified **0 m drift over 40 wheel events**, zoom returning to exactly 14.0. |
| **Centring must use the *visible* centre** | ✅ implemented in mockup | The visible map is not the map element: the context card covers the top and the stop sheet the bottom, and with the card expanded at the 50/50 detent the visible band is only ~178 px of an 800 px screen. Every camera move now targets the inset rect. **MapLibre calls this `padding`** on `easeTo`/`fitBounds`, so this is one more thing the engine gives us rather than something to hand-roll. |
| **Map controls** | ✅ proposed in mockup | Zoom in/out · centre-on-me · fit-whole-route · centre-on-selected-stop · street view. Plus **attribution**, which is not optional chrome — LandsD's licence requires it on the map face, so it is a persistent chip that opens the full notice. Two deliberately *excluded*: a compass (only earns its place if rotation is enabled) and a basemap switcher (nothing to switch to until the vector question is settled). |
| **Street view button** | 🟡 blocked on an email | LandsD **Streetscape 360** can be embedded (§7); Google's terms forbid it beside a non-Google map. The free key must be requested from `3dmap@landsd.gov.hk`. The button exists in the mockup and logs its intent. |
| **Tile resolution** | ✅ settled | Base at z+1, labels at z (§2a). |

**Five more that the owner's list did not name and that M3 also owes:**

-4. **A map that captures the pointer swallows taps on its own markers.** The markers had a click
   handler and a generous hit target, and tapping one did nothing. Cause: the pan gesture calls
   `setPointerCapture()` on pointerdown, which retargets the whole gesture — **including the eventual
   `click`** — to the map element, so a listener on the marker never fires. Resolve the tap by
   hit-testing on `pointerup` instead: it works regardless of capture, and it lets the hit radius be
   whatever touch needs rather than whatever the glyph is. **A synthetic `dispatchEvent(new
   MouseEvent('click'))` fires the handler perfectly**, which is exactly how this passed a test and
   failed a finger — the test exercised the handler, not the interaction.

-3. **Never rebuild the list to change which row is selected.** Re-rendering `innerHTML` resets
   `scrollTop` to 0, which fires `scroll`, which re-runs the scroll-spy, which picks row 0, which
   rebuilds the list — an infinite loop, and the §6 list↔camera feedback in its most literal form.
   Selection is a class; treat it as one, and keep a rebuild for changes that alter the list's
   *content*. Also suppress the spy across any scroll the app itself caused, or it reads that motion
   as the rider's and fights it.

-2. **Never cache tile geometry on the tile *key set* alone.** The reported "path misaligns on
   two-finger zoom" survived the fix below, and this was the real cause. Tile `left`/`width` were baked
   into the markup, which is only rebuilt when the set of tile keys changes — but they were computed
   from `TS × scale`, and scale changes *continuously*. Inside one integer zoom level the keys never
   change, so the tiles kept the scale they were built at while the SVG overlay recomputed every frame
   and slid away from them. A trackpad pinch spends almost all its time between integer levels, which
   is why it showed up there and not on discrete wheel clicks. **Fix: the scale rides on the layer
   transform, never on the tiles** — tiles sit at a constant 256 px in the layer's own space, so their
   geometry is scale-independent. Verified at 0.000 px offset through a 60-step simulated pinch.
   MapLibre never has this problem; a hand-rolled layer always can.

-1. **Measure the viewport from ONE source.** `render()` used `mapEl.clientWidth` (integer CSS px) and
   the zoom handler used `getBoundingClientRect().width` (fractional). At 100% page zoom they agree, so
   nothing shows; under **trackpad pinch or browser page zoom** the rect goes fractional, the zoom
   anchor computes a different viewport centre than the renderer, and the route line walks away from
   the basemap. Reported as "the path misaligns on two-finger zoom" and reproduced exactly. Fixed in
   the mockup by using the rect everywhere. MapLibre owns its own viewport, so this is a hand-rolled
   hazard — but it is also a reminder that **any** measurement we feed a camera must come from one place.

0.5. **A shadow colour derived from one operator's accent is a bug waiting for the other three.** The
   mockup's route badge carried `box-shadow: … rgba(200,16,46,.34)` — KMB red — which put a red halo
   around the *green* GMB badge. Trivial, and exactly the class of thing that survives review because
   nobody opens a GMB route. Operator-derived colour belongs on the fill, never baked into a shared
   shadow.

0.7. **The route line needs a light/dark PAIR, and `BRAND.ink` is documented not to be one.** Dark mode
   does not restyle the map — it applies `invert(1) hue-rotate(180deg) brightness(1.2)` to the raster,
   and `MiniMap.tsx` is explicit that it is "applied to the tiles only — the pin and attribution sit
   outside it". So the overlay keeps its true colour while the map behind it flips. A **neutral dark
   line is excellent on the light map and nearly invisible on the dark one**, and the same goes for the
   casing: white separates the line from a light map and nothing from a dark one. Whatever colour wins
   therefore needs two values, which rules out reusing `BRAND.ink` (`#111827`) — that token exists
   precisely because it is *"theme-independent … does not invert with the appearance"*.

   **Resolved in round 5: the tiles invert by filter, the overlay inverts by design.** Every route-line
   colour now carries a light/dark pair, and the markers swap with it — fill and border trade places,
   so a white-filled stop with a dark border becomes a dark-filled stop with a light border. Direction
   marks are drawn in the *casing* colour, so they follow for free. Verified: line `#33322F` →
   `#E9E7E2`, stop fill `#FFFFFF` → `#0B0B0C`, stop border `#33322F` → `#E9E7E2`, hairline `#33322F` →
   `#E7E5E0`. The rule for M3: **anything drawn over the map needs a pair, and the casing is what
   separates it from the map in either mode.**

   **And the dark line is a separate choice, not a tint of the light one.** Inverting the tiles does two
   things that constrain it: LandsD's black label text becomes **white**, so a near-white line reads as
   one more label rather than as the route; and the yellow road fills become **warm tan**, so an amber
   line collides with the road network — the *same* mistake CTB's yellow makes on the light map, which
   I duly made again in the opposite direction before looking at it. **Cyan** sits furthest from both
   and is the cleanest of the chromatic options; **mint** is the near alternative. The mockup
   nonetheless defaults to the plain inverted colour: this is a decision to take against the app's real
   tokens, not against a prototype, and the alternatives are recorded here so the work is not redone.

1.1. **Hong Kong stops belong on the LEFT of the direction of travel, and the data agrees.** Traffic
   drives on the left and riders board on the left, so a stop is on the left-hand kerb. Measured on
   KMB 1 by projecting each stop onto its route line: of the 19 stops whose coordinate is offset from
   the line at all, **19 are on the left and 0 on the right** (the remaining 6 lie within 1.5 px of the
   line at z15). The median offset is only **2.2 px at z15** — a few metres — so the true offset is
   nearly unreadable at normal zooms anyway. Draw the marker at a *deterministic* left-hand offset
   derived from the line width instead: it makes the side legible at all, and one noisy coordinate
   cannot flip a marker onto the wrong kerb. This is ADR-080's question answered by cartography.

   **The bug worth remembering:** the side *test* used the normal `(ty, -tx)` and the *placement* used
   `(-ty, tx)`. Every marker therefore landed on the far kerb — and because the error was uniform, the
   markers looked perfectly consistent while being consistently wrong. Nothing catches that but
   checking the drawn output against the direction of travel, which is now done by reading the marker
   centres back out of the DOM rather than by re-running the formula that produced them.

1.0. **Space direction marks BETWEEN STOPS, not at a fixed interval.** Fixed spacing put chevrons on
   top of stop markers and bunched them where stops are close together. Placing one mark between a
   short pair of stops and two between a long pair follows the rhythm a rider is already reading, and
   keeps a guaranteed clearance from every marker — measured at **15.7 px** minimum, from ~0 before.

0.9. **Place marks along a line by ARC LENGTH, not at its vertices.** Direction chevrons were drawn at
   polyline vertices and rotated by the local segment — so they bunched where vertices were dense,
   thinned where they were sparse, and drifted off the line at curves. Two causes: survey vertices are
   unevenly spaced, and once the path is smoothed the vertices are not even *on* the drawn curve.
   `getPointAtLength()` on the rendered path is the browser's own answer to "where is this curve at
   distance L" — spacing becomes exact, and a double or triple chevron stays on the curve because its
   siblings are offset **along the arc** rather than along a straight tangent. Measured on KMB 1:
   worst deviation **0.08 px** over a 4,603 px path, from several px before. MapLibre's `symbol` layer
   with `symbol-placement: line` does this natively — one more thing not to hand-roll.

   **A multi-part mark is ONE glyph with one heading.** The double chevron initially placed each half at
   its own arc position, so each took the tangent *there* — and on a bend the two splayed apart and
   stopped reading as a single mark. Place the glyph once at its centre, rotate once, and offset the
   parts inside the glyph's own frame. The cost is that on a very tight curve the outer part sits a
   fraction off the line; at a ≤10 px separation that is sub-pixel to about a pixel, and far less than
   the splay it replaces.

   **And a direction mark must not straddle a corner.** A glyph placed on a bend points along neither
   leg of it — KMB 1's sharpest corner is **124°**. Each mark now measures the heading change across
   *its own footprint*, slides along its slot to the straightest reachable spot, and is **dropped
   entirely** if even the best position is still a corner: a missing mark costs nothing, a misleading
   one costs trust. Measured on the whole route, worst bend under any placed mark:

   | Zoom | No avoidance | 20° threshold | Marks kept |
   |---|---|---|---|
   | z14.6 | 38.2° | **16.7°** | 9/9 |
   | z15.4 | 67.7° | **8.0°** | 25/26 |
   | z16.2 | 49.2° | **8.0°** | 39/39 |
   | z17 | 26.4° | **7.0°** | 48/48 |

   Sliding does almost all the work — one mark is dropped across four zooms. Note for whoever measures
   this next: locating a glyph by scanning the path from the DOM gives garbage near a corner, because
   that is exactly where a small arc-length error becomes a large heading error. Record the value at
   placement time instead.

0.8. **A stop's offset from the route line is information, not error.** The stop coordinate is the
   **kerb**; the line is the **road centreline**; the gap between them is *which side of the road you
   wait on*, which is the whole subject of ADR-080. Snapping markers onto the line looks tidier and
   destroys that. The best answer came from the owner: **snap the marker to the line but on the side the kerb
   is actually on** — project onto the line, then step out along the *normal* toward the real
   coordinate. It sits as tidily as a centre-snap and still says which side of the road to wait on. A
   circle keeps it consistent with every other stop, which is why it beats a half-on/half-off pill.
   All four modes are switchable in `round-5.html`.

0. **The operator accent cannot always be the line colour.** `OPERATOR_ACCENT` is
   KMB `#D7282F` · LWB `#E8A33D` · CTB `#F6C700` · GMB `#00845C`. **CTB's is the same yellow LandsD
   uses for major roads**, and a CTB route drawn straight in it is close to invisible; LWB's amber has
   a milder version of the same problem. Colouring the line by operator is right — it matches the pins
   and ADR-015's liveries — but it needs a **map-safe variant per operator**: same hue, darkened until
   it holds against the road fills. That is the map's analogue of `OPERATOR_ACCENT_TEXT`, which already
   exists because the yellow accent broke contrast on chips. Compare them in `round-5.html`.



0. **A non-finite value must never reach the camera.** Found the hard way in the mockup: `fitRoute(ms: 0)`
   fell into the easing, where `(t0 - t0) / 0` is `0/0` — **`NaN`, not `Infinity`**, so it did not clamp
   to the end of the flight, it poisoned `cam.u/v`. Every projected point derives from those, so one
   bad value became ~10,500 `<circle cx="NaN">` errors a second and a blank overlay. Two guards, both
   cheap: reject a non-finite target in the camera-move function, and refuse to draw a frame from a
   non-finite camera (warn once instead). Worth stating as a rule because MapLibre will not save us
   here — a `NaN` handed to `easeTo` is still ours to have produced.


1. **Geometry simplification per zoom.** CTB 11 outbound is **2,747 vertices**. At z12 the whole route
   is a few hundred pixels wide and most of those vertices are sub-pixel. Douglas–Peucker per zoom
   band is the obvious answer; nothing does it yet, and it should be decided before the line is drawn
   at speed rather than after.
2. **A decision on what `available: false` draws.** ADR-152 deliberately left it open and §5
   recommends the dashed approximation, which the owner has agreed. It needs to exist as a declared
   state in `route-detail.spec.json` before M4, not after.

**Recommendation: M3 stays in the mockup until the header interaction settles**, because the visible-
centre rule depends on the card and sheet geometry, and re-deriving it against a changed layout is
the kind of rework that is cheap now and expensive later. Everything M3 owes is understood; none of
it is blocked on a question we cannot answer.

---

## 9. Suggested rows

Ordered so each earns its keep alone, and so the two open questions (§2 vector base, §8 paradigm) can be
answered late rather than up front.

| Row | What | Prereq | Notes |
|---|---|---|---|
| ~~**M0**~~ | ~~Retain `gtfsId` for KMB/CTB/NLB~~ | — | ✅ **Done 2026-08-24** (ADR-152). Also carried on `RouteDoc`. |
| ~~**M1**~~ | ~~`resolveRoutePath` + corpus~~ | M0 | ✅ **Done 2026-08-24** (ADR-153). 5 groups, 20 rows, expected values from a second implementation. `packages/core` still 100% covered. |
| ~~**M2**~~ | ~~`/v1/route/:id/path`~~ | M1 | ✅ **Done 2026-08-24** (ADR-152). Measured: **444 ms / 7.9 KB** for KMB 1 outbound. `available:false`, never 404. |
| ~~**M3**~~ | ~~`MapProvider` seam; interactive MapLibre~~ | — | ✅ **Done 2026-08-25** (ADR-154). Seam + `tileZoomPlan` + a `#map` lab page. **Web only, and not visually verified** — see the ADR. |
| **M4** | Route polyline on Route detail, with the §5 fallback | M2, M3 | ✅ **Done 2026-08-26** (ADR-155). `routePathView` decides the arm, `RouteMap` draws it, and four states in `route-detail.spec.json` measure it — including the one where nothing is drawn. **Visually verified** in dev and against the built `dist/`; the first look found that MapLibre's worker never loaded, so no line drew at all (ADR-155 decision 7). |
| **M5** | Live user location + accuracy radius + permission states | M3 | Existing `LocationProvider`. **A dot is the fallback and a dart is preferred** — see §6b. |
| **M6** | ~~Scroll-linked camera, with pan-to-suspend and recentre~~ | — | ❌ **Closed 2026-08-26, answered by §8d.** The scroll-spy was built, demonstrated and cut, so there is no loop to avoid. **The camera still moves — on a tap — and that is M7's**, not a lost requirement: see §6b. |
| **M7** | Route-detail interaction paradigm (§8d) + markers + chevrons + **focus camera** + spec update | M4 | 🟡 **Mostly done 2026-08-26** (ADR-155). Markers, chevrons, the focus camera and the whole §8d interaction ship on `apps/web`. **The spec half is partial** — `stopName`'s destination is updated and the divergence is an `idiom` entry, but the `⋯` and the markers are *undeclared controls*: a slot needs text, and the native row has neither control, so declaring one would be a red build there. See §8e. |
| **M8** | *(nice to have)* Street view toggle | §7 key | Send the email now; the row can wait. |

**Two things to settle before M3 and M7 respectively:** whether the vector base is worth trying at all,
and which interaction paradigm wins. Everything else can start.
