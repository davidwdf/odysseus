import {
  formatFare,
  formatFareRange,
  formatHeadway,
  formatServiceHours,
  formatStopCount,
  type Locale,
  type RouteServiceInfo,
} from '@nextbus/core'
import { ClockFading, CreditCard, type LucideIcon, MapPin, Repeat } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Icon } from './Icon'
import { Text } from './Text'

const HOLIDAY: Record<Locale, string> = { en: 'hol', 'zh-Hant': '假日', 'zh-Hans': '假日' }

/** Which badge was tapped. `fare`/`freq`/`hours` open a detail sheet; `stops` is a navigation
 *  affordance (scroll the list), never a sheet (ADR-044). */
export type FactKey = 'fare' | 'freq' | 'hours' | 'stops'

type Fact = { key: FactKey; icon: LucideIcon; value: string; note?: string }

/**
 * The static-facts strip for a route — fare · frequency · service hours · stop count — from the
 * consolidated dataset we already fetch (docs/02, ADR-036). The **Static** honesty tier: shown
 * plainly, never styled as live. Rendered as soft, wrapping pills (lighter icon, muted value) so
 * the facts read as a light, ragged row rather than a boxed dashboard. Renders nothing without facts.
 *
 * The fare is the sectional adult fare (the only fare the open data carries — no concessionary /
 * senior figures exist upstream), framed **high → low** since the origin fare is the dearest and
 * each later stage costs less.
 *
 * Whole-route journey time (`service.journeyMin`, via `formatJourney`) is intentionally **not**
 * shown: it's an origin→terminus figure with little relevance to a rider boarding mid-route. The
 * datum is still available should we want it back.
 */
export function RouteMeta({
  service,
  fareRange,
  stopCount,
  locale,
  onFactPress,
}: {
  service?: RouteServiceInfo
  /** Sectional fare span across the route's boarding stops (min–max); falls back to the
   *  origin full fare when per-stop fares aren't available. */
  fareRange?: { min: string; max: string }
  /** Number of stops on this route direction — a Static "route length" fact. */
  stopCount?: number
  locale: Locale
  /** Tapping a badge asks for its detail (fare/freq/hours → a sheet; stops → scroll). When
   *  omitted the badges are static (ADR-044). */
  onFactPress?: (key: FactKey) => void
}) {
  if (!service) return null

  const fare = fareRange
    ? formatFareRange(fareRange)
    : service.fareFull
      ? formatFare(service.fareFull)
      : undefined
  const fareNote = service.fareFullHoliday
    ? `${formatFare(service.fareFullHoliday)} ${HOLIDAY[locale]}`
    : undefined

  const facts: Fact[] = []
  if (fare) facts.push({ key: 'fare', icon: CreditCard, value: fare, note: fareNote })
  if (service.headway)
    facts.push({ key: 'freq', icon: Repeat, value: formatHeadway(service.headway, locale) })
  if (service.hours)
    facts.push({ key: 'hours', icon: ClockFading, value: formatServiceHours(service.hours) })
  if (stopCount)
    facts.push({ key: 'stops', icon: MapPin, value: formatStopCount(stopCount, locale) })
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
          <Icon icon={f.icon} tone="text" size={15} />
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
