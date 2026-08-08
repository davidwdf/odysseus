import type { Locale, RouteStopRowView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MapPin, Star } from 'lucide-react'
import { usePreferences } from '../lib/preferences'
import { BottomSheet, SheetAction } from './BottomSheet'

/**
 * What a tap on a stop row opens — the DOM twin of the action sheet in `apps/mobile/app/route/[id].tsx`,
 * and **the affordance that creates a favourite**.
 *
 * ## Why this is a blocker rather than a nicety
 *
 * `route-detail.spec.json` has declared this interaction non-optionally since WP6-6b — *"a sheet offering to
 * save this route at this stop, or to open the stop's place"*, with a note saying **deliberately not
 * straight to the place**, because the row's primary purpose is saving the route at that pole (ADR-042) and
 * a tap that navigated away would make the common action the harder one. `apps/web` navigated straight to
 * the place anyway, and nothing caught it: `conformStates` asserts text and nesting and **never interaction
 * destinations**, so a declared interaction going somewhere else is invisible to the whole spec apparatus.
 *
 * The consequence was larger than one screen. ADR-032 makes this sheet the app's *only* favourite-creating
 * affordance, so `toggleFavoriteRoute` had zero callers in `apps/web` and its Favourites tab could never be
 * filled by a web-only rider. Found by WP6-7b's parity audit — by four auditors independently, and by none
 * of the gates.
 *
 * ## The container is the shared `BottomSheet` now
 *
 * This file used to carry its own centred `<dialog>` and its own `SheetAction`, arguing that a modal dialog
 * was the web's honest answer where `apps/mobile` slides a panel up from the bottom edge. ADR-100 moves the
 * sheet to the identity side, and `components/BottomSheet.tsx` is the twin — same two-stage entrance, same
 * drag-to-dismiss, and it keeps every accessibility property the old argument was really about, because it
 * is still a `<dialog>` underneath. The content and its order are unchanged.
 *
 * ## What it is *not*, stated because the next reader will look for it
 *
 * The sheet's own content is not a declared state in either renderer's spec. It is an interaction result,
 * and ADR-092's line — a spec cannot hold an interaction, but it can hold what a rider infers from one —
 * says the spec-able part is the *row*, which already declares `saved`. Both suites assert this sheet's
 * words and both its actions directly instead, which is the same division `search.spec.json` makes for a
 * keypad key's `enabled`. Giving it a spec of its own is a follow-up in `docs/07`, and it would have to spec
 * the native sheet at the same time.
 */
export function RouteStopSheet({
  row,
  routeId,
  routeNo,
  destination,
  locale,
  onClose,
  onViewStop,
}: {
  row: RouteStopRowView
  routeId: string
  routeNo?: string
  destination: string
  locale: Locale
  onClose: () => void
  onViewStop: () => void
}) {
  const toggle = usePreferences((s) => s.toggleFavoriteRoute)
  // `row.saved` is the kernel's answer for this route at this pole — `routeDetailView` computes it from the
  // same `savedRouteKeys` the screen already passes, so the sheet and the node's star cannot disagree.
  const saved = row.saved

  return (
    <BottomSheet
      titleId={TITLE_ID}
      onClose={onClose}
      header={
        <div className="flex flex-col gap-2 pb-2">
          {/* The tapped stop leads — it is what the rider just touched. The name is the **row's own**, which
              is what stops this sheet and the row it came from disagreeing: on native it used to be a second
              spelling of `displayName` eleven lines away (WP6-6a). */}
          <div className="flex items-center gap-2">
            <MapPin size={18} aria-hidden className="shrink-0 text-text" />
            <h2 id={TITLE_ID} className="m-0 min-w-0 flex-1 text-h3 font-semibold text-text">
              {row.name.label}
            </h2>
          </div>
          {/* The route context, demoted to a quiet line — the livery chip's shape without its brand colour,
              because the header behind this sheet is already liveried. */}
          <div className="flex items-center gap-2">
            {routeNo ? (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-caption font-bold text-surface">
                {routeNo}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-caption text-muted">
              <span className="text-subtle">→ </span>
              {destination}
            </span>
          </div>
        </div>
      }
    >
      {(close) => (
        <>
          <SheetAction
            icon={Star}
            filled={saved}
            label={t(locale, saved ? 'removeFavorite' : 'addFavorite')}
            onClick={() => {
              toggle(row.stopId, routeId)
              close()
            }}
          />
          <SheetAction icon={MapPin} label={t(locale, 'viewStop')} onClick={onViewStop} />
        </>
      )}
    </BottomSheet>
  )
}

/** The heading's id, wired to the dialog's `aria-labelledby`. Static because only one sheet is ever open. */
const TITLE_ID = 'route-stop-sheet-title'
