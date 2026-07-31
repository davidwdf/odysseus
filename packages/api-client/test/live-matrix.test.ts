// WP5-1's acceptance, as something that runs: **a listener cannot tell which engine is feeding it.**
//
// The plan's criterion is "byte-identical listener output from the poll emulator and a `MemoryTransport`
// fake". That is only a test if the fake's frames are written *independently* of the emulator's — if the
// script were derived from what the poll transport emitted, the comparison would be a transport agreeing
// with itself, which is Brief 1's corpus lesson (hand-written expectations disagreed with the
// implementation and the implementation was wrong) applied one layer out. So every scenario below carries
// two things by hand: the **rounds of upstream data** the poll emulator sees, and the **frames a server
// would send** for that same data. Three assertions per row:
//
//   1. the two engines' update sequences are identical — same values, same order, same count;
//   2. both match a hand-written summary of what a rider should see, line per repaint;
//   3. the sequence is non-empty (the anti-vacuous control: two engines that emitted nothing would
//      otherwise agree perfectly).
//
// TWO SCENARIOS HAVE NO POLL COUNTERPART, AND SAYING SO IS THE HONEST OPTION
// A `seq` gap and a reconnect cannot be driven through the poll emulator: it *is* the producer of its own
// counter, so it cannot skip one, and it has no connection to lose. Pretending otherwise would mean
// scripting the poll side to fake a gap, i.e. comparing a transport with itself. They are asserted
// against their hand-written expectation only, and marked `socketOnly` so the count of compared rows
// stays honest.

import type { Eta, LiveState, ServerFrame, WatchTarget } from '@nextbus/core'
import { parseRouteId } from '@nextbus/core'
import type { Clock } from '@nextbus/ports'
import { describe, expect, it } from 'vitest'
import {
  createLiveEtaController,
  createMemoryTransport,
  createPollTransport,
  EdgeRequestError,
  type LiveEtaUpdate,
  type Timers,
} from '../src'

// ── The harness ────────────────────────────────────────────────────────────────────────────────

/**
 * Timers a test drives by hand.
 *
 * The alternative, `vi.useFakeTimers()`, patches the globals for the whole file — so it cannot advance
 * one transport's cadence while another's stands still, which is exactly what comparing two engines
 * needs. Injecting the two methods `Timers` declares costs six lines and makes the matrix a comparison
 * rather than a sleep.
 */
function manualTimers() {
  const repeating: Array<{ fn: () => void; live: boolean }> = []
  const once: Array<{ ms: number; fn: () => void; live: boolean }> = []
  const timers: Timers = {
    every(_ms, fn) {
      const entry = { fn, live: true }
      repeating.push(entry)
      return () => {
        entry.live = false
      }
    },
    after(ms, fn) {
      const entry = { ms, fn, live: true }
      once.push(entry)
      return () => {
        entry.live = false
      }
    },
  }
  return {
    timers,
    /** One cadence tick, to every live repeating timer. */
    tick() {
      for (const entry of [...repeating]) if (entry.live) entry.fn()
    },
    /** Fire every live one-shot, returning the delays they were scheduled with. */
    fireOnce(): number[] {
      const due = once.filter((e) => e.live)
      for (const entry of due) {
        entry.live = false
        entry.fn()
      }
      return due.map((e) => e.ms)
    },
    liveRepeating: () => repeating.filter((e) => e.live).length,
  }
}

/** Let every pending microtask and resolved promise settle. The poll emulator's rounds are async. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Frames stamp `at` from this; nothing reduces `at`, so the value only has to be stable. */
const clock: Clock = { now: () => Date.parse('2026-07-30T02:00:00.000Z') }

const ROUTE_1 = 'KMB:1:outbound:1'
const ROUTE_6 = 'KMB:6:outbound:1'
const STOP_A = 'KMB:A'
const STOP_B = 'KMB:B'

/** A reading. `dataTimestamp` is the operator's clock — the field `sameReading` and `isStale` both read. */
function eta(stopId: string, routeId: string, hhmm: string, observedAtSec = '00'): Eta {
  return {
    routeId,
    stopId,
    operator: 'KMB',
    arrivals: [`2026-07-30T${hhmm}:00+08:00`],
    dataTimestamp: `2026-07-30T09:59:${observedAtSec}+08:00`,
    // Deliberately varied per round in some scenarios: `sameReading` excludes `observedAt`, so a
    // re-observation that yields the identical operator reading must **not** count as news.
    observedAt: `2026-07-30T01:59:${observedAtSec}.000Z`,
  }
}

const unavailable = new EdgeRequestError(502, 'upstream_unavailable', true, 'upstream said no')
const gone = new EdgeRequestError(404, 'not_found', false, 'no such stop')

/** What one target answered in one round. */
type Answer = Eta[] | { throws: EdgeRequestError }
type Round = Record<string, Answer>

interface Scenario {
  name: string
  why?: string
  targets: WatchTarget[]
  /** What `getEtas` returns per target, per round. Absent from the poll comparison when `socketOnly`. */
  rounds: Round[]
  /** The frames a server would send for exactly that data — written by hand, not recorded. */
  frames: ServerFrame[]
  /** One line per repaint the listener should see, in order. */
  expect: string[]
  /** True when the scenario cannot be produced by polling at all. See the header. */
  socketOnly?: boolean
}

/**
 * One update, as a line.
 *
 * State first because it is what a rider is told, then every reading in the order the listener received
 * it — which is the half of the comparison that matters and the half a `length` assertion would miss
 * (D1: two engines with the same data and different orders is the failure mode this exists to catch).
 */
function summarize(update: LiveEtaUpdate): string {
  const state = update.status.error
    ? `${update.status.state}!${update.status.error.code}`
    : update.status.state
  const readings = update.etas.map((e) => {
    const routeNo = parseRouteId(e.routeId)?.routeNo ?? '?'
    return `${e.stopId}/${routeNo}@${(e.arrivals[0] ?? '-').slice(11, 16)}`
  })
  return `${state} [${readings.join(' ')}]`
}

function snapshot(seq: number, targets: WatchTarget[], etas: Eta[]): ServerFrame {
  return { type: 'snapshot', seq, at: '2026-07-30T02:00:00.000Z', targets, etas }
}
function delta(seq: number, changed: Eta[], goneRefs: Array<{ stopId: string; routeId: string }>) {
  return {
    type: 'delta',
    seq,
    at: '2026-07-30T02:00:00.000Z',
    changed,
    gone: goneRefs,
  } satisfies ServerFrame
}
function status(state: LiveState, error?: EdgeRequestError): ServerFrame {
  const at = '2026-07-30T02:00:00.000Z'
  return error
    ? {
        type: 'status',
        at,
        state,
        error: { code: error.code, message: error.message, retryable: error.retryable },
      }
    : { type: 'status', at, state }
}

/** Drive a scenario through the poll emulator, one round per cadence tick. */
async function throughPolling(scenario: Scenario): Promise<{ updates: string[]; calls: string[] }> {
  const { timers, tick } = manualTimers()
  const calls: string[] = []
  let round = 0
  const transport = createPollTransport({
    clock,
    pollMs: 30_000,
    timers,
    getEtas: async (stopId) => {
      calls.push(`${round}:${stopId}`)
      const answer = scenario.rounds[round]?.[stopId]
      if (answer === undefined)
        throw new Error(`scenario "${scenario.name}": no round ${round} answer for ${stopId}`)
      if ('throws' in answer) throw answer.throws
      return answer
    },
  })
  const updates: string[] = []
  const controller = createLiveEtaController({
    transport,
    targets: scenario.targets,
    emit: (update) => updates.push(summarize(update)),
  })
  controller.start()
  await flush()
  for (let i = 1; i < scenario.rounds.length; i++) {
    round = i
    tick()
    await flush()
  }
  controller.stop()
  return { updates, calls }
}

/** Drive the same scenario through the scripted server. */
async function throughScript(scenario: Scenario): Promise<string[]> {
  const transport = createMemoryTransport(scenario.frames)
  const updates: string[] = []
  const controller = createLiveEtaController({
    transport,
    targets: scenario.targets,
    emit: (update) => updates.push(summarize(update)),
  })
  controller.start()
  await flush()
  controller.stop()
  return updates
}

// ── The matrix ─────────────────────────────────────────────────────────────────────────────────

const ONE_TARGET: WatchTarget[] = [{ stopId: STOP_A }]
const TWO_TARGETS: WatchTarget[] = [{ stopId: STOP_A }, { stopId: STOP_B }]

const SCENARIOS: Scenario[] = [
  {
    name: 'the first round is a snapshot',
    targets: ONE_TARGET,
    rounds: [{ [STOP_A]: [eta(STOP_A, ROUTE_6, '10:07'), eta(STOP_A, ROUTE_1, '10:02')] }],
    frames: [
      // Canonically ordered, which is the reducer's job — so the server is free to send them in the
      // order upstream happened to answer, and this script deliberately does.
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_6, '10:07'), eta(STOP_A, ROUTE_1, '10:02')]),
      status('live'),
    ],
    expect: ['connecting [KMB:A/1@10:02 KMB:A/6@10:07]', 'live [KMB:A/1@10:02 KMB:A/6@10:07]'],
  },
  {
    name: 'an unchanged round says nothing at all',
    why: 'ADR-008: the value changes when the data does. A re-observation of the identical operator reading is not news, so neither engine emits — the second round carries a later `observedAt` and must still be silent.',
    targets: ONE_TARGET,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02', '00')] },
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02', '00')] },
    ],
    frames: [snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02', '00')]), status('live')],
    expect: ['connecting [KMB:A/1@10:02]', 'live [KMB:A/1@10:02]'],
  },
  {
    name: 'one arrival changes',
    targets: ONE_TARGET,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02'), eta(STOP_A, ROUTE_6, '10:07')] },
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:04'), eta(STOP_A, ROUTE_6, '10:07')] },
    ],
    frames: [
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02'), eta(STOP_A, ROUTE_6, '10:07')]),
      status('live'),
      delta(2, [eta(STOP_A, ROUTE_1, '10:04')], []),
    ],
    expect: [
      'connecting [KMB:A/1@10:02 KMB:A/6@10:07]',
      'live [KMB:A/1@10:02 KMB:A/6@10:07]',
      'live [KMB:A/1@10:04 KMB:A/6@10:07]',
    ],
  },
  {
    name: 'a route disappears',
    why: 'D2. Polling replaces the whole payload so the departed bus vanishes for free; the socket has to say `gone`, and both must leave the same list behind.',
    targets: ONE_TARGET,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02'), eta(STOP_A, ROUTE_6, '10:07')] },
      { [STOP_A]: [eta(STOP_A, ROUTE_6, '10:07')] },
    ],
    frames: [
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02'), eta(STOP_A, ROUTE_6, '10:07')]),
      status('live'),
      delta(2, [], [{ stopId: STOP_A, routeId: ROUTE_1 }]),
    ],
    expect: [
      'connecting [KMB:A/1@10:02 KMB:A/6@10:07]',
      'live [KMB:A/1@10:02 KMB:A/6@10:07]',
      'live [KMB:A/6@10:07]',
    ],
  },
  {
    name: 'a route appears',
    targets: ONE_TARGET,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_6, '10:07')] },
      { [STOP_A]: [eta(STOP_A, ROUTE_6, '10:07'), eta(STOP_A, ROUTE_1, '10:11')] },
    ],
    frames: [
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_6, '10:07')]),
      status('live'),
      delta(2, [eta(STOP_A, ROUTE_1, '10:11')], []),
    ],
    expect: [
      'connecting [KMB:A/6@10:07]',
      'live [KMB:A/6@10:07]',
      // The new route sorts *first*, and it arrived second. That is D1's total order doing its job: a
      // merge-in-place transport would have appended it and the two engines would differ here.
      'live [KMB:A/1@10:11 KMB:A/6@10:07]',
    ],
  },
  {
    name: 'the first round fails for every target',
    why: 'The header\'s rule — *a failed round is not a departure* — used to hold from round two only. The `seq === 0` branch fired whatever came back, so a round where every request threw published `snapshot { etas: [] }`: the frame for "this stop has no arrivals". The screen loses the minutes it painted from its own HTTP fetch, ADR-058\'s persister dehydrates the blank because the document is still `success`, and the `retrying` status that would explain it cannot reach a listener that receives only `Eta[]`. No answer from anybody means no snapshot yet — which is what a subscription before its first successful round actually is. Every other failure row here opens with a round that succeeded, which is why nothing caught it.',
    targets: ONE_TARGET,
    rounds: [{ [STOP_A]: { throws: unavailable } }, { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')] }],
    frames: [
      status('retrying', unavailable),
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02')]),
      status('live'),
    ],
    expect: [
      // `[]` here is the *absence* of a snapshot, not an empty one: the listener has never been handed
      // readings, so a screen keeps whatever its own fetch painted. Round two arrives under the
      // `retrying` label still standing, exactly as the recovery row below does, and `live` follows.
      'retrying!upstream_unavailable []',
      'retrying!upstream_unavailable [KMB:A/1@10:02]',
      'live [KMB:A/1@10:02]',
    ],
  },
  {
    name: 'a target fails and then recovers',
    why: 'A failed fetch is not a departure: the reading stays, labelled. Recovery has to re-announce `live`, or the screen keeps a "reconnecting" label for ever with data flowing behind it.',
    targets: ONE_TARGET,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')] },
      { [STOP_A]: { throws: unavailable } },
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:05')] },
    ],
    frames: [
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02')]),
      status('live'),
      status('retrying', unavailable),
      delta(2, [eta(STOP_A, ROUTE_1, '10:05')], []),
      status('live'),
    ],
    expect: [
      'connecting [KMB:A/1@10:02]',
      'live [KMB:A/1@10:02]',
      'retrying!upstream_unavailable [KMB:A/1@10:02]',
      'retrying!upstream_unavailable [KMB:A/1@10:05]',
      'live [KMB:A/1@10:05]',
    ],
  },
  {
    name: 'two targets, one fails',
    why: 'What `watch()` has always done — keep the other targets alive — now visible as frames rather than as a swallowed exception.',
    targets: TWO_TARGETS,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')], [STOP_B]: { throws: unavailable } },
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')], [STOP_B]: [eta(STOP_B, ROUTE_6, '10:09')] },
    ],
    frames: [
      // The failing target is still in the accepted echo: a fetch that failed says nothing about
      // whether the stop exists, which is what `retryable: true` means.
      snapshot(1, TWO_TARGETS, [eta(STOP_A, ROUTE_1, '10:02')]),
      status('retrying', unavailable),
      delta(2, [eta(STOP_B, ROUTE_6, '10:09')], []),
      status('live'),
    ],
    expect: [
      'connecting [KMB:A/1@10:02]',
      'retrying!upstream_unavailable [KMB:A/1@10:02]',
      'retrying!upstream_unavailable [KMB:A/1@10:02 KMB:B/6@10:09]',
      'live [KMB:A/1@10:02 KMB:B/6@10:09]',
    ],
  },
  {
    name: 'a permanently failing target is dropped and its readings go',
    why: '`retryable: false` means stop asking (ADR-064) — otherwise a favourite whose id no longer resolves is re-requested every round for as long as the rider keeps it. Its last readings cannot stay on screen either, so they are `gone`, which is what `DeltaFrame.gone` already documents for a dropped target.',
    targets: TWO_TARGETS,
    rounds: [
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')], [STOP_B]: [eta(STOP_B, ROUTE_6, '10:09')] },
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')], [STOP_B]: { throws: gone } },
      { [STOP_A]: [eta(STOP_A, ROUTE_1, '10:02')] },
    ],
    frames: [
      snapshot(1, TWO_TARGETS, [eta(STOP_A, ROUTE_1, '10:02'), eta(STOP_B, ROUTE_6, '10:09')]),
      status('live'),
      delta(2, [], [{ stopId: STOP_B, routeId: ROUTE_6 }]),
      status('retrying', gone),
      status('live'),
    ],
    expect: [
      'connecting [KMB:A/1@10:02 KMB:B/6@10:09]',
      'live [KMB:A/1@10:02 KMB:B/6@10:09]',
      'live [KMB:A/1@10:02]',
      'retrying!not_found [KMB:A/1@10:02]',
      'live [KMB:A/1@10:02]',
    ],
  },
  {
    name: 'nothing left to watch closes the subscription',
    targets: ONE_TARGET,
    rounds: [{ [STOP_A]: { throws: gone } }],
    frames: [snapshot(1, [], []), status('retrying', gone), status('closed')],
    expect: [
      'connecting []',
      'retrying!not_found []',
      // `closed` rather than a timer that keeps waking to ask about a stop that will never answer.
      'closed []',
    ],
  },
  {
    name: 'a reconnect re-snapshots and the stale reading goes with it',
    why: 'The recovery path. A fresh snapshot applies whatever `seq` it carries — deliberately, or a restarted shard would be ignored for ever — and it replaces the list rather than merging, so a route the server no longer holds does not survive the reconnect.',
    socketOnly: true,
    targets: ONE_TARGET,
    rounds: [],
    frames: [
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02'), eta(STOP_A, ROUTE_6, '10:07')]),
      status('live'),
      status('retrying', unavailable),
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_6, '10:07')]),
      status('live'),
    ],
    expect: [
      'connecting [KMB:A/1@10:02 KMB:A/6@10:07]',
      'live [KMB:A/1@10:02 KMB:A/6@10:07]',
      'retrying!upstream_unavailable [KMB:A/1@10:02 KMB:A/6@10:07]',
      'retrying!upstream_unavailable [KMB:A/6@10:07]',
      'live [KMB:A/6@10:07]',
    ],
  },
  {
    name: 'a seq gap is applied and asks for a resync',
    why: 'Discarding the frame as well as the gap would leave the screen further behind than the data just handed to it. So it applies, and the controller re-declares its targets — asserted through `sent` below.',
    socketOnly: true,
    targets: ONE_TARGET,
    rounds: [],
    frames: [
      snapshot(1, ONE_TARGET, [eta(STOP_A, ROUTE_1, '10:02')]),
      status('live'),
      delta(4, [eta(STOP_A, ROUTE_1, '10:06')], []),
    ],
    expect: ['connecting [KMB:A/1@10:02]', 'live [KMB:A/1@10:02]', 'live [KMB:A/1@10:06]'],
  },
]

describe('the scenario matrix: two engines, one listener', () => {
  it('has scenarios, and most of them are compared across both engines', () => {
    // The anti-vacuous control. A matrix that had lost its rows — or in which every row had become
    // socket-only — would pass every assertion below by never running one.
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(9)
    expect(SCENARIOS.filter((s) => s.socketOnly !== true).length).toBeGreaterThanOrEqual(7)
  })

  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      const scripted = await throughScript(scenario)
      expect(scripted).toEqual(scenario.expect)
      expect(scripted.length).toBeGreaterThan(0)
      if (scenario.socketOnly === true) return
      const { updates } = await throughPolling(scenario)
      // The criterion itself: same values, same order, same count.
      expect(updates).toEqual(scripted)
    })
  }
})

describe('properties the matrix table cannot state', () => {
  it('stops asking about a target whose failure was permanent', async () => {
    const scenario = SCENARIOS.find((s) => s.name.startsWith('a permanently failing'))
    if (!scenario)
      throw new Error('the scenario was renamed — this assertion is now measuring nothing')
    const { calls } = await throughPolling(scenario)
    // Round 2 asks about A only. Without honouring `retryable: false` there would be a `2:KMB:B`, and
    // the poll would keep issuing one every cadence for as long as the screen stayed open.
    expect(calls).toEqual(['0:KMB:A', '0:KMB:B', '1:KMB:A', '1:KMB:B', '2:KMB:A'])
  })

  it('never polls at all when every target is rejected', async () => {
    const { timers } = manualTimers()
    const calls: string[] = []
    const transport = createPollTransport({
      clock,
      pollMs: 30_000,
      timers,
      getEtas: async (stopId) => {
        calls.push(stopId)
        return []
      },
    })
    const updates: string[] = []
    const controller = createLiveEtaController({
      transport,
      // Neither parses: one is not `<operator>:<rawId>` at all, the other asks for no routes, which
      // `acceptTargets` rejects rather than treating as "all" (a subscription that can never produce a
      // reading looks exactly like a stop with no buses due).
      targets: [{ stopId: 'not-an-id' }, { stopId: STOP_A, routeIds: [] }],
      emit: (update) => updates.push(summarize(update)),
    })
    controller.start()
    await flush()
    expect(calls).toEqual([])
    // The empty echo is how a client learns the difference between "you asked for nothing" and "every
    // target you named was rejected" — so the snapshot is still sent.
    expect(updates).toEqual(['connecting []', 'closed []'])
    controller.stop()
  })

  it('asks for a fresh snapshot exactly once when a frame gaps', async () => {
    const scenario = SCENARIOS.find((s) => s.name.startsWith('a seq gap'))
    if (!scenario)
      throw new Error('the scenario was renamed — this assertion is now measuring nothing')
    const transport = createMemoryTransport(scenario.frames)
    const controller = createLiveEtaController({
      transport,
      targets: scenario.targets,
      emit: () => {},
    })
    controller.start()
    await flush()
    // The initial declaration plus one resync — and *only* one, because the answer to a resync is a
    // snapshot and `applyLiveFrame` never reports `resyncNeeded` for a snapshot. Nothing here is a
    // cooldown or a retry counter; the loop terminates by construction.
    expect(transport.sent).toEqual([
      { type: 'subscribe', targets: scenario.targets },
      { type: 'subscribe', targets: scenario.targets },
    ])
    controller.stop()
  })

  it('emits nothing after the subscription is released', async () => {
    const { timers, tick, liveRepeating } = manualTimers()
    let round = 0
    const transport = createPollTransport({
      clock,
      pollMs: 30_000,
      timers,
      getEtas: async () => [eta(STOP_A, ROUTE_1, round === 0 ? '10:02' : '10:09')],
    })
    const updates: string[] = []
    const controller = createLiveEtaController({
      transport,
      targets: ONE_TARGET,
      emit: (update) => updates.push(summarize(update)),
    })
    controller.start()
    await flush()
    const before = updates.length
    controller.stop()
    round = 1
    tick()
    await flush()
    expect(updates.length).toBe(before)
    // …and the cadence timer is released, not merely ignored. A screen that navigated away would
    // otherwise keep one request per 30 s going for the life of the process.
    expect(liveRepeating()).toBe(0)
  })

  it('reports which engine is driving, without it ever being on the wire', () => {
    const polling = createLiveEtaController({
      transport: createPollTransport({ clock, pollMs: 30_000, getEtas: async () => [] }),
      targets: ONE_TARGET,
      emit: () => {},
    })
    const scripted = createLiveEtaController({
      transport: createMemoryTransport([]),
      targets: ONE_TARGET,
      emit: () => {},
    })
    expect([polling.engine, scripted.engine]).toEqual(['poll', 'socket'])
    // And the frames carry no trace of it: every scenario above compared two engines' output and
    // passed, which is only possible because no frame names one.
  })
})
