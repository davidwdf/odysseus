# 07 — Backlog (parked, not forgotten)

Things deliberately **out of v1** but explicitly planned. Roughly priority-ordered within groups.

## Additional operators
Each is a fetch+normalize adapter in `packages/data-normalize` (+ a realtime poll adapter);
the `DataSource` interface and the UI do not change.

- [ ] **New Lantao Bus (NLB)** — `data.gov.hk` realtime dataset.
- [ ] **MTR Bus / Feeder Bus** — `data.gov.hk` realtime schedule dataset.
- [x] **Green Minibus (GMB)** — **shipped in v1** (ADR-047): `data.etagmb.gov.hk` live stop board + consolidated-dataset
  static geometry/fares/frequency. Follow-ups: friendlier "Minibus" label, a region/area tag in search (numbers repeat
  across regions), GMB route-level live ETAs (static-only today), GMB stop-merge edge cases.
- [ ] **Light Rail (LRT) & MTR heavy rail** — different domain (rail), but the canonical model can host it.
- [ ] **Ferries** (Star Ferry / franchised ferries) — if scope expands beyond buses.

## Static data & multi-operator (follow-ups to [ADR-021](./08-decision-log.md))
- [~] **Own static crawl → KV/R2** — the **KV/R2 half is done** ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path), WP0-1): a
      daily GitHub Action normalizes the dataset, runs the ADR-042 clustering and writes content-addressed
      shards to KV + R2, so the Worker never fetches or parses it. **What's left is the *source*:** the crawl
      still reads the hkbus consolidated dataset rather than the operator APIs. Doing our own (KMB bulk
      endpoints already in `kmb-static.ts`; CTB via the per-route + per-stop crawl) is now a change to
      `scripts/build-dataset.mts` only — the Action already sits outside the Worker subrequest cap. Buys
      self-reliance and true zh-Hans.
- [x] **Cache the snapshot in KV/R2** — **DONE** ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path), WP0-1). A hkbus outage now
      means *stale* rather than broken: the Worker serves whatever build `build:current` points at and never
      touches upstream static data. The `DATASET` + `BUILDS` bindings are real (the KV namespace id in
      `wrangler.toml` is still a placeholder — see WP0-5).
- [x] **Same-kerb stop-merge (`Place`)** — DONE (ADR-022 → generalised by ADR-042 to direction-aware N-member
      clustering). Follow-up: looser name matching (token overlap) to also merge stops whose landmark strings differ
      (e.g. KMB stop-code-only names), ideally on the own-crawl's first-party coordinates.
- [ ] **GMB never merges with franchised buses — the operators name stops in opposite orders.** The single
      highest-value clustering fix we know of, and it is one function. `namesMatch` compares only the **head**
      segment of a name (everything before the first comma/bracket). GMB names lead with the **road**
      (`"Tai Chung Kiu Road, outside Belair Gardens"` → `taichungkiuroad`); KMB and Citybus lead with the
      **landmark** (`"BELAIR GARDEN (ST141)"`, `"Belair Garden, Tai Chung Kiu Road"` → `belairgarden`). The heads
      never match, so a GMB stand 29 m from a franchised pole is rejected before distance or bearing is even
      considered — and a rider standing at Belair Garden gets **three cards for one place** (the KMB+CTB place,
      plus each GMB kerb).
      **Candidate rule, simulated against the live dataset 2026-07-27:** compare **every** name segment rather
      than the head; drop road-like segments (`Road|Street|Avenue|…` / `道街路徑里坊巷`) so the shared token has to
      be a *landmark*, not a road that runs for kilometres; de-pluralise (GMB says "Belair Garden**s**", KMB says
      "BELAIR GARDEN"); and exploit the fact that **GMB's naming already encodes the kerb** — a shared landmark
      with *conflicting* positional qualifiers (`outside` vs `opposite` vs `near`) is a same-kerb **veto**, not a
      match.

      **Reproduce it: `pnpm study:gmb-names`** (`apps/edge/scripts/studies/gmb-name-matching.mts`) —
      it re-derives the pair-level figures from the live dataset on every run, so this argument can be
      re-checked, or falsified, against tomorrow's data rather than trusted from a table.

      | | today | candidate |
      |---|---|---|
      | candidate pairs within 30 m that name-match | 9,548 | 10,933 (+1,385) |
      | …of the new pairs, cross-operator | — | 1,299, of which **1,232 GMB↔franchised** |
      | pairs rejected by the new qualifier veto | — | 3 |
      | places | 2,397 | 2,553 |
      | stops absorbed into a place | 6,351 | 7,017 |
      | GMB poles inside a place | 828 (17.4%) | **1,205 (25.3%)** |
      | mixed-operator places | 119 | **556** |
      | largest place | 11 members | **11** (unchanged) |
      | places with `confidence` < 40 | 14 | **14** (unchanged) |

      Belair Garden merges at bearing spread **14°**, confidence **81**. That the largest place and the
      low-confidence count both stay put is the reassuring part: the bearing gate and the `linesShared` /
      `consecutivePairs` vetoes still carry the load, and the qualifier veto fires on only 3 pairs — but the 3 it
      catches are exactly right (`opposite Queen Elizabeth Stadium` vs `outside Queen Elizabeth Stadium`, 26 m).
      **Two things to fix in the same change, or it regresses the UI:**
      (1) `pickName` scores by string length, and GMB's road-first names are longer — the merged Belair place comes
      out named *"Tai Chung Kiu Road, outside Belair Gardens"* instead of *"Belair Garden"*. Prefer the
      **landmark-led** name, not the longest.
      (2) Absorbing GMB poles mints new `P:` ids, which silently orphans saved favourites — this must land **after**
      or **with** the WP2-5 favourite-id migration, not before.
      **Not fixable here, and worth knowing before anyone tries:** `GMB:20001553` is a *single* id for two
      physically separate boarding points at opposite ends of the Belair kerb (65A/65S/67A/67K at one, 803/804 at
      the other). Verified against the GMB government API directly — `route-stop/2009119/1` and
      `route-stop/2010275/1` both return `stop_id 20001553`. No open-data source distinguishes them, so no
      clustering rule can. Merging is still right; it just can't tell a rider which end to walk to.
      Before shipping, re-run the ADR-042 adversarial sample audit — this moves 666 stops.
- [ ] **Cluster-review tooling (one-off)** — an internal UI to eyeball `Place` groupings on a map and accept/split
      them, to optimise the clustering deliberately. Prioritise by the per-place **`confidence`** score now carried on
      `IndexPlace` (ADR-042 follow-up #3: ~45 low-confidence places, mostly termini/BBIs). Feed any rule tweaks back
      into `buildPlaces`.
- [~] **Direction tag for same-named places (ADR-042 follow-up #1)** — distinguish the NE vs SW cards of one
      landmark. **Compass octant shipped** (`formatBearing` + wire `Stop.bearingDeg`; "Northeast-bound" / "東北行").
      Optional upgrade: an **18-district gazetteer** (coordinate→district) for the friendlier "towards {district}"
      wording. A single "towards {destination/next stop}" is not derivable (too many destinations per place — see
      `.context/stop-merge-study/`).
- [ ] **True Simplified (zh-Hans) static names** — the consolidated dataset only has en + Traditional, so
      Simplified stop/route names currently fall back to Traditional. Source real zh-Hans (official bulk
      endpoints have `name_sc`) once on our own crawl.
- [ ] Additional consolidated operators already in the dataset (NLB, GMB, MTR feeder, light rail) — cheap to
      light up once merge + UX are ready (overlaps "Additional operators" above).

## Realtime & data quality
- [ ] 🟠 **The Place screen never says "live times unavailable"** — `PlaceDetailView.incomplete` has existed
      since [ADR-077](./08-decision-log.md) and this screen has never read it, so a rider who taps a Nearby
      card marked *"Live times unavailable"* lands on a screen that has quietly dropped the warning, where an
      empty list then reads as *"no buses"* — the exact conflation ADR-073 spent a wave separating. Declared
      as a `knownDefect` state (`incomplete`) in `packages/contract/ui/place-detail.spec.json`, so it is
      visible and cannot be forgotten. The line, its tone and its position are already decided by `StopCard`:
      below the rows, `text-muted`, never a warning colour, because nothing is wrong with the rider's stop.
      Three lines in each renderer, plus flipping the state's `knownDefect` to a projection.
- [ ] 🟠 **The Place screen does not say when the distance is measured from a remembered fix.** Nearby says
      *"Last known location"* for exactly the same input ([ADR-084](./08-decision-log.md)); this screen reads
      the location silently and uses `loc.lat/lng` without consulting `loc.stale`, so a cold start shows
      "150m · 2 min walk" against yesterday's position and says nothing. ADR-008's honesty rule about the
      rider's **position** is being applied by one screen out of two. Declared as the `stale` `knownDefect`
      state in the Place spec. The fix belongs in the kernel, because the summary is composed there.
- [ ] 🟡 **The Place screen drops the place's own printed code.** `displayName` splits a name into `label` +
      `code` (ADR-034) precisely so a renderer can show the code smaller and muted; `StopRow` does, and this
      screen takes `name.label` and throws `name.code` away. A merged place gets away with it — every kerb's
      code is in its own heading — but a lone stop named *"NELSON STREET MONG KOK (MK514)"* shows no `MK514`
      anywhere, and that is the one thing printed on the pole the rider is looking for. Declared as the
      `codedPlace` `knownDefect` state. Needs a second prop on the collapsing header, which is why it was not
      done in the row that noticed it.
- [x] ✅ **A walk of hours reads as hours** (2026-08-04, `formatWalk`/`formatWalkRange`, ADR-086). A
      location fix outside Hong Kong put **"270 min walk"** under a place name — honest arithmetic that a
      rider has to do in their head. Past an hour it is now `4.5 hr walk` / `4.5 小時路程`, one decimal, and a
      range takes one unit for both ends chosen by the larger. Capping the value was the alternative and it
      loses: "more than an hour away" is not what we measured, whereas a badly-scaled number merely reads as
      a bug in the app. Every such reading is degenerate by construction — nobody walks an hour to a bus
      stop — which is the argument for formatting them *well* rather than for hiding them.
- [ ] **The English summary can print "1 routes"** — `routesLabel` is a bare noun, so the count and the
      plural are decided in two places and only one of them knows about `n`. `placeDetailView` already
      takes the whole phrase (`routeCount: (n) => string`), so the fix is an ICU plural key in
      `@nextbus/i18n` and its three locales, then passing it — no kernel change. Pinned by a corpus case so
      it cannot be fixed by accident and unnoticed.
- [ ] **A pole id we cannot parse yields a heading of `" · Southwest side"`** — a leading separator,
      because the operator label is empty and the side is appended. Unreachable by any id in a real build
      (every canonical id parses) and pinned by a corpus case; one line to fix in whichever row next
      touches `poleHeading`, by joining the present parts rather than concatenating.
- [ ] Service-disruption / special-traffic-news surfacing (TD incident data).
- [ ] Per-route remarks (e.g. "last bus departed", schedule-based vs GPS-based ETA labelling).
- [ ] Crowding / occupancy data (if/when published).
- [ ] Historical ETA accuracy tracking → show confidence ("usually on time here").

## Favourites & saving UX (design questions to settle)
Recorded so they're not forgotten — each needs **thinking through / designing** before any code. Today
([ADR-032](./08-decision-log.md)/[ADR-042](./08-decision-log.md)) a favourite is a *route at a member pole*
(`formatFavoriteRouteKey(stopId, routeId)`); `SaveStar` renders at the **trailing edge** of each route row in
Place/Stop detail with `hideWhenEmpty`, and the only way to *add* one is the route-schematic action sheet.

- [ ] **Move the favourite indicator onto the route badge itself** — on the single-line bus row in Stop/Place
      detail ([`app/stop/[id].tsx`](../apps/mobile/app/stop/[id].tsx) `RouteRow` → `RouteChip` +
      [`SaveStar`](../apps/mobile/components/SaveStar.tsx)), the star currently sits at the far right of the row,
      away from the thing it describes and competing with the `EtaBadge` for the eye. Design it **on the
      `RouteChip`** instead — a corner pip / badge-on-badge — so "saved" reads as a property of *that route*, and
      the row's right edge belongs to the ETA alone. Open questions: does it survive the operator liveries and
      dark mode at chip size; does it stay tappable (44 pt / `hitSlop`) without overlapping the route number;
      what does it do on the route-detail schematic and on the Favourites rows, which share these components.
- [ ] **A better way to favourite from the stop screen (long-press?)** — from Stop/Place detail there is
      currently **no way to save a route at all**; you must open route detail and use the action sheet. Since the
      row's tap is already spoken for (navigate to route), the candidate is a **long-press on the row (or on the
      route badge) → save/unsave**, with haptics + a toast, and possibly a long-press action sheet ("Save this
      route here", "View route", "Open in Maps") rather than a bare toggle. Think through discoverability (a
      long-press nobody knows about is not a feature — needs a first-run hint or a visible affordance), web
      parity (`onLongPress` on react-native-web), and whether swipe-to-save is the better idiom.
- [ ] **Where should "+X more routes" go from the Favourites page?** — `StopRow`'s overflow link
      ([`components/StopRow.tsx`](../apps/mobile/components/StopRow.tsx)) hands off to `onPress`, which on
      Favourites ([`app/(tabs)/favorites.tsx`](../apps/mobile/app/%28tabs%29/favorites.tsx) `FavoritePlaceRow`) opens the
      **full, unfiltered** Place detail — so tapping "+3 more routes" under a favourites card dumps you into a
      list of 20 routes and you have to re-find your three. Candidate: the same Place detail **filtered to the
      favourited routes at that place** (a filter chip / segmented "Saved · All" on Stop detail, deep-linked from
      here), which also gives the Favourites card an honest "see the rest of what I saved here" destination.
      Decide the wording too — from Favourites, "+X more routes" arguably means "+X more *saved* routes".

## Platform & engagement
- [ ] **Push notifications:** "your bus is N stops / N minutes away" (needs native — Phase 3).
- [ ] **Background location** geofenced alerts.
- [ ] **Home-screen widgets** (iOS WidgetKit / Android App Widgets) for favourite stops.
- [ ] **Apple Watch app / Live Activities**; Android Wear.
- [ ] **Accounts + cross-device sync** of favorites/settings (Cloudflare D1).
- [ ] **Desktop / tablet-optimized layout** — adaptive multi-column / master-detail UI (e.g. map +
      stop list side-by-side on wide screens), pointer/hover affordances, keyboard navigation.
      RN-for-Web already runs in desktop browsers, so this is responsive **layout** work
      (Tailwind/NativeWind responsive variants + `useWindowDimensions`), **not** a new platform. Could later be wrapped as a
      true desktop app via Tauri/Electron if there's demand.

## Journeys & utility
- [ ] **Trip planning** (multi-leg routing across operators).
- [ ] **Fare calculation** (using the routes-and-fares dataset).
- [ ] **Share ETA** (deep link to a stop/route + current arrivals).
- [ ] Journey history / frequent trips.

## Localization & reach
- [ ] 🟡 **The English GMB label is an acronym where the Chinese is a phrase.** `operatorGmb` reads
      `專線小巴` / `专线小巴` — a phrase a rider recognises — and plain `GMB` in English, which a rider has to
      already know. It is the heading above a whole kerb's routes on Place detail, seen on screen at Queen
      Mary Hospital. The corpus's own `placeDetailView` fixture calls it *"Minibus"*, which is probably the
      word the English catalogue wants, and a driver assertion in both conformance suites pins that this is
      the **only** place the catalogue and that fixture disagree — so changing it is a one-line catalogue edit
      plus that expectation. Found by WP6-3b ([ADR-088](./08-decision-log.md#adr-088--place-details-spec-its-dom-port-and-the-gate-that-finally-reads-both-renderers)).
- [x] ~~**简体中文** (Simplified Chinese)~~ — **promoted to v1** (upstream data already carries it;
      see [ADR-014](./08-decision-log.md)).
- [ ] Additional tourist-facing UI languages (e.g. 日本語 / 한국어) — app chrome only; bus data stays EN/中文.
- [ ] Marketing/landing page (`apps/web-landing`, Astro/Next.js) — only if SEO/acquisition matters.

## Fun & delight features
A grab-bag of "wow" ideas — none required, all candidates for making the app memorable. Anything
built on approximated data must respect the [honesty principle](./01-vision-and-scope.md).

### Themes & visual identity
- [ ] **Bus livery themes** — app skins styled after iconic HK liveries: **KMB** red, **Citybus**
      yellow, **NWFB** orange/purple, the nostalgic **China Motor Bus** blue-&-cream, **Cityflyer**
      airport livery, **Long Win** turquoise, **New Lantao** silver/blue, 1960s **cream-&-red**
      rollsign era. Optional **auto-theme**: accent matches whichever operator you're viewing.
- [ ] **Dot-matrix / flip-dot route display** — render route numbers + destinations like bus LED /
      flip-dot destination blinds (orange-on-black), with the scrolling-blind animation. Variants:
      fabric **rollsign** and mechanical **flip-dot** for nostalgia.
- [ ] **Split-flap (Solari) display** — airport/train-station flip-tile board for route numbers,
      destinations, and ETAs; tiles **flap to the new value on real data change** (doubles as the
      honest on-change animation — never a fake timer). Reusable `<FlipTile>` component; optional
      flap click + haptic. Spec in [`docs/09` §7](./09-theme.md).
- [ ] **Alternate app icons** matching liveries (iOS alternate icons / Android adaptive).
- [ ] **Vintage / paper-timetable mode** — skeuomorphic ticket-and-timetable aesthetic.

### Live map & motion
- [x] ✅ **Poles that publish the same coordinate are folded into one pin** (2026-08-04,
      `mergeCoincidentPins`, ADR-086). Found by opening Tin Shui Wai Park: two of its three members
      publish `22.45448, 114.00297` — identical, not close — so two dots were drawn at the same screen
      point with their labels invisibly stacked, and scrolling the list appeared to *swap* a pole's label
      rather than highlight it. The pin now reads `TN511 · TN510`, keeps both ids so the scroll-spy can
      still light it, and goes neutral where the folded poles disagree about the operator. The label-above
      flip already handled poles a metre or two apart; a separation of **zero** is what it could not help
      with. This is ADR-071/ADR-080's population seen from the map, and the useful way to put it is that
      **the list can tell those kerbs apart and the map structurally cannot** — which is why the
      compass-side / pole-name / "check the sign" tiers exist at all.
- [ ] **A folded pin has no way to say *which* of its poles you tapped**, and it deliberately does not
      guess: a tap scrolls to the first, and the list is where the rider reads which is which. If the map
      ever becomes interactive (below), the honest treatment is a small fan or a two-row callout rather
      than picking one.
- [ ] **A dot labelled with a raw operator stop id names something no sign shows** — and it disagrees with
      the heading beside it. `PlaceDetailView.pins` labels a dot with `poleFlagCode(name, locale) ?? rawId`
      while the heading prints the operator *and* the code only when there is one, so at Tin Shui Wai Park
      the Citybus dot reads **`001992`** and its heading reads **`Citybus`**, and a rider matching one to
      the other does it by elimination. True since ADR-042 shipped the labels; found by writing the
      property down in WP6-3b ([ADR-087](./08-decision-log.md#adr-087--the-maps-pins-are-content-and-the-dots-label-is-the-headings-own-code)),
      which now asserts the disagreement in both directions so it cannot be fixed unnoticed. Three
      options, none taken: drop the fallback and leave such a dot unlabelled (honest, loses the only thing
      telling two Citybus dots apart); put the raw id in the heading too (consistent, prints an id at
      size); or label the dot with the **operator's name** where there is no code, which is what the
      heading already says. The third is probably right and is a one-line change plus corpus rows.
- [ ] **A dot for a kerb with no rows left scrolls nowhere.** `pins` covers every member pole while
      `groups` covers only the poles that still have rows after `dedupeRoutes`, so a place can draw a dot
      whose tap asks the list for a section that does not exist — and it fails silently. Deliberate as far
      as the *map* goes (a kerb with nothing due is still a kerb standing there); what is wrong is the dead
      tap. Either make such a dot inert and say why, or give it a one-line "nothing due here" section.
      Pinned by the corpus since [ADR-087](./08-decision-log.md#adr-087--the-maps-pins-are-content-and-the-dots-label-is-the-headings-own-code).
- [ ] **Build out the stop/place map from a static image into a real feature** — today `MiniMap`
      ([`apps/mobile/components/MiniMap.tsx`](../apps/mobile/components/MiniMap.tsx), ADR-041) is a
      **static** raster — LandsD basemap + per-locale label overlay via the `TileSource` seam
      ([ADR-049](./08-decision-log.md)) — that drops a pin per pole
      ([ADR-042](./08-decision-log.md)) and, on tap,
      just hands the centroid off to the platform maps app. Make the map genuinely **useful and
      functional** rather than a thumbnail. Candidate improvements:
      - **Sticky map on scroll** — fix the map to the top of Place/Stop detail and let the
        pole/stop list scroll beneath it (a collapsing-header treatment, cf. `CollapsingHeader`),
        so the map stays in view as you read down the stops.
      - **Highlight the in-view stop's pin(s)** — as the list scrolls, emphasise the pin(s) for the
        stop currently in view (and conversely scroll the list when a pin is selected), so map and
        list stay linked.
      - **Show stop ids / labels on the map** — render the stop id (and/or short name) on or beside
        each pin so a pin is identifiable without leaving the screen.
      - **Tappable pins → action sheet** — the whole-map tap currently opens the platform maps app
        (good as a fallback). Make a tap **near a specific pin** instead open an action sheet
        (`BottomSheet`) for *that* pin: **Open in Maps**, **show more data about this pin/stop**, and
        **scroll to this stop** in the list. Needs per-pin hit-testing.
      Implementation seam: either keep the keyless static-tile approach and add pin hit-testing +
      a sticky container, or graduate to **MapLibre** (the Phase 2 "Map view for Nearby" step in the
      [roadmap](./06-roadmap.md)) for a real interactive map. The tile question is **settled** either
      way — both consume `lib/tileSource.ts`, which already serves LandsD through our Worker.
- [ ] **Uber-style moving bus icons** — animate buses along the route on the map. Franchised buses
      don't publish raw GPS to us, so **approximate** position by interpolating along the route
      polyline from successive-stop ETAs (+ schedule). **Clearly label as estimated**; degrade
      gracefully when data is thin.
- [x] **Subway-style line strip** — **DONE** for KMB/LWB ([ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)):
      the **route-detail** view is now a **vertical schematic timeline** with **bus tokens** that hop between
      stops — at the upcoming stop when `isDue` (<1 min), else the **segment midpoint**, moving **only on
      fresh data**. Located by **drop-off detection** (no vehicle id). `RouteDetail.stops[].eta` is fed by
      KMB `route-eta` (one call per route); per-stop times + seq-in-node + a fixed glass header shipped with
      it. Follow-ups: **per-bus identity** (one token gliding the whole line), and **CTB** (needs the
      own-crawl — no bulk route-eta).
- [~] **Street-level photo of the stop ("what does the kerb look like?")** — **DECIDED, [ADR-050](./08-decision-log.md#adr-050--stop-imagery-google-street-view-deep-link-now-hk-streetscape-360-as-the-inline-target).**
      HK stops are often one of several poles outside a mall exit or across a flyover, and a photo answers
      "am I in the right place?" faster than a map pin. Two steps:
      1. **Google Street View deep link** — free, keyless, no ToS exposure; `Stop.bearingDeg` makes the pano
         open facing the direction of travel. **Unblocked, do first**, beside the existing "Open in Maps"
         hand-off (see the tappable-pin action sheet above).
      2. **Streetscape 360 (HK Lands Department)** — the government's *own* 360° panoramas, territory-wide
         since Mar 2025, free key from `3dmap@landsd.gov.hk`, cacheable under the CSDI grant. **Blocked on one
         question:** can a stop coordinate be resolved to a panorama without running their JS SDK, and is
         `.pano` renderable in RN? Ask when requesting the key.
      **Street View Static API is ruled out** — not on price: the Maps ToS bans caching/re-hosting imagery
      *and* bans showing Street View "on the same screen" as a non-Google map, which our Place-detail layout
      is. Caveats for any source: panos go stale (HK stops move for works), coverage is thin inside termini /
      BBIs — treat imagery as a hint, label its capture date, keep map + name authoritative.
- [x] **Basemap migration off OSM → LandsD** — **DONE** (WP0-2, implementing
      [ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)).
      No component names a tile host any more: `MiniMap` goes through the `TileSource` seam
      (`apps/mobile/lib/tileSource.ts`) to our own Worker routes `/v1/tiles/basemap/:z/:x/:y.png` and
      `/v1/tiles/label/:lang/:z/:x/:y.png` (`apps/edge/src/tiles.ts`, 12 h TTL, overriding LandsD's
      `cache-control: private`). Two stacked rasters — a language-free basemap plus the label overlay picked
      by `useLocale()`. Attribution satisfied with a self-hosted LandsD logo on the map face and a *linked*
      "Map from Lands Department" notice. The two pre-migration fixes this item asked for are **moot**: the
      OSM credit is gone and there is no `TILE_URL`. Dark mode still derives from the CSS invert filter
      (`TileSource.invertForDark`) — LandsD's raster service has no dark variant. **Protomaps→R2** (measured
      38 MB for all of HK z0–15) stays the documented fallback for true dark mode or offline packs.
- [ ] **Bonus HK-gov APIs that come with LandsD** (all keyless, see
      [proposals/02 §5](./proposals/02-basemap-and-street-imagery.md#5-bonus-features-that-come-along-for-free)):
      **3D Pedestrian Route Search** — the honest way to do "leave now" walking times in a city where a 50 m
      straight line is a 400 m footbridge detour; **Location Search** — extend search to buildings/places, and
      its `districtEN`/`districtZH` field supplies the 18-district gazetteer that ADR-042 follow-up #1 wanted
      for "towards {district}"; **Search Nearby** — landmark context on a stop card. Both return **HK80
      Easting/Northing**, so this needs an HK80↔WGS84 conversion in `@nextbus/core`.
- [ ] **Self-drawing route polyline** animation; animated "progress" fill toward your stop.
- [ ] **Frequency heat** — visualize which nearby stops have the most buses arriving soon.
- [ ] 🟢 **Explore hkbus.app's map, which is prettier than ours and cheaper than it looks** — researched
      2026-08-10 from their GPL-3.0 source and live traffic, written up as
      [proposals/02 §11](./proposals/02-basemap-and-street-imagery.md#11--addendum--how-hkbusapp-actually-does-it-read-2026-08-10-nothing-decided).
      **Nothing decided, ADR-049 stands.** The four things worth stealing, none of them a rewrite:
      **(a)** the whole basemap is the Protomaps→PMTiles fallback ADR-049 parked — MapLibre over a
      **29.6 MB** archive they build themselves with planetiler in a scheduled GitHub Action, which
      independently confirms our measured 38 MB (z0–15) was not optimistic; **(b)** their vector style has
      **zero `symbol` layers** — every name is LandsD's `{lang}` label raster on top, so ADR-049's
      per-locale label overlay is *orthogonal* to which base sits under it, and the empty-Han-glyph gotcha
      never arises; **(c)** the between-stops camera flight everyone notices is bare
      `map.flyTo({ center })` — MapLibre's default curve arcs out and back in for free, and the authored
      part is only that a new **stop** animates while a new **route** jumps; **(d)** the route line is a
      6 px casing + 4 px coloured fill + a `symbol` layer of **arrowheads** every 70 px, which answers
      ADR-080's *"which side of the road do I wait on"* with cartography instead of prose. Two cautions:
      they block **all** tile rendering for ~5–30 s on a first visit (whole-archive download into Cache
      Storage — wrong default for a rider on cellular, right shape for the offline pack below), and their
      route geometry is not open data at all but a community waypoints repo, so **a real route line is a
      data question before it is a rendering one** (`docs/research/01`: HK publishes no polylines). Against
      all of it: §4 valued LandsD's survey detail — footbridges, subways, landmark buildings — as *the*
      feature, and OSM does not carry it. Prettier and less useful is a real possibility, not a rhetorical one.

### Smart timing (utility that feels magic)
- [ ] **"Leave now" alerts** — combine walking time to the stop with the ETA: "leave in 3 min to
      catch the 3:42."
- [ ] **Catch probability** — "likely to make it if you leave now."
- [ ] **Commute presets** — one-tap "Going home" / "Going to work" surfacing your usual stops at the
      right time of day; learn patterns over time.
- [ ] **Lock-screen Live Activity / Dynamic Island** (iOS) + ongoing notification (Android) counting
      down your awaited bus.
- [ ] **Siri Shortcuts / Google Assistant** — "when's my bus?"

### Eyes-free & accessible delight
- [ ] **Glance mode** — giant countdown for a quick look while walking / for low vision.
- [ ] **Spoken arrivals** — read out the next buses, eyes-free.
- [ ] Optional **"bus bell" sound + haptic** when your bus hits **Due** (the classic stop-request
      chime as an easter egg).

### Community & bus-fan culture (巴士迷)
- [ ] **Route collection / badges** — gamify routes ridden, rare routes, double-deckers, liveries spotted.
- [ ] **Commute streaks** (lightweight).
- [ ] **Crowd-sourced crowding** — 1-tap "how full is it?" reports.
- [ ] **Community stop photos** — help riders identify confusing stops.
- [ ] **"Ghost bus" flagging** — surface buses that vanish from ETA without arriving (data-quality + oddly satisfying).
- [ ] **Shareable arrival card** — a "boarding-pass"-style card of a stop + next arrivals to send to friends.

## Route detail — stop measuring the rail, position the tokens in CSS

- [x] ✅ **Done** ([ADR-110](./08-decision-log.md#adr-110--the-rails-resting-place-is-css-only-its-travel-is-measured)).
      The tokens were an absolutely positioned overlay whose `top` came from measured row offsets kept fresh
      by a `ResizeObserver`; ADR-108 fixed that machinery twice and the machinery itself was the liability.
      A token is a positioned sibling of its own row's button now — `top: 13px` at a node,
      `calc(50% + 13px)` on the segment into the next one — so nothing is measured and nothing can go stale.
      The travel a re-parent costs is `element.animate()` over a delta read at the instant of the move.

      **Three things this row's own description had wrong**, each found by doing it:
      · the token cannot be a *child* of the row — a labelled `role="img"` inside a `<button>` is folded into
        that button's accessible name, and no suite here can see it;
      · *"stays inside its row's box for any row taller than 50 px"* is the threshold for the token's
        **centre**; its box needs 74 px, and `min-h-16` gives 64, so a segment token overhangs by 5 px and
        needs a `z-index` to keep the next row's rail line from slicing it;
      · `railBusFor` is called `railBus`.

      It also closed a live defect next door: `.row-rise` used `animation-fill-mode: both`, which leaves a
      finished row holding `transform: matrix(1,0,0,1,0,0)` — a stacking context — so after any direction
      flip the saved-stop star's `z-10` was trapped inside its row and a passing bus painted over a rider's
      favourite.

      **And a third defect, older than either renderer**
      ([ADR-111](./08-decision-log.md#adr-111--an-ordinal-is-a-slot-not-a-bus-the-rail-gains-an-entrance-and-an-exit)):
      the ordinal `view.buses` gives a token is a *slot*, not a vehicle, so when the lead bus reached the
      terminus every bus behind it inherited an ordinal and slid the length of the schematic the wrong way —
      1120 px on a 17-stop rail, and the same in the overlay this replaced. Tokens are matched by their place
      along the route now, under the rule that a bus travels forward, and what the rule leaves unmatched is
      exactly the two events worth drawing: a bus **entering** the rail and one **leaving** it. Both pop.
      `apps/mobile` still has the re-index defect and is not being fixed — it retires at WP6-8.

## WP6-8 blockers — the parity audit's findings (2026-08-08)

> **`apps/web` is NOT yet safe to ship as the only renderer.** Eight auditors walked it screen by screen
> against the `apps/mobile` it replaces; 25 of their claims were adversarially refuted by a second pass
> (9 refuted as noise, 6 reclassified as intended idiom, 10 confirmed) and 15 were left unverified when the
> run hit its session limit — those are marked ⚠️ below and were checked by hand instead.
>
> **The scoping rule that makes this list short:** ADR-075 deliberately makes idiom free to differ, so a
> difference in material, motion, gesture or layout is *intended* and is not listed here. What is listed is
> what a rider **loses**.

- [x] ✅ **BLOCKER CLOSED — the favourite affordance is built on `apps/web`** (2026-08-08). Both RN
      affordances are ported: the route schematic's **stop action sheet** (a `<dialog>`, the twin of the RN
      `BottomSheet`, offering *Add/Remove favourite* and *View stop*) and Place detail's **saved-state star**
      (`apps/web/src/components/SaveStar.tsx`, a **sibling** of the row's button per ADR-024, hidden until the
      route is saved). The toggle writes under `formatFavoriteRouteKey(pole, route.id)` using the **payload's**
      route id rather than the URL parameter, so the key can never differ from the one `routeDetailView`
      computed `saved` from.
      **Kept as a record because of what it says about the gates:** the original defect — a row tap navigating
      to the place instead of opening the sheet — violated `route-detail.spec.json`'s **non-optional**
      `stopName` interaction for two waves and **every suite stayed green**, because `conformStates` asserts
      text and nesting and never interaction *destinations*, and a sheet behind a tap is in no projected state.
      Both halves now have direct assertions in `apps/web/test/{route,place}-detail-states.test.tsx`
      (9 new tests), each watched failing on an injected revert. Writing them also needed a
      `HTMLDialogElement.prototype.showModal` shim — **no test in this repo had ever opened a `<dialog>`**, so
      `RouteFactSheet`'s container had never been mounted either.
      Verified in a browser on live data: KMB 1A → tap 秀安樓 → sheet → 加入收藏 → the key lands in
      `nextbus.preferences` → the Favourites tab draws the card → Place detail shows exactly one star,
      `已收藏` / `aria-pressed=true`, with **27 interactive elements and 0 nested**. Screenshots
      `.context/wave6-screenshots/21`–`22`.
      **Still owed, and it is why this is checked rather than deleted:** the sheet's own content is a declared
      state in *neither* renderer's spec — it is an interaction result, and giving it one would have to spec
      the native sheet at the same time. Both suites assert it directly instead, which is the
      `search.spec.json` division; a spec for it is the follow-up below.
- [ ] 🟡 **The stop action sheet has no spec on either renderer.** WP6-8's blocker fix asserts its words and
      both its actions directly in both suites, which is honest but is the weaker form. A component spec for
      it would make the two renderers' sheets comparable the way every other surface is — and it would be the
      first spec for a surface that only exists behind an interaction, which is a genuinely new question for
      the format (ADR-092 answered *what a rider infers from* an interaction, not *what the interaction
      opens*).
- [x] ✅ **BLOCKER CLOSED — `apps/web` loads Inter** (2026-08-08). One **48 KB** variable woff2, latin subset,
      self-hosted via `@fontsource-variable/inter` and emitted by Vite into `dist/assets/` — where
      `scripts/pwa`'s precache globs already included `woff2`, so it is precached with everything else and the
      first offline launch has it. Four `@font-face` rules, named `Inter_400Regular` … `Inter_700Bold` because
      **those names are `packages/ui`'s preset's**, all aliasing the one file over the full `100 900` range:
      native satisfies the shared declaration with four static cuts (1.35 MB of TTF), the web satisfies it
      with one variable file. ADR-019 is untouched — the subset is latin, so Chinese still renders in the
      platform face through the preset's fallback chain.
      **What let this survive a parity review is the part worth keeping:** `index.css` carried a hand-written
      system stack with a comment saying it was *"the same stack the RN app resolves to on web"*. That was a
      rationalisation, not a measurement — `expo-font` registers real `FontFace`s on web, so the Expo PWA has
      rendered in Inter since Wave 1 and the DOM app never did. The body rule is `@apply bg-bg font-sans` now,
      so the fallback chain is the preset's rather than a second copy of it.
      Bound by four assertions in `apps/web/test/shell-parity.test.ts` that read the preset and require an
      `@font-face` per cut, one shared self-hosted source, and no third-party URL — each watched failing.
      Verified in a browser: all four faces `loaded`, `<h1>` computing to `Inter_700Bold` at weight 700, body
      to `Inter_400Regular`. Screenshot `.context/wave6-screenshots/23`.
- [ ] 🟠 **`apps/web` opts into `viewport-fit=cover` and compensates only at the bottom.** Confirmed by the
      refutation pass and by hand: `index.html:5` sets `viewport-fit=cover`, `shell/TabBar.tsx:38` applies
      `env(safe-area-inset-bottom)`, and **no screen applies `env(safe-area-inset-top)`** — so in an
      installed iOS PWA the heading and the back control on every pushed screen sit under the status bar.
      Search's keypad and result list have the same problem at the bottom, outside the tab bar's inset.
- [x] ✅ **A shared deep link will 404 on a first visit unless the host is configured** — **the artefact
      ships as of 2026-08-11** ([ADR-130](./08-decision-log.md#adr-130--one-declaration-two-apps-the-deep-link-fallback-and-an-enforcement-claim-nobody-evaluates)),
      **and the app that actually ships was worse than this row said.** `expo export -p web` writes its
      dynamic routes as literal `dist/route/[id].html` and `dist/stop/[id].html`, so no host matches a real
      route id — the Expo PWA that WP0-5 deploys 404s on every shared link, not just on a cold one.
      Declared **once** in `scripts/pwa/redirects.mjs` beside the Workbox policy and emitted by both apps'
      `build:web`, taking its target from a shared `NAVIGATE_FALLBACK` so the worker's fallback and the
      host's rewrite cannot drift — a disagreeing pair would fail only on a first visit to a deep link,
      which is the case nobody tests locally. A **200 rewrite, not a redirect**: redirecting to `/` would
      open the app at Nearby and silently drop the place, route or query that was shared.
      **Two things still belong to WP0-5**, so this is ticked rather than deleted: the deploy step must
      **curl a deep link on the real origin once** (Pages and Netlify read `_redirects`; Workers static
      assets do too but with different precedence), and if the API is ever moved behind the app's origin a
      rule must go **above** the catch-all or `/v1/…` starts being answered with the app shell.
- [ ] 🟠 **Route detail's row tap goes to the place on `apps/web`, dropping the action sheet the spec
      declares non-optionally.** The same finding as the blocker above, from the spec's side rather than the
      store's: fixing the favourite affordance fixes this, and the two must be fixed together.
- [x] ✅ **Place detail's last kerb can never be highlighted on `apps/web`** — **this row was already
      stale**, and finding that out was the useful part. `tailRoom()` landed in `ec7053c` (the WP6-7
      owner's review) and the defect as written has not shipped since. What was actually missing was
      **evidence**: both existing assertions parse the tail *expression*, so neither would have caught a
      page that still could not scroll far enough. There is now a behavioural test that models a layout —
      jsdom lays nothing out — drives the real screen, the real scroll listener and the real `MiniMap`,
      scrolls as far as the page goes and asserts the **last** kerb's dot is the lit one, deriving the page
      height from the screen's own `tailRoom()` output rather than restating the formula
      ([ADR-129](./08-decision-log.md#adr-129--two-things-a-conformance-walker-cannot-see-colour-and-geometry)).
      Making the model exact split `SNAP_BASE` into `CARD_DOCKED_BOTTOM + MAP_GAP`, which also removes a
      second expression that could drift from the spy's own `card.bottom + MAP_GAP`.
- [x] ✅ **Three Search strings dropped from `--text-muted` to `--text-subtle` in the port** — **fixed
      2026-08-11**, and the measurement found more than the row did
      ([ADR-129](./08-decision-log.md#adr-129--two-things-a-conformance-walker-cannot-see-colour-and-geometry)).
      All three are back on `text-muted`, which is what `apps/mobile/app/search.tsx` uses for all three.
      Computed from the shipped token values rather than taken on trust: **`--text-subtle` is 3.90 / 3.55 /
      3.12 : 1** on `--bg` / `--surface` / `--surface-2` in dark and 4.76 / 4.55 / 4.34 in light — so it
      fails AA for body text in **five of six pairings**, not one — where `--text-muted` is 7.63 / 6.95 /
      6.10 and 7.58 / 7.24 / 6.92 and clears AA everywhere. No token *value* was changed; that is a design
      decision and it is the owner's. What changed is that the classification is now executable:
      `apps/web/test/search-contrast.test.ts` classifies every `--text*` token with an anti-vacuous control,
      so a new one cannot arrive unmeasured, and the `--text-subtle` assertion is a deliberate tripwire that
      goes red if the value is ever raised — so the rule gets retired rather than quietly outlived.
      **Why nothing caught it:** `conformStates` reads words, and a colour is not a word — the same blind
      spot ADR-098 names for interaction destinations and ADR-106 for the spy's geometry.
- [x] ✅ **`apps/web` carries the document scroll position into a pushed screen** — **fixed 2026-08-11**
      ([ADR-126](./08-decision-log.md#adr-126--the-navigation-moment-and-the-documents-language)), and
      **this entry's own recommendation was wrong**, which is the part worth keeping. It said the fix
      "genuinely is `<ScrollRestoration>`'s job". It is not: that component sets
      `history.scrollRestoration = 'manual'` and replaces the browser's back-restore with a single
      `scrollTo(0, y)` on the first commit of the POP — which on these screens is a **skeleton**, so it
      would trade away the direction this row says already works to fix the one that is broken. It would
      also fire on Search's per-keystroke `replace`. **Second time in two rows that `<ScrollRestoration>`
      was named as the obvious fix and was the wrong one** (ADR-109 was the first, for a different reason:
      Search does not scroll the window). Scroll, focus and the announcement are instead **one hook** with
      one definition of an arrival — a changed `useLocation().key`, never the first commit, never a
      `REPLACE` — because they are the same instant. Route detail's `scrollIntoView` reveal is a passive
      effect and therefore always wins over the layout-effect reset. Both collapsing headers are argued
      from frame timing rather than tested, **because jsdom has no `IntersectionObserver` and no suite in
      this repo can see a collapse** — an honest gap, not a covered one.
- [x] ✅ **Route detail's bus tokens keep stale row offsets** — **fixed twice, and the second one removed the
      mechanism**: ADR-108 made the observer watch every row's border box, and
      [ADR-110](./08-decision-log.md#adr-110--the-rails-resting-place-is-css-only-its-travel-is-measured)
      deleted the observer, the offset registry and the arithmetic outright. A token is positioned against
      its own row in CSS, so a refetch that redistributes arrivals lines moves the row and its bus together.

**Found while comparing, broken on BOTH renderers** (so retiring `apps/mobile` neither causes nor fixes
them; they belong to the hardening list above rather than to WP6-8):

- [x] ✅ **An offline, paused fetch renders "No scheduled service"** — **fixed 2026-08-11**
      ([ADR-124](./08-decision-log.md#adr-124--a-parked-query-is-not-an-answer)), **and it was the same
      defect as the `getStop` row further down.** Both are TanStack Query *parking* a fetch and a screen
      reading a parked query as an answer. Two gates park one: `networkMode: 'online'` means an offline
      query is never run at all (`pending`/`paused`, `fetchFailureCount: 0`, permanent), and
      `retryer.canContinue()` ANDs `focusManager.isFocused()`, so a retry scheduled while the document is
      hidden waits for `visibilitychange`. Both are `isError === false` **and** `isLoading === false` —
      because `isLoading` is `isPending && isFetching` and nothing is fetching — so Nearby's
      `loading ? … : isError ? … : list` fell through to the list, where `nearbyView([])` is `[]` and the
      screen printed `noService`: *a claim about Hong Kong manufactured from our own silence*, which is
      ADR-073's rule broken one screen over from where it was written.
- [x] ✅ **`<html lang>` is hard-coded `"en"` and never follows the active locale** — **fixed 2026-08-11**
      on both renderers ([ADR-126](./08-decision-log.md#adr-126--the-navigation-moment-and-the-documents-language)).
      Written by the component that already resolves the answer — an effect in each app's `LocaleProvider`.
      No tag table was added: the `Locale` union (`en`/`zh-Hant`/`zh-Hans`) is already the BCP-47 tag set.
      `index.html` keeps `lang="en"` as a documented pre-bundle default rather than gaining an inline
      script, which would be the second declaration of a storage key that the light-flash row already
      refuses.
- [x] ✅ **A stale reading is `opacity` alone on both** — **the opacity half is fixed 2026-08-11**
      ([ADR-123](./08-decision-log.md#adr-123--staleness-is-a-muted--before-the-figure-not-a-fade)): all
      four readouts now draw a **muted `~` before the figure** and the fade is gone. The owner's objection
      is the reason and it generalises — *a fade is a comparative cue with nothing to compare against*.
      **The relative-age half is still owed** and is deliberately not bundled: it is the "last updated,
      and four different reasons" row under *Infra / hardening* below. `stop-row.spec.json`'s `stale`
      state still asks for it, and `updatedAgo` is still unused in the catalogue.
- [x] ✅ **Nothing announces or moves focus on a route change** — **fixed 2026-08-11 on `apps/web`**
      ([ADR-126](./08-decision-log.md#adr-126--the-navigation-moment-and-the-documents-language)): focus
      moves to the new screen's `<main>` **only when the navigation orphaned it**, so a tab link keeps
      focus and Search's autofocused field keeps the keyboard, and a polite `role="status"` region names
      the destination from the matched route's `handle` (no second path→name table). **Not ported to
      `apps/mobile`**, which retires at WP6-8 — recorded as a deliberate divergence rather than an
      oversight.

**Explicitly at parity, recorded so the next reader does not re-audit it:** every screen's content, ordering
and states (all eight drive the same kernel functions and the same corpus fixtures); the destination set and
every navigation path; the location controller, the live subscription and the per-kerb outage marker; the
persisted-cache policy and the shared preferences blob; the six credited sources and both licence rows; and
i18n key usage, where a full key-by-key diff found only nine keys used on one side, seven of them explained.
Pull-to-refresh, the collapsing header's tap-to-top, the keypad's collapse-on-scroll, long-press-to-clear and
the map's label placement were all **claimed as gaps and refuted** — each is declared idiom with the choice
written down.

- [x] ✅ **Search's results list loses its scroll offset on back** — **fixed**
      ([ADR-109](./08-decision-log.md#adr-109--scrollrestoration-restores-the-window-and-the-list-that-loses-its-place-is-not-the-window)).
      The query, the mode and the chips had been restored from the URL since ADR-102 and the offset was not,
      so a rider who scrolled a long route list, opened one and came back landed at the top.
      **This entry named the wrong fix, and the correction is the useful part:** it said `ScrollRestoration`
      was the obvious one now the shell is a data router (ADR-101) — but that component restores
      `window.scrollY`, and Search does not scroll the window. It is `h-dvh` with the results in an inner
      `overflow-y-auto` box, because that is what pins the keypad, so its document offset is permanently 0
      and wiring it would have restored nothing while looking done. `useScrollRestoration` stores an
      element's offset against `useLocation().key` — the history entry rather than the URL — in
      `sessionStorage`.

## `apps/mobile` as the reference — the inventory ADR-113 owes

- [ ] 🟡 **What the RN app does that `apps/web` never got.** WP6-7b's parity audit asked one question — *what
      does a rider **lose** if `apps/mobile` retires* — and answered it well. It never asked the other one:
      *what does the RN app do **better**, or merely differently, that nobody carried over.* The owner has
      that list in their head and wants to work through it later
      ([ADR-113](./08-decision-log.md#adr-113--appsmobile-is-not-retired-at-the-end-of-wave-6-it-becomes-the-reference)),
      which is most of why WP6-8 is deferred.
      **Do it as a read of `apps/mobile`, not a diff of the two**, and separate three things a diff runs
      together: a *decision* the RN app made and the web never faced; an *affordance* the web dropped; and a
      difference that is genuinely platform idiom under ADR-100's line. The first two are candidates, the
      third is closed. Only worth starting when the owner wants to spend the sitting — an inventory nobody
      acts on is a document that ages.

## Web UI — the owner's list (2026-08-12)

> Asked for directly, after walking the shipping web app. Ordered as given, not by size. Two of the five
> are **brainstorms the owner wants to sit with** rather than tickets — they say so, and an agent that
> "just implements" them has misread the request.

- [x] ✅ **Route detail's times should arrive into skeletons, not into empty space** — **done 2026-08-12.** A delay in retrieving
      the arrivals makes the whole schematic jump as each row's readout appears. The fix is a readout-shaped
      skeleton **sized to the box the figure will occupy**, so the row's height and the right-hand column's
      x-position are settled before any number exists.
      Two things already in place that this has to respect: the screen's arms are
      `view ? content : isError ? error : skeleton` and since ADR-124 the "no answer yet" branch is
      `isPending`, not `isLoading` — so the skeleton is reachable for a *parked* query too, which is
      exactly when a rider waits longest. And the readout already reserves a fixed gutter, so a
      fixed-width skeleton is a small change rather than a new layout.
      **Built as `arrivalsPending` on `RouteStopRow`**, passed from the screen as `wantsLive && round === null`
      — `useLiveRoute` saying no round has landed, which is exactly the window in which all 34 rows gain a
      line at the same instant. Two bars sized to what they stand in for (the first slot is
      `text-body font-semibold`, the rest `text-caption`), `aria-hidden` and wordless, because the
      conformance walker reads presence and a labelled placeholder would project into every state that
      mounts before its data.
      **The part worth keeping: it is deliberately NOT drawn when a round has answered with nothing.**
      *"No bus due"* and *"we have not asked yet"* are different facts, and one placeholder for both is the
      exact conflation ADR-073 and ADR-124 exist to prevent.
- [x] ✅ **A front-facing minibus glyph for the rail's bus token, and a double-decker distinct enough to
      tell it apart** — **shipped 2026-08-12**
      ([ADR-132](./08-decision-log.md#adr-132--the-bus-glyphs-two-vehicles-and-the-three-rules-that-had-never-been-written-down)).
      Seven rounds with the owner. The decker is body 14 × 17.0 with two 3.6 bands in a derived even rhythm
      (gaps 3.27); the minibus is the same width with one 4.4 pane, roof-to-glass 3.27 (**the decker's own
      gap**, so one constant retunes both) and a filled roof sign. **Which one is drawn is the kernel's
      call** — `routeVehicle(operator)` names it, because deciding it in a view is what
      `check-no-derivation` and `check-no-adhoc-id-parsing` both forbid.
      **Three rules `docs/09` §8 had never carried** are now in it: Lucide's two radii (body 2, inner 1,
      counted in the installed set rather than derived), the tyre pill at painted 3.6 × 4.6, and
      **painted ≠ path** — painted is path + 2 wherever a shape is stroked, which is everywhere.
      **What was drawn and rejected is the valuable half:** headlights (Lucide's zero-length-path dot; they
      fit the minibus and not the decker, and a detail on one vehicle becomes a *distinguishing* mark);
      a partial bumper line (it makes the minibus read as a **two-band** vehicle, destroying the very
      difference it has to keep — *the empty face is the reason the pair works*); a concentric radius rule
      (correct arithmetic, **unobservable** — below `rx=1` the stroke decides the look); Lucide's stroke
      wheels (spindly); and dropping the stroke from the filled pill (**the stroke is the shape** — its
      round join carries the bottom of the wheel, which `rx` cannot).
      🟠 **Three of this row's own errors came from quoting a path value as a painted one.** The habit that
      catches it is rasterising and scanning the ink in **both** axes, not reading attributes.
      🟡 Not walked on a live GMB route: no GMB appeared in today's dataset near the coordinates tried, and
      the corpus's GMB route ids predate the current build. The switch rests on the kernel corpus (6 cases,
      including `GMB → minibus`) plus one of `routeDetailView`'s 24 cases being a real GMB route.
      ✅ The roof sign overlaps the body's top stroke by ~1.8 units, so it reads as a **pod fused to the
      roofline** rather than a box on it. **Confirmed as intended by the owner** — it is the "roof pod"
      variant, arrived at by accident and then kept on purpose. Not a defect; do not "fix" the overlap.
- [x] ✅ **The lab is a real component gallery, driven from the published specs** — **done 2026-08-12**
      ([ADR-134](./08-decision-log.md#adr-134--the-design-system-gallery-is-enumerated-from-the-published-specs-not-hand-listed)).
      `/lab/#gallery` prints every component's slots and states from `packages/contract/ui/*.spec.json` — the
      same ten files a native repo vendors — including **what enforces each state**, which is the field a
      porter must read before copying anything. `test/gallery-covers-specs.test.ts` makes a spec with no
      gallery entry a red build, in both directions; the list is explicit rather than globbed precisely so
      that adding a spec cannot pass silently.
      **The motions lead with the occasion, not the keyframe**, which is the owner's extension honoured: a
      keyframe name and a duration port to nothing, so each row says *what moves, on what occasion, how
      fast* first and the CSS second.
      🟢 **It found a live drift on its first run** — `stop-row`, `place-row` and `favourites` still declared
      the `opacity.etaStale` fade three days after ADR-123 removed it from every renderer, invisible because
      the state was `unenforced` and so nothing read it. **A gallery that renders prose is a gate on prose**,
      which nothing else here is.
      **The live samples landed 2026-08-13** (ADR-150, at the owner's request while reviewing the freshness
      notice): `lab/samples.tsx` draws `FeedNotice`, `StopRow` and `PlaceRow` in several states at once —
      every panel a **corpus golden** or the kernel call the screen makes, so a rule change moves the
      pictures and a renamed case is a red build (`test/gallery-samples.test.tsx` renders every one).
      🟠 **It found that the lab has no Tailwind of its own**: `tailwind.config.cjs` scans `./src/**` and not
      `./lab/**`, so a utility the app does not already use is never generated — `w-96` computed to the width
      of its own caption. Adding `lab/` to the content glob would let lab-only classes into the *shipped*
      stylesheet, which is what ADR-112's three assertions exist to prevent, so lab-only geometry is written
      as a style and everything semantic stays a token class. Worth knowing before adding a panel.
      **The set was completed 2026-08-15**
      ([ADR-154](./08-decision-log.md#adr-154--the-gallery-covers-every-component-in-the-renderer-and-the-directory-is-what-says-so)),
      at the owner's request — *"find all the components (both primitive components and multi-part
      components) … render each one in each state."* All **24** exported components now have panels (94 of
      them) in three tiers — **Primitives · Composed · Overlays** — with the corpus access split into
      `lab/goldens.ts`. The new gate `test/gallery-covers-components.test.ts` takes
      **`src/components/` itself** as its subject, which is the only thing that can be complete: most of what
      that directory holds (`BusGlyph`, `MiniMap`, `SlideNumber`, `BottomSheet`, `RailBusToken`,
      `JourneyLines`) has no published spec, so the spec-driven gate could never have noticed them missing.
      Overlays sit behind a trigger and mount for real when tapped; a panel that draws nothing declares
      **which kind** of nothing (`draws: 'no-text' | 'nothing'`), because on the page a glyph, a deliberate
      silence and a thrown component are one empty box.
      🟠 **The first cut was a flat scroll and the owner's verdict was *"very cluttered"*** — coverage and
      *reading* are two jobs and only the first had shipped. `lab/Components.tsx` is the browser over the
      same data: a sidebar that **selects** (one component, nothing else on screen), a filter over names
      **and state names**, a **Notes** toggle for pictures-only, and **Light + dark** side by side. The tabs
      are **Components · Design system · Rail motion · Bus glyphs** with Components the default, appearance
      (`auto`/`light`/`dark`) sits on every tab and writes the **real** preference, and a component is a URL
      (`#components/RouteStopRow`). The design-system page keeps `#gallery` and stops drawing components at
      all — it lists contracts, and most of `src/components/` has none.
      **Still owed:** samples for the components that are whole screens (they take a router, a query client
      and a location fix — the screens themselves are one click away), and the review section below.
- [ ] 🟡 **Review the app's error and placeholder texts as a set** — asked for by the owner 2026-08-12:
      *"add these errors and placeholder texts to the list of components we're going to review later."*
      The wording shipped so far is **accepted as the default** and is not blocking anything; what is wanted
      is one sitting looking at them together rather than one at a time, because that is the only way the
      register stays consistent. On the list: `feedNotice`'s three sentences (ADR-133), `etasUnavailable`
      (ADR-077), `liveArrivals`'s notices (ADR-114), the retired `etaStaleMark` label (ADR-123), Search's
      empty and recents prose, the FAQ answers, and every skeleton or placeholder that stands in for data.
      The gallery is where they should be surfaced, and since ADR-154 it is finally **able** to host the
      sitting: every component that carries one of these sentences now draws its states side by side.
      What it still does not do is *review* them — the words are shown, not compared.
- [x] ✅ **The LWB route chip's white text was unreadable — 2.16:1** — **done 2026-08-15**
      ([ADR-155](./08-decision-log.md#adr-155--an-operator-chips-two-colours-are-a-pair-and-the-pair-is-measured)).
      Reported by the owner off ADR-154's livery sweep, the first thing in this repo to draw all four
      side by side. `color.operatorText.LWB` is the dark ink now, like CTB's — the rule in `tokens.json`
      had said *"the yellow CTB accent always pairs with dark text"*, which is a rule stated as an
      example and was applied as one, while LWB's gold is barely darker. One edit, seven regenerated
      artefacts, both native targets fixed without being touched.
      🟢 `apps/web/test/search-contrast.test.ts` now measures **every** operator pair at `AA_BODY`
      (a route number is 14 px bold — two points short of the 18.66 px that would buy 3:1), enumerating
      `OPERATOR_ACCENT`'s own keys so a fifth operator cannot arrive unmeasured, plus an injected control
      asserting the old value **would** have failed.
      🟠 **GMB 4.71 and KMB 4.96 both pass by a hair** — the table is in `docs/09` §Operator accents;
      read it before lightening that red or that green.
      **Still unmeasured:** the operator *line* on the route schematic and the map pin's core-against-ring.
      The helper is in that file for whoever takes them.
- [ ] 🟠 **`StopName`'s `emphasis` is a no-op in light and all but invisible in dark** — found by ADR-154's
      component browser: first by putting the `here` row beside the four rows it is meant to stand out from,
      then by the **Light + dark** compare, which is what showed the worse half. `RouteStopRow` passes
      `emphasis={here}` to `StopName`, which resolves to `--accent`. In **light** that token and `--text` are
      *the same value* — `17 24 39` — so the prop changes nothing at all; in **dark** it is `226 232 240`
      against `244 246 250`. So the boarding stop is emphasised in three places (row background, rail node,
      **name**) and the third contributes nothing on either appearance — including on `apps/mobile`, whose
      `StopName` carries the identical rule and whose absence on the web was written up as a *defect* until
      WP6-7b.
      This is the Ink identity working as designed ([ADR-029](./08-decision-log.md) makes the accent the
      *ink*), which is why it is a decision rather than a fix: either the boarding stop earns an emphasis
      token of its own, or the rule stops claiming the name is one of its cues. **Do not "fix" it by
      reaching for a brand colour** — the restraint is the point (docs/09).
- [ ] 🟠 **`apps/mobile` has 31 components and no gallery at all** — the ADR-069 asymmetry, in the place a
      reviewer notices it most. `/lab/#gallery` is a DOM page and cannot render RN components; the RN app's
      own `/workbench` route lists **tokens**, not components. So the set that was just made reviewable is
      reviewable on one renderer. Cheap version: a `workbench/components` route driving the same corpus
      goldens through the RN components, with the shared half (`lab/goldens.ts`) lifted somewhere both can
      import. Whether it is worth building depends on when `apps/mobile` retires (WP6-8).
- [ ] 🟡 **The gallery is fixed at `en`** — every panel is composed in its corpus golden's own language, so
      the bilingual half of rule 5 is reviewable only where a golden happens to be Chinese (`EtaBadge`'s due
      arm, `RemarkTag`, `StopName`'s CJK case). A locale switch over the whole page is the obvious ask and
      the obvious trap: the goldens' *data* is English, so switching only the chrome would show English stop
      names under Chinese labels — a worse picture than none. It needs per-locale goldens, or a switch that
      is honest about covering the chrome only.
- [ ] 🟠 **Header rules, written down and testable — and yes, this belongs in the design system.**
      *"I want us to be a bit more thorough with how we go about things."* Today the rules are scattered
      across ADR-033 (the title morphs into a pill beside the back lens), the `CollapsingHeader` component
      and its two thin wrappers, and ADR-126 (the back control is a floating lens fixed to the top). There
      is no statement of **which kind of screen gets which header**.
      A starting taxonomy to argue with, not to adopt: (1) a **root/tab** screen — no back control, the
      title is content rather than chrome; (2) a **pushed detail** screen — collapsing header carrying a
      badge, back control always reachable while scrolled; (3) a **sheet** — no header, a drag handle.
      The questions that actually need settling: when the title collapses to a pill and what it collapses
      *to*; what must stay reachable at any scroll offset; whether a header may ever carry actions; and
      whether the collapse is scrubbed or two-state (`apps/web` is two-state and `apps/mobile` scrubs —
      recorded as deliberate, worth revisiting now rather than inheriting).
      ⚠️ **No suite in this repo can see a collapse** (jsdom has no `IntersectionObserver`), so any rule
      agreed here needs its enforcement designed with it or it is prose.
- [ ] 🟠 **Does the app need a bottom tab bar? — the owner's brainstorm, and the biggest question on this
      list.** The proposal to play with: a **more useful default home** that shows better data and *"is
      smart enough to know what to prioritise"*; **Settings as a floating top-right button**; **Nearby and
      Favourites merged**; a **bottom-right floating search button**, with **search as an overlay** rather
      than a standalone page. The owner's own caveat, and it is the right one: a tab bar probably still
      earns its place for what comes next — a full map view, rail timings, ferry timings.
      **What the architecture already says about each piece:**
      · **Merging Nearby and Favourites is the most natural of the five.** Both screens are already lists
        of `StopCardView` over the same kernel functions; the merge is a **ranking rule**, so it belongs in
        `packages/core` as a corpus-pinned `homeView` rather than in a screen. The inputs for "smart enough
        to prioritise" already exist and are already persisted: saved-or-not, distance, whether a bus is
        due soon, and `recentRoutes`/`recentStops`.
      · **Search as an overlay must stay a route.** ADR-102 put the query, mode and chips in the URL and
        ADR-109 restores its inner scroll offset against the history key — a shareable search is a feature,
        not an accident. A modal *route* keeps all of that; a component that opens over the shell loses it.
      · **A floating top-right Settings button is cheap now** — the safe-area-top work landed with the
        floating back lens (ADR-126 territory), so there is somewhere correct to put it.
      · **The destination set is identity, and it is gated.** `src/shell/destinations.ts` is a declared set
        that `shell-parity.test.ts` binds across both shells; changing it is a deliberate edit with a gate
        to update, not a refactor.
      · ⚠️ **The floating glass tab bar is *identity* under [ADR-100](./08-decision-log.md#adr-100--the-apps-signature-motion-and-material-are-identity-platform-conventional-detail-is-idiom)**,
        ported value-for-value from `apps/mobile` at the owner's own direction after the parity review.
        Removing it is a bigger call than a layout change and would amend that ADR. **Reframing worth
        considering: the tab bar is probably not the question — what is *in* it is.**

## Infra / hardening
- [ ] 🟡 **Wire the `age` header into the route watch's not-advanced retry** ([ADR-135](./08-decision-log.md#adr-135--the-live-path-hardened-against-the-networks-own-failure-modes-wp6-8b)
      decision 7). `nextRouteRoundMs` has an arm that answers `ttl − age` when a round was handed a stale
      CDN copy — the one question the `age` header genuinely answers — and **no production caller can reach
      it**: the ETA adapters return parsed readings and never surface response headers, so `EtaHub` calls
      the rule without `cacheAgeSec` and every not-advanced round takes the blind 33 s arm. Wiring it means
      an adapter return shape that carries the header out (or a header sink threaded into `fetchUpstream`),
      which touches every adapter's signature — hence a row rather than a rider on ADR-135. The arithmetic
      is already corpus-pinned, so the wiring is the whole job.
- [x] ✅ **A screen never says that it has stopped being fed — "last updated", and four different reasons.**
      **Built on Route detail 2026-08-12
      ([ADR-133](./08-decision-log.md#adr-133--a-screen-says-once-that-it-has-stopped-being-fed-and-never-a-fourth-sentence)),
      and wired on all four screens of both renderers 2026-08-13
      ([ADR-150](./08-decision-log.md#adr-150--the-freshness-notice-reaches-all-four-screens-and-offline-stops-being-a-state-nothing-could-see)).** `feedNotice` in the kernel with a 9-case corpus
      decides which of the states a screen is in — precedence `offline` → `unreachable` → `lastUpdated` →
      `none`, because each earlier state *explains* the later ones — and one shared `FeedNotice` component
      draws it in `text-muted`, silent in the ordinary case.
      **The fourth sentence is deliberately absent**, which is this row's own most important line honoured:
      an upstream board refusing already has vocabulary, and a screen-level duplicate could disagree with it,
      because a live round asks each pole separately. Route detail can therefore show *two* lines at once,
      and that is right — they answer different questions.
      **What ADR-150 added:** two kernel adapters (`newestNearbyBoard`, `newestPlaceBoard`) so the decision
      *which field is the board's clock* — `dataTimestamp`, never the `observedAt` our own layer restamps on
      every fetch — stays out of six call sites; the notice as a `oneOf` slot in all four screen specs; and
      **`stale` and `offline` promoted from `unenforced` to projected on eight surfaces.** That last one is
      the part worth carrying: all four specs had refused to enforce `offline` in the same words —
      *"textually identical to `stale`"* — which was a statement about the gap, not the design. A screen with
      nothing to say about *why* it stopped being fed is one a harness cannot tell from a stale one, because
      a rider cannot either.
      **Still owed, and none of it blocks:**
      · the wording is a placeholder awaiting the owner (ADR-114/122 precedent) — it is on the
        error-and-placeholder review row above;
      · **a reading from yesterday reads as today** — `formatClock` is `HH:MM` with no date, so a payload
        replayed from the persisted cache after midnight says *"Last updated 23:58"*. Visible in this repo's
        own goldens now: several Place-detail conformance states are driven from corpus payloads captured two
        days before their `now`, and they project a time from another day. The honest fix is a date-aware,
        locale-aware format;
      · `trouble` still collapses *"the Worker said no"* and *"the fetch never arrived"* into one sentence —
        ADR-124 showed they are distinguishable (an `EdgeRequestError` carries the Worker's own `code` and
        `retryable`, a bare `TypeError` does not) when one earns its own words.
- [ ] 🟡 **`apps/mobile` has no network signal on iOS or Android, so it never says *"You're offline"*.**
      `useOnline` reads `navigator.onLine`, which is a web API: real under `react-native-web` (the Expo PWA,
      and both conformance suites), absent on native, where the hook type-guards the read and answers `true`.
      That is the honest value — ADR-133's asymmetry is that `false` is evidence and `true` is only the
      absence of it — so a native build falls through to the `unreachable` arm when its requests start
      failing, which is also what covers a captive portal on the web. A real signal is `expo-network`'s
      `useNetworkState()` or NetInfo, version-aligned per CLAUDE.md rule 6, and probably an **eighth port** in
      `packages/ports` rather than a screen-level import: "does the platform have a network" is a platform
      fact handed in like a clock, and `ls packages/ports/src` is the porting checklist a native repo reads.

      <details><summary>The original scoping, kept because the four-state table is still the plan</summary>

      **Promoted to 🔴 and given the whole job on 2026-08-12**, at the owner's direction: *"I still don't
      love graying the text, it's confusing on its own. I'm happy to remove this feature for now (the tilde
      and gray text) … let's allow a basic error messaging/alerts system to convey if the times are out of
      date. Include that with our todo regarding error handling."*
      So **the per-reading staleness cue is being removed** — both the `~` and the fade it replaced — and
      this row is now the only thing that tells a rider a reading is old. Until it lands, **nothing does**,
      which is why it is 🔴 rather than 🟠: ADR-008 ("indicate staleness") is a golden rule, and this row is
      the last thing standing under it.
      **The reason the per-reading cue never felt communicated, which shapes what to build:** staleness is
      a property of the **board**, not of each figure. `isStale` reads one `dataTimestamp` per board off the
      operator's clock, so Route detail was drawing **one fact 78 times** — and a rider cannot act on
      *"this particular number is two minutes old"*. What they can act on is *"the screen has stopped
      updating"*, which is a screen-level statement, which is this row. Neither treatment was badly
      executed; both were **the wrong unit**.
      **The cheapest honest first slice** is therefore one line per screen, not a per-row marker: *"Last
      updated 21:34"* whenever the newest board on screen is past the served `staleAfterMs`. That alone
      restores ADR-008 compliance and is a fraction of the four-state work below.
      Asked for by the owner 2026-08-11 after finding it with the local Worker down (screenshot, route 86K):
      every row kept ageing its times normally and nothing said the data had stopped arriving.

      **The countdown itself is correct and must stay.** Arrival times are absolute instants, so the minute
      labels recompute against a ticking clock with no new data — which is exactly why staleness is read off
      `dataTimestamp` rather than off "did a fetch succeed" (ADR-058, ADR-122). What is missing is the
      *statement*, not the behaviour.

      **Why nothing covers it today.** `apps/web/src/screens/RouteDetail.tsx` renders
      `view ? … : query.isError ? … : skeleton`, so the error arm is only reachable when there is **no view
      at all**; with `keepPreviousData` and ADR-058's persisted cache there almost always is one. The only
      remaining signal is the per-row staleness mark — **a muted `~` before each figure since
      [ADR-123](./08-decision-log.md#adr-123--staleness-is-a-muted--before-the-figure-not-a-fade)**, where
      it used to be a 45 % fade — which is per-row rather than per-screen and says *this reading is old*
      rather than *we have stopped being fed*. Since ADR-122 it lands at 120 s. A rider on a dead
      connection sees a normal-looking screen for two minutes and a tilde-marked one after that. **The `~`
      makes this row easier, not unnecessary:** the cue is now legible, but it is still a property of one
      reading, and none of the four sentences below can be inferred from it. Note the shape it shares with
      ADR-114: there, silence read as data; **here, stale data reads as live.**

      **Four states, four sentences, and collapsing them is the trap.** They differ in what a rider should
      *do*, which is the only test that matters:

      | state | how it is detected | what it means to a rider |
      |---|---|---|
      | **stale, nothing failed** | last successful fetch is older than the cadence; no error | *"Last updated 14:19"* — the data is old and we are still trying |
      | **no connectivity** | `navigator.onLine` false, or a fetch that failed with no response | *"You're offline"* — their problem to fix, and the times on screen are the last we had |
      | **our edge unreachable / erroring** | fetch rejected against a reachable network, or a 5xx from our own Worker | *"Can't reach NextBus"* — our problem, retrying |
      | **upstream refused** | the edge answered, and said so: `EtaFailure` / `liveArrivals` / an `upstream_unavailable`\|`upstream_timeout` code | already has vocabulary — *"Live times unavailable"* (ADR-073/077/081/114) — **do not rebuild it here** |

      The last row is the important one: three quarters of this work is new, and one quarter already exists
      and must not be duplicated with a second sentence that can disagree with the first.

      **What it needs, in the order it should be built:**
      1. **The kernel decides which state a screen is in**, from what it is handed — not a screen writing
         `isError ? … : isPaused ? …`. That is a view function with corpus rows, in the shape
         `placeDetailView`/`routeDetailView` already have, and it is what stops four screens each guessing.
      2. **One component**, because Nearby, Place, Route detail and Favourites all need the same line and a
         second copy is a second wording. Both renderers draw it, so it is a **spec** addition and both
         conformance suites hold it.
      3. **Catalogue keys in three locales** (en / zh-Hant / zh-Hans) plus the generated native strings.
         **Owner's call on the wording** — the four sentences above are placeholders, and the same
         reservation as ADR-114's applies.
      4. **A clock question worth settling deliberately:** *"Last updated 14:19"* is an absolute time, which
         ADR-008 prefers to a fabricated relative one ("2 minutes ago" ages while nobody re-renders) — but it
         needs the locale's time format, and a reading fetched yesterday should say so rather than reading as
         today. Cheaper alternative: show it only while stale.

      Related and deliberately separate: the **`retryable` half of the taxonomy already tells a client
      whether to keep asking** (`ERROR_CODES` in `packages/contract`), so this line should render that
      distinction rather than invent one — a permanent failure and a transient one are different sentences,
      which is the same argument ADR-114 made for `unavailable` versus `perStopOnly`.

      </details>

- [x] ✅ **A poll-emulated route watch is ~19× the upstream fan-out of a socket one, and can silently lose
      the watched route's own times — fixed 2026-08-13 by
      [ADR-136](./08-decision-log.md#adr-136--the-batch-endpoint-learns-the-route-question-v1etasroute):
      `/v1/etas?route=` resolves the poles and narrows server-side (the fix the row sketched as option (b),
      route-shaped rather than per-id), and `watchRoute`'s poll path rounds are now ONE request.** All three
      consequences below close together, because they were one cause: `boardsFor` now engages on the poll
      path exactly as on the socket's, so the fan-out is per-pole, a sibling route's failure cannot mark this
      route's kerb, and `LIVE_CTB_BUDGET` counts only the watched route's own calls. The fix mattered more
      after ADR-135 than when this was filed: the supervised fallback routes riders on WebSocket-hostile
      networks onto this exact path automatically, so "affects only somebody who selects `poll`
      deliberately" stopped being true. Measured 2026-08-13 against the live feed: an un-narrowed chunk of
      12 of Citybus 182's poles was 10.0 s (timeout-bounded; 19.9 s in ADR-121); the same poles narrowed,
      0.25 s. Kept below as filed, for the history:
      Found by an adversarial review of ADR-116–120 (2026-08-11); **not a
      defect in the route watch, but in what the batch endpoint can express**. **Demoted from 🟠 the same
      day: `socket` is the default engine now (ADR-121)**, measured on the route that prompted it — Citybus
      182's round was 395 upstream calls and 75.7 s on `poll` against 31 calls and ~1.2 s on the socket, and
      75.7 s against a 30 s cadence is why rounds queued. Everything below is still true of `poll`; it now
      affects only somebody who selects it deliberately, which is what an environment with no WebSocket path
      has to do.

      **Two distinct consequences, both traced to one cause** — `/v1/etas?ids=…` carries no per-id route
      list (there is no safe delimiter; `,` is a legal `idchar`), so `watchRoute`'s poll path asks each pole
      **un-narrowed** and narrows the readings client-side afterwards:

      · **The fan-out is the one ADR-117 removed.** A narrowed read narrows the *questions* only when
        `routeIds` reaches `boardsFor` — which the socket path supplies from the object's name and the batch
        endpoint cannot. ADR-117 measured the un-narrowed shape at **350 upstream calls per round for an
        18-pole route** against 18 narrowed. So the poll path reintroduces exactly that, per rider, on free
        government feeds. *(ADR-120's stated cost, "one `/v1/route/:id` plus a batch per round", is wrong on
        both counts — 41 poles is four batches at `ETAS_BATCH_MAX_IDS = 12`, each fanning out un-narrowed.
        Corrected in the ADR.)*
      · **`failed` names the wrong outage, and a departed bus can stick.** A pole's failure is recorded per
        **pole**, not per (pole, route), so a sibling route's board timing out at a shared kerb marks that
        kerb `failed` for a subscription that only asked about *this* route. `retainFailedPoles` then keeps
        the previous reading — a bus that has left stays on the schematic while any sibling route at that
        pole keeps failing — and `RouteStopRowView.incomplete` prints *"Live times unavailable"* on a row we
        did ask about and did get an answer for. The socket path cannot do either: `boardsFor` restricts the
        calls to the one route, so only that route's own call can fail.
      · **And `LIVE_CTB_BUDGET` can drop the watched route entirely.** At a place with more than 12 distinct
        CTB (pole, routeNo) pairs — `eta-hub.ts` records **347 real places** — `memberEtaLists` walks in
        document order and `break`s; a route past the twelfth is never called, which produces **no** `failed`
        entry and **no** reading. The row renders as an ordinary "no bus due". Silent, and invisible to the
        socket path for the same reason as above.

      **What a fix looks like, in ascending order of cost:** (a) `watchRoute`'s poll path calls
      `/v1/etas/:id?routes=…` per pole instead of the batch — narrow and correct, 41 requests per round
      instead of 4, and the edge already coalesces them; (b) the batch endpoint learns a per-id route list
      with a delimiter the id grammar can spare; (c) turn the socket on by default and let the poll emulator
      remain what its name says. **(c) is the direction `proposals/05` already points**, so the honest
      sequencing is to decide that first — this row exists so nobody reads ADR-120's cost line and believes
      the shipped default is cheap.
- [x] ✅ **`live-rounds.test.ts`'s connect round was a race, and `a-refusing-board-is-not-a-departure` was
      where it showed** — **fixed 2026-08-10** by the counter this entry asked for, added for the route
      cadence in the same sitting (WP6-B step 2b, ADR-118). `EtaHub` now keeps a monotonic
      `roundsCompleted`, incremented as the **last** statement of `round()` — so `n` rounds counted means
      `n` rounds' frames are already queued — and the driver waits on it before `settle()`. The counter says
      *the round is done*; quiet still says *and nothing more is coming*.
      **Proved, rather than declared fixed because it stopped flaking:** delaying every board by 300 ms (past
      `QUIET_MS`) makes the race deterministic, and with the wait removed **10 of the 21 rows fail**,
      including the row named above; with it, all 21 pass. **No time cost** — the file runs in 6.3 s, against
      the 8 s it took before and the 27 s the rejected wider-quiet-window fix cost.
      The original diagnosis is kept below because the two rejected fixes are worth not repeating. Distinct from the timeout entry below, which is **fixed** — raising the edge project's hook
      timeout stopped the file dying in its `beforeAll` and let CI run it for the first time in three
      attempts, at which point one row failed on an *assertion*:

      ```
      - "live etas=[A/R1@+2 A/R6@+7] watching=[A] failed=[]"      ← expected
      + "live etas=[] watching=[A] failed=[]"                     ← received
      - "retrying!upstream_unavailable etas=[A/R1@+2 A/R6@+7] …"
      + "retrying!upstream_unavailable etas=[] …"
        "live etas=[A/R1@+5 A/R6@+7] watching=[A] failed=[]"      ← round 3 correct
      ```

      **The mechanism, and the file's own preamble names the assumption it breaks.** It says silence is safe
      to infer because *"nothing in this object defers a send"* — true, but the *work between* two sends is
      not free. Rounds 1..n are driven by `runDurableObjectAlarm`, which is awaited, so their frames are all
      queued before `settle()` looks. **Round 0 is not**: the upgrade returns as soon as the socket exists and
      the shard's first fan-out (one `fetch` per pole, through Miniflare) runs after it. So the snapshot can
      land, then the readings, with real work in between — and `QUIET_MS`'s 150 ms of quiet can fall in that
      gap. Round 2 then retains the nothing round 1 recorded, and round 3 recovers, which is exactly the
      three-line shape above.

      **Two fixes tried and rejected, with their measurements, so nobody repeats them:**
      · *A wider quiet window for round 0.* Correct but expensive: `settle()` pays its window at least twice
        per call, so a 1 s connect window took the file from **8 s to 27 s** locally.
      · *Driving round 0 through `runDurableObjectAlarm` like the others.* **A no-op** — it returns `false`
        for all 21 scenarios, because no alarm is pending at connect. `round()` is reachable only from
        `alarm()` (`eta-hub.ts:572`), so the connect round is a floating promise inside the upgrade that the
        test cannot observe. Verified with a temporary assertion rather than assumed; shipping this would
        have been a fake fix that left the race untouched.

      **What a real fix looks like:** give the test something *observable* to wait on instead of quiet — the
      shard already keeps per-round state for its cadence ramp, so a "rounds completed" counter read through
      `runInDurableObject` would let round 0 be awaited deterministically, at no time cost. Alternatively make
      the connect round alarm-driven, which would also make the second fix above work. Either is a change to
      `eta-hub.ts`, so it wants care and its own sitting rather than being bolted onto an unrelated branch.

      It was a **test** race and not a product defect: the three-line shape was the test mis-reading a
      correct shard.
- [x] ✅ **`apps/edge`'s workerd suites timed out on a cold CI runner** — **fixed 2026-08-10** by giving that
      project its own `testTimeout`/`hookTimeout` in `apps/edge/vitest.config.ts`, after a **third** sighting
      blocked two pushes in a row.
      Three failures, all *timeouts* rather than assertions, and the last two on commit ranges that touched
      **nothing** under `apps/edge/` (verified with `git diff --name-only`, package green locally):
      `dataset-kv.test.ts` at the 5 s **test** default, and `live-rounds.test.ts` twice at the 10 s **hook**
      default.
      **What made it diagnosable was measuring the hooks rather than guessing:** `live-rounds`' `beforeAll`
      seeds a whole dataset build into simulated KV and costs **~1 s locally**; each `beforeEach` is
      **≤22 ms**; the slowest single test in the package is **643 ms**. So a hook blowing 10 s on CI is a
      **>10× cold-runner blowup** — zero turbo cache, a ~38 s cold import, contended disk — and not a slow
      hook. The fix is therefore sized (60 s and 20 s, ~60× and ~30× measured) rather than picked, and
      **scoped to this project**: every other package's suites are node-speed, where a 5 s default is doing
      real work.
      **The lesson worth keeping is about the entry, not the timeout.** It was filed twice as "flake,
      re-run", and the second time it was narrowed wrongly to one file. A gate that needs a re-run to pass
      is a gate people stop reading — which this entry itself said — so the third sighting should have been
      the first fix, not the third filing.
- [x] ✅ **Two tabs of the PWA silently overwrite each other's preferences — including a rider's
      favourites** — **fixed 2026-08-11**
      ([ADR-125](./08-decision-log.md#adr-125--preferences-are-merged-not-overwritten-and-the-ancestor-moves-with-the-write)).
      **Two corrections to this entry, and both matter more than the tick.**
      **(1) The fix it names is not sufficient.** *"One `storage` listener per store"* cannot help a writer
      that was never told: a bfcached tab is **frozen** and `storage` events are not queued for it, which is
      the widest stale window there is. So the three-way merge sits on the **write** path, and the listener
      is only what makes the other tab's change visible without a reload (plus a `pageshow`-with-`persisted`
      re-read for the window no event announces).
      **(2) 🔴 The first implementation of that fix caused the data loss it was written to prevent**, and an
      adversarial review caught it before it left the branch. The read-modify-write was unserialised, so the
      merge's ancestor could advance past the snapshot a concurrent write was holding and `mergeSavedKeys`
      read `base \ theirs` as a remote deletion. **Three manifestations, none of which needs a second tab:**
      two stars in one task erased the first; a `storage` event in the same task as a star erased the star;
      and an un-star plus a star in one task **resurrected the un-starred key**. The rule that fixes it —
      *the ancestor moves only with a write, and the adopt path therefore does not advance it* — is the half
      an obvious "just serialise the writes" fix does **not** have.
      Also worth keeping: **set-union was considered and is a worse bug than the original** — with a union,
      un-starring in one tab is undone by the other tab's stale copy, so a rider with two tabs cannot delete
      a favourite at all.
      **(3) 🔴 A second adversarial pass over the corrected fix found three more, one worse than the
      first.** Sixteen interleavings, five findings, all closed — and the pattern across both rounds is the
      lesson: **every one of the six defects the merge introduced was a sequencing error around correct
      arithmetic.** The kernel needed no change at either round. The blocker was the web store advancing its
      ancestor past a write the disk *refused* — reachable with **no second tab at all**, because
      `safeLocalStorage` swallows a `QuotaExceededError` and the origin is genuinely fillable (the query
      cache persists through the same wrapper, ADR-058). `setItem` reports success now. The others: memory
      adopting the merge on the wrong side of an `await`; a blob merely *missing* `favoriteRoutes` being
      destructive where an unparseable one was safe; and a **hung** write wedging every later write for the
      session, because `then(job, job)` continues from a settlement and a hang is not one.
      **Two residuals, stated because neither is fixable in the merge:**
      · 🟠 **For the whole rollout window the other writer is a build without this commit** — the installed,
        service-worker-cached Expo PWA. It writes the whole blob from a stale copy, and our handler
        correctly reads the difference as deletions. The argument for trusting a deletion holds only once
        *every* writer on the origin merges; never trusting one is the worse bug.
      · 🟠 The 🟠 below — *a preference that could not be saved is not reported to the rider* — is worth more
        than it looked, and is now the honest place to finish this: reporting the failure is what would let
        a rider know their choice did not stick, rather than the store silently declining to advance.

      <details><summary>The original report, kept because the reproduction is still the right one</summary>

      Found by WP6-7 while declaring Settings' `stale` state
      ([ADR-096](./08-decision-log.md#adr-096--a-screen-with-no-data-still-has-five-states-and-attribution-is-one-of-them)
      decision 9), and pinned as that spec's `knownDefect`. Two stores share the `nextbus.preferences` key
      (ADR-089), **neither listens for a `storage` event** (verified: no listener exists in either store or in
      `safeLocalStorage`), and zustand's `persist` writes `partialize`'s output as the **whole** blob. So a
      second tab holds a stale copy in memory from the moment it loaded, and the next thing it writes — a
      language change, an appearance change, or a starred route — reverts everything the first tab did since.
      It is ADR-082 decision 5's hazard between two *apps*, arriving between two tabs of one, and the data at
      stake is the only data in this app a rider made by hand. **The fix is one `storage` listener per store**
      that re-reads and merges, which is a producer fix rather than anything on the Settings screen (ADR-090,
      third instance). Reproduction: open `/settings` in two tabs, change the language in the first, then star
      a route in the second, then reload the first.

      </details>
- [ ] 🟠 **A preference that could not be saved is not reported to the rider.** The other `knownDefect` WP6-7
      declared (ADR-096 decision 9). Storage can refuse — Safari private browsing, a full quota, a wiped
      profile — and both stores write through a wrapper that swallows the throw so the app keeps running, with
      zustand's `persist` reporting nothing to a component. The screen then shows a choice that will not
      survive a reload, which is the honest definition of lying to a rider about their own data. Needs the
      wrapper to surface a failure and the screen to draw Settings' declared `failed` state.
- [x] ✅ **`accessibilityState` announced nothing on the shipping PWA** — **fixed by WP6-7**
      ([ADR-097](./08-decision-log.md#adr-097--the-conformance-walker-sees-presence-not-visibility--and-an-aria-state-it-cannot-see-is-one-a-rider-may-not-be-getting-either)
      decision 5). `react-native-web@0.21` forwards the modern `aria-*` props and **drops
      `accessibilityState` entirely**, so six controls — both Settings pickers, the search chips, the search
      mode segment, the save star and the FAQ disclosure — announced no state at all to a screen reader on the
      Expo PWA. All six are `aria-*` now, which maps to `accessibilityState` on native. Measured before and
      after in a live browser: 0 `aria-pressed` elements on `/settings`, then 7 with exactly 2 lit.
      **Whoever audits `apps/mobile` against `apps/web` should treat this as the template**: the defect was
      invisible to typecheck, lint, every gate and every existing test, and was found only by writing an
      assertion that expected to check something.
- [x] ✅ **`packages/core/src/favourites.ts` was outside the 100 % coverage threshold** — **fixed by WP6-7**
      (ADR-097). The `include` list in `packages/core/vitest.config.ts` is hand-spelled and the module was
      never added when WP6-4 created it, so the rule a rider's curated list survives on sat outside the gate
      for a whole wave while the gate reported green. Adding it revealed **eight untested branches**; all are
      covered now and the config carries a paragraph about the hazard.
- [x] ✅ **`apps/web`'s `.test.tsx` suites were invisible to `pnpm typecheck`** — **fixed by WP6-7** (ADR-097).
      `tsconfig.json` included `test/**/*.ts` and not `test/**/*.tsx`, so seven conformance suites were never
      typechecked; two real type errors surfaced the moment they were included.
- [x] ✅ **Route detail cannot say "we could not ask"** — **fixed**
      ([ADR-114](./08-decision-log.md#adr-114--eta-null-on-every-stop-meant-three-different-things-and-the-route-view-could-not-say-which)).
      `eta: null` on every stop meant three different things — no bus is due anywhere, the round did not
      answer, or nobody was ever going to ask — and a schematic rendered identically for all three, which is
      how every Citybus and GMB route read as "no bus is due" for two waves. `RouteDetail.liveArrivals` is
      the difference, `routeDetailView` exposes it as a total three-way arm, and both renderers say it once
      above the schematic.
      **Two things this row had wrong, corrected there rather than quietly:** it prescribed a
      `CONTRACT_VERSION` **minor bump** *"since it is additive"* — the opposite of ADR-052 §5 and of the
      constant's own note, which say an additive-optional change must not touch it (three precedents:
      ADR-065, 079, 081); and it prescribed `failed`, an `EtaFailure[]`, copied from `/v1/nearby`. A route is
      **one** upstream call, so a list of poles would invent a granularity the fetch does not have.
      **The half nobody would have noticed missing is the KMB one**: its route feed answers, so the
      `.catch(() => [])` that swallowed an outage made it read as a quiet route — for every rider in the app.
- [x] ✅ **A rider on a Citybus or GMB route can get a time from the route screen** — **done**
      ([ADR-115](./08-decision-log.md#adr-115--the-sheet-a-rider-already-opens-is-where-one-stops-times-go)).
      Tapping a stop opens the save sheet it always opened, and the sheet now carries that stop's times for
      this route — one request, scoped to the pole and the route, and only when there is nothing already on
      the row. Verified live on Citybus 91: a schematic with no times anywhere, and 15 min · 34 min in the
      sheet. The accordion other apps use was rejected because it competes with the affordance the row
      already has (ADR-032's save sheet); putting the times *in* that sheet makes the menu the load trigger.
- [ ] 🟡 **A Citybus or GMB route says "Live times unavailable" where it could point at the per-stop
      boards.** *(Less pressing since ADR-115 — a rider is now one tap from a real time rather than from
      nothing — and it disappears entirely if the route view starts fanning out.)* The remaining honesty gap after ADR-114, and it is a wording decision rather than a defect:
      those operators' **per-pole** boards answer fine (`/v1/etas/CTB:001028` → 10 routes with arrivals), so
      the times a rider wants are one tap away on any stop of that route. "Unavailable" is true, implies
      *try later* about something permanent, and hides where they are. Needs one new catalogue key in three
      locales and one `shows` edit — `noLiveBoard` and `arrivalsUnavailable` are already two states sharing
      one sentence precisely so that this is that small. **Owner's call on the wording.**
- [ ] ⚪ **Fetching them per pole, considered and not done.** The edge could fan out one call per pole and
      give a Citybus route real live times. A 34-stop route is 34 subrequests, every 30 s, per rider, against
      the Workers subrequest budget — so it is a decision about cost and load, not a bug, and it is
      deliberately not a side effect of ADR-114.
- [x] ✅ **The four route fact sheets still derive** — **done as WP6-6c**
      ([ADR-095](./08-decision-log.md#adr-095--the-estimate-mark-is-content-and-so-is-the-separator-between-two-day-names)).
      All eight decisions are `routeFactSheet`'s, with 15 corpus cases; both renderers project it, `apps/web`
      has the sheets as a `<dialog>`, and `RouteFactSheets.tsx` joined `check-no-derivation`'s `POLICED` list
      **with no new allowlist entries**.
- [x] ✅ **A route whose per-stop fares are not numbers opens an entirely blank fare sheet** — **fixed
      2026-08-11** ([ADR-128](./08-decision-log.md#adr-128--a-fare-sheet-with-nothing-in-it-is-the-strip-contradicting-itself)).
      One new private kernel function, `wholeRouteStage`: when `fareStages` yields nothing the timeline
      falls back to a **single stage spanning `1 … stops.length`** priced at `service.fareFull`, boarding at
      the origin row, and priced for concessions through the **existing** `concessionFigures` helper — so
      ADR-107's `min(adult, max($2, 20%))` cap is applied once rather than copied onto a second path.
      `routeFactSheet`'s exported signature is unchanged, so neither renderer needed an edit.
      **The root cause is worth keeping, because it is a shape rather than a bug:** `fareStages` and
      `fareRange` reject an *identical* set of values, and two surfaces disagreed about what to do next —
      the strip fell through to `service.fareFull` and printed `$13.4`, the sheet had no fallback at all.
      So this was never a defect in either guard; it was **the missing second half of one decision**, which
      existed for the pill and nowhere for the sheet. That identity is also what makes the fix sound: no
      stages implies no span, which is exactly when the pill is showing `formatFare(service.fareFull)`.
      The corpus row was **renamed, not merely re-expected** —
      `…-opens-an-entirely-blank-fare-sheet` → `…-opens-with-the-fare-the-pill-showed` — because the
      property it pins (what the sheet says when the fares are unreadable and the pill shows one anyway) is
      unchanged while the answer is not. Two rows added so an empty timeline stays a *measured* state:
      no fare anywhere (nothing invented — no `$0`, no `~$2.0` from an absent adult fare) and no stops.
- [ ] 🔴 **Why does a failed `getStop` leave the query pending-and-idle rather than `error`?** Found by
      WP6-3b ([ADR-088](./08-decision-log.md#adr-088--place-details-spec-its-dom-port-and-the-gate-that-finally-reads-both-renderers))
      and **half fixed**: the screen no longer renders nothing (the skeleton is the fallback arm on both
      renderers, so no query state draws a blank), but the underlying state is still wrong. Reproduction, on
      either app: open `/stop/CTB:999999`. The Worker answers **404 once**, `EdgeRequestError` is thrown, and
      the query settles at `status: 'pending'`, `fetchStatus: 'idle'` — so `isError` is false, the rider never
      sees *why*, and `refetchInterval`'s `status === 'error'` predicate (ADR-079's fix for the permanently
      dead screen) never fires, so nothing ever retries either. **It is environmental, not a render bug**: the
      identical rejection in `test/place-detail-states.test.tsx` lands on `error` and shows the message, and a
      probe with `retry: 1` and a real delay does too. Candidates, in order: `retry: 1` with a retry that is
      *paused* rather than run; `PersistQueryClientProvider`'s restore interacting with a first-load failure;
      the service worker turning a cross-origin 404 into something `classifyFailure` cannot read. Worth an
      afternoon — every screen in the app shares this shape.

      **✅ Answered and fixed 2026-08-11** ([ADR-124](./08-decision-log.md#adr-124--a-parked-query-is-not-an-answer)).
      **The first candidate was right, and it is the same defect as the offline "No scheduled service" row
      above** — one mechanism, two screens, filed twice. Measured three ways rather than reasoned about: a
      harness mounting the app's real `QueryProvider`, a live `pnpm dev:edge` + `pnpm dev:dom` driven in
      Chrome, and a read of `@tanstack/query-core@5.101.4`'s source.
      Two gates park a fetch — `networkMode: 'online'` (offline ⇒ the query function is never invoked;
      `pending`/`paused`, `fetchFailureCount: 0`, permanent) and `retryer.canContinue()`, which ANDs
      `focusManager.isFocused()`, so a retry scheduled while the document is **hidden** waits for
      `visibilitychange`.
      **And the `fetchStatus: 'idle'` in this row — the detail that hid the mechanism for two waves — is
      what a *parked* query becomes when its last observer detaches:** `Query.removeObserver` →
      `#isInitialPausedFetch()` → `retryer.cancel({ revert: true })`, restoring the pre-fetch state with
      the failure count **erased**. Both `<StrictMode>` and any navigation away trigger it. So it looked
      like a query nobody had ever asked.
      **Why the suite disagreed with the browser**, which is the reusable lesson:
      `test/place-detail-states.test.tsx` builds its own `QueryClient` with `retry: false` and runs against
      a visible jsdom document, so **neither gate is reachable there**. A suite that configures away the
      environment cannot see an environmental defect.
- [ ] 🟠 **A bus token that waits for a measurement draws nothing when the measurement never arrives** —
      **the symptom is fixed, the cause is the row below.** WP6-6b (ADR-094) found that the RN route
      schematic's overlay skipped any token whose target row had not reported its `onLayout` offset, so a
      route whose rows never report has a **silently empty rail**. It is the same react-native-web gap as
      `MiniMap`'s, one screen over, and the conformance suite could not reach a single bus state until the
      guard went. An unmeasured token now sits at the top of the rail and slides down to its node, which is
      the entrance animation anyway — so the tokens always exist. What is still unfixed is *why* `onLayout`
      does not fire on first mount, which is the next row.
- [ ] 🟠 **`MiniMap`'s `onLayout` does not fire on first mount** on the RN Place screen, so the map renders
      with `w === 0` — no tiles, no dots — until something else triggers a layout. Measured 2026-08-05 by
      dispatching a `resize` event by hand, which made the whole map appear at once. The DOM twin does not
      inherit it: `apps/web/src/components/MiniMap.tsx` takes its first measurement in a layout effect and
      keeps a `ResizeObserver` only for later changes. The RN fix is the same shape — measure once on mount
      rather than waiting to be told.
- [ ] 🟠 **Route auto-scroll doesn't land on web** — `app/route/[id].tsx` should scroll to the originating stop
      (the two-step reveal's second beat, [ADR-043](./08-decision-log.md#adr-043--a-core-navigation-animation-system-cross-fade-tabs-slide-and-reveal-stack-web-swipe-back)),
      but the `scrollTo` no-ops on react-native-web (reproduced with the ADR-043 reveal-gate **and** `animated` flag
      neutralised, so it predates that work). The gating mechanism is in place; needs the underlying scroll fixed
      (likely a measurement / `Animated.ScrollView` `scrollTo` timing issue on web). Native unaffected.
      **Re-measured 2026-08-05 during WP6-6a**, and the measurement narrows it usefully: on
      `/route/KMB:1A:outbound:1?stop=KMB:04BED071257A601F` the `Animated.ScrollView`'s own `scrollTop` samples
      **0 for five seconds** after load — the window never scrolls at all (`document.scrollHeight` equals the
      viewport, so the scroller is the inner element and reading `window.scrollY` will mislead you). Then a
      single click anywhere on a row **does** land the scroll, with row 8 arriving at the top of the list. So
      it is not that `scrollTo` cannot work on web: something about the reveal gate never satisfies itself
      until an interaction flushes it. `usePageRevealReady` is the first suspect, since a direct URL load
      produces no navigation event for it to observe. **WP6-6b meets this head-on** — the DOM port scrolls the
      document and needs no `scrollTo` at all, which will make the two renderers visibly disagree until this
      is fixed.
- [ ] **Web down/back slide animation** — ADR-043 reverted the JS stack (it broke web scrolling), so on web the
      down/back transition is an instant cut; the slide + reveal is native-only. If a web push/back animation is
      wanted, do it *purely additively* with per-screen Reanimated `entering`/`exiting` (no navigator swap):
      push-in is reliable; reveal-on-pop is hard on web (native-stack hides the outgoing screen instantly). Also
      consider an interactive follow-the-finger web swipe-back (currently threshold-triggered + instant).
- [ ] 🟡 **`BottomSheet` slide-up doesn't complete on web** — `components/BottomSheet.tsx`'s `onPanelLayout`→
      `withTiming(0)` entrance doesn't run on web; the panel mounts but only its grab handle peeks (likely cancelled
      by the handle pan's `onBegin`→`cancelAnimation`, or the layout-driven entrance not firing on react-native-web).
      Affects the route schematic's stop action sheet. Independent of ADR-043 (which only un-clipped it).
      **Did not reproduce on 2026-08-05** (WP6-6a, Chrome, `:8081`): the route schematic's stop action sheet
      opened fully — title, route subtitle and both actions — with the handle at the panel's top where it
      belongs. Left open rather than closed, because "did not reproduce once" is not "fixed": nothing changed
      here deliberately, so either the cause is timing-dependent or an unrelated edit moved it. Whoever closes
      it should say which.
- [ ] Upstash Redis (only if we need true Redis semantics beyond KV + Durable Objects).
- [ ] Analytics (privacy-respecting) for most-watched stops → smarter pre-warming of caches.
- [ ] Self-hosted MapLibre tiles (if tile-provider cost/limits become an issue).
- [ ] Git-native pre-commit hook (shared `.githooks/`) mirroring the docs-freshness check for
      non-Claude contributors. See [Decision Log ADR-013](./08-decision-log.md).

## Design / brand
- [x] **App icon — DONE.** Clean road-sign / transit-pictogram: a **side-profile double-decker**,
      white symbol on an **ink (`#111827`)** field, two glassy windows (door gap), centred round
      wheels, body+windows leaned **−8°** for motion. Master at `apps/mobile/assets/icon.svg`;
      assets generated by `scripts/gen-icons.mjs` (icon · adaptive · splash · favicon · mono);
      wired in `app.json` incl. **iOS light/dark/tinted** variants; `BRAND.ink` token in
      `packages/ui`. See [`docs/09` §App icon](./09-theme.md). We explored — and dropped — a 巴/車
      character dual-read and a white-body negative-space version (both fought legibility).
- [ ] **巴士 / 香港巴士 wordmark + splash lockup** — deferred until the app **name** is settled
      (splash currently shows the bus mark on ink, no text). 巴士 earns its place as the wordmark.
- [ ] **Alternate / livery app icons** (iOS alternate icons, Android adaptive) matching the bus
      liveries — overlaps the "Bus livery themes" item below.
