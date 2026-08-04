import { t } from '@nextbus/i18n'
import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from './BackButton'
import type { Destination } from './destinations'

/**
 * What a destination whose screen has not been ported yet renders.
 *
 * **It exists so that "the shell is done" and "the screens are not" can both be true and visible.**
 * ADR-075 decision 5 ports one screen at a time, each behind a spec extracted from the working RN
 * renderer; WP6-0 is the shell and ports none of them. The alternative to this component was a router
 * whose table only listed Nearby — and then a tap or a deep link to any other destination would 404 or
 * silently redirect, which reads as *broken* rather than as *not yet here*. ADR-075's own state rule
 * says every state must be distinguishable and non-blank; "not built" is a state.
 *
 * The copy is `comingSoon`, which was already in the catalogue in all three locales (it labelled the
 * empty Routes tab before search shipped). **Nothing here needed a new string**, which is deliberate:
 * scaffolding that adds keys to the shared catalogue leaves them behind in the Swift and Kotlin string
 * catalogues generated from it, long after the scaffolding is gone.
 *
 * The two id-parameterised destinations have no `titleKey`, because a stop's or a route's heading is bus
 * *data* and never a catalogue string (CLAUDE.md rule 5). They show the id they were asked for instead
 * of a borrowed label — which is also the most useful thing a developer following a deep link can be
 * shown.
 */
export function Placeholder({
  destination,
  back,
  children,
}: {
  destination: Destination
  /** Set for a destination reached by a push, where the shell owes the rider a way out. */
  back?: boolean
  children?: ReactNode
}) {
  const locale = useLocale()
  const params = useParams()
  const named = destination.titleKey
  return (
    <main className="min-h-dvh bg-bg px-4 pb-8 pt-3">
      {back ? <BackButton /> : null}
      <h1 className="mb-1 mt-3 text-h1 font-bold text-text">
        {named ? t(locale, named) : t(locale, 'comingSoon')}
      </h1>
      {named ? <p className="m-0 text-body text-muted">{t(locale, 'comingSoon')}</p> : null}
      {params.id ? (
        // The canonical id from the URL, verbatim and selectable. Tabular figures because an id is read
        // character by character when it is being compared against something.
        <p className="m-0 mt-2 break-all text-label tabular-nums text-subtle">{params.id}</p>
      ) : null}
      {children}
    </main>
  )
}
