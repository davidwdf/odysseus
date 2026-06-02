import { type Eta, etaView, formatRelative, type Locale } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { FONT_FAMILY } from '@nextbus/ui'
import { useQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, View } from 'react-native'
import { Card } from '../../components/Card'
import { RouteChip } from '../../components/RouteChip'
import { Skeleton } from '../../components/Skeleton'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { useTheme } from '../../lib/useTheme'
import { useLocale } from '../../providers/LocaleProvider'

/** Does a route-sequence stop id refer to the stop we opened this route from?
 *  Handles a merged same-kerb place id (`P:<a>+<b>`) matching either member. */
function isOriginStop(routeStopId: string, origin?: string): boolean {
  if (!origin) return false
  if (origin === routeStopId) return true
  return origin.startsWith('P:') && origin.slice(2).split('+').includes(routeStopId)
}

export default function RouteDetail() {
  const params = useLocalSearchParams<{ id: string; stop?: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const stopId = Array.isArray(params.stop) ? params.stop[0] : params.stop
  const locale = useLocale()
  const router = useRouter()
  const { color } = useTheme()

  // Route geometry is static — cache it hard (the worker caches an hour too).
  const query = useQuery({
    queryKey: ['route', id],
    enabled: !!id,
    queryFn: () => dataSource.getRoute(id as string),
    staleTime: 60 * 60_000,
  })

  // When opened from a stop, show this route's upcoming arrivals *here* (live).
  const arrivalsQuery = useQuery({
    queryKey: ['etas', stopId, id],
    enabled: !!stopId && !!id,
    queryFn: () => dataSource.getEtas(stopId as string, [id as string]),
    refetchInterval: 20_000,
  })

  const route = query.data?.route
  const stops = query.data?.stops ?? []
  const now = Date.now()
  const hereEta = arrivalsQuery.data?.[0] ?? null
  const hereStop = stops.find((s) => isOriginStop(s.stop.id, stopId))

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerShown: true,
          title: route ? route.routeNo : '',
          headerStyle: { backgroundColor: color('--surface') },
          headerTintColor: color('--text'),
          headerTitleStyle: { fontFamily: FONT_FAMILY.semibold },
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {query.isLoading ? (
          <View className="gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </View>
        ) : query.isError ? (
          <Text variant="body" className="text-danger">
            {(query.error as Error).message}
          </Text>
        ) : (
          <>
            {route ? (
              <View className="mb-4 flex-row items-center gap-3">
                <RouteChip operator={route.operator} routeNo={route.routeNo} />
                <Text variant="body" className="flex-1 text-muted">
                  {route.origin[locale]} → {route.destination[locale]}
                </Text>
              </View>
            ) : null}

            {stopId ? (
              <ArrivalsHere
                eta={hereEta}
                stopName={hereStop?.stop.name[locale]}
                locale={locale}
                now={now}
              />
            ) : null}

            <Text variant="label" className="mb-2 text-subtle">
              {t(locale, 'stopsOnRoute')}
            </Text>
            <Card className="overflow-hidden">
              {stops.map((s, i) => {
                const here = isOriginStop(s.stop.id, stopId)
                return (
                  <Pressable
                    key={`${s.seq}-${s.stop.id}`}
                    accessibilityRole="button"
                    onPress={() => router.push(`/stop/${encodeURIComponent(s.stop.id)}`)}
                    className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${
                      i === 0 ? '' : 'border-t border-border'
                    } ${here ? 'bg-surface-2' : ''}`}
                  >
                    <Text
                      variant="label"
                      className={`w-6 text-right ${here ? 'text-accent' : 'text-subtle'}`}
                      tabular
                    >
                      {s.seq}
                    </Text>
                    <Text
                      variant="body"
                      className={`flex-1 ${here ? 'font-semibold text-accent' : 'text-text'}`}
                      numberOfLines={1}
                    >
                      {s.stop.name[locale]}
                    </Text>
                  </Pressable>
                )
              })}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  )
}

/** The opened-from route's next few buses at the originating stop (live arrivals). */
function ArrivalsHere({
  eta,
  stopName,
  locale,
  now,
}: {
  eta: Eta | null
  stopName?: string
  locale: Locale
  now: number
}) {
  const arrivals = eta?.arrivals ?? []
  return (
    <Card className="mb-4 p-4">
      <Text variant="label" className="text-subtle">
        {t(locale, 'arrivalsHere')}
      </Text>
      {stopName ? (
        <Text variant="body" className="mt-0.5 text-muted" numberOfLines={1}>
          {stopName}
        </Text>
      ) : null}
      {arrivals.length === 0 ? (
        <Text variant="h3" className="mt-2 text-subtle">
          {t(locale, 'noService')}
        </Text>
      ) : (
        <View className="mt-2 flex-row flex-wrap items-baseline gap-x-5 gap-y-1">
          {arrivals.slice(0, 3).map((iso, i) => {
            const view = etaView(iso, now)
            const urgency = view.isDue
              ? 'text-danger'
              : view.minutes <= 5
                ? 'text-warning'
                : 'text-text'
            return (
              <Text
                key={iso}
                variant={i === 0 ? 'h2' : 'h3'}
                tabular
                className={i === 0 ? urgency : 'text-muted'}
              >
                {formatRelative(iso, now, locale)}
              </Text>
            )
          })}
        </View>
      )}
    </Card>
  )
}
