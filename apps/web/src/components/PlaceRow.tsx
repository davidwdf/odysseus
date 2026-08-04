import type { PlaceRouteRow } from '@nextbus/core'
import { EtaBadge } from './EtaBadge'
import { RemarkTag } from './RemarkTag'
import { RouteChip } from './RouteChip'

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
 * The saved-state star the RN row carries is absent here and is declared **idiom** in the spec: favourites
 * are `apps/web`'s at WP6-4, which also inherits the hoist of ADR-062's key migration (ADR-082 decision 5).
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
        <EtaBadge
          label={row.readout.label}
          urgency={row.readout.urgency}
          stale={row.readout.stale}
        />
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
  return onPress ? (
    <button
      type="button"
      onClick={() => onPress(row)}
      className="flex w-full items-center justify-between gap-3 border-0 bg-transparent px-4 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-50"
    >
      {inner}
    </button>
  ) : (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5">{inner}</div>
  )
}
