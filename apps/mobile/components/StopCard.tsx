import type { Eta, Locale } from '@nextbus/core'
import { Pressable, View } from 'react-native'
import { Card } from './Card'
import { EtaBadge } from './EtaBadge'
import { RouteChip } from './RouteChip'
import { Text } from './Text'

function routeNo(routeId: string): string {
  return routeId.split(':')[1] ?? routeId
}

/** One route's chip + remark + next-ETA badge (a row inside a StopCard). */
function RouteRow({ eta, locale, now }: { eta: Eta; locale: Locale; now: number }) {
  return (
    <View className="flex-row items-center justify-between py-1">
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
  )
}

export function StopCard({
  name,
  etas,
  locale,
  now,
  onPress,
  onRoutePress,
}: {
  name: string
  etas: Eta[]
  locale: Locale
  now: number
  /** Tap the stop name (header) — navigates to the stop-detail screen. */
  onPress?: () => void
  /** Tap a single route row — navigates to that route (with this stop's context). */
  onRoutePress?: (routeId: string) => void
}) {
  // The stop name and each route row are *sibling* tap targets — never nested
  // (nested interactive elements are invalid on web). Header → stop, row → route.
  return (
    <Card className="p-4">
      {onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} className="mb-3 active:opacity-60">
          <Text variant="h3" className="text-text">
            {name}
          </Text>
        </Pressable>
      ) : (
        <Text variant="h3" className="mb-3 text-text">
          {name}
        </Text>
      )}
      <View className="gap-1">
        {etas.map((eta) =>
          onRoutePress ? (
            <Pressable
              key={eta.routeId}
              accessibilityRole="button"
              onPress={() => onRoutePress(eta.routeId)}
              className="active:opacity-50"
            >
              <RouteRow eta={eta} locale={locale} now={now} />
            </Pressable>
          ) : (
            <RouteRow key={eta.routeId} eta={eta} locale={locale} now={now} />
          ),
        )}
      </View>
    </Card>
  )
}
