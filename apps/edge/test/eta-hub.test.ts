import {
  createExecutionContext,
  env,
  evictDurableObject,
  listDurableObjectIds,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { LIVE_PATH, ServerFrameSchema } from '@nextbus/contract'
import type { Eta, ServerFrame, WatchTarget } from '@nextbus/core'
import { LIVE_SHARD_COUNT, liveShardFor } from '@nextbus/core'
import {
  allAliases,
  allGeoCells,
  allPlaceIds,
  allRouteIds,
  type BuildManifest,
  datasetKeys,
  fetchConsolidatedIndex,
  placeDocFor,
  routeDocFor,
} from '@nextbus/data-normalize'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetEtaCache } from '../src/eta-cache'
import type { EtaHub } from '../src/eta-hub'
import { LIVE_MAX_TARGETS_PER_CONNECTION } from '../src/eta-hub'
import worker from '../src/index'
import { liveShardName, liveUpgrade } from '../src/live'
import { datasetJson, poles } from './fixtures'

// WP5-3 acceptance: the `EtaHub` shard, driven through the real Worker inside workerd.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THESE TESTS CAN AND CANNOT OBSERVE, STATED BEFORE THE FIRST ASSERTION
// ────────────────────────────────────────────────────────────────────────────────────────────────
// This file is the one that could most easily claim more than it checks, so the limits are here rather
// than buried:
//
//  · **The hibernation *handlers* are genuinely the dispatch path.** The pool installs a prototype
//    method for every handler before user code loads, so workerd really dispatches `webSocketMessage`
//    and `alarm` — this DO registers no `'message'` listener anywhere (it calls `ctx.acceptWebSocket`,
//    never `server.accept()`), so a client frame that is handled at all can only have gone through the
//    handler.
//  · **No test here can prove workerd *chose* to hibernate.** There is no local knob for the inactivity
//    threshold and nothing will spontaneously hibernate an object inside a test's lifetime.
//    `evictDurableObject(stub, { webSockets: 'hibernate' })` is an explicit test-only teardown that
//    performs the same instance destruction production hibernation performs — so what is covered is the
//    *consequence* (state recovered from the attachment and from storage on a cold instance) and not the
//    *policy*. The test named for it says so in its own comment.
//  · **`runDurableObjectAlarm` ignores the scheduled time entirely.** It fires whatever is armed,
//    immediately. So it proves what a round does, never *when* a round happens; the cadence is asserted
//    separately, by reading the alarm the round installed.
//  · **Message delivery is asynchronous**, so "no frame was sent" is a claim about a window. Every such
//    assertion here is paired with a control in the same test that shows a frame *does* arrive through
//    the same reader in the same window — otherwise "nothing arrived" would also pass with a socket that
//    was never listening, which is this repo's recurring failure shape.
//
// The suite is offline-clean like every other edge spec: `globalThis.fetch` is stubbed and **throws** on
// an unexpected URL, so a code path that grew a second fetcher fails loudly rather than reaching HK.

// ── Upstream, as a mutable fixture ──────────────────────────────────────────────────────────────
//
// The shared `kmbStopEtaJson` is a constant, and every interesting assertion here is about *change*
// between two rounds. So the board is a map the test mutates: one entry per (pole, route), with the
// arrivals a round will serve.

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

const HASH = 'livehub01'
const NOW = new Date('2026-07-27T12:00:00+08:00')
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString()

interface BoardEntry {
  route: string
  arrivals: string[]
}

/** Raw operator stop id → what its KMB stop board will return this round. */
const boards = new Map<string, BoardEntry[]>()

function resetBoards(): void {
  boards.clear()
  for (const pole of poles)
    boards.set(pole.rawId, [{ route: pole.route, arrivals: [at(4), at(8)] }])
}

/** The KMB `stop-eta` envelope, shaped exactly as `fetchKmbStopEta` parses it. */
function boardJson(rawId: string): unknown {
  const entries = boards.get(rawId) ?? []
  return {
    generated_timestamp: NOW.toISOString(),
    data: entries.flatMap((entry) =>
      entry.arrivals.map((eta, i) => ({
        co: 'KMB',
        route: entry.route,
        dir: 'O',
        service_type: 1,
        seq: 1,
        dest_en: 'EAST TERMINUS',
        dest_tc: '東總站',
        dest_sc: '东总站',
        eta_seq: i + 1,
        eta,
        rmk_en: 'Scheduled Bus',
        rmk_tc: '預定班次',
        rmk_sc: '预定班次',
        data_timestamp: NOW.toISOString(),
      })),
    ),
  }
}

const realFetch = globalThis.fetch
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** Publish a complete build into the test KV/R2, so the shard reads the production dataset tier. */
beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === DATASET_URL) return jsonResponse(datasetJson())
    throw new Error(`unexpected fetch during seed: ${url}`)
  }) as typeof fetch

  const index = await fetchConsolidatedIndex()
  const kv = env.DATASET as KVNamespace
  for (const id of allPlaceIds(index)) {
    await kv.put(datasetKeys.place(HASH, id), JSON.stringify(placeDocFor(index, id)))
  }
  const aliases = allAliases(index)
  for (const [stopId, placeId] of aliases) {
    await kv.put(datasetKeys.alias(HASH, stopId), placeId)
  }
  for (const id of allRouteIds(index)) {
    await kv.put(datasetKeys.route(HASH, id), JSON.stringify(routeDocFor(index, id)))
  }
  for (const [cell, entries] of allGeoCells(index)) {
    await kv.put(datasetKeys.cell(HASH, cell), JSON.stringify(entries))
  }
  const manifest: BuildManifest = {
    hash: HASH,
    sourceHash: 'seed',
    builtAt: '2026-07-27T00:00:00.000Z',
    counts: {
      places: allPlaceIds(index).length,
      aliases: aliases.size,
      routes: allRouteIds(index).length,
      cells: allGeoCells(index).size,
      stops: index.stops.length,
    },
  }
  await kv.put(datasetKeys.current, JSON.stringify(manifest))
  globalThis.fetch = realFetch
})

/** Every client socket this test opened, so nothing is left subscribed for the next one. */
let opened: WebSocket[] = []

beforeEach(async () => {
  resetBoards()
  resetEtaCache()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const board = KMB_STOP_ETA.exec(url)
    if (board?.[1]) return jsonResponse(boardJson(board[1]))
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
  await resetShards()
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
  await resetShards()
  globalThis.fetch = realFetch
})

/**
 * Wipe every shard.
 *
 * Necessary because a Durable Object's *name* here is derived from the target set (that is D4), so two
 * cases watching the same stop deliberately land on the same object — and neither instances nor their
 * storage are reset between `it()` blocks by the pool. Cloudflare's own fixtures dodge this with a
 * random name per test, which is not available to a design whose whole point is that the name is a
 * function of the data.
 */
async function resetShards(): Promise<void> {
  for (let shard = 0; shard < LIVE_SHARD_COUNT; shard++) {
    const stub = env.ETA_HUB?.getByName(liveShardName(shard))
    if (!stub) continue
    await runInDurableObject(stub, async (_instance: EtaHub, state) => {
      for (const ws of state.getWebSockets()) ws.close(1000, 'test reset')
      await state.storage.deleteAlarm()
      state.storage.sql.exec('DELETE FROM readings')
      state.storage.kv.delete('unchangedRounds')
    })
  }
}

// ── Driving the socket ──────────────────────────────────────────────────────────────────────────

async function get(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`, init), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

const liveUrl = (targets: string[]): string =>
  `${LIVE_PATH}?targets=${encodeURIComponent(targets.join(','))}`

/**
 * Recursively sort object keys so two structurally identical payloads serialize identically. Needed
 * because `parse()` rebuilds objects in *schema* declaration order while the shard emits them in
 * construction order — without this the conformance comparison would fail on key order and report an
 * undocumented field when nothing is wrong.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}

interface FrameReader {
  /** Everything received so far. Throws if any frame failed conformance. */
  all(): ServerFrame[]
  /** Wait until at least `n` frames have arrived, or fail loudly. */
  take(n: number): Promise<ServerFrame[]>
  /** Forget what has arrived so far, so the next assertion is about the next round only. */
  drain(): void
}

/**
 * Read frames off a client socket, **validating every one of them against `ServerFrameSchema`.**
 *
 * Frame conformance is therefore not one test but a property of the whole file: any frame this shard
 * emits, in any case below, has to satisfy the published schema and carry nothing the schema does not
 * describe. The second half matters as much as the first — `z.object()` *strips* unknown keys, so
 * `parse()` alone would accept a frame with an extra field and silently discard it, and an undocumented
 * field is drift in the direction that hurts most: the data exists, this app reads it, and no generated
 * native client can see it because it never reached `asyncapi.json`.
 *
 * Failures are collected rather than thrown, because a throw inside a `message` listener is swallowed by
 * the event loop and would turn a red test green.
 */
function readFrames(ws: WebSocket): FrameReader {
  let frames: ServerFrame[] = []
  const problems: string[] = []
  let wake: (() => void) | null = null

  ws.addEventListener('message', (event: MessageEvent) => {
    const text =
      typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      problems.push(`not JSON: ${text}`)
      return
    }
    const parsed = ServerFrameSchema.safeParse(raw)
    if (!parsed.success) {
      problems.push(
        `frame does not satisfy ServerFrameSchema: ${text}\n${JSON.stringify(parsed.error.issues)}`,
      )
      return
    }
    if (JSON.stringify(canonical(parsed.data)) !== JSON.stringify(canonical(raw))) {
      problems.push(`frame carries a field ServerFrame does not describe: ${text}`)
      return
    }
    frames.push(parsed.data)
    wake?.()
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
        await new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, 25)
        })
        wake = null
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

/** Let any in-flight frame land. Used only where the assertion is that *nothing* arrives. */
const settle = (ms = 100): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function connect(targets: string[]): Promise<{ ws: WebSocket; frames: FrameReader }> {
  const res = await get(liveUrl(targets), { headers: { Upgrade: 'websocket' } })
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

/**
 * Connect and wait for the first round to land — snapshot, `live`, and the delta that fills the
 * readings in.
 *
 * The third frame arrives **without this test driving an alarm**, and that is worth stating because it
 * cost a debugging pass to notice: a subscriber that names a target this shard has never polled pulls the
 * alarm forward to *now*, and an alarm set to now fires on its own. So `runDurableObjectAlarm` returned
 * `false` for the first round — nothing was armed any more, because the round had already happened —
 * which is the shard behaving exactly as designed and the harness expecting the wrong thing. Later rounds
 * are armed 45–60 s out and never self-fire, which is what makes `runRound` deterministic from here on.
 */
async function connectAndPoll(
  targets: string[],
): Promise<{ ws: WebSocket; frames: FrameReader; first: ServerFrame[] }> {
  const connection = await connect(targets)
  const first = await connection.frames.take(3)
  return { ...connection, first }
}

const shardFor = (targets: string[]): number =>
  liveShardFor(targets.map((stopId): WatchTarget => ({ stopId })))

const stubFor = (targets: string[]) =>
  (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(liveShardName(shardFor(targets)))

/** Fire whatever alarm is armed on this target set's shard, from a cold upstream cache. */
async function runRound(targets: string[]): Promise<boolean> {
  resetEtaCache()
  return runDurableObjectAlarm(stubFor(targets))
}

const alarmOf = (targets: string[]): Promise<number | null> =>
  runInDurableObject(stubFor(targets), (_instance: EtaHub, state) => state.storage.getAlarm())

/**
 * The cadence the shard just installed, in whole seconds.
 *
 * `nextLiveCadenceMs` ramps 45 → 50 → 55 → 60 s in 5 s steps, so reading the remaining time and
 * allowing ±2.5 s identifies the step uniquely while tolerating however long the round took.
 */
function expectCadence(alarmAt: number | null, expectedMs: number): void {
  expect(alarmAt, 'no alarm was armed').not.toBeNull()
  const remaining = (alarmAt as number) - Date.now()
  expect(
    remaining,
    `expected the ${expectedMs / 1000}s cadence, got ${Math.round(remaining / 1000)}s`,
  ).toBeGreaterThan(expectedMs - 2_500)
  expect(remaining).toBeLessThanOrEqual(expectedMs)
}

function only<T extends ServerFrame['type']>(
  frames: readonly ServerFrame[],
  type: T,
): Array<Extract<ServerFrame, { type: T }>> {
  return frames.filter((f): f is Extract<ServerFrame, { type: T }> => f.type === type)
}

/** Two poles of one merged place, each served by its own route. */
const POLE_A = poles[0] as (typeof poles)[number]
const POLE_B = poles[1] as (typeof poles)[number]
/** A pole of a *different* place, so a failure can be scoped to one target. */
const POLE_C = poles[2] as (typeof poles)[number]

const routeIdOf = (pole: (typeof poles)[number]): string => `KMB:${pole.route}:outbound:1`

// ── 1. Connect ──────────────────────────────────────────────────────────────────────────────────

describe('connecting', () => {
  it('answers the upgrade with a snapshot whose targets echo the accepted set', async () => {
    const { frames } = await connect([POLE_A.id])
    const received = await frames.take(2)

    const snapshot = only(received, 'snapshot')[0]
    expect(snapshot, 'the first frame must be a snapshot').toBeDefined()
    expect(snapshot?.seq).toBe(1)
    expect(snapshot?.targets).toEqual([{ stopId: POLE_A.id }])
    // A cold shard holds no readings yet, and says so honestly rather than inventing any. The round
    // below is what fills them in — and the alarm was pulled forward to *now* precisely because this
    // subscriber named a target the shard had never polled.
    expect(snapshot?.etas).toEqual([])
    // Data frame first, then how much of it to trust: a `status` carrying `state: 'live'` is what moves
    // the client's session out of `connecting`, and it comes second on purpose.
    expect(only(received, 'status')[0]?.state).toBe('live')
    expect(only(received, 'status')[0]?.error).toBeUndefined()
  })

  it('fills the snapshot from storage once the shard has readings', async () => {
    await connectAndPoll([POLE_A.id])

    // A second subscriber for the same place lands on the same shard (D4) and is served from the
    // document the round wrote — this is the invariant every delta depends on: the stored readings are
    // exactly what a subscriber has been told.
    const second = await connect([POLE_A.id])
    const snapshot = only(await second.frames.take(2), 'snapshot')[0]
    expect(snapshot?.etas.length).toBeGreaterThan(0)
    expect(snapshot?.etas.map((eta) => eta.stopId).sort()).toEqual([POLE_A.id, POLE_B.id])
    // Canonical `(stopId, routeId)` order, which is what makes the poll emulator and the socket produce
    // identical listener output (D1).
    const keys = (snapshot?.etas ?? []).map((eta) => `${eta.stopId}|${eta.routeId}`)
    expect(keys).toEqual([...keys].sort())
  })
})

// ── 2 & 3. Rounds ───────────────────────────────────────────────────────────────────────────────

describe('an alarm round', () => {
  it('sends nothing at all when nothing changed', async () => {
    // Round one is news by definition — it is the first time these readings exist.
    const { frames } = await connectAndPoll([POLE_A.id])
    frames.drain()

    // Round two asks upstream again and gets the identical board back. `observedAt` differs (it is
    // stamped per fetch) and is excluded from `sameReading` for exactly this reason, so there is no
    // news — and a shard on the 20:1 message meter sends no empty `delta` and no heartbeat.
    expect(await runRound([POLE_A.id])).toBe(true)
    await settle()
    expect(frames.all(), 'an unchanged round must send nothing').toEqual([])

    // THE CONTROL, in the same test and through the same reader: without it "nothing arrived" would
    // also pass for a socket that had stopped listening, which is the failure this repo keeps hitting.
    boards.set(POLE_A.rawId, [{ route: POLE_A.route, arrivals: [at(6), at(9)] }])
    expect(await runRound([POLE_A.id])).toBe(true)
    expect(only(await frames.take(1), 'delta').length).toBe(1)
  })

  it('sends exactly one delta carrying only the reading that changed', async () => {
    const { frames, first } = await connectAndPoll([POLE_A.id])
    expect(only(first, 'delta')[0]?.changed.length, 'both poles of the place report').toBe(2)
    frames.drain()

    boards.set(POLE_A.rawId, [{ route: POLE_A.route, arrivals: [at(2), at(8)] }])
    expect(await runRound([POLE_A.id])).toBe(true)
    const received = await frames.take(1)
    await settle()

    expect(received.length, 'one delta, not one per reading').toBe(1)
    const delta = only(frames.all(), 'delta')[0]
    expect(delta?.gone).toEqual([])
    expect(delta?.changed.map((eta) => eta.stopId)).toEqual([POLE_A.id])
    expect(delta?.changed[0]?.arrivals[0]).toBe(at(2))
    // Monotonic: snapshot 1, first delta 2, this one 3.
    expect(delta?.seq).toBe(3)
  })

  it('reports a route that disappears upstream in `gone`', async () => {
    const { frames } = await connectAndPoll([POLE_A.id])
    frames.drain()

    // The bus left and the board no longer lists the route. Without `gone` its last reading would sit
    // on the screen for ever, ageing silently — the dishonesty ADR-008 forbids, which is why D2 put the
    // list in the frame.
    boards.set(POLE_B.rawId, [])
    expect(await runRound([POLE_A.id])).toBe(true)
    const delta = only(await frames.take(1), 'delta')[0]
    expect(delta?.changed).toEqual([])
    expect(delta?.gone).toEqual([{ stopId: POLE_B.id, routeId: routeIdOf(POLE_B) }])
  })

  it('widens the cadence as rounds stay quiet', async () => {
    // Round one changes everything (the readings are new), so the ramp stays at the floor.
    await connectAndPoll([POLE_A.id])
    expectCadence(await alarmOf([POLE_A.id]), 45_000)
    // One quiet round, one step: 45 → 50 s. The step exists because a pole that has said nothing is
    // likely to keep saying nothing, while the measured upstream refresh interval (~45 s) is the floor.
    expect(await runRound([POLE_A.id])).toBe(true)
    expectCadence(await alarmOf([POLE_A.id]), 50_000)
    expect(await runRound([POLE_A.id])).toBe(true)
    expectCadence(await alarmOf([POLE_A.id]), 55_000)
  })
})

// ── 5 & 6. Rejections and failures ──────────────────────────────────────────────────────────────

describe('targets it will not or cannot watch', () => {
  it('drops a malformed target, names it, and keeps serving the others', async () => {
    const { first: received } = await connectAndPoll([POLE_A.id, 'not-an-id'])

    const snapshot = only(received, 'snapshot')[0]
    expect(snapshot?.targets, 'the echo is how a client learns a favourite was dropped').toEqual([
      { stopId: POLE_A.id },
    ])

    const status = only(received, 'status')[0]
    // `retryable: false` is what lets a Widget prune the favourite instead of retrying it on the
    // rider's battery for ever, and `state: 'live'` is what says the rest of the subscription is fine.
    // The two fields answer different questions: `state` describes the connection, `error` describes the
    // thing the message names.
    expect(status?.state).toBe('live')
    expect(status?.error?.code).toBe('bad_request')
    expect(status?.error?.retryable).toBe(false)
    expect(status?.error?.message).toContain('not-an-id')

    // …and the surviving target really does keep working: the round that ran alongside the rejection
    // delivered both of its place's readings.
    expect(only(received, 'delta')[0]?.changed.length).toBe(2)
  })

  it('says a subscription with nothing left is closed, permanently', async () => {
    // Every target rejected. The upgrade itself is refused when *nothing* in the URL parses (see the
    // routing tests), so this arrives as a `subscribe` frame — the path a client takes when its saved
    // favourites have all aged out of the id scheme.
    const { ws, frames } = await connectAndPoll([POLE_A.id])
    frames.drain()

    ws.send(JSON.stringify({ type: 'subscribe', targets: [{ stopId: 'nonsense' }] }))
    const received = await frames.take(2)
    expect(only(received, 'snapshot')[0]?.targets).toEqual([])
    expect(only(received, 'snapshot')[0]?.etas).toEqual([])
    const status = only(received, 'status')[0]
    // `closed` **with** a permanent error is how a shard says "this subscription will never work", which
    // is the one case the socket transport is entitled to stop reconnecting on.
    expect(status?.state).toBe('closed')
    expect(status?.error?.retryable).toBe(false)

    // Nothing left to poll, so no alarm: an idle shard with no alarm hibernates and costs nothing.
    expect(await alarmOf([POLE_A.id])).toBeNull()
  })

  it('reports a per-target upstream failure as retrying, and leaves the other targets alive', async () => {
    // A dataset read that fails for **one** target and not the others — the only way to get a genuinely
    // per-target `upstream_unavailable` out of this stack, because the pole-level upstream calls go
    // through `coalesce`, which resolves a failure to an empty list (see the finding in the report).
    const kv = env.DATASET as KVNamespace
    const placeId = (await kv.get(datasetKeys.alias(HASH, POLE_C.id), 'text')) as string
    const saved = (await kv.get(datasetKeys.place(HASH, placeId), 'text')) as string
    expect(saved, 'the fixture must have a place document to corrupt').toBeTruthy()

    const { frames, first } = await connectAndPoll([POLE_A.id, POLE_C.id])
    // Both targets started with readings, which is what makes the survival claim below meaningful.
    expect(only(first, 'delta')[0]?.changed.length).toBe(4)
    frames.drain()

    await kv.put(datasetKeys.place(HASH, placeId), '{ not json')
    // …and something *does* change on the healthy target, so the round has a delta to carry and the two
    // halves can be told apart.
    boards.set(POLE_A.rawId, [{ route: POLE_A.route, arrivals: [at(3), at(8)] }])
    try {
      expect(await runRound([POLE_A.id, POLE_C.id])).toBe(true)
      const received = await frames.take(2)

      const status = only(received, 'status').find((frame) => frame.error !== undefined)
      expect(status?.state).toBe('retrying')
      expect(status?.error?.code).toBe('upstream_unavailable')
      expect(status?.error?.retryable).toBe(true)

      const delta = only(received, 'delta')[0]
      expect(delta?.changed.map((eta) => eta.stopId)).toEqual([POLE_A.id])
      // **The load-bearing half.** The failed target's readings are still there and appear in nothing:
      // not in `changed`, and above all not in `gone`. A target we could not *ask* about has not
      // departed, and saying it had would tell the rider the bus left because our own read failed.
      expect(delta?.gone).toEqual([])
      const stored = await runInDurableObject(
        stubFor([POLE_A.id, POLE_C.id]),
        (_i: EtaHub, state) =>
          state.storage.sql
            .exec<{ target: string; etas: string }>('SELECT target, etas FROM readings')
            .toArray(),
      )
      const kept = stored.find((row) => row.target === POLE_C.id)
      expect((JSON.parse(kept?.etas ?? '[]') as Eta[]).length, 'previous readings retained').toBe(2)
    } finally {
      await kv.put(datasetKeys.place(HASH, placeId), saved)
    }
  })

  it('rejects targets past the per-connection cap rather than truncating them silently', async () => {
    const asked = poles.slice(0, LIVE_MAX_TARGETS_PER_CONNECTION + 3).map((pole) => pole.id)
    const { frames } = await connect(asked)
    const received = await frames.take(2)
    frames.drain()

    const snapshot = only(received, 'snapshot')[0]
    expect(snapshot?.targets.length).toBe(LIVE_MAX_TARGETS_PER_CONNECTION)
    const status = only(received, 'status')[0]
    expect(status?.error?.code).toBe('bad_request')
    expect(status?.error?.retryable).toBe(false)
    // Named, not merely absent: an unbounded `subscribe` frame is the same remote amplification the
    // `radius` clamp exists for, and a client that reads the echo can tell it asked for too much.
    for (const dropped of asked.slice(LIVE_MAX_TARGETS_PER_CONNECTION)) {
      expect(status?.error?.message).toContain(dropped)
    }
  })
})

// ── 7. Teardown ─────────────────────────────────────────────────────────────────────────────────

describe('the last socket closing', () => {
  it('leaves no alarm scheduled at all', async () => {
    const { ws } = await connectAndPoll([POLE_A.id])
    // Asserted, not inferred: an armed alarm before, none after.
    expect(await alarmOf([POLE_A.id])).not.toBeNull()

    ws.close(1000, 'done')

    // `webSocketClose` runs asynchronously, so poll to a deadline rather than guessing a delay.
    const deadline = Date.now() + 5_000
    let alarm = await alarmOf([POLE_A.id])
    while (alarm !== null && Date.now() < deadline) {
      await settle(50)
      alarm = await alarmOf([POLE_A.id])
    }
    // No subscribers means no alarm — that, plus hibernation, is what makes an idle shard free. A shard
    // that kept ticking would pay a billed request and a metered `setAlarm` row every 45 s to discover
    // that nobody is listening.
    expect(alarm, 'a shard with no subscribers must hold no alarm').toBeNull()
    // …and it forgets its readings, so a rider who re-subscribes gets an honest empty snapshot rather
    // than whatever was true whenever the stop was last watched.
    const rows = await runInDurableObject(stubFor([POLE_A.id]), (_i: EtaHub, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS n FROM readings').one(),
    )
    expect(rows.n).toBe(0)
  })
})

// ── 8. Hibernation ──────────────────────────────────────────────────────────────────────────────

describe('surviving an instance teardown', () => {
  it('rebuilds the subscription from the attachment and the ramp from storage, on a cold instance', async () => {
    // **What this test does and does not prove, plainly.** It cannot prove workerd *chose* to hibernate:
    // there is no local inactivity knob and nothing hibernates spontaneously inside a test. What
    // `evictDurableObject(stub, { webSockets: 'hibernate' })` does is tear the instance down while
    // preserving durable storage and hibernating (not closing) the sockets — the same destruction
    // production hibernation performs. So this covers the *consequence* of hibernation, which is the part
    // that breaks: a shard whose subscriber set lived in an instance field would wake up with no
    // subscribers, and one whose quiet-round counter lived in a field would restart its ramp at the floor
    // for ever. Both are asserted below on an instance that did not exist when the socket was opened.
    const { frames } = await connectAndPoll([POLE_A.id])
    expect(await runRound([POLE_A.id])).toBe(true) // one quiet round: the ramp is at 50 s
    expectCadence(await alarmOf([POLE_A.id]), 50_000)
    frames.drain()

    await evictDurableObject(stubFor([POLE_A.id]), { webSockets: 'hibernate' })

    // The socket is still attached to a *new* instance, and its subscription came out of the attachment
    // — there is nowhere else it could have come from, because this class holds no fields.
    const restored = await runInDurableObject(stubFor([POLE_A.id]), (_i: EtaHub, state) => {
      const sockets = state.getWebSockets()
      return sockets.map((ws) => ws.deserializeAttachment() as { targets: WatchTarget[] })
    })
    expect(restored.length).toBe(1)
    expect(restored[0]?.targets).toEqual([{ stopId: POLE_A.id }])

    // A round on the cold instance continues the ramp from storage — 55 s, not the 45 s floor a fresh
    // counter would give.
    expect(await runRound([POLE_A.id])).toBe(true)
    expectCadence(await alarmOf([POLE_A.id]), 55_000)

    // …and the hibernated socket still receives frames, which is what makes the two assertions above
    // more than bookkeeping.
    boards.set(POLE_A.rawId, [{ route: POLE_A.route, arrivals: [at(1), at(7)] }])
    expect(await runRound([POLE_A.id])).toBe(true)
    const delta = only(await frames.take(1), 'delta')[0]
    expect(delta?.changed.map((eta) => eta.stopId)).toEqual([POLE_A.id])
  })

  it('handles a client frame through the hibernation handler, not an in-memory listener', async () => {
    // This one *can* be proven outright, and it is the property hibernation actually depends on: the
    // shard calls `ctx.acceptWebSocket(server)` and registers no `'message'` listener anywhere, so a
    // frame that is answered at all can only have been dispatched to `webSocketMessage()`. Registering a
    // listener instead — `server.accept()` — is one of the enumerated conditions that blocks hibernation
    // and would bill the object for the whole time the socket is open.
    const { ws, frames } = await connectAndPoll([POLE_A.id])
    frames.drain()

    // A keepalive whose bytes do **not** match `LIVE_PING_MESSAGE` (note the space), so the runtime's
    // auto-response cannot answer it and it must reach the handler. That is also the drift this pair of
    // constants exists to prevent: with matching bytes the reply costs nothing and never wakes the shard.
    ws.send('{"type": "ping"}')
    const received = await frames.take(1)
    expect(received[0]?.type).toBe('pong')

    await runInDurableObject(stubFor([POLE_A.id]), (_i: EtaHub, state) => {
      expect(state.getWebSockets().length).toBe(1)
      // The auto-response pair really is installed, and with the exact bytes both ends read from the
      // contract — a getter, not `getRequest()`, which the docs describe and the installed types do not
      // declare.
      expect(state.getWebSocketAutoResponse()?.request).toBe('{"type":"ping"}')
      expect(state.getWebSocketAutoResponse()?.response).toBe('{"type":"pong"}')
    })
  })
})

// ── 9. Shard routing ────────────────────────────────────────────────────────────────────────────

describe('shard routing', () => {
  it('is deterministic, and identical target sets land on one shard', async () => {
    const expected = shardFor([POLE_A.id])
    // Same set, opposite order. `acceptTargets` canonicalises before `liveShardFor` hashes, so the two
    // clients must share a shard — that is the case the whole design is for, since a stop is hot exactly
    // when many people are watching it and they should share one upstream poll.
    const first = await connect([POLE_A.id, POLE_C.id])
    await first.frames.take(2)
    const second = await connect([POLE_C.id, POLE_A.id])
    await second.frames.take(2)
    expect(shardFor([POLE_A.id, POLE_C.id])).toBe(shardFor([POLE_C.id, POLE_A.id]))

    const counts: number[] = []
    for (let shard = 0; shard < LIVE_SHARD_COUNT; shard++) {
      const stub = (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(liveShardName(shard))
      counts.push(
        await runInDurableObject(stub, (_i: EtaHub, state) => state.getWebSockets().length),
      )
    }
    const both = shardFor([POLE_A.id, POLE_C.id])
    expect(counts[both], 'both sockets on one shard').toBe(2)
    expect(
      counts.reduce((sum, n) => sum + n, 0),
      'and nowhere else — the other shards hold nothing',
    ).toBe(2)
    // The lowest accepted id decides the shard, so a set whose lowest id is the same lands with them.
    expect(both).toBe(expected)

    // The name is `live-<n>` and the object knows it, which is what lets a shard recover its own key
    // inside `alarm()` with no caller to ask.
    const name = await runInDurableObject(
      (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(liveShardName(both)),
      (_i: EtaHub, state) => state.id.name,
    )
    expect(name).toBe(liveShardName(both))
  })

  it('spreads different interests across shards', async () => {
    // Not a claim about balance — 8 shards and a 32-bit hash — but a claim that the shard is a function
    // of the *data*: two disjoint interests that hash differently must not share an object, or a hot
    // stop's poll would be duplicated for no reason.
    const sets = poles.map((pole) => [pole.id])
    const shards = new Set(sets.map((set) => shardFor(set)))
    expect(
      shards.size,
      'the fixture must reach more than one shard or this asserts nothing',
    ).toBeGreaterThan(1)

    const a = sets.find((set) => shardFor(set) === [...shards][0]) as string[]
    const b = sets.find((set) => shardFor(set) === [...shards][1]) as string[]
    const first = await connect(a)
    await first.frames.take(2)
    const second = await connect(b)
    await second.frames.take(2)

    for (const set of [a, b]) {
      expect(
        await runInDurableObject(stubFor(set), (_i: EtaHub, state) => state.getWebSockets().length),
      ).toBe(1)
    }
    // The two objects really are two objects.
    const ids = (await listDurableObjectIds(env.ETA_HUB as NonNullable<typeof env.ETA_HUB>)).map(
      (id) => id.toString(),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ── 10. The HTTP surface of `/v1/live` ──────────────────────────────────────────────────────────

async function expectTaxonomy(res: Response, code: string, retryable: boolean): Promise<void> {
  const body = (await res.json()) as { code: string; retryable: boolean; message: string }
  expect(body.code, `${res.status}: ${body.message}`).toBe(code)
  expect(body.retryable).toBe(retryable)
  expect(res.headers.get('cache-control')).toBe('no-store')
}

describe('the /v1/live request itself', () => {
  it('answers a non-upgrade GET with the taxonomy, not a bare status', async () => {
    const res = await get(liveUrl([POLE_A.id]))
    // 400 and not 426: no member of `ERROR_CODES` carries 426, and inventing one is a contract change.
    // `bad_request` carries the meaning that matters — the caller must change the request, and asking
    // again will not help — which is the property ADR-064 binds the status to.
    expect(res.status).toBe(400)
    await expectTaxonomy(res, 'bad_request', false)
    // Readable cross-origin, because a non-upgrade GET really is an ordinary CORS request.
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('refuses a request with no targets, and one whose targets are all unwatchable', async () => {
    await expectTaxonomy(
      await get(LIVE_PATH, { headers: { Upgrade: 'websocket' } }),
      'bad_request',
      false,
    )
    // Refused before a stub exists, on the kernel's own instruction: an empty accepted set hashes the
    // empty string, so every such client would pile onto one object.
    await expectTaxonomy(
      await get(liveUrl(['nonsense']), { headers: { Upgrade: 'websocket' } }),
      'bad_request',
      false,
    )
  })

  it('tolerates the Upgrade header’s case and whitespace, and refuses a multi-token value', async () => {
    // Both halves are what the *runtime* does, measured rather than assumed — see `isUpgrade`. A native
    // client sending `Upgrade: WebSocket` must connect; a legal-but-multi-token `websocket, h2c` must be
    // refused **here**, because workerd will not attach a `webSocket` to the response for it and the only
    // alternative is an unhandled `TypeError` and a 500.
    const cased = await get(liveUrl([POLE_A.id]), { headers: { Upgrade: ' WebSocket ' } })
    expect(cased.status).toBe(101)
    cased.webSocket?.accept()
    if (cased.webSocket) opened.push(cased.webSocket)

    const multi = await get(liveUrl([POLE_A.id]), { headers: { Upgrade: 'websocket, h2c' } })
    expect(multi.status, 'a multi-token Upgrade must fail as a 400, never as a 500').toBe(400)
    await expectTaxonomy(multi, 'bad_request', false)
  })

  it('allows a missing Origin always, and filters browser origins only when configured', async () => {
    // A WebSocket upgrade does not honour CORS at all, so this is RFC 6455's origin model and nothing
    // else. A missing `Origin` is what every native client sends, so refusing it would break exactly the
    // clients this design exists for while protecting nothing — an `Origin` check is a browser-only,
    // advisory anti-CSWSH measure and is never authorisation.
    const unset = await liveUpgrade(
      new Request(`https://edge.test${liveUrl([POLE_A.id])}`, {
        headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
      }),
      env,
      {},
    )
    expect(unset.status, 'unset LIVE_ALLOWED_ORIGINS means no filtering, and says so').toBe(101)
    unset.webSocket?.accept()
    if (unset.webSocket) opened.push(unset.webSocket)

    const configured = { ...env, LIVE_ALLOWED_ORIGINS: 'https://app.example, https://nextbus.hk' }
    const refused = await liveUpgrade(
      new Request(`https://edge.test${liveUrl([POLE_A.id])}`, {
        headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
      }),
      configured,
      {},
    )
    await expectTaxonomy(refused, 'bad_request', false)

    const allowed = await liveUpgrade(
      new Request(`https://edge.test${liveUrl([POLE_A.id])}`, {
        headers: { Upgrade: 'websocket', Origin: 'https://nextbus.hk' },
      }),
      configured,
      {},
    )
    expect(allowed.status).toBe(101)
    allowed.webSocket?.accept()
    if (allowed.webSocket) opened.push(allowed.webSocket)

    const native = await liveUpgrade(
      new Request(`https://edge.test${liveUrl([POLE_A.id])}`, {
        headers: { Upgrade: 'websocket' },
      }),
      configured,
      {},
    )
    expect(native.status, 'a native client sends no Origin and must still connect').toBe(101)
    native.webSocket?.accept()
    if (native.webSocket) opened.push(native.webSocket)
  })

  it('degrades to the poll transport when there is no Durable Object binding', async () => {
    // ADR-055's promise, one capability over: a Worker with no `ETA_HUB` still runs, `/v1/live` says so
    // permanently, and every client keeps working on the default engine. Exercised by handing the router
    // an `Env` without the binding, because a `wrangler.toml` cannot be unbound inside a running test.
    const res = await liveUpgrade(
      new Request(`https://edge.test${liveUrl([POLE_A.id])}`, {
        headers: { Upgrade: 'websocket' },
      }),
      { ...env, ETA_HUB: undefined },
      {},
    )
    expect(res.status).toBe(404)
    await expectTaxonomy(res, 'not_found', false)
  })
})

// ── Frame conformance, summarised ───────────────────────────────────────────────────────────────

describe('frame conformance', () => {
  it('emits every server frame type, and every frame satisfies ServerFrameSchema', async () => {
    // `readFrames` validates *every* frame in this file against the published schema and rejects any
    // field the schema does not describe — the second half matters because `z.object()` strips unknown
    // keys, so `parse()` alone would accept and silently discard an undocumented field. This case exists
    // so that property is not vacuous: it drives one scenario that produces all four frames the shard
    // can send.
    const { ws, frames } = await connectAndPoll([POLE_A.id, 'not-an-id']) // snapshot + status + delta
    ws.send('{"type": "ping"}')
    await frames.take(4) // pong

    const seen = new Set(frames.all().map((frame) => frame.type))
    const declared = new Set<ServerFrame['type']>(['snapshot', 'delta', 'status', 'pong'])
    expect([...declared].filter((type) => !seen.has(type))).toEqual([])
  })

  it('builds its readings from the same lists /v1/etas serves, canonical pole id and all', async () => {
    // The `Eta.stopId` fix (commit 6197cea) is what makes a `delta`'s `(stopId, routeId)` identity match
    // anything at all — every reader of the pair compares it against a canonical pole id. The shard
    // inherits it because it polls through `stopEtas`, and this asserts the inheritance rather than
    // assuming it: the frames' readings are the HTTP endpoint's readings.
    const { first } = await connectAndPoll([POLE_A.id])
    const delta = only(first, 'delta')[0]

    resetEtaCache()
    const http = (await (await get(`/v1/etas/${encodeURIComponent(POLE_A.id)}`)).json()) as Eta[]
    const key = (eta: Eta) => `${eta.stopId}|${eta.routeId}`
    expect((delta?.changed ?? []).map(key).sort()).toEqual(http.map(key).sort())
    expect(http.length).toBeGreaterThan(0)
  })
})
