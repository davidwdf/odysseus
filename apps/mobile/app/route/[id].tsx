import {
  type Locale,
  type RailBus,
  type RouteDetailView,
  type RouteStopRowView,
  routeDetailView,
  routeFactSheet,
  type ServiceDayType,
} from '@nextbus/core'
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
import { usePreferences } from '../../lib/preferences'
import { useClientPolicy } from '../../lib/useClientPolicy'
import { useScrollToY } from '../../lib/useScrollToY'
import { useTheme } from '../../lib/useTheme'
import { useLocale } from '../../providers/LocaleProvider'

/**
 * The words the fact sheets' composed strings are built from — the day names a mask is joined out of, and
 * the passenger classes a concession legend keys.
 *
 * They live here, at the injection boundary, because the kernel may not import `@nextbus/i18n` (ADR-054): it
 * decides *which* days a pattern runs and *what goes between them*, and the catalogue owns the words. The DOM
 * screen passes the identical four.
 */
const DAY_LABEL: Record<
  ServiceDayType | 'other',
  'dayWeekday' | 'daySaturday' | 'daySunday' | 'dayDaily' | 'dayOther'
> = {
  weekday: 'dayWeekday',
  saturday: 'daySaturday',
  sunday: 'daySunday',
  daily: 'dayDaily',
  other: 'dayOther',
}

const RAIL_W = 52
const NODE = 28
const NODE_TOP = 12 // node top aligns with the stop name's top (paddingTop)
const NODE_CENTER = NODE_TOP + NODE / 2
const TOKEN = 26
// Saved-stop badge — a small accent star pinned to the node's corner (ADR-042). The node
// itself is unchanged, so a saved stop still scans as an ordinary sequence node, just flagged.
const BADGE = 15

/**
 * Route detail — the vertical schematic, its bus tokens, the collapsing header and the direction
 * toggle. Since WP6-6a **it derives nothing**: every string, every flag, every bus position and the
 * boarding anchor come from `routeDetailView` in `@nextbus/core`, pinned by 20 corpus cases.
 *
 * What is left in this file is React and geometry: which rows have measured themselves and where on
 * the rail a node centre falls, the reveal's second beat, the two sheets' open/closed state, and the
 * direction flip's local override. `packages/contract/ui/route-detail.spec.json` declares what it must
 * show in each state and `test/route-detail-states.test.tsx` drives it — as does
 * `apps/web/test/route-detail-states.test.tsx`, from the same file and the same corpus fixtures.
 */
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
  const { policy } = useClientPolicy()
  const query = useQuery({
    queryKey: ['route', routeId],
    enabled: !!routeId,
    queryFn: () => dataSource.getRoute(routeId as string),
    // Served cadence (ADR-053), matched to the edge's coalescing TTL — see `useClientPolicy`.
    refetchInterval: policy.refreshAfterMs,
    placeholderData: keepPreviousData,
  })

  // Bumped on every flip → drives the header's swap animation + the list re-entry stagger, so a
  // direction change reads as motion even when the reverse payload is already cached (instant swap).
  const [swapNonce, setSwapNonce] = useState(0)
  // Navigating to a different route resets the flip + the swap animation (so a fresh route uses the
  // ADR-043 reveal, not the flip cascade).
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to the route param changing
  useEffect(() => {
    setOverrideId(null)
    setSwapNonce(0)
  }, [id])

  const now = Date.now()
  // Which stops on this route the rider has favourited (route-at-stop, keyed on the member stop id —
  // ADR-042). Handed to the kernel as the store holds them; `saved` per row comes back.
  const favoriteRoutes = usePreferences((s) => s.favoriteRoutes)

  /**
   * The whole screen's content, in one call. Nothing below this line decides anything.
   *
   * The **words** it composes with are handed in and never imported by the kernel (ADR-054: core owns
   * the rule, the catalogue owns the word), and they are the identical five the DOM screen passes.
   */
  const view: RouteDetailView | undefined = query.data
    ? routeDetailView(query.data, {
        locale,
        now,
        policy,
        flipped,
        savedRouteKeys: favoriteRoutes,
        ...(stopId === undefined ? {} : { arrivedFromStop: stopId }),
        labels: {
          stopCount: (n) => t(locale, 'stopCount', { n }),
          holiday: t(locale, 'holiday'),
          circularVia: (place) => t(locale, 'circularVia', { place }),
          busApproaching: (stop) => t(locale, 'busApproaching', { stop }),
          busAtStop: (stop) => t(locale, 'busAtStop', { stop }),
        },
      })
    : undefined

  // Warm the reverse direction the moment we learn it exists, so the first flip is instant.
  const reverseId = view?.header.reverseId
  const queryClient = useQueryClient()
  useEffect(() => {
    if (reverseId === undefined) return
    queryClient.prefetchQuery({
      queryKey: ['route', reverseId],
      queryFn: () => dataSource.getRoute(reverseId),
    })
  }, [reverseId, queryClient])
  const flip = useCallback(() => {
    if (reverseId === undefined) return
    setOverrideId(reverseId)
    setSwapNonce((n) => n + 1)
  }, [reverseId])

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
  // stop) rather than navigating straight off — we hold the tapped row here.
  const [sheetStop, setSheetStop] = useState<RouteStopRowView | null>(null)

  // Tapping a `RouteMeta` badge opens its detail sheet (fare timeline / frequency / hours /
  // route overview behind the stop count — ADR-044).
  const [factSheet, setFactSheet] = useState<FactKind | null>(null)

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
  const stops = view?.stops ?? []
  const hereIndex = view?.hereIndex ?? -1
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

  return (
    <View className="flex-1 bg-bg">
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View style={{ height: topSpacer }} />
        {/*
          **The skeleton is the fallback arm**, for the reason Place detail's is (WP6-3b): `isLoading` is
          `isPending && isFetching`, so a query that is pending and *not* fetching — a paused retry —
          matches no earlier arm, and a trailing `null` would render nothing at all, for ever. Ordering the
          arms so "we have no answer" is the default makes every query state draw something.
        */}
        {view ? (
          <View>
            {/* Static service facts (fare · frequency · hours · stop count) — ADR-036.
                First child so each stop row's measured `y` includes its height, keeping the
                bus-token + auto-scroll math (which use `topSpacer + tops[i]`) consistent. */}
            <RouteMeta facts={view.facts} onFactPress={(key) => setFactSheet(key)} />
            {/* **Live times are not the whole truth on this route, said once** (ADR-114).
                `liveArrivals` distinguishes three things `eta: null` on every row could not: the round
                answered and nothing is due, the round did not answer, and this operator publishes no
                route-level feed at all (Citybus, GMB) — which is permanent, and which made a whole
                operator's routes read as "no bus is due" for two waves.

                Above the schematic and never per row: a rider cannot act on *which* rows. Same variant
                and token as `StopRow`'s `incomplete` line, and for the same reason — `text-muted`, never
                a warning colour, because nothing is wrong with the route. Inside this `View` and above the
                rows, so every row's measured `y` includes it and the token math stays consistent. */}
            {view.liveArrivals !== 'answered' ? (
              <Text variant="label" className="px-4 pb-1 pt-2 text-muted">
                {t(locale, 'etasUnavailable')}
              </Text>
            ) : null}
            {view.stops.map((row, i) => (
              <RouteStopRow
                key={`${row.seq}-${row.stopId}`}
                row={row}
                index={i}
                animateIn={swapNonce > 0}
                onLayoutY={(y) => setTop(i, y)}
                onPress={() => setSheetStop(row)}
              />
            ))}

            {/* Bus tokens ride the rail at measured node positions; they tween on real data change.
                Which node each is at is `view.buses`'; where that node is on screen is this file's. */}
            {view.buses.map((bus, i) => {
              const target = bus.kind === 'node' ? bus.index : bus.to
              // **Drawn whether or not the rows have reported their offsets yet**, which is a fix rather than
              // a simplification. It used to bail out on an unmeasured row — and `onLayout` not firing on
              // first mount is a live react-native-web bug this repo already carries for `MiniMap`
              // (`docs/07`), so "no measurement" is not merely the first frame: it is a state in which the
              // rail silently had no buses on it at all. WP6-6b's conformance suite could not reach a single
              // bus state until this changed, which is how it was noticed. An unmeasured token sits at the
              // top of the rail and slides down to its node, which is the entrance animation anyway.
              const a = nodeY(target) ?? 0
              const b = (bus.kind === 'node' ? a : nodeY(bus.from)) ?? 0
              const y = bus.kind === 'node' ? a : (a + b) / 2
              // biome-ignore lint/suspicious/noArrayIndexKey: ordinal identity is intentional — buses keep order, so the k-th token tweens to its new position (ADR-030)
              return <RailBusToken key={i} bus={bus} y={y} enterY={nodeY(0) ?? y} />
            })}

            {/* Saved-stop stars (ADR-042), drawn last so they sit ABOVE the bus tokens — a passing
                bus can't hide a favourite. The star is pinned to the node's top-right corner, with a
                slightly larger surface star behind it acting as an outline so it reads as a bordered
                sticker over the rail rather than a disc. */}
            {view.stops.map((row, i) =>
              row.saved && tops[i] !== undefined ? (
                <View
                  key={`star-${row.seq}-${row.stopId}`}
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
        ) : query.isError ? (
          <Text variant="body" className="px-4 text-danger">
            {(query.error as Error).message}
          </Text>
        ) : (
          <View className="gap-3 px-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </View>
        )}
      </Animated.ScrollView>

      {view ? (
        <RouteHeader
          header={view.header}
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
          routeNo={view?.header.routeNo}
          destination={view?.header.destination ?? ''}
          locale={locale}
          onClose={() => setSheetStop(null)}
          onViewStop={() =>
            // Land on the *place* this stop belongs to (the server promotes the member id),
            // anchored on this pole via `?pole` (ADR-042). Navigating unmounts the sheet.
            router.push(
              `/stop/${encodeURIComponent(sheetStop.stopId)}?pole=${encodeURIComponent(sheetStop.stopId)}`,
            )
          }
        />
      ) : null}

      {/* The sheet a fact pill opens (ADR-044). Both the pill and the sheet read one call each, and the
          sheet is handed the **view** rather than the payload so its fare timeline cannot name a stop
          differently from the schematic above it (WP6-6c). */}
      {factSheet && view ? (
        <RouteFactSheet
          sheet={routeFactSheet(factSheet, view, query.data?.route.service, {
            locale,
            labels: {
              stopCount: (n) => t(locale, 'stopCount', { n }),
              dayNames: t(locale, 'daysShort').split(','),
              day: (kind) => t(locale, DAY_LABEL[kind]),
            },
          })}
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
  stop: RouteStopRowView
  routeId: string
  routeNo?: string
  destination: string
  locale: Locale
  onClose: () => void
  onViewStop: () => void
}) {
  const { color } = useTheme()
  const saved = stop.saved
  const toggle = usePreferences((s) => s.toggleFavoriteRoute)
  return (
    <BottomSheet
      closeLabel={t(locale, 'back')}
      onClose={onClose}
      header={
        <View className="gap-2">
          {/* Title: the tapped stop — it's what the rider just touched, so it leads. The name is the
              row's own, which is what stops this sheet and the row it came from disagreeing (WP6-6a:
              it used to be a second spelling of `displayName` eleven lines away). */}
          <View className="flex-row items-center gap-2">
            <Icon icon={MapPin} tone="text" size={18} />
            <Text variant="h3" className="flex-1 text-text" numberOfLines={2}>
              {stop.name.label}
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
              toggle(stop.stopId, routeId)
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
 *  dispatched from the origin — then tweens toward its target y on real data change (ADR-030).
 *
 *  `accessibilityLabel` is `bus.label`, composed by the kernel: the disc is a graphic, so without a
 *  name the one element on this screen carrying live information was invisible to a screen reader
 *  (WP6-6a). `accessibilityRole="image"` rather than nothing, because a labelled `View` with no role
 *  is announced inconsistently across platforms — and the token is still `pointerEvents: 'none'`, so
 *  it is read but never focused as a control. */
function RailBusToken({ bus, y, enterY }: { bus: RailBus; y: number; enterY: number }) {
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
      accessible
      accessibilityRole="image"
      accessibilityLabel={bus.label}
      style={[{ position: 'absolute', left: RAIL_W / 2 - TOKEN / 2, top: -TOKEN / 2 }, style]}
    >
      <BusToken size={TOKEN} />
    </Animated.View>
  )
}

/** One stop on the vertical schematic: a top-aligned rail node (sequence number) wired to
 *  its neighbours, the title-cased stop name (wraps to 2 lines, + muted stop code), and up
 *  to 3 upcoming times. Reports its top so the overlay can place buses at node centres.
 *
 *  A pure projection of `RouteStopRowView` since WP6-6a — every flag it branches on is the kernel's. */
function RouteStopRow({
  row,
  index,
  animateIn,
  onLayoutY,
  onPress,
}: {
  row: RouteStopRowView
  /** Position in the list — drives the cascade's per-row delay. */
  index: number
  /** Play the staggered fade+rise entrance (a direction flip); false on first load (ADR-046). */
  animateIn: boolean
  onLayoutY: (y: number) => void
  onPress: () => void
}) {
  const lineX = RAIL_W / 2 - 1
  const { here, first, last } = row
  const locale = useLocale()

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
              {row.seq}
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
              <StopName name={row.name} variant="body" emphasis={here} numberOfLines={3} />
            </View>
            {row.fareLabel ? (
              <Text variant="body" className="shrink-0">
                <Fare label={row.fareLabel} style={{ verticalAlign: 'middle' }} />
              </Text>
            ) : null}
          </View>
          {row.arrivals.length > 0 ? <EtaTimes arrivals={row.arrivals} /> : null}
          {row.incomplete ? (
            // **A kerb we could not ask about, said on the row rather than for the screen** (ADR-116). A live
            // route watch asks each pole separately, so one board can refuse while the rest answer, and
            // `liveArrivals` — the one-line notice above the schematic — cannot say that without being wrong
            // about most of the route. This renderer does not subscribe (ADR-113 owes it no new affordance),
            // so it will not reach this in the field; it is here because the **spec** binds both renderers,
            // and a state one of them cannot draw is a state neither is measured on. Beside the times rather
            // than instead of them: a refused pole keeps its previous readings, so the ageing time and the
            // reason it is not moving are both true.
            <Text variant="label" className="mt-1 text-muted">
              {t(locale, 'etasUnavailable')}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  )
}
