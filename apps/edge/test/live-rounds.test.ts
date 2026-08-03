// The **server** driver for the cross-runtime scenario corpus (WP5-5, ADR-074).
//
// Its twin is `packages/api-client/test/live-rounds.test.ts`, which runs the identical rows through the
// poll emulator. Neither owns the expectations: `@nextbus/core/fixtures/live-rounds.json` does. Read
// that file's header first — it states which three rules are under test, why they are implemented twice,
// and why the assertion is *what a listener holds when a round settles* rather than a frame transcript.
//
// This side is as real as it gets short of a deployment: the actual Worker, the actual `EtaHub` Durable
// Object, an actual `WebSocket` from an actual 101, actual KV, and every frame reduced by the actual
// kernel reducer the app uses. What is stubbed is one thing — the upstream operator board — which is the
// only thing a row describes.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THE CLIENT'S CONTROLLER IS REIMPLEMENTED HERE IN FOUR LINES
// ────────────────────────────────────────────────────────────────────────────────────────────────
// `layers.json` gives `server` the dirs `["apps/edge"]` — tests included — and `use: [contract, kernel,
// ports, adapters]`. `@nextbus/api-client` is not on that list and is not even a dependency of
// `@nextbus/edge`, so `createLiveEtaController` cannot be imported here and `pnpm boundaries` is right to
// forbid it. What *can* be imported is the kernel, which is where the whole client-side protocol lives:
// `applyLiveFrame` is the reducer, and the controller is a `for` loop over it plus a resync. So the
// reduction below is not a reimplementation of a rule — it is the same function, called the same way.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT "SILENT" MEANS ON THIS SIDE, STATED BEFORE IT IS ASSERTED
// ────────────────────────────────────────────────────────────────────────────────────────────────
// The client driver advances its own cadence, so "the round emitted nothing" is decidable there. Here a
// frame arrives over a socket, so silence is a claim about a *window* — the same limit `eta-hub.test.ts`
// states for itself. Two things make it a real assertion rather than a hope:
//
//   · **The window is bounded by an observed event, not by a sleep.** `settle()` waits until the frame
//     count has stopped moving for `QUIET_MS`, so a round that produced frames is never mistaken for a
//     silent one however slow it was; only the converse — a frame later than `QUIET_MS` after the last
//     one — could mislead, and nothing in this object defers a send.
//   · **Every `silent` row is followed, in the same scenario and through the same reader, by a round
//     that is not silent** (the fixture requires it and the control below asserts it). A reader that had
//     simply stopped listening reports `silent` for the rest of the row and goes red.

import {
  createExecutionContext,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { LIVE_PATH, ServerFrameSchema } from '@nextbus/contract'
import {
  applyLiveFrame,
  LIVE_SESSION_START,
  LIVE_SHARD_COUNT,
  type LiveSession,
  liveShardFor,
  type ServerFrame,
  type StopDetail,
  type WatchTarget,
} from '@nextbus/core'
import {
  LIVE_ROUNDS,
  LIVE_ROUNDS_TOPOLOGY,
  type LiveRoundsScenario,
} from '@nextbus/core/fixtures/live-rounds'
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
import worker from '../src/index'
import { liveShardName } from '../src/live'
import { datasetJson, poles } from './fixtures'

// ── Logical → concrete ─────────────────────────────────────────────────────────────────────────
//
// The fixture's `A`/`B`/`C1`/`R1`/`+7` become ids that exist in the seeded dataset. The client driver
// has its own table pointing at ids of its own invention; that the two differ is exactly why the fixture
// cannot name concrete ones.

/**
 * Logical pole → the raw operator stop id of a pole in `./fixtures.ts`.
 *
 * `A` and `B` are **singletons** (`SOLO*`), which the clustering rules keep as one-member places — so a
 * one-pole row really is one board call. `C1`/`C2` are the two members of one cluster (`POLE00`/`POLE01`,
 * 12 m apart, distinct routes, shared landmark name), which is the two-kerb place ADR-072's per-kerb
 * arrival model and ADR-073's per-pole failure model both need. They are 12 m apart, so WP5-11's ≤2 m
 * fold leaves them as two members — asserted below rather than assumed, because a fixture that quietly
 * became one pole would make the per-pole rows prove nothing.
 */
const RAW_OF_POLE: Record<string, string> = { A: 'SOLO0', B: 'SOLO1', C1: 'POLE00', C2: 'POLE01' }
const canonicalPole = (label: string): string => `KMB:${RAW_OF_POLE[label]}`

/** Logical place → the canonical id a client subscribes with. `C`'s `P:` id is read from the dataset. */
const placeIds = new Map<string, string>()

const HASH = 'liverounds01'
const NOW = new Date('2026-07-27T12:00:00+08:00')
const NOW_MS = NOW.getTime()
const at = (minutes: number): string => new Date(NOW_MS + minutes * 60_000).toISOString()
/** `+7` back out of an ISO instant. Robust to reformatting: it compares instants, not strings. */
const minutesFromNow = (iso: string): string =>
  `+${Math.round((Date.parse(iso) - NOW_MS) / 60_000)}`

// ── Upstream, as a per-round fixture ───────────────────────────────────────────────────────────

const DATASET_URL = 'https://data.hkbus.app/routeFareList.min.json'
const KMB_STOP_ETA = /^https:\/\/data\.etabus\.gov\.hk\/v1\/transport\/kmb\/stop-eta\/(.+)$/

/** Raw pole id → what its board does this round: lines, or a refusal. */
const boards = new Map<string, Array<{ route: string; at: string[] }> | 'refused'>()

/**
 * The KMB `stop-eta` envelope, shaped exactly as `fetchKmbStopEta` parses it.
 *
 * `data_timestamp` is **constant across rounds**, deliberately: `sameReading` compares it, so a
 * per-round value would make every round news and "an unchanged round is silent" untestable. The
 * normalizer stamps its own `observedAt` from the real clock, which moves — and that is the half of
 * `sameReading` that must be ignored, so the silence rows are a real test of the exclusion.
 */
function boardJson(entries: Array<{ route: string; at: string[] }>): unknown {
  return {
    generated_timestamp: NOW.toISOString(),
    data: entries.flatMap((entry) =>
      // `offset` is the fixture's `"+7"`; the board serves the instant it denotes, and `minutesFromNow`
      // reads it back out of whatever the normalizer produced.
      entry.at.map((offset, i) => ({
        co: 'KMB',
        route: entry.route,
        dir: 'O',
        service_type: 1,
        seq: 1,
        dest_en: 'EAST TERMINUS',
        dest_tc: '東總站',
        dest_sc: '东总站',
        eta_seq: i + 1,
        eta: at(Number(offset)),
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

  // **The topology is read out of the dataset, never guessed.** A `P:` id is minted by the build from
  // its members in order (ADR-042), so hard-coding one here would break silently the day clustering
  // changed — and the assertions below would still pass while measuring a different place.
  for (const [label, pole] of Object.entries(RAW_OF_POLE)) {
    if (label === 'C2') continue
    const res = await get(`/v1/stop/${encodeURIComponent(`KMB:${pole}`)}`)
    expect(res.status, `seeding ${label}`).toBe(200)
    const detail = (await res.json()) as StopDetail
    const place = label === 'C1' ? 'C' : label
    placeIds.set(place, detail.stop.id)
    // The shape every row depends on: `A`/`B` are one boarding point, `C` is two. If the fixture ever
    // clustered differently, the per-pole rows would silently degrade into per-place ones.
    expect(detail.members.map((m) => m.id).sort(), `${place} members`).toEqual(
      (LIVE_ROUNDS_TOPOLOGY.places[place as 'A' | 'B' | 'C'] as readonly string[])
        .map(canonicalPole)
        .sort(),
    )
  }
})

beforeEach(async () => {
  boards.clear()
  resetEtaCache()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const match = KMB_STOP_ETA.exec(url)
    if (match?.[1]) {
      const answer = boards.get(match[1])
      if (answer === undefined) {
        // A pole no row asked about. Loud rather than empty: a silently empty board would let a
        // mis-mapped id look like a stop with no buses, which is the exact confusion under test.
        throw new Error(`no board configured for ${match[1]}`)
      }
      // What a refusing operator looks like from here. `fetchKmbStopEta` turns a non-ok response into a
      // throw, `stop-route.ts` classifies it `upstream_unavailable` / `retryable: true` off the ADR-064
      // table, and it reaches the wire as an `EtaReport.failed` entry — the code the fixture's
      // `retrying!upstream_unavailable` lines name.
      if (answer === 'refused') return new Response('upstream said no', { status: 502 })
      return jsonResponse(boardJson(answer))
    }
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
 * Wipe every shard between rows.
 *
 * Necessary because a Durable Object's name here is a function of the target set (D4), so two rows
 * watching the same place deliberately land on the same object — and the pool resets neither instances
 * nor their storage between `it()` blocks. A row that inherited the previous row's readings would see a
 * `delta` where the fixture declares a `snapshot`, and the first round of every row would be wrong in a
 * way that depends on file order.
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

// ── Driving the socket ─────────────────────────────────────────────────────────────────────────

async function get(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`, init), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

/** Every client socket a row opened, so nothing stays subscribed into the next one. */
let opened: WebSocket[] = []

/** How long the frame count must hold still before a round is called settled. */
const QUIET_MS = 150

interface FrameReader {
  /** Frames that have arrived since the last `take()`. Throws if any failed conformance. */
  take(): ServerFrame[]
  /** Wait until no new frame has arrived for `QUIET_MS`. See the header on what silence means. */
  settle(): Promise<void>
}

/**
 * Read frames off a client socket, validating each against `ServerFrameSchema` and refusing any field
 * the schema does not describe.
 *
 * The second half matters as much as the first and is the same argument `eta-hub.test.ts` makes:
 * `z.object()` *strips* unknown keys, so `parse()` alone would accept an extra field and discard it —
 * and an undocumented field is drift in the direction that hurts most, because this app would read it
 * and no generated native client could see it. Problems are collected, not thrown: a throw inside a
 * `message` listener is swallowed by the event loop and would turn a red test green.
 */
function readFrames(ws: WebSocket): FrameReader {
  let pending: ServerFrame[] = []
  let received = 0
  const problems: string[] = []

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
      problems.push(`frame does not satisfy ServerFrameSchema: ${text}`)
      return
    }
    if (Object.keys(parsed.data).length !== Object.keys(raw as object).length) {
      problems.push(`frame carries a field ServerFrame does not describe: ${text}`)
      return
    }
    pending.push(parsed.data)
    received += 1
  })

  return {
    take() {
      if (problems.length > 0) throw new Error(problems.join('\n'))
      const out = pending
      pending = []
      return out
    },
    async settle() {
      const deadline = Date.now() + 5_000
      let seen = -1
      while (Date.now() < deadline) {
        seen = received
        await new Promise<void>((resolve) => setTimeout(resolve, QUIET_MS))
        if (received === seen) return
      }
      throw new Error('frames never stopped arriving')
    },
  }
}

const shardStub = (targets: readonly string[]) =>
  (env.ETA_HUB as NonNullable<typeof env.ETA_HUB>).getByName(
    liveShardName(liveShardFor(targets.map((stopId): WatchTarget => ({ stopId })))),
  )

/**
 * One settled line, in the fixture's format. **Duplicated in the client driver, deliberately** — see
 * the note on `settled()` there: the two transcriptions are independent and both are measured against
 * one hand-written list, so a formatter that drifted makes a row red rather than making two engines
 * agree with each other.
 */
function settled(session: LiveSession, labelOf: (id: string) => string): string {
  const state = session.status.error
    ? `${session.status.state}!${session.status.error.code}`
    : session.status.state
  const etas = session.etas.map(
    (e) => `${labelOf(e.stopId)}/${labelOf(e.routeId)}@${e.arrivals.map(minutesFromNow).join(',')}`,
  )
  const watching = session.targets.map((t) => labelOf(t.stopId))
  return `${state} etas=[${etas.join(' ')}] watching=[${watching.join(' ')}]`
}

/** Concrete id → the fixture's label, for every id a row can produce. */
function labeller(scenario: LiveRoundsScenario): (id: string) => string {
  const map = new Map<string, string>()
  for (const place of scenario.targets) {
    map.set(placeIds.get(place) as string, place)
    for (const pole of polesOf(place)) map.set(canonicalPole(pole), pole)
  }
  for (const round of scenario.rounds) {
    for (const answer of Object.values(round.boards)) {
      if (answer === 'refused') continue
      // The id the KMB normalizer mints: `canonicalRouteId('KMB', route, 'outbound', '1')`, which the
      // board stub's `dir: 'O'` + `service_type: 1` determine.
      for (const line of answer) map.set(`KMB:${line.route}:outbound:1`, line.route)
    }
  }
  return (id) => map.get(id) ?? id
}

const polesOf = (label: string): readonly string[] =>
  LIVE_ROUNDS_TOPOLOGY.places[label as keyof typeof LIVE_ROUNDS_TOPOLOGY.places] ?? []

/** Load one round's boards into the upstream fixture. Every pole of every target must be named. */
function loadBoards(scenario: LiveRoundsScenario, round: number): void {
  const declared = scenario.rounds[round]?.boards
  if (!declared) throw new Error(`${scenario.name}: no round ${round}`)
  boards.clear()
  for (const place of scenario.targets) {
    for (const pole of polesOf(place)) {
      const answer = declared[pole]
      if (answer === undefined) {
        throw new Error(`${scenario.name}: round ${round} has no board for pole "${pole}"`)
      }
      boards.set(RAW_OF_POLE[pole] as string, answer)
    }
  }
}

/**
 * Drive one scenario through the real shard and report one line per round.
 *
 * Round 0 is the connect: `subscribe()` answers immediately from stored readings — empty on a shard this
 * suite has just wiped — and pulls the alarm forward to now for a target it has never polled, so the
 * first poll happens without this test firing one. That self-firing round is why `connectAndPoll` in
 * `eta-hub.test.ts` waits for frames rather than calling `runDurableObjectAlarm`, and it is why the
 * first `settle()` here covers the handshake and the first round together — which is exactly the state
 * the client driver's first round settles to.
 */
async function throughShard(scenario: LiveRoundsScenario): Promise<string[]> {
  const labelOf = labeller(scenario)
  const targets = scenario.targets.map((place) => placeIds.get(place) as string)

  loadBoards(scenario, 0)
  const res = await get(`${LIVE_PATH}?targets=${encodeURIComponent(targets.join(','))}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(res.status, `upgrade for ${scenario.name}`).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('a 101 with no webSocket')
  // Listener before `accept()`: the shard sends the snapshot inside the same `fetch` that produced this
  // response, so the frame is already queued.
  const frames = readFrames(ws)
  ws.accept()
  opened.push(ws)

  let session: LiveSession = LIVE_SESSION_START
  const lines: string[] = []
  for (let round = 0; round < scenario.rounds.length; round++) {
    if (round > 0) {
      loadBoards(scenario, round)
      // `resetEtaCache()` is mandatory, not hygiene: `coalesce` holds a pole for 30 s per isolate, so
      // without it round two re-reads round one's board and every change row would report silence.
      resetEtaCache()
      await runDurableObjectAlarm(shardStub(targets))
    }
    await frames.settle()
    const arrived = frames.take()
    let applied = 0
    for (const frame of arrived) {
      const result = applyLiveFrame(session, frame)
      session = result.state
      if (result.applied) applied += 1
      // A gap or a duplicate `seq` would make the client re-subscribe, which no row here should need.
      // Asserted rather than handled: it is a free check that the shard's counter is coherent across a
      // handshake plus N rounds, which is the sequence nothing else drives end to end.
      expect(result.resyncNeeded, `${scenario.name} round ${round}: ${JSON.stringify(frame)}`).toBe(
        false,
      )
    }
    lines.push(applied === 0 ? 'silent' : settled(session, labelOf))
  }
  return lines
}

// ── The assertions ─────────────────────────────────────────────────────────────────────────────

describe('the live rounds corpus, through the real EtaHub over a real socket', () => {
  it('is running against the Durable Object, not around it', () => {
    // The anti-vacuous control this file most needs. Every binding below is optional in `wrangler.toml`
    // (ADR-056: a Worker without the DO still runs and answers the taxonomy on `/v1/live`), so an
    // unbound `ETA_HUB` would make every row here fail at the upgrade — but a *future* refactor that
    // made the upgrade degrade gracefully would turn this whole file green while testing nothing.
    expect(
      env.ETA_HUB,
      'ETA_HUB is unbound — this suite would be measuring the fallback',
    ).toBeDefined()
    expect(LIVE_ROUNDS.length).toBeGreaterThanOrEqual(10)
  })

  it('follows every silent round with one that speaks, through the same reader', () => {
    // The control for `silent`. On this side silence is a claim about a window (see the header), so a
    // row that ended on `silent` could be a reader that had died rather than a round that said nothing.
    // Every scenario that declares `silent` must therefore also declare a non-silent line after it.
    const silentRows = LIVE_ROUNDS.filter((s) => s.settles.includes('silent'))
    expect(silentRows.length).toBeGreaterThanOrEqual(2)
    for (const scenario of silentRows) {
      const last = scenario.settles.lastIndexOf('silent')
      const speaksAfter = scenario.settles.slice(0, last).some((line) => line !== 'silent')
      expect(speaksAfter, `${scenario.name}: nothing in this row proves the reader was alive`).toBe(
        true,
      )
    }
  })

  for (const scenario of LIVE_ROUNDS) {
    it(scenario.name, async () => {
      expect(await throughShard(scenario)).toEqual(scenario.settles)
    })
  }
})

// ── The same rule on the HTTP path ─────────────────────────────────────────────────────────────
//
// WP5-4's acceptance is *"a stop whose upstream refuses is distinguishable from a stop with no buses,
// on **both** the HTTP and the socket path"*. Everything above is the socket half, and it can only
// observe the *consequence* of `failed` — the readings that were kept — because the frames deliberately
// do not carry it (the shard applies the rule itself; the field exists so the poll emulator can apply
// the identical one). So the wire shape needs asserting where it is actually served, and it is here
// rather than in a file of its own because this is where the board harness lives: the same fixture, the
// same rule, the other transport.

describe('/v1/etas/:id says which boarding points would not answer', () => {
  /**
   * One case's request URL.
   *
   * `case` is a cache-buster and it is load-bearing: `/v1/etas/:id` is served through the build-scoped
   * colo cache at `ETA_TTL_SEC`, and `caches.default` is not reset between tests — so two cases asking
   * the same place would have the second one answered from the first one's response, and the failure
   * assertions below would pass or fail depending on file order. The same reason `wire-conformance`
   * picks `radius=497`. The Worker reads only `routes` off the query string, so the parameter changes
   * the cache key and nothing else.
   */
  const urlFor = (place: string, kase: string, extra = '') =>
    `/v1/etas/${encodeURIComponent(placeIds.get(place) as string)}?case=${kase}${extra}`

  const report = async (place: string, kase: string) =>
    (await (await get(urlFor(place, kase))).json()) as {
      etas: Array<{ stopId: string; routeId: string }>
      failed?: unknown
    }

  it('omits `failed` when every board answered', async () => {
    // THE CONTROL, and it is the assertion that keeps the field honest: absent means "nothing to say",
    // so a producer that always sent `failed: []` would make the field unreadable and this row red.
    boards.set('POLE00', [{ route: 'R1', at: ['+3'] }])
    boards.set('POLE01', [{ route: 'R1', at: ['+6'] }])
    const body = await report('C', 'all-answered')
    expect(body.etas.map((e) => e.stopId).sort()).toEqual(['KMB:POLE00', 'KMB:POLE01'])
    expect('failed' in body, 'an empty `failed` must not be sent at all').toBe(false)
  })

  it('names the refusing kerb, keeps the answering one, and still answers 200', async () => {
    boards.set('POLE00', 'refused')
    boards.set('POLE01', [{ route: 'R1', at: ['+6'] }])
    const body = await report('C', 'one-refused')
    // The answering kerb's reading is published as usual — one refusing board must not cost the place
    // its other kerbs, which is the isolation `memberEtaLists` gets from a `catch` per task.
    expect(body.etas.map((e) => e.stopId)).toEqual(['KMB:POLE01'])
    // …and the refusal is named, in the taxonomy, with `retryable: true` — because a board that would
    // not answer says nothing about whether the rider's stop exists, and `retryable: false` is the
    // wire's instruction to *prune a favourite* (ADR-064). Getting that flag wrong here would tell an
    // iOS Widget to delete a stop over an upstream hiccup.
    expect(body.failed).toEqual([
      {
        stopId: 'KMB:POLE00',
        error: {
          code: 'upstream_unavailable',
          message: 'KMB stop-ETA 502 for POLE00',
          retryable: true,
        },
      },
    ])
  })

  it('is not a 502: a partial answer is a successful answer', async () => {
    // Deliberate, and the alternative was considered. Failing the request would throw away the kerbs
    // that *did* answer and would make the rider's whole card empty to report that one pole was down —
    // strictly less honest than saying both things. The status stays 200 and the body carries the news.
    boards.set('POLE00', 'refused')
    boards.set('POLE01', 'refused')
    const res = await get(urlFor('C', 'both-refused'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { etas: unknown[]; failed: Array<{ stopId: string }> }
    expect(body.etas).toEqual([])
    // Both kerbs named, ordered by pole id — the order both engines turn into `retrying` frames, so an
    // unordered list would make them diverge for identical upstream behaviour.
    expect(body.failed.map((f) => f.stopId)).toEqual(['KMB:POLE00', 'KMB:POLE01'])
  })

  it('reports the refusal even when `routes=` narrows the readings away', async () => {
    // `routes=` filters `etas` and never `failed`. A screen watching one route at a refusing pole would
    // otherwise receive an empty list with nothing to explain it — precisely the state this endpoint's
    // shape exists to make impossible — and a KMB board is one call for every route at the pole, so
    // "did this pole answer" has no per-route truth to filter by in the first place.
    boards.set('POLE00', 'refused')
    boards.set('POLE01', [{ route: 'R1', at: ['+6'] }])
    const res = await get(
      urlFor('C', 'narrowed', `&routes=${encodeURIComponent('KMB:NOSUCH:outbound:1')}`),
    )
    const body = (await res.json()) as { etas: unknown[]; failed: Array<{ stopId: string }> }
    expect(body.etas).toEqual([])
    expect(body.failed.map((f) => f.stopId)).toEqual(['KMB:POLE00'])
  })
})
