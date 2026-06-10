import type { Route as BusRoute, Eta, Locale, OperatorId } from '@nextbus/core'
import { formatDistance, formatHeadway, formatWalk, haversineMeters } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useRef } from 'react'
import { Pressable, type ScrollView, View } from 'react-native'
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { expandedHeaderH } from '../../components/CollapsingHeader'
import { EtaBadge } from '../../components/EtaBadge'
import { Fare } from '../../components/Fare'
import { MiniMap } from '../../components/MiniMap'
import { RemarkTag } from '../../components/RemarkTag'
import { RouteChip } from '../../components/RouteChip'
import { Skeleton } from '../../components/Skeleton'
import { StopHeader } from '../../components/StopHeader'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { splitStopCode, titleCaseName } from '../../lib/stopName'
import { useLocation } from '../../lib/useLocation'
import { useLocale } from '../../providers/LocaleProvider'

/** Operator display names for the "served by" line — brand names, locale-neutral. */
const OPERATOR_LABEL: Record<OperatorId, string> = { KMB: 'KMB', LWB: 'LWB', CTB: 'Citybus' }

/** Collapse rider-duplicate variants (same route number + direction, e.g. two KMB
 *  service types to the same destination), keeping the one with a live ETA. Keyed by
 *  operator too, so a merged same-kerb stop keeps KMB-6 and CTB-6 as distinct rows. */
function dedupeRoutes(
  routes: Array<{ route: BusRoute; eta: Eta | null; fare?: string }>,
): Array<{ route: BusRoute; eta: Eta | null; fare?: string }> {
  const byKey = new Map<string, { route: BusRoute; eta: Eta | null; fare?: string }>()
  for (const r of routes) {
    const key = `${r.route.operator}|${r.route.routeNo}|${r.route.bound}`
    const existing = byKey.get(key)
    if (!existing || (!existing.eta && r.eta)) byKey.set(key, r)
  }
  return [...byKey.values()]
}

/** Unique operators serving this stop, in first-seen order. */
function operatorsOf(routes: Array<{ route: BusRoute }>): OperatorId[] {
  const seen: OperatorId[] = []
  for (const r of routes) if (!seen.includes(r.route.operator)) seen.push(r.route.operator)
  return seen
}

export default function StopDetail() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  const locale = useLocale()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Silent location read (never prompts here) → show distance/walk only if we already have a fix.
  const { state: loc } = useLocation()

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

  const cleanName = stop ? titleCaseName(splitStopCode(stop.name[locale]).label) : ''
  const distanceM =
    stop && loc.status === 'ready'
      ? haversineMeters({ lat: loc.lat, lng: loc.lng }, stop.location)
      : undefined

  // Collapsing header (ADR-033) — content scrolls beneath the floating chrome.
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y
  })
  const scrollRef = useRef<ScrollView>(null)
  const topSpacer = expandedHeaderH(insets.top)

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ headerShown: false }} />

      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View style={{ height: topSpacer }} />
        {query.isLoading ? (
          <View className="gap-3 px-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </View>
        ) : query.isError ? (
          <Text variant="body" className="px-4 text-danger">
            {(query.error as Error).message}
          </Text>
        ) : stop ? (
          <>
            {/* Map hero — a static, keyless preview of the kerb; tap → platform maps app. */}
            <View className="px-4 pb-4">
              <MiniMap
                lat={stop.location.lat}
                lng={stop.location.lng}
                label={cleanName}
                actionLabel={t(locale, 'openInMaps')}
                className="rounded-2xl border border-border"
              />
            </View>

            <StopMeta
              operators={operatorsOf(routes)}
              routeCount={routes.length}
              distanceM={distanceM}
              locale={locale}
            />

            <Text variant="label" className="mb-1 px-4 text-subtle">
              {t(locale, 'routesAtStop')}
            </Text>
            {/* Flat list, no card chrome — the same idiom as the Nearby screen's route
                rows (docs/09: the data is the hero). Hairline dividers between rows. */}
            {routes.map((r, i) => {
              const fare = r.fare ?? r.eta?.fare
              return (
                <Pressable
                  key={r.route.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push(
                      `/route/${encodeURIComponent(r.route.id)}?stop=${encodeURIComponent(id as string)}`,
                    )
                  }
                  className={`flex-row items-center justify-between gap-3 px-4 py-3.5 active:opacity-60 ${
                    i === 0 ? '' : 'border-t border-border'
                  }`}
                >
                  <View className="flex-1 flex-row items-center gap-2.5">
                    <RouteChip operator={r.route.operator} routeNo={r.route.routeNo} />
                    <View className="flex-1">
                      <Text variant="body" className="text-text" numberOfLines={1}>
                        <Text className="text-subtle">→ </Text>
                        {titleCaseName(r.route.destination[locale])}
                      </Text>
                      {fare || r.eta?.remark ? (
                        <View className="mt-0.5 flex-row items-center gap-2">
                          {fare ? <Fare fare={fare} /> : null}
                          {r.eta?.remark ? (
                            <RemarkTag remark={r.eta.remark} locale={locale} />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </View>
                  {r.eta ? (
                    <EtaBadge eta={r.eta} locale={locale} now={now} />
                  ) : r.route.service?.headway ? (
                    <Text variant="caption" className="max-w-[120px] text-right text-subtle">
                      {formatHeadway(r.route.service.headway, locale)}
                    </Text>
                  ) : (
                    <Text variant="h3" className="text-subtle">
                      —
                    </Text>
                  )}
                </Pressable>
              )
            })}
          </>
        ) : null}
      </Animated.ScrollView>

      {/* Floating collapsing chrome — rendered last so it sits above the scroll content. The
          back lens is always available (even mid-load); the name fills in once data arrives. */}
      <StopHeader
        stopName={cleanName}
        scrollY={scrollY}
        insetTop={insets.top}
        onBack={() => router.back()}
        onTitlePress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        backLabel={t(locale, 'back')}
      />
    </View>
  )
}

/** A one-line stop summary: operators served · route count · distance/walk (when located). */
function StopMeta({
  operators,
  routeCount,
  distanceM,
  locale,
}: {
  operators: OperatorId[]
  routeCount: number
  distanceM?: number
  locale: Locale
}) {
  const parts: string[] = []
  if (operators.length > 0) {
    parts.push(`${t(locale, 'servedBy')} ${operators.map((o) => OPERATOR_LABEL[o]).join(' · ')}`)
  }
  parts.push(`${routeCount} ${t(locale, 'routesLabel')}`)
  if (distanceM != null)
    parts.push(`${formatDistance(distanceM)} · ${formatWalk(distanceM, locale)}`)
  return (
    <Text variant="caption" className="mb-3 px-4 text-muted">
      {parts.join('  ·  ')}
    </Text>
  )
}
