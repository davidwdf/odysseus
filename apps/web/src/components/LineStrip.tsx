import type { HomeChip, Locale } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { RouteChip } from './RouteChip'

/**
 * **Every other route at this place, as badges with no reading** — the second half of a Home card.
 *
 * ## Why it carries no times, which is the part that looks like an omission and is not
 *
 * We do not know which of a stop's twenty-six routes a rider wants. Picking three and hiding
 * twenty-three behind a "+N more" is a guess wearing an answer's clothes — the silent filter ADR-008
 * forbids, with the diagnostic removed. A strip claims nothing and hides nothing, which is why the cap a
 * shortlist needs is absent from this half of the card entirely.
 *
 * ## Expanding is the view's; the collapsed count is not
 *
 * `HOME_CHIPS_COLLAPSED` comes from `@nextbus/core`. *"Show the first N and count the rest"* is
 * arithmetic over rows, which `check-no-derivation` bans here and which `stopCardView` already owns for
 * its own overflow — so the number is the kernel's and this file only slices at it. **Expanding is a
 * rider's tap**: interaction, not a domain rule, and it needs no arithmetic at all, because the expanded
 * strip is simply every chip it was given.
 *
 * ## `chipsMore` is the wire's shortfall, not this component's
 *
 * Zero on a card served by `/v1/board`, which sends a place's complete line-up (ADR-179) — so the badge
 * that appears there expands *in place* and reveals everything. Non-zero only against `/v1/nearby`,
 * which sends a count and not a list; there the remainder is honest and a tap on the place resolves it.
 * Both are true statements, and the component draws whichever it was handed rather than deciding which.
 */
export function LineStrip({
  chips,
  moreChips,
  more,
  locale,
  onPress,
}: {
  /** What the card draws collapsed — already capped by `homeView`. */
  chips: readonly HomeChip[]
  /** The rest of the place's line-up, revealed by the badge. */
  moreChips: readonly HomeChip[]
  /** Everything not currently drawn — the hidden chips plus what the wire never sent. */
  more: number
  locale: Locale
  onPress?: (routeId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (chips.length === 0) return null

  // **No slice here.** The cap is the kernel's (`HOME_CHIPS_COLLAPSED`, applied in `homeView`), which is
  // what keeps the published spec exact about what a card draws: a slot can say *these chips*, where
  // "the first six of these" is not something the conformance format can express.
  const shown = expanded ? [...chips, ...moreChips] : chips
  const hidden = expanded ? more - moreChips.length : more

  return (
    // No outer margin: the gap above the strip belongs to whoever puts it under a card, because only
    // that caller knows what it is sitting under. `Home` sets it; see the note there for the arithmetic.
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((chip) =>
        onPress ? (
          <button
            key={chip.routeId}
            type="button"
            onClick={() => onPress(chip.routeId)}
            className="border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
          >
            <RouteChip operator={chip.operator} routeNo={chip.routeNo} size="sm" />
          </button>
        ) : (
          <RouteChip key={chip.routeId} operator={chip.operator} routeNo={chip.routeNo} size="sm" />
        ),
      )}

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-caption font-bold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
        >
          {t(locale, 'homeMoreLines', { n: hidden })}
        </button>
      ) : null}

      {/* Only once there is something to collapse — an expanded strip that never had a badge has
          nothing to go back to, and a control that returns you where you already are is noise. */}
      {expanded && moreChips.length > 0 ? (
        <button
          type="button"
          aria-label={t(locale, 'homeFewerLines')}
          onClick={() => setExpanded(false)}
          className="flex h-6 w-7 items-center justify-center rounded-sm border border-border bg-surface-2 text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
        >
          <ChevronUp aria-hidden width={13} height={13} />
        </button>
      ) : null}
    </div>
  )
}
