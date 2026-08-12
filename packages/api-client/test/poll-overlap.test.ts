// Overlapping poll rounds (WP6-8b): `timers.every` fires on the clock, not on completion, so a round
// slower than the cadence overlaps the next — measured for real on a poll-emulated route watch, where
// one round ran 75 s against a 30 s cadence (ADR-121). Completion order is then the network's choice,
// and before the watermark a slow round finishing *after* a fast one folded its older data into the
// state and published it as a fresh delta: every time on screen stepped backwards for one cadence.

import type { EtaBatch, ServerFrame } from '@nextbus/core'
import { describe, expect, it } from 'vitest'
import { createPollTransport, type Timers } from '../src'

const STOP = 'KMB:A'
const ROUTE = 'KMB:1:outbound:1'
const clock = { now: () => Date.parse('2026-08-12T12:00:00.000Z') }

const batchWith = (arrival: string): EtaBatch => ({
  reports: [
    {
      id: STOP,
      etas: [
        {
          routeId: ROUTE,
          stopId: STOP,
          operator: 'KMB',
          arrivals: [arrival],
          dataTimestamp: '2026-08-12T19:59:00+08:00',
          observedAt: '2026-08-12T11:59:00.000Z',
        },
      ],
    },
  ],
})

/** One controllable request per round: the test decides when each resolves, and with what. */
function scriptedBatches() {
  const pending: Array<(batch: EtaBatch) => void> = []
  const getEtasBatch = (): Promise<EtaBatch> =>
    new Promise<EtaBatch>((resolve) => {
      pending.push(resolve)
    })
  return { pending, getEtasBatch }
}

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
  const tick = () => {
    for (const entry of repeating) if (entry.live) entry.fn()
  }
  return { timers, tick }
}

/** Let the resolved promises' `.then` chains run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('overlapping rounds', () => {
  it('discards a slow round that completes after a faster, younger one', async () => {
    const net = scriptedBatches()
    const clocks = manualTimers()
    const transport = createPollTransport({
      getEtasBatch: net.getEtasBatch,
      clock,
      pollMs: 30_000,
      timers: clocks.timers,
    })
    const frames: ServerFrame[] = []
    transport.open({ frame: (f) => frames.push(f) })
    transport.send({ type: 'subscribe', targets: [{ stopId: STOP }] })

    // Round 1 is in flight; the cadence fires round 2 before it completes — the overlap.
    clocks.tick()
    expect(net.pending.length).toBe(2)

    // Round 2 — the younger fetch, so the fresher data — completes first.
    net.pending[1]?.(batchWith('2026-08-12T20:02:00+08:00'))
    await flush()
    const snapshot = frames.find((f) => f.type === 'snapshot')
    expect(snapshot?.type === 'snapshot' && snapshot.etas[0]?.arrivals[0]).toBe(
      '2026-08-12T20:02:00+08:00',
    )

    // Round 1 completes late, carrying what it fetched before round 2 existed. Unguarded, this is the
    // defect: its older reading overwrites the state and goes out as a fresh delta, and the time on
    // screen steps backwards until the next round repairs it.
    net.pending[0]?.(batchWith('2026-08-12T20:05:00+08:00'))
    await flush()
    expect(
      frames.filter((f) => f.type === 'delta' || f.type === 'snapshot').length,
      'the stale completion must publish nothing',
    ).toBe(1)

    // …and the discard really was the watermark, not a lost subscription: the next round still works.
    clocks.tick()
    net.pending[2]?.(batchWith('2026-08-12T20:08:00+08:00'))
    await flush()
    const delta = frames.find((f) => f.type === 'delta')
    expect(delta?.type === 'delta' && delta.changed[0]?.arrivals[0]).toBe(
      '2026-08-12T20:08:00+08:00',
    )

    transport.close()
  })
})
