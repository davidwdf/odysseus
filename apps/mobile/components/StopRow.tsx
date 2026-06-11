import type { Eta, Locale } from '@nextbus/core'
import { formatDistance, formatWalk } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ChevronRight, MapPin } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { titleCaseName } from '../lib/stopName'
import { EtaBadge } from './EtaBadge'
import { Icon } from './Icon'
import { RemarkTag } from './RemarkTag'
import { RouteChip } from './RouteChip'
import { StopName } from './StopName'
import { Text } from './Text'

// A merged place can serve many routes; the compact card shows the soonest few and a
// tappable "+N more" that opens the Place page for the full, grouped list (ADR-042).
const MAX_ROWS = 6

function routeNo(routeId: string): string {
  return routeId.split(':')[1] ?? routeId
}

/** One route's chip + "→ destination" + next-ETA badge — a row beneath a stop heading.
 *  Destination falls back to the operator remark when the feed omits it. */
function RouteRow({ eta, locale, now }: { eta: Eta; locale: Locale; now: number }) {
  const dest = eta.destination?.[locale]
  // Keep the remark-as-headline fallback when the feed omits a destination; otherwise the
  // remark shows as its own tag below (so we never duplicate it). Fare sits before the ETA.
  const headed = dest ? titleCaseName(dest) : eta.remark?.[locale]
  return (
    <View className="flex-row items-center justify-between gap-3 py-1.5">
      <View className="flex-1 flex-row items-center gap-2.5">
        <RouteChip operator={eta.operator} routeNo={routeNo(eta.routeId)} />
        <View className="flex-1">
          {headed ? (
            <Text variant="body" className="text-text" numberOfLines={1}>
              <Text className="text-subtle">→ </Text>
              {headed}
            </Text>
          ) : null}
          {dest && eta.remark ? <RemarkTag remark={eta.remark} locale={locale} /> : null}
        </View>
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
  routeCount,
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
  /** True total routes at this place (from the static index). When it exceeds the rows
   *  shown, a "+N more" affordance appears — so the card is honest, never a silent filter. */
  routeCount?: number
  locale: Locale
  now: number
  /** Tap the heading — navigates to the stop-detail screen. */
  onPress?: () => void
  /** Tap a single route row — navigates to that route (with this stop's context). */
  onRoutePress?: (routeId: string) => void
}) {
  const shown = etas.slice(0, MAX_ROWS)
  // Routes beyond what we show: the honest total minus the rows shown (falls back to the
  // fetched-ETA count when no total is supplied, e.g. on the Favourites screen).
  const remaining = Math.max(0, (routeCount ?? etas.length) - shown.length)
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
        {shown.map((eta) =>
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
        {remaining > 0 && onPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onPress}
            className="flex-row items-center gap-1 py-1.5 active:opacity-50"
          >
            <Text variant="label" className="text-accent">
              {t(locale, 'moreRoutes').replace('{n}', String(remaining))}
            </Text>
            <Icon icon={ChevronRight} tone="accent" size={15} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}
