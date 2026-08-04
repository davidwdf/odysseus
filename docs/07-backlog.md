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

## Infra / hardening
- [ ] **Route auto-scroll doesn't land on web** — `app/route/[id].tsx` should scroll to the originating stop
      (the two-step reveal's second beat, [ADR-043](./08-decision-log.md#adr-043--a-core-navigation-animation-system-cross-fade-tabs-slide-and-reveal-stack-web-swipe-back)),
      but the `scrollTo` no-ops on react-native-web (reproduced with the ADR-043 reveal-gate **and** `animated` flag
      neutralised, so it predates that work). The gating mechanism is in place; needs the underlying scroll fixed
      (likely a measurement / `Animated.ScrollView` `scrollTo` timing issue on web). Native unaffected.
- [ ] **Web down/back slide animation** — ADR-043 reverted the JS stack (it broke web scrolling), so on web the
      down/back transition is an instant cut; the slide + reveal is native-only. If a web push/back animation is
      wanted, do it *purely additively* with per-screen Reanimated `entering`/`exiting` (no navigator swap):
      push-in is reliable; reveal-on-pop is hard on web (native-stack hides the outgoing screen instantly). Also
      consider an interactive follow-the-finger web swipe-back (currently threshold-triggered + instant).
- [ ] **`BottomSheet` slide-up doesn't complete on web** — `components/BottomSheet.tsx`'s `onPanelLayout`→
      `withTiming(0)` entrance doesn't run on web; the panel mounts but only its grab handle peeks (likely cancelled
      by the handle pan's `onBegin`→`cancelAnimation`, or the layout-driven entrance not firing on react-native-web).
      Affects the route schematic's stop action sheet. Independent of ADR-043 (which only un-clipped it).
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
