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
- [ ] 🟠 **A shared deep link will 404 on a first visit unless the host is configured.** ⚠️ *(unverified by
      the run; confirmed by hand.)* `scripts/pwa/workbox.config.mjs:94`'s `navigateFallback` only helps once
      the service worker is installed; a first visit to `/route/…` from a message hits the origin, and
      `apps/web/public/` carries no `_redirects`, `404.html` or equivalent. This is a **WP0-5 precondition**
      rather than a code defect — there is no host yet — but it must be written into the deploy step or the
      first shared link a rider sends will be broken.
- [ ] 🟠 **Route detail's row tap goes to the place on `apps/web`, dropping the action sheet the spec
      declares non-optionally.** The same finding as the blocker above, from the spec's side rather than the
      store's: fixing the favourite affordance fixes this, and the two must be fixed together.
- [ ] 🟡 **Place detail's last kerb can never be highlighted on `apps/web`**, and tapping its map dot scrolls
      to the bottom and lights a *different* kerb's dot — the DOM list has no tail padding, so the last
      heading never reaches the scroll-spy line. The RN screen pads for exactly this.
- [ ] 🟡 **Three Search strings dropped from `--text-muted` to `--text-subtle` in the port** (the recents
      heading, the clear-recents control, the inactive segment label), which is 3.9:1 in dark mode and fails
      WCAG AA. A token change, not a redesign.
- [ ] 🟡 **`apps/web` carries the document scroll position into a pushed screen.** react-router does no
      scroll management and nothing in the shell adds any; the RN app's per-screen scrollers do it
      implicitly. Back *does* restore correctly, so this is one direction only. **This one genuinely is
      `<ScrollRestoration>`'s job** — unlike the Search item below, the quantity is `window.scrollY` — and it
      is deliberately not bundled with ADR-109 because it changes behaviour on all eight screens at once,
      including Route detail's `scrollIntoView` reveal and both collapsing headers' sentinels.
- [x] ✅ **Route detail's bus tokens keep stale row offsets** — **fixed twice, and the second one removed the
      mechanism**: ADR-108 made the observer watch every row's border box, and
      [ADR-110](./08-decision-log.md#adr-110--the-rails-resting-place-is-css-only-its-travel-is-measured)
      deleted the observer, the offset registry and the arithmetic outright. A token is positioned against
      its own row in CSS, so a refetch that redistributes arrivals lines moves the row and its bus together.

**Found while comparing, broken on BOTH renderers** (so retiring `apps/mobile` neither causes nor fixes
them; they belong to the hardening list above rather than to WP6-8):

- [ ] 🔴 **An offline, paused fetch renders "No scheduled service"** on Nearby — a false claim, and the exact
      ADR-073 conflation one screen over from where it was fixed.
- [ ] 🟠 **`<html lang>` is hard-coded `"en"` and never follows the active locale**, on both renderers.
- [ ] 🟠 **A stale reading is `opacity` alone on both**, with no relative age anywhere, though
      `stop-row.spec.json` demands one and `updatedAgo` has sat unused in the catalogue since Wave 1.
- [ ] 🟡 **Nothing announces or moves focus on a route change** on either renderer.

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

## Infra / hardening
- [ ] 🔴 **Two tabs of the PWA silently overwrite each other's preferences — including a rider's
      favourites.** Found by WP6-7 while declaring Settings' `stale` state
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
- [ ] 🔴 **Route detail cannot say "we could not ask", so a Citybus or GMB route reads as "no bus is due".**
      Found by WP6-6a ([ADR-093](./08-decision-log.md#adr-093--which-node-a-bus-is-at-is-content-where-that-node-is-on-screen-is-geometry))
      and pinned as the corpus row `a-citybus-route-shows-no-times-anywhere-and-does-not-say-why`
      (`knownDefect`). `/v1/route/:id` fetches live arrivals for **KMB and LWB only** — Citybus publishes no
      bulk route-eta endpoint at all ([ADR-021](./08-decision-log.md)) and GMB is not wired — so on a CTB or
      GMB route **every** stop row carries `eta: null`, for ever, and the screen renders exactly what a route
      with nothing currently due renders. A rider cannot tell a route the app never asks about from a route
      with no buses coming. This is the same hole [ADR-077](./08-decision-log.md#adr-077--a-card-can-say-we-could-not-ask-and-a-failure-list-must-not-outlive-its-round)
      closed for `/v1/nearby` and `/v1/stop` by putting `failed` on the wire, and
      `apps/edge/src/stop-route.ts` says so in a comment on the very call: *"Route detail has no per-stop
      failure field of its own; whoever gives it one is WP5-13, and it should come from here."* WP5-13 shipped
      without it. **The fix has three parts:** `RouteDetailSchema` gains `failed` (a `CONTRACT_VERSION` minor,
      since it is additive), `routeDetailView` gains the `incomplete` boolean `StopCardView` and
      `PlaceDetailView` already have, and both renderers say it **once for the screen** rather than per row —
      a rider cannot act on which rows. Reproduction: open `/route/CTB:962:outbound:1` on either app.
- [x] ✅ **The four route fact sheets still derive** — **done as WP6-6c**
      ([ADR-095](./08-decision-log.md#adr-095--the-estimate-mark-is-content-and-so-is-the-separator-between-two-day-names)).
      All eight decisions are `routeFactSheet`'s, with 15 corpus cases; both renderers project it, `apps/web`
      has the sheets as a `<dialog>`, and `RouteFactSheets.tsx` joined `check-no-derivation`'s `POLICED` list
      **with no new allowlist entries**.
- [ ] 🔴 **A route whose per-stop fares are not numbers opens an entirely blank fare sheet**, while the pill
      that opened it shows a fare. Found by WP6-6c and pinned as the corpus row
      `a-route-whose-fares-are-not-numbers-opens-an-entirely-blank-fare-sheet` (`knownDefect`). `fareStages`
      drops any value `Number()` cannot read, so there are no stages and no concessions; `fareRange` drops the
      same values, falls back to `service.fareFull`, and the strip therefore reads `$13.4`. So a rider taps a
      pill showing a fare and gets nothing. **The fix:** fall back to the origin full fare as a **single stage
      covering the whole route** — the same datum the pill used — and say nothing about sections the data
      cannot describe. Whether upstream actually publishes such a fare is not measured; the guard in
      `fareStages` makes the state reachable by construction, which is enough to pin it.
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
