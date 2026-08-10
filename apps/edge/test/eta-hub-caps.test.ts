import {
  createExecutionContext,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { LIVE_PATH, ServerFrameSchema } from '@nextbus/contract'
import type { ServerFrame, WatchTarget } from '@nextbus/core'
import { liveShardFor } from '@nextbus/core'
import { type BuildManifest, datasetKeys, type PlaceDoc } from '@nextbus/data-normalize'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import type { EtaHub } from '../src/eta-hub'
import { LIVE_CTB_BUDGET, LIVE_MAX_TARGETS_PER_SHARD } from '../src/eta-hub'
import worker from '../src/index'
import { liveShardName } from '../src/live'

// `LIVE_MAX_TARGETS_PER_SHARD` — the cap that actually bounds a round's work, and the one that went four
// waves with no test naming it.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS IS ITS OWN FILE, AND ITS OWN FIXTURE
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Two reasons, both about the cap's size rather than about taste:
//
//  · **48 targets needs 48 distinct poles.** `test/fixtures.ts` has 20, deliberately — it is shaped by
//    the clustering rules the nearby and stop suites assert on, and growing it to fill a shard would
//    move numbers those files depend on. So this file seeds its own places of one, straight into KV.
//  · **Filling a shard is not something to leave lying around.** A Durable Object's name here is a
//    function of the data (D4), so two cases watching the same stops share one object *by design* and
//    the pool resets neither instances nor storage between `it()` blocks. Measured while writing this:
//    any case that leaves two live sockets on a shard makes a later `evictDurableObject(…, { webSockets:
//    'hibernate' })` in the same file hang until the test times out — reproduced on `main`'s `eta-hub.ts`
//    as well as on this branch, so it is the harness and not the object. One file per fixture keeps that
//    out of the suite that covers hibernation.
//
// Offline-clean like every other edge spec: `globalThis.fetch` throws on an unexpected URL, so a code
// path that grew a second fetcher fails loudly instead of reaching Hong Kong.

const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/
const CTB_ETA = /^https:\/\/rt\.data\.gov\.hk\/v2\/transport\/citybus\/eta\/CTB\/([^/]+)\/(.+)$/
const HASH = 'livecaps01'

/**
 * Sixty poles, as sixty places of one — five sockets' worth at the per-connection cap of 12, so a
 * shard's union can be pushed past 48 and the excess can be watched being named.
 *
 * Their KMB boards are empty. That is not a shortcut: this file asserts *which targets a shard agrees
 * to watch*, and readings would only add noise to it. The one place they matter is the `readings` table
 * count, and an empty board still writes a row, so the bound is still observable.
 */
const capRawIds = Array.from({ length: 60 }, (_, i) => `CAP${String(i).padStart(2, '0')}`)
const capIds = capRawIds.map((raw) => `KMB:${raw}`)

function capPlaceDoc(rawId: string): PlaceDoc {
  const id = `KMB:${rawId}`
  const name = { en: `Cap ${rawId}`, 'zh-Hant': `上限 ${rawId}`, 'zh-Hans': `上限 ${rawId}` }
  return {
    id,
    name,
    lat: 22.3193,
    lng: 114.1694,
    members: [{ id, operator: 'KMB', stopId: rawId, name, lat: 22.3193, lng: 114.1694 }],
    routes: [],
    routeCount: 0,
  }
}

/**
 * A Central-class Citybus interchange: one pole, many routes.
 *
 * The shape is the whole point. CTB has no per-stop board (ADR-021), so its call key is per **(pole,
 * route)** — a KMB pole costs one call whatever it serves, and a CTB pole costs one call per route
 * number. Over the shipped dataset 113 real places have 24 or more distinct CTB (pole, routeNo) pairs and
 * the heaviest costs 32 calls, so `CTB_ROUTE_COUNT` here is not a stress figure; it is Wan Chai.
 */
const CTB_HEAVY_RAW = '099099'
const CTB_HEAVY_ID = `CTB:${CTB_HEAVY_RAW}`
const CTB_ROUTE_COUNT = 20

function ctbHeavyPlaceDoc(): PlaceDoc {
  const name = { en: 'Wan Chai-ish', 'zh-Hant': '灣仔一帶', 'zh-Hans': '湾仔一带' }
  return {
    id: CTB_HEAVY_ID,
    name,
    lat: 22.2783,
    lng: 114.1747,
    members: [
      {
        id: CTB_HEAVY_ID,
        operator: 'CTB',
        stopId: CTB_HEAVY_RAW,
        name,
        lat: 22.2783,
        lng: 114.1747,
      },
    ],
    routes: Array.from({ length: CTB_ROUTE_COUNT }, (_, i) => {
      const routeNo = `${900 + i}`
      return {
        stopId: CTB_HEAVY_ID,
        route: {
          id: `CTB:${routeNo}:outbound:1`,
          operator: 'CTB' as const,
          routeNo,
          bound: 'outbound' as const,
          serviceType: '1',
          origin: name,
          destination: name,
        },
      }
    }),
    routeCount: CTB_ROUTE_COUNT,
  }
}

/** Every CTB ETA call this round made, as `<pole>|<route>` — the exact key `coalesce` deduplicates on. */
let ctbCalls: string[] = []

const realFetch = globalThis.fetch

beforeAll(async () => {
  const kv = env.DATASET as KVNamespace
  for (const raw of capRawIds) {
    await kv.put(datasetKeys.place(HASH, `KMB:${raw}`), JSON.stringify(capPlaceDoc(raw)))
  }
  await kv.put(datasetKeys.place(HASH, CTB_HEAVY_ID), JSON.stringify(ctbHeavyPlaceDoc()))
  const manifest: BuildManifest = {
    hash: HASH,
    sourceHash: 'seed',
    builtAt: '2026-07-27T00:00:00.000Z',
    counts: { places: capRawIds.length, aliases: 0, routes: 0, cells: 0, stops: capRawIds.length },
  }
  await kv.put(datasetKeys.current, JSON.stringify(manifest))
})

/** Every client socket this file opened, so nothing is left subscribed for the next case. */
let opened: WebSocket[] = []

beforeEach(() => {
  resetEtaCache()
  ctbCalls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const empty = () =>
      new Response(JSON.stringify({ generated_timestamp: '2026-07-27T04:00:00.000Z', data: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    if (KMB_STOP_ETA.test(url)) return empty()
    const ctb = CTB_ETA.exec(url)
    if (ctb) {
      ctbCalls.push(`${ctb[1]}|${ctb[2]}`)
      return empty()
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
})

afterEach(async () => {
  for (const ws of opened) {
    try {
      ws.close(1000, 'test over')
    } catch {
      // Already closed by the case itself; closing twice is not a failure.
    }
  }
  opened = []
  globalThis.fetch = realFetch
})

// ── Driving the socket ──────────────────────────────────────────────────────────────────────────

const liveUrl = (targets: string[]): string =>
  `${LIVE_PATH}?targets=${encodeURIComponent(targets.join(','))}`

/** Read frames off a client socket, validating every one against the published schema. */
function readFrames(ws: WebSocket): {
  all(): ServerFrame[]
  take(n: number): Promise<ServerFrame[]>
  drain(): void
} {
  let frames: ServerFrame[] = []
  const problems: string[] = []

  ws.addEventListener('message', (event: MessageEvent) => {
    const text =
      typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer)
    const parsed = ServerFrameSchema.safeParse(JSON.parse(text))
    // Collected rather than thrown: a throw inside a `message` listener is swallowed by the event loop
    // and would turn a red test green.
    if (!parsed.success) problems.push(`frame does not satisfy ServerFrameSchema: ${text}`)
    else frames.push(parsed.data)
  })

  const check = () => {
    if (problems.length > 0) throw new Error(problems.join('\n'))
  }
  return {
    all() {
      check()
      return [...frames]
    },
    async take(n) {
      const deadline = Date.now() + 5_000
      while (frames.length < n && problems.length === 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      check()
      if (frames.length < n) {
        throw new Error(`timed out waiting for ${n} frame(s); got ${frames.length}`)
      }
      return [...frames]
    },
    drain() {
      check()
      frames = []
    },
  }
}

async function connect(
  targets: string[],
): Promise<{ ws: WebSocket; frames: ReturnType<typeof readFrames> }> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(
    new Request(`https://edge.test${liveUrl(targets)}`, { headers: { Upgrade: 'websocket' } }),
    env,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  expect(res.status, `upgrade for ${targets.join(',')}`).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('a 101 with no webSocket')
  // Listener before `accept()`: the shard sends the snapshot inside the same `fetch` that produced this
  // response, so the frame is already queued.
  const frames = readFrames(ws)
  ws.accept()
  opened.push(ws)
  return { ws, frames }
}

const stubFor = (targets: string[]) =>
  (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
    liveShardName(liveShardFor(targets.map((stopId): WatchTarget => ({ stopId })))),
  )

const settle = (ms = 100): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function only<T extends ServerFrame['type']>(
  frames: readonly ServerFrame[],
  type: T,
): Array<Extract<ServerFrame, { type: T }>> {
  return frames.filter((f): f is Extract<ServerFrame, { type: T }> => f.type === type)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('the shard target cap', () => {
  it('applies to a `subscribe` frame, and never locks the shard out with it', async () => {
    // The cap had **two doors and one check**. `fetch()` computed the shard union and refused the upgrade
    // over 48; `subscribe()` — the door route narrowing arrives through, and the one `socket.ts` uses
    // when a rider's target set changes on an open connection — looked at nothing but the per-connection
    // cap. So the checked bound was 48 and the real one was 64 × 12 = 768. Worse, the refusal was itself
    // a lock-out: once any five sockets had pushed a shard past 48, every subsequent *legitimate* upgrade
    // to it got a 500 the browser cannot read and `socket.ts` reconnects on for ever. Both halves are
    // asserted below, and both failed before the fix.
    const subscribeTo = (ws: WebSocket, ids: readonly string[]): void => {
      ws.send(JSON.stringify({ type: 'subscribe', targets: ids.map((stopId) => ({ stopId })) }))
    }

    // One shared pole in every connect URL, so `liveShardFor` is fixed and all five land on one object.
    const host = capIds[0] as string
    const sockets: Array<{ ws: WebSocket; frames: ReturnType<typeof readFrames> }> = []
    for (let i = 0; i < 5; i++) {
      const connection = await connect([host])
      await connection.frames.take(2)
      sockets.push(connection)
    }

    // Four sockets take 44 of the 48 between them, so the fifth's twelve straddle the bound: four fit and
    // eight do not. That is the case the greedy fit exists for — refusing all twelve would punish a rider
    // for the shard's other subscribers, and keeping all twelve is the bug.
    for (let i = 0; i < 4; i++) {
      const socket = sockets[i] as { ws: WebSocket; frames: ReturnType<typeof readFrames> }
      socket.frames.drain()
      subscribeTo(socket.ws, capIds.slice(i * 11, i * 11 + 11))
      expect(only(await socket.frames.take(2), 'snapshot')[0]?.targets.length).toBe(11)
    }

    const last = sockets[4] as { ws: WebSocket; frames: ReturnType<typeof readFrames> }
    last.frames.drain()
    const asked = capIds.slice(44, 56)
    subscribeTo(last.ws, asked)
    await last.frames.take(2)
    await settle()
    const received = last.frames.all()

    // Sliced in canonical order, which is what keeps `fits[0] === kept[0]` and therefore keeps this
    // connection on the shard the URL routed it to.
    expect(only(received, 'snapshot')[0]?.targets.map((t) => t.stopId)).toEqual(asked.slice(0, 4))
    const capped = only(received, 'status').find((frame) => frame.error?.code === 'internal')
    // `internal`, **not** `bad_request`: a full shard is our fault, not the rider's, so `retryable` stays
    // true. A Widget that read `retryable: false` here would prune a favourite whose stop is perfectly
    // fine — which is the same argument the refused upgrade made for the same condition.
    expect(capped?.error?.retryable).toBe(true)
    expect(capped?.state, 'four of the twelve are watched, so the connection is live').toBe('live')
    for (const excess of asked.slice(4)) expect(capped?.error?.message).toContain(excess)

    // **The lock-out half.** A shard at its target cap must still answer 101 — this upgrade was a
    // `500 shard is at capacity (48 targets)` before the fix.
    const sixth = await connect([host])
    const sixthFrames = await sixth.frames.take(2)
    // And it is not merely accepted, it is *served*: `host` is already in the shard's poll set, so
    // watching it costs the shard nothing and `acceptTargets`' union semantics say so. That is the case
    // the design exists for — a stop is hot precisely when many people are looking at it — and it is
    // exactly the rider the old refusal turned away.
    expect(only(sixthFrames, 'snapshot')[0]?.targets).toEqual([{ stopId: host }])
    expect(only(sixthFrames, 'status')[0]?.state).toBe('live')
    expect(only(sixthFrames, 'status')[0]?.error).toBeUndefined()

    // A seventh asks for `host` **and** a pole nobody watches. `host` is the lower id, so the URL routes
    // to this same full shard, and the second target is one the shard genuinely has no room for. It gets a
    // socket, the target it can have, and — **readably** — the name of the one it cannot; a 500 on the
    // handshake could say none of that, because the browser WebSocket API exposes neither status nor body.
    const spare = capIds[56] as string
    const seventh = await connect([host, spare])
    const seventhFrames = await seventh.frames.take(2)
    expect(only(seventhFrames, 'snapshot')[0]?.targets).toEqual([{ stopId: host }])
    const refused = only(seventhFrames, 'status')[0]
    expect(refused?.state).toBe('live')
    expect(refused?.error?.code).toBe('internal')
    expect(refused?.error?.retryable).toBe(true)
    expect(refused?.error?.message).toContain(spare)

    // …and the bound the cap's docblock and the `readings` schema comment both claim really holds.
    const attachments = await runInDurableObject(stubFor([host]), (_i: EtaHub, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as { targets: WatchTarget[] }),
    )
    const union = new Set(attachments.flatMap((a) => a?.targets.map((t) => t.stopId) ?? []))
    expect(union.size).toBeLessThanOrEqual(LIVE_MAX_TARGETS_PER_SHARD)

    expect(await runDurableObjectAlarm(stubFor([host]))).toBe(true)
    const rows = await runInDurableObject(stubFor([host]), (_i: EtaHub, state) =>
      state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM readings').one(),
    )
    expect(rows.n).toBeLessThanOrEqual(LIVE_MAX_TARGETS_PER_SHARD)
    // Six sockets, five re-subscriptions and a round over 48 stubbed poles.
  }, 30_000)
})

describe('a round’s upstream fan-out', () => {
  it('bounds CTB per place, so the cap’s stated arithmetic is the arithmetic it does', async () => {
    // `stopEtas` dropped the budget parameter on its way to `stopArrivals`, so a round ran at
    // `DEFAULT_CTB_BUDGET = 24` — the number chosen for a *single HTTP request*, not for something that
    // repeats every 45 s for as long as a socket is open. Measured over the shipped dataset, the 48
    // heaviest real places cost 1,342 upstream calls at 24, against the ~100–150 the cap's docblock
    // claimed: ~67 s of queued fetching at six simultaneous connections, past the 45 s cadence floor, so
    // a shard at its own cap would never stop fetching and never become hibernation-eligible — the
    // economy the whole design is justified by. `/v1/nearby` already needed a smaller number for exactly
    // this reason, under a comment saying "the v2 push engine replaces this", which is this object.
    const { frames } = await connect([CTB_HEAVY_ID])
    await frames.take(2)
    // The connect pulls the alarm forward, so let its round finish and start counting from a cold cache:
    // `coalesce` holds a pole for 30 s per isolate, and what is being counted is one round's fan-out.
    await settle(200)
    ctbCalls = []
    resetEtaCache()

    expect(await runDurableObjectAlarm(stubFor([CTB_HEAVY_ID]))).toBe(true)
    await settle(100)

    expect(
      new Set(ctbCalls).size,
      `one round asked upstream ${new Set(ctbCalls).size} times for one place`,
    ).toBeLessThanOrEqual(LIVE_CTB_BUDGET)
    // …and it really is the budget doing the bounding, not an empty fixture: the place serves more routes
    // than the budget allows, and every call that *was* made is one of them.
    expect(CTB_ROUTE_COUNT).toBeGreaterThan(LIVE_CTB_BUDGET)
    expect(new Set(ctbCalls).size).toBe(LIVE_CTB_BUDGET)
    for (const call of ctbCalls) expect(call).toMatch(new RegExp(`^${CTB_HEAVY_RAW}\\|9\\d\\d$`))
  })

  it('asks about one route when one route is what was subscribed to', async () => {
    // **Narrowing has to bound the questions, not just filter the answers.** It did not: `routeIds` reached
    // `narrowEtasToRoutes` on the way out and nothing on the way in, so a connection watching one route at
    // this place paid for all twenty. Measured through the real thing before this case existed — a route
    // watch on `CTB:11:outbound:1`, 18 poles, `wrangler dev` on 2026-08-10 — **350 upstream calls in one
    // round** where 18 would do, repeating every 45 s per watched route against a free feed. `boardsFor` in
    // `stop-route.ts` is the rule; this is what it is worth.
    //
    // The `subscribe` frame is the door route narrowing arrives through (§8.1), which is why the case is
    // driven through it rather than through `stopEtas` directly: the *round* is what repeats.
    const watched = `CTB:900:outbound:1`
    const { ws, frames } = await connect([CTB_HEAVY_ID])
    await frames.take(2)
    ws.send(
      JSON.stringify({
        type: 'subscribe',
        targets: [{ stopId: CTB_HEAVY_ID, routeIds: [watched] }],
      }),
    )
    await frames.take(4)
    await settle(200)
    ctbCalls = []
    resetEtaCache()

    expect(await runDurableObjectAlarm(stubFor([CTB_HEAVY_ID]))).toBe(true)
    await settle(100)

    expect(ctbCalls, `a round for one route asked upstream ${ctbCalls.length} times`).toEqual([
      `${CTB_HEAVY_RAW}|900`,
    ])
    // …and the fixture could have produced nineteen more, which is the whole point of measuring it here.
    expect(CTB_ROUTE_COUNT).toBeGreaterThan(1)
  })
})
