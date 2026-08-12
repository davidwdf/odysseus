import { type FeedNotice as FeedNoticeView, feedNotice } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useLocale } from '../providers/LocaleProvider'

/**
 * The one line a screen says when it has stopped being fed (ADR-133).
 *
 * **One component because there is one sentence.** Nearby, Place detail, Route detail and Favourites all
 * need it, and a second copy would be a second wording — which is the whole failure mode this replaces: two
 * per-reading staleness cues were built and withdrawn (ADR-123) partly because a cue at the wrong grain
 * cannot be reviewed as one thing.
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
    // `role="status"` so a screen reader is told when the screen stops being fed without the focus moving —
    // the notice appears while a rider is reading, not in response to anything they did.
    <p role="status" className="m-0 px-4 pt-2 pb-1 text-label text-muted">
      {text}
    </p>
  )
}

/** Re-exported so a screen imports the rule and the component from one place. */
export { feedNotice }
