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
import { classifyFailure, wireErrorOf } from './errors'
import {
  createLiveEtaController,
  DEFAULT_LIVE_ENGINE,
  type LiveEtaController,
  type LiveEtaEngine,
  type LiveEtaUpdate,
  type LiveTransportContext,
  liveTransportFor,
  SOCKET_FALLBACK_AFTER_FAILURES,
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
   * How `watch()` gets its frames. **Absent means `DEFAULT_LIVE_ENGINE` — the socket, since ADR-121** —
   * supervised, so a network that cannot carry WebSockets degrades to the poll emulator after
   * `SOCKET_FALLBACK_AFTER_FAILURES` fruitless connections (WP6-8b) rather than never updating. Either
   * engine gives a screen the same protocol: a target whose id stops resolving dropped without
   * disturbing the others, and a failed round that is not a departure. Supply `createSocketTransport`
   * (or a `MemoryTransport`) to change engines without touching a screen — which is the property
   * ADR-004 has claimed since v1 and `apps/mobile/test/seam-substitution.test.tsx` now actually tests.
   */
  transport?: (ctx: LiveTransportContext) => LiveEtaEngine
}

/**
 * How long any single edge request may run — headers *and* body — before it is failed (ADR-137).
 *
 * A derivation, not a guess: the Worker's own upstream deadline is 10 s (`fetchUpstream`'s
 * `AbortSignal.timeout` in `@nextbus/data-normalize`), so the slowest *truthful* answer clears the
 * edge inside ~12 s; 15 adds network slack on top and still ends a hung request before the next
 * 30 s poll round starts (`refreshAfterMs`), so rounds cannot stack behind a dead connection.
 */
export const REQUEST_DEADLINE_MS = 15_000

/**
 * `/v1/index`'s own ceiling — the whole-blob exception to the derivation above (see
 * `getSearchIndex`). Sixty seconds for the same reason the dataset download gets sixty (ADR-138):
 * still a hang detector, just sized for a body whose transfer time is the rider's downlink, not the
 * edge's latency.
 */
export const INDEX_DEADLINE_MS = 60_000

/**
 * v1 DataSource: talks to the Cloudflare edge API.
 *
 * `watch()` is no longer a shim that concatenates lists — it runs a real frame protocol
 * (`snapshot`/`delta`/`status`) over a pluggable transport, whose default is the socket (ADR-121),
 * supervised so it degrades to the poll emulator in `./live/poll.ts` on a network that cannot carry it
 * (WP6-8b). Swapping transports swaps the engine and nothing else (ADR-004).
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
    // **The client is the one place that names the default**, and it names it by asking `select.ts` rather
    // than by spelling an engine — so `DEFAULT_LIVE_ENGINE` is a single declaration and flipping it moves
    // every caller at once. It used to read `?? createPollTransport`, which was a second spelling of the
    // same answer and would have had to be found by hand on the day the default changed (ADR-121).
    this.transport = opts.transport ?? liveTransportFor(DEFAULT_LIVE_ENGINE)
  }

  private async getJson<T>(path: string, deadlineMs = REQUEST_DEADLINE_MS): Promise<T> {
    // A deadline, not just error handling (ADR-137). A blackholed connection — a network switch, a
    // NAT entry that expired without an RST — never *rejects*, and every failure arm in this package
    // (the poll round's `requestError`, a screen's query retry) needs a rejection to fire. Without
    // one, poll rounds stack behind requests that will never settle and the screen stays labelled
    // live over ageing readings: the silent-dead-pipe defect the socket's connect watch and
    // keepalive close (ADR-135), rebuilt one engine over. The timer spans the *body* read too — a
    // server that sends headers and then wedges is the same dead pipe.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deadlineMs)
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, { signal: controller.signal })
      if (!res.ok) throw await classifyFailure(path, res)
      return (await res.json()) as T
    } catch (thrown) {
      // The platform's abort rejection ("The operation was aborted") names neither the request nor
      // the cause, and `wireErrorOf` would carry that string onto a status frame. Say what happened.
      if (controller.signal.aborted) {
        throw new Error(`${path} → no response in ${deadlineMs} ms`)
      }
      throw thrown
    } finally {
      clearTimeout(timer)
    }
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

  /**
   * `/v1/etas?route=…` — one report per pole of one route, **narrowed by the server** (ADR-136).
   *
   * The `ids` batch above cannot express the narrowing (it carries no per-id route list), so a route
   * round through it asks every pole about every route calling there. This is what the poll engine
   * uses instead when a subscription is a whole route — the polled twin of `/v1/live?route=`.
   */
  getEtasRoute(routeId: string): Promise<EtaBatch> {
    return this.getJson<EtaBatch>(`/v1/etas?route=${encodeURIComponent(routeId)}`)
  }

  getSearchIndex(): Promise<SearchIndex> {
    // The one whole-blob endpoint, and the one place `REQUEST_DEADLINE_MS`'s derivation does not
    // hold: that number is sized from server-side latency (the edge's own 10 s upstream deadline
    // plus slack), and this body is the full search index, so the missing term is the rider's
    // downlink × the blob. A first-ever Search load on a slow link could clear 15 s and still be
    // succeeding — failing it restarts the download from byte zero on every retry, into the same
    // deadline. The dataset fetch made the same argument for the same shape (ADR-138); after one
    // success the 6 h max-age, the ETag and the persisted query cache make this ceiling moot.
    return this.getJson<SearchIndex>('/v1/index', INDEX_DEADLINE_MS)
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
    const door = this.etaListenerDoor(onUpdate)
    const primary = this.transport(this.liveContext(opts))
    // Anything that is not a socket needs no supervision: the poll engine's failures are per round and
    // its own retrying is the recovery. A socket's failure mode is different in kind — a network that
    // does not carry WebSockets at all — and that is what `withPollFallback` watches for (WP6-8b).
    if (primary.engine !== 'socket') {
      const controller = this.startController(primary, targets, door)
      return {
        unsubscribe() {
          controller.stop()
        },
      }
    }
    return this.withPollFallback(
      (emit) => this.startController(primary, targets, emit),
      () => {
        const controller = this.startController(
          liveTransportFor('poll')(this.liveContext(opts)),
          targets,
          door,
        )
        return {
          unsubscribe() {
            controller.stop()
          },
        }
      },
      door,
    )
  }

  /**
   * The transport factory's whole input, built one way for every subscription.
   *
   * `pollMs`: a caller that has the *served* policy wins over this client's construction-time default.
   * `EdgeClient` is built at module scope, before any policy has been fetched, so `this.pollMs` is
   * `CLIENT_POLICY_DEFAULTS.refreshAfterMs` unless someone passed one — which once meant a served
   * override reached three screens' `refetchInterval` and *not* the seam that replaced it. See
   * `WatchOptions` in `@nextbus/core` for why this is threaded rather than fetched here.
   */
  private liveContext(opts?: WatchOptions, route?: string): LiveTransportContext {
    return {
      endpoints: this.endpoints,
      getEtasBatch: (ids) => this.getEtasBatch(ids),
      getEtasRoute: (routeId) => this.getEtasRoute(routeId),
      pollMs: opts?.refreshAfterMs ?? this.pollMs,
      clock: this.clock,
      ...(route === undefined ? {} : { route }),
    }
  }

  /** A controller over one transport, already started — the shape every subscription here reduces to. */
  private startController(
    transport: LiveEtaEngine,
    targets: readonly WatchTarget[],
    emit: (update: LiveEtaUpdate) => void,
    declaredInUrl?: boolean,
  ): LiveEtaController {
    const controller = createLiveEtaController({
      transport,
      targets: [...targets],
      emit,
      ...(declaredInUrl === undefined ? {} : { declaredInUrl }),
    })
    controller.start()
    return controller
  }

  /**
   * Supervise a socket subscription: if it fails `SOCKET_FALLBACK_AFTER_FAILURES` times in a row
   * without ever delivering a data frame, rebuild the whole subscription on the poll engine (WP6-8b).
   *
   * ## Why this exists, and why it lives here rather than in a transport
   *
   * The socket became the default engine in ADR-121, and a socket's characteristic failure is one the
   * rider can never see the reason for: a browser exposes neither the status nor the body of a refused
   * WebSocket upgrade, so a proxy that strips the protocol, a captive portal, or a deployment without
   * the `ETA_HUB` binding all look identical — `retrying`, for ever, at the backoff cap, with the
   * screen frozen on its first HTTP fetch. When the socket was opt-in, "no fallback" (ADR-056) was the
   * honest refusal to hide a broken socket behind a working poll; as the *default*, it shipped that
   * frozen screen to every rider on a WebSocket-hostile network. The edge already promises
   * degrade-to-slow for every missing binding (ADR-055); this is the same promise for the network path.
   *
   * It is a **subscription** swap and not a transport that changes engines mid-flight, which is the
   * distinction ADR-056's argument actually protects: the fallback builds a fresh controller over a
   * fresh poll transport, `engine` answers honestly on each, and the trigger is stated and testable
   * rather than a mood. Hence this method sits beside `watch()`/`watchRoute()`, the two holders of
   * "what the subscription is", and not inside `createSocketTransport`, which keeps reconnecting for
   * ever exactly as documented.
   *
   * ## The trigger, precisely
   *
   * Counts `retrying` updates arriving while the session has never held data (`seq === 0` — the
   * kernel's own "no snapshot has ever landed" sentinel) — **and only the transport's own connection
   * failures among them.** The two kinds of `retrying` are distinguishable by who authored the error:
   * the socket transport synthesizes `internal` for everything connection-level (a close, a keepalive
   * timeout, a hung handshake — `wireErrorOf` over a local `Error`), while a frame carrying an
   * `upstream_*` or `not_found` code was **parsed from server bytes**, which is itself proof the path
   * carries the protocol. Without that distinction, a healthy socket whose *upstream* was down for the
   * first three rounds fell back to polling — which polls the same dead upstream, learns nothing
   * sooner, and forfeits the shared round for the rest of the screen's life. So a server-authored
   * `retrying` latches `everWorked` exactly as a data frame does.
   *
   * A socket that has ever delivered a frame has proved the path, and every later failure belongs to
   * the reconnect schedule — `everWorked` latches and the counter never fires. A terminal `closed` +
   * `retryable: false` does not count either: the server *answered*, and what it said polling would
   * not change. The supervised updates pass through to the door untouched; the fallback's do too,
   * through the same door, so the listener sees one continuous subscription.
   *
   * **Fallback is per subscription, which is also the re-upgrade path**: every new `watch()` /
   * `watchRoute()` — a screen navigation, a pull-to-refresh, an app resume — starts socket-first
   * again, so a rider is pinned to polling only for the lifetime of the screen that discovered the
   * hostile network, never for the app's.
   */
  private withPollFallback(
    startSocket: (emit: (update: LiveEtaUpdate) => void) => LiveEtaController,
    startFallback: () => Subscription,
    door: (update: LiveEtaUpdate) => void,
  ): Subscription {
    let failures = 0
    let everWorked = false
    let fallback: Subscription | null = null
    let released = false
    /** Assigned right after `startSocket` returns; the guard below covers a transport (a scripted
     *  fake) that delivers frames synchronously inside `start()`, before the assignment lands. */
    let socket: LiveEtaController | null = null
    let fellBack = false

    socket = startSocket((update) => {
      if (released || fellBack) return
      // A `retrying` whose error the transport did not author (`internal` is its one spelling for a
      // connection-level failure) was parsed from server bytes — the path works; the upstream doesn't.
      const connectionFailure =
        update.status.state === 'retrying' && update.status.error?.code === 'internal'
      if (
        update.seq > 0 ||
        update.status.state === 'live' ||
        (update.status.state === 'retrying' && !connectionFailure)
      ) {
        everWorked = true
      }
      if (!everWorked && connectionFailure && ++failures >= SOCKET_FALLBACK_AFTER_FAILURES) {
        fellBack = true
        socket?.stop()
        fallback = startFallback()
        // The triggering `retrying` is not delivered: the poll engine's own frames take over from
        // here, and a status describing a connection that has just been abandoned is not news the
        // listener can use.
        return
      }
      door(update)
    })
    if (fellBack) socket.stop()

    return {
      unsubscribe() {
        released = true
        socket?.stop()
        fallback?.unsubscribe()
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
    return ({ seq, etas, failed }) => {
      // **No data frame yet means nothing to say** (WP6-8b). Before the first `snapshot`, `etas` is
      // `LIVE_SESSION_START`'s empty placeholder arriving on a `status` transition, and delivering it
      // would hand every listener "no buses due" for stops that were never asked — `useLiveEtas` writes
      // straight into the query cache, so the screen's HTTP-painted arrivals blanked on the first
      // `retrying` of a flaky connection. `seq === 0` is the kernel's own sentinel for "no snapshot has
      // ever landed" (`LiveEtaUpdate.seq`), so the door and the reducer agree about what "yet" means.
      if (seq === 0) return
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
   * share a round with anybody — reached when `EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT`
   * spells `poll`, and as the supervised fallback when the default socket cannot connect (WP6-8b). The
   * shipped default is the socket (ADR-121).
   */
  watchRoute(routeId: string, onUpdate: EtaListener, opts?: WatchOptions): Subscription {
    const door = this.etaListenerDoor(onUpdate)
    const primary = this.transport(this.liveContext(opts, routeId))

    // An engine that speaks a real socket has already been handed the route (`LiveTransportContext.route`)
    // and connects on `open()`. Anything else is emulating, and an emulator that cannot resolve poles must
    // be given them. The socket is supervised exactly as `watch()`'s is, and its fallback is the same
    // emulated path the poll engine takes below — resolve the poles once, then poll them narrowed — so a
    // WebSocket-hostile network costs a route screen the shared round, not its times (WP6-8b).
    if (primary.engine === 'socket') {
      return this.withPollFallback(
        (emit) => this.startController(primary, [], emit, true),
        () => this.watchRoutePolled(routeId, door, opts),
        door,
      )
    }

    // The emulated path. `primary` was constructed and never opened, so it is released rather than left
    // holding a sink; `watchRoutePolled` builds its own.
    primary.close()
    return this.watchRoutePolled(routeId, door, opts)
  }

  /**
   * A route watch on the poll engine: resolve the poles once, then poll them narrowed.
   *
   * **Forced onto the poll engine by construction**, not onto `this.transport` — that distinction is
   * what keeps the fallback path from recursing. This used to be inlined in `watchRoute` as a call to
   * `watch()`, which builds `this.transport`; reached as a *fallback* from a failed socket, that would
   * construct a second socket, fail three more times, fall back again, and settle on polling only after
   * paying the whole discovery cost twice.
   *
   * A poll-emulated route watch costs one `/v1/route/:id` read at subscribe time, and then **one
   * `/v1/etas?route=` request per round, narrowed by the server** (ADR-136) — not the chunked `ids`
   * fan-out ADR-121 measured at ~19× and 10–20 s a chunk. It still does not share a round with anybody
   * (the coalescer is per-isolate; only the socket's named object shares). Each target is narrowed to
   * this route as well, because a pole on this route serves others: without `routeIds` the emulator
   * would deliver every line at all 41 kerbs and the screen would attach the wrong times to a row.
   */
  private watchRoutePolled(
    routeId: string,
    emit: (update: LiveEtaUpdate) => void,
    opts?: WatchOptions,
  ): Subscription {
    let inner: LiveEtaController | null = null
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | null = null
    const resolvePoles = (): void => {
      retry = null
      void this.getRoute(routeId).then(
        (detail) => {
          if (cancelled) return
          // The context carries the route, so the poll engine's rounds are ONE `/v1/etas?route=` request
          // narrowed by the server (ADR-136) — not the chunked `ids` fan-out ADR-121 measured at ~19×.
          inner = this.startController(
            liveTransportFor('poll')(this.liveContext(opts, routeId)),
            detail.stops.map((stop) => ({ stopId: stop.stop.id, routeIds: [routeId] })),
            emit,
          )
        },
        (thrown) => {
          // Swallowed rather than thrown, because an unhandled rejection from a subscription nobody
          // awaited would take a screen down for a fetch it is already retrying — but **retried, not
          // abandoned** (ADR-141). The screen's own retry covers the route *document*; this
          // subscription is keyed on a route id that never changes, so nothing upstream ever
          // re-subscribes it, and one rejection used to leave a husk that delivered no frame for the
          // life of the screen. Reached offline as a matter of course: socket attempts fail fast when
          // there is no network, so the WP6-8b fallback lands here *during* the outage it exists for,
          // and the one-shot resolve failed on the same dead network the sockets did. The poll cadence
          // is the retry cadence — this path is the poll engine, resolution is its round zero.
          if (cancelled) return
          if (wireErrorOf(thrown).retryable) retry = setTimeout(resolvePoles, this.pollMs)
          // …and a `retryable: false` answer (the id no longer denotes a route) means stop asking —
          // the same instruction every other consumer of the taxonomy honours (ADR-064).
        },
      )
    }
    resolvePoles()
    return {
      unsubscribe() {
        cancelled = true
        if (retry !== null) clearTimeout(retry)
        inner?.stop()
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
