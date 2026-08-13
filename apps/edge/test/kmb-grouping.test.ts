// The KMB adapter's bucket key is canonicalised like the id it mints (ADR-146).
//
// Lives in the edge suite because `@nextbus/data-normalize` has no suite of its own — its adapters
// are exercised here, against workerd, everywhere else they are tested. This one needs no Worker:
// the defect was pure grouping arithmetic, driven through the public fetcher with a stubbed fetch.

import { fetchKmbStopEta } from '@nextbus/data-normalize'
import { describe, expect, it } from 'vitest'

const STOP = '18492910339E23AA'

/** One KMB stop-eta row; `service_type`'s TYPE is the point, so it is a parameter. */
function row(serviceType: number | string, eta: string, etaSeq: number) {
  return {
    co: 'KMB',
    route: '6',
    dir: 'O',
    service_type: serviceType,
    seq: 1,
    dest_en: 'STAR FERRY',
    dest_tc: '尖沙咀碼頭',
    dest_sc: '尖沙咀码头',
    eta_seq: etaSeq,
    eta,
    rmk_en: '',
    rmk_tc: '',
    rmk_sc: '',
    data_timestamp: '2026-07-27T12:00:00+08:00',
  }
}

describe('groupKmb’s bucket key', () => {
  it('a response mixing service_type 1 and "1" is ONE board, not two that dedupe to half', async () => {
    // The schema admits `number | string` for `service_type` and the static dataset is documented
    // mixing exactly these types. Keyed raw, the two rows below split into two buckets minting the
    // SAME routeId — and `dedupeEtas` downstream keeps one bucket, so the other's arrival vanished
    // from the rider's row. One bucket means both arrivals, in order.
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          generated_timestamp: '2026-07-27T12:00:00+08:00',
          data: [row(1, '2026-07-27T12:05:00+08:00', 1), row('1', '2026-07-27T12:12:00+08:00', 2)],
        }),
        { headers: { 'content-type': 'application/json' } },
      )) as typeof fetch

    const etas = await fetchKmbStopEta(STOP, fetchImpl)
    expect(etas.length).toBe(1)
    expect(etas[0]?.routeId).toBe('KMB:6:outbound:1')
    expect(etas[0]?.arrivals).toEqual(['2026-07-27T12:05:00+08:00', '2026-07-27T12:12:00+08:00'])
  })
})
