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
| **Durable Objects (DO)** | Stateful actors: `EtaHub`, **one per shard and not one per stop** (see Phase 2 below — the per-stop shape was refuted by the cost model and by the battery argument before it was built), holding hibernatable WebSocket subscribers, polling upstream on an alarm and fanning out diffs. ("Redis as pub/sub + coordination.") |
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
  watch(targets): Subscription                            // a frame protocol over a pluggable transport
  getClientPolicy(): Promise<ClientPolicy>                // the numbers the server owns (ADR-053)
}
```

`watch()` is the key abstraction, and since Wave 5 both engines are *the same protocol* rather than two
generations of one method (ADR-056). It runs `snapshot`/`delta`/`status` frames over a `LiveTransport`;
the **default transport is a poll emulator** — HTTP polling on a timer, wearing the frames — and
`createSocketTransport` is the real `/v1/live` socket. A screen subscribes and never learns which
engine answered: the listener's `Eta[]` is canonically ordered by the kernel, so the two are
byte-identical over identical data, and `apps/mobile/lib/useLiveEtas.ts` writes the result through to
the query cache on the key `useQuery` already owns (ADR-058 keeps working).

### The line between the server and the client (ADR-053)

> **The server owns content, order, grouping, counts and text. The client owns layout, colour,
> motion and interaction.**

The `DataSource` seam says *how* the apps reach data. This says *which decisions* are made once for
every platform and which each platform makes for itself — the question that matters the moment an
iOS or Android client exists, because anything the client decides gets decided three times.

A threshold is content; the tone it's rendered in is not. "This remark is a scheduled one" is
content; `text-subtle` is not. So `components/RemarkTag.tsx` mapping a `RemarkKind` to a Tailwind
class is exactly right, and the same table living in a served payload would be exactly wrong.
Accents cross the wire as **semantic tokens** (`accent: AccentToken`), never hex, so each platform
maps to its own colour system — which is also how a served value stays compatible with Dark Mode,
Increase Contrast and Dynamic Type, none of which a hex or a `px` can respect.

`scripts/check-vm-no-styling.mjs` enforces it mechanically over the emitted `openapi.json`: no wire
field name, schema name or literal may match `/#[0-9a-f]{3,8}|px$|fontSize|fontWeight|margin/`. It
runs in `pnpm test` (the root `boundaries` script), and `--selftest` watches each rule fail.

**Tunable numbers are served, not compiled in.** `GET /v1/policy` returns a `ClientPolicy` —
`dueUnderSec`, `warnUnderSec`, `staleAfterMs`, `refreshAfterMs`, `maxArrivals`, `maxRows` — every
field optional, `max-age=300`. It settles what used to be three different answers to "how many
arrivals?" and a client poll cadence that disagreed with the edge's own cache TTL. ADR-008's honesty
thresholds are now one edge deploy rather than three store releases.

**Moving a rule to the edge must not create a second implementation**, and this is the part worth
copying for every future field:

- the rule stays declared **once** in `packages/core`;
- `apps/edge` is the `server` layer and may import the kernel (ADR-051), so the Worker *calls* that
  function and serves the precomputed value;
- the wire field is `.optional()` (ADR-052 §5);
- the client uses the served value when present and calls **the same core function** when it is
  absent — which is what keeps offline working (ADR-058), since a client that can't answer these
  questions on its own is broken in a tunnel.

`sortKey` (ADR-063) was the first field in this shape; `ClientPolicy` follows it.
`CLIENT_POLICY_DEFAULTS` lives in `packages/core` — not in `packages/contract`, which `core` may
only `import type` from — and the Worker serves those very bytes, so there is one declaration rather
than a client copy and a server copy. `apps/edge/src/eta-cache.ts` derives `ETA_TTL_SEC` from
`refreshAfterMs` for the same reason.

Client-side, `lib/useClientPolicy.ts` resolves the served document against the defaults and always
returns six usable numbers, so no screen ever has to invent one. It also reports
`source: 'served' | 'defaults'` — because a policy that silently never arrives leaves the app
working perfectly on defaults, which is the design *and* the failure nobody would otherwise notice.

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

### Phase 2 — the live socket: a sharded `EtaHub` Durable Object (built; ADR-056)
```
Client ──1 WebSocket──▶ Worker  GET /v1/live?targets=<canonical ids, %-encoded>
                          │  Upgrade? Origin? parse + canonicalise targets
                          │  liveShardFor(targets) → "live-<n>"   ← the SERVER hashes, not the client
                          ▼
                     DurableObject EtaHub("live-<n>")   ·  8 shards, SQLite-backed
                          │  ctx.acceptWebSocket(…) + the accepted target set in the ATTACHMENT
                          │  snapshot ──▶ this client   (whatever the shard already knows)
                          │  alarm() every 45→60 s: poll the UNION of every subscriber's targets
                          │     through the same coalescer /v1/etas uses (ADR-057)
                          │     diffEtas(previous, current) → delta { changed, gone }
                          │     nothing changed → send NOTHING, widen the cadence one step
                          └─ no subscriber with anything to watch → no alarm at all
```
- **Sharded, not one object per stop, and one socket per client.** A shard serves whatever its
  subscribers ask for; the shard is derived from the client's *target set*, so everyone watching the
  same places shares one upstream poll while a rider watching six places still holds one socket. The
  cost is that two *partially* overlapping target sets land on different shards and poll the shared
  stop twice — bounded by the shard count, and it duplicates reads, never rider-visible state.
- **The object holds no rules.** The diff, the cadence, the shard hash and the accepted-target union
  are all `packages/core` functions with corpus rows; `apps/edge/src/eta-hub.ts` is plumbing around
  them, which is what keeps the server side portable evidence rather than a second implementation.
- **The cadence is 45–60 s because that is what the data does**, not to save money: a measured
  upstream `data_timestamp` interval of ~45 s (28–60 s observed, n=1 route, one morning) means a
  15 s alarm returns a byte-identical body two ticks in three — and the upstream CDN's `max-age=300`
  and *non-monotonic* `generated_timestamp` mean some of those ticks cannot even see a fresher value.
  It widens by 5 s per quiet round to a 60 s ceiling and snaps back to the floor when something moves.
- **WebSocket Hibernation** is why an idle connection is nearly free: per-connection state lives in the
  socket's attachment and the cadence in SQLite, so the runtime may discard the instance and rebuild
  it. Note what is *proved* — a rebuilt instance recovers its subscription, its readings and its ramp
  position — versus what cannot be observed locally at all: that workerd chose to hibernate (there is
  no local knob; only an explicit eviction). Outgoing messages are free, incoming ones are billed 20:1,
  and the keepalive is answered by the runtime's auto-response without waking the shard — so **reconnect
  churn, not message volume, is what a socket costs.**
- **Caps, because a `subscribe` frame is an amplifier**: 12 targets per connection, 48 per shard, 12 CTB
  routes per place per round, 64 sockets per shard, 8 KiB per client frame. Excess is *rejected and named* in
  the snapshot's echo, never truncated silently — and never by refusing the connection: a shard that refused
  a full upgrade was a lock-out one script could trigger for every rider on that shard, which is why the cap
  lives in `subscribe()` and the excess is `internal`/`retryable: true` rather than `bad_request` (ADR-056
  decision 15). What would actually protect the endpoint is zone rate limiting, which needs the custom domain
  (WP0-5); the caps only stop one connection from fanning out.
- **Swapped in behind `DataSource.watch()`** — and that claim is now tested rather than asserted: the
  same screen renders identically from the poll emulator and from a scripted socket
  (`apps/mobile/test/seam-substitution.test.tsx`), and a gate keeps transports out of the view layer.
- **Not deployed.** The shard runs under `wrangler dev` and inside workerd in the suite, against the live
  KMB feed; nothing has ever served a socket from a real domain (WP0-5). The shipped default engine is
  still HTTP polling wearing the same frames, and selecting the socket engine is a source edit today.
- This is still the foundation for v3: "bus approaching" push, alerts, history.

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
  ─▶ fold one physical pole published twice onto one member (WP5-11) → boarding points
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
| `alias:<hash>:<stopId>` | Any clustered pole → the place id that owns it, so a bare pole id off a route's stop list resolves. **Every** pole, including one folded onto a member (below) — a folded id is one riders have starred, so it has to keep resolving. |
| `route:<hash>:<id>` | One `RouteDoc`: the route, its ordered stops with fares, and the reverse bound (ADR-046). |
| `geo:<hash>:<cell>` | Ranking stubs for one 0.01° (~1.1 km) cell — id, anchor, member-pole coordinates. Nothing more. |
| `build:current` | The manifest. **The only mutable key in the namespace.** |
| R2 `builds/<hash>/search-index.json` · `manifest.json` | The bulk artefacts, too big for a comfortable KV value. |

A real build: **10,115 places · 6,354 aliases · 3,649 routes · 485 geo cells (14,071 stops)** —
≈20.6k KV keys, 2.6 s to build.

**One physical pole, published twice (WP5-11).** Upstream sometimes lists one pole under two stop
ids. Clustering already put them in one place, but as two members, so the Place screen printed two
headings that were identical character for character. The build now folds a pole onto another when a
rider could not possibly tell them apart — **same operator, same name in every locale, and no more
than one coordinate grid step (2 m) apart** — leaving one member per *boarding point* (80 poles folded
across 75 places). Two consequences worth knowing:

- **Nothing is deleted.** The folded id keeps its stop record, its route rows, its slot in every
  route's stop sequence, its `alias:` entry and its place in the `P:` id. Favourites key on a member
  pole id (ADR-062) exactly so clustering changes are survivable, so a fold that removed an id would
  strand every favourite saved at it. The member carries the folded ids in `aliasIds`, and
  `boardingPoleId` (`@nextbus/core`) is the map back — applied at *render* time, where it is only a
  display decision.
- **The ETA fan-out calls both boards, and a reading keeps the id of the board it came off.** The
  routes upstream lists at a folded pole are its own — 0 of the 324 route rows on a folded pole also
  appear on its member, and all 80 folded poles carry rows — so skipping its board would leave those
  rows blank across 75 places while everything else looked healthy. Each reading is stamped with the
  **pole that was called**, never with the boarding point it is displayed under, because
  `applyLiveEtasToStopDetail` matches a reading to a row by `(stopId, routeId)`: re-basing on the way
  out makes the two disagree and blanks every arrival at a folded pole, on `/v1/stop`, `/v1/etas` and
  the `EtaHub` frames alike. So an alias is a real addressable pole and the fold never reaches the
  wire — it is a display collapse the client applies (`dedupeRoutes(routes, members)`).

Distance alone is never the rule: it is a necessary condition, and the name test is what does the
work. Above 2 m the pairs stay as two members — see WP5-11's row in
[`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md) for what remains.

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

The two tiers are **two named schemas**, not one schema with an optional field (ADR-065): a stop
response returns `RouteSummary` → `RouteServiceSummary`, which has no `patterns` property at all,
and `/v1/route/:id` returns `Route` → `RouteServiceInfo`, which does. A generated decoder therefore
cannot read a missing frequency table as a fact about the route when it is really a fact about the
endpoint. The bytes on the wire are unchanged; only the names the OpenAPI document gives them are
new. `toRouteSummary` (`@nextbus/data-normalize`) is the single definition of what the tier drops,
applied by the shard build for **size** and again by the Worker's `/v1/stop/:id` for the
**contract** — a KV document is untyped JSON that may have been written by an older publisher.

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
| `/v1/policy` | Persisted query cache | Six numbers (ADR-053). No service-worker rule of its own: the persisted TanStack cache already replays the last policy this device was served, and a first-ever cold start has none — which `resolveClientPolicy` turns into the shipped defaults. Never a spinner and never a hole. |

- The TanStack Query cache is **persisted** (`PersistQueryClientProvider` + an AsyncStorage
  persister — localStorage on web, the native store on iOS/Android), so a cold *offline* start paints
  the last known arrivals instead of a spinner. Successes only: a persisted error would replay as
  "the app is broken" rather than "we're offline". This is not a breach of ADR-008 — what's restored
  is a *labelled old reading*, never a fresh-looking one.
- The GPS fix is snapped to a **25 m grid** before it leaves the device (`snapFix` in
  `packages/core/src/geo-snap.ts`, corpus-pinned — WP2-6). Privacy,
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
- **Every failure carries the same envelope** — `{code, message, retryable}` (plus a deprecated
  `error`), with `code ∈ {bad_request, not_found, internal, upstream_unavailable, upstream_timeout}`
  and the status code read off the contract's own table, never chosen at the call site (ADR-064).
  `retryable: false` means *the request is permanently wrong*, which is what lets a background
  client — a Favourites refresh, later an iOS Widget — prune a saved id instead of retrying it
  forever. `packages/contract/src/wire/responses.ts` declares the table; `apps/edge/src/errors.ts`
  is the only way to build a failure response.
- Upstream down → serve last-known ETA from cache, clearly marked stale; never spin forever.
- DO/poll error → exponential backoff; degrade `watch()` to polling shim.
- Dataset build fails → `build:current` never flips, so the previous build keeps serving **in full**;
  the partial write is an unreachable orphan. Rollback is one key write.
- Bindings missing or no `build:current` → the Worker builds the index in-request and says so:
  `/v1/health` reports `dataset: "inline"` and a non-zero `datasetBuildsThisIsolate`. Slower, not down.
- Tile upstream fails → their 404 stays a `not_found` 404, their 504 a `upstream_timeout` 504,
  anything else a `upstream_unavailable` 502 — all `no-store`, all carrying the JSON envelope above;
  the service-worker tile cache still redraws what the rider has already seen.
