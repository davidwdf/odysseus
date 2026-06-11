import type { Locale, NearbyStop } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { LocateFixed } from 'lucide-react-native'
import { type ReactNode, useCallback } from 'react'
import { Linking, Platform, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../../components/Button'
import { Skeleton } from '../../components/Skeleton'
import { StopRow } from '../../components/StopRow'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useLocation } from '../../lib/useLocation'
import { useLocale } from '../../providers/LocaleProvider'

export default function Nearby() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const router = useRouter()
  const { state: loc, request } = useLocation()
  const ready = loc.status === 'ready' ? loc : null

  const query = useQuery({
    queryKey: ['nearby', ready?.lat, ready?.lng],
    // skipToken disables the query until a location fix is ready, and narrows
    // `ready` to non-null inside the queryFn — no assertion (TanStack Query v5).
    queryFn: ready
      ? () => dataSource.getNearby({ lat: ready.lat, lng: ready.lng }, 500)
      : skipToken,
  })

  const onRefresh = useCallback(() => {
    void query.refetch()
  }, [query])

  const now = Date.now()
  const data = query.data ?? []

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'nearbyTitle')}
        </Text>
        <Text variant="label" className="mt-1 text-muted">
          {t(locale, 'appName')}
        </Text>
      </View>

      {loc.status === 'undetermined' ? (
        <Prime locale={locale} onEnable={request} />
      ) : loc.status === 'denied' ? (
        // If the OS won't show the prompt again, send the user to Settings instead.
        <Denied
          locale={locale}
          actionLabel={t(
            locale,
            !loc.canAskAgain && Platform.OS !== 'web' ? 'openSettings' : 'retry',
          )}
          onAction={
            !loc.canAskAgain && Platform.OS !== 'web'
              ? () => {
                  void Linking.openSettings()
                }
              : request
          }
        />
      ) : loc.status === 'error' ? (
        <Centered>
          <Text variant="body" className="text-danger">
            {loc.message}
          </Text>
        </Centered>
      ) : loc.status === 'loading' || query.isLoading ? (
        <LoadingList label={t(locale, 'locating')} />
      ) : query.isError ? (
        <Centered>
          <Text variant="body" className="text-danger">
            {(query.error as Error).message}
          </Text>
        </Centered>
      ) : (
        <ScrollView
          className="flex-1"
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={onRefresh} />}
        >
          <View style={{ paddingBottom: tab.contentInset }}>
            {[...data]
              .sort((a, b) => a.distanceM - b.distanceM)
              .map((n: NearbyStop, i) => (
                <View key={n.stop.id} className={i === 0 ? '' : 'border-border border-t'}>
                  <StopRow
                    name={n.stop.name[locale]}
                    distanceM={n.distanceM}
                    etas={n.etas}
                    routeCount={n.routeCount}
                    locale={locale}
                    now={now}
                    onPress={() => router.push(`/stop/${encodeURIComponent(n.stop.id)}`)}
                    onRoutePress={(routeId) =>
                      router.push(
                        `/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(n.stop.id)}`,
                      )
                    }
                  />
                </View>
              ))}
            {data.length === 0 ? (
              <Text variant="body" className="px-4 pt-4 text-muted">
                {t(locale, 'noService')}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center px-6">{children}</View>
}

function Prime({ locale, onEnable }: { locale: Locale; onEnable: () => void }) {
  return (
    <Centered>
      <Text variant="h2" className="text-center text-text">
        {t(locale, 'nearbyPrimeTitle')}
      </Text>
      <Text variant="body" className="mb-5 mt-2 text-center text-muted">
        {t(locale, 'nearbyPrimeBody')}
      </Text>
      <Button label={t(locale, 'enableLocation')} onPress={onEnable} icon={LocateFixed} />
    </Centered>
  )
}

function Denied({
  locale,
  actionLabel,
  onAction,
}: {
  locale: Locale
  actionLabel: string
  onAction: () => void
}) {
  return (
    <Centered>
      <Text variant="body" className="text-center text-text">
        {t(locale, 'locationDenied')}
      </Text>
      <Text variant="label" className="mb-5 mt-2 text-center text-muted">
        {t(locale, 'locationDeniedHelp')}
      </Text>
      <Button label={actionLabel} onPress={onAction} />
    </Centered>
  )
}

function LoadingList({ label }: { label: string }) {
  return (
    <View>
      <Text variant="label" className="px-4 pb-1 text-muted">
        {label}
      </Text>
      {[0, 1, 2].map((i) => (
        <View key={i} className={`px-4 py-4 ${i === 0 ? '' : 'border-border border-t'}`}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-3 h-6 w-full" />
        </View>
      ))}
    </View>
  )
}
