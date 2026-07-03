# 03 — Architecture

## Guiding idea

> The biggest latency lever isn't Redis or clever caching — it's running compute **physically
> near Hong Kong** (close to both users and the upstream APIs). Everything below assumes
> HK-adjacent edge compute.

We use the **Cloudflare stack**, because it's the only option that gives us edge-close compute
**and** stateful WebSockets without operating servers.

## The Cloudflare building blocks

| Primitive | Role here |
|---|---|
| **Workers** | The API. Stateless request handlers: ETA proxy, dataset endpoints, socket upgrade routing. |
| **Pages** (or Workers static assets) | Hosts the built web/PWA bundle on the global CDN. |
| **Workers KV** | Fast edge cache for normalized static data indices + short-TTL ETA cache. ("Redis as a cache.") |
| **R2** | Object storage for full versioned static dataset snapshots (cheap, no egress fees). |
| **Durable Objects (DO)** | Stateful actors for v2: one per "hot stop", holds WebSocket subscribers, polls upstream on an alarm, fans out diffs. ("Redis as pub/sub + coordination.") |
| **D1** (SQLite at edge) | Optional: relational canonical data / future account sync. |
| **Cron Triggers** | Run the daily static-data crawl + normalization pipeline. |
| **Queues** | Orchestrate the crawl pipeline steps; backpressure. |

### "Where did Redis go?"
You asked about Redis. On Cloudflare its responsibilities split cleanly:
- **Cache (key→value, short TTL):** Workers KV + the Workers **Cache API**.
- **Pub/sub + per-key coordination + connection state:** **Durable Objects** (with built-in
  transactional storage).
- If you ever want *true* Redis semantics (Lua, sorted sets, classic pub/sub), add **Upstash
  Redis** over HTTP — it works from Workers. But for this app, KV + DO cover it, with less ops.

## The phased hybrid data layer

Everything client-facing goes through **one stable interface** so we can change the engine
underneath without touching the apps:

```ts
interface DataSource {
  getNearby(lat, lng, radiusM): Promise<StopWithEtas[]>   // mostly on-device in v1
  getRoute(routeId): Promise<RouteDetail>                 // static + ETAs; carries `reverse?` (ADR-046)
  getStop(stopId): Promise<StopDetail>                    // static + ETAs
  getEtas(stopId, routeIds?): Promise<Eta[]>              // live
  watch(targets): Subscription                            // v1: polling shim; v2: WebSocket
}
```

`watch()` is the key abstraction: in **v1** it's a polling shim over `getEtas`; in **v2** it
becomes a real WebSocket subscription. The UI calls `watch()` either way.

### Phase 1 — Edge proxy + cache (ship this first)
```
Client ──poll every ~20–30s──▶ Worker /eta/:stopId
                                  │  check KV/Cache (TTL 5–10s)
                                  │  hit → return cached
                                  └─ miss → fetch upstream (KMB/CTB) → normalize → cache → return
```
- **Coalescing:** 1,000 users watching the same stop within the TTL window = **one** upstream call.
- Static dataset served from R2/KV (and cached on device), so browse/search/nearby need no live calls.
- Pure serverless: trivial to scale, near-zero cost, minimal ops.
- Trade-off: no push; the client drives polling; a cold stop pays one upstream round-trip.

### Phase 2 — Normalization engine + Durable Objects + WebSocket push
```
Client ──WebSocket──▶ Worker (upgrade) ──▶ DurableObject("stop:<id>")
                                              │  maintains subscriber set (WS hibernation)
                                              │  alarm() every ~10–15s → poll upstream → normalize
                                              │  on change → broadcast diff to subscribers only
                                              └─ idle (no subscribers) → stop polling
```
- We poll upstream **only for stops users are actually watching** — efficient and kind to the source.
- **WebSocket Hibernation** keeps idle connections almost free, so many open subscriptions scale cheaply.
- This is the foundation for v3 features: "bus approaching" push notifications, alerts, history.
- Swapped in behind `DataSource.watch()` — the apps barely change.
- Trade-off: stateful, more moving parts, slightly more cost — justified only where push matters
  (watched stops & favorites), which is exactly where we apply it.

> **Reminder of the ceiling:** even with push, ETAs are only as fresh as upstream's ~1-min
> refresh. The win from sockets is *liveness, battery, and server-controlled cadence* — not
> sub-minute data. See the ETA-honesty principle in [Vision](./01-vision-and-scope.md).

## The daily crawl / normalization pipeline (Cron Worker)
```
Cron (daily) ─▶ fetch GTFS + KMB + CTB route/stop/fare
            ─▶ normalize to canonical model (02-data-sources.md)
            ─▶ run stop-merging (proximity + name) → Places
            ─▶ write versioned snapshot to R2  +  lookup indices to KV
            ─▶ bump dataset version → clients pick up new version on next launch
```
Runs offline, so the expensive merge never costs a user latency. Dataset is **versioned** so
clients cache aggressively and only re-download on change.

## Client-side caching & offline
- Static dataset cached on device (SQLite / MMKV on native, IndexedDB on web).
- **Browse, search, nearby, and favorites work fully offline.** Only live ETAs need network.
- ETAs use [TanStack Query](./04-frontend-and-design.md) for in-memory caching + dedupe; the
  socket (v2) pushes updates straight into the query cache.

## Regions & performance
- Cloudflare serves from its **Hong Kong PoP** for HK users; upstream calls also originate
  near HK → low round-trips both ways.
- Static assets on CDN; immutable, versioned, long-cache.
- Target: time-to-interactive on a warm PWA in low hundreds of ms; first ETA paint near-instant
  (cached static + a single fast live call).

## Failure & resilience
- Upstream down → serve last-known ETA from cache, clearly marked stale; never spin forever.
- DO/poll error → exponential backoff; degrade `watch()` to polling shim.
- Dataset crawl fails → keep serving the previous good R2 snapshot version.
