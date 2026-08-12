import type { PlaceRouteRow } from '@nextbus/core'
import { EtaBadge } from './EtaBadge'
import { RemarkTag } from './RemarkTag'
import { RouteChip } from './RouteChip'
import { SaveStar } from './SaveStar'

/**
 * One route at one boarding point — the DOM twin of `RouteRowItem` in `apps/mobile/app/stop/[id].tsx`, and
 * the component `packages/contract/ui/place-row.spec.json` declares.
 *
 * **It decides nothing.** Every string in it — the destination, the remark, and the right-hand readout with
 * its three-way fall-back to a published frequency — arrives on the `PlaceRouteRow` the kernel derived
 * (ADR-085). The middle arm is the one a renderer forgets: a route with no live reading but a timetable is
 * not a route with nothing to say, and the spec's nested `oneOf` is what turns that into a failing test
 * rather than a silence.
 *
 * ## The saved-state star, and the comment that used to stand here
 *
 * This file used to say the star was *"absent here and declared **idiom** in the spec"*, on the grounds that
 * favourites were `apps/web`'s at WP6-4. WP6-7b's parity audit found the premise false: WP6-4 ported the
 * screen that *reads* favourites and neither affordance that *writes* one, so `toggleFavoriteRoute` had zero
 * callers and this app could not create a favourite at all. The star is a real control on both renderers now.
 *
 * It is a **sibling** of the row's button and never nested inside it — `sibling-not-nested` (ADR-024) would
 * fail otherwise, and a tap target inside a tap target is ambiguous on every platform. That is also why the
 * row's own button is `flex-1` rather than `w-full`.
 */
export function PlaceRow({
  row,
  onPress,
}: {
  row: PlaceRouteRow
  onPress?: (row: PlaceRouteRow) => void
}) {
  const inner = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <RouteChip operator={row.operator} routeNo={row.routeNo} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-text">
            <span className="text-subtle">→ </span>
            {row.destination}
          </span>
          {row.remark ? <RemarkTag remark={row.remark} /> : null}
        </span>
      </span>
      {row.readout.kind === 'eta' ? (
        <EtaBadge label={row.readout.label} urgency={row.readout.urgency} />
      ) : row.readout.kind === 'headway' ? (
        <span className="max-w-[120px] shrink-0 text-right text-caption text-subtle">
          {row.readout.text}
        </span>
      ) : (
        <span className="shrink-0 text-h3 text-subtle">—</span>
      )}
    </>
  )
  // A real `<button>` when it navigates and a plain row when it does not, so the role and keyboard focus
  // come from the element rather than from an ARIA attribute — the same split `StopCard` makes. The
  // `content-not-affordance` check is what holds the two to showing the identical text either way.
  return (
    <div className="flex items-center">
      {onPress ? (
        <button
          type="button"
          onClick={() => onPress(row)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 border-0 bg-transparent py-1.5 pr-2 pl-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-50"
        >
          {inner}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 py-1.5 pr-2 pl-4">
          {inner}
        </div>
      )}
      {/* Nothing until the route is saved, exactly as on native: the affordance that *creates* a favourite
          is the route schematic's sheet, so an unsaved row stays uncluttered. It carries no text node, so
          it changes no projection — which is why the spec can go on calling it idiom. */}
      <SaveStar
        stopId={row.stopId}
        routeId={row.routeId}
        size={20}
        hideWhenEmpty
        className="mr-1"
      />
    </div>
  )
}
