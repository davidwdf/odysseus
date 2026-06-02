import type { Route as BusRoute, Eta } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { FONT_FAMILY } from '@nextbus/ui'
import { useQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Pressable, ScrollView, View } from 'react-native'
import { Card } from '../../components/Card'
import { EtaBadge } from '../../components/EtaBadge'
import { RouteChip } from '../../components/RouteChip'
import { SaveButton } from '../../components/SaveButton'
import { Skeleton } from '../../components/Skeleton'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { useTheme } from '../../lib/useTheme'
import { useLocale } from '../../providers/LocaleProvider'

/** Collapse rider-duplicate variants (same route number + direction, e.g. two KMB
 *  service types to the same destination), keeping the one with a live ETA. */
function dedupeRoutes(
  routes: Array<{ route: BusRoute; eta: Eta | null }>,
): Array<{ route: BusRoute; eta: Eta | null }> {
  const byKey = new Map<string, { route: BusRoute; eta: Eta | null }>()
  for (const r of routes) {
    const key = `${r.route.routeNo}|${r.route.bound}`
    const existing = byKey.get(key)
    if (!existing || (!existing.eta && r.eta)) byKey.set(key, r)
  }
  return [...byKey.values()]
}

export default function StopDetail() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const locale = useLocale()
  const router = useRouter()
  const { color } = useTheme()

  const query = useQuery({
    queryKey: ['stop', id],
    enabled: !!id,
    queryFn: () => dataSource.getStop(id as string),
    // ETAs are live — refresh on an interval; honest display only updates on new data.
    refetchInterval: 20_000,
  })

  const stop = query.data?.stop
  const routes = query.data ? dedupeRoutes(query.data.routes) : []
  const now = Date.now()

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen
        options={{
          headerShown: true,
          title: stop ? stop.name[locale] : '',
          headerStyle: { backgroundColor: color('--surface') },
          headerTintColor: color('--text'),
          headerTitleStyle: { fontFamily: FONT_FAMILY.semibold },
          headerRight: () => (id ? <SaveButton stopId={id} /> : null),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {query.isLoading ? (
          <View className="gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </View>
        ) : query.isError ? (
          <Text variant="body" className="text-danger">
            {(query.error as Error).message}
          </Text>
        ) : (
          <>
            <Text variant="label" className="mb-2 text-subtle">
              {t(locale, 'routesAtStop')}
            </Text>
            <Card className="overflow-hidden">
              {routes.map((r, i) => (
                <Pressable
                  key={r.route.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/route/${encodeURIComponent(r.route.id)}`)}
                  className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${
                    i === 0 ? '' : 'border-t border-border'
                  }`}
                >
                  <RouteChip operator={r.route.operator} routeNo={r.route.routeNo} />
                  <Text variant="body" className="flex-1 text-text" numberOfLines={1}>
                    → {r.route.destination[locale]}
                  </Text>
                  {r.eta ? (
                    <EtaBadge eta={r.eta} locale={locale} now={now} />
                  ) : (
                    <Text variant="h3" className="text-subtle">
                      —
                    </Text>
                  )}
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  )
}
