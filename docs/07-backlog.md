# 07 — Backlog (parked, not forgotten)

Things deliberately **out of v1** but explicitly planned. Roughly priority-ordered within groups.

## Additional operators
Each is a fetch+normalize adapter in `packages/data-normalize` (+ a realtime poll adapter);
the `DataSource` interface and the UI do not change.

- [ ] **New Lantao Bus (NLB)** — `data.gov.hk` realtime dataset.
- [ ] **MTR Bus / Feeder Bus** — `data.gov.hk` realtime schedule dataset.
- [ ] **Green Minibus (GMB)** — `data.gov.hk`; all routes covered since Oct 2022. (More routes/stops → more stop-merging edge cases.)
- [ ] **Light Rail (LRT) & MTR heavy rail** — different domain (rail), but the canonical model can host it.
- [ ] **Ferries** (Star Ferry / franchised ferries) — if scope expands beyond buses.

## Static data & multi-operator (follow-ups to [ADR-021](./08-decision-log.md))
- [ ] **Own static crawl → KV/R2** — replace the runtime dependency on the hkbus consolidated dataset with
      our own crawl (KMB bulk endpoints already in `kmb-static.ts`; CTB via the per-route + per-stop crawl,
      run as an external job / GitHub Action since it exceeds the Worker subrequest cap). Self-reliance.
- [ ] **Cache the snapshot in KV/R2** — so a hkbus gh-pages outage means *stale*, not broken (interim before
      the own-crawl). The `DATASET` binding is already stubbed in `wrangler.toml`.
- [x] **Same-kerb stop-merge (`Place`)** — DONE (ADR-022): our own cross-operator clustering (30 m +
      landmark-name match, ≤1 member per operator) groups a shared kerb into one card/stop listing both
      operators' routes. Follow-up: looser name matching (token overlap) to also merge stops whose landmark
      strings differ (e.g. KMB stop-code-only names), ideally on the own-crawl's first-party coordinates.
- [ ] **True Simplified (zh-Hans) static names** — the consolidated dataset only has en + Traditional, so
      Simplified stop/route names currently fall back to Traditional. Source real zh-Hans (official bulk
      endpoints have `name_sc`) once on our own crawl.
- [ ] Additional consolidated operators already in the dataset (NLB, GMB, MTR feeder, light rail) — cheap to
      light up once merge + UX are ready (overlaps "Additional operators" above).

## Realtime & data quality
- [ ] Service-disruption / special-traffic-news surfacing (TD incident data).
- [ ] Per-route remarks (e.g. "last bus departed", schedule-based vs GPS-based ETA labelling).
- [ ] Crowding / occupancy data (if/when published).
- [ ] Historical ETA accuracy tracking → show confidence ("usually on time here").

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
