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
    const first = bucket[0]
    if (!first) continue
    const operator: OperatorId = first.co === 'LWB' ? 'LWB' : 'KMB'
    const bound = toBound(first.dir)
    etas.push({
      routeId: canonicalRouteId(operator, first.route, bound, String(first.service_type)),
      stopId,
      operator,
      arrivals: cleanArrivals(bucket.map((r) => r.eta)),
      remark: optionalRemark(first.rmk_en, first.rmk_tc, first.rmk_sc),
      dataTimestamp: first.data_timestamp ?? generated,
      observedAt,
    })
  }
  return etas
}
