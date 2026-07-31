// The fake: a scripted server, in memory.
//
// WHY A FAKE IS A DELIVERABLE AND NOT TEST SCAFFOLDING
// Two acceptance criteria in this wave are unmeasurable without it. WP5-1's is *"byte-identical listener
// output from the poll emulator and a `MemoryTransport` fake"* — there is no other way to state what a
// socket would have sent for a given round of data without running a socket. WP5-2's is the seam proof:
// a `FakeSocketDataSource` substituted for the `EdgeClient` behind `DataSource`, feeding a real screen,
// and the engine underneath that fake is this file. So it ships in `src/`, not in `test/`, and it is
// exported from the package.
//
// WHY IT REPLAYS ON `subscribe` AND NOT ON `open`
// Because that is when a real server has something to reply to, and — more usefully — it is when the
// poll emulator starts its first round. A fake that replayed on `open` would deliver its snapshot before
// the controller had declared its targets, which is a sequence no server can produce, so a controller
// bug that depended on the order would be hidden by the fake and appear only against a socket.

import type { ClientFrame, ServerFrame } from '@nextbus/core'
import type { LiveTransportSink } from '@nextbus/ports'
import type { LiveEngine, LiveEtaEngine } from './engine'

/** A `MemoryTransport` plus the two things a test needs to see: what was sent, and what was replayed. */
export interface MemoryTransport extends LiveEtaEngine {
  /** Every client frame this transport was handed, in order. */
  readonly sent: readonly ClientFrame[]
  /** How many frames of the script have been delivered. */
  readonly delivered: number
}

export interface MemoryTransportOptions {
  /**
   * What this fake is standing in for. `'socket'` by default, because that is the only reason to have
   * it: a `MemoryTransport` labelled `'poll'` would be a poll emulator that does not poll.
   */
  engine?: LiveEngine
  /**
   * Replay the script again on a second `subscribe` (a resync). Off by default: a resync re-declares
   * targets a real server answers with a *fresh* snapshot, and a fake that re-ran a script containing
   * deltas would replay history as if it were news. A scenario that needs a post-resync snapshot puts
   * it in the script and asserts the resubscribe through `sent`.
   */
  replayOnResubscribe?: boolean
}

/**
 * A `LiveTransport` that replays a fixed frame sequence — the frames a server would have sent.
 *
 * Delivery is **synchronous and in order**, inside the `send()` call that triggers it. That is a
 * deliberate constraint on the controller rather than a convenience: it means a transport may call the
 * sink re-entrantly, before `send` has returned, and any controller that only worked because a real
 * socket happens to deliver on a later task fails here loudly instead of in production against a
 * `MemoryTransport`-shaped native implementation.
 */
export function createMemoryTransport(
  script: readonly ServerFrame[],
  options: MemoryTransportOptions = {},
): MemoryTransport {
  const sent: ClientFrame[] = []
  let sink: LiveTransportSink<ServerFrame> | null = null
  let delivered = 0
  let closed = false
  let replayed = false

  const replay = () => {
    for (const frame of script) {
      if (closed) return
      delivered += 1
      sink?.frame(frame)
    }
  }

  return {
    engine: options.engine ?? 'socket',
    get sent() {
      return sent
    },
    get delivered() {
      return delivered
    },
    open(nextSink) {
      sink = nextSink
    },
    send(frame) {
      sent.push(frame)
      if (frame.type !== 'subscribe') return
      if (replayed && options.replayOnResubscribe !== true) return
      replayed = true
      replay()
    },
    close() {
      closed = true
      sink = null
    },
  }
}
