import type { Locale, StopCardRow, StopCardView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ChevronRight, MapPin } from 'lucide-react'
import { BearingArrow } from './BearingArrow'
import { EtaBadge } from './EtaBadge'
import { RemarkTag } from './RemarkTag'
import { RouteChip } from './RouteChip'
import { StopName } from './StopName'

// **This component derives nothing**, and neither does its RN twin (`components/StopRow.tsx`). Both
// receive a `StopCardView` from `stopCardView`/`nearbyView` in `@nextbus/core` and decide only what a
// DOM can decide that a native view cannot, and vice versa: element semantics, hover, focus rings.
//
// That is the WP4-1 claim in one file. If a rule appeared here — a cap, a sort, a string join, a
// threshold — it would be a *second* declaration of something the kernel already owns, and the two
// renderers would agree only until someone edited one of them. `scripts/check-no-derivation.mjs`
// fails the build on the shapes that would signal it.

/** One route's row: chip, "→ destination", and the next-ETA badge. */
function RouteRow({ row, onPress }: { row: StopCardRow; onPress?: (routeId: string) => void }) {
  const content = (
    <div className="flex flex-1 items-center gap-2.5">
      <RouteChip operator={row.operator} routeNo={row.routeNo} />
      <div className="min-w-0 flex-1">
        {row.headline ? (
          <div className="truncate text-body text-text">
            <span className="text-subtle">→ </span>
            {row.headline}
          </div>
        ) : null}
        {row.remark ? <RemarkTag remark={row.remark} /> : null}
      </div>
    </div>
  )
  const inner = (
    <>
      {content}
      <EtaBadge label={row.label} urgency={row.urgency} stale={row.stale} />
    </>
  )
  // A real `<button>` when it navigates, a plain `<div>` when it does not — so keyboard focus and the
  // accessible role come from the element rather than from an ARIA attribute. The RN twin reaches the
  // same place through `Pressable accessibilityRole="button"`; this is the platform half of the line.
  return onPress ? (
    <button
      type="button"
      onClick={() => onPress(row.routeId)}
      className="flex w-full items-center justify-between gap-3 border-0 bg-transparent py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-50"
    >
      {inner}
    </button>
  ) : (
    <div className="flex items-center justify-between gap-3 py-1.5">{inner}</div>
  )
}

/**
 * A stop card as a flat list section (docs/09: the data is the hero — no floating card chrome). The
 * heading and each route row are *sibling* tap targets, never nested, because a button inside a button
 * is invalid HTML — the same constraint that shaped the RN version, for the same reason.
 */
export function StopCard({
  view,
  locale,
  onPress,
  onRoutePress,
}: {
  view: StopCardView
  /** For the "+N more" phrase, and only that: the kernel supplies the count, the ICU catalogue the
   *  plural rule and the wording (ADR-054). */
  locale: Locale
  onPress?: () => void
  onRoutePress?: (routeId: string) => void
}) {
  const heading = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <StopName name={view.name} />
        {view.caption ? (
          <div className="mt-0.5 flex items-center gap-1">
            {/* The compass needle when this is a merged place, else a generic pin. Which glyph is this
                component's business; whether there is a direction to draw is the model's. */}
            {view.bearingDeg != null ? (
              <BearingArrow bearingDeg={view.bearingDeg} />
            ) : (
              <MapPin aria-hidden width={13} height={13} className="shrink-0 text-subtle" />
            )}
            {/* `whitespace-pre-wrap` is load-bearing, not cosmetic. `stopCardCaption` uses two
                separator widths on purpose — `' · '` binds a distance to its own walk time, a wider
                `'  ·  '` separates that pair from the compass direction — and **HTML collapses
                consecutive whitespace**, so without this the web caption reads
                "Southwest-bound · 0m · 1 min walk" where React Native reads
                "Southwest-bound  ·  0m · 1 min walk". Found by test/nearby-projection.test.tsx, which
                is the first thing this second renderer caught that no amount of reading would have. */}
            <span className="whitespace-pre-wrap text-caption text-subtle">{view.caption}</span>
          </div>
        ) : null}
      </div>
      {onPress ? (
        <ChevronRight aria-hidden width={20} height={20} className="shrink-0 text-subtle" />
      ) : null}
    </div>
  )

  return (
    <section className="px-4 py-4">
      {onPress ? (
        <button
          type="button"
          onClick={onPress}
          className="w-full border-0 bg-transparent p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
        >
          {heading}
        </button>
      ) : (
        heading
      )}
      <div className="mt-2">
        {view.rows.map((row) => (
          <RouteRow key={row.routeId} row={row} onPress={onRoutePress} />
        ))}
        {/* **The count is shown whether or not it can be tapped.** `remaining > 0 && onPress` — which is
            what both renderers had — makes the card silently show 6 of 26 routes for any caller with
            nowhere to navigate, and this app is exactly that caller. Hiding an honest total because the
            affordance is unavailable is the silent filter ADR-008 forbids; the tap is optional, the
            truth is not. Found by putting the same view in front of a second renderer. */}
        {view.remaining > 0 ? (
          onPress ? (
            <button
              type="button"
              onClick={onPress}
              className="flex items-center gap-1 border-0 bg-transparent py-1.5 text-label text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-50"
            >
              {t(locale, 'moreRoutes', { n: view.remaining })}
              <ChevronRight aria-hidden width={15} height={15} />
            </button>
          ) : (
            <p className="m-0 py-1.5 text-label text-muted">
              {t(locale, 'moreRoutes', { n: view.remaining })}
            </p>
          )
        ) : null}
      </div>
    </section>
  )
}
