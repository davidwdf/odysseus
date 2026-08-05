import type { RouteFact, RouteFactKey } from '@nextbus/core'
import { ClockFading, CreditCard, type LucideIcon, MapPin, Repeat } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Icon } from './Icon'
import { Text } from './Text'

/**
 * Which glyph denotes each fact.
 *
 * On ADR-075's invariant/idiom line, *"which concept each glyph denotes"* is identity and *"the set
 * (Lucide / SF Symbols / Material Symbols)"* is idiom — so this table is the correct thing to keep in a
 * renderer, and the DOM twin has the same four concepts drawn from the web Lucide package. What is no
 * longer here is **which facts exist, in what order, and what each says**: that was this component's until
 * WP6-6a and is `routeDetailView`'s now, corpus-pinned.
 */
const GLYPH: Record<RouteFactKey, LucideIcon> = {
  fare: CreditCard,
  freq: Repeat,
  hours: ClockFading,
  stops: MapPin,
}

/** Which badge was tapped. `fare`/`freq`/`hours` open a detail sheet; `stops` is a navigation
 *  affordance (scroll the list), never a sheet (ADR-044). */
export type FactKey = RouteFactKey

/**
 * The static-facts strip for a route — fare · frequency · service hours · stop count, from the
 * consolidated dataset we already fetch (docs/02, ADR-036). The **Static** honesty tier: shown
 * plainly, never styled as live. Rendered as soft, wrapping pills (lighter icon, muted value) so
 * the facts read as a light, ragged row rather than a boxed dashboard. Renders nothing without facts.
 *
 * A pure projection since WP6-6a: it draws the pills `routeDetailView` hands it and decides none of
 * them. The fare's fallback from a sectional span to the origin's full fare, the holiday qualifier and
 * the omission of `journeyMin` all moved into the kernel with their reasoning.
 */
export function RouteMeta({
  facts,
  onFactPress,
}: {
  facts: readonly RouteFact[]
  /** Tapping a badge asks for its detail (fare/freq/hours → a sheet; stops → scroll). When
   *  omitted the badges are static (ADR-044). */
  onFactPress?: (key: FactKey) => void
}) {
  if (facts.length === 0) return null

  return (
    <View className="mx-4 mb-3 flex-row flex-wrap gap-2">
      {facts.map((f) => (
        <Pressable
          key={f.key}
          accessibilityRole={onFactPress ? 'button' : undefined}
          onPress={onFactPress ? () => onFactPress(f.key) : undefined}
          disabled={!onFactPress}
          className="flex-row items-center gap-1.5 rounded-full bg-surface px-3 py-2 active:opacity-60"
        >
          <Icon icon={GLYPH[f.key]} tone="text" size={15} />
          <Text variant="caption" weight="medium" tabular className="text-muted">
            {f.value}
          </Text>
          {f.note ? (
            <Text variant="caption" tabular className="text-subtle">
              · {f.note}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  )
}
