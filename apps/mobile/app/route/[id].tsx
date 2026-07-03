import { etaView, fareRange, inferBusMarkers, type Locale, routeDistanceM } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { MapPin, Star } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, type ScrollView, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomSheet, SheetAction } from '../../components/BottomSheet'
import { BusToken } from '../../components/BusToken'
import { EtaTimes } from '../../components/EtaTimes'
import { Fare } from '../../components/Fare'
import { Icon } from '../../components/Icon'
import { type FactKind, RouteFactSheet } from '../../components/RouteFactSheets'
import {
  collapsedHeaderH,
  expandedHeaderH,
  ROUTE_EXP_H,
  RouteHeader,
} from '../../components/RouteHeader'
import { RouteMeta } from '../../components/RouteMeta'
import { Skeleton } from '../../components/Skeleton'
import { StopName } from '../../components/StopName'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { usePageRevealReady } from '../../lib/navTransitions'
import { favoriteRouteKey, usePreferences } from '../../lib/preferences'
import { isCircular, splitStopCode, stripCircular, titleCaseName } from '../../lib/stopName'
import { useScrollToY } from '../../lib/useScrollToY'
import { useTheme } from '../../lib/useTheme'
import { useLocale } from '../../providers/LocaleProvider'

const RAIL_W = 52
const NODE = 28
const NODE_TOP = 12 // node top aligns with the stop name's top (paddingTop)
const NODE_CENTER = NODE_TOP + NODE / 2
const TOKEN = 26
// Saved-stop badge — a small accent star pinned to the node's corner (ADR-042). The node
// itself is unchanged, so a saved stop still scans as an ordinary sequence node, just flagged.
const BADGE = 15

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
  const { color } = useTheme()

  // Direction toggle (ADR-046): `id` is the direction we arrived on; flipping loads the reverse
  // route id in place. Held locally (not a nav push) so Back exits the screen, not the flip; reset
  // whenever we navigate to a different route.
  const [overrideId, setOverrideId] = useState<string | null>(null)
  const routeId = overrideId ?? id
  const flipped = overrideId !== null

  // Each stop carries the route's live arrival there (ADR-030) → live query. `keepPreviousData`
  // holds the current direction on screen while a flip's data loads, so a not-yet-cached reverse
  // never flashes the skeleton — it just swaps in when ready (ADR-046).
  const query = useQuery({
    queryKey: ['route', routeId],
    enabled: !!routeId,
    queryFn: () => dataSource.getRoute(routeId as string),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  })

  const route = query.data?.route
  const stops = query.data?.stops ?? []
  // The same route in the opposite direction, if one exists (absent for circular routes). Flipping
  // loads it; each direction's payload points back at the other, so one handler toggles both ways.
  const reverse = query.data?.reverse
  // Bumped on every flip → drives the header's swap animation + the list re-entry stagger, so a
  // direction change reads as motion even when the reverse payload is already cached (instant swap).
  const [swapNonce, setSwapNonce] = useState(0)
  const flip = useCallback(() => {
    if (!reverse) return
    setOverrideId(reverse.id)
    setSwapNonce((n) => n + 1)
  }, [reverse])
  // Navigating to a different route resets the flip + the swap animation (so a fresh route uses the
  // ADR-043 reveal, not the flip cascade).
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to the route param changing
  useEffect(() => {
    setOverrideId(null)
    setSwapNonce(0)
  }, [id])

  // Warm the reverse direction the moment we learn it exists, so the first flip is instant.
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!reverse) return
    const rid = reverse.id
    queryClient.prefetchQuery({ queryKey: ['route', rid], queryFn: () => dataSource.getRoute(rid) })
  }, [reverse, queryClient])
  const now = Date.now()

  // Which stops on this route the rider has favourited (route-at-stop, keyed on the member
  // stop id — ADR-042) → the rail node becomes a star at those stops.
  const favoriteRoutes = usePreferences((s) => s.favoriteRoutes)
  const favSet = new Set(favoriteRoutes)
  const isSaved = (stopId: string) => !!routeId && favSet.has(favoriteRouteKey(stopId, routeId))

  // Once flipped, the boarding stop we arrived on no longer applies (the reverse serves the
  // opposite kerbs), so drop the here-anchor and its one-time auto-scroll.
  const hereIndex = flipped ? -1 : stops.findIndex((s) => isOriginStop(s.stop.id, stopId))
  // Bus positions from each stop's soonest *upcoming* arrival (drop-off detection).
  const soonest = stops.map((s) => upcoming(s.eta?.arrivals, now)[0] ?? null)
  const markers = inferBusMarkers(soonest, now)
  // Sectional fare span across boarding stops (origin dearest → last stage) for the meta strip.
  const fares = fareRange(stops.map((s) => s.fare))

  const topSpacer = expandedHeaderH(insets.top, ROUTE_EXP_H)

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

  // Tapping a stop on the schematic opens an action sheet (favourite this route here / view
  // stop) rather than navigating straight off — we hold the tapped stop here.
  const [sheetStop, setSheetStop] = useState<{ id: string; name: string } | null>(null)

  // Tapping a `RouteMeta` badge opens its detail sheet (fare timeline / frequency / hours /
  // route overview behind the stop count — ADR-044).
  const [factSheet, setFactSheet] = useState<FactKind | null>(null)
  // Straight-line-through-stops route distance — an explicit estimate for the overview sheet
  // (no polylines upstream; ADR-044). Recomputed only when the stop set changes.
  const routeDistance = routeDistanceM(stops.map((s) => s.stop.location))

  // Scroll offset drives the collapsing header.
  const scrollY = useSharedValue(0)
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y
  })

  // Two-step reveal (ADR-043): the page slides in first, then — once it's settled AND the rows
  // are measured — we smoothly scroll to the originating stop as a deliberate second beat.
  // Gating on both the originating row and the last row means the full content height is settled,
  // so the target isn't clamped; gating on `revealReady` keeps the scroll from fighting the
  // incoming slide. The scroll is animated, so it reads as motion the user can follow.
  const revealReady = usePageRevealReady()
  const scrollRef = useRef<ScrollView>(null)
  const scrolled = useRef(false)
  // Web-safe, reduced-motion-aware smooth scroll (see useScrollToY / ADR-045).
  const scrollToY = useScrollToY(scrollRef)
  const hereTop = hereIndex >= 0 ? tops[hereIndex] : undefined
  const lastTop = stops.length > 0 ? tops[stops.length - 1] : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once the reveal has settled and the relevant rows are measured
  useEffect(() => {
    if (scrolled.current || !revealReady || hereTop === undefined || lastTop === undefined) return
    scrolled.current = true
    const y = topSpacer + hereTop - collapsedHeaderH(insets.top) - 8
    // Animated so it reads as a deliberate second beat — but instant under reduced motion
    // (the hook honours the OS setting).
    requestAnimationFrame(() => scrollToY(y))
  }, [hereTop, lastTop, revealReady])

  // Full terminus stop names for the header card (the first/last stops), cleaned of the trailing
  // stop code — richer than the route's abbreviated origin/destination labels. Falls back to those
  // labels until the stop list has loaded.
  const cleanName = (s: (typeof stops)[number]) =>
    titleCaseName(splitStopCode(s.stop.name[locale]).label)
  // Circular routes loop back to their origin, so the first & last stops are identical — showing
  // "A → A" is useless. Detect the loop (flagged in the route's destination name) and present the
  // boarding terminus over a "Circular via <turnaround>" line instead (ADR-046).
  const circular = !!route && isCircular(route.destination.en)
  const originName = stops.length
    ? cleanName(stops[0])
    : route
      ? titleCaseName(route.origin[locale])
      : ''
  const destName = circular
    ? t(locale, 'circularVia').replace(
        '{place}',
        titleCaseName(stripCircular(route?.destination[locale] ?? '')),
      )
    : stops.length
      ? cleanName(stops[stops.length - 1])
      : route
        ? titleCaseName(route.destination[locale])
        : ''

  return (
    <View className="flex-1 bg-bg">
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
              onFactPress={(key) => setFactSheet(key)}
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
                index={i}
                animateIn={swapNonce > 0}
                onLayoutY={(y) => setTop(i, y)}
                onPress={() =>
                  setSheetStop({
                    id: s.stop.id,
                    name: titleCaseName(splitStopCode(s.stop.name[locale]).label),
                  })
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
              return <RailBus key={i} y={y} enterY={nodeY(0) ?? y} />
            })}

            {/* Saved-stop stars (ADR-042), drawn last so they sit ABOVE the bus tokens — a passing
                bus can't hide a favourite. The star is pinned to the node's top-right corner, with a
                slightly larger surface star behind it acting as an outline so it reads as a bordered
                sticker over the rail rather than a disc. */}
            {stops.map((s, i) =>
              isSaved(s.stop.id) && tops[i] !== undefined ? (
                <View
                  key={`star-${s.seq}-${s.stop.id}`}
                  pointerEvents="none"
                  className="absolute items-center justify-center"
                  style={{
                    top: tops[i] + NODE_TOP - BADGE * 0.4,
                    left: (RAIL_W - NODE) / 2 + NODE - BADGE * 0.6,
                    width: BADGE,
                    height: BADGE,
                  }}
                >
                  <Icon
                    icon={Star}
                    size={BADGE}
                    color={color('--surface')}
                    fill={color('--surface')}
                  />
                  <Icon
                    icon={Star}
                    size={BADGE - 4}
                    tone="accent"
                    fill={color('--accent')}
                    style={{ position: 'absolute' }}
                  />
                </View>
              ) : null,
            )}
          </View>
        )}
      </Animated.ScrollView>

      {route ? (
        <RouteHeader
          operator={route.operator}
          routeNo={route.routeNo}
          origin={originName}
          destination={destName}
          canReverse={!!reverse}
          circular={circular}
          onFlip={flip}
          swapNonce={swapNonce}
          scrollY={scrollY}
          insetTop={insets.top}
          onBack={() => router.back()}
          onTitlePress={() => scrollToY(0)}
          locale={locale}
        />
      ) : null}

      {sheetStop ? (
        <StopActionSheet
          stop={sheetStop}
          routeId={routeId as string}
          routeNo={route?.routeNo}
          destination={route ? titleCaseName(route.destination[locale]) : ''}
          locale={locale}
          onClose={() => setSheetStop(null)}
          onViewStop={() =>
            // Land on the *place* this stop belongs to (the server promotes the member id),
            // anchored on this pole via `?pole` (ADR-042). Navigating unmounts the sheet.
            router.push(
              `/stop/${encodeURIComponent(sheetStop.id)}?pole=${encodeURIComponent(sheetStop.id)}`,
            )
          }
        />
      ) : null}

      {factSheet ? (
        <RouteFactSheet
          kind={factSheet}
          service={route?.service}
          stops={stops.map((s) => ({
            seq: s.seq,
            name: titleCaseName(splitStopCode(s.stop.name[locale]).label),
            fare: s.fare,
          }))}
          distanceM={routeDistance}
          locale={locale}
          onClose={() => setFactSheet(null)}
        />
      ) : null}
    </View>
  )
}

/** The action sheet for a stop tapped on the route schematic. The header leads with the **stop**
 *  the rider just touched (title), with the route → destination as a muted subtitle for context —
 *  together they still spell out exactly what a save would pin (this route, at this pole, towards
 *  its destination), so the favourite (keyed on the member stop id, never a place id — ADR-042)
 *  stays unambiguous. */
function StopActionSheet({
  stop,
  routeId,
  routeNo,
  destination,
  locale,
  onClose,
  onViewStop,
}: {
  stop: { id: string; name: string }
  routeId: string
  routeNo?: string
  destination: string
  locale: Locale
  onClose: () => void
  onViewStop: () => void
}) {
  const { color } = useTheme()
  const key = favoriteRouteKey(stop.id, routeId)
  const saved = usePreferences((s) => s.favoriteRoutes.includes(key))
  const toggle = usePreferences((s) => s.toggleFavoriteRoute)
  return (
    <BottomSheet
      closeLabel={t(locale, 'back')}
      onClose={onClose}
      header={
        <View className="gap-2">
          {/* Title: the tapped stop — it's what the rider just touched, so it leads. */}
          <View className="flex-row items-center gap-2">
            <Icon icon={MapPin} tone="text" size={18} />
            <Text variant="h3" className="flex-1 text-text" numberOfLines={2}>
              {stop.name}
            </Text>
          </View>
          {/* Subtitle: the route context (already liveried in the header behind), demoted to a
              quiet line. The route number keeps the livery chip's *shape* (rounded pill) for
              consistency but drops the brand colour — a plain muted fill matching the subtitle
              text, with the number knocked out in the surface colour so it stays legible. */}
          <View className="flex-row items-center gap-2">
            {routeNo ? (
              <View
                className="items-center rounded-md px-1.5 py-0.5"
                style={{ backgroundColor: color('--text-muted') }}
              >
                <Text variant="caption" weight="bold" style={{ color: color('--surface') }}>
                  {routeNo}
                </Text>
              </View>
            ) : null}
            <Text variant="caption" className="flex-1 text-muted" numberOfLines={1}>
              <Text className="text-subtle">→ </Text>
              {destination}
            </Text>
          </View>
        </View>
      }
    >
      {(close) => (
        <>
          <SheetAction
            icon={Star}
            tone="accent"
            iconFill={saved ? color('--accent') : 'none'}
            label={t(locale, saved ? 'removeFavorite' : 'addFavorite')}
            onPress={() => {
              toggle(stop.id, routeId)
              close()
            }}
          />
          <SheetAction icon={MapPin} label={t(locale, 'viewStop')} onPress={onViewStop} />
        </>
      )}
    </BottomSheet>
  )
}

/** A bus token on the rail. On mount it slides *down* from the first stop (`enterY`) — as if
 *  dispatched from the origin — then tweens toward its target y on real data change (ADR-030). */
function RailBus({ y, enterY }: { y: number; enterY: number }) {
  const ty = useSharedValue(enterY)
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
  index,
  animateIn,
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
  /** Position in the list — drives the cascade's per-row delay. */
  index: number
  /** Play the staggered fade+rise entrance (a direction flip); false on first load (ADR-046). */
  animateIn: boolean
  onLayoutY: (y: number) => void
  onPress: () => void
}) {
  const lineX = RAIL_W / 2 - 1

  // Direction-flip cascade: on a flip the reverse rows mount fresh, each fading + rising into place
  // a beat after the one above (delay capped so a long route doesn't drag). Makes the swap read as
  // the list rebuilding, even though the data was already cached (ADR-046).
  const reduceMotion = useReducedMotion()
  const enter = useSharedValue(animateIn && !reduceMotion ? 0 : 1)
  // biome-ignore lint/correctness/useExhaustiveDependencies: staggered entrance runs once, on mount
  useEffect(() => {
    if (!animateIn || reduceMotion) return
    enter.value = withDelay(
      Math.min(index, 10) * 26,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }),
    )
  }, [])
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }))

  return (
    <Animated.View style={enterStyle} onLayout={(e) => onLayoutY(e.nativeEvent.layout.y)}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
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
          {/* Sequence node — identical for every stop, saved or not. */}
          <View
            className={`absolute items-center justify-center rounded-full border ${
              here ? 'border-accent bg-accent' : 'border-border bg-surface'
            }`}
            style={{ top: NODE_TOP, left: (RAIL_W - NODE) / 2, width: NODE, height: NODE }}
          >
            <Text
              variant="caption"
              tabular
              className={here ? 'text-accent-contrast' : 'text-subtle'}
            >
              {seq}
            </Text>
          </View>
          {/* The saved-stop star is drawn in a later overlay pass (see the schematic body) so it
            paints above the bus tokens — a passing bus can't hide a favourite. */}
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
    </Animated.View>
  )
}
