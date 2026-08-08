import { type PlaceRouteRow, placeDetailView } from '@nextbus/core'
import { operatorName, poleSideLabel, t } from '@nextbus/i18n'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { BearingArrow } from '../components/BearingArrow'
import { MiniMap } from '../components/MiniMap'
import { PlaceRow } from '../components/PlaceRow'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { useLiveEtas } from '../hooks/useLiveEtas'
import { useLocation } from '../hooks/useLocation'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'
import { CollapsingHeader } from '../shell/CollapsingHeader'

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

  const openRoute = (row: PlaceRouteRow) =>
    navigate(`/route/${encodeURIComponent(row.routeId)}?stop=${encodeURIComponent(row.stopId)}`)

  // Scroll-spy: which kerb section is at the top of the list, so its map dot can be emphasised — and the
  // list-side twin, tapping a heading (or a dot) to bring that section up. Both are *geometry*, which is why
  // this is the one part of the file `check-no-derivation` has to be told about by name.
  const sections = useRef(new Map<string, HTMLElement>())
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
      const line = STICKY_TOP + MAP_HEIGHT
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
    // the rider's reduced-motion setting without this screen owning either decision.
    sections.current.get(poleId)?.scrollIntoView({ block: 'start' })
  }

  return (
    <main className="min-h-dvh bg-bg">
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
            className="sticky z-10 mx-4 mb-2 overflow-hidden rounded-2xl border border-border bg-surface-2 shadow-lg"
            style={{ top: STICKY_TOP }}
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

          {view.grouped ? (
            view.groups.map((group) => (
              <section
                key={group.poleId}
                ref={(el) => registerSection(group.poleId, el)}
                className="scroll-mt-[214px]"
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

/** How far below the viewport top the map docks, and how tall it is. Both are layout, and both are the
 *  scroll-spy's line: a section counts as "at the top of the list" once its heading clears the map card. */
const STICKY_TOP = 56
const MAP_HEIGHT = 150
