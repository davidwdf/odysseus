// Tunable client policy — the numbers the server owns. See the three rules at the top of
// `primitives.ts`, and ADR-053 for the line these fields sit on.
//
// ADR-052 separates three kinds of change, and this file is the third: **tunable policy**. A wire
// shape is generated everywhere from one declaration; a domain rule is hand-ported and pinned by the
// fixture corpus; but a *number* — how many arrivals a row shows, how often to refetch — needs
// neither, because no platform has to hold it at all. Served at runtime, it is one edge deploy
// instead of three store releases.
//
// **Every field is optional, and that is the mechanism rather than a formality.** ADR-052 §5 makes
// additive-optional free, so a seventh knob lands without ceremony; but the reason it matters *here*
// is that a partial policy has to be a legal policy. The edge may want to move one threshold and say
// nothing about the other five, and a client three versions old must be able to read that document
// and fill the rest from its own defaults. `resolveClientPolicy` in `@nextbus/core` is the one place
// that filling happens.
//
// **What is deliberately not here: anything the client owns.** No colours, no sizes, no durations of
// animations. `check-vm-no-styling.mjs` enforces that mechanically over the emitted document, so the
// temptation to send `dueColor: "#f59e0b"` the next time a threshold needs a tone fails a gate rather
// than a review.

import { z } from 'zod'

/**
 * Runtime-tunable presentation policy: counts, cadences and the honesty thresholds of ADR-008.
 *
 * The units are in the field names on purpose (`…Sec`, `…Ms`). These values are read by three
 * languages, at least one of which (Swift) has a first-class duration type that a bare `staleAfter`
 * would invite someone to guess the units of — and a threshold guessed wrong by a factor of 1000
 * shows a rider a fresh arrival as stale, or an hour-old one as live.
 */
export const ClientPolicySchema = z
  .object({
    dueUnderSec: z
      .number()
      .optional()
      .describe(
        'Under this many seconds to arrival, show "Due"/"Arriving" rather than a number (ADR-008 — never fabricate sub-minute precision). Also the symmetric tolerance band for treating a just-passed reading as still present rather than departed.',
      ),
    warnUnderSec: z
      .number()
      .optional()
      .describe(
        "Under this many seconds, the arrival is imminent enough to deserve emphasis. The threshold is the server's; **how** it is emphasised is the client's — a tone, a weight, a haptic. See ADR-053.",
      ),
    staleAfterMs: z
      .number()
      .optional()
      .describe(
        'A reading whose `dataTimestamp` is older than this is presented as stale. Data quality, not an error: the value is still shown, labelled.',
      ),
    refreshAfterMs: z
      .number()
      .optional()
      .describe(
        "How often a client should refetch live arrivals. Matched to the edge's own coalescing TTL (ADR-057) — polling faster returns a byte-identical cached response and buys nothing but battery.",
      ),
    maxArrivals: z.number().optional().describe('How many upcoming arrivals one route row shows.'),
    maxRows: z
      .number()
      .optional()
      .describe('How many route rows a compact stop card shows before it collapses to "+N more".'),
  })
  .meta({ id: 'ClientPolicy' })
