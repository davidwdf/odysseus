import type { Eta, Locale } from '@nextbus/core'
import { formatDistance, formatWalk } from '@nextbus/core'
import { ChevronRight, MapPin } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { titleCaseName } from '../lib/stopName'
import { EtaBadge } from './EtaBadge'
import { Icon } from './Icon'
import { RouteChip } from './RouteChip'
import { StopName } from './StopName'
import { Text } from './Text'

function routeNo(routeId: string): string {
  return routeId.split(':')[1] ?? routeId
}

/** One route's chip + "→ destination" + next-ETA badge — a row beneath a stop heading.
 *  Destination falls back to the operator remark when the feed omits it. */
function RouteRow({ eta, locale, now }: { eta: Eta; locale: Locale; now: number }) {
  const dest = eta.destination?.[locale]
  const headed = dest ? titleCaseName(dest) : eta.remark?.[locale]
  return (
    <View className="flex-row items-center justify-between gap-3 py-1.5">
      <View className="flex-1 flex-row items-center gap-2.5">
        <RouteChip operator={eta.operator} routeNo={routeNo(eta.routeId)} />
        {headed ? (
          <Text variant="body" className="flex-1 text-text" numberOfLines={1}>
            <Text className="text-subtle">→ </Text>
            {headed}
          </Text>
        ) : null}
      </View>
      <EtaBadge eta={eta} locale={locale} now={now} />
    </View>
  )
}

/**
 * A nearby stop as a flat list section (docs/09: the data is the hero — no floating
 * card chrome). A tappable heading (name + distance · walk time + chevron) over the
 * route rows; heading and each row are *sibling* tap targets, never nested. The
 * caller draws the hairline divider between rows.
 */
export function StopRow({
  name,
  distanceM,
  etas,
  locale,
  now,
  onPress,
  onRoutePress,
}: {
  name: string
  /** Straight-line distance, metres. Omit on screens where distance is irrelevant
   *  (e.g. Favourites) — the distance/walk line is then hidden. */
  distanceM?: number
  etas: Eta[]
  locale: Locale
  now: number
  /** Tap the heading — navigates to the stop-detail screen. */
  onPress?: () => void
  /** Tap a single route row — navigates to that route (with this stop's context). */
  onRoutePress?: (routeId: string) => void
}) {
  const Heading = (
    <View className="flex-row items-start justify-between gap-3">
      <View className="flex-1">
        <StopName name={name} variant="h3" />
        {distanceM != null ? (
          <View className="mt-0.5 flex-row items-center gap-1">
            <Icon icon={MapPin} tone="subtle" size={13} />
            <Text variant="caption" className="text-subtle">
              {formatDistance(distanceM)} · {formatWalk(distanceM, locale)}
            </Text>
          </View>
        ) : null}
      </View>
      {onPress ? <Icon icon={ChevronRight} tone="subtle" size={20} /> : null}
    </View>
  )

  return (
    <View className="px-4 py-4">
      {onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-60">
          {Heading}
        </Pressable>
      ) : (
        Heading
      )}
      <View className="mt-2">
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
    </View>
  )
}
