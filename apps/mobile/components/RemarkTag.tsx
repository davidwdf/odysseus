import { classifyRemark, type I18nText, type Locale, type RemarkKind } from '@nextbus/core'
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
 * already parse into `Eta.remark` but never showed. Renders nothing when the remark is empty.
 *
 * `kind` is the server's classification (`Eta.remarkKind`, ADR-053). It is optional and falls back to
 * `classifyRemark` — **the same kernel function the edge calls** — so a payload replayed from the
 * offline cache, or served by an edge older than the field, classifies identically rather than
 * degrading. One rule, two callers; never two implementations.
 *
 * `TONE[kind]` is indexed with a `??` fallback because the enum is `x-unknown-tolerant`: the server
 * may mint a class this build has never heard of, and the app does no runtime validation (ADR-052
 * decision 2), so an unknown kind must render as an ordinary remark rather than as `undefined`.
 */
export function RemarkTag({
  remark,
  locale,
  kind,
}: {
  remark: I18nText
  locale: Locale
  kind?: RemarkKind
}) {
  const text = remark[locale]
  if (!text) return null
  const tone = TONE[kind ?? classifyRemark(remark)] ?? TONE.info
  return (
    <Text variant="caption" className={`mt-0.5 ${tone}`} numberOfLines={1}>
      {text}
    </Text>
  )
}
