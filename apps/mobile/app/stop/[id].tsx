import type { PlaceRouteRow } from '@nextbus/core'
import { newestPlaceBoard, placeDetailView } from '@nextbus/core'
import { operatorName, poleSideLabel, t } from '@nextbus/i18n'
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
import { FeedNotice, feedNotice } from '../../components/FeedNotice'
import { MapAttribution, MiniMap } from '../../components/MiniMap'
import { RemarkTag } from '../../components/RemarkTag'
import { RouteChip } from '../../components/RouteChip'
import { SaveStar } from '../../components/SaveStar'
import { Skeleton } from '../../components/Skeleton'
import { StopHeader } from '../../components/StopHeader'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { useClientPolicy } from '../../lib/useClientPolicy'
import { useLiveEtas } from '../../lib/useLiveEtas'
import { useLocation } from '../../lib/useLocation'
import { useOnline } from '../../lib/useOnline'
import { useScrollToY } from '../../lib/useScrollToY'
import { useLocale } from '../../providers/LocaleProvider'

// `poleOperatorLabel` and `poleHeading` used to live here. They are `placeDetailView`'s now (WP6-3): the
// heading is composed by the kernel, because the `·` separator IS the composition and the rule that tells
// two kerbs apart must be handed the very text the screen prints. Two copies of that expression is exactly
// how the rule would come to be told about a heading the screen no longer draws.

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
  const here = loc.status === 'ready' ? { lat: loc.lat, lng: loc.lng } : null

  /**
   * **The whole screen's content, in one call** (WP6-3). Ten decisions used to live here as loose
   * expressions — the pole heading and its separator, the per-kerb distances, whether the walk is a single
   * time or a range, the summary line and *its* two separator widths, the grouping under boarding points,
   * which poles are shown at all, each row's three-way readout, whether the place is grouped, and (WP6-3b)
   * **the map's pins**: which dots exist, what each is labelled with and which of them fold together — every
   * one of them reachable only by rendering this tree. They are `placeDetailView` now, pinned by 15 corpus
   * cases, so `apps/web`'s Place screen calls the identical function rather than re-deriving them from this
   * JSX (WP4-0's method, applied to the screen with the most domain rules in the app).
   *
   * The **words** it composes with are handed in, never imported by the kernel (ADR-054: core owns the
   * rule, the catalogue owns the word). `routeCount` is a function because the plural rule is the
   * catalogue's — see the note on that field for the "1 routes" defect this hoist reproduces faithfully
   * rather than silently fixing.
   */
  const view = query.data
    ? placeDetailView(query.data, {
        locale,
        now,
        policy,
        ...(here === null ? {} : { here }),
        ...(pole === undefined ? {} : { arrivedFromPole: pole }),
        labels: {
          operator: (o) => operatorName(o, locale),
          servedBy: t(locale, 'servedBy'),
          routeCount: (n) => `${n} ${t(locale, 'routesLabel')}`,
          side: (octant) => poleSideLabel(octant, locale),
        },
      })
    : undefined
  /**
   * The screen's freshness notice (ADR-133, wired on this renderer by ADR-150).
   *
   * Read off the **payload** rather than the view: `PlaceDetailView` carries no `lastUpdatedIso` the way
   * `RouteDetailView` does, and the answer is the same `newestBoard` rule either way — see
   * `newestPlaceBoard`. `useLiveEtas` writes each round into the query cache, so these timestamps age when
   * the feed stops, whatever the last fetch did.
   */
  const online = useOnline()
  const notice = feedNotice({
    lastUpdatedIso: newestPlaceBoard(query.data === undefined ? [] : [query.data]),
    now,
    online,
    trouble: query.isError ? 'unreachable' : 'none',
    staleAfterMs: policy.staleAfterMs,
  })

  const cleanName = view?.name.label ?? ''
  // `poleDist` used to be measured here and handed to nothing but the map. The map takes `view.pins` now
  // (WP6-3b) and every group carries its own `walk`, so the last piece of geometry has left this file.

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
  /** A row opens that route *at* this kerb. The path is the shell's; the row carries its own raw pole id,
   *  which is what `?stop=` must be — a favourite and an "arrivals here" card are keyed on the same thing. */
  const openRoute = (row: PlaceRouteRow) =>
    router.push(`/route/${encodeURIComponent(row.routeId)}?stop=${encodeURIComponent(row.stopId)}`)

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
          paddingBottom: view?.grouped ? Math.max(24, windowH - listTop - lastGroupH) : 32,
        }}
      >
        <View style={{ height: topSpacer }} />
        {/*
          **The skeleton is the fallback arm, and that is a bug fix (WP6-3b).** It used to read
          `isLoading ? skeleton : isError ? message : stop && view ? content : null`, and that trailing
          `null` is reachable: `isLoading` is `isPending && isFetching`, so a query that is pending and
          **not fetching** — a paused retry — matched none of the three arms and this screen rendered
          *nothing at all*, for ever. Measured on 2026-08-05 against a 404 on both renderers: no skeleton,
          no error text, no name. ADR-079 already fixed the permanently-dead screen for the `error` case;
          this is the same failure arriving through a state that never reaches `error`, so that fix's
          `refetchInterval` predicate never fires either. Ordering the arms so "we have no answer" is the
          **default** makes every query state draw something, which is what `place-detail.spec.json`'s
          `failed.mustNot` — *"a blank screen"* — asks for. Why the retry pauses is undiagnosed and is in
          `docs/07` with the reproduction.
        */}
        {stop && view ? (
          <>
            {/* Sub-details sit **above** the map so they tuck up behind the header as you scroll
                (rather than wedged between the map and the list). */}
            <View onLayout={(e) => setMetaH(e.nativeEvent.layout.height)}>
              {/* One string, composed by the kernel — separators, order, omissions and all. This used to be
                  four expressions and a `parts.join()` in this file; `placeDetailView` owns them now, so the
                  DOM renderer prints the identical sentence rather than reassembling it. */}
              <StopMeta summary={view.summary} bearingDeg={view.bearingDeg} />
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
                height={MAP_HEIGHT}
                // The pins are the kernel's (WP6-3b): which dots exist, what each is labelled with —
                // the printed code the heading above it uses, else the raw pole id — which operator
                // colours it, and which of them fold together because they share a coordinate
                // (ADR-086). This screen built all four here, one `members.map` at a time, and the
                // DOM renderer's map would have had to arrive at every one of them independently.
                pins={view.pins}
                grouped={view.grouped}
                activeId={activePole}
                onPointPress={scrollToPole}
                label={cleanName}
                actionLabel={t(locale, 'openInMaps')}
                // StickyMap renders the LandsD credit itself — the crop would clip it. See below.
                deferAttribution
              />
            </StickyMap>

            {/* The screen's own freshness line, above the list and below the map — the same position
                `apps/web` puts it in, and the one that reads as being about the times rather than about
                the place. It answers a different question from a kerb's own refusal marker: that one says
                an upstream board would not answer, this says we have stopped being fed at all (ADR-133). */}
            <FeedNotice notice={notice} />

            {/* Flat list, no card chrome (docs/09: data is the hero). For a multi-pole place the
                routes are grouped under their pole; otherwise one flat list under "Routes". */}
            {view.grouped ? (
              view.groups.map((group, i, groups) => {
                const isLast = i === groups.length - 1
                return (
                  <View
                    key={group.poleId}
                    onLayout={(e) => {
                      recordSection(group.poleId, e.nativeEvent.layout.y)
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
                      onPress={() => scrollToPole(group.poleId)}
                      className="flex-row items-end justify-between px-4 pt-4 pb-1 active:opacity-60"
                    >
                      {/* A column, because the heading can now carry a second line: the walk time stays
                            on the right of the row and everything the kernel says about this kerb
                            stacks under the heading. `shrink` so a long pole name wraps rather than
                            pushing the walk time off the row. */}
                      <View className="shrink pr-3">
                        {/* The side is appended, never substituted: it earns its place only where
                              two poles print the same heading, so the operator and code stay put and
                              most places read exactly as they always have. */}
                        {/* The heading, side and all — composed by the kernel, because the separator is
                            part of the composition and two renderers joining their own get a plausible
                            heading with the wrong rhythm and nothing fails (ADR-069's first finding). */}
                        <Text variant="label" className="text-subtle">
                          {group.heading}
                        </Text>
                        {/* The pole's own name, where that is what tells this kerb from its sibling —
                              143 of the declined groups in the shipped build (ADR-080). A plain string
                              and not a `LocalizedString`: the kernel has already picked the locale and
                              title-cased it, so `dataText` would be laundering it through the wrong
                              door. */}
                        {group.distinctName !== undefined ? (
                          <Text variant="label" className="text-muted">
                            {group.distinctName}
                          </Text>
                        ) : null}
                        {/* …and where nothing can, the app says so rather than leaving a rider to work
                              out for themselves that two identical headings are two different kerbs.
                              Same variant and token as ADR-077's `etasUnavailable` on a Nearby card —
                              deliberately not `caption`, which is reserved for timestamps. */}
                        {group.crowded ? (
                          <Text variant="label" className="text-muted">
                            {t(locale, 'poleTooCloseToTell')}
                          </Text>
                        ) : null}
                      </View>
                      {group.walk !== undefined ? (
                        <Text variant="caption" className="text-subtle">
                          {group.walk}
                        </Text>
                      ) : null}
                    </Pressable>
                    {group.rows.map((row) => (
                      <RouteRowItem key={row.routeId} row={row} onPress={() => openRoute(row)} />
                    ))}
                  </View>
                )
              })
            ) : (
              <>
                <Text variant="label" className="mb-1 px-4 text-subtle">
                  {t(locale, 'routesAtStop')}
                </Text>
                {view.rows.map((row) => (
                  <RouteRowItem key={row.routeId} row={row} onPress={() => openRoute(row)} />
                ))}
              </>
            )}
          </>
        ) : query.isError ? (
          <Text variant="body" className="px-4 text-danger">
            {(query.error as Error).message}
          </Text>
        ) : (
          <View className="gap-3 px-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </View>
        )}
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

/**
 * One route at this place: the chip, where it is headed, and the right-hand readout.
 *
 * **It decides nothing.** Every string in it — the destination, the remark, the readout and its three-way
 * fallback to a timetable frequency — arrives on the `PlaceRouteRow` the kernel derived (WP6-3). It had been
 * deriving all four by hand, which is how the imminence threshold came to disagree with the served policy
 * for months: two screens held two copies of one rule, and the copy left behind when Nearby moved was this.
 */
function RouteRowItem({ row, onPress }: { row: PlaceRouteRow; onPress: () => void }) {
  // Row content and the save star are *sibling* tap targets (never nested — nested interactive elements are
  // invalid HTML on web, and `sibling-not-nested` is a conformance check now). The star is a saved-state
  // indicator here; favouriting happens via the route schematic's action sheet. Keyed on the member pole
  // (`row.stopId`), never the place id — see `boardingPoleId`.
  return (
    <View className="flex-row items-center gap-2 px-4">
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className="min-w-0 flex-1 flex-row items-center justify-between gap-3 py-1.5 active:opacity-60"
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
          <RouteChip operator={row.operator} routeNo={row.routeNo} />
          <View className="flex-1">
            <Text variant="body" className="text-text" numberOfLines={1}>
              <Text className="text-subtle">→ </Text>
              {row.destination}
            </Text>
            {row.remark ? <RemarkTag remark={row.remark} /> : null}
          </View>
        </View>
        {row.readout.kind === 'eta' ? (
          <EtaBadge label={row.readout.label} urgency={row.readout.urgency} />
        ) : row.readout.kind === 'headway' ? (
          <Text variant="caption" className="max-w-[120px] text-right text-subtle">
            {row.readout.text}
          </Text>
        ) : (
          <Text variant="h3" className="text-subtle">
            —
          </Text>
        )}
      </Pressable>
      <SaveStar stopId={row.stopId} routeId={row.routeId} size={20} hideWhenEmpty />
    </View>
  )
}

/**
 * The one-line place summary.
 *
 * The sentence is the kernel's, separators and all (`placeDetailView`); this draws the compass needle beside
 * it and nothing else. It used to assemble the parts itself — direction, "served by", the count, the
 * distance and the walk — with a `parts.join('  ·  ')` whose two widths are semantic, which is exactly the
 * composition HTML collapses if the other renderer re-does it (ADR-069's first finding).
 */
function StopMeta({ summary, bearingDeg }: { summary: string; bearingDeg?: number }) {
  return (
    <View className="mb-3 px-4">
      {/* Icon lives *inside* the text so it sits on the first line and the meta wraps underneath it, rather
          than a flex sibling that centres against the whole wrapped block. */}
      <Text variant="caption" className="text-muted">
        {bearingDeg != null ? (
          <BearingArrow bearingDeg={bearingDeg} size={12} tone="muted" inline />
        ) : null}
        {bearingDeg != null ? '  ' : ''}
        {summary}
      </Text>
    </View>
  )
}
