import { newestPlaceBoard, type PlaceRouteRow, placeDetailView } from '@nextbus/core'
import { operatorName, poleSideLabel, t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { BearingArrow } from '../components/BearingArrow'
import { FeedNotice, feedNotice } from '../components/FeedNotice'
import { MiniMap } from '../components/MiniMap'
import { PlaceRow } from '../components/PlaceRow'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { useLiveEtas } from '../hooks/useLiveEtas'
import { useLocation } from '../hooks/useLocation'
import { useOnline } from '../hooks/useOnline'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'
import { COLLAPSED_HEIGHT, CollapsingHeader } from '../shell/CollapsingHeader'
import { CONTENT_INSET_TOP } from '../shell/layout'

/**
 * Place detail, rendered by React DOM from the identical kernel function the React Native screen uses
 * (WP6-3b). Put this file beside `apps/mobile/app/stop/[id].tsx` and the difference is elements, classes
 * and motion: `placeDetailView` produces the summary and its two separator widths, every kerb heading and
 * the compass side appended to it, each kerb's walk, the grouping itself, every row's three-way readout, and
 * the map's pins — once, for both.
 *
 * `packages/contract/ui/place-detail.spec.json` declares what it must show in each of thirteen states, and
 * `test/place-detail-states.test.tsx` drives every projected one — as does
 * `apps/mobile/test/place-detail-states.test.tsx`, from the same file and the same corpus fixtures.
 *
 * ## Three places this deliberately differs from the RN screen, all of them declared `idiom`
 *
 *  · **The header is in the document flow, first**, where the RN screen floats a collapsing header over its
 *    scroll content and therefore renders it last. Both put the name at the top of the screen; only this one
 *    puts it first for a keyboard and a screen reader. It is why each driver reads its own chrome first.
 *  · **The map is a plain sticky panel**, not a hero that crops into a picture-in-picture (ADR-045). The
 *    *pins* are not idiom and are not re-derived; where the map goes is.
 *  · **No pull-to-refresh**, for the reason Nearby's spec gives: since WP5-7 the arrivals arrive by
 *    subscription at the served cadence, so a manual refresh is reassurance rather than how a rider gets
 *    fresh data.
 */
export function PlaceDetail() {
  const { id } = useParams<{ id: string }>()
  const [search] = useSearchParams()
  // The member pole the rider arrived from (route → place), if any — its group sorts to the top.
  const arrivedFromPole = search.get('pole') ?? undefined
  const locale = useLocale()
  const navigate = useNavigate()
  const { policy } = useClientPolicy()
  // A silent read: this screen never prompts for location, and shows a distance only if a fix already exists.
  const { state: loc } = useLocation()
  const here = loc.status === 'ready' ? { lat: loc.lat, lng: loc.lng } : null

  const query = useQuery({
    queryKey: ['stop', id],
    enabled: !!id,
    queryFn: () => dataSource.getStop(id as string),
    // Only on error, and the same shape as the RN screen's. The ETAs arrive by subscription, so a healthy
    // screen needs no refetch — but a failed first load must find its way back, and nothing else here would
    // let it: `retry` is 1, `refetchOnWindowFocus` is false, and there is no pull-to-refresh. Dropping it
    // outright is what made a lost first packet a permanently dead screen (ADR-079).
    refetchInterval: (q) => (q.state.status === 'error' ? policy.refreshAfterMs : false),
  })

  // The clock comes back out of the subscription hook: `refetchInterval` was this screen's clock as well as
  // its fetch, so the hook that replaced the fetch hands the clock back. Read `Date.now()` here instead and
  // the readouts silently stop ageing.
  const { now } = useLiveEtas(id, {
    enabled: query.isSuccess,
    refreshAfterMs: policy.refreshAfterMs,
  })

  /**
   * The whole screen's content, in one call. Nothing below this line decides anything.
   *
   * The **words** it composes with are handed in and never imported by the kernel (ADR-054: core owns the
   * rule, the catalogue owns the word), and they are the identical four the RN screen passes — `operatorName`
   * and `poleSideLabel` both live in `@nextbus/i18n` precisely so that this is a second *call* and not a
   * second table.
   */
  const view = query.data
    ? placeDetailView(query.data, {
        locale,
        now,
        policy,
        ...(here === null ? {} : { here }),
        ...(arrivedFromPole === undefined ? {} : { arrivedFromPole }),
        labels: {
          operator: (o) => operatorName(o, locale),
          servedBy: t(locale, 'servedBy'),
          routeCount: (n) => `${n} ${t(locale, 'routesLabel')}`,
          side: (octant) => poleSideLabel(octant, locale),
        },
      })
    : undefined

  /**
   * The screen's freshness notice (ADR-133, wired here by ADR-150).
   *
   * Read off the **payload** rather than the view, and that is not an oversight: `PlaceDetailView` carries no
   * `lastUpdatedIso` the way `RouteDetailView` does, because a place's boards are one per row and the answer
   * is the same `newestBoard` rule either way — see `newestPlaceBoard`. The subscription writes each round
   * into the query cache (`useLiveEtas`), so these timestamps age when the feed stops, whatever the last
   * fetch did.
   */
  const online = useOnline()
  const notice = feedNotice({
    lastUpdatedIso: newestPlaceBoard(query.data === undefined ? [] : [query.data]),
    now,
    online,
    trouble: query.isError ? 'unreachable' : 'none',
    staleAfterMs: policy.staleAfterMs,
  })

  const openRoute = (row: PlaceRouteRow) =>
    navigate(`/route/${encodeURIComponent(row.routeId)}?stop=${encodeURIComponent(row.stopId)}`)

  // Scroll-spy: which kerb section is at the top of the list, so its map dot can be emphasised — and the
  // list-side twin, tapping a heading (or a dot) to bring that section up. Both are *geometry*, which is why
  // this is the one part of the file `check-no-derivation` has to be told about by name.
  const sections = useRef(new Map<string, HTMLElement>())
  /** The docked map card, so the spy's line is the edge a heading actually has to clear. */
  const mapCard = useRef<HTMLDivElement | null>(null)
  const [activePole, setActivePole] = useState<string | null>(null)
  const registerSection = useCallback((poleId: string, el: HTMLElement | null) => {
    if (el) sections.current.set(poleId, el)
    else sections.current.delete(poleId)
  }, [])
  // The page scrolls, not an element inside it, so the listener is the window's. An `onScroll` on the
  // `<main>` would never fire — a DOM detail with no analogue in the RN screen, whose `Animated.ScrollView`
  // *is* the scroller.
  //
  // `id` is the dependency and the effect body does not name it, which is deliberate and is the same shape
  // `useLiveNearby` documents: the section registry is a **ref**, so nothing about a new place reaches this
  // effect on its own — and the one thing that has to happen when the place changes is the *initial*
  // highlight, before any scroll. The listener itself reads the registry live and never goes stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `id` is what a new place changes; see above
  useEffect(() => {
    const onScroll = () => {
      // The last section whose heading has reached the line just under the sticky map, else the first — so a
      // dot is always lit. A plain loop rather than a `.reduce`, because the gate's shape rules are about a
      // *renderer deciding something* and a scroll offset is not that.
      //
      // **The line is the card's own bottom edge, and that is the whole of one bug.** It used to be
      // `STICKY_TOP + MAP_HEIGHT` — 206 — while the snap point was 214, so a section scrolled to by a tap
      // landed *below* the line the spy tested and the section above it stayed lit: tapping any kerb
      // highlighted the wrong dot, every time. `apps/mobile` cannot have this bug, because one `listTop`
      // feeds both its reaction and its `scrollToPole`.
      //
      // Measured rather than recomputed, which is the stronger version of the same fix: there is no second
      // expression that can drift from `SECTION_SNAP`, and while the card is still travelling to its dock
      // the line travels with it — which is what "has this heading cleared the map" means at any scroll
      // position. The fallback is for the frame before the card exists.
      const card = mapCard.current
      const line =
        (card === null ? SNAP_BASE : card.getBoundingClientRect().bottom + MAP_GAP) + SPY_TOLERANCE
      let active: string | null = null
      let best = Number.NEGATIVE_INFINITY
      let firstId: string | null = null
      let firstTop = Number.POSITIVE_INFINITY
      for (const [poleId, el] of sections.current) {
        const top = el.getBoundingClientRect().top
        if (top < firstTop) {
          firstTop = top
          firstId = poleId
        }
        if (top <= line && top > best) {
          best = top
          active = poleId
        }
      }
      setActivePole(active ?? firstId)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [id])
  const scrollToPole = (poleId: string) => {
    // `scrollIntoView` rather than a computed offset, so the browser honours `scroll-behavior: smooth` and
    // the rider's reduced-motion setting without this screen owning either decision. Where it lands is
    // `scrollMarginTop: LIST_TOP` on the section, which is the spy's line.
    sections.current.get(poleId)?.scrollIntoView({ block: 'start' })
  }

  /**
   * How tall the bottom-most kerb group is, so the page can be padded with **just enough** room for it to
   * scroll up under the docked map — and not a whole empty screen. `apps/mobile` measures the same thing
   * (`lastGroupH`) for the same reason.
   *
   * Without it the last dot cannot be reached at all: a place whose content is shorter than a viewport
   * stops scrolling before its final heading gets anywhere near the line, so tapping that dot moves nothing
   * and lights nothing. It is also why the map barely docked — there was not enough page to dock against.
   *
   * A React 19 ref callback returning its own cleanup, which is what lets the observer live and die with the
   * element rather than needing a second ref and an effect. `ResizeObserver` is guarded because jsdom has
   * none; there the tail is 0 and the padding falls back to its floor, which is the right answer for an
   * environment that does not lay anything out.
   */
  const [tailH, setTailH] = useState(0)
  const measureTail = useCallback((el: HTMLElement | null) => {
    if (el === null) return
    const apply = () => setTailH(el.getBoundingClientRect().height)
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const tailPadding = tailRoom(view?.grouped === true, tailH)

  return (
    <main className="min-h-dvh bg-bg" style={{ paddingBottom: tailPadding }}>
      {/* The chrome, in flow and first — see the note above. The name arrives with the data; the back
          control does not wait for it, deliberately, so a rider can leave a screen that is still loading. */}
      <BackButton />
      {/* The same collapsing header Route detail uses (ADR-033, ADR-100) — a pin badge instead of a route
          chip, and the RN `StopHeader`'s parameters: a shorter expanded height and a smaller label, since a
          place has one line where a route has a journey. */}
      <CollapsingHeader
        expandedHeight={118}
        labelExpandedTop={86}
        labelExpandedSize={20}
        labelCollapsedSize={15}
        badge={
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2">
            <MapPin size={16} className="text-accent" aria-hidden />
          </span>
        }
        label={view?.name.label ?? ''}
      />

      {/*
        **The skeleton is the fallback arm, and that is a bug fix.** It used to read
        `isLoading ? skeleton : isError ? message : view ? content : null`, and that trailing `null` is
        reachable: `isLoading` is `isPending && isFetching`, so a query that is pending and **not fetching** —
        a paused retry — matched none of the three arms and the screen rendered *nothing at all*, for ever.
        Measured on 2026-08-05 against a 404 on both renderers: `main` had exactly one child, no skeleton and
        no error text. ADR-079 had already fixed the permanently-dead screen for the `error` case; this is the
        same failure arriving through a state that never reaches `error`, so its `refetchInterval` predicate
        never fires either. Ordering the arms so that "we have no answer" is the **default** makes every query
        state draw something, which is what `failed.mustNot` — *"a blank screen"* — asks for. Why the retry
        pauses is not diagnosed and is in `docs/07` with the reproduction.
      */}
      {view ? (
        <>
          {/* One string, composed by the kernel — separators, order and omissions and all.
              `whitespace-pre-wrap` is load-bearing rather than cosmetic: the summary uses two separator
              widths on purpose and HTML collapses consecutive whitespace (ADR-069). */}
          <p className="m-0 flex items-center gap-1 px-4 pb-3 text-caption text-muted">
            {view.bearingDeg != null ? (
              <BearingArrow bearingDeg={view.bearingDeg} size={12} />
            ) : null}
            <span className="whitespace-pre-wrap">{view.summary}</span>
          </p>

          {/* A plain sticky panel: the crop-into-a-PIP is the RN app's idiom, declared as such in the spec. */}
          <div
            ref={mapCard}
            className="sticky z-10 mx-4 mb-2 overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-lg"
            style={{ top: MAP_TOP }}
          >
            <MiniMap
              pins={view.pins}
              grouped={view.grouped}
              label={view.name.label}
              height={MAP_HEIGHT}
              activeId={activePole}
              onPinPress={scrollToPole}
            />
          </div>

          {/* The screen's own freshness line, above the list and below the map — the position Route detail
              and Nearby use, and the one that reads as being about the times rather than about the place.
              It answers a different question from a kerb's own `incomplete` marker: that one says an
              upstream board refused us, this says we have stopped being fed at all (ADR-133). */}
          <FeedNotice notice={notice} />

          {view.grouped ? (
            view.groups.map((group, groupIndex) => (
              <section
                key={group.poleId}
                ref={(el) => {
                  registerSection(group.poleId, el)
                  // Only the bottom-most group is measured — it is the only one whose height decides how
                  // much tail room the page needs.
                  const stopMeasuring =
                    groupIndex === view.groups.length - 1 ? measureTail(el) : undefined
                  /**
                   * **One cleanup, returned unconditionally — and that is a bug fix.**
                   *
                   * React 19 calls a ref callback's returned cleanup *instead of* calling the callback back
                   * with `null`. This used to `return measureTail(el)` and nothing else, so for the
                   * bottom-most kerb — the only one that gets a `ResizeObserver`, and only where the browser
                   * has one, which is every browser and not jsdom —
                   * `registerSection(group.poleId, null)` never ran. That kerb stayed in the scroll-spy's
                   * registry after its `<section>` left the document, holding the detached node and its rows
                   * alive, and the spy went on measuring it: a detached node reports a **zero** rect, which
                   * clears the spy's line at every offset past the first heading, so it won the "last heading
                   * to clear the line" comparison and the active kerb became one that is not on this place.
                   * `MiniMap` dims every pin as soon as it has an `activeId` and emphasises the one holding
                   * it — so the map dimmed whole and lit nothing.
                   *
                   * The registration and the observer live and die together now, which is the only shape that
                   * cannot go half-done: `test/place-detail-sections.test.tsx` drives a real place → place
                   * navigation and asserts both halves.
                   */
                  return () => {
                    registerSection(group.poleId, null)
                    stopMeasuring?.()
                  }
                }}
                style={{ scrollMarginTop: SECTION_SNAP }}
              >
                <div className="mx-4 border-border border-t" />
                {/* Tapping the heading brings its section up and lights its dot — the list-side twin of
                    tapping the dot. Not navigation, which is why the spec's `goes` names a position. */}
                <button
                  type="button"
                  onClick={() => scrollToPole(group.poleId)}
                  className="flex w-full items-end justify-between gap-3 border-0 bg-transparent px-4 pb-1 pt-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
                >
                  <span className="min-w-0 shrink">
                    {/* The heading, its published code and — only where two kerbs would otherwise read the
                        same — its compass side, composed by the kernel because the `·` between them IS the
                        composition (ADR-080). */}
                    <span className="block text-label text-subtle">{group.heading}</span>
                    {/* The kerb's own name, where that is what tells it from its sibling (ADR-080 tier 2). */}
                    {group.distinctName !== undefined ? (
                      <span className="block text-label text-muted">{group.distinctName}</span>
                    ) : null}
                    {/* …and where nothing can, the app says so rather than leaving a rider to work out that
                        two identical headings are two different kerbs (tier 3). */}
                    {group.crowded ? (
                      <span className="block text-label text-muted">
                        {t(locale, 'poleTooCloseToTell')}
                      </span>
                    ) : null}
                  </span>
                  {group.walk !== undefined ? (
                    <span className="shrink-0 text-caption text-subtle">{group.walk}</span>
                  ) : null}
                </button>
                {group.rows.map((row) => (
                  <PlaceRow key={row.routeId} row={row} onPress={openRoute} />
                ))}
              </section>
            ))
          ) : (
            <>
              <p className="m-0 mb-1 px-4 text-label text-subtle">{t(locale, 'routesAtStop')}</p>
              {view.rows.map((row) => (
                <PlaceRow key={row.routeId} row={row} onPress={openRoute} />
              ))}
            </>
          )}
        </>
      ) : query.isError ? (
        <p className="m-0 px-4 text-body text-danger">{(query.error as Error).message}</p>
      ) : (
        <div className="flex flex-col gap-3 px-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-sm bg-surface-2" />
          ))}
        </div>
      )}
    </main>
  )
}

/**
 * Where the map docks, how tall its card is, and where a scrolled-to heading lands — **the numbers the
 * scroll-spy and the tap snap point have to agree on**.
 *
 * The map docks *below* the collapsed header band rather than under it, which is `apps/mobile`'s
 * `mapTop = collapsedHeaderH(insets.top) + MAP_GAP`. It used to dock at a flat 56, four pixels inside a
 * 60 px band — and since the card and the header were both `z-10` with the card later in the document, the
 * card painted **over** the header and hid its collapsed label entirely. The gap is the fix; the stacking
 * order is fixed too, so fixed chrome outranks sticky content whatever the numbers are.
 *
 * The safe-area inset is part of the header's height, so it is part of both of these, and only `env()`
 * knows it — hence CSS strings rather than a number.
 */
const MAP_HEIGHT = 150
/** The card's hairline, top and bottom. A DOM card's `height` excludes its border where an RN one's does
 *  not, which is the same class of difference ADR-093 draws between a 52 px rail and a 44 px gutter. */
const MAP_BORDER = 1
/** `mb-2` under the card, and the gap above it. */
const MAP_GAP = 8
const MAP_TOP = `calc(${CONTENT_INSET_TOP} + ${COLLAPSED_HEIGHT + MAP_GAP}px)`
/**
 * The docked card's own bottom edge, below the inset — the thing the spy *measures* at run time, written
 * down here because a suite has to put the card somewhere and jsdom lays nothing out. Exported for that,
 * and for nothing else: at run time this number is read off the element, never recomputed.
 */
export const CARD_DOCKED_BOTTOM = COLLAPSED_HEIGHT + MAP_GAP + MAP_HEIGHT + 2 * MAP_BORDER
/** How far below the inset a heading sits once scrolled to: clear of the card, its hairlines and the gap.
 *  `card.bottom + MAP_GAP`, which is the spy's line — one expression, so the two cannot drift. */
export const SNAP_BASE = CARD_DOCKED_BOTTOM + MAP_GAP
const SECTION_SNAP = `calc(${CONTENT_INSET_TOP} + ${SNAP_BASE}px)`
/**
 * A pixel of slack on the spy's comparison. A snapped section lands *on* the line, and a
 * `getBoundingClientRect().top` at a fractional device pixel ratio can settle a shade below it — without
 * this the dot would light or not depending on the zoom level.
 */
const SPY_TOLERANCE = 1
/** Tail room for a place with one kerb, where nothing has to scroll anywhere. `apps/mobile`'s 32. */
const TAIL_FLAT = 32
/** …and the floor for a grouped one, so the padding is never negative. `apps/mobile`'s 24. */
const TAIL_MIN = 24

/**
 * How much room to leave under the last kerb group: `max(24px, 100dvh − SECTION_SNAP − lastGroupHeight)`,
 * exactly `apps/mobile`'s `Math.max(24, windowH - listTop - lastGroupH)`.
 *
 * **In CSS rather than JavaScript, and that is a real difference rather than a dodge.** `100dvh` tracks a
 * mobile browser's URL bar showing and hiding; `window.innerHeight` read at render time does not, and would
 * need a resize listener to keep up with something the platform already publishes.
 *
 * **Exported because it is the only way to test it.** jsdom's CSSOM rejects a `max()` wrapping a nested
 * `calc(env(…))` outright — it keeps the previously-set value and reports *that* — so a suite reading
 * `main.style.paddingBottom` sees the flat tail on a grouped place and would pass a screen with no tail
 * room at all. The expression is what matters; a function is where it can be read.
 */
export function tailRoom(grouped: boolean, lastGroupHeight: number): string {
  if (!grouped) return `${TAIL_FLAT}px`
  return `max(${TAIL_MIN}px, calc(100dvh - ${SECTION_SNAP} - ${lastGroupHeight}px))`
}
