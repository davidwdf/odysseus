# 03 — App Feature Inventory (what NextBus HK has today)

> Snapshot of shipped/verified features as of **2026-06-09** (see [`docs/11`](../11-status.md)).
> Companion docs: [`04-feature-gaps.md`](./04-feature-gaps.md) (what's missing) and
> [`06-feature-improvement-ideas.md`](./06-feature-improvement-ideas.md) (how to make these better
> with new + currently-unused data).

## 1. Navigation & app shell
- **Expo Router** tabbed app (web/PWA target live; iOS/Android share the code).
- Tabs: **Nearby** · **Routes** (placeholder) · **Favourites** · **Settings**, plus a dev-only **`/workbench`** gallery.
- **Floating glass tab bar** (ADR-027) — an absolute-positioned pill that content scrolls *under*.
- Detail routes: `/stop/[id]`, `/route/[id]`.

## 2. Nearby (the hero)
- Geolocates the device (`expo-location`) → calls edge `/v1/nearby?lat&lng[&radius]`.
- Returns **distance-sorted** stops with each stop's **soonest arrivals** (live ETAs).
- **Flat list** of `StopRow`s (ADR-026): name + `MapPin` + **"{distance} · {n} min walk"** + chevron.
- Distance/walk derived honestly via `@nextbus/core/geo` (`formatDistance`/`walkMinutes`/`formatWalk`).
- **Multi-operator**: KMB + CTB stops both appear; co-located KMB+CTB kerbs are **merged into one card** (same-kerb `Place`, ADR-022).
- Tapping a stop → stop detail; tapping a route row → route detail at that stop.

## 3. Stop detail (`/stop/[id]`)
- All routes serving the stop, each with its **current ETA**, **soonest first**.
- Rider-duplicate routes **collapsed** server-side (`dedupeEtas`, ADR-023) — no "two A41 at the same time".
- **Favourite toggle** (star) to save the stop.
- Reached by tapping a stop name; route rows deep-link to `/route/:id?stop=:stopId` (ADR-024) with an "arrivals here" card.
- For merged places, ETAs **fan out per operator** (KMB red + CTB yellow chips).

## 4. Route detail (`/route/[id]`) — vertical schematic line-strip (ADR-030)
- A **subway-style vertical timeline**: ordered stops, seq-in-node rail, origin→dest header.
- **Per-stop live ETAs** for KMB/LWB — filled in **one upstream call** via KMB `route-eta`.
- **Two-state "bus tokens"** that hop between stops on fresh data (at the stop when *due*, else segment midpoint), located by **drop-off detection** (no vehicle id needed).
- **Auto-scrolls** to the stop you opened it from; that stop is highlighted.
- **Glass header** (ADR-033): centred route badge over `A → B` that **morphs** into a pill beside the back-lens on scroll.
- CTB routes render **static-only** (no bulk route-eta upstream).

## 5. Favourites (tab)
- Pin **stops** (Zustand + AsyncStorage; ADR persistence shared with prefs).
- Reuses `StopRow` (distance hidden); shows a deduped ETA summary per saved stop.
- **Route-at-stop favourites are designed (ADR-032) but not yet built.**

## 6. Settings (tab)
- **Language picker** — EN / 繁體中文 / 简体中文, **persisted**, live re-localization (no reload).
- **Appearance** — auto / light / dark segmented control, persisted; splash gated on rehydration (no theme flash).
- (Livery picker was **removed** — theming simplified to a single **Ink** theme, ADR-029.)

## 7. Localization (i18n)
- Trilingual **EN / zh-Hant / zh-Hans** UI strings in `@nextbus/i18n`.
- Locale **device-detected** (`expo-localization` + `resolveLocale`) with a **manual override** via `useLocale()`.
- All bus data names are `I18nText` from the canonical model.
- British-English (Oxford `-ize`) house style for `en` prose & strings (ADR-031).
- *Caveat:* zh-Hans **static** names fall back to Traditional (consolidated dataset has en+繁 only); live ETA text has all three.

## 8. Design system & UX
- **Ink theme** (ADR-029): monochrome "ink & paper", light/dark/auto; semantic NativeWind tokens only (no raw hex).
- **Typography** primitive `<Text variant>` driving the docs/09 type scale (Inter loaded with weight cuts + splash gate).
- **Elevation** tokens + `Card` primitive; **Lucide** icons behind a themed `<Icon tone>` (ADR-025).
- **Liquid-glass** material `GlassView` (ADR-028) — true SVG refraction on Chromium, frosted blur elsewhere, `expo-blur` on native.
- **Honest ETA presentation** (ADR-008): "Soon/即將" under a minute, tabular figures, stale flagging via `isStale()`; **no fake per-second countdown**.
- App icon finalized (side-profile double-decker, white-on-ink).

## 9. Data layer & infrastructure
- **`DataSource` seam** (`@nextbus/core`) — UI never calls upstream directly; `EdgeClient` (`@nextbus/api-client`) is the v1 implementation with a `watch()` polling shim.
- **Cloudflare Worker** (`apps/edge`): `/v1/nearby`, `/v1/stop/:id`, `/v1/route/:id`, `/v1/etas/:id`, low-level `/v1/eta/:co/:stop/:route`. Edge-cached + request-coalesced.
- **Static index** built from the hkbus **consolidated dataset** in one ~8 MB fetch, **memoized** per isolate (`static-index.ts`); same-kerb `buildPlaces` clustering.
- **Live ETAs** come **direct from official KMB/CTB APIs** (normalized in `@nextbus/data-normalize`).
- Known limits: all server-side (no on-device index yet), daily-crawl cron is a **stub**, runtime depends on the hkbus artifact (no KV/R2 cache yet).

## 10. Operators & coverage
- **KMB / LWB** and **Citybus (CTB)** — static + live, verified end-to-end.
- NLB / GMB / MTR Bus are in the consolidated dataset but **out of v1 scope** (filtered out in `dataset.ts`).

---

## 11. ⭐ Data we already obtain but don't surface (the cheap gold)

These are fields the app **already fetches** on every run and then **throws away**. No new data source needed.

### From the consolidated dataset (`routeFareList.min.json`) — verified schema
Our `RawRoute` parser in `packages/data-normalize/src/dataset.ts` declares only
`co, route, serviceType, bound, orig, dest, stops`. The file actually carries (per the
`hk-bus-eta` `RouteListEntry` type, which reads the same file):

| Field | Type | What it is | We use it? |
|---|---|---|---|
| `fares` | `string[] \| null` | **Per-stage fare** (HK$) along the route | ❌ dropped |
| `faresHoliday` | `string[] \| null` | **Holiday fare** variant | ❌ dropped |
| `freq` | `Freq \| null` | **Frequency / headway** by day-type & time window | ❌ dropped |
| `jt` | `string \| null` | **Journey time** (full-route minutes) | ❌ dropped |
| `gtfsId` | `string` | Link to the TD **GTFS** route (fares, shapes, calendar) | ❌ dropped |
| `nlbId` | `string` | NLB route id (for when NLB is lit up) | ❌ dropped |
| `co`, `route`, `serviceType`, `bound`, `orig`, `dest`, `stops` | — | used today | ✅ |

> **Implication:** "show the fare for this route", "every 10–15 min", and "≈45 min end-to-end"
> are **UI-only** changes — the data is already in memory at the edge. See
> [proposals](../proposals/00-fast-and-fun-wins.md).

### From the live ETA feeds (KMB/CTB) — captured but not displayed
| Field | Source | Status |
|---|---|---|
| `remark` (`rmk_en/tc/sc`) | KMB + CTB ETA rows | Parsed into `Eta.remark`, **carried through the model, never rendered**. Holds "Scheduled bus", "Last bus", diversion notes. |
| `eta_seq` | KMB + CTB ETA rows | Fetched then ignored — tells you whether a reading is the 1st/2nd/3rd arrival of that line. |
| `dataTimestamp` / `observedAt` | every `Eta` | In the model; **freshness UI not shown everywhere** (only the honesty primitives exist). |
| `distanceM` | `/v1/nearby` | Now surfaced as "min walk" (ADR-026) — previously unused; noted as the pattern to repeat. |

### Already-computed but under-exploited
- **Same-kerb `Place` merge** — we know which KMB & CTB stops share a kerb, but only use it to collapse a Nearby card; could power "all operators here" affordances.
- **`gtfsId` bridge** — every route already links to the GTFS feed, the gateway to **route shapes (map polylines)** and **official fare rules** with no new ID-matching work.
