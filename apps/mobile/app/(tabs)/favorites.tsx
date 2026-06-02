import type { Eta, Locale } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Skeleton } from '../../components/Skeleton'
import { StopCard } from '../../components/StopCard'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { usePreferences } from '../../lib/preferences'
import { useLocale } from '../../providers/LocaleProvider'

export default function Favorites() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
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
          <View className="gap-3 px-4 pb-8">
            {favorites.map((stopId) => (
              <FavoriteCard
                key={stopId}
                stopId={stopId}
                locale={locale}
                now={now}
                onPress={() => router.push(`/stop/${encodeURIComponent(stopId)}`)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function FavoriteCard({
  stopId,
  locale,
  now,
  onPress,
}: {
  stopId: string
  locale: Locale
  now: number
  onPress: () => void
}) {
  const query = useQuery({
    queryKey: ['stop', stopId],
    queryFn: () => dataSource.getStop(stopId),
    refetchInterval: 20_000,
  })

  if (query.isLoading) return <Skeleton className="h-28 w-full" />
  if (!query.data) return null // skip a stop that failed to load rather than break the list

  // Show the soonest few arrivals across all routes serving the stop.
  const etas: Eta[] = query.data.routes
    .map((r) => r.eta)
    .filter((e): e is Eta => Boolean(e))
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))
    .slice(0, 4)

  return (
    <StopCard
      name={query.data.stop.name[locale]}
      etas={etas}
      locale={locale}
      now={now}
      onPress={onPress}
    />
  )
}
