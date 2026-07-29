import type { RemarkKind, RemarkView } from '@nextbus/core'
import { Text } from './Text'

// Tone by remark class (ADR-036): all operator remarks render in the same subtle, muted
// tone — the honesty cue lives in the "Scheduled" wording itself, not a colour. Tokens only.
//
// **This table is the client half of ADR-053's line, and it belongs here.** The server says *what
// kind* of remark it is (content); this decides that a kind renders in `text-subtle` (colour). A
// served `remarkColor: "#64748b"` would look like the same information and would be wrong — it renders
// outside iOS's colour system, so it ignores Dark Mode and Increase Contrast, and nothing on this side
// of the network could fail on it. `scripts/check-vm-no-styling.mjs` polices the wire for exactly that
// and deliberately does not look at files like this one.
//
// That every kind currently maps to the same token is not redundancy: it is the record of a decision
// (ADR-036 — the wording carries the honesty cue, not a colour), and the table is where a future
// divergence would go.
const TONE: Record<RemarkKind, string> = {
  scheduled: 'text-subtle',
  lastBus: 'text-subtle',
  info: 'text-subtle',
}

/**
 * Surfaces an operator ETA remark (e.g. "Scheduled", "Last bus", a diversion note) that we
 * already parse into `Eta.remark` but never showed.
 *
 * Takes an **already-reduced** remark: the locale lookup, the empty-in-this-locale check, and the
 * `remarkKind ?? classifyRemark(...)` fallback all moved into the kernel in WP4-0, because each is a
 * rule and all three were reachable only by rendering this component. In particular the fallback —
 * which is what lets an offline replay (ADR-058) or an older edge classify identically, using *the
 * same function the edge calls* — is now pinned by a corpus row rather than by this comment.
 *
 * `TONE[kind]` keeps its `??` fallback because `RemarkKind` is `x-unknown-tolerant`: the server may
 * mint a class this build has never heard of, and the app does no runtime validation (ADR-052
 * decision 2), so an unknown kind must render as an ordinary remark rather than as `undefined`.
 */
export function RemarkTag({ remark }: { remark: RemarkView }) {
  const tone = TONE[remark.kind] ?? TONE.info
  return (
    <Text variant="caption" className={`mt-0.5 ${tone}`} numberOfLines={1}>
      {remark.text}
    </Text>
  )
}
