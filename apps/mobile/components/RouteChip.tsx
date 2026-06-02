import type { OperatorId } from '@nextbus/core'
import { OPERATOR_ACCENT, OPERATOR_ACCENT_TEXT } from '@nextbus/ui'
import { View } from 'react-native'
import { Text } from './Text'

/** The route-number chip in operator livery — the one sanctioned use of an operator
 *  accent as a background (docs/09 §2). Shared by StopCard and the detail screens. */
export function RouteChip({ operator, routeNo }: { operator: OperatorId; routeNo: string }) {
  return (
    <View
      className="min-w-[44px] items-center rounded-md px-2 py-1"
      style={{ backgroundColor: OPERATOR_ACCENT[operator] }}
    >
      <Text variant="label" weight="bold" style={{ color: OPERATOR_ACCENT_TEXT[operator] }}>
        {routeNo}
      </Text>
    </View>
  )
}
