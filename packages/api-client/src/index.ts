import type {
  DataSource,
  Eta,
  EtaListener,
  LatLng,
  NearbyStop,
  RouteDetail,
  StopDetail,
  Subscription,
  WatchTarget,
} from '@nextbus/core'

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
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
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
