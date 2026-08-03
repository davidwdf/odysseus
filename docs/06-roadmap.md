# 06 — Roadmap

Phased so that each phase ships something usable and de-risks the next. Dates are deliberately
omitted; the ordering and exit criteria are the commitment.

## Phase 0 — Foundations
**Goal:** the skeleton everything else hangs off.
- Monorepo scaffold (pnpm + Turborepo), shared TS/lint config, CI green.
- `packages/core`: canonical types + `DataSource` interface.
- `packages/data-normalize`: daily crawl of GTFS + KMB/CTB → normalized snapshot; stop-merging.
- `apps/edge`: Cloudflare Worker skeleton reading a precomputed snapshot from KV/R2. **Done**
  ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)): the daily build runs in **GitHub Actions**, not a Worker cron —
  content-addressed shards, one mutable `build:current` pointer flipped last.
- `packages/ui`: design tokens + theme (light/dark) + a few primitives (NativeWind).
- Expo app boots on web with the design system and a static dataset fixture.

**Exit:** `pnpm dev` runs the web app against a locally-served normalized dataset.

## Phase 1 — v1 MVP (installable PWA)
**Goal:** the product, shipped as a PWA. Operators: **KMB/LWB + Citybus**.
**Status:** Slice 1 (Nearby) **live** for KMB — server-side `/v1/nearby` ([ADR-016](./08-decision-log.md)),
verified end-to-end. Citybus, on-device index, and the other screens are next.
- **Nearby** (hero): geolocate → on-device stop lookup → live ETAs (edge proxy + cache).
- **Search** route → **route detail** (stop list, ETAs) — **done** (ADR-037): smart route keypad + stop/place
  text search + filter chips over an on-device index. Direction toggle is a follow-up (P11).
- **Stop detail:** all routes at a stop, soonest first.
- **Favorites** (on-device), **EN/繁中**, **light/dark**.
- ETA presentation per the honesty principle (no fake countdown; freshness chip; animate on change).
- Core delight animations + skeletons; accessibility baseline; offline static data — **offline
  done** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)): a Workbox service worker precaches the app shell, and
  the TanStack Query cache is persisted, so a cold offline start opens the app and searches.
- Deploy: Expo web → Cloudflare Pages as an **installable PWA**. **Still outstanding** (WP0-5) —
  it needs a real domain and a Cloudflare account; the pipeline has never run against remote KV/R2.

**Exit:** a person can find their stop and trust the next-arrival times, fast, on a phone browser.

## Phase 2 — Realtime push + polish
**Goal:** make it feel alive and bulletproof.
- **Durable Objects + WebSockets** behind `DataSource.watch()` for **watched stops & favorites**.
- Freshness/stale states wired to live pushes; graceful upstream-outage handling.
- Performance pass (bundle, TTI, animation jank); offline hardening. **First pass shipped early**
  (Wave 0): the dataset left the request path ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)) — cold `/v1/nearby`
  3.97 s → 0.74 s — and live ETAs are coalesced per pole on a 30 s TTL
  ([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole)).
- ~~**Basemap migration off OSM's public tiles → HK Lands Department**~~ — **DONE, shipped early**
  ([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)):
  keyless gov raster proxied and cached by our own Worker (12 h TTL), with `en`/`tc`/`sc` labels as a
  per-locale overlay. It was a **prerequisite, not polish** — the OSMF tile policy (rev. 2026-07-22)
  prohibited our usage and would have blocked a native build outright.
- **Street-level stop photos** ([ADR-050](./08-decision-log.md#adr-050--stop-imagery-google-street-view-deep-link-now-hk-streetscape-360-as-the-inline-target)):
  Google Street View deep link first (free, keyless, hours of work), then HK **Streetscape 360** inline.
- Map view for Nearby (MapLibre) — the tiles are already there: it consumes the same `TileSource`
  seam (`apps/mobile/lib/tileSource.ts`) that `MiniMap` uses, so it inherits LandsD basemap + label
  overlay for free. Protomaps/R2 is the recorded fallback if we later need true dark mode or offline packs.

**Exit:** watched stops update by push; the app holds up when upstream is flaky.

## Phase 3 — Native apps (**hand-written, against one spec**)
> **Rewritten 2026-08-03 by [ADR-075](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels),
> which supersedes [ADR-002](./08-decision-log.md#adr-002--expo-rn--rn-for-web-pwa-first-native-later-ota).**
> This phase used to read *"Native apps (same codebase) — real iOS + Android, no rewrite"* via EAS Build.
> That is **no longer the plan**, and it had in truth stopped being the plan several waves earlier: every
> native artefact this repo generates (`packages/contract/native/`, the Swift/Kotlin token and string
> emitters, the corpus, `packages/ports` as *"the porting checklist"*) exists to serve a **hand-written**
> client, and `packages/contract/README.md` is addressed to *"someone starting a native repo tomorrow"*.
> The two statements contradicted each other on `main` until ADR-075 picked one.

**Goal:** real iOS + Android, each idiomatic for its platform, none of them diverging.
- **Web is plain React** (`apps/web`), not `react-native-web`. `apps/mobile` (Expo) is the reference
  implementation until its last screen's spec passes on both renderers, then it retires.
  Work plan: [`proposals/04`](./proposals/04-platform-idiomatic-renderers.md) — **Wave 6**.
- **iOS in Swift, Android in Kotlin**, separate repos, consuming the published contract:
  `openapi.json` · `asyncapi.json` · the id-grammar ABNF · `packages/core/spec/*` (742 corpus cases) ·
  the generated tokens and string catalogues · and the new `packages/contract/ui/` component specs.
  Start at [`packages/contract/README.md`](../packages/contract/README.md), which is written for that reader.
- **The design is platform-idiomatic within a bounded line** (Material 3 on Android, the iOS material of
  the day, a web middle ground). Content, semantic colour, type scale, spacing, the
  [ADR-008](./08-decision-log.md) honesty rules, the five states, interaction destinations and a11y
  labels are **shared and are identity**; material, elevation, shape, motion, gesture idiom and the icon
  set are **idiom**. The table is in `proposals/04`.
- **"No drift" means every renderer satisfies the same executable spec** — a conformance suite per
  renderer, not three screenshots compared by eye.
- Native-only wins, which are the native app's to deliver and never React Native's: **push
  notifications** ("bus approaching"), background location, haptics polish. *(Web Push does work for an
  installed PWA since iOS 16.4; background location has no web equivalent.)*
- App Store / Play Store launch. **No EAS Build, no EAS Update, no OTA** — the web app is always-latest
  by being the web, and each native app ships through its own store pipeline.
- **First real test of the thesis:** WP6-9 — one SwiftUI screen passing the same specs, and the first
  time the four generated Swift/Kotlin artefacts are **compiled at all**
  ([ADR-067](./08-decision-log.md)). **Blocked on corpus vendoring**, which is still unsolved: nothing
  here can enforce that a native repo's copy of the corpus is current, and a stale copy produces a
  *green* suite pinning a rule that has moved.

**Exit:** shipped to both stores; every screen's spec green on all three renderers.

## Phase 4 — Expand coverage (from the [backlog](./07-backlog.md))
- Add operators: **NLB, MTR Bus/Feeder, Green Minibus**, then Light Rail.
- Service-disruption / remarks surfacing.

## Phase 5 — Delight & power features
- Home-screen **widgets**, **Apple Watch / Live Activities**.
- Account + cross-device favorites sync (D1).
- Trip planning (multi-leg), journey history, share-ETA.

> Each "add an operator" task is mostly: implement its fetch+normalize adapter in
> `packages/data-normalize` and (for realtime) a poll adapter — the `DataSource` interface and
> UI don't change. That's the payoff of normalizing early.
