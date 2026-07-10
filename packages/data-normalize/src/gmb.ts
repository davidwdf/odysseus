import type { I18nText } from '@nextbus/core'
import { z } from 'zod'
import { cleanArrivals, optionalRemark } from './normalize'

// Green Minibus (GMB) live ETAs — `data.etagmb.gov.hk`, keyless JSON, trilingual (ADR-047).
// GMB differs from KMB/CTB in two ways that shape this adapter:
//  1. Routes are identified by a numeric `route_id` (the dataset's `gtfsId`) + `route_seq`
//     (1/2), NOT by public number — the same number repeats across regions. So this adapter
//     returns the raw (route_id, route_seq) and the edge maps it to our canonical route id via
//     the `gmbCanonicalByLive` index (built in dataset.ts).
//  2. ETAs MIX live and timetable entries: `remarks:"Scheduled"/未開出` marks a scheduled
//     (not tracked) arrival. We pass the remark through verbatim; `classifyRemark` (core) tags
//     it so the UI can style it honestly (ADR-008). `route_seq` 1 → outbound, 2 → inbound.
const GMB_BASE = 'https://data.etagmb.gov.hk'

// data.etagmb.gov.hk 403s a request with an empty User-Agent (which is what the Workers
// runtime sends by default), unlike the KMB/CTB hosts. Any non-empty UA is accepted; we send
// an identifying one.
const GMB_HEADERS = { 'user-agent': 'NextBusHK/1.0 (+https://github.com/nextbus-hk)' }

const GmbEtaItem = z.object({
  eta_seq: z.number(),
  diff: z.number(),
  timestamp: z.string(),
  remarks_en: z.string().nullable(),
  remarks_tc: z.string().nullable(),
  remarks_sc: z.string().nullable(),
})
const GmbStopEtaRow = z.object({
  route_id: z.number(),
  route_seq: z.number(),
  stop_seq: z.number(),
  enabled: z.boolean(),
  eta: z.array(GmbEtaItem).nullable(),
})
const GmbStopEtaResponse = z.object({
  generated_timestamp: z.string(),
  data: z.array(GmbStopEtaRow),
})

/** One route-direction's arrivals at a GMB stop, still keyed by the raw upstream ids
 *  (`routeId` = the numeric GMB route_id / dataset `gtfsId`, `routeSeq` = 1/2). The edge
 *  resolves these to a canonical route id — the adapter has no index, mirroring how
 *  `fetchKmbRouteEta` returns raw `seq`s for the caller to map. */
export interface GmbEtaEntry {
  routeId: number
  routeSeq: number
  /** The raw GMB stop id this board was fetched for, echoed for the caller to stamp. */
  stopId: string
  arrivals: string[]
  remark?: I18nText
  dataTimestamp: string
  observedAt: string
}

/**
 * Live ETAs for **every route** at one GMB stop in a SINGLE upstream call
 * (`/eta/stop/{stop_id}`) — GMB's per-stop board, the analogue of KMB's `stop-eta`. Returns
 * one entry per (route_id, route_seq) serving the pole; disabled route-stops and empty boards
 * are dropped. `stopId` is the raw GMB stop id and is echoed on each entry.
 */
export async function fetchGmbStopEta(
  stopId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmbEtaEntry[]> {
  const res = await fetchImpl(`${GMB_BASE}/eta/stop/${stopId}`, { headers: GMB_HEADERS })
  if (!res.ok) throw new Error(`GMB stop-ETA ${res.status} for ${stopId}`)
  const { generated_timestamp, data } = GmbStopEtaResponse.parse(await res.json())
  const observedAt = new Date().toISOString()

  const entries: GmbEtaEntry[] = []
  for (const row of data) {
    if (!row.enabled || !row.eta?.length) continue
    // Every eta item in a row shares the route-stop's live/scheduled state, so the first
    // remark represents the whole set (e.g. all "Scheduled", or all live/null).
    const first = row.eta[0]
    entries.push({
      routeId: row.route_id,
      routeSeq: row.route_seq,
      stopId,
      arrivals: cleanArrivals(row.eta.map((e) => e.timestamp)),
      remark: first
        ? optionalRemark(first.remarks_en ?? '', first.remarks_tc ?? '', first.remarks_sc ?? '')
        : undefined,
      dataTimestamp: generated_timestamp,
      observedAt,
    })
  }
  return entries
}
