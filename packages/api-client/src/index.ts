import type {
  DataSource,
  ErrorCode,
  ErrorResponse,
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

/**
 * A failed edge request, carrying the server's own classification (ADR-064).
 *
 * `getJson` used to throw `new Error("/v1/stop/… → HTTP 502")`, which left every caller with a
 * string to regex. The field that matters is `retryable`: it is what lets a Favourites screen — or,
 * once there is one, an iOS Widget — drop a saved stop whose id no longer resolves instead of
 * re-requesting it on every refresh for as long as the rider keeps it.
 *
 * Nothing here validates: `@nextbus/core`'s types erase (ADR-052), so this reads the envelope as
 * data and falls back on the status line if the body is not ours.
 */
export class EdgeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    /** Whether the identical request may succeed later. `false` = stop asking. */
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'EdgeRequestError'
  }
}

/**
 * Read the taxonomy off a failed response.
 *
 * The Worker always sends the envelope, so the fallback covers only a response that did not come
 * from it — a Cloudflare error page, a captive portal, a proxy. There the status line is genuinely
 * all we have, and `retryable` for an unidentified failure has to be "yes": treating an unreadable
 * 404 from a captive portal as permanent would prune a rider's favourites over airport wifi.
 */
async function classifyFailure(path: string, res: Response): Promise<EdgeRequestError> {
  const body = (await res.json().catch(() => null)) as Partial<ErrorResponse> | null
  if (body && typeof body.code === 'string' && typeof body.retryable === 'boolean') {
    return new EdgeRequestError(
      res.status,
      body.code,
      body.retryable,
      body.message ?? body.error ?? `${path} → HTTP ${res.status}`,
    )
  }
  return new EdgeRequestError(res.status, 'internal', true, `${path} → HTTP ${res.status}`)
}

export interface EdgeClientOptions {
  /** Base URL of the edge API, e.g. https://api.nextbus.hk */
  baseUrl: string
  /** Polling interval for the v1 watch() shim, ms. */
  pollMs?: number
  fetchImpl?: typeof fetch
}

/**
 * v1 DataSource: talks to the Cloudflare edge API. `watch()` is a polling shim;
 * v2 will swap this for a WebSocket client behind the same interface (ADR-004).
 */
export class EdgeClient implements DataSource {
  private readonly base: string
  private readonly pollMs: number
  private readonly fetchImpl: typeof fetch

  constructor(opts: EdgeClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, '')
    this.pollMs = opts.pollMs ?? 20_000
    // Bind to the global: browsers throw "Illegal invocation" if native fetch is
    // called with a receiver other than window (e.g. as this.fetchImpl(...)).
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
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

  watch(targets: WatchTarget[], onUpdate: EtaListener): Subscription {
    let cancelled = false

    const tick = async () => {
      const all: Eta[] = []
      await Promise.all(
        targets.map(async (target) => {
          try {
            all.push(...(await this.getEtas(target.stopId, target.routeIds)))
          } catch {
            // Keep other targets alive; a stale tile is better than a dead screen.
          }
        }),
      )
      if (!cancelled) onUpdate(all)
    }

    void tick()
    const id: ReturnType<typeof setInterval> = setInterval(() => void tick(), this.pollMs)
    return {
      unsubscribe() {
        cancelled = true
        clearInterval(id)
      },
    }
  }
}

export function createEdgeClient(opts: EdgeClientOptions): DataSource {
  return new EdgeClient(opts)
}
