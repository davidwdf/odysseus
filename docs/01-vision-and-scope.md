# 01 — Vision & Scope

## Vision

> Open the app and instantly know when your bus is coming — wherever you are in Hong Kong.

A transit companion that is **fast**, **beautiful**, and **trustworthy**. It should feel
native and delightful on a phone, work as an installable website today, and become real
iOS/Android apps tomorrow without a rewrite.

## Who it's for

- Daily commuters who check the same few stops every day.
- People in an unfamiliar area who want "what's near me, and when does it come?"
- Multilingual Hong Kong: **English, Traditional Chinese (繁體中文), and Simplified Chinese (简体中文)**
  are first-class from day one. (Traditional is the primary HK form; Simplified broadens reach to
  mainland visitors and is essentially free — see [ADR-014](./08-decision-log.md).)

## Product goals

1. **Speed is a feature.** Time-to-first-useful-data must feel instant. Cached/offline static
   data renders immediately; live ETAs arrive fast because compute is near HK.
2. **Delightful to use.** Thoughtful motion, haptics (on native), clean typography, light/dark.
3. **Trustworthy.** We present ETAs honestly (see principle below) and indicate data freshness.
4. **Mobile-first, multi-platform.** Responsive web/PWA now; iOS + Android from the same codebase later.
5. **Cheap to run, easy to scale.** Edge + caching keep costs near-zero at small scale and flat at large scale.

## v1 scope (the MVP)

- **Operators:** KMB / LWB + Citybus (CTB) only. _(Rationale: together they carry the large
  majority of franchised-bus ridership; one realtime API each.)_
- **Core features:**
  - **Nearby** (hero feature): open app → see stops around me and the next arrivals at each.
  - **Search** a route by number → see its stops and live ETAs.
  - **Route detail:** ordered stop list, direction toggle, live ETAs.
  - **Stop detail:** all routes serving the stop, next arrivals each, sorted by soonest.
  - **Favorites:** pin stops/routes (stored on-device in v1).
  - **Trilingual** EN / 繁體中文 / 简体中文; **light & dark** themes.
- **Delivery:** ship as an **installable PWA** (Expo web target).

## Explicit non-goals for v1 (parked in the [backlog](./07-backlog.md))

- Other operators (NLB, MTR Bus/Feeder, Green Minibus, Light Rail, ferries).
- Multi-leg trip planning / journey routing.
- Accounts & cross-device sync.
- Push notifications & background "bus approaching" alerts (needs native — Phase 3).
- Home-screen widgets, Apple Watch / Live Activities.
- Fare calculation, service-disruption feeds, crowding data.

## Core principles

1. **ETAs are approximations — never fabricate precision.**
   We do **not** decrement a countdown client-side every second. A "10 min" wait can become
   "9 min" in 30 seconds or in 3 minutes depending on traffic; faking a smooth countdown lies
   to the user. Instead we:
   - Show the value the source gives us (relative minutes and/or an absolute arrival clock time).
   - Update it only when **real new data** arrives (poll in v1, push in v2).
   - Show a subtle **"updated Ns ago"** freshness indicator, and grey out / flag stale data.
   - Animate the **change** (a gentle number-flip when a value genuinely updates) — delightful *and* honest.
   - Use **"Arriving" / "Due"** for sub-minute arrivals rather than a fake "0:59, 0:58…".

2. **Speed beats features.** A snappy app doing less wins over a sluggish app doing more.

3. **Honest about data.** When upstream is down or a stop has no scheduled service, say so plainly.

4. **Accessible by default.** Dynamic type, screen-reader labels, sufficient contrast, and
   **respect reduced-motion** (disable delight animations when the OS/user asks).

5. **One codebase, no forks.** Web and native share everything they reasonably can.
