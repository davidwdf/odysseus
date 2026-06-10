# 04 — Feature Gaps (basic things we're missing)

> Companion to [`03-app-feature-inventory.md`](./03-app-feature-inventory.md) (what we *have*).
> This is the "table-stakes" list — features a competent bus app is expected to have that
> NextBus HK does **not** ship yet. Sorted roughly by how load-bearing they are. Each item
> notes whether the data/plumbing already exists (so we know how cheap the fix is).

## Legend
- 🟥 **Missing entirely** — not started.
- 🟧 **Stub / placeholder** — UI shell or plan exists, no real behaviour.
- 🟨 **Partial** — works in one path but incomplete or not discoverable.
- 💾 **Data ready** — the data/index to build this is already fetched server-side.

---

## A. Finding things (search & discovery)

> **Update (2026-06-10, [ADR-037](../08-decision-log.md)):** **A1 (route search)** and **A2 (stop/place
> search)** are **done** — a dedicated **Search** page with a smart route-number keypad + any-locale stop
> search over a cached on-device index. **A4 (filters)** mostly done (operator + night/airport/express chips,
> on Search). **A5 (recents)** done. Still open: **A3** (search by destination), **A7** (combined omnibox).

| # | Gap | State | Notes |
|---|-----|-------|-------|
| A1 | **Route search** (type a route number → route detail) | 🟧 💾 | The **Routes tab is a placeholder** (`app/(tabs)/routes.tsx`). The route-detail screen already exists and the static index has every route — this is "wire a search box to `routeMeta`". The single biggest missing basic. |
| A2 | **Stop / place search by name** | 🟥 💾 | No way to find a stop you're not standing next to. The index has every stop name (en/繁). Needed for "check my home stop while at work". |
| A3 | **Search by destination** ("buses to Central") | 🟥 💾 | `routeMeta` carries origin/destination text already; a destination search is a filter over it. |
| A4 | **Search filters** | 🟥 | No filtering by operator, direction, night-bus (`N`-prefixed), express, or "serves stop X". |
| A5 | **Recent searches / search history** | 🟥 | Standard convenience; cheap with the prefs store (Zustand+persist already in place). |
| A6 | **Autocomplete / fuzzy matching** | 🟥 | Route numbers are alphanumeric (`A41`, `N691`, `971P`); needs prefix + fuzzy. |
| A7 | **Universal/combined search** (one box → routes *and* stops) | 🟥 | The "omnibox" most competitors have. |

## B. Map & spatial

| # | Gap | State | Notes |
|---|-----|-------|-------|
| B1 | **Map view for Nearby** | 🟥 | Roadmap Phase 2. We have coordinates for every stop; MapLibre is the planned lib. Nearby is list-only today. |
| B2 | **Route shape on a map** (the actual road path) | 🟥 | Route detail is a *schematic* line-strip, not a geographic map. Needs route polylines/shapes (see data catalog — GTFS `shapes` / TD geometry). |
| B3 | **Stop pin / "where exactly is this kerb"** | 🟥 | Confusing-stop disambiguation; we have lat/lng but never show a map. |
| B4 | **Walking directions to the stop** | 🟥 | We show "{n} min walk" (straight-line) but can't draw the walk. |

## C. Live ETA experience

| # | Gap | State | Notes |
|---|-----|-------|-------|
| C1 | **Direction toggle on a route** | 🟨 💾 | Route detail renders one canonical direction (`:inbound`/`:outbound` is in the id). There's no in-screen flip between the two bounds. Index has both. |
| C2 | **Pull-to-refresh / explicit refresh** | 🟨 | ETAs refresh via `refetchInterval` polling; no manual refresh affordance or "tap to update". |
| C3 | **Realtime push** (vs. polling) | 🟥 | `watch()` is a polling shim; Durable-Object WebSocket push is Phase 2. |
| C4 | **"Last updated / live" indicator surfaced consistently** | 🟨 | `isStale()` + `observedAt` exist in core; freshness UI isn't shown everywhere. |
| C5 | **Service hours / first & last bus** | 🟥 | No "service ended" or "first bus 05:30" info. (Data partly derivable — see catalog.) |
| C6 | **Per-route remarks surfaced** | 🟨 💾 | `Eta.remark` is **captured from KMB/CTB upstream** (`rmk_*`) and carried in the model but **not shown** in the UI. Free win. |
| C7 | **Empty / no-service states** | 🟨 | Need clear "no buses scheduled now" vs "upstream down" messaging (honesty principle). |

## D. Personalisation & engagement

| # | Gap | State | Notes |
|---|-----|-------|-------|
| D1 | **Favourite a route-at-a-stop** | 🟧 💾 | Designed (ADR-032) not built. Today you can only favourite a whole stop. |
| D2 | **Reorder / rename favourites** | 🟥 | No drag-reorder or custom labels ("Home", "Office"). |
| D3 | **Push notifications / "bus approaching" alarm** | 🟥 | Needs native (Phase 3). The canonical "get-off / get-on alert" most riders want. |
| D4 | **Home-screen widgets** | 🟥 | Favourite stop on the home screen; Phase 5. |
| D5 | **Apple Watch / Wear / Live Activity** | 🟥 | Glanceable ETA on the wrist / lock screen. |
| D6 | **Account + cross-device sync** | 🟥 | Favourites are device-local (Zustand+AsyncStorage). |
| D7 | **Share a stop / ETA** (deep link) | 🟥 | No deep links or share sheet. |

## E. Information depth (data we don't show at all)

| # | Gap | State | Notes |
|---|-----|-------|-------|
| E1 | **Fares** | 🟥 💾 | The consolidated dataset we already fetch is a *route-**fare** list*; we drop the fare fields. See catalog + proposals — likely the highest-value cheap win. |
| E2 | **Accessibility / wheelchair info** | 🟥 | Whether a route/stop is step-free. Patchy upstream (see catalog §accessibility). |
| E3 | **Bus type (single/double-deck), electric/low-carbon** | 🟥 | Not in official open data per-trip; community fleet data exists (see catalog). |
| E4 | **Journey time / frequency ("every 8–12 min")** | 🟥 💾 | Likely present in the consolidated dataset (`freq`/`jt`); we drop it. |
| E5 | **Fare concessions** ($2 scheme, BBI interchange discounts) | 🟥 | Relevant to elderly/disabled/students; data availability varies. |
| E6 | **Service disruptions / special traffic news** | 🟥 | TD publishes incident data; not surfaced. |

## F. Trust, accessibility & polish

| # | Gap | State | Notes |
|---|-----|-------|-------|
| F1 | **Offline mode** | 🟥 | Daily-crawl cron is a **stub**; no on-device static index (ADR-007). Nearby/search should work offline. |
| F2 | **Screen-reader / dynamic-type / reduced-motion pass** | 🟨 | Principle stated (docs/01); not yet audited end-to-end. |
| F3 | **Data attribution / about screen** | 🟥 | Licence requires a "Data: TD / KMB / Citybus via DATA.GOV.HK" credit; not shown. |
| F4 | **Onboarding / location-permission priming** | 🟥 | Cold start jumps straight to a geolocation prompt. |
| F5 | **Error resilience when the static source is down** | 🟨 | Runtime depends on the hkbus gh-pages artifact; no KV/R2 cache yet. |

---

## The five that matter most (if we only did a handful)
1. **A1 Route search** — the Routes tab is empty; this is the most glaring hole and the data is ready.
2. **E1 Fares** — we already download them; surfacing them is mostly UI.
3. **A2 Stop search** — "check another stop" is a core daily-commuter need.
4. **B1 Map view** — the expected mental model for "what's around me".
5. **C6 Remarks + C4 freshness** — already in the model; honesty/clarity for near-zero cost.
