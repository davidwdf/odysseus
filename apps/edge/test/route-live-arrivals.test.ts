// `/v1/route/:id` says whether its per-stop readings are a complete answer, and if not, why not (ADR-114).
//
// WHAT WAS WRONG
// The route feed was fetched for KMB and LWB only — Citybus publishes no bulk route-eta endpoint (ADR-021)
// and GMB is not wired — and the one operator it *was* fetched for had its failure swallowed by
// `.catch(() => [])`. So `eta: null` on every stop meant three different things: no bus is due anywhere,
// the round did not answer, or nobody was ever going to ask. A schematic renders identically for all three,
// which is how a Citybus route read as "no bus is due" for two waves.
//
// WHY THIS DRIVES `routeDetail` DIRECTLY AND NOT THE WORKER
// The three arms are chosen by the *operator*, and the fixture dataset every other edge suite shares
// carries KMB only (`test/fixtures.ts`: one `co: 'KMB'`). Reaching `perStopOnly` through the worker would
// mean growing that dataset a Citybus route for the sake of one branch, and reaching `unavailable` would
// mean making a stubbed upstream fail in a way the other suites' stub does not model. A hand-made
// `DatasetSource` is the honest unit for "which arm does this operator get": it is one function, its input
// is a document, and the answer is a field.
//
// What this therefore does NOT prove is the wire round trip — that the field survives serialisation and
// validates. `wire-conformance.test.ts` covers that against the real worker, and its route is KMB, so the
// *absent* case is the one it sees.

import { beforeEach, describe, expect, it } from 'vitest'
import type { DatasetSource } from '../src/dataset'
import { resetEtaCache } from '../src/eta-cache'
import { routeDetail } from '../src/stop-route'

// The isolate outlives a single test, so a coalesced *success* would still be warm for the next one and the
// failing test would read the passing test's answer. Every test here starts cold — the same guard
// `eta-coalescing.test.ts` makes, and for the same reason.
beforeEach(() => {
  resetEtaCache()
})

/** A dataset with exactly one route in it and nothing else reachable. */
function datasetWith(operator: 'KMB' | 'CTB' | 'GMB'): DatasetSource {
  const doc = {
    route: {
      id: `${operator}:1:outbound:1`,
      operator,
      routeNo: '1',
      direction: 'outbound' as const,
      serviceType: '1',
      origin: { en: 'A', 'zh-Hant': 'A', 'zh-Hans': 'A' },
      destination: { en: 'B', 'zh-Hant': 'B', 'zh-Hans': 'B' },
    },
    stops: [0, 1, 2].map((i) => ({
      seq: i + 1,
      id: `${operator}:S${i}`,
      operator,
      stopId: `S${i}`,
      name: { en: `Stop ${i}`, 'zh-Hant': `站 ${i}`, 'zh-Hans': `站 ${i}` },
      lat: 22.3 + i / 1000,
      lng: 114.17,
      fare: '5.8',
    })),
  }
  return {
    origin: 'inline',
    buildHash: null,
    place: async () => null,
    route: async (id: string) => (id === doc.route.id ? (doc as never) : null),
    cells: async () => [],
    searchIndex: async () => ({ routes: [], stops: [] }) as never,
  }
}

/**
 * The KMB route-eta upstream, made to answer or to fail.
 *
 * Every edge suite installs its own `globalThis.fetch` and lets anything unexpected fall through to the
 * real one, which throws — so a code path that reached for a URL this test did not name would be a loud
 * failure rather than a silent network call.
 */
function stubUpstream(mode: 'answers' | 'rejects'): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/route-eta/')) {
      if (mode === 'rejects') throw new Error('upstream is down')
      // An answer with no arrivals for this route, which is the *quiet route* case: the round happened.
      // `generated_timestamp` is not decoration — `KmbEtaResponse.parse` requires it, and a body without
      // it throws, which would arrive here as `unavailable` and quietly make this test assert the
      // opposite of its name.
      return new Response(
        JSON.stringify({ generated_timestamp: '2026-08-09T09:00:00+08:00', data: [] }),
        {
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    return real(input, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

describe('a route says whether anybody answered', () => {
  it('says nothing when the round answered — absence is the good case', async () => {
    // The wire convention `failed` set: "every board answered" and "we have nothing to say about failures"
    // must not be the same bytes. So the field is omitted, and the kernel turns that into `'answered'`.
    const restore = stubUpstream('answers')
    try {
      const detail = await routeDetail(datasetWith('KMB'), 'KMB:1:outbound:1')
      expect(detail.liveArrivals).toBeUndefined()
      expect(Object.keys(detail), 'the key is absent, not null').not.toContain('liveArrivals')
      // …and this is the case the field has to be distinguishable *from*: a round that happened and found
      // nothing. Every stop is `null` here too.
      expect(detail.stops.every((s) => s.eta === null)).toBe(true)
    } finally {
      restore()
    }
  })

  it('says `unavailable` when the round did not answer, and keeps everything static', async () => {
    // The catch is deliberate and stays (ADR-073): a route view without live times is still a route view.
    // What changes is that it now reports itself, because an outage on KMB — where every rider is — used to
    // be indistinguishable from a quiet route.
    const restore = stubUpstream('rejects')
    try {
      const detail = await routeDetail(datasetWith('KMB'), 'KMB:1:outbound:1')
      expect(detail.liveArrivals).toBe('unavailable')
      // The whole reason the failure is caught rather than thrown, asserted rather than assumed:
      expect(detail.stops.length, 'the stop list was lost with the readings').toBe(3)
      expect(detail.stops.map((s) => s.fare)).toEqual(['5.8', '5.8', '5.8'])
      expect(detail.route.routeNo).toBe('1')
    } finally {
      restore()
    }
  })

  for (const operator of ['CTB', 'GMB'] as const) {
    it(`says \`perStopOnly\` for ${operator}, which is a fact about the feed and not a failure`, async () => {
      // No upstream stub at all, deliberately: if this operator ever *did* reach for a route feed, the real
      // `fetch` would be called and this test would fail loudly. That is the assertion — nobody asked.
      const detail = await routeDetail(datasetWith(operator), `${operator}:1:outbound:1`)
      expect(detail.liveArrivals).toBe('perStopOnly')
      expect(detail.stops.every((s) => s.eta === null)).toBe(true)
    })
  }
})
