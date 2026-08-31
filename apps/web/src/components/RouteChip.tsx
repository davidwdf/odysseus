import type { OperatorId } from '@nextbus/core'
import { OPERATOR_ACCENT, OPERATOR_ACCENT_TEXT } from '@nextbus/ui'
import type { Ref } from 'react'

/**
 * The route-number chip in operator livery — the one sanctioned use of an operator accent as a
 * background (docs/09 §2). The two colour tables are the generated ones from `@nextbus/ui`, so this
 * and the RN chip cannot disagree about what KMB red is.
 *
 * **Two sizes, one shape.** `lg` is the route header's, and it exists here rather than as a bespoke
 * badge in that screen because a route number should look like a route number everywhere: same corner,
 * same minimum width, same livery, more type. The header grew its own square accent-coloured badge for
 * a while and it read as a different object — which it was.
 */
export function RouteChip({
  operator,
  routeNo,
  size = 'md',
  chipRef,
}: {
  operator: OperatorId
  routeNo: string
  size?: 'md' | 'lg'
  /** For the header's collapse travel — see `useFlip`. */
  chipRef?: Ref<HTMLSpanElement>
}) {
  return (
    <span
      ref={chipRef}
      className={`inline-flex justify-center rounded-md font-bold ${
        size === 'lg'
          ? 'min-w-[52px] px-2.5 py-1.5 text-title'
          : 'min-w-[44px] px-2 py-1 text-label'
      }`}
      style={{ backgroundColor: OPERATOR_ACCENT[operator], color: OPERATOR_ACCENT_TEXT[operator] }}
    >
      {routeNo}
    </span>
  )
}
