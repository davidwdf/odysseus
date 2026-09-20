import { fetchConsolidatedIndex, GMB_REGION_BY_ROUTE_ID } from '@nextbus/data-normalize'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSearchIndex } from '../src/search-index'

// ADR-171: the join that makes a green-minibus route number mean something.
//
// A GMB `route_code` is only unique inside its region, so `1` names a real route on Hong Kong
// Island *and* a different real one in the New Territories. The region that tells them apart is not
// in the consolidated dataset — it is in `gmb-regions.generated.ts`, a committed crawl of
// `data.etagmb.gov.hk` keyed on `route_id`, which arrives here as the dataset's `gtfsId`.
//
// **Three links, and this is the only place all three are exercised together**: the table knows the
// two ids, `fetchConsolidatedIndex` joins on them, and `buildSearchIndex` carries the result onto the
// `RouteLite` a client reads. The kernel side — the tag becoming a word — is corpus-pinned in
// `packages/core`, which cannot see any of this because it never touches a dataset.
//
// The fixture is **two real route ids with their real termini**, not invented ones: the whole claim
// is about a lookup against committed data, and a made-up id would only prove the lookup misses.

/** GMB route 1 on Hong Kong Island — The Peak ↔ Central. */
const HKI_ROUTE_1 = '2006408'
/** GMB route 1 in the New Territories — Sai Kung ↔ Kowloon Bay. Same public number, other route. */
const NT_ROUTE_1 = '2002337'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A consolidated dataset with the two minibus `1`s and a KMB `1`, and nothing else. */
function datasetWithBothOnes(): unknown {
  const stop = (lat: number, lng: number, en: string) => ({
    location: { lat, lng },
    name: { en, zh: en },
  })
  return {
    stopList: {
      PEAK: stop(22.2708, 114.15, 'The Peak'),
      CENTRAL: stop(22.2847, 114.1585, 'Central'),
      SAIKUNG: stop(22.3817, 114.2707, 'Sai Kung'),
      KLNBAY: stop(22.3231, 114.2126, 'Kowloon Bay'),
      CHUKYUEN: stop(22.3418, 114.1907, 'Chuk Yuen Estate'),
      STARFERRY: stop(22.2941, 114.1686, 'Star Ferry'),
    },
    routeList: {
      'gmb-1-hki': {
        co: ['gmb'],
        route: '1',
        serviceType: '1',
        bound: { gmb: 'O' },
        gtfsId: HKI_ROUTE_1,
        orig: { en: 'The Peak', zh: '山頂' },
        dest: { en: 'Central', zh: '中環' },
        stops: { gmb: ['PEAK', 'CENTRAL'] },
      },
      'gmb-1-nt': {
        co: ['gmb'],
        route: '1',
        serviceType: '1',
        bound: { gmb: 'O' },
        gtfsId: NT_ROUTE_1,
        orig: { en: 'Sai Kung', zh: '西貢' },
        dest: { en: 'Kowloon Bay', zh: '九龍灣' },
        stops: { gmb: ['SAIKUNG', 'KLNBAY'] },
      },
      'kmb-1': {
        co: ['kmb'],
        route: '1',
        serviceType: '1',
        bound: { kmb: 'O' },
        // A KMB route carries a `gtfsId` too (ADR-152 keeps it for every operator) — and it is a TD
        // route id from the same number space. This one is deliberately a **GMB id the table knows**,
        // so a lookup that forgot to ask "is this GMB?" would tag a KMB route and this test would say so.
        gtfsId: NT_ROUTE_1,
        orig: { en: 'Chuk Yuen Estate', zh: '竹園邨' },
        dest: { en: 'Star Ferry', zh: '尖沙咀碼頭' },
        stops: { kmb: ['CHUKYUEN', 'STARFERRY'] },
      },
    },
  }
}

async function indexFromFixture() {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(datasetWithBothOnes()), {
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  return fetchConsolidatedIndex()
}

describe('a green-minibus route carries the region its number is unique within', () => {
  it('knows both route ids named `1`, in two different regions', () => {
    // The anti-vacuous control. Every assertion below is a lookup against this table, so a table that
    // had lost these rows would make the rest of the file pass by agreeing that nothing is tagged.
    expect(GMB_REGION_BY_ROUTE_ID[HKI_ROUTE_1]).toBe('HKI')
    expect(GMB_REGION_BY_ROUTE_ID[NT_ROUTE_1]).toBe('NT')
  })

  it('joins the region onto each GMB route’s meta, and onto no one else’s', async () => {
    const index = await indexFromFixture()
    const regions = [...index.routeMeta].map(([id, meta]) => [id, meta.region] as const)
    expect(Object.fromEntries(regions)).toEqual({
      [`GMB:1:outbound:${HKI_ROUTE_1}`]: 'HKI',
      [`GMB:1:outbound:${NT_ROUTE_1}`]: 'NT',
      // Untagged despite carrying a `gtfsId` the table would have answered for — the lookup is
      // reachable for GMB alone, because for any other operator a hit is a coincidence.
      'KMB:1:outbound:1': undefined,
    })
  })

  it('carries it onto the search index the client reads', async () => {
    const { routes } = await buildSearchIndex(await indexFromFixture())
    const byId = new Map(routes.map((r) => [r.id, r]))
    // The two minibus rows survive as **two** rows: they share a number and a direction, and only
    // their termini keep them apart in the collapse key. That is the state the tag exists for.
    expect(routes).toHaveLength(3)
    expect(byId.get(`GMB:1:outbound:${HKI_ROUTE_1}`)?.region).toBe('HKI')
    expect(byId.get(`GMB:1:outbound:${NT_ROUTE_1}`)?.region).toBe('NT')
    expect(byId.get('KMB:1:outbound:1')?.region).toBeUndefined()
  })

  it('leaves no `region` key on a row that has none, so the wire pays nothing for it', async () => {
    // `undefined` is dropped by `JSON.stringify`, which is what makes an optional field free for the
    // ~14,000 KMB/CTB rows that will never have one. Asserted on the serialized form, because that is
    // the form the client actually receives.
    const { routes } = await buildSearchIndex(await indexFromFixture())
    const kmb = JSON.parse(JSON.stringify(routes.find((r) => r.operator === 'KMB')))
    expect('region' in kmb).toBe(false)
  })
})
