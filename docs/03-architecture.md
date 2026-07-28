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
| **Workers KV** | The dataset itself: precomputed, content-addressed shards that a request reads a few keys at a time (ADR-055). Plus the short-TTL ETA cache. ("Redis as a cache.") |
| **R2** | The bulk per-build artefacts a KV value doesn't suit: the search index and the manifest (cheap, no egress fees). |
| **Durable Objects (DO)** | Stateful actors for v2: one per "hot stop", holds WebSocket subscribers, polls upstream on an alarm, fans out diffs. ("Redis as pub/sub + coordination.") |
| **D1** (SQLite at edge) | Optional: relational canonical data / future account sync. |
| **Cron Triggers** | **Not used.** The daily dataset build runs in GitHub Actions instead (ADR-055) — a Worker can't afford the 8.3 MB fetch, the clustering and ~20 MB of heap, and a 128 MB DO couldn't do it at all. There is no `[triggers] crons` and no `scheduled` handler. |
| **Queues** | Not used. The build is one node process end to end; there is no pipeline to orchestrate. |

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
Client ──poll every ~20–30s──▶ Worker /v1/etas/:id
                                  │  Cache API hit (max-age 30s) → return cached
                                  └─ miss → coalesce(pole) ──┬─ in-flight? await it
                                                             └─ else fetch upstream (KMB/CTB/GMB)
                                            → normalize → cache → return
```
- **Coalescing happens in two layers, and both are needed** (ADR-057, `apps/edge/src/eta-cache.ts`):
  the edge **Cache API** only helps once a response exists, so a burst of concurrent first-callers
  all miss it; an isolate-level map keyed per *upstream call* shares the **in-flight promise**, so a
  pole is fetched **once per 30 s per isolate** however many requests want it. `/v1/nearby` fans out
  to every member pole of every nearby place, which is exactly where that burst comes from.
- **TTL is 30 s** (`ETA_TTL_SEC`), not the 8 s (ETAs) / 10 s (nearby) it was. Upstream only refreshes
  about once a minute, so at 8 s the hit rate was ~0% and the cache never bound. Staleness is still
  surfaced honestly from each reading's own `observedAt` (ADR-008).
- Static data is read from KV shards (and cached on device), so browse/search/nearby need no live calls.
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

## The dataset: a daily precompute, served as KV shards (ADR-055)

The Worker used to build the whole static index **in-request**: an 8.3 MB fetch, ~67 ms of
`JSON.parse` and ~20 MB of heap on every cold isolate, plus a hard runtime dependency on
`data.hkbus.app` being up. The derivations are unchanged; they just happen once, outside the
request path, and are sliced so a request reads **only the documents it needs**.

```
GitHub Actions  (daily 19:00 UTC = 03:00 HKT, or workflow_dispatch)
  ─▶ fetch the 8.3 MB consolidated dataset          → hash the raw body (sourceHash)
  ─▶ normalize to the canonical model (02-data-sources.md)
  ─▶ same-kerb direction-aware clustering (ADR-042) → Places
  ─▶ slice into per-id documents, hash the payloads → build <hash>
  ─▶ write EVERY shard to KV + R2                   (hash-namespaced ⇒ invisible to readers)
  ─▶ flip `build:current` LAST                      ← the moment the build becomes reachable
  ─▶ prune superseded builds, keeping a rollback target
```

`sourceHash` lets an unchanged day skip republishing entirely — KV writes are the metered side of
this design, so a no-op republish is pure cost.

### Key grammar
Every key carries the build hash, so two builds can coexist and no reader can see a mixed one.

| Key | Holds |
|---|---|
| `place:<hash>:<id>` | One `PlaceDoc` — everything `/v1/stop/:id` and `/v1/etas/:id` need, in one read. |
| `alias:<hash>:<stopId>` | Member pole → the place id that owns it, so a bare pole id off a route's stop list resolves. |
| `route:<hash>:<id>` | One `RouteDoc`: the route, its ordered stops with fares, and the reverse bound (ADR-046). |
| `geo:<hash>:<cell>` | Ranking stubs for one 0.01° (~1.1 km) cell — id, anchor, member-pole coordinates. Nothing more. |
| `build:current` | The manifest. **The only mutable key in the namespace.** |
| R2 `builds/<hash>/search-index.json` · `manifest.json` | The bulk artefacts, too big for a comfortable KV value. |

A real build: **10,118 places · 6,351 aliases · 3,653 routes · 486 geo cells (14,072 stops)** —
≈20.6k KV keys, 2.6 s to build.

**Why the flip is last.** A failed run leaves an unreachable orphan rather than a half-served
dataset, and a rollback is a single key write. That property is the write *order*, not a
convention — see `apps/edge/scripts/publish-dataset.mts`.

**Why geo cells hold stubs, not places.** A dense urban cell holds a couple of hundred places;
inlining their route lists would make one cell megabytes, so every nearby query would pull a slab
of the territory to draw six cards. Instead a 500 m query reads **~4 cells**, ranks the stubs by
**nearest member pole** (the walk the rider actually makes), then reads only the **≤6 winning place
documents**.

### Two tiers, one code path
Every endpoint reads through `DatasetSource` (`apps/edge/src/dataset.ts`), which has two
implementations returning the same document shapes:

- **`kvSource`** — production. A handful of KV point reads; the 8.3 MB dataset is never fetched,
  never parsed, never held in the isolate.
- **`inlineSource`** — the fallback, used when the bindings are missing or `build:current` is
  absent. Builds the index in-request, exactly as the Worker used to. It keeps `pnpm dev:edge`
  working against no remote state, and degrades an empty namespace to *slow* rather than *down*.

`GET /v1/health` (never cached) reports `{ok, dataset: 'kv'|'inline', buildHash,
datasetBuildsThisIsolate}`. **`datasetBuildsThisIsolate` must be 0 in production** — it counts the
times this isolate built the index in-request. `apps/edge/test/dataset-kv.test.ts` seeds a build and
sweeps every endpoint asserting it stays 0, and the publish workflow re-checks it against the
deployed Worker. That counter, not code review, is what stops the slow path quietly returning.

### A wire-contract consequence worth knowing
`/v1/stop/:id` returns each route's `service` in a **summary tier** — `fareFull`, `journeyMin`,
`headway`, `hours` — and drops `patterns`, the per-day-type frequency profiles. Duplicating
`patterns` into every place a route touches was **54 MB of an 82 MB build**, and nothing on the
Place screen reads it. `/v1/route/:id` still carries the full profiles, which is where the Route
fact sheets read them from (ADR-044).

## Basemap tiles (Worker proxy, ADR-049)
`GET /v1/tiles/basemap/:z/:x/:y.png` and `GET /v1/tiles/label/:lang/:z/:x/:y.png` proxy the Hong Kong
Lands Department raster services (`apps/edge/src/tiles.ts`). Three reasons it's a proxy and not a
URL in a component:

- LandsD send `cache-control: private, must-revalidate, max-age=43200`, and `private` makes every
  shared cache a no-op. We deliberately re-emit
  `public, max-age=43200, stale-while-revalidate=86400`, which turns twenty riders in Mong Kok into
  one upstream request. Caching is expressly permitted by the CSDI licence; the 12 h TTL is theirs.
- It's the seam the native clients share, so the basemap can be repointed without an app release.
  The client side of it is `apps/mobile/lib/tileSource.ts`.
- The pinned upstream API version lives in one file.

Demand-driven only: we never pre-warm a pyramid, because the one published limit is "not a large
amount of requests within a short period". Labels are a separate per-language layer, so switching
locale relabels the map with no restyling.

## Client-side caching & offline (ADR-058)
The PWA is built by `pnpm --filter @nextbus/mobile build:web` — `expo export -p web` followed by a
Workbox `generateSW` pass over the same output, in one command so the precache manifest can't drift
from the bundle it describes. The runtime is **inlined** into `sw.js` (no CDN `importScripts`, which
would make the *offline* worker need the network on first run). `lib/serviceWorker.ts` registers
`/sw.js` on **production web only** — never native, never dev, where a stale worker intercepting
Metro's module requests is a genuinely nasty bug.

Four layers, each matched to what it's caching:

| Layer | Strategy | Why |
|---|---|---|
| App shell | Precache | Expo's export is content-hashed, so cache-first is safe *and* the fastest cold start. This is what makes the app **open** offline. |
| `/v1/index` (search index) | Stale-while-revalidate | Large, changes about daily. Search and the keypad work instantly and offline, then quietly catch up. `lib/searchIndex.ts` also keeps its own AsyncStorage copy, so search survives a cache eviction. The revalidation is cheap: the response carries a strong **ETag** — the index's own content hash, which is also its `version` — so an unchanged index costs a 304 rather than the blob (ADR-063). |
| `/v1/nearby` · `etas` · `stop` · `route` | Network-first, 4 s timeout | Never cache-first: a bus that left four minutes ago is worse than no answer (ADR-008). The cached copy is the offline fallback and carries its original `observedAt`, so it's aged and labelled stale. |
| `/v1/tiles/*` | Cache-first, runtime only | A tile already seen redraws offline. Deliberately **not** precached — speculatively fetching tiles nobody looked at is what LandsD's rate limit prohibits. |

- The TanStack Query cache is **persisted** (`PersistQueryClientProvider` + an AsyncStorage
  persister — localStorage on web, the native store on iOS/Android), so a cold *offline* start paints
  the last known arrivals instead of a spinner. Successes only: a persisted error would replay as
  "the app is broken" rather than "we're offline". This is not a breach of ADR-008 — what's restored
  is a *labelled old reading*, never a fresh-looking one.
- The GPS fix is snapped to a **25 m grid** before it leaves the device (`lib/geoSnap.ts`). Privacy,
  edge-cacheability (raw coordinates jitter by metres, so `/v1/nearby` was a fresh cache key on
  nearly every request) and offline replay (the query key is the fix) all fall out of one function.
- Still to come: the full on-device static index (ADR-007). Today the device caches the search index
  and the query results, not the whole dataset — so browse/search work offline, and nearby works
  offline for places you've already seen.

## Regions & performance
- Cloudflare serves from its **Hong Kong PoP** for HK users; upstream calls also originate
  near HK → low round-trips both ways.
- Static assets on CDN; immutable, versioned, long-cache.
- Target: time-to-interactive on a warm PWA in low hundreds of ms; first ETA paint near-instant
  (cached static + a single fast live call).

## Failure & resilience
- Upstream down → serve last-known ETA from cache, clearly marked stale; never spin forever.
- DO/poll error → exponential backoff; degrade `watch()` to polling shim.
- Dataset build fails → `build:current` never flips, so the previous build keeps serving **in full**;
  the partial write is an unreachable orphan. Rollback is one key write.
- Bindings missing or no `build:current` → the Worker builds the index in-request and says so:
  `/v1/health` reports `dataset: "inline"` and a non-zero `datasetBuildsThisIsolate`. Slower, not down.
- Tile upstream fails → 404 passes through, anything else becomes a 502 marked `no-store`; the
  service-worker tile cache still redraws what the rider has already seen.
