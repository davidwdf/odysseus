import type { OperatorId } from '@nextbus/core'
import type { SharedValue } from 'react-native-reanimated'
import { CollapsingHeader, collapsedHeaderH, expandedHeaderH } from './CollapsingHeader'
import { RouteChip } from './RouteChip'

// Route + stop headers share one collapsing-chrome implementation (ADR-033 → CollapsingHeader),
// so the two screens feel like one family. Re-export the height helpers the route screen already
// imports from here.
export { collapsedHeaderH, expandedHeaderH }

/**
 * The route-detail header: a `CollapsingHeader` whose morphing **badge** is the route chip
 * and whose marquee **label** is the `A → B` line. No bar background; on scroll the chip
 * morphs into a glass pill beside the back lens (ADR-033).
 */
export function RouteHeader({
  operator,
  routeNo,
  routeLabel,
  scrollY,
  insetTop,
  onBack,
  onTitlePress,
}: {
  operator: OperatorId
  routeNo: string
  routeLabel: string
  scrollY: SharedValue<number>
  insetTop: number
  onBack: () => void
  /** Tap the header (anywhere but the back button) → scroll the list to the top. */
  onTitlePress?: () => void
}) {
  return (
    <CollapsingHeader
      badge={<RouteChip operator={operator} routeNo={routeNo} />}
      label={routeLabel}
      scrollY={scrollY}
      insetTop={insetTop}
      onBack={onBack}
      onTitlePress={onTitlePress}
    />
  )
}
