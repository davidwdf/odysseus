// The upstream hang detector (WP6-8b): every ETA adapter attaches `AbortSignal.timeout`, and the
// edge's classifier turns what it raises into `upstream_timeout`.
//
// Two halves, tested together because each is worthless without the other and they lived apart for
// five waves: `codeFor` has mapped `TimeoutError` to `upstream_timeout` since ADR-064, but nothing
// ever *produced* one — the adapters called bare `fetch()` — so the taxonomy member was unreachable
// and a wedged upstream connection held an `EtaHub` round (and its `finally`-rescheduled alarm) for
// as long as the runtime took to notice. This file runs under workerd, so it also proves the runtime
// this code ships on actually has `AbortSignal.timeout` and raises the error name `codeFor` matches.

import { fetchCitybusEta, fetchGmbStopEta, fetchKmbStopEta } from '@nextbus/data-normalize'
import { describe, expect, it } from 'vitest'
import { boundedMessage, wireErrorOf } from '../src/errors'

/** A stub that records the init each adapter passed, and answers with an empty board. */
function recordingFetch(body: string) {
  const inits: Array<RequestInit | undefined> = []
  const impl: typeof fetch = async (_input, init) => {
    inits.push(init)
    return new Response(body, { status: 200 })
  }
  return { inits, impl }
}

const EMPTY_BOARD = '{"generated_timestamp":"2026-08-12T23:00:00+08:00","data":[]}'

describe('every upstream ETA call carries a timeout signal', () => {
  it('KMB, CTB and GMB adapters all attach one', async () => {
    const kmb = recordingFetch(EMPTY_BOARD)
    await fetchKmbStopEta('6AB438AD3AE100DD', kmb.impl)
    const ctb = recordingFetch(EMPTY_BOARD)
    await fetchCitybusEta('002403', '1', ctb.impl)
    const gmb = recordingFetch(EMPTY_BOARD)
    await fetchGmbStopEta('20001114', gmb.impl)

    for (const { inits } of [kmb, ctb, gmb]) {
      expect(inits.length).toBe(1)
      // An `AbortSignal`, not merely a truthy field: a `signal: undefined` would satisfy a looser
      // assertion and detach the timeout with no other symptom.
      expect(inits[0]?.signal).toBeInstanceOf(AbortSignal)
    }
    // The GMB adapter's identifying User-Agent (its host 403s an empty one) must survive the merge —
    // the one adapter where `fetchUpstream` composes with an existing init.
    expect(new Headers((gmb.inits[0]?.headers as HeadersInit) ?? {}).get('user-agent')).toContain(
      'NextBusHK',
    )
  })

  it('what the signal raises classifies as upstream_timeout, retryable', async () => {
    // The runtime's own error, not a hand-built fake: this is the half that verifies workerd raises
    // what `codeFor` matches. A 1 ms budget against a fetch that never resolves trips it immediately.
    const hung: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    const thrown = await fetchKmbStopEta('6AB438AD3AE100DD', (input, init) =>
      hung(input, { ...init, signal: AbortSignal.timeout(1) }),
    ).catch((err: unknown) => err)

    const wire = wireErrorOf(thrown)
    expect(wire.code).toBe('upstream_timeout')
    expect(wire.retryable).toBe(true)
  })
})

describe('boundedMessage', () => {
  it('passes a short message through untouched and cuts a long one with a visible mark', () => {
    expect(boundedMessage('KMB stop-ETA 502 for X')).toBe('KMB stop-ETA 502 for X')
    // A `ZodError.message` is a serialized issue list that runs to kilobytes when an upstream changes
    // shape — and it used to travel verbatim into every `status` frame, every `failed` entry, and the
    // socket attachment whose hard platform cap is 16,384 bytes (see `Session.failed`).
    const long = 'x'.repeat(5_000)
    const cut = boundedMessage(long)
    expect(cut.length).toBe(200)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('is what wireErrorOf applies, so no thrown message reaches the wire unbounded', () => {
    const wire = wireErrorOf(new Error('y'.repeat(5_000)))
    expect(wire.message.length).toBe(200)
  })
})
