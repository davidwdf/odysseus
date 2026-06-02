import type { Locale, NearbyStop } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback } from 'react'
import { Linking, Platform, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../../components/Button'
import { Skeleton } from '../../components/Skeleton'
import { StopCard } from '../../components/StopCard'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { useLocation } from '../../lib/useLocation'
import { useLocale } from '../../providers/LocaleProvider'

export default function Nearby() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const { state: loc, request } = useLocation()
  const ready = loc.status === 'ready' ? loc : null

  const query = useQuery({
    queryKey: ['nearby', ready?.lat, ready?.lng],
    enabled: !!ready,
    queryFn: () => dataSource.getNearby({ lat: ready!.lat, lng: ready!.lng }, 500),
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
          <View className="gap-3 px-4 pb-8">
            {data.map((n: NearbyStop) => (
              <StopCard
                key={n.stop.id}
                name={n.stop.name[locale]}
                etas={n.etas}
                locale={locale}
                now={now}
              />
            ))}
            {data.length === 0 ? (
              <Text variant="body" className="px-1 text-muted">
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
      <Button label={t(locale, 'enableLocation')} onPress={onEnable} />
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
    <View className="gap-3 px-4">
      <Text variant="label" className="text-muted">
        {label}
      </Text>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </View>
  )
}
