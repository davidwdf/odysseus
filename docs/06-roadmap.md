# 06 — Roadmap

Phased so that each phase ships something usable and de-risks the next. Dates are deliberately
omitted; the ordering and exit criteria are the commitment.

## Phase 0 — Foundations
**Goal:** the skeleton everything else hangs off.
- Monorepo scaffold (pnpm + Turborepo), shared TS/lint config, CI green.
- `packages/core`: canonical types + `DataSource` interface.
- `packages/data-normalize`: daily crawl of GTFS + KMB/CTB → normalized snapshot; stop-merging.
- `apps/edge`: Cloudflare Worker skeleton + Cron crawl writing snapshot to R2/KV.
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
- Core delight animations + skeletons; accessibility baseline; offline static data.
- Deploy: Expo web → Cloudflare Pages as an **installable PWA**.

**Exit:** a person can find their stop and trust the next-arrival times, fast, on a phone browser.

## Phase 2 — Realtime push + polish
**Goal:** make it feel alive and bulletproof.
- **Durable Objects + WebSockets** behind `DataSource.watch()` for **watched stops & favorites**.
- Freshness/stale states wired to live pushes; graceful upstream-outage handling.
- Performance pass (bundle, TTI, animation jank); offline hardening.
- Map view for Nearby (MapLibre).

**Exit:** watched stops update by push; the app holds up when upstream is flaky.

## Phase 3 — Native apps (same codebase)
**Goal:** real iOS + Android, no rewrite.
- Enable EAS Build/Submit for iOS/Android from the existing Expo app.
- **EAS Update (OTA)** pipeline so installed apps stay current without store review.
- Native-only wins: **push notifications** ("bus approaching"), background location, haptics polish.
- App Store / Play Store launch.

**Exit:** shipped to both stores; OTA updates flowing.

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
