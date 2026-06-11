import type { Eta, OperatorId } from '@nextbus/core'
import { z } from 'zod'
import { canonicalRouteId, cleanArrivals, optionalRemark, toBound } from './normalize'

const KMB_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb'

const KmbEtaRow = z.object({
  co: z.string(),
  route: z.string(),
  dir: z.string(),
  service_type: z.union([z.number(), z.string()]),
  seq: z.number(),
  dest_en: z.string(),
  dest_tc: z.string(),
  dest_sc: z.string(),
  eta_seq: z.number().nullable(),
  eta: z.string().nullable(),
  rmk_en: z.string(),
  rmk_tc: z.string(),
  rmk_sc: z.string(),
  data_timestamp: z.string().nullable(),
})
const KmbEtaResponse = z.object({
  generated_timestamp: z.string(),
  data: z.array(KmbEtaRow),
})
type KmbRow = z.infer<typeof KmbEtaRow>

/**
 * Live ETAs for one KMB/LWB route at one stop.
 * `stopId` is the operator-native 16-char stop id; canonical stop mapping is
 * applied later by the merge layer (see docs/02-data-sources.md).
 */
export async function fetchKmbEta(
  stopId: string,
  route: string,
  serviceType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Eta[]> {
  const res = await fetchImpl(`${KMB_BASE}/eta/${stopId}/${route}/${serviceType}`)
  if (!res.ok) throw new Error(`KMB ETA ${res.status} for ${route}@${stopId}`)
  const { generated_timestamp, data } = KmbEtaResponse.parse(await res.json())
  return groupKmb(stopId, generated_timestamp, data)
}

/**
 * Live ETAs for **every route** at one KMB/LWB stop in a SINGLE upstream call
 * (`stop-eta/{stopId}`) — KMB's per-stop endpoint (verified: returns all routes serving
 * the pole, both directions). Lets a merged place fetch a KMB pole once instead of once
 * per route (ADR-042). `stopId` is the operator-native 16-char id and is stamped on each
 * reading. CTB has no equivalent (its `stop-eta` 422s), so it stays per-route.
 */
export async function fetchKmbStopEta(
  stopId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Eta[]> {
  const res = await fetchImpl(`${KMB_BASE}/stop-eta/${stopId}`)
  if (!res.ok) throw new Error(`KMB stop-ETA ${res.status} for ${stopId}`)
  const { generated_timestamp, data } = KmbEtaResponse.parse(await res.json())
  return groupKmb(stopId, generated_timestamp, data)
}

/** Build one canonical `Eta` from a bucket of rows sharing route+direction (+stop). */
function rowsToEta(bucket: KmbRow[], stopId: string, generated: string, observedAt: string): Eta {
  // Caller guarantees a non-empty bucket.
  const first = bucket[0] as KmbRow
  const operator: OperatorId = first.co === 'LWB' ? 'LWB' : 'KMB'
  const bound = toBound(first.dir)
  return {
    routeId: canonicalRouteId(operator, first.route, bound, String(first.service_type)),
    stopId,
    operator,
    arrivals: cleanArrivals(bucket.map((r) => r.eta)),
    remark: optionalRemark(first.rmk_en, first.rmk_tc, first.rmk_sc),
    dataTimestamp: first.data_timestamp ?? generated,
    observedAt,
  }
}

function groupKmb(stopId: string, generated: string, rows: KmbRow[]): Eta[] {
  const observedAt = new Date().toISOString()
  const groups = new Map<string, KmbRow[]>()
  for (const row of rows) {
    const key = `${row.co}|${row.route}|${row.dir}|${row.service_type}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const etas: Eta[] = []
  for (const bucket of groups.values()) {
    if (bucket.length > 0) etas.push(rowsToEta(bucket, stopId, generated, observedAt))
  }
  return etas
}

/** One stop's arrival on a route, positioned by its `seq` along that route. The route-eta
 *  feed identifies stops only by sequence (no stop id), so the caller maps `seq` → its own
 *  stop; `eta.stopId` is left empty here for the caller to fill in. */
export interface RouteEtaEntry {
  seq: number
  eta: Eta
}

/**
 * Live ETAs for a whole KMB/LWB route in ONE upstream call — the per-stop arrivals a
 * route view needs (ADR-030). `route-eta/{route}/{serviceType}` returns every stop in
 * both directions, keyed by (direction, `seq`) — no stop id. Each entry carries the
 * route's arrival *at that sequence* plus its `seq`; the caller filters to the wanted
 * direction by `eta.routeId` and resolves `seq` to a stop.
 */
export async function fetchKmbRouteEta(
  route: string,
  serviceType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteEtaEntry[]> {
  const res = await fetchImpl(`${KMB_BASE}/route-eta/${route}/${serviceType}`)
  if (!res.ok) throw new Error(`KMB route-ETA ${res.status} for ${route}/${serviceType}`)
  const { generated_timestamp, data } = KmbEtaResponse.parse(await res.json())

  const observedAt = new Date().toISOString()
  // Group by direction + stop sequence — one bus line's arrivals at one stop.
  const groups = new Map<string, KmbRow[]>()
  for (const row of data) {
    const key = `${row.co}|${row.route}|${row.dir}|${row.service_type}|${row.seq}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const entries: RouteEtaEntry[] = []
  for (const bucket of groups.values()) {
    const first = bucket[0]
    if (!first) continue
    entries.push({ seq: first.seq, eta: rowsToEta(bucket, '', generated_timestamp, observedAt) })
  }
  return entries
}
