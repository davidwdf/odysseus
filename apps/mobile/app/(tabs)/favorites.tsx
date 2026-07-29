import {
  dedupeEtas,
  type Eta,
  formatFavoriteRouteKey,
  parseFavoriteRouteKey,
  type ResolvedClientPolicy,
  type StopDetail,
  stopCardView,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQueries } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Skeleton } from '../../components/Skeleton'
import { StopRow } from '../../components/StopRow'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { usePreferences } from '../../lib/preferences'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useClientPolicy } from '../../lib/useClientPolicy'
import { useLocale } from '../../providers/LocaleProvider'

/** Saved `${memberPoleId}|${routeId}` keys as pairs, in save order. A key the grammar cannot read
 *  is skipped rather than guessed at — the migration keeps it on disk in case a later grammar can
 *  (ADR-059, ADR-062); what it must never do is resolve to a pole the rider did not save. */
function parseFavorites(keys: string[]): Array<{ stopId: string; routeId: string }> {
  const out: Array<{ stopId: string; routeId: string }> = []
  for (const key of keys) {
    const parsed = parseFavoriteRouteKey(key)
    if (parsed) out.push({ stopId: parsed.stopId, routeId: parsed.routeId })
  }
  return out
}

export default function Favorites() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const router = useRouter()
  // ADR-042: favourites key on the *member pole* id (`${operator}:${stopId}`), never the
  // churning `P:` place id. Display grouping is derived at render time — we resolve each
  // saved pole to its place (`getStop` promotes a member id to its place) and group there,
  // so a multi-pole place shows once with its routes from every pole.
  const favoriteRoutes = usePreferences((s) => s.favoriteRoutes)
  const favoriteSet = new Set(favoriteRoutes)
  const parsed = parseFavorites(favoriteRoutes)
  const poleIds = [...new Set(parsed.map((p) => p.stopId))]
  const now = Date.now()
  const { policy } = useClientPolicy()

  // One query per distinct saved pole; every query returns the whole place (all poles'
  // routes), so we only need one resolved detail per place.
  const results = useQueries({
    queries: poleIds.map((stopId) => ({
      queryKey: ['stop', stopId],
      queryFn: () => dataSource.getStop(stopId),
      // Served cadence (ADR-053). This screen fans out one query per saved pole, so it is the one
      // that most wanted a cadence matched to the edge's TTL rather than a faster guess.
      refetchInterval: policy.refreshAfterMs,
    })),
  })

  // Group resolved poles by their place id, preserving save order.
  const placeOrder: string[] = []
  const byPlace = new Map<string, StopDetail>()
  results.forEach((res) => {
    const detail = res.data
    if (!detail) return
    const placeId = detail.stop.id
    if (!byPlace.has(placeId)) {
      byPlace.set(placeId, detail)
      placeOrder.push(placeId)
    }
  })

  const loading = results.some((r) => r.isLoading) && byPlace.size === 0

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'tabFavorites')}
        </Text>
      </View>
      {parsed.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="h3" className="text-center text-text">
            {t(locale, 'favoritesEmpty')}
          </Text>
          <Text variant="body" className="mt-2 text-center text-muted">
            {t(locale, 'favoritesEmptyHelp')}
          </Text>
        </View>
      ) : loading ? (
        <View className="px-4 py-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-3 h-6 w-full" />
        </View>
      ) : (
        <ScrollView>
          <View style={{ paddingBottom: tab.contentInset }}>
            {placeOrder.map((placeId, i) => {
              const detail = byPlace.get(placeId)
              if (!detail) return null
              return (
                <View key={placeId} className={i === 0 ? '' : 'border-border border-t'}>
                  <FavoritePlaceRow
                    detail={detail}
                    favoriteSet={favoriteSet}
                    locale={locale}
                    now={now}
                    policy={policy}
                    onPress={() => router.push(`/stop/${encodeURIComponent(placeId)}`)}
                    onRoutePress={(routeId) =>
                      router.push(
                        `/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(placeId)}`,
                      )
                    }
                  />
                </View>
              )
            })}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

/** One place's saved routes as a flat `StopRow`. Keeps only the route rows whose
 *  `${memberPole}|${routeId}` key is favourited — precise to the pole, so opposite-kerb
 *  directions of the same route number stay distinct (ADR-042). */
function FavoritePlaceRow({
  detail,
  favoriteSet,
  locale,
  now,
  policy,
  onPress,
  onRoutePress,
}: {
  detail: StopDetail
  favoriteSet: Set<string>
  locale: ReturnType<typeof useLocale>
  now: number
  policy: ResolvedClientPolicy
  onPress: () => void
  onRoutePress: (routeId: string) => void
}) {
  const etas: Eta[] = dedupeEtas(
    detail.routes
      .filter((r) => favoriteSet.has(formatFavoriteRouteKey(r.stopId, r.route.id)))
      // `/v1/stop` ETAs don't carry a destination (only the canonical route does), so stamp
      // the route's destination on — otherwise StopRow's row falls back to the remark and
      // shows e.g. "→ Scheduled Bus" instead of the destination it shows everywhere else.
      .map((r): Eta | null =>
        r.eta ? { ...r.eta, destination: r.eta.destination ?? r.route.destination } : null,
      )
      .filter((e): e is Eta => e !== null),
  )
    // Sorted but **not capped**: `StopRow` applies the served `maxRows` (ADR-053). The `.slice(0, 4)`
    // that used to be here was the third answer to a question the app now answers once, and it was
    // also a bug — the row count it passed was already truncated, so `StopRow`'s "+N more" computed
    // `4 - 4` and a place with nine saved routes showed four of them and said nothing about the rest.
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))

  // No `routeCount` and no `distanceM`: Favourites knows what the rider saved, not what serves the
  // place, and distance is irrelevant on this screen. `stopCardView` handles both absences — the
  // readings become the total, and the caption loses its distance half (WP4-0).
  return (
    <StopRow
      view={stopCardView({ stop: detail.stop, etas }, { locale, now, policy })}
      locale={locale}
      onPress={onPress}
      onRoutePress={onRoutePress}
    />
  )
}
