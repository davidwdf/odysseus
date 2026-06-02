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

export default function RouteDetail() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
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

  const route = query.data?.route
  const stops = query.data?.stops ?? []

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
            <Text variant="label" className="mb-2 text-subtle">
              {t(locale, 'stopsOnRoute')}
            </Text>
            <Card className="overflow-hidden">
              {stops.map((s, i) => (
                <Pressable
                  key={`${s.seq}-${s.stop.id}`}
                  accessibilityRole="button"
                  onPress={() => router.push(`/stop/${encodeURIComponent(s.stop.id)}`)}
                  className={`flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${
                    i === 0 ? '' : 'border-t border-border'
                  }`}
                >
                  <Text variant="label" className="w-6 text-right text-subtle" tabular>
                    {s.seq}
                  </Text>
                  <Text variant="body" className="flex-1 text-text" numberOfLines={1}>
                    {s.stop.name[locale]}
                  </Text>
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  )
}
