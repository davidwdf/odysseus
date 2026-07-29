import type { RemarkKind, RemarkView } from '@nextbus/core'

// All remark classes render in the same subtle tone (ADR-036): the honesty cue is in the "Scheduled"
// wording, not a colour. The table is kept — rather than collapsed to one class — because it is the
// record of that decision and the place a future divergence would go.
const TONE: Record<RemarkKind, string> = {
  scheduled: 'text-subtle',
  lastBus: 'text-subtle',
  info: 'text-subtle',
}

/** An operator remark, already reduced to one locale and classified by `remarkView` in the kernel. */
export function RemarkTag({ remark }: { remark: RemarkView }) {
  return (
    <div className={`mt-0.5 truncate text-caption ${TONE[remark.kind] ?? TONE.info}`}>
      {remark.text}
    </div>
  )
}
