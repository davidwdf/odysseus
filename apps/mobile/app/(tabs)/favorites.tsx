import { dedupeEtas, type Eta, type Locale } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Skeleton } from '../../components/Skeleton'
import { StopRow } from '../../components/StopRow'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { usePreferences } from '../../lib/preferences'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useLocale } from '../../providers/LocaleProvider'

/** Group `${stopId}|${routeId}` favourite keys by stop, preserving save order.
 *  Split on the first `|` — canonical ids carry colons, never a pipe (ADR-032). */
function groupByStop(keys: string[]): Array<{ stopId: string; routeIds: string[] }> {
  const order: string[] = []
  const byStop = new Map<string, string[]>()
  for (const key of keys) {
    const sep = key.indexOf('|')
    if (sep === -1) continue
    const stopId = key.slice(0, sep)
    const routeId = key.slice(sep + 1)
    if (!byStop.has(stopId)) {
      byStop.set(stopId, [])
      order.push(stopId)
    }
    byStop.get(stopId)?.push(routeId)
  }
  return order.map((stopId) => ({ stopId, routeIds: byStop.get(stopId) ?? [] }))
}

export default function Favorites() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const router = useRouter()
  // ADR-032: favourites are route-at-stop pairs. Group them under their stop heading.
  const favoriteRoutes = usePreferences((s) => s.favoriteRoutes)
  const groups = groupByStop(favoriteRoutes)
  const now = Date.now()

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'tabFavorites')}
        </Text>
      </View>
      {groups.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="h3" className="text-center text-text">
            {t(locale, 'favoritesEmpty')}
          </Text>
          <Text variant="body" className="mt-2 text-center text-muted">
            {t(locale, 'favoritesEmptyHelp')}
          </Text>
        </View>
      ) : (
        <ScrollView>
          <View style={{ paddingBottom: tab.contentInset }}>
            {groups.map((g, i) => (
              <View key={g.stopId} className={i === 0 ? '' : 'border-border border-t'}>
                <FavoriteStopGroup
                  stopId={g.stopId}
                  routeIds={g.routeIds}
                  locale={locale}
                  now={now}
                  onPress={() => router.push(`/stop/${encodeURIComponent(g.stopId)}`)}
                  onRoutePress={(routeId) =>
                    router.push(
                      `/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(g.stopId)}`,
                    )
                  }
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function FavoriteStopGroup({
  stopId,
  routeIds,
  locale,
  now,
  onPress,
  onRoutePress,
}: {
  stopId: string
  /** The favourited route ids at this stop — only these rows are shown. */
  routeIds: string[]
  locale: Locale
  now: number
  onPress: () => void
  onRoutePress: (routeId: string) => void
}) {
  const query = useQuery({
    queryKey: ['stop', stopId],
    queryFn: () => dataSource.getStop(stopId),
    refetchInterval: 20_000,
  })

  if (query.isLoading) {
    return (
      <View className="px-4 py-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="mt-3 h-6 w-full" />
      </View>
    )
  }
  if (!query.data) return null // skip a stop that failed to load rather than break the list

  // Keep only the favourited routes at this stop, collapsing rider-duplicate lines.
  const wanted = new Set(routeIds)
  const etas: Eta[] = dedupeEtas(
    query.data.routes
      .filter((r) => wanted.has(r.route.id))
      .map((r) => r.eta)
      .filter((e): e is Eta => Boolean(e)),
  )
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))
    .slice(0, 4)

  return (
    <StopRow
      name={query.data.stop.name[locale]}
      etas={etas}
      locale={locale}
      now={now}
      onPress={onPress}
      onRoutePress={onRoutePress}
    />
  )
}
