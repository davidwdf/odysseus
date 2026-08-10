# 05 — Live times on a route nobody asks about

> **Status:** proposal, **not built**. Drafted 2026-08-10 after the owner's brainstorm, which settled the
> shape: *"load all the stops in parallel for a route, update them to the user through the live socket… if
> user A and user B are both viewing the same CTB/GMB route, ideally I'd like to only do that fan-out once."*
> Options **A** (times in the action sheet) shipped as
> [ADR-115](../08-decision-log.md#adr-115--the-sheet-a-rider-already-opens-is-where-one-stops-times-go);
> this is **B**. The numbers below are **measured**, not estimated — the `EtaHub` cap's own docblock records
> what happened the one time they were estimated from a fixture instead, and it was wrong by an order of
> magnitude.
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

**Measured 2026-08-10 against the live upstream**, not the fixture:

| | |
|---|---|
| `rt.data.gov.hk` Citybus ETA response headers | `cache-control: max-age=45`, `x-cache: Hit from cloudfront`, `age: 31` |
| one call | ~0.37 s |
| real Citybus route sizes (distinct poles) | 788: **13** · 1: **18** · 5B: **29** · 91: **33** · 962: **36** · E22: **41** |
| **a full E22 round — 41 calls, 6 at a time as the runtime allows** | **2.56 s** |

Two things follow, and they are the argument:

1. **The publisher is asking to be cached for 45 s and has a CDN in front.** Our own `coalesce` TTL is 30 s
   — *tighter* than they ask for. A repeat call is absorbed twice over before it reaches an origin.
2. **A route round is cheap where a place round is not.** The expensive term in a shard's round is CTB
   `(pole, routeNo)` pairs, because Citybus has no per-*stop* board. A **place** needs every route at every
   pole (the shipped dataset's heaviest costs 32 calls at `DEFAULT_CTB_BUDGET`); a **route** needs exactly
   one routeNo per pole. So the whole of E22 is 41 calls where twelve Central-class places are 785.

| | work per round | against the 45 s cadence floor |
|---|---|---|
| a shared shard at its cap today (48 place-targets, budget 12) | 785 calls ≈ 39 s *(measured, `eta-hub.ts`)* | **87%** — its own docblock: *"not a comfortable margin"* |
| **the longest real Citybus route** | **41 calls ≈ 2.56 s** *(measured here)* | **5.7%** |

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
| `LIVE_ROUTE_MAX_POLES` | **64** | Above the longest real route measured (41) with headroom, and a hard stop so a pathological dataset row cannot mint a 300-call round. Excess poles are **dropped and named** in the `status` frame, the treatment `eta-hub.ts` already argues for over refusing a whole connection. |
| `LIVE_ROUTE_MAX_SOCKETS` | **64** | Unchanged from `LIVE_MAX_SOCKETS_PER_SHARD`. Sockets on a route object cost nothing extra: they all want the same round. |
| cadence | **unchanged** (45 s floor / 60 s ceiling) | 2.56 s of work inside 45 s. The ramp stays as-is. |
| `LIVE_CTB_BUDGET` | **not applied here** | It bounds *routes per pole*, which on a route watch is always one. Applying it would silently truncate a 36-stop route to 12 stops — the failure mode this proposal exists to remove. |

**The number a reviewer should push on** is `LIVE_ROUTE_MAX_POLES = 64`: 64 poles is a 4 s round, still 9% of
the cadence, but it is the one place a bad dataset row turns into upstream load.

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
