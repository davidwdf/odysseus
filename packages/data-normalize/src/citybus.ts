import type { Eta } from '@nextbus/core'
import { z } from 'zod'
import { canonicalRouteId, cleanArrivals, optionalRemark, toBound } from './normalize'

// Citybus publishes via the Government real-time gateway. Use V2 (V1.x is retired).
const CTB_BASE = 'https://rt.data.gov.hk/v2/transport/citybus'

const CtbEtaRow = z.object({
  co: z.string(),
  route: z.string(),
  dir: z.string(),
  seq: z.number(),
  dest_en: z.string(),
  dest_tc: z.string(),
  dest_sc: z.string(),
  eta: z.string().nullable(),
  eta_seq: z.number().nullable(),
  rmk_en: z.string(),
  rmk_tc: z.string(),
  rmk_sc: z.string(),
  data_timestamp: z.string().nullable(),
})
const CtbEtaResponse = z.object({
  generated_timestamp: z.string(),
  data: z.array(CtbEtaRow),
})
type CtbRow = z.infer<typeof CtbEtaRow>

/**
 * Live ETAs for one Citybus route at one stop. Citybus has no service-type
 * dimension, so we use "1". `stopId` is the operator-native numeric stop id.
 */
export async function fetchCitybusEta(
  stopId: string,
  route: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Eta[]> {
  const res = await fetchImpl(`${CTB_BASE}/eta/CTB/${stopId}/${route}`)
  if (!res.ok) throw new Error(`Citybus ETA ${res.status} for ${route}@${stopId}`)
  const { generated_timestamp, data } = CtbEtaResponse.parse(await res.json())
  return groupCtb(stopId, generated_timestamp, data)
}

function groupCtb(stopId: string, generated: string, rows: CtbRow[]): Eta[] {
  const observedAt = new Date().toISOString()
  const groups = new Map<string, CtbRow[]>()
  for (const row of rows) {
    const key = `${row.route}|${row.dir}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }

  const etas: Eta[] = []
  for (const bucket of groups.values()) {
    const first = bucket[0]
    if (!first) continue
    const bound = toBound(first.dir)
    etas.push({
      routeId: canonicalRouteId('CTB', first.route, bound, '1'),
      stopId,
      operator: 'CTB',
      arrivals: cleanArrivals(bucket.map((r) => r.eta)),
      remark: optionalRemark(first.rmk_en, first.rmk_tc, first.rmk_sc),
      dataTimestamp: first.data_timestamp ?? generated,
      observedAt,
    })
  }
  return etas
}
