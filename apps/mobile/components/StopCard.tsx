import type { Eta, Locale } from '@nextbus/core'
import { Pressable, View } from 'react-native'
import { Card } from './Card'
import { EtaBadge } from './EtaBadge'
import { RouteChip } from './RouteChip'
import { Text } from './Text'

function routeNo(routeId: string): string {
  return routeId.split(':')[1] ?? routeId
}

export function StopCard({
  name,
  etas,
  locale,
  now,
  onPress,
}: {
  name: string
  etas: Eta[]
  locale: Locale
  now: number
  /** Tap target — navigates to the stop-detail screen. */
  onPress?: () => void
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      className="active:opacity-70"
    >
      <Card className="p-4">
        <Text variant="h3" className="mb-3 text-text">
          {name}
        </Text>
        <View className="gap-3">
          {etas.map((eta) => (
            <View key={eta.routeId} className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <RouteChip operator={eta.operator} routeNo={routeNo(eta.routeId)} />
                {eta.remark?.[locale] ? (
                  <Text variant="label" className="text-muted">
                    {eta.remark[locale]}
                  </Text>
                ) : null}
              </View>
              <EtaBadge eta={eta} locale={locale} now={now} />
            </View>
          ))}
        </View>
      </Card>
    </Pressable>
  )
}
