import { etaView, fareRange, inferBusMarkers, type Locale } from '@nextbus/core'
import { useQuery } from '@tanstack/react-query'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, type ScrollView, View } from 'react-native'
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BusToken } from '../../components/BusToken'
import { EtaTimes } from '../../components/EtaTimes'
import { Fare } from '../../components/Fare'
import { collapsedHeaderH, expandedHeaderH, RouteHeader } from '../../components/RouteHeader'
import { RouteMeta } from '../../components/RouteMeta'
import { Skeleton } from '../../components/Skeleton'
import { StopName } from '../../components/StopName'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { titleCaseName } from '../../lib/stopName'
import { useLocale } from '../../providers/LocaleProvider'

const RAIL_W = 52
const NODE = 28
const NODE_TOP = 12 // node top aligns with the stop name's top (paddingTop)
const NODE_CENTER = NODE_TOP + NODE / 2
const TOKEN = 26

/** Does a route-sequence stop id refer to the stop we opened this route from?
 *  Handles a merged same-kerb place id (`P:<a>+<b>`) matching either member. */
function isOriginStop(routeStopId: string, origin?: string): boolean {
  if (!origin) return false
  if (origin === routeStopId) return true
  return origin.startsWith('P:') && origin.slice(2).split('+').includes(routeStopId)
}

/** Upcoming (not-yet-departed) arrivals at a stop, soonest first, capped at 3. */
function upcoming(arrivals: string[] | undefined, now: number): string[] {
  return (arrivals ?? []).filter((a) => !etaView(a, now).hasDeparted).slice(0, 3)
}

export default function RouteDetail() {
  const params = useLocalSearchParams<{ id: string; stop?: string }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const stopId = Array.isArray(params.stop) ? params.stop[0] : params.stop
  const locale = useLocale()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  // Each stop carries the route's live arrival there (ADR-030) → live query.
  const query = useQuery({
    queryKey: ['route', id],
    enabled: !!id,
    queryFn: () => dataSource.getRoute(id as string),
    refetchInterval: 20_000,
  })

  const route = query.data?.route
  const stops = query.data?.stops ?? []
  const now = Date.now()

  const hereIndex = stops.findIndex((s) => isOriginStop(s.stop.id, stopId))
  // Bus positions from each stop's soonest *upcoming* arrival (drop-off detection).
  const soonest = stops.map((s) => upcoming(s.eta?.arrivals, now)[0] ?? null)
  const markers = inferBusMarkers(soonest, now)
  // Sectional fare span across boarding stops (origin dearest → last stage) for the meta strip.
  const fares = fareRange(stops.map((s) => s.fare))

  const topSpacer = expandedHeaderH(insets.top)

  // Rows are variable-height (names wrap), so each reports its top; node centres — and thus
  // bus positions and the auto-scroll target — are derived from those measurements.
  const [tops, setTops] = useState<number[]>([])
  const setTop = (i: number, y: number) =>
    setTops((prev) => {
      if (prev[i] === y) return prev
      const next = prev.slice()
      next[i] = y
      return next
    })
  const nodeY = (i: number) => (tops[i] === undefined ? undefined : tops[i] + NODE_CENTER)

  // Scroll offset drives the collapsing header.
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y
  })

  // Auto-scroll to the originating stop once BOTH it and the last row are measured — i.e.
  // the full content height is settled, so the scroll target isn't clamped.
  const scrollRef = useRef<ScrollView>(null)
  const scrolled = useRef(false)
  const hereTop = hereIndex >= 0 ? tops[hereIndex] : undefined
  const lastTop = stops.length > 0 ? tops[stops.length - 1] : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once the relevant rows are measured
  useEffect(() => {
    if (scrolled.current || hereTop === undefined || lastTop === undefined) return
    scrolled.current = true
    const y = topSpacer + hereTop - collapsedHeaderH(insets.top) - 8
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: false }))
  }, [hereTop, lastTop])

  const routeLabel = route
    ? `${titleCaseName(route.origin[locale])} → ${titleCaseName(route.destination[locale])}`
    : ''

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ headerShown: false }} />

      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={{ height: topSpacer }} />
        {query.isLoading ? (
          <View className="gap-3 px-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </View>
        ) : query.isError ? (
          <Text variant="body" className="px-4 text-danger">
            {(query.error as Error).message}
          </Text>
        ) : (
          <View>
            {/* Static service facts (fare · frequency · hours · stop count) — ADR-036.
                First child so each stop row's measured `y` includes its height, keeping the
                bus-token + auto-scroll math (which use `topSpacer + tops[i]`) consistent. */}
            <RouteMeta
              service={route?.service}
              fareRange={fares}
              stopCount={stops.length}
              locale={locale}
            />
            {stops.map((s, i) => (
              <RouteStopRow
                key={`${s.seq}-${s.stop.id}`}
                seq={s.seq}
                name={s.stop.name[locale]}
                arrivals={upcoming(s.eta?.arrivals, now)}
                fare={s.fare}
                now={now}
                locale={locale}
                here={i === hereIndex}
                first={i === 0}
                last={i === stops.length - 1}
                onLayoutY={(y) => setTop(i, y)}
                onPress={() =>
                  // Land on the *place* this stop belongs to (the server promotes the member
                  // id), anchored on this pole via `?pole` (ADR-042).
                  router.push(
                    `/stop/${encodeURIComponent(s.stop.id)}?pole=${encodeURIComponent(s.stop.id)}`,
                  )
                }
              />
            ))}

            {/* Bus tokens ride the rail at measured node positions; they tween on real data change. */}
            {markers.map((m, i) => {
              // The origin always reads as a bus "arriving" the moment it starts the route —
              // a token permanently parked there is noise. Only surface stop 0's bus when it
              // is about to depart (≤2 min away).
              if (m.toIndex === 0) {
                const first = soonest[0]
                if (!first || etaView(first, now).seconds > 120) return null
              }
              const atNode = m.atStop || m.toIndex === 0
              const a = nodeY(m.toIndex)
              const b = atNode ? a : nodeY(m.toIndex - 1)
              if (a === undefined || b === undefined) return null
              const y = atNode ? a : (a + b) / 2
              // biome-ignore lint/suspicious/noArrayIndexKey: ordinal identity is intentional — buses keep order, so the k-th token tweens to its new position (ADR-030)
              return <RailBus key={i} y={y} />
            })}
          </View>
        )}
      </Animated.ScrollView>

      {route ? (
        <RouteHeader
          operator={route.operator}
          routeNo={route.routeNo}
          routeLabel={routeLabel}
          scrollY={scrollY}
          insetTop={insets.top}
          onBack={() => router.back()}
          onTitlePress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        />
      ) : null}
    </View>
  )
}

/** A bus token on the rail, tweening its y toward the target on real data change. */
function RailBus({ y }: { y: number }) {
  const ty = useSharedValue(y)
  useEffect(() => {
    ty.value = withTiming(y, { duration: 650 })
  }, [y, ty])
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }))
  return (
    <Animated.View
      entering={FadeIn}
      exiting={FadeOut}
      pointerEvents="none"
      style={[{ position: 'absolute', left: RAIL_W / 2 - TOKEN / 2, top: -TOKEN / 2 }, style]}
    >
      <BusToken size={TOKEN} />
    </Animated.View>
  )
}

/** One stop on the vertical schematic: a top-aligned rail node (sequence number) wired to
 *  its neighbours, the title-cased stop name (wraps to 2 lines, + muted stop code), and up
 *  to 3 upcoming times. Reports its top so the overlay can place buses at node centres. */
function RouteStopRow({
  seq,
  name,
  arrivals,
  fare,
  now,
  locale,
  here,
  first,
  last,
  onLayoutY,
  onPress,
}: {
  seq: number
  name: string
  arrivals: string[]
  fare?: string
  now: number
  locale: Locale
  here: boolean
  first: boolean
  last: boolean
  onLayoutY: (y: number) => void
  onPress: () => void
}) {
  const lineX = RAIL_W / 2 - 1
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLayout={(e) => onLayoutY(e.nativeEvent.layout.y)}
      style={{ minHeight: 64 }}
      className={`flex-row active:opacity-70 ${here ? 'bg-surface-2' : ''}`}
    >
      {/* Rail column — a continuous line behind a top-aligned node */}
      <View style={{ width: RAIL_W }}>
        {!first ? (
          <View
            className="absolute bg-border"
            style={{ top: 0, height: NODE_CENTER, width: 2, left: lineX }}
          />
        ) : null}
        {!last ? (
          <View
            className="absolute bg-border"
            style={{ top: NODE_CENTER, bottom: 0, width: 2, left: lineX }}
          />
        ) : null}
        <View
          className={`absolute items-center justify-center rounded-full border ${
            here ? 'border-accent bg-accent' : 'border-border bg-surface'
          }`}
          style={{ top: NODE_TOP, left: (RAIL_W - NODE) / 2, width: NODE, height: NODE }}
        >
          <Text variant="caption" tabular className={here ? 'text-accent-contrast' : 'text-subtle'}>
            {seq}
          </Text>
        </View>
      </View>

      {/* Stop label + arrivals. The bottom padding lives here (not on the row) so the rail
          column stretches the full height and its connector reaches the next stop's line. */}
      <View className="flex-1 pr-4" style={{ paddingTop: NODE_TOP, paddingBottom: 16 }}>
        {/* The stop code flows inline at the end of the name (its last line); because it's part
            of the text it wraps to a new line rather than overlapping the fare when the line is
            full. `min-w-0` lets the name column actually wrap on web (flex children default to
            min-width:auto). The fare is rendered the SAME way as the inline code — a caption
            child with vertical-align:middle inside a body-size line — so both centre against the
            same 16px line metrics and line up exactly (a standalone line-height-centred fare sat
            ~1px off the code's x-height middle). The row is top-aligned, so that body line sits on
            the name's FIRST line. */}
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1">
            <StopName name={name} variant="body" emphasis={here} numberOfLines={3} />
          </View>
          {fare ? (
            <Text variant="body" className="shrink-0">
              <Fare fare={fare} style={{ verticalAlign: 'middle' }} />
            </Text>
          ) : null}
        </View>
        {arrivals.length > 0 ? <EtaTimes arrivals={arrivals} now={now} locale={locale} /> : null}
      </View>
    </Pressable>
  )
}
