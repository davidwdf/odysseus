import type { OperatorId } from '@nextbus/core'
import { OPERATOR_ACCENT, OPERATOR_ACCENT_TEXT } from '@nextbus/ui'

/** The route-number chip in operator livery — the one sanctioned use of an operator accent as a
 *  background (docs/09 §2). The two colour tables are the generated ones from `@nextbus/ui`, so this
 *  and the RN chip cannot disagree about what KMB red is. */
export function RouteChip({ operator, routeNo }: { operator: OperatorId; routeNo: string }) {
  return (
    <span
      className="inline-flex min-w-[44px] justify-center rounded-md px-2 py-1 text-label font-bold"
      style={{ backgroundColor: OPERATOR_ACCENT[operator], color: OPERATOR_ACCENT_TEXT[operator] }}
    >
      {routeNo}
    </span>
  )
}
