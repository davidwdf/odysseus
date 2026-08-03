// The **client** driver for the cross-runtime scenario corpus (WP5-5, ADR-074).
//
// Its twin is `apps/edge/test/live-rounds.test.ts`, which runs the identical rows against the real
// `EtaHub` Durable Object over a real WebSocket inside workerd. Neither file owns the expectations:
// `@nextbus/core/fixtures/live-rounds.json` does, and that is the whole mechanism — the three rules
// under test are each implemented twice (`src/live/poll.ts` and `apps/edge/src/eta-hub.ts`), the two
// implementations cannot import each other (`layers.json` forbids `server → client`), and every defect
// Wave 5 found in its own live code survived because no test spanned both. Read the fixture's header
// before changing a row; it states what is asserted and what deliberately is not.
//
// WHAT THIS DRIVER SIMULATES, AND WHY THAT IS THE POINT RATHER THAN THE WEAKNESS
// A row describes what an *upstream board* did. This side has no edge, so `getEtas` here synthesizes
// the `EtaReport` the edge would have produced: readings stamped with the pole whose board answered,
// and `failed` naming the poles that refused. That is a simulation — and if it disagrees with what the
// real Worker produces, the shard driver's `settles` will not match the same declared list and the row
// goes red on that side. The binding runs through the fixture, not through shared code.

import type { Eta, EtaFailure, EtaReport, WatchTarget, WireError } from '@nextbus/core'
import {
  LIVE_ROUNDS,
  LIVE_ROUNDS_TOPOLOGY,
  type LiveRoundsScenario,
} from '@nextbus/core/fixtures/live-rounds'
import type { Clock } from '@nextbus/ports'
import { describe, expect, it } from 'vitest'
import {
  createLiveEtaController,
  createPollTransport,
  type LiveEtaUpdate,
  type Timers,
} from '../src'

// ── Logical → concrete ─────────────────────────────────────────────────────────────────────────
//
// The fixture's vocabulary is `A`/`B`/`C1`/`R1`/`+7`; this side turns it into canonical ids and ISO
// instants. The edge driver has its own table pointing at ids that exist in its seeded dataset — the
// two are deliberately different, which is why the fixture cannot name concrete ones.

/** Fixed, so `at()` and `minutesFromNow()` are exact inverses and a row's `+N` is unambiguous. */
const NOW_MS = Date.parse('2026-07-30T02:00:00.000Z')
const clock: Clock = { now: () => NOW_MS }

const poleId = (label: string): string => `KMB:POLE-${label}`
const placeId = (label: string): string => {
  const poles = LIVE_ROUNDS_TOPOLOGY.places[label as keyof typeof LIVE_ROUNDS_TOPOLOGY.places]
  if (!poles) throw new Error(`the fixture names a place "${label}" the topology does not declare`)
  // A one-pole place is addressed by its pole; a multi-pole place by the merged `P:` id (ADR-042),
  // exactly as a real client addresses one — which is what makes `memberStopIds` matter downstream.
  return poles.length === 1 ? poleId(poles[0] as string) : `P:${poles.map(poleId).join('+')}`
}
const routeId = (label: string): string => `KMB:${label}:outbound:1`
const at = (offset: string): string => new Date(NOW_MS + Number(offset) * 60_000).toISOString()

/** The pole labels a place is made of, straight from the topology. */
const polesOf = (label: string): readonly string[] =>
  LIVE_ROUNDS_TOPOLOGY.places[label as keyof typeof LIVE_ROUNDS_TOPOLOGY.places] ?? []

/**
 * What the edge classifies a refused board as: `upstream_unavailable`, `retryable: true` (ADR-064).
 *
 * Spelled out here rather than imported, because the value the real Worker puts on the wire is built
 * by `apps/edge/src/errors.ts` and this package may not read it. The `retrying` line in every `settles`
 * carries the code, so a disagreement about it fails the row rather than passing quietly.
 */
const refusedError = (pole: string): WireError => ({
  code: 'upstream_unavailable',
  message: `KMB stop-ETA 502 for ${pole}`,
  retryable: true,
})

/** One round's `EtaReport` for one target, built the way `stopArrivals` would build it. */
function reportFor(scenario: LiveRoundsScenario, round: number, place: string): EtaReport {
  const boards = scenario.rounds[round]?.boards
  if (!boards) throw new Error(`${scenario.name}: no round ${round}`)
  const etas: Eta[] = []
  const failed: EtaFailure[] = []
  for (const pole of polesOf(place)) {
    const answer = boards[pole]
    if (answer === undefined) {
      throw new Error(`${scenario.name}: round ${round} has no board for pole "${pole}"`)
    }
    if (answer === 'refused') {
      failed.push({ stopId: poleId(pole), error: refusedError(pole) })
      continue
    }
    for (const line of answer) {
      etas.push({
        routeId: routeId(line.route),
        stopId: poleId(pole),
        operator: 'KMB',
        arrivals: line.at.map(at),
        // The operator's clock. Constant across rounds on purpose: `sameReading` compares it, so a
        // per-round value would make every round news and "an unchanged round is silent" untestable.
        dataTimestamp: new Date(NOW_MS).toISOString(),
        // Ours, and it MOVES every round — which is the half of `sameReading` that matters here. The
        // field is excluded from the comparison precisely so a re-observation is not news; a driver
        // that held it constant would let an engine that compared it pass the silence rows anyway.
        observedAt: new Date(NOW_MS + round * 45_000).toISOString(),
      })
    }
  }
  // Absent, not `[]`, when every board answered — the shape `EtaReportSchema` declares and the shape
  // the Worker serves, so `failed?.length` behaves identically on both sides of the wire.
  return failed.length === 0 ? { etas } : { etas, failed }
}

// ── The observation ────────────────────────────────────────────────────────────────────────────

/** `+7` back out of an ISO instant, so a summary line reads like the row that declared it. */
const minutesFromNow = (iso: string): string =>
  `+${Math.round((Date.parse(iso) - NOW_MS) / 60_000)}`

/**
 * One settled line, in the fixture's format. **Duplicated in the edge driver, deliberately.**
 *
 * A shared helper would have to live somewhere both layers may import, and the only such place is
 * `packages/core` — which would mean shipping a test formatter in the hand-ported kernel. More to the
 * point, the two transcriptions are *independent*: each driver reduces its own engine's output and
 * both are measured against one hand-written list, so a formatter that drifted makes a row red rather
 * than making two engines agree with each other. Same argument `live-socket.test.ts` gives for keeping
 * its own copy of `manualTimers`.
 */
function settled(update: LiveEtaUpdate, labelOf: (id: string) => string): string {
  const state = update.status.error
    ? `${update.status.state}!${update.status.error.code}`
    : update.status.state
  const etas = update.etas.map(
    (e) => `${labelOf(e.stopId)}/${labelOf(e.routeId)}@${e.arrivals.map(minutesFromNow).join(',')}`,
  )
  const watching = update.targets.map((t) => labelOf(t.stopId))
  return `${state} etas=[${etas.join(' ')}] watching=[${watching.join(' ')}]`
}

/** Concrete id → the fixture's label, for every id a row can produce. Built once per scenario. */
function labeller(scenario: LiveRoundsScenario): (id: string) => string {
  const map = new Map<string, string>()
  for (const place of scenario.targets) {
    map.set(placeId(place), place)
    for (const pole of polesOf(place)) map.set(poleId(pole), pole)
  }
  for (const round of scenario.rounds) {
    for (const answer of Object.values(round.boards)) {
      if (answer === 'refused') continue
      for (const line of answer) map.set(routeId(line.route), line.route)
    }
  }
  return (id) => map.get(id) ?? id
}

/** Timers a test drives by hand — see `live-matrix.test.ts` for why not `vi.useFakeTimers()`. */
function manualTimers() {
  const repeating: Array<{ fn: () => void; live: boolean }> = []
  const timers: Timers = {
    every(_ms, fn) {
      const entry = { fn, live: true }
      repeating.push(entry)
      return () => {
        entry.live = false
      }
    },
    after(_ms, fn) {
      const entry = { fn, live: true }
      return () => {
        entry.live = false
      }
    },
  }
  return {
    timers,
    tick() {
      for (const entry of [...repeating]) if (entry.live) entry.fn()
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Drive one scenario through the poll emulator and report one line per round.
 *
 * `silent` is a **count**, not a timeout: this driver advances the cadence itself, so "the round
 * emitted nothing" is decidable rather than a claim about a window. The edge driver cannot do that and
 * says so.
 */
async function throughPolling(scenario: LiveRoundsScenario): Promise<string[]> {
  const { timers, tick } = manualTimers()
  const labelOf = labeller(scenario)
  let round = 0
  const transport = createPollTransport({
    clock,
    pollMs: 30_000,
    timers,
    getEtas: async (stopId) => {
      const place = scenario.targets.find((label) => placeId(label) === stopId)
      if (place === undefined) throw new Error(`${scenario.name}: polled an unwatched id ${stopId}`)
      return reportFor(scenario, round, place)
    },
  })

  const updates: LiveEtaUpdate[] = []
  const controller = createLiveEtaController({
    transport,
    targets: scenario.targets.map((label): WatchTarget => ({ stopId: placeId(label) })),
    emit: (update) => updates.push(update),
  })

  const lines: string[] = []
  controller.start()
  await flush()
  for (let i = 0; i < scenario.rounds.length; i++) {
    if (i > 0) {
      round = i
      tick()
      await flush()
    }
    const emitted = updates.splice(0)
    const last = emitted.at(-1)
    lines.push(last === undefined ? 'silent' : settled(last, labelOf))
  }
  controller.stop()
  return lines
}

// ── The assertions ─────────────────────────────────────────────────────────────────────────────

describe('the live rounds corpus, through the poll emulator', () => {
  it('has rows, and they exercise both failure shapes', () => {
    // The anti-vacuous control. A fixture that had lost its rows — or in which every row had become a
    // happy path — would pass every assertion below by never reaching one.
    expect(LIVE_ROUNDS.length).toBeGreaterThanOrEqual(10)
    const refusing = LIVE_ROUNDS.filter((s) =>
      s.rounds.some((r) => Object.values(r.boards).includes('refused')),
    )
    expect(refusing.length).toBeGreaterThanOrEqual(6)
    // At least one row must refuse ONE pole of a multi-pole place while the other answers — the shape a
    // target-level rule cannot express, and the reason ADR-073 exists.
    const perPole = LIVE_ROUNDS.filter((s) =>
      s.rounds.some((r) => {
        const answers = Object.values(r.boards)
        return answers.includes('refused') && answers.some((a) => a !== 'refused')
      }),
    )
    expect(perPole.length).toBeGreaterThanOrEqual(2)
    // Every row must declare one line per round, or a driver could silently compare a prefix.
    for (const scenario of LIVE_ROUNDS) {
      expect(scenario.settles.length, scenario.name).toBe(scenario.rounds.length)
      expect(scenario.why.length, scenario.name).toBeGreaterThan(40)
    }
  })

  for (const scenario of LIVE_ROUNDS) {
    it(scenario.name, async () => {
      expect(await throughPolling(scenario)).toEqual(scenario.settles)
    })
  }
})
