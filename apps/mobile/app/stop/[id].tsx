import type {
  Locale,
  OperatorId,
  ResolvedClientPolicy,
  StopDetailPole,
  StopDetailRoute,
} from '@nextbus/core'
import {
  boardingPoleId,
  dedupeRoutes,
  etaReadout,
  formatBearing,
  formatDistance,
  formatHeadway,
  formatWalk,
  formatWalkRange,
  haversineMeters,
  operatorsOf,
  orderPoles,
  parseStopId,
  poleSideOctants,
  remarkView,
  splitStopCode,
  titleCaseName,
} from '@nextbus/core'
import { type LocalizedString, poleSideLabel, t } from '@nextbus/i18n'
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
import { MapAttribution, MiniMap } from '../../components/MiniMap'
import { RemarkTag } from '../../components/RemarkTag'
import { RouteChip } from '../../components/RouteChip'
import { SaveStar } from '../../components/SaveStar'
import { Skeleton } from '../../components/Skeleton'
import { StopHeader } from '../../components/StopHeader'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { operatorName } from '../../lib/operatorName'
import { useClientPolicy } from '../../lib/useClientPolicy'
import { useLiveEtas } from '../../lib/useLiveEtas'
import { useLocation } from '../../lib/useLocation'
import { useScrollToY } from '../../lib/useScrollToY'
import { useLocale } from '../../providers/LocaleProvider'

/**
 * Name for the operator of a pole id, e.g. `CTB:002403` → "Citybus" / "城巴". An id we cannot read
 * at all labels as nothing rather than as the letter `P` — which is what `id.split(':')[0]` produced
 * for a merged place. The unknown-*operator* case is handled by `operatorName`.
 */
function poleOperatorLabel(poleId: string, locale: Locale): LocalizedString {
  const operator = parseStopId(poleId)?.operator
  return operator ? operatorName(operator, locale) : ('' as LocalizedString)
}

/**
 * The heading printed above a pole's routes: its operator, then the stop code the operator published
 * in the name, if any — "KMB · TN510", "Citybus".
 *
 * Hoisted out of the JSX because it is now needed **twice**: once to render, and once to hand
 * `poleSideOctants` the very text it must compare (see the render site). Two inline copies of this
 * expression is precisely how the rule would come to be told about a heading the screen no longer
 * prints, and then quietly stop disambiguating.
 */
function poleHeading(poleId: string, name: string, locale: Locale): string {
  const code = splitStopCode(name).code
  return `${poleOperatorLabel(poleId, locale)}${code ? ` · ${code}` : ''}`
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
  const { policy } = useClientPolicy()

  const query = useQuery({
    queryKey: ['stop', id],
    enabled: !!id,
    queryFn: () => dataSource.getStop(id as string),
    // The whole stop document is no longer re-fetched on a cadence. This query is the initial snapshot
    // and the ADR-058 persistence vehicle; the *ETAs* arrive by subscription and are merged into this very
    // cache entry by `useLiveEtas` (WP5-0). The cadence still exists — it is the poll emulator's, and it is
    // the served `refreshAfterMs` because `useLiveEtas` is handed it below — but it now fetches
    // `/v1/etas/:id` instead of `/v1/stop/:id`, so a refresh costs the arrivals rather than the stop, its
    // members, every route and their service summaries.
    //
    // **The interval survives for the failure case only, and that is not tidiness.** Dropping it outright
    // made a failed first load *permanent*: `retry: 1` and `refetchOnWindowFocus: false` (QueryProvider)
    // mean nothing else ever asks again, so one lost packet on open left the rider looking at an error
    // string until they navigated away and back — where before, the 30 s interval healed it unprompted. The
    // subscription cannot help: it feeds ETAs into a cache entry that does not exist yet. So: no polling
    // while this succeeds, and the old self-healing while it does not.
    refetchInterval: (q) => (q.state.status === 'error' ? policy.refreshAfterMs : false),
  })
  // The first real consumer of the `watch()` seam. It holds no rules: the merge is the kernel's
  // `applyLiveEtasToStopDetail`, and which engine is behind the seam is not something this screen knows.
  // `enabled` waits for the first payload, because a pushed reading has nothing to merge into until then and
  // a dropped one is not re-sent — see the hook.
  // `now` comes back out of the subscription hook on purpose: `refetchInterval` was this screen's clock as
  // well as its fetch, so the hook that replaced the fetch hands the clock back. Without it the freshness
  // cue freezes — see the hook. Read `Date.now()` here instead and the ETA rows silently stop ageing.
  const { now } = useLiveEtas(id, {
    enabled: query.isSuccess,
    refreshAfterMs: policy.refreshAfterMs,
  })

  const stop = query.data?.stop
  const members: StopDetailPole[] = query.data?.members ?? []
  // `members` is passed so `dedupeRoutes` keys on each row's **boarding point**: where upstream
  // published one physical pole under two ids, a line boarding at "both" is one row (WP5-11).
  // The rows come back with their own raw pole ids, which is what `SaveStar` below persists — see
  // `boardingPoleId`. Rewriting them here instead would orphan every favourite it saves.
  const routes = query.data ? dedupeRoutes(query.data.routes, members) : []
  const multiPole = members.length > 1

  const cleanName = stop ? titleCaseName(splitStopCode(stop.name[locale]).label) : ''
  const here = loc.status === 'ready' ? { lat: loc.lat, lng: loc.lng } : null
  // Distance per pole (when located) → the place's walk is a *range* across its poles.
  const poleDist = new Map<string, number>()
  if (here) for (const m of members) poleDist.set(m.id, haversineMeters(here, m.location))
  const dists = [...poleDist.values()]
  const distanceM = here && stop ? haversineMeters(here, stop.location) : undefined

  // Routes grouped under the member pole they depart from (ADR-042); poles ordered with the
  // arrived-from `pole` first, then nearest, then the server order (`orderPoles`).
  // Grouped by the row's **boarding point**, not its raw pole: a row departing from a folded id
  // belongs under the member it was folded onto, and there is no heading of its own to put it under
  // (WP5-11). The row itself keeps its raw id for the star.
  const byPole = new Map<string, StopDetailRoute[]>()
  for (const r of routes) {
    const key = boardingPoleId(r.stopId, members)
    byPole.set(key, [...(byPole.get(key) ?? []), r])
  }
  // A pole with no rows left after `dedupeRoutes` is not rendered at all, so it is not part of the
  // list a rider is choosing between. Hoisted out of the JSX because `poleSideOctants` below must be
  // asked about exactly these poles: a side printed to tell a heading apart from one that is not on
  // screen is noise, and the whole rule is about not adding any.
  // `?pole=` goes through `boardingPoleId` for the same reason the grouping does: a route schematic
  // hands us the id its own stop list carries, which may be a folded one, and tier 1 of `orderPoles`
  // matches a member id.
  const shownPoles = orderPoles(
    members,
    pole === undefined ? undefined : boardingPoleId(pole, members),
    poleDist,
  ).filter((m) => (byPole.get(m.id)?.length ?? 0) > 0)
  // A compass side for the poles whose heading would otherwise be indistinguishable from a sibling's
  // — 567 of the 10 118 places in the shipped build print a duplicate one (WP5-10). The screen
  // contributes the heading text and the layout; every decision about *whether* a side is warranted
  // and *which* it is belongs to `poleSideOctants`, including its refusal where two poles sit too
  // close together for a compass word to mean anything. There is deliberately no fallback here for
  // the poles it declines: read that function's last section before adding one.
  const poleSides = poleSideOctants(
    shownPoles.map((m) => ({
      id: m.id,
      location: m.location,
      heading: poleHeading(m.id, m.name[locale], locale),
    })),
  )

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
                // A merged place has no single operator, and `parseStopId` says so by returning
                // null for a `P:` id — where `stop.id.split(':')[0]` used to hand MiniMap the
                // "operator" `P`, whose brand colour lookup silently missed. The multi-pole case
                // colours each dot from its own member below, so undefined is the honest answer.
                operator={parseStopId(stop.id)?.operator}
                points={
                  multiPole
                    ? members.map((m) => {
                        const pole = parseStopId(m.id)
                        return {
                          id: m.id,
                          lat: m.location.lat,
                          lng: m.location.lng,
                          operator: pole?.operator,
                          // The stop code from the name if the operator published one, else the
                          // raw operator stop id — short enough to label a dot.
                          label: splitStopCode(m.name[locale]).code ?? pole?.rawId,
                        }
                      })
                    : undefined
                }
                activeId={activePole}
                onPointPress={scrollToPole}
                label={cleanName}
                actionLabel={t(locale, 'openInMaps')}
                // StickyMap renders the LandsD credit itself — the crop would clip it. See below.
                deferAttribution
              />
            </StickyMap>

            {/* Flat list, no card chrome (docs/09: data is the hero). For a multi-pole place the
                routes are grouped under their pole; otherwise one flat list under "Routes". */}
            {multiPole ? (
              shownPoles.map((m, i, shown) => {
                const rs = byPole.get(m.id) ?? []
                const isLast = i === shown.length - 1
                const side = poleSides.get(m.id)
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
                      {/* The side is appended, never substituted: it earns its place only where
                            two poles print the same heading, so the operator and code stay put and
                            most places read exactly as they always have. `undefined` = the kernel
                            declined, which is the answer for a place whose poles sit a metre apart
                            — there is no fallback to reach for here. */}
                      <Text variant="label" className="text-subtle">
                        {poleHeading(m.id, m.name[locale], locale)}
                        {side !== undefined ? ` · ${poleSideLabel(side, locale)}` : ''}
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
                        policy={policy}
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
                    policy={policy}
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
      {/* The LandsD credit is a licence obligation and must stay on the map face at every collapse
          point (ADR-049). It belongs to *this* container, not to the map inside it: the inner
          canvas keeps its full `fullW` width and slides left, so anything anchored to its right
          edge is exactly what the crop throws away — at `PIP_MAX_WIDTH` on a wide viewport that's
          the whole chip. Anchored out here it tracks the visible window for free, with no
          per-frame work and no change to how it looks at rest. */}
      <MapAttribution />
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
  policy,
  onPress,
}: {
  r: StopDetailRoute
  locale: Locale
  now: number
  policy: ResolvedClientPolicy
  onPress: () => void
}) {
  // The readout and the remark come from the kernel, by the same two functions the Nearby card uses
  // (WP4-0). This row had been deriving both by hand — `isStale` + `etaLabelParts` plus an imminence
  // literal inside `EtaBadge`, and the locale lookup + `classifyRemark` fallback inside `RemarkTag` —
  // so two screens held two copies of one rule. This is the copy that would have been left behind when
  // Nearby moved, which is how the imminence threshold came to disagree with the served policy in the
  // first place.
  const readout = r.eta ? etaReadout(r.eta, locale, now, policy) : undefined
  const remark = remarkView(r.eta?.remark, locale, r.eta?.remarkKind)
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
            {remark ? <RemarkTag remark={remark} /> : null}
          </View>
        </View>
        {readout ? (
          <EtaBadge label={readout.label} urgency={readout.urgency} stale={readout.stale} />
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
    parts.push(
      `${t(locale, 'servedBy')} ${operators.map((o) => operatorName(o, locale)).join(', ')}`,
    )
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
