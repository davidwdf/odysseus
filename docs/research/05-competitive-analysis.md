# 05 — Competitive Analysis (HK bus & transit apps)

> Researched 2026-06-09. What the incumbents do, what's table-stakes, and where a new app
> can win. Feeds the improvement ideas ([`06`](./06-feature-improvement-ideas.md)) and the
> [proposals](../proposals/README.md).

## The landscape at a glance

| App | Platforms | Why it matters |
|---|---|---|
| **App1933** (KMB/LWB) | iOS, Android | The dominant operator app. Live bus map, **on-bus occupancy**, alight reminder, fare/stop sorting, Club1933 points + games. |
| **Citybus app** | iOS, Android | ETA as countdown *or* clock; **distance from bus to your stop**; 2-phase alight reminder (up to 10); destination & P2P search with fare/concessions. |
| **New Lantao Bus (NLB)** | iOS, Android | Live ETA, **GPS get-off alerts** for tourist spots, nearby, P2P. |
| **HKeMobility** (TD official) | iOS, Android, Web | All-modes journey planner (bus/MTR/minibus/tram/ferry + drive + walk) with fares; traffic & parking; **Elderly Mode**; border-crossing waiting times. |
| **Google Maps** | iOS, Android, Web | Strong multimodal planning, but **HK bus ETA is widely distrusted** by locals — opportunity. |
| **Citymapper** | iOS, Android, Web | Design-led "Go" turn-by-turn with walk/wait/alight steps; live departures; get-off alerts. |
| **Moovit** | iOS, Android, Web | Live Directions + get-off alerts (stops-remaining), service alerts, on-map tracking. |
| **Apple Maps** | iOS | Live arrivals + **live vehicle locations**, pin lines, approaching-stop notifications (rebuilt HK map, 2023). |
| **hkbus.app** (community, OSS) | Web/PWA, iOS, Android, **Wear OS/watchOS** | Ad-free, fast, **offline route cache**, privacy-respecting GPS, 7+ operators, watch tiles. Closest in spirit to us. |
| **HK Bus ETA** (LOOHP, OSS) | Android, iOS, **Wear OS, watchOS**, iPad, Mac, **Vision Pro**, Web | Smartwatch-first; **home-screen widgets**; opens share-links from other apps; strong a11y. |
| **HKBUS — 香港巴士** | iOS, Android | P2P with fare/walk sorting & same-stop transfer filter; **map mode + full route maps**; **favourites with custom grouping**; history; iOS widget. |
| **Bus Times「就是這裏」** | iOS | A delighter showcase: **Live Activities + Dynamic Island** (get-off + arrival alerts, even a vibrate-stop action); fares; 1-tap handoff to Google/Amap/Waze/Uber; **16 languages**. |

Sources: [App1933 (Play)](https://play.google.com/store/apps/details?id=com.kmb.app1933) · [Citybus app guide](https://www.citybus.com.hk/en/uploadedfiles/app_guide/en.html) · [NLB (App Store)](https://apps.apple.com/hk/app/new-lantao-bus-nlb/id1065179268) · [HKeMobility](https://www.hkemobility.gov.hk/) · [Citymapper HK](https://citymapper.com/hong-kong) · [Moovit get-off alerts](https://support.moovitapp.com/hc/en-us/articles/211392929-Live-Directions-Get-Off-Alerts) · [Apple Maps HK 2023](https://www.apple.com/hk/en/newsroom/2023/10/apple-rolls-out-all-new-map-across-hong-kong/) · [hkbus.app (Play)](https://play.google.com/store/apps/details?id=app.hkbus) · [LOOHP/HK-Bus-ETA](https://github.com/LOOHP/HK-Bus-ETA) · [HKBUS (App Store)](https://apps.apple.com/us/app/hkbus-hong-kong-bus/id1480194097) · [Bus Times (App Store)](https://apps.apple.com/us/app/bus-times-this-is-the-place/id1349789123)

## Open-source projects worth learning from

- **[hkbus/hk-bus-crawling](https://github.com/hkbus/hk-bus-crawling)** — daily crawler that merges KMB/CTB/NLB/GMB/MTR/LR/ferry into one `routeFareList.min.json` (holiday parsing, **GTFS matching**, route merging). **This is the dataset we already consume.** Attribution required.
- **[hkbus/hk-bus-eta](https://github.com/hkbus/hk-bus-eta)** — TS library normalizing ETA + route/stop DB across operators; its `RouteListEntry` type is the schema of the file above (fares/freq/jt included). Great reference model. **GPL-3.0.**
- **[hkbus/hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta)** — the React PWA behind hkbus.app. **GPL-3.0.**
- **[LOOHP/HK-Bus-ETA](https://github.com/LOOHP/HK-Bus-ETA)** — Kotlin-Multiplatform reference for cross-platform + smartwatch. **GPL-3.0.**

> ⚠️ **Licensing:** the community ecosystem is **copyleft** (the apps/libraries are GPL-3.0; the
> `hk-bus-crawling` data repo is GPL-2.0 — verify per repo before any reuse). Their *data outputs*
> are reusable with attribution; copying their *code* would impose GPL on us. We already do the right
> thing — consume data.gov.hk directly and treat these as design/data references.

## Table-stakes (we must have these to be credible)
1. Multi-operator normalized ETA (next-3, "Due/Arriving") — ✅ we have (KMB+CTB).
2. Nearby radar with per-route ETA — ✅ we have.
3. Favourites / bookmarks (grouping is the better form) — 🟨 stops only.
4. Bilingual UI + data names; dark mode — ✅ we have (trilingual even).
5. **Get-off / alight alarm** — ❌ **we lack it; nearly every competitor has it.** A bus app without this feels incomplete in HK.
6. **Live bus position + route map** — ❌ we have a schematic, not a map.
7. **Service/diversion alerts** (last-bus, detours) — ❌ (data available via TD + `rmk_*`).
8. **Fare display** — ❌ (data already in hand — see [03 §11](./03-app-feature-inventory.md)).

## Differentiators / delighters (where we can stand out)
- **Real-time on-bus occupancy** — App1933 (bus loading) & MTR (car loading). **Rare for buses.** If KMB exposes it, it's a genuine wow. *(Availability: confirm — App1933 shows it; whether it's in open data is covered in [02](./02-data-availability-matrix.md).)*
- **Home-screen widgets + iOS Live Activities / Dynamic Island** — "Bus Times" sets the bar (live ETA, get-off + arrival notifications, vibrate-stop). Huge perceived quality; fits our PWA→native path.
- **Smartwatch app (Wear Tiles / watch complications)** — hkbus.app & LOOHP treat it as first-class; **operator apps don't.**
- **Multimodal P2P planning with smart sorting** (fastest / **cheapest** / **least-walking**, walk-time-aware) — the one area where even operator apps are weak and Google/Citymapper win.
- **Truly offline PWA** — local route/stop cache so search works on poor signal (our on-device index, ADR-007).
- **Trust/honesty as brand** — ad-free, momentary-not-stored GPS, **honest ETAs** (no fake countdown, staleness shown). This is hkbus.app's whole positioning and is exactly our ADR-008. Lean in.

## Notable single features to "borrow"
- Citybus's **ETA toggle**: countdown minutes ⇄ clock time (cheap, loved).
- Citybus's **"distance from bus to your stop"** readout.
- App1933's **sort routes by lowest fare / fewest stops**.
- HKBUS's **favourites with custom groups** + **browsing history**.
- Bus Times's **1-tap handoff** to maps/ride-hailing from a stop.
- Citymapper's **stepwise "Go"** journey mode (walk → wait → ride → alight).
- HKeMobility's **Elderly/large-type mode** (goodwill + accessibility, cheap).
- Bus Times's **broad localisation** (16 languages) — easy delighter for tourists beyond our en/繁/简.

## Net read
The fastest path to "better than the incumbents" is to pair the **community ethos** (ad-free, fast, offline, honest, watch + widgets) with **two operator-grade signals most third-party apps lack — live bus position and on-bus occupancy** — then grow toward **multimodal P2P planning**. We already nail the trust/normalization foundation; the visible gaps are **alight alarms, a real map, fares, and engagement surfaces (widgets/watch)**.
