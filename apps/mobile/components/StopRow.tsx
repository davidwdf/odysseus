import type { Locale, StopCardRow, StopCardView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ChevronRight, MapPin } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { BearingArrow } from './BearingArrow'
import { EtaBadge } from './EtaBadge'
import { Icon } from './Icon'
import { RemarkTag } from './RemarkTag'
import { RouteChip } from './RouteChip'
import { StopName } from './StopName'
import { Text } from './Text'

// **This component now derives nothing.** Everything it used to work out — the `maxRows` cap and the
// "+N more" count, the caption's parts and its two separators, the destination-else-remark headline,
// the route number and its fallback — is `stopCardView` in `@nextbus/core` (WP4-0), pinned by
// `packages/core/spec/stop-card.spec.json`. It was moved because a second renderer (WP4-1, `apps/web`)
// could otherwise only have re-implemented each rule by reading this JSX, and a re-implementation
// would have looked right on the day it was written.
//
// What is left is the half that genuinely differs per platform: which glyph, what size, what tone,
// what a tap does. That is the line ADR-053 draws for the wire, applied to a renderer.

/** One route's chip + "→ destination" + next-ETA badge — a row beneath a stop heading. */
function RouteRow({ row }: { row: StopCardRow }) {
  return (
    <View className="flex-row items-center justify-between gap-3 py-1.5">
      <View className="flex-1 flex-row items-center gap-2.5">
        <RouteChip operator={row.operator} routeNo={row.routeNo} />
        <View className="flex-1">
          {row.headline ? (
            <Text variant="body" className="text-text" numberOfLines={1}>
              <Text className="text-subtle">→ </Text>
              {row.headline}
            </Text>
          ) : null}
          {row.remark ? <RemarkTag remark={row.remark} /> : null}
        </View>
      </View>
      <EtaBadge label={row.label} urgency={row.urgency} stale={row.stale} />
    </View>
  )
}

/**
 * A stop card as a flat list section (docs/09: the data is the hero — no floating card chrome). A
 * tappable heading (name + caption + chevron) over the route rows; heading and each row are *sibling*
 * tap targets, never nested. The caller draws the hairline divider between rows.
 */
export function StopRow({
  view,
  locale,
  onPress,
  onRoutePress,
}: {
  /** The whole card, already derived — `stopCardView` for one place, `nearbyView` for a list. */
  view: StopCardView
  /** For the "+N more" phrase, and *only* for that. The kernel supplies the count; the plural rule
   *  and the wording are the ICU catalogue's (ADR-054: core owns the rule, i18n owns the word). */
  locale: Locale
  /** Tap the heading — navigates to the stop-detail screen. */
  onPress?: () => void
  /** Tap a single route row — navigates to that route (with this stop's context). */
  onRoutePress?: (routeId: string) => void
}) {
  const Heading = (
    <View className="flex-row items-start justify-between gap-3">
      <View className="flex-1">
        <StopName name={view.name} variant="h3" />
        {view.caption ? (
          <View className="mt-0.5 flex-row items-center gap-1">
            {/* The compass arrow when this is a merged place, else a generic pin. Which glyph is this
                component's business; whether there is a direction to draw is the model's. */}
            {view.bearingDeg != null ? (
              <BearingArrow bearingDeg={view.bearingDeg} />
            ) : (
              <Icon icon={MapPin} tone="subtle" size={13} />
            )}
            <Text variant="caption" className="text-subtle">
              {view.caption}
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
        {view.rows.map((row) =>
          onRoutePress ? (
            <Pressable
              key={row.routeId}
              accessibilityRole="button"
              onPress={() => onRoutePress(row.routeId)}
              className="active:opacity-50"
            >
              <RouteRow row={row} />
            </Pressable>
          ) : (
            <RouteRow key={row.routeId} row={row} />
          ),
        )}
        {view.remaining > 0 && onPress ? (
          <Pressable
            accessibilityRole="button"
            onPress={onPress}
            className="flex-row items-center gap-1 py-1.5 active:opacity-50"
          >
            <Text variant="label" className="text-accent">
              {t(locale, 'moreRoutes', { n: view.remaining })}
            </Text>
            <Icon icon={ChevronRight} tone="accent" size={15} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}
