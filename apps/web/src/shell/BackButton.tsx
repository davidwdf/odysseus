import { t } from '@nextbus/i18n'
import { ChevronLeft } from 'lucide-react'
import { useNavigate, useNavigationType } from 'react-router'
import { useLocale } from '../providers/LocaleProvider'

/**
 * Back, for the destinations that are pushed rather than switched to.
 *
 * **Back semantics are identity** under ADR-075, and this is the web's honest reading of the RN app's:
 * there, a pushed screen sits on a native `<Stack>` and back pops it. Here, back is a history pop —
 * except when there is nothing to pop, which the DOM makes possible in a way a stack does not. A rider
 * who opens `/faq` from a bookmark, a shared link, or an installed PWA's launch URL has that entry as
 * the *first* in its history: `navigate(-1)` would leave the browser (or, in standalone mode, do
 * nothing at all and strand them with no chrome to escape by).
 *
 * `useNavigationType()` distinguishes the two: `PUSH` means this app put the entry there and a pop
 * returns inside it; `POP` or `REPLACE` means it was a cold arrival, so the control goes *up* to Nearby
 * instead. One control, two behaviours, neither of them a dead end.
 *
 * It is a `<button>` rather than a `<Link>` because in the common case the target is "wherever you came
 * from", which is not a URL this component knows.
 */
export function BackButton() {
  const locale = useLocale()
  const navigate = useNavigate()
  const cameFromInsideTheApp = useNavigationType() === 'PUSH'
  return (
    <button
      type="button"
      onClick={() => (cameFromInsideTheApp ? navigate(-1) : navigate('/'))}
      className="inline-flex min-h-[44px] items-center gap-1 rounded-pill border border-border bg-surface pl-2 pr-4 text-label text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <ChevronLeft aria-hidden width={20} height={20} />
      {t(locale, 'back')}
    </button>
  )
}
