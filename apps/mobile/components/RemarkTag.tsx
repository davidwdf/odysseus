import { classifyRemark, type I18nText, type Locale } from '@nextbus/core'
import { Text } from './Text'

// Tone by remark class (ADR-036): all operator remarks render in the same subtle, muted
// tone — the honesty cue lives in the "Scheduled" wording itself, not a colour. Tokens only.
const TONE: Record<ReturnType<typeof classifyRemark>, string> = {
  scheduled: 'text-subtle',
  lastBus: 'text-subtle',
  info: 'text-subtle',
}

/**
 * Surfaces an operator ETA remark (e.g. "Scheduled", "Last bus", a diversion note) that we
 * already parse into `Eta.remark` but never showed. Renders nothing when the remark is empty.
 */
export function RemarkTag({ remark, locale }: { remark: I18nText; locale: Locale }) {
  const text = remark[locale]
  if (!text) return null
  return (
    <Text variant="caption" className={`mt-0.5 ${TONE[classifyRemark(remark)]}`} numberOfLines={1}>
      {text}
    </Text>
  )
}
