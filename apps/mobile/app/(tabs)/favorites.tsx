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

export default function Favorites() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const router = useRouter()
  const favorites = usePreferences((s) => s.favorites)
  const now = Date.now()

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'tabFavorites')}
        </Text>
      </View>
      {favorites.length === 0 ? (
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
            {favorites.map((stopId, i) => (
              <View key={stopId} className={i === 0 ? '' : 'border-border border-t'}>
                <FavoriteRow
                  stopId={stopId}
                  locale={locale}
                  now={now}
                  onPress={() => router.push(`/stop/${encodeURIComponent(stopId)}`)}
                  onRoutePress={(routeId) =>
                    router.push(
                      `/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(stopId)}`,
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

function FavoriteRow({
  stopId,
  locale,
  now,
  onPress,
  onRoutePress,
}: {
  stopId: string
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

  // Show the soonest few arrivals across all routes serving the stop, collapsing
  // rider-duplicate lines (same route+direction surfaced via multiple refs).
  const etas: Eta[] = dedupeEtas(
    query.data.routes.map((r) => r.eta).filter((e): e is Eta => Boolean(e)),
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
