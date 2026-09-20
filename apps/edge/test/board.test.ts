import { env } from 'cloudflare:test'
import { BoardPlaceSchema } from '@nextbus/contract'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDatasetState } from '../src/dataset'
import { resetEtaCache } from '../src/eta-cache'
import worker from '../src/index'
import { linesOf } from '../src/nearby'
import { datasetJson, kmbStopEtaJson, ORIGIN } from './fixtures'

// `/v1/board` — the endpoint `/v1/nearby` is meant to grow into (ADR-179).
//
// `wire-conformance` already proves the response satisfies `BoardPlace` and carries no undocumented
// field. What it cannot prove is the **invariant a consumer will assume the moment it sees both
// fields**: that `lines` is the complete, de-duplicated line-up, so `lines.length === routeCount`.
// Those two numbers are computed in different places from different shapes — `routeCount` is baked
// into the shard by `routeCountOf` over `operator|route|bound`, and `lines` is de-duplicated here on
// the canonical route id — so nothing but a test holds them together. If they drift, Home's chip strip
// silently shows a "+N" badge that expands to nothing, or hides routes behind a badge that says zero.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const realFetch = globalThis.fetch

beforeEach(() => {
  resetDatasetState()
  resetEtaCache()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    const eta = KMB_STOP_ETA.exec(url)
    if (eta?.[1]) return jsonResponse(kmbStopEtaJson(eta[1]))
    throw new Error(`unexpected fetch in board: ${url}`)
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

async function board(radius: number) {
  const res = await worker.fetch(
    new Request(`https://edge.test/v1/board?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=${radius}`),
    env,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  )
  expect(res.status).toBe(200)
  return (await res.json()) as unknown[]
}

describe('/v1/board', () => {
  it('answers with places that parse as BoardPlace and carry their lines', async () => {
    const places = await board(471)
    expect(places.length).toBeGreaterThan(0)
    for (const place of places) {
      const parsed = BoardPlaceSchema.parse(place)
      expect(parsed.lines, 'every board place carries its line-up').toBeDefined()
      expect(parsed.lines?.length).toBeGreaterThan(0)
    }
  })

  // The invariant, and the reason this file exists.
  it('sends exactly routeCount lines, de-duplicated across the place’s poles', async () => {
    const places = await board(472)
    for (const place of places) {
      const p = BoardPlaceSchema.parse(place)
      const lines = p.lines ?? []
      const ids = lines.map((l) => l.routeId)
      expect(new Set(ids).size, `${p.stop.id}: a line is listed twice`).toBe(ids.length)
      expect(lines.length, `${p.stop.id}: lines.length must equal routeCount`).toBe(p.routeCount)
    }
  })

  // The compatibility half of the owner's ask: the old endpoint keeps its payload exactly.
  it('leaves /v1/nearby’s payload untouched', async () => {
    const res = await worker.fetch(
      new Request(`https://edge.test/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=473`),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    )
    const places = (await res.json()) as Record<string, unknown>[]
    expect(places.length).toBeGreaterThan(0)
    for (const place of places) {
      expect(Object.hasOwn(place, 'lines'), '/v1/nearby must not grow a field').toBe(false)
      expect(Object.hasOwn(place, 'routeCount')).toBe(true)
    }
  })

  // Both paths run one parsing block, so this is a test of the sharing as much as of the answer.
  it('answers the same places as /v1/nearby, at the same distances', async () => {
    const boardPlaces = (await board(474)) as { stop: { id: string }; distanceM: number }[]
    const res = await worker.fetch(
      new Request(`https://edge.test/v1/nearby?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&radius=474`),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as never,
    )
    const nearbyPlaces = (await res.json()) as { stop: { id: string }; distanceM: number }[]
    expect(boardPlaces.map((p) => [p.stop.id, p.distanceM])).toEqual(
      nearbyPlaces.map((p) => [p.stop.id, p.distanceM]),
    )
  })
})

// The de-duplication, tested directly — because the shared fixture cannot reach it.
//
// Every fixture pole serves a route of its own (`R${cluster}${pole}`), so no place has a line at two
// kerbs and none has a service-type variant. The end-to-end invariant above therefore passes whatever
// `linesOf` does, which is exactly the vacuum a `lines.length === routeCount` assertion is prone to:
// mutating the de-duplication away left all four tests green. Extending the shared fixture to carry a
// shared line would change `routeCount` in five other suites, so the rule is exercised here instead,
// on inputs that name what they are for.
describe('linesOf', () => {
  const line = (id: string, routeNo: string, bound: 'inbound' | 'outbound', operator = 'KMB') =>
    ({ route: { id, operator, routeNo, bound } }) as never

  it('folds a line that boards at two kerbs of one place into one', () => {
    // What `PlaceDoc.routes` looks like for an interchange: one entry per pole (WP5-9).
    const got = linesOf([
      line('KMB:6:outbound:1', '6', 'outbound'),
      line('KMB:6:outbound:1', '6', 'outbound'),
    ])
    expect(got.map((l) => l.routeId)).toEqual(['KMB:6:outbound:1'])
  })

  it('folds KMB’s service-type variants into one rider line', () => {
    // The trap. Two distinct route ids, one number, one direction — one line on the bus stop sign, and
    // one entry in `routeCount`, which counts `operator|route|bound`. De-duplicating on the id keeps
    // both and breaks `lines.length === routeCount`.
    const got = linesOf([
      line('KMB:6:outbound:1', '6', 'outbound'),
      line('KMB:6:outbound:2', '6', 'outbound'),
    ])
    expect(got.map((l) => l.routeId)).toEqual(['KMB:6:outbound:1'])
  })

  it('keeps both directions of one number, and both operators of one number', () => {
    // The mirror: neither of these is a duplicate, and a key that collapsed them would hide a route a
    // rider can board. Two operators really do publish the same number in Hong Kong.
    const got = linesOf([
      line('KMB:6:outbound:1', '6', 'outbound'),
      line('KMB:6:inbound:1', '6', 'inbound'),
      line('CTB:6:outbound:1', '6', 'outbound', 'CTB'),
    ])
    expect(got.map((l) => l.routeId)).toEqual([
      'KMB:6:outbound:1',
      'KMB:6:inbound:1',
      'CTB:6:outbound:1',
    ])
  })

  it('preserves dataset order and keeps the first id of each line', () => {
    const got = linesOf([
      line('KMB:960:outbound:1', '960', 'outbound'),
      line('KMB:1:outbound:1', '1', 'outbound'),
      line('KMB:960:outbound:3', '960', 'outbound'),
    ])
    expect(got.map((l) => l.routeId)).toEqual(['KMB:960:outbound:1', 'KMB:1:outbound:1'])
  })
})
