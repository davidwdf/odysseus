// What every live transport in this package shares: the frame types it carries, the label it answers
// "which engine is driving" with, and the two timers it is allowed to hold.
//
// WHY THE TIMERS ARE INJECTED AND NOT JUST CALLED
// `packages/core` may hold no timer at all (`layers.json` denies `setTimeout`/`setInterval` in the
// kernel) and `packages/ports`' `Clock` says in as many words that it has none either: *"No timers. No
// `setInterval`, no `schedule()`. Refresh cadence is the data layer's job (`watch()` in
// `@nextbus/api-client`)"*. This is that data layer, so this is where a timer legitimately lives — and
// injecting it is what makes WP5-1's scenario matrix a *comparison* rather than a sleep. A matrix that
// drove the poll emulator with real 30-second intervals would either take five minutes or be rewritten
// around `vi.useFakeTimers`, which patches globals for the whole file and cannot express "advance this
// transport but not that one". Two named methods a test can implement in six lines can.

import type { ClientFrame, EtaReport, ServerFrame } from '@nextbus/core'
import type { Clock, LiveTransport } from '@nextbus/ports'
import type { Endpoints } from '../endpoint'

/**
 * Which engine is producing the frames a screen is being fed.
 *
 * Deliberately **not** a field on any frame. WP5-1's acceptance is byte-identical listener output from
 * the poll emulator and a socket fake, and a `transport` field in the protocol would make the two
 * differ by construction — the criterion could not be met by any implementation, and the one property
 * this wave exists to prove would be untestable (stated at the top of
 * `packages/contract/src/wire/live.ts` too, from the protocol's side). So it is a property of the
 * *controller*, which is a client-side object, and a screen that wants to say "live" rather than
 * "polling" reads it there.
 */
export type LiveEngine = 'poll' | 'socket'

/** The port, instantiated over this repo's frames. Declared once so four files agree on it. */
export type LiveEtaTransport = LiveTransport<ServerFrame, ClientFrame>

/**
 * A transport that says which engine it is.
 *
 * The label is on the transport rather than passed separately to the controller because the transport
 * is the only thing that knows: `createSocketTransport` is a socket whatever it is handed, and a
 * `MemoryTransport` replaying a scripted server is standing in for one. A custom transport has to
 * answer the question, which is the honest requirement — "which engine is driving" is not a question
 * the controller can answer by inspection.
 */
export interface LiveEtaEngine extends LiveEtaTransport {
  readonly engine: LiveEngine
}

/**
 * Everything a transport factory could need to build itself, so the option is one function.
 *
 * The poll emulator needs `getEtas` and a cadence; the socket needs a URL; both need a clock. Handing
 * over the whole `EdgeClient` instead would let a transport reach for a second endpoint, which is how a
 * "transport" grows into a second data layer.
 *
 * Declared here rather than beside `EdgeClientOptions` since WP5-6: `./select.ts` builds a transport
 * from this shape and `index.ts` imports `./select`, so leaving the declaration in `index.ts` would
 * make the two modules import each other. Re-exported from the package root, where it always was.
 */
export interface LiveTransportContext {
  endpoints: Endpoints
  /**
   * The client's own `/v1/etas/:id` call — what the poll emulator polls.
   *
   * An `EtaReport`, not an `Eta[]` (ADR-073). The transport needs the `failed` half: without it an
   * empty list from an outage is indistinguishable from a stop with no buses, and the diff it feeds
   * reports every reading departed.
   */
  getEtas(stopId: string, routeIds?: string[]): Promise<EtaReport>
  /** The resolved cadence, ms: `pollMs` if given, else the served policy default (ADR-053). */
  pollMs: number
  clock: Clock
}

/**
 * The two timers a transport may hold, as an injection point.
 *
 * `every` and not a self-rescheduling `after`, and that is a compatibility decision rather than a
 * stylistic one: `EdgeClient.watch()` has always polled on `setInterval`, so its rounds go out at a
 * fixed cadence measured from the *start* of the previous round. Rescheduling after each round
 * completes would add the request latency to every interval — a small change, invisible in a test, and
 * exactly the kind of "indistinguishable from today" claim that turns out to be false at a kerb on a
 * slow connection. So the poll emulator keeps `setInterval`'s semantics and the socket's backoff uses
 * the one-shot.
 */
export interface Timers {
  /** Run `fn` every `ms` at a fixed cadence, until the returned function is called. */
  every(ms: number, fn: () => void): () => void
  /** Run `fn` once after `ms`, unless the returned function is called first. */
  after(ms: number, fn: () => void): () => void
}

/** The host's timers. The one place this package touches them. */
export const systemTimers: Timers = {
  every(ms, fn) {
    const id: ReturnType<typeof setInterval> = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  after(ms, fn) {
    const id: ReturnType<typeof setTimeout> = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

/**
 * A frame's `at` stamp, from an injected clock.
 *
 * `Z`-suffixed UTC, because that is what the frame schemas declare and what `Date#toISOString`
 * produces — *not* the `+08:00` the conventions list describes for operator timestamps. The frames say
 * so at `SnapshotFrame.at`, and the reason it matters is that `Eta.dataTimestamp` really does carry
 * `+08:00`: compare the two lexically and a reading looks eight hours stale.
 */
export function frameAt(nowMs: number): string {
  return new Date(nowMs).toISOString()
}
