import { type FeedNotice as FeedNoticeView, feedNotice } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useLocale } from '../providers/LocaleProvider'
import { Text } from './Text'

/**
 * The one line a screen says when it has stopped being fed (ADR-133), on this renderer since ADR-150.
 *
 * **One component per renderer because there is one sentence, and the sentence is the shared half.** Which
 * of the four states a screen is in is `feedNotice`'s call — a kernel rule with nine corpus rows and a
 * precedence that makes the states exclusive — and every screen spec projects it as a `oneOf` over
 * `notice.kind`, so both renderers are held to the same words in the same place. What is idiom is the
 * element and the type variant; what is identity is that the line exists at all.
 *
 * **It renders nothing when there is nothing to say**, which is the ordinary case. A notice that shows while
 * everything works is one riders learn to ignore before the day it matters — ADR-122's lesson, from a stale
 * cue that fired on healthy Citybus data every cycle.
 *
 * **`text-muted`, never a warning colour.** Nothing is wrong with the rider's stop: either their network is
 * down, or ours is, or the data is simply old. It is an explanation, not an alarm — the same reasoning
 * `etasUnavailable` carries on a card (ADR-077).
 */
export function FeedNotice({ notice }: { notice: FeedNoticeView }) {
  const locale = useLocale()
  if (notice.kind === 'none') return null
  const text =
    notice.kind === 'lastUpdated'
      ? t(locale, 'feedLastUpdated', { time: notice.at })
      : notice.kind === 'offline'
        ? t(locale, 'feedOffline')
        : t(locale, 'feedUnreachable')
  return (
    // `accessibilityLiveRegion` / `aria-live` so a screen reader is told when the screen stops being fed
    // without the focus moving — the notice appears while a rider is reading, not in response to anything
    // they did. Both props are passed for the reason ADR-098 records: `react-native-web@0.21` drops
    // `accessibilityState` silently and RN 0.85 does not carry every `aria-*`, so a control that says it
    // only one way says it on one platform.
    <Text
      variant="label"
      className="px-4 pb-1 pt-2 text-muted"
      accessibilityLiveRegion="polite"
      aria-live="polite"
      role="status"
    >
      {text}
    </Text>
  )
}

/** Re-exported so a screen imports the rule and the component from one place. */
export { feedNotice }
