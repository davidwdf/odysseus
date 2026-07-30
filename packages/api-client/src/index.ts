import type {
  ClientPolicy,
  DataSource,
  Eta,
  EtaListener,
  LatLng,
  NearbyStop,
  RouteDetail,
  SearchIndex,
  StopDetail,
  Subscription,
  WatchTarget,
} from '@nextbus/core'
import { CLIENT_POLICY_DEFAULTS } from '@nextbus/core'
import type { Clock } from '@nextbus/ports'
import { type Endpoints, resolveEndpoints } from './endpoint'
import { classifyFailure } from './errors'
import { createLiveEtaController, createPollTransport, type LiveEtaEngine } from './live'

/**
 * Everything a transport factory could need to build itself, so the option is one function.
 *
 * The poll emulator needs `getEtas` and a cadence; the socket needs a URL; both need a clock. Handing
 * over the whole `EdgeClient` instead would let a transport reach for a second endpoint, which is how a
 * "transport" grows into a second data layer.
 */
export interface LiveTransportContext {
  endpoints: Endpoints
  /** The client's own `/v1/etas/:id` call — what the poll emulator polls. */
  getEtas(stopId: string, routeIds?: string[]): Promise<Eta[]>
  /** The resolved cadence, ms: `pollMs` if given, else the served policy default (ADR-053). */
  pollMs: number
  clock: Clock
}

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
   * default and a socket is opt-in: one HTTP request per target per cadence, every target independent, a
   * failure on one leaving the others alone. Supply `createSocketTransport` (or a `MemoryTransport`) to
   * change engines without touching a screen — which is the property ADR-004 has claimed since v1 and
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

  getEtas(stopId: string, routeIds?: string[]): Promise<Eta[]> {
    // Canonical stop id → /v1/etas/:id (not the lower-level /v1/eta/:co/:stop/:route).
    const q = routeIds?.length ? `?routes=${encodeURIComponent(routeIds.join(','))}` : ''
    return this.getJson<Eta[]>(`/v1/etas/${encodeURIComponent(stopId)}${q}`)
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
  watch(targets: WatchTarget[], onUpdate: EtaListener): Subscription {
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
     */
    let last: readonly Eta[] | null = null
    const controller = createLiveEtaController({
      transport: this.transport({
        endpoints: this.endpoints,
        getEtas: (stopId, routeIds) => this.getEtas(stopId, routeIds),
        pollMs: this.pollMs,
        clock: this.clock,
      }),
      targets,
      emit: ({ etas }) => {
        if (etas === last) return
        last = etas
        onUpdate([...etas])
      },
    })
    controller.start()
    return {
      unsubscribe() {
        controller.stop()
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
