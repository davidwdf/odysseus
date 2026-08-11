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
answer would be identical. It is not, however, an argument for polling *at* 45 s either, which the next section
is about: the 45 s is the CDN's TTL and the data moves on a different clock.

### The cadence should follow the route's own publish clock, not the CDN's

**Measured 2026-08-10, and it changes the cadence.** The owner asked whether we can tell when the upstream
will next update, and poll just after it rather than at a random phase. We can — but the obvious signal is a
red herring.

`age` on the response does exactly what it looks like: it climbs 0 → 44 and resets, so `45 − age` is a real
countdown to the next cached copy. **The data, however, does not update on that 45 s clock.** Caught directly
on one stop:

```
21:28:05  age 41   data_timestamp 21:27:12
21:28:10  age  0   data_timestamp 21:27:12   ← the CDN refetched and got nothing new
21:28:57  age  0   data_timestamp 21:28:13   ← this refetch was the fresh one
```

That refetch landed three seconds before the origin published. So **roughly one CDN refresh in four returns
identical data** — a round paid for and nothing learned.

**The clock that matters is in the payload.** `data_timestamp` is *per route*, shared by every pole on it, and
lands on a fixed second of the minute. Six (stop, route) pairs sampled at the same instant, twice:

| route | three stops, first sample | …second sample | publishes at |
|---|---|---|---|
| E22 | all `21:29:12` | all `21:30:13` | **:12–:13** |
| 91 | both `21:29:09` | both `21:30:10` | **:09–:10** |

~60 s apart, phases **differing per route**, and E22 was still on :13 in samples 25 minutes earlier. Every pole
on one route publishes together.

**Which is exactly the shape of the per-route object below**: one object, one route, one clock — and it can
learn its own route's phase from its own responses. Schedule the next round for `newest data_timestamp + 60 s
+ a small margin` rather than a fixed 45 s tick. That is **25% fewer upstream calls** than a 45 s cadence *and*
fresher data, because every round lands just after a publish instead of three in four landing anywhere.

**The catch, stated rather than smoothed:** the CDN entry is shared with every other consumer of this API, so
whoever's request created the current entry set its phase — not us. We can therefore be handed a still-valid
copy older than the newest publish; the worst case in this sample was **78-second-old data on a cache hit**.
Alignment improves the odds and cannot guarantee. What it *can* do is **notice**: if `data_timestamp` has not
advanced, the round learned nothing, and retrying once a few seconds later is cheaper than waiting out another
minute. The frame protocol already diffs, so a no-change round pushes nothing to a client either way.

**Rejected, explicitly:** a cache-buster query parameter would guarantee freshness by bypassing the shared
cache — moving our load from CloudFront onto the origin, for about ten seconds of freshness. That is the
behaviour this whole proposal exists to avoid.

**Consequence for the constants:** `LIVE_CADENCE_FLOOR_MS` stays as the floor for *place* watches, and a route
watch gets a phase-aligned schedule of its own (~60 s) instead. That is a second reason the route namespace is
separate rather than a raised cap: the two have different clocks, not just different budgets.

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
| cadence | **phase-aligned ~60 s**, not the 45 s floor | ~0.5 s of work per round. The upstream publishes once a ~60 s cycle on a per-route second-of-minute, so a 45 s tick returns identical data about one round in four — see the section above. Fewer calls *and* fresher data. |
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

> **Measured, and the first measurement was 19× this.** Step 2 opened a real socket on
> `CTB:11:outbound:1` (18 poles) and counted every upstream call: **350**, not 18 — because `routes=`
> filtered the *answers* and never the *questions*, so each pole was asked about all ~17 routes it serves
> and every KMB pole at those places was asked too. 21 s of queued fetching per round, every 45 s, per
> watched route. Fixed as [ADR-117](../08-decision-log.md) before anything shipped: the same round is now
> **18 calls in 0.27 s**, and the 41-pole worst case (E22 outbound) is **41 calls, first delta 1.24 s after
> connect**. The table above is therefore right as written — *one call per pole per round* — and was not
> true of the code until that rule existed. Nothing in this design was defensible without it, which is the
> argument for measuring a cost claim rather than deriving it.

## What changes

| file | change |
|---|---|
| ✅ `packages/core/src/live.ts` | **Done.** `routeWatchName(routeId)` and `nextRouteRoundMs(…)`, both with `@spec` tags and corpus groups (9 + 11 rows), plus five constants. Six injections, each reddening only its own assertions. See *What step 1 actually shipped* below. |
| ✅ `apps/edge/src/live.ts` | **Done** (not `index.ts` — the router delegates the whole path). `?route=` resolves the poles from the route document, 400s a malformed id before any object exists, 404s an unknown route, and forwards `?targets=` to `getByName(routeWatchName(id))`. |
| ✅ `apps/edge/src/eta-hub.ts` | **Done, and simpler than planned.** No route-specific round: the object reads `ctx.id.name` (`watchedRoute`) and that alone changes the per-connection cap, the union cap and the narrowing. `LIVE_ROUTE_MAX_POLES = 64` lives here. |
| ✅ `apps/edge/src/stop-route.ts` | **Done, unplanned.** `boardsFor` — a narrowed read narrows the upstream fan-out too (ADR-117). Not in the plan because the plan assumed the code already did this. |
| `packages/api-client/src/live/` | a `watchRoute(routeId)` alongside `watch(targets)`; the socket URL builder |
| `packages/contract` | the `route` query parameter and any frame addition → `asyncapi:emit` |
| `apps/web/src/screens/RouteDetail.tsx` | subscribe when `perStopOnly`; merge frames into the rows |
| `packages/core` | the merge rule (which reading updates which row) as a kernel function with corpus rows — **not** in a screen |
| `packages/contract/ui/route-detail.spec.json` | `noLiveBoard` stops being a state a rider sees on Citybus; what replaces it needs declaring |

## What step 1 actually shipped, and two places the plan above was wrong

Landed in `packages/core/src/live.ts` with corpus rows and no behaviour, as intended. Two corrections to the
plan, both found by writing it:

**1. `LIVE_ROUTE_MAX_POLES` does not belong in the kernel.** The plan put it beside `routeWatchName`. It is a
*server* budget — a client never computes it — so it belongs with its siblings `LIVE_MAX_TARGETS_PER_CONNECTION`
and `LIVE_CTB_BUDGET` in `apps/edge/src/eta-hub.ts`. The kernel holds what three platforms must compute
identically; the hub holds what only the hub decides. It moves to step 2.

**2. `45 − age` turned out to be the right answer to a narrower question than it looked, and the rule grew a
fourth arm for it.** The cadence section above establishes that following the CDN's TTL as a *cadence* is the
mistake. But when a round is handed a copy older than the newest publish, the question changes from *"when does
the data change"* to *"when does **this entry** turn over"* — and that is exactly what `age` answers, exactly.
So `nextRouteRoundMs` has four arms, not three:

| the round saw | it waits |
|---|---|
| no publish at all (out of service) | the period — there is no phase to align to |
| an unadvanced publish, **and an `age` header** | `ttl − age + margin` — a measured turnover |
| an unadvanced publish, no age | `LIVE_ROUTE_RETRY_MS` — the same situation, blind |
| a fresh publish | `published + period + margin`, clamped |

Keeping the last two arms separate is deliberate: a guess and a measurement should not read alike in a
schedule, and a fixture proved the point — with the floor and the blind retry both set to 15 s, three arms
produced the same number for three different reasons and no test could tell them apart. The floor is 10 s now,
which is a different job (stopping any arithmetic mistake becoming a tight loop) and is now visibly doing it.

`routeWatchName` returns **`undefined` for an id that is not a route id**, which is the whole of its
validation and is not decoration: a route id arrives from a query string, and `route-` plus arbitrary text
would mint a real Durable Object — the same hazard `liveShardFor` records as having produced `live-NaN`, *"a
real object that silently collects every client"*. A property test also asserts no route name can ever collide
with a shard's `live-<n>`, since both namespaces share one class and a collision would put two different
clocks and two different caps in one object.

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

1. ✅ **Done** — `routeWatchName` + `nextRouteRoundMs` in the kernel, with corpus rows and no behaviour.
   `LIVE_ROUTE_MAX_POLES` moved to step 2, where it belongs.
2. ✅ **Done** — `/v1/live?route=…` resolving poles server-side; the route caps; the narrowed fan-out
   (ADR-117). 11 new cases in `apps/edge/test/live-route-watch.test.ts` plus one in `eta-hub-caps.test.ts`,
   each watched failing on a deliberate revert, and walked over a real socket against live upstream.
   **2b, split out:** wire `nextRouteRoundMs` into the hub's cadence, which needs a rounds-completed counter
   the object does not yet expose (the same counter the filed `live-rounds.test.ts` connect race wants).
3. ✅ **Done** — `watchRoute` in `packages/api-client` over both transports, plus the `?route=` contract
   declaration step 2 had shipped without (ADR-119).
4. ✅ **Done** — `applyLiveEtasToRouteDetail` in `packages/core`, 11 corpus rows, and
   `RouteStopRowView.incomplete` so a refused kerb is a row's statement rather than the screen's (ADR-119).
5. ✅ **Done** — `apps/web` subscribes when the wire says `perStopOnly`, the spec gained `liveRouteTimes`,
   and both renderers draw the row marker (ADR-120). **Verified in a browser on the real feed**: Citybus
   N171 outbound, 31 rows of live times, notice gone. Two defects came out of that step and neither was
   reachable from the layer that caused it — the socket selector dropped the `route` field (found only by
   opening a browser) and the hook's empty-session default blanked every KMB route (found by the
   conformance suite).

**What is left:** the default engine. `poll` still is one, so this ships as a per-rider fan-out; the
shared-round economy — the whole cost argument — needs `VITE_LIVE_TRANSPORT=socket` /
`EXPO_PUBLIC_LIVE_TRANSPORT=socket` and a decision about turning it on by default.

Steps 1–2 are independently reviewable and land no UI, which is the point of splitting there: the cap
arithmetic gets checked against a real socket before a screen depends on it. That paid for itself
immediately — a screen built on step 2 as first written would have made 800 upstream calls a round and
looked fine doing it.
