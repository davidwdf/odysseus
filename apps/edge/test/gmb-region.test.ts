import {
  fetchConsolidatedIndex,
  GMB_REGION_BY_ROUTE_ID,
  routeDocFor,
} from '@nextbus/data-normalize'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSearchIndex } from '../src/search-index'

// ADR-176 and ADR-177: **a green-minibus route number is not an identity**, and this file holds both
// faces of that one fact — the tag that tells a rider which `1` they are looking at, and the direction
// toggle that used to send them to the other one.
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

/**
 * A consolidated dataset with the two minibus `1`s and a KMB `1`, and nothing else.
 *
 * `bothDirections` adds the return leg of every route. It is a parameter rather than two fixtures
 * because the two states are the two answers ADR-177 has to give — flip to the right route, or offer
 * no flip — and a reader should see them side by side.
 */
function datasetWithBothOnes(bothDirections: boolean): unknown {
  const stop = (lat: number, lng: number, en: string) => ({
    location: { lat, lng },
    name: { en, zh: en },
  })
  const leg = (
    co: string,
    gtfsId: string | undefined,
    bound: 'O' | 'I',
    orig: [string, string],
    dest: [string, string],
    stops: string[],
  ) => ({
    co: [co],
    route: '1',
    serviceType: '1',
    bound: { [co]: bound },
    ...(gtfsId === undefined ? {} : { gtfsId }),
    orig: { en: orig[0], zh: orig[1] },
    dest: { en: dest[0], zh: dest[1] },
    stops: { [co]: stops },
  })
  const PEAK: [string, string] = ['The Peak', '山頂']
  const CENTRAL: [string, string] = ['Central', '中環']
  const SAIKUNG: [string, string] = ['Sai Kung', '西貢']
  const KLNBAY: [string, string] = ['Kowloon Bay', '九龍灣']
  const CHUKYUEN: [string, string] = ['Chuk Yuen Estate', '竹園邨']
  const STARFERRY: [string, string] = ['Star Ferry', '尖沙咀碼頭']

  const routeList: Record<string, unknown> = {
    'gmb-1-hki-o': leg('gmb', HKI_ROUTE_1, 'O', PEAK, CENTRAL, ['PEAK', 'CENTRAL']),
    'gmb-1-nt-o': leg('gmb', NT_ROUTE_1, 'O', SAIKUNG, KLNBAY, ['SAIKUNG', 'KLNBAY']),
    // A KMB route carries a `gtfsId` too (ADR-152 keeps it for every operator) — and it is a TD route
    // id from the same number space. This one is deliberately a **GMB id the table knows**, so a
    // lookup that forgot to ask "is this GMB?" would tag a KMB route and the region test would say so.
    'kmb-1-o': leg('kmb', NT_ROUTE_1, 'O', CHUKYUEN, STARFERRY, ['CHUKYUEN', 'STARFERRY']),
  }
  if (bothDirections) {
    routeList['gmb-1-hki-i'] = leg('gmb', HKI_ROUTE_1, 'I', CENTRAL, PEAK, ['CENTRAL', 'PEAK'])
    routeList['gmb-1-nt-i'] = leg('gmb', NT_ROUTE_1, 'I', KLNBAY, SAIKUNG, ['KLNBAY', 'SAIKUNG'])
    // **No `gtfsId` on the return leg**, which is the ~9% of franchised route-directions the TD does
    // not register (ADR-152). A guard that required a matching id for every operator would delete this
    // toggle; the third test below is what catches that.
    routeList['kmb-1-i'] = leg('kmb', undefined, 'I', STARFERRY, CHUKYUEN, [
      'STARFERRY',
      'CHUKYUEN',
    ])
  }

  return {
    stopList: {
      PEAK: stop(22.2708, 114.15, 'The Peak'),
      CENTRAL: stop(22.2847, 114.1585, 'Central'),
      SAIKUNG: stop(22.3817, 114.2707, 'Sai Kung'),
      KLNBAY: stop(22.3231, 114.2126, 'Kowloon Bay'),
      CHUKYUEN: stop(22.3418, 114.1907, 'Chuk Yuen Estate'),
      STARFERRY: stop(22.2941, 114.1686, 'Star Ferry'),
    },
    routeList,
  }
}

async function indexFromFixture({ bothDirections = false } = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(datasetWithBothOnes(bothDirections)), {
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

describe('the direction toggle flips to the other end of the SAME route', () => {
  // ADR-177, and the defect it fixes was reported from the app: *"the swap button moved me from NT to
  // Hong Kong Island"*. `routeDocFor` matched the opposite bound on operator + number, which is not
  // unique for GMB, and tie-broke with `preferServiceType` — comparing two route ids, because ADR-047
  // folds `route_id` into that slot. It therefore returned the numerically lowest: **335 of 1,154 GMB
  // route-directions flipped to a different route.**
  //
  // The fixture is built so the *old* rule is wrong in the way the owner saw it: both `1`s have both
  // directions, and the NT id (2002337) sorts below the HKI one (2006408), so matching on the number
  // sent a rider standing on The Peak to Sai Kung.

  it('keeps a minibus rider on their own route, in their own region', async () => {
    const index = await indexFromFixture({ bothDirections: true })
    const hkiOut = routeDocFor(index, `GMB:1:outbound:${HKI_ROUTE_1}`)
    const ntOut = routeDocFor(index, `GMB:1:outbound:${NT_ROUTE_1}`)
    expect(hkiOut?.reverse?.id).toBe(`GMB:1:inbound:${HKI_ROUTE_1}`)
    expect(ntOut?.reverse?.id).toBe(`GMB:1:inbound:${NT_ROUTE_1}`)
    // The half a route id alone would not prove: the rider ends up at the right *place*.
    expect(hkiOut?.reverse?.origin.en).toBe('Central')
    expect(ntOut?.reverse?.origin.en).toBe('Kowloon Bay')
  })

  it('offers no toggle at all when upstream registers only one direction', async () => {
    // 163 GMB route-directions are like this, and `/route-stop/<id>/2` is empty for them upstream —
    // so there is genuinely no return leg. ADR-046 already holds the rule: an absent `reverse` **is**
    // the answer to "should there be a toggle", and the old code answered it with another route.
    const index = await indexFromFixture({ bothDirections: false })
    expect(routeDocFor(index, `GMB:1:outbound:${HKI_ROUTE_1}`)?.reverse).toBeUndefined()
  })

  it('still flips a franchised route, which has a number but often no route id', async () => {
    // The guard is GMB-only on purpose: ~9% of KMB/CTB route-directions carry no `gtfsId` (ADR-152),
    // so requiring one would have deleted a working toggle from every racecourse and school variant.
    const index = await indexFromFixture({ bothDirections: true })
    expect(routeDocFor(index, 'KMB:1:outbound:1')?.reverse?.id).toBe('KMB:1:inbound:1')
  })
})
