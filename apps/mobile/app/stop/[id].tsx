import type { Route as BusRoute, Eta, LatLng, Locale, OperatorId } from '@nextbus/core'
import {
  formatDistance,
  formatHeadway,
  formatWalk,
  formatWalkRange,
  haversineMeters,
} from '@nextbus/core'
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

/** A route serving the place, plus the member pole (`stopId`) it departs from (ADR-042). */
type RouteEntry = { route: BusRoute; eta: Eta | null; fare?: string; stopId: string }

/** The place's member poles, from the server (one for a single stop; several for a place). */
type Pole = {
  id: string
  name: { en: string; 'zh-Hant': string; 'zh-Hans': string }
  location: LatLng
}

/** Collapse rider-duplicate variants (same route number + direction, e.g. two KMB
 *  service types to the same destination), keeping the one with a live ETA. Keyed by
 *  operator too, so a merged same-kerb stop keeps KMB-6 and CTB-6 as distinct rows. */
function dedupeRoutes(routes: RouteEntry[]): RouteEntry[] {
  const byKey = new Map<string, RouteEntry>()
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
  const { id: rawId, pole: rawPole } = useLocalSearchParams<{ id: string; pole?: string }>()
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  // The member pole we arrived from (route → stop), if any — its group sorts to the top.
  const pole = Array.isArray(rawPole) ? rawPole[0] : rawPole
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
  const members: Pole[] = query.data?.members ?? []
  const multiPole = members.length > 1
  const now = Date.now()

  const cleanName = stop ? titleCaseName(splitStopCode(stop.name[locale]).label) : ''
  const here = loc.status === 'ready' ? { lat: loc.lat, lng: loc.lng } : null
  // Distance per pole (when located) → the place's walk is a *range* across its poles.
  const poleDist = new Map<string, number>()
  if (here) for (const m of members) poleDist.set(m.id, haversineMeters(here, m.location))
  const dists = [...poleDist.values()]
  const distanceM = here && stop ? haversineMeters(here, stop.location) : undefined

  // Routes grouped under the member pole they depart from (ADR-042); poles ordered with the
  // arrived-from `pole` first, then nearest, then the server order.
  const byPole = new Map<string, RouteEntry[]>()
  for (const r of routes) byPole.set(r.stopId, [...(byPole.get(r.stopId) ?? []), r])
  const orderedPoles = [...members].sort((a, b) => {
    const ap = a.id === pole
    const bp = b.id === pole
    if (ap !== bp) return ap ? -1 : 1
    const da = poleDist.get(a.id)
    const db = poleDist.get(b.id)
    if (da != null && db != null && da !== db) return da - db
    return 0
  })

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
            {/* Map hero — a static, keyless preview; a pin per pole for a multi-pole place. */}
            <View className="px-4 pb-4">
              <MiniMap
                lat={stop.location.lat}
                lng={stop.location.lng}
                points={multiPole ? members.map((m) => m.location) : undefined}
                label={cleanName}
                actionLabel={t(locale, 'openInMaps')}
                className="rounded-2xl border border-border"
              />
            </View>

            <StopMeta
              operators={operatorsOf(routes)}
              routeCount={routes.length}
              distanceM={dists.length ? Math.min(...dists) : distanceM}
              walk={
                dists.length > 1
                  ? formatWalkRange(Math.min(...dists), Math.max(...dists), locale)
                  : distanceM != null
                    ? formatWalk(distanceM, locale)
                    : undefined
              }
              locale={locale}
            />

            {/* Flat list, no card chrome (docs/09: data is the hero). For a multi-pole place the
                routes are grouped under their pole; otherwise one flat list under "Routes". */}
            {multiPole ? (
              orderedPoles.map((m) => {
                const rs = byPole.get(m.id) ?? []
                if (rs.length === 0) return null
                const op = m.id.split(':')[0] as OperatorId
                const code = splitStopCode(m.name[locale]).code
                const d = poleDist.get(m.id)
                return (
                  <View key={m.id}>
                    <View className="flex-row items-end justify-between border-border border-t px-4 pt-4 pb-1">
                      <Text variant="label" className="text-subtle">
                        {OPERATOR_LABEL[op] ?? op}
                        {code ? ` · ${code}` : ''}
                      </Text>
                      {d != null ? (
                        <Text variant="caption" className="text-subtle">
                          {formatWalk(d, locale)}
                        </Text>
                      ) : null}
                    </View>
                    {rs.map((r, j) => (
                      <RouteRowItem
                        key={r.route.id}
                        r={r}
                        locale={locale}
                        now={now}
                        divider={j > 0}
                        onPress={() =>
                          router.push(
                            `/route/${encodeURIComponent(r.route.id)}?stop=${encodeURIComponent(r.stopId)}`,
                          )
                        }
                      />
                    ))}
                  </View>
                )
              })
            ) : (
              <>
                <Text variant="label" className="mb-1 px-4 text-subtle">
                  {t(locale, 'routesAtStop')}
                </Text>
                {routes.map((r, i) => (
                  <RouteRowItem
                    key={r.route.id}
                    r={r}
                    locale={locale}
                    now={now}
                    divider={i > 0}
                    onPress={() =>
                      router.push(
                        `/route/${encodeURIComponent(r.route.id)}?stop=${encodeURIComponent(r.stopId)}`,
                      )
                    }
                  />
                ))}
              </>
            )}
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

/** One route row: chip + "→ destination" (+ fare/remark), and the live ETA or scheduled
 *  headway on the right. Shared by the flat and pole-grouped layouts. */
function RouteRowItem({
  r,
  locale,
  now,
  divider,
  onPress,
}: {
  r: RouteEntry
  locale: Locale
  now: number
  divider: boolean
  onPress: () => void
}) {
  const fare = r.fare ?? r.eta?.fare
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`flex-row items-center justify-between gap-3 px-4 py-3.5 active:opacity-60 ${
        divider ? 'border-border border-t' : ''
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
              {r.eta?.remark ? <RemarkTag remark={r.eta.remark} locale={locale} /> : null}
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
}

/** A one-line place summary: operators served · route count · distance + walk (when located;
 *  `walk` is a single time or a range across the poles). */
function StopMeta({
  operators,
  routeCount,
  distanceM,
  walk,
  locale,
}: {
  operators: OperatorId[]
  routeCount: number
  distanceM?: number
  walk?: string
  locale: Locale
}) {
  const parts: string[] = []
  if (operators.length > 0) {
    parts.push(`${t(locale, 'servedBy')} ${operators.map((o) => OPERATOR_LABEL[o]).join(' · ')}`)
  }
  parts.push(`${routeCount} ${t(locale, 'routesLabel')}`)
  if (distanceM != null && walk) parts.push(`${formatDistance(distanceM)} · ${walk}`)
  return (
    <Text variant="caption" className="mb-3 px-4 text-muted">
      {parts.join('  ·  ')}
    </Text>
  )
}
