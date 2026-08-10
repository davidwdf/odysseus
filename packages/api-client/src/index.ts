import type {
  ClientPolicy,
  DataSource,
  Eta,
  EtaBatch,
  EtaFailure,
  EtaListener,
  EtaReport,
  LatLng,
  NearbyStop,
  RouteDetail,
  SearchIndex,
  StopDetail,
  Subscription,
  WatchOptions,
  WatchTarget,
} from '@nextbus/core'
import { CLIENT_POLICY_DEFAULTS, sameFailures } from '@nextbus/core'
import type { Clock } from '@nextbus/ports'
import { type Endpoints, resolveEndpoints } from './endpoint'
import { classifyFailure } from './errors'
import {
  createLiveEtaController,
  createPollTransport,
  type LiveEtaEngine,
  type LiveEtaUpdate,
  type LiveTransportContext,
} from './live'

export interface EdgeClientOptions {
  /** Base URL of the edge API, e.g. https://api.nextbus.hk */
  baseUrl: string
  /** Polling interval for the poll-emulator transport, ms. Defaults to the served `refreshAfterMs`. */
  pollMs?: number
  fetchImpl?: typeof fetch
  /**
   * Explicit socket URL, for the one case deriving it from `baseUrl` cannot cover: a socket tier on a
   * different host (D5). Normally absent — `wss://<same host>/v1/live` is derived.
   */
  liveUrl?: string
  /**
   * Reads "now" for the frame stamps the poll emulator synthesizes. Defaults to the host clock; injected
   * by a test that needs the `at` fields to be predictable.
   */
  clock?: Clock
  /**
   * How `watch()` gets its frames. **Absent means the poll emulator**, so today's behaviour is the
   * default and a socket is opt-in: **one HTTP request per cadence** for the whole target set since
   * WP5-7 (it was one per target, which is why a six-place screen could not adopt it), a target whose id
   * stops resolving dropped without disturbing the others, and a failed round that is not a departure.
   * Supply `createSocketTransport` (or a `MemoryTransport`) to change engines without touching a screen —
   * which is the property ADR-004 has claimed since v1 and
   * `apps/mobile/test/seam-substitution.test.tsx` now actually tests.
   */
  transport?: (ctx: LiveTransportContext) => LiveEtaEngine
}

/**
 * v1 DataSource: talks to the Cloudflare edge API.
 *
 * `watch()` is no longer a shim that concatenates lists — it runs a real frame protocol
 * (`snapshot`/`delta`/`status`) over a pluggable transport, whose default is the poll emulator in
 * `./live/poll.ts`. Swapping in `createSocketTransport` swaps the engine and nothing else (ADR-004).
 */
export class EdgeClient implements DataSource {
  private readonly endpoints: Endpoints
  private readonly base: string
  private readonly pollMs: number
  private readonly clock: Clock
  private readonly fetchImpl: typeof fetch
  private readonly transport: (ctx: LiveTransportContext) => LiveEtaEngine

  constructor(opts: EdgeClientOptions) {
    // One declaration of the base-URL normalisation, and of the `http:`→`ws:` derivation with it. The
    // inline `.replace(/\/$/, '')` that used to be on this line stripped exactly one trailing slash, so a
    // configured `http://host//` double-slashed every path; `resolveEndpoints` strips them all.
    this.endpoints = resolveEndpoints(opts.baseUrl, opts.liveUrl)
    this.base = this.endpoints.apiUrl
    // The **fourth** hard-coded 20 s the plan's three-way disagreement did not count: `watch()`'s
    // shim polled on its own cadence, so the one seam that exists to be swapped for a socket engine
    // disagreed with all three screens. Defaults to the policy value, which is the edge's own TTL.
    this.pollMs = opts.pollMs ?? CLIENT_POLICY_DEFAULTS.refreshAfterMs
    this.clock = opts.clock ?? { now: () => Date.now() }
    // Bind to the global: browsers throw "Illegal invocation" if native fetch is
    // called with a receiver other than window (e.g. as this.fetchImpl(...)).
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.transport = opts.transport ?? createPollTransport
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`)
    if (!res.ok) throw await classifyFailure(path, res)
    return (await res.json()) as T
  }

  getNearby(at: LatLng, radiusM: number): Promise<NearbyStop[]> {
    const q = `?lat=${at.lat}&lng=${at.lng}&radius=${radiusM}`
    return this.getJson<NearbyStop[]>(`/v1/nearby${q}`)
  }

  getRoute(routeId: string): Promise<RouteDetail> {
    return this.getJson<RouteDetail>(`/v1/route/${encodeURIComponent(routeId)}`)
  }

  getStop(stopId: string): Promise<StopDetail> {
    return this.getJson<StopDetail>(`/v1/stop/${encodeURIComponent(stopId)}`)
  }

  getEtas(stopId: string, routeIds?: string[]): Promise<EtaReport> {
    // Canonical stop id → /v1/etas/:id (not the lower-level /v1/eta/:co/:stop/:route).
    const q = routeIds?.length ? `?routes=${encodeURIComponent(routeIds.join(','))}` : ''
    return this.getJson<EtaReport>(`/v1/etas/${encodeURIComponent(stopId)}${q}`)
  }

  getEtasBatch(ids: readonly string[]): Promise<EtaBatch> {
    // **The parameter repeats; it is not a delimited list**, because `,` is a legal `idchar` and a query
    // string decodes `%2C` before anything could split on it — see the `ids` parameter in
    // `packages/contract/src/wire/responses.ts`. `encodeURIComponent` per id is therefore load-bearing
    // twice over: it escapes the `+` in a place id, which would otherwise arrive as a space and be
    // rejected, and it escapes a `&` or an `=` that the grammar permits inside a raw operator id.
    const q = ids.map((id) => `ids=${encodeURIComponent(id)}`).join('&')
    return this.getJson<EtaBatch>(`/v1/etas?${q}`)
  }

  getSearchIndex(): Promise<SearchIndex> {
    return this.getJson<SearchIndex>('/v1/index')
  }

  /**
   * The served policy document (ADR-053). Deliberately **not** resolved here: this class is the
   * transport, and a caller that received a resolved policy could no longer tell an arrived value
   * from a default — which is the one distinction worth being able to see when a threshold looks
   * wrong. `resolveClientPolicy` in `@nextbus/core` does the filling, once, at the point of use.
   */
  getClientPolicy(): Promise<ClientPolicy> {
    return this.getJson<ClientPolicy>('/v1/policy')
  }

  /**
   * Live ETAs for a set of targets. Signature unchanged (ADR-004) — the engine underneath is not.
   *
   * The listener still receives a flat `Eta[]`, so no caller has to change, but the list is now the
   * **reduced session** the kernel maintains rather than a per-round concatenation, which has two visible
   * consequences worth stating:
   *
   *  · It is canonically ordered by `(stopId, routeId)` (D1). The old shim pushed
   *    `Promise.all`-completion order, so with more than one target the listener's ordering was
   *    genuinely nondeterministic between two runs of the same data — nothing depended on it, and
   *    nothing could have.
   *  · A round in which nothing changed produces **no call at all**, where the shim called the listener
   *    every cadence with a fresh copy of identical data. That is ADR-008's rule ("update the value only
   *    when fresh data arrives") reaching the seam.
   */
  watch(targets: WatchTarget[], onUpdate: EtaListener, opts?: WatchOptions): Subscription {
    /**
     * The last list handed over, by identity — so a status-only transition does not call a listener that
     * cannot see the status.
     *
     * `EtaListener` takes `Eta[]` and nothing else, so `{ state: 'retrying' }` arriving on its own carries
     * *no information* through this door: the same readings would be delivered again and every consumer
     * would repaint for nothing. `applyLiveFrame`'s `status` case passes `etas: state.etas` through
     * unchanged, so reference identity is exactly the right test, and if that ever stopped being true the
     * failure mode is one redundant call with identical data — which is what the old shim did every single
     * round anyway. A screen that wants the status holds a `createLiveEtaController` and gets both.
     *
     * The **accepted target set** stops at this door for the same reason and it is the more consequential
     * one: `LiveEtaUpdate.targets` is what a caller compares against what it asked for to notice that a
     * saved pole has stopped resolving, and `EtaListener` has no room for it. Widening the signature is not
     * the fix — ADR-004 fixes `watch()` as `(targets, onUpdate) => Subscription`, and a second listener
     * argument would be a wire change to the seam the whole v2 plan turns on. A caller that needs the
     * comparison holds a `createLiveEtaController` directly, which is what `useLiveEtas` becomes when
     * Favourites adopts it (WP5-0 watches one target per screen, so there is nothing to diff yet).
     */
    const controller = createLiveEtaController({
      transport: this.transport({
        endpoints: this.endpoints,
        getEtasBatch: (ids) => this.getEtasBatch(ids),
        // A caller that has the *served* policy wins over this client's construction-time default.
        // `EdgeClient` is built at module scope, before any policy has been fetched, so `this.pollMs` is
        // `CLIENT_POLICY_DEFAULTS.refreshAfterMs` unless someone passed one — which meant a served
        // override reached three screens' `refetchInterval` and *not* the seam that replaced it. See
        // `WatchOptions` in `@nextbus/core` for why this is threaded rather than fetched here.
        pollMs: opts?.refreshAfterMs ?? this.pollMs,
        clock: this.clock,
      }),
      targets,
      emit: this.etaListenerDoor(onUpdate),
    })
    controller.start()
    return {
      unsubscribe() {
        controller.stop()
      },
    }
  }

  /**
   * The `EtaListener` door: which updates are worth waking a caller for.
   *
   * One declaration, used by `watch()` and `watchRoute()` alike, because it is the place two things are
   * deliberately dropped and a second copy would eventually drop different ones.
   *
   * **Two things can be news, and the second one was being swallowed here** (WP5-14, ADR-081).
   * `applyLiveFrame`'s `status` case passes `etas` through by reference, so identity is exactly the right
   * test for "the readings did not move" — but the failure set moves independently, and the round that
   * matters most is a kerb starting to refuse while every reading stands still. Until `EtaListener` could
   * carry `failed`, that round carried no information through this door and the guard was right to drop it;
   * now it carries the one thing a card needs to stop reading as a quiet stop. `sameFailures` is the
   * kernel's predicate, so the door and the producers agree about what counts as a change.
   *
   * The **accepted target set** stops here too, and it is the more consequential omission:
   * `LiveEtaUpdate.targets` is what a caller compares against what it asked for to notice that a saved pole
   * has stopped resolving, and `EtaListener` has no room for it. Widening the signature is not the fix —
   * ADR-004 fixes `watch()` as `(targets, onUpdate) => Subscription`. A caller that needs it holds a
   * `createLiveEtaController` directly. For a **route** watch the omission is sharper: the accepted set is
   * the only place the server says which poles it resolved, so a caller wanting to know that a 70-pole
   * route was capped at 64 needs the controller rather than this door.
   */
  private etaListenerDoor(onUpdate: EtaListener): (update: LiveEtaUpdate) => void {
    let last: readonly Eta[] | null = null
    let lastFailed: readonly EtaFailure[] = []
    return ({ etas, failed }) => {
      if (etas === last && sameFailures(lastFailed, failed)) return
      last = etas
      lastFailed = failed
      onUpdate([...etas], [...failed])
    }
  }

  /**
   * Live ETAs for **every pole of one route** — the times a Citybus or GMB route screen has no other way
   * to get (ADR-116, proposals/05).
   *
   * ## Why this is a second method rather than `watch(poles)`
   *
   * Two of the three things it does could be done by naming the poles: subscribing to 13–41 targets, and
   * narrowing each to one route. The third cannot. A `?route=` socket lands on a Durable Object **named for
   * the route**, so ten riders looking at Citybus 91 share one round of upstream calls; the same poles named
   * as `?targets=` hash to a shard shared with strangers and each rider pays for their own fan-out. That
   * property is the whole reason this is affordable, and it lives in which object the URL selects.
   *
   * ## The two engines differ here, and the difference is honest
   *
   * The socket engine names the route and the **server** resolves the poles from the same route document the
   * schematic draws, so the client never learns them and the URL stays one id long across every reconnect.
   * The poll emulator has no route endpoint to emulate — `/v1/etas?ids=…` takes ids — so it resolves the
   * poles itself, once, and then *is* `watch()`: every rule about rounds, retention, ordering and failures
   * stays in one place rather than being written twice. What a listener receives is identical either way,
   * which is the invariant ADR-074's shared corpus exists to protect.
   *
   * A poll-emulated route watch therefore costs one `/v1/route/:id` read at subscribe time and does not
   * share a round with anybody. Stated rather than hidden: `poll` is still the default engine
   * (`EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT`), so that is what ships until the socket is
   * switched on, and it is the same cost the screen's own refetch already pays.
   */
  watchRoute(routeId: string, onUpdate: EtaListener, opts?: WatchOptions): Subscription {
    const transport = this.transport({
      endpoints: this.endpoints,
      getEtasBatch: (ids) => this.getEtasBatch(ids),
      pollMs: opts?.refreshAfterMs ?? this.pollMs,
      clock: this.clock,
      route: routeId,
    })

    // An engine that speaks a real socket has already been handed the route (`LiveTransportContext.route`)
    // and connects on `open()`. Anything else is emulating, and an emulator that cannot resolve poles must
    // be given them.
    if (transport.engine === 'socket') {
      const controller = createLiveEtaController({
        transport,
        targets: [],
        declaredInUrl: true,
        emit: this.etaListenerDoor(onUpdate),
      })
      controller.start()
      return {
        unsubscribe() {
          controller.stop()
        },
      }
    }

    // The emulated path. `transport` was constructed and never opened, so it is released rather than left
    // holding a sink; `watch()` builds its own.
    transport.close()
    let inner: Subscription | null = null
    let cancelled = false
    void this.getRoute(routeId).then(
      (detail) => {
        if (cancelled) return
        // Narrowed per target, because a pole on this route serves others: without `routeIds` the emulator
        // would deliver every line at all 41 kerbs and the screen would attach the wrong times to a row.
        inner = this.watch(
          detail.stops.map((stop) => ({ stopId: stop.stop.id, routeIds: [routeId] })),
          onUpdate,
          opts,
        )
      },
      () => {
        // A route that will not load is the screen's problem and it already has it: this method's caller
        // renders from the *same* route document, so an unreachable one means there is no schematic to put
        // times on. Swallowed rather than thrown, because an unhandled rejection from a subscription
        // nobody awaited would take a screen down for a fetch it is already retrying.
      },
    )
    return {
      unsubscribe() {
        cancelled = true
        inner?.unsubscribe()
      },
    }
  }
}

export function createEdgeClient(opts: EdgeClientOptions): DataSource {
  return new EdgeClient(opts)
}

// One declaration of where the API is, and of the socket URL derived from it (D5).
export { DEFAULT_API_URL, type Endpoints, resolveEndpoints } from './endpoint'
// The failure taxonomy (ADR-064), in its own module so `./live` can read it without a cycle.
export { classifyFailure, EdgeRequestError, wireErrorOf } from './errors'
// The live engines and the subscription lifecycle. See `./live/index.ts` for the map.
export * from './live'
// The location state machine — permission, a fix, and the remembered cell underneath. Shared rather
// than per-renderer (WP4-1): see `./location.ts` for why the `client` layer is its only possible home.
export {
  createLocationController,
  LAST_FIX_KEY,
  type LocationController,
  type LocationControllerDeps,
} from './location'
