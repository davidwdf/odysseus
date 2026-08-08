import type { Locale, RouteStopRowView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MapPin, Star, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { usePreferences } from '../lib/preferences'

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
 * ## The container is a `<dialog>`, for the reasons `RouteFactSheet` gives
 *
 * `apps/mobile` slides a `BottomSheet` up from the bottom edge with a drag handle, because a thumb reaches
 * the bottom of a phone. This is a native modal dialog: focus trapping, `Escape`, an inert backdrop and a
 * close control, which is what a keyboard and a screen reader need and what a pan gesture cannot give them.
 * Same content, same order, same two actions; a different idea of what "a sheet" is (ADR-075). And, as
 * there, **no dismiss-on-backdrop-click** — a click handler on the `<dialog>` itself is a handler on a
 * non-interactive element with no keyboard equivalent.
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
  const dialog = useRef<HTMLDialogElement | null>(null)
  const toggle = usePreferences((s) => s.toggleFavoriteRoute)
  // `row.saved` is the kernel's answer for this route at this pole — `routeDetailView` computes it from the
  // same `savedRouteKeys` the screen already passes, so the sheet and the node's star cannot disagree.
  const saved = row.saved

  useEffect(() => {
    // Capture the row that opened the sheet and restore focus to it on unmount: React tears the `<dialog>`
    // out of the document when the state clears, which skips the browser's own focus-restore step.
    const opener = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => opener?.focus()
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={TITLE_ID}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className="m-auto w-[min(32rem,92vw)] rounded-2xl border border-border bg-surface p-0 text-text backdrop:bg-black/50"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
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
        <button
          type="button"
          onClick={onClose}
          aria-label={t(locale, 'back')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-surface-2 text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col px-2 pt-1 pb-3">
        <SheetAction
          icon={
            <Star
              size={20}
              aria-hidden
              className="shrink-0 text-accent"
              fill={saved ? 'currentColor' : 'none'}
            />
          }
          label={t(locale, saved ? 'removeFavorite' : 'addFavorite')}
          onClick={() => {
            toggle(row.stopId, routeId)
            onClose()
          }}
        />
        <SheetAction
          icon={<MapPin size={20} aria-hidden className="shrink-0 text-muted" />}
          label={t(locale, 'viewStop')}
          onClick={onViewStop}
        />
      </div>
    </dialog>
  )
}

/** The heading's id, wired to the dialog's `aria-labelledby`. Static because only one sheet is ever open. */
const TITLE_ID = 'route-stop-sheet-title'

/** One full-width action row. A real `<button>`, so the role and keyboard focus come from the element. */
function SheetAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left text-body text-text hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      {icon}
      <span className="flex-1">{label}</span>
    </button>
  )
}
