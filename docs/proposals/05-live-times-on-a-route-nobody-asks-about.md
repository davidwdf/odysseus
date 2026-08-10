# 05 — Live times on a route nobody asks about

> **Status:** proposal, **not built**. Drafted 2026-08-10 after the owner's brainstorm, which settled the
> shape: *"load all the stops in parallel for a route, update them to the user through the live socket… if
> user A and user B are both viewing the same CTB/GMB route, ideally I'd like to only do that fan-out once."*
>
> ⚠️ **The measurements were rewritten the same day**, after the owner asked why looking up 41 stops took
> seconds. It does not: the first attempt was a **method** error, off by 5×, and the corrected working is in
> [The numbers](#the-numbers). The design is unchanged and its margin is wider.
> Options **A** (times in the action sheet) shipped as
> [ADR-115](../08-decision-log.md#adr-115--the-sheet-a-rider-already-opens-is-where-one-stops-times-go);
> this is **B**. The numbers below are **measured** — and the first set of them was still wrong, which is the
> more useful lesson than the one this paragraph originally carried: the `EtaHub` cap's docblock records being
> wrong by an order of magnitude from estimating off a fixture, and this document then managed to be wrong by
> 5× from measuring badly. Both failures are visible in it on purpose. **Every platform limit quoted here has
> been checked against Cloudflare's documentation rather than recalled.**
>
> **Nothing here is a licence to poll harder.** The whole design exists so that the *n*th rider on a route
> costs nothing upstream, and the review question is whether the caps hold that promise.

## The problem, in one paragraph

`/v1/route/:id` fetches live arrivals for KMB and LWB only: Citybus publishes no bulk route-eta endpoint
([ADR-021](../08-decision-log.md)) and GMB is not wired. Since
[ADR-114](../08-decision-log.md#adr-114--eta-null-on-every-stop-meant-three-different-things-and-the-route-view-could-not-say-which)
the screen at least **says so** (`liveArrivals: 'perStopOnly'`), and since ADR-115 a rider can tap one stop
and get that stop's times. What they still cannot see is the whole route: which of these thirty stops has a
bus coming, and where the buses are. Those operators' **per-pole** boards answer perfectly well; nobody
asks them.

## What already exists, and it is most of the design

**The sharing the owner asked for is already the shard function's stated purpose.** From
`liveShardFor` in `packages/core/src/live.ts`:

> Sort the accepted stop ids, hash the lowest, take it modulo the shard count. **Two clients watching the
> same places therefore land on the same shard and share one upstream poll** — the case that matters, since
> a hot stop is hot because many people are looking at it.

Two riders on one route have an *identical* target set, so they land on the same object, which runs **one**
round for the union of its sockets' targets, deduplicated by `coalesce` (ADR-057). Ten riders on Citybus 962
cost what one costs. That is the property, and it needs no new mechanism — only a namespace that keeps a
route's round away from everyone else's (below).

Also already in place: hibernating WebSockets, a snapshot/delta frame protocol with a diff
(`packages/core/src/live.ts`), a per-key coalescer, `retainFailedPoles`, and an AsyncAPI document that is
emitted and drift-gated.

## The numbers

**Measured 2026-08-10 against the live upstream**, and then **re-measured after the first attempt was wrong
by 5×** — which is worth leaving in, because the error was a method error and the method is the only part of
a measurement worth reviewing.

### One lookup, and where its time goes

| | |
|---|---|
| find the address (DNS) | 0.072 s |
| open the connection (TCP) | 0.113 s cumulative |
| secure it (TLS) | 0.161 s cumulative |
| **total, cold** | **0.215 s** |
| **the same lookup again on the open connection** | **0.045 s** |

So **dialling costs ~0.16 s and asking costs ~0.045 s.** `rt.data.gov.hk` speaks **HTTP/2**, so many
requests share one connection: measured, 41 requests opened **one** TCP connection whether the client allowed
6 in flight or 41.

### The whole route, three ways

| method | 41 poles of Citybus E22 |
|---|---|
| a fresh connection per lookup, in lockstep groups of six *(the first attempt — **wrong**)* | 2.56–3.47 s |
| **6 in flight, one reused connection — the model that matches Workers** | **0.46 s** |
| 41 in flight *(not available to us — see below)* | 0.27 s |

**The first row measured the method, not the API.** It redialled 41 times, paying ~0.16 s of handshake each
time, and made every group of six wait for its slowest member. Neither is what a Worker does.

### Why the middle row is the honest one

Checked against Cloudflare's own docs rather than remembered:

- The limit is *"up to six connections simultaneously waiting for response headers"*, **per invocation**, and a
  seventh **queues** rather than failing — so the fan-out completes, it just paces itself.
- **It counts `fetch()` calls in flight, not sockets.** The HTTP/2 finding above makes the transport cheap and
  buys **no** extra concurrency; six in flight is six in flight however few pipes they share. (This was briefly
  believed to be an escape from the limit. It is not.)
- Since **2026-04-09** a slot frees when *headers* arrive rather than when the body finishes reading. For ETA
  JSON that is nearly the same, so it changes nothing here beyond making older estimates upper bounds.

`curl --parallel-max 6` holds six in flight, which is why the middle row models a Worker well: 41 ÷ 6 ×
0.045 s ≈ 0.31 s against 0.46 s measured.

### Cost against the cadence

| | work per round | against the 45 s cadence floor |
|---|---|---|
| a shared shard at its cap today (48 place-targets, budget 12) | 785 calls ≈ 39 s *(ceiling, `eta-hub.ts`)* | **87%** — its own docblock: *"not a comfortable margin"* |
| **the longest real Citybus route** | **41 calls ≈ 0.5 s** *(measured here)* | **~1%** |

Real Citybus route sizes, for scale: 788: **13** · 1: **18** · 5B: **29** · 91: **33** · 962: **36** ·
E22: **41** distinct poles.

The reason a route round is so much cheaper than a place round is structural, not incidental: the expensive
term is CTB `(pole, routeNo)` pairs, because Citybus has no per-*stop* board. A **place** needs every route at
every pole (the shipped dataset's heaviest costs 32 calls); a **route** needs exactly one routeNo per pole.

### And a correction to the caching claim

An earlier draft of this document said the upstream's `cache-control: max-age=45` and its CloudFront hit mean
*"a repeat call is absorbed twice over before it reaches an origin."* **That is wrong and is the sort of
comfort worth deleting rather than softening.** The `x-cache: Hit from cloudfront` is *their* cache, on the far
side of the connection: the Worker still opens a connection and still waits for headers, and the hit only makes
the wait shorter. For **Cloudflare's** cache to intercept, the response would have to be cacheable to it — and
Cloudflare does not cache JSON by default, and the ETA path never sets `cacheEverything` (only the tile path
does). So there is exactly one layer of sharing on our side and it is ours: `coalesce` at a 30 s TTL, plus the
one round per route that this proposal is for.

What the upstream's 45 s *does* legitimately tell us is that **asking more often than that buys nothing** — the
answer would be identical — which is the argument for the cadence floor rather than for the load being free.

## The design

### 1. A route watch is its own Durable Object, named for the route

Today a shard is `live-<0..7>`, chosen by `hash(lowest stopId) % 8`. A route watch would be
`route-<canonical route id>` — the **same `EtaHub` class**, a different name, so no new binding and no
wrangler change.

Why a namespace rather than raising `LIVE_MAX_TARGETS_PER_CONNECTION` from 12:

- **A route's 36 targets would otherwise union with strangers'.** There are 8 shards; a route's set lands on
  one of them deterministically and shares its round with whatever else hashes there. Two watched routes plus
  a few Favourites screens walks straight into the 39 s cliff. Named per route, a round is *only* that
  route's poles — bounded, predictable, and unaffected by who else is online.
- **The per-connection cap of 12 is right for what it guards** and should not move: its docblock says the
  largest legitimate subscription is a Favourites screen. A route is not that, and pretending it is means one
  number serving two unrelated purposes.
- **Every rider on one route shares one object** — the property we are here for — because the name *is* the
  route id. No hashing, no partial-overlap duplication.

### 2. The client names the route, not the poles

`/v1/live?route=<canonical route id>` beside today's `?targets=`. The Worker resolves the poles from the
dataset it already has. Three things fall out: the URL stays short instead of carrying 41 ids; the target set
has one source of truth (the same document `/v1/route/:id` reads); and `LIVE_MAX_TARGETS_PER_CONNECTION`
does not apply, because the client is not naming targets.

### 3. Only for operators with no route-level feed

The subscription is opened **only** when `liveArrivals === 'perStopOnly'`:

- `answered` — the route payload already carries every stop's times. Subscribing would be a second source of
  truth for data already on screen.
- `unavailable` — the KMB round failed. The payload's own refetch retries it for the cost of **one** call;
  fanning out 36 to work around one failure is the wrong trade.

So the whole feature is bounded to Citybus and GMB, which is also the only place a rider currently loses.

### 4. Caps, and they are new constants rather than reused ones

| constant | proposed | why |
|---|---|---|
| `LIVE_ROUTE_MAX_POLES` | **64** | Above the longest real route measured (41) with headroom, and a hard stop so a pathological dataset row cannot mint a 300-call round. At 64 poles a round is ~0.8 s — still under 2% of the cadence — so this cap is guarding the *dataset*, not the clock. Excess poles are **dropped and named** in the `status` frame, the treatment `eta-hub.ts` already argues for over refusing a whole connection. |
| `LIVE_ROUTE_MAX_SOCKETS` | **64** | Unchanged from `LIVE_MAX_SOCKETS_PER_SHARD`. Sockets on a route object cost nothing extra: they all want the same round. |
| cadence | **unchanged** (45 s floor / 60 s ceiling) | ~0.5 s of work inside 45 s, and the upstream refreshes only every 45 s anyway, so a faster cadence would re-read identical answers. The ramp stays as-is. |
| `LIVE_CTB_BUDGET` | **not applied here** | It bounds *routes per pole*, which on a route watch is always one. Applying it would silently truncate a 36-stop route to 12 stops — the failure mode this proposal exists to remove. |

**The number a reviewer should push on** is `LIVE_ROUTE_MAX_POLES = 64`: it is the one place a bad dataset row
turns into upstream load, and the clock is no longer the thing arguing for it.

**And one documented hole, named rather than filled.** Whether the six-in-flight limit applies *per Durable
Object instance* — so that sharding a route's poles across objects would genuinely raise throughput — **is
stated nowhere in Cloudflare's docs**. Two sentences point opposite ways: the Durable Object limits row is
labelled per *request* and an alarm is its own invocation, but the runtime is documented as measuring from
"the top-level request" and Service bindings are called out as *sharing* the limit while DO stubs are not
mentioned at all. Nothing here depends on it. If it is ever needed, it is settleable only on **deployed**
Cloudflare, because local dev does not enforce the limit.

### 5. Aggregate cost, stated plainly

Per round, per **route being watched** — not per rider. So the bill is proportional to *distinct
CTB/GMB routes open somewhere*, and:

- 1 route watched = 36 calls / 45 s ≈ **0.8 req/s**
- 20 routes watched = **16 req/s**
- 200 routes watched = **160 req/s** ← the number to be uncomfortable about

Two mitigations already exist and one is a decision: the upstream's `max-age=45` + CDN absorb repeats; the
coalescer dedupes a pole shared with a Nearby watch; and if the tail ever matters, a route object could
**stop polling when its last socket closes** (it does — hibernation) and a global ceiling on concurrent route
objects could shed the rest. Not proposed now: measure first.

## What changes

| file | change |
|---|---|
| `packages/core/src/live.ts` | `LIVE_ROUTE_MAX_POLES`; a `routeWatchName(routeId)` helper (the DO name, portable arithmetic like `liveShardFor`); `@spec live#routeWatchName` + corpus |
| `apps/edge/src/index.ts` | `/v1/live?route=…` → resolve poles from the dataset → `ETA_HUB.idFromName(routeWatchName(id))` |
| `apps/edge/src/eta-hub.ts` | a round that takes its targets from a resolved route rather than from sockets' unions; the new cap; `test/eta-hub-caps.test.ts` grows the route case |
| `packages/api-client/src/live/` | a `watchRoute(routeId)` alongside `watch(targets)`; the socket URL builder |
| `packages/contract` | the `route` query parameter and any frame addition → `asyncapi:emit` |
| `apps/web/src/screens/RouteDetail.tsx` | subscribe when `perStopOnly`; merge frames into the rows |
| `packages/core` | the merge rule (which reading updates which row) as a kernel function with corpus rows — **not** in a screen |
| `packages/contract/ui/route-detail.spec.json` | `noLiveBoard` stops being a state a rider sees on Citybus; what replaces it needs declaring |

## What this is not

- **Not a feed for other apps.** Considered and declined in the same conversation: polling all of Hong Kong
  every 45 s is ~20–25 k calls ≈ 450–550 req/s sustained, which is not a polite thing to do to a free
  government API. If it is ever revisited it must be *subscription-driven*, and
  [ADR-063](../08-decision-log.md) records that there is still no HK GTFS-Realtime feed to consume or to
  imitate.
- **Not an accordion.** Rejected with the owner: it competes with the row's existing save sheet (ADR-032),
  which ADR-115 turned into the answer instead.
- **Not a warm cache.** A route object exists only while somebody is watching, which is strictly better than
  warming a popular list: nothing is spent on routes nobody has open.
- **Not `apps/mobile`'s.** ADR-113 makes it the reference and owes it no new affordance.

## Order of work

1. `routeWatchName` + `LIVE_ROUTE_MAX_POLES` in the kernel, with corpus rows. *(no behaviour)*
2. `/v1/live?route=…` resolving poles server-side, and the hub's route round + cap test. *(edge only,
   verifiable with a socket client and `curl`)*
3. `watchRoute` in `packages/api-client`, over the existing transports.
4. The merge rule in `packages/core`, with corpus rows.
5. `apps/web` subscribes when `perStopOnly`; the spec state changes with it.

Steps 1–2 are independently reviewable and land no UI, which is the point of splitting there: the cap
arithmetic gets checked against a real socket before a screen depends on it.
