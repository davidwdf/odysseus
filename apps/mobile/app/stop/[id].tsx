import type { Route as BusRoute, Eta, LatLng, Locale, OperatorId } from '@nextbus/core'
import {
  formatBearing,
  formatDistance,
  formatHeadway,
  formatWalk,
  formatWalkRange,
  haversineMeters,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { type ReactNode, useRef, useState } from 'react'
import {
  Platform,
  Pressable,
  type ScrollView,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BearingArrow } from '../../components/BearingArrow'
import { COLLAPSE, collapsedHeaderH, expandedHeaderH } from '../../components/CollapsingHeader'
import { EtaBadge } from '../../components/EtaBadge'
import { MiniMap } from '../../components/MiniMap'
import { RemarkTag } from '../../components/RemarkTag'
import { RouteChip } from '../../components/RouteChip'
import { SaveStar } from '../../components/SaveStar'
import { Skeleton } from '../../components/Skeleton'
import { StopHeader } from '../../components/StopHeader'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { splitStopCode, titleCaseName } from '../../lib/stopName'
import { useLocation } from '../../lib/useLocation'
import { useScrollToY } from '../../lib/useScrollToY'
import { useLocale } from '../../providers/LocaleProvider'

/** Operator display names for the "served by" line — brand names, locale-neutral. */
const OPERATOR_LABEL: Record<OperatorId, string> = {
  KMB: 'KMB',
  LWB: 'LWB',
  CTB: 'Citybus',
  GMB: 'GMB',
}

/** The map is a **full-width hero at rest that shrinks into a right-aligned floating PIP on scroll**
 *  (ADR-045). Its **height is constant** (`MAP_HEIGHT`); only the width animates, from the full hero
 *  width to `SHRINK_FRAC` of it (capped by `PIP_MAX_WIDTH` on wide viewports). To keep this smooth on
 *  a raster-tile map we **animate a crop, not a scale**: the map renders at the hero width and the
 *  container clips it as it narrows, with the map sliding left to stay centred — so no horizontal
 *  distortion and no per-frame tile recompute. `MAP_GUTTER` is the side gutter; `MAP_GAP` the
 *  breathing room below the header. */
const MAP_HEIGHT = 150
const MAP_GAP = 8
const MAP_GUTTER = 16
const SHRINK_FRAC = 0.6
const PIP_MAX_WIDTH = 300

/** A route serving the place, plus the member pole (`stopId`) it departs from (ADR-042). */
type RouteEntry = { route: BusRoute; eta: Eta | null; fare?: string; stopId: string }

/** The place's member poles, from the server (one for a single stop; several for a place). */
type Pole = {
  id: string
  name: { en: string; 'zh-Hant': string; 'zh-Hans': string }
  location: LatLng
}

/** Collapse rider-duplicate variants (same route number + direction, e.g. two KMB
 *  service types to the same destination, or GMB "Normal"/"Special" variants of one route),
 *  keeping the one with a live ETA. Keyed by operator too, so a merged same-kerb stop keeps
 *  KMB-6 and CTB-6 as distinct rows. Safe for GMB even though its numbers repeat across
 *  regions: a stop is in one region and route_code is unique within a region, so two rows
 *  here sharing number+direction are always variants of the same route (ADR-047). */
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
  const { height: windowH, width: windowW } = useWindowDimensions()
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

  // Map (ADR-045): a full-width hero that shrinks into a right-aligned floating PIP as you scroll.
  // `heroW` is the rest width (full, minus side gutters); `pinnedW` the docked width; `mapTop` the
  // viewport y it docks to; `stickAt` the scroll offset at which it gets there — the map now rests
  // below the sub-details, so its dock point includes their measured height (`metaH`; native only —
  // web pins via CSS sticky regardless).
  const [metaH, setMetaH] = useState(0)
  const heroW = windowW - 2 * MAP_GUTTER
  const pinnedW = Math.min(PIP_MAX_WIDTH, Math.round(heroW * SHRINK_FRAC))
  const mapTop = collapsedHeaderH(insets.top) + MAP_GAP
  const stickAt = Math.max(0, topSpacer + metaH - mapTop)

  // Scroll-spy: highlight the map dot for the pole the list is scrolled to. Each pole group
  // reports its content-offset top (onLayout → `sectionOffsets`); as `scrollY` moves we pick the
  // last group whose header has reached the top of the list (just under the pinned map), and
  // highlight that dot. Falls back to the first group so a dot is always lit. `activePole` only
  // re-renders on a *change* (runOnJS gated by `lastActive`), so the per-frame cost stays on the
  // UI thread.
  const [activePole, setActivePole] = useState<string | null>(null)
  // Height of the bottom-most pole group → we pad the list with only *just* enough tail room to
  // scroll that last group up under the pinned map (not a whole empty screen).
  const [lastGroupH, setLastGroupH] = useState(0)
  const sectionOffsets = useSharedValue<Array<{ id: string; y: number }>>([])
  const lastActive = useSharedValue<string | null>(null)
  // Content offset that currently sits at the top of the list (just below the floating PIP), so a
  // scrolled-to group clears the card rather than hiding behind it.
  const listTop = mapTop + MAP_HEIGHT + MAP_GAP
  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      const line = y + listTop
      let active: string | null = null
      let best = -1
      let firstId: string | null = null
      let firstY = Number.POSITIVE_INFINITY
      for (const o of sectionOffsets.value) {
        if (o.y < firstY) {
          firstY = o.y
          firstId = o.id
        }
        if (o.y <= line && o.y > best) {
          best = o.y
          active = o.id
        }
      }
      if (active === null) active = firstId
      if (active !== lastActive.value) {
        lastActive.value = active
        runOnJS(setActivePole)(active)
      }
    },
    [listTop],
  )
  const recordSection = (poleId: string, y: number) => {
    const rest = sectionOffsets.value.filter((o) => o.id !== poleId)
    sectionOffsets.value = [...rest, { id: poleId, y }]
  }
  // Web-safe, reduced-motion-aware smooth scroll (see useScrollToY / ADR-045).
  const scrollToY = useScrollToY(scrollRef)
  // Tapping a dot (or its list header) scrolls its pole's group to the top, just under the map.
  const scrollToPole = (poleId: string) => {
    const o = sectionOffsets.value.find((s) => s.id === poleId)
    if (o) scrollToY(o.y - listTop)
  }

  return (
    <View className="flex-1 bg-bg">
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Just enough tail padding for the last group to scroll up to under the pinned map (so
        // tapping the last dot/header highlights it) — not a whole empty screen. Once its height is
        // measured we pad `viewport − listTop − lastGroupH`; a lone stop needs none.
        contentContainerStyle={{
          paddingBottom: multiPole ? Math.max(24, windowH - listTop - lastGroupH) : 32,
        }}
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
            {/* Sub-details sit **above** the map so they tuck up behind the header as you scroll
                (rather than wedged between the map and the list). */}
            <View onLayout={(e) => setMetaH(e.nativeEvent.layout.height)}>
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
                bearingDeg={stop.bearingDeg}
                locale={locale}
              />
            </View>

            {/* Map — a **full-width hero that shrinks into a right-aligned floating PIP** as you
                scroll (a static keyless preview; a pin per pole for a multi-pole place). Each dot is
                brand-coloured + labelled, highlights the scrolled-to pole, and scrolls its group into
                view on tap (ADR-045). The vertical dock uses **CSS `position: sticky` on web**
                (browser-composited → no jitter) / a reanimated `translateY` clamp on native; the
                width shrink is a reanimated crop. */}
            <StickyMap
              scrollY={scrollY}
              stickAt={stickAt}
              top={mapTop}
              fullW={heroW}
              pinnedW={pinnedW}
            >
              <MiniMap
                lat={stop.location.lat}
                lng={stop.location.lng}
                height={MAP_HEIGHT}
                operator={stop.id.split(':')[0] as OperatorId}
                points={
                  multiPole
                    ? members.map((m) => ({
                        id: m.id,
                        lat: m.location.lat,
                        lng: m.location.lng,
                        operator: m.id.split(':')[0] as OperatorId,
                        label: splitStopCode(m.name[locale]).code ?? m.id.split(':')[1],
                      }))
                    : undefined
                }
                activeId={activePole}
                onPointPress={scrollToPole}
                label={cleanName}
                actionLabel={t(locale, 'openInMaps')}
              />
            </StickyMap>

            {/* Flat list, no card chrome (docs/09: data is the hero). For a multi-pole place the
                routes are grouped under their pole; otherwise one flat list under "Routes". */}
            {multiPole ? (
              orderedPoles
                .filter((m) => (byPole.get(m.id)?.length ?? 0) > 0)
                .map((m, i, shown) => {
                  const rs = byPole.get(m.id) ?? []
                  const isLast = i === shown.length - 1
                  const op = m.id.split(':')[0] as OperatorId
                  const code = splitStopCode(m.name[locale]).code
                  const d = poleDist.get(m.id)
                  return (
                    <View
                      key={m.id}
                      onLayout={(e) => {
                        recordSection(m.id, e.nativeEvent.layout.y)
                        if (isLast) setLastGroupH(e.nativeEvent.layout.height)
                      }}
                    >
                      {/* Section divider, inset to the content margin (not full-bleed) so it lines up
                          with the text and the map card. */}
                      <View className="mx-4 border-border border-t" />
                      {/* Tapping the pole header scrolls it to the top of the list and highlights its
                        map dot — the list-side twin of tapping the dot. */}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => scrollToPole(m.id)}
                        className="flex-row items-end justify-between px-4 pt-4 pb-1 active:opacity-60"
                      >
                        <Text variant="label" className="text-subtle">
                          {OPERATOR_LABEL[op] ?? op}
                          {code ? ` · ${code}` : ''}
                        </Text>
                        {d != null ? (
                          <Text variant="caption" className="text-subtle">
                            {formatWalk(d, locale)}
                          </Text>
                        ) : null}
                      </Pressable>
                      {rs.map((r) => (
                        <RouteRowItem
                          key={r.route.id}
                          r={r}
                          locale={locale}
                          now={now}
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
                {routes.map((r) => (
                  <RouteRowItem
                    key={r.route.id}
                    r={r}
                    locale={locale}
                    now={now}
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
        onTitlePress={() => scrollToY(0)}
        backLabel={t(locale, 'back')}
      />
    </View>
  )
}

/** The map: a **full-width hero that shrinks into a right-aligned floating PIP** as the list scrolls
 *  (over the header's `COLLAPSE` distance). It's a **crop, not a scale** — the map renders at `fullW`
 *  and the right-aligned outer container narrows to `pinnedW`, clipping it (`overflow: hidden`), while
 *  the inner map slides left by half the lost width so it stays centred. Height is untouched, so no
 *  horizontal distortion and no per-frame tile recompute. The vertical dock uses CSS `position:
 *  sticky` on **web** (browser-composited, jitter-free) and a reanimated `translateY` clamp on
 *  **native**; `top` is the viewport y it docks to. */
function StickyMap({
  scrollY,
  stickAt,
  top,
  fullW,
  pinnedW,
  children,
}: {
  scrollY: SharedValue<number>
  stickAt: number
  top: number
  fullW: number
  pinnedW: number
  children: ReactNode
}) {
  const outerStyle = useAnimatedStyle(() => {
    const w = interpolate(scrollY.value, [0, COLLAPSE], [fullW, pinnedW], Extrapolation.CLAMP)
    // Web pins vertically via CSS sticky; native counter-scrolls with translateY.
    return Platform.OS === 'web'
      ? { width: w }
      : { width: w, transform: [{ translateY: Math.max(0, scrollY.value - stickAt) }] }
  })
  // Slide the (fixed-width) map left by half the cropped-off width so it stays centred in the window.
  const innerStyle = useAnimatedStyle(() => {
    const w = interpolate(scrollY.value, [0, COLLAPSE], [fullW, pinnedW], Extrapolation.CLAMP)
    return { transform: [{ translateX: -(fullW - w) / 2 }] }
  })
  const base: ViewStyle = {
    alignSelf: 'flex-end',
    marginRight: MAP_GUTTER,
    marginBottom: MAP_GAP + 4, // small gap before the list's first divider
    height: MAP_HEIGHT,
    overflow: 'hidden',
    zIndex: 10,
  }
  const webPos = (Platform.OS === 'web' ? { position: 'sticky', top } : null) as ViewStyle | null
  return (
    <Animated.View
      className="rounded-2xl border border-border bg-surface-2 shadow-lg"
      style={[base, webPos, outerStyle]}
    >
      <Animated.View style={[{ width: fullW, height: MAP_HEIGHT }, innerStyle]}>
        {children}
      </Animated.View>
    </Animated.View>
  )
}

/** One route row: chip + "→ destination" (+ remark), and the live ETA or scheduled headway on
 *  the right. Compact, divider-free rows that mirror the Nearby list. Shared by the flat and
 *  pole-grouped layouts. */
function RouteRowItem({
  r,
  locale,
  now,
  onPress,
}: {
  r: RouteEntry
  locale: Locale
  now: number
  onPress: () => void
}) {
  // Row content and the save star are *sibling* tap targets (never nested — nested
  // interactive elements are invalid HTML on web, which RN-web flags). The star is just a
  // saved-state indicator here (hidden until saved); favouriting happens via the route
  // schematic's action sheet. Keyed on the member pole (`r.stopId`), never the place id.
  return (
    <View className="flex-row items-center gap-2 px-4">
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="min-w-0 flex-1 flex-row items-center justify-between gap-3 py-1.5 active:opacity-60"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
          <RouteChip operator={r.route.operator} routeNo={r.route.routeNo} />
          <View className="flex-1">
            <Text variant="body" className="text-text" numberOfLines={1}>
              <Text className="text-subtle">→ </Text>
              {titleCaseName(r.route.destination[locale])}
            </Text>
            {r.eta?.remark ? <RemarkTag remark={r.eta.remark} locale={locale} /> : null}
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
      <SaveStar stopId={r.stopId} routeId={r.route.id} size={20} hideWhenEmpty />
    </View>
  )
}

/** A one-line place summary: operators served · route count · distance + walk (when located;
 *  `walk` is a single time or a range across the poles). */
function StopMeta({
  operators,
  routeCount,
  distanceM,
  walk,
  bearingDeg,
  locale,
}: {
  operators: OperatorId[]
  routeCount: number
  distanceM?: number
  walk?: string
  /** Travel direction of a merged place (deg) → a compass cue; absent for a lone stop. */
  bearingDeg?: number
  locale: Locale
}) {
  const parts: string[] = []
  if (bearingDeg != null) parts.push(formatBearing(bearingDeg, locale))
  if (operators.length > 0) {
    parts.push(`${t(locale, 'servedBy')} ${operators.map((o) => OPERATOR_LABEL[o]).join(', ')}`)
  }
  parts.push(`${routeCount} ${t(locale, 'routesLabel')}`)
  if (distanceM != null && walk) parts.push(`${formatDistance(distanceM)} · ${walk}`)
  return (
    <View className="mb-3 px-4">
      {/* Icon lives *inside* the text so it sits on the first line and the meta wraps underneath it,
          rather than a flex sibling that centres against the whole wrapped block. */}
      <Text variant="caption" className="text-muted">
        {bearingDeg != null ? (
          <BearingArrow bearingDeg={bearingDeg} size={12} tone="muted" inline />
        ) : null}
        {bearingDeg != null ? '  ' : ''}
        {parts.join('  ·  ')}
      </Text>
    </View>
  )
}
