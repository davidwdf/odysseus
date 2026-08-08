import {
  type RouteDetailView,
  type RouteFactKey,
  type RouteStopRowView,
  routeDetailView,
  routeFactSheet,
  type ServiceDayType,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ClockFading,
  CreditCard,
  type LucideIcon,
  MapPin,
  Repeat,
  RotateCw,
  Star,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { RailBusToken } from '../components/RailBusToken'
import { RouteChip } from '../components/RouteChip'
import { RouteFactSheet } from '../components/RouteFactSheet'
import { RouteStopRow } from '../components/RouteStopRow'
import { RouteStopSheet } from '../components/RouteStopSheet'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'

/**
 * Route detail, rendered by React DOM from the identical kernel function the React Native screen uses
 * (WP6-6b). Put this file beside `apps/mobile/app/route/[id].tsx` and the difference is elements, classes and
 * motion: `routeDetailView` produces both journey labels, the facts strip and its holiday note, every row's
 * name/code/fare/readouts, which rows are the rider's saved ones, the boarding anchor, and **which node each
 * bus is at** — once, for both.
 *
 * `packages/contract/ui/route-detail.spec.json` declares what it must show in each of nineteen states, and
 * `test/route-detail-states.test.tsx` drives every projected one — as does
 * `apps/mobile/test/route-detail-states.test.tsx`, from the same file and the same corpus fixtures.
 *
 * ## Four places this deliberately differs from the RN screen, all of them declared `idiom`
 *
 *  · **The header is in the document flow, first, and does not collapse.** The RN one floats a collapsing card
 *    over the scroll content, cross-fading a full journey line into a one-line pill, and therefore renders
 *    last. Both put the route at the top of the screen; only this one puts it first for a keyboard and a
 *    screen reader. `header.collapsedLabel` has no consumer here and `header.label` becomes the tab title,
 *    which is the one place a web rider reads a whole journey on one line.
 *  · **The direction toggle is a link, not a state swap.** Flipping navigates to the reverse route's own URL,
 *    because a URL that names a direction is a URL a rider can share — where the RN screen holds the flip
 *    locally so Back exits the screen rather than the flip.
 *  · **The auto-scroll is `scrollIntoView` plus `scroll-margin-top`.** No measured offset, no reveal gate, and
 *    the browser honours reduced motion for free. `docs/07` records that the RN equivalent does not land on
 *    web at all, which is the sharpest illustration in the repo of why *how* a screen scrolls is idiom.
 *  · **No idle motion on the bus tokens.** They transition when they move, because a bus that moved is a bus
 *    that moved; they do not bob, because a page a rider is reading should hold still.
 */
export function RouteDetail() {
  const { id } = useParams<{ id: string }>()
  const [search] = useSearchParams()
  // The stop the rider arrived from (place → route), if any — its row is emphasised and scrolled to.
  const arrivedFromStop = search.get('stop') ?? undefined
  const locale = useLocale()
  const navigate = useNavigate()
  const { policy } = useClientPolicy()
  const favouriteRoutes = usePreferences((s) => s.favoriteRoutes)

  const query = useQuery({
    queryKey: ['route', id],
    enabled: !!id,
    queryFn: () => dataSource.getRoute(id as string),
    // The served cadence (ADR-053), matched to the edge's coalescing TTL. Unlike Place detail this screen has
    // no subscription — `/v1/live` carries per-pole targets and a route is 34 of them — so the refetch is
    // both the fetch and the clock, exactly as the RN screen's is.
    refetchInterval: policy.refreshAfterMs,
    // Holds the current direction on screen while a flip's payload loads, so a not-yet-cached reverse never
    // flashes the skeleton (ADR-046).
    placeholderData: keepPreviousData,
  })

  /**
   * The whole screen's content, in one call. Nothing below this line decides anything.
   *
   * The **words** it composes with are handed in and never imported by the kernel (ADR-054), and they are the
   * identical five the RN screen passes. `flipped` is false here and always will be: this renderer navigates
   * to the reverse direction rather than swapping it in, so there is no state in which the rider has flipped
   * *and* the arrived-from stop belongs to the other bound — the URL carries whichever pair is true.
   */
  const view: RouteDetailView | undefined = query.data
    ? routeDetailView(query.data, {
        locale,
        now: Date.now(),
        policy,
        savedRouteKeys: favouriteRoutes,
        ...(arrivedFromStop === undefined ? {} : { arrivedFromStop }),
        labels: {
          stopCount: (n) => t(locale, 'stopCount', { n }),
          holiday: t(locale, 'holiday'),
          circularVia: (place) => t(locale, 'circularVia', { place }),
          busApproaching: (stop) => t(locale, 'busApproaching', { stop }),
          busAtStop: (stop) => t(locale, 'busAtStop', { stop }),
        },
      })
    : undefined

  // The tab title is where a web rider reads the whole journey on one line — the resting label the RN
  // collapsing header shows at its expanded size. Restored on unmount so a route's title does not outlive it.
  const journey = view?.header.label
  useEffect(() => {
    if (journey === undefined) return
    const previous = document.title
    document.title = journey
    return () => {
      document.title = previous
    }
  }, [journey])

  /**
   * Where each row sits, so the rail overlay can put a bus at a node — **geometry, and the one measurement
   * this screen makes.**
   *
   * A token is absolutely positioned over the list because a bus rides the rail *between* rows as often as on
   * one, which no flow layout expresses. Which node it is at is the kernel's (`RailBus`); turning that into a
   * `top` is this renderer's, and a 44 px DOM gutter and a 52 px RN rail arrive at different numbers from the
   * same answer — which is the whole point of the model carrying an index rather than a pixel (ADR-093).
   */
  const rows = useRef(new Map<number, HTMLElement>())
  const [tops, setTops] = useState<Map<number, number>>(new Map())
  const registerRow = useCallback((index: number, el: HTMLElement | null) => {
    if (el) rows.current.set(index, el)
    else rows.current.delete(index)
  }, [])
  const list = useRef<HTMLDivElement | null>(null)
  // Measure each row's top relative to the list, and publish only on an actual change — the equality skip is
  // what lets the observer below drive this without a render loop, the same guard the RN screen's `setTop`
  // makes at [id].tsx.
  const measure = useCallback(() => {
    const container = list.current
    if (container === null) return
    const base = container.getBoundingClientRect().top
    setTops((prev) => {
      const next = new Map<number, number>()
      for (const [index, el] of rows.current) {
        next.set(index, el.getBoundingClientRect().top - base)
      }
      let changed = prev.size !== next.size
      for (const [index, top] of next) if (prev.get(index) !== top) changed = true
      return changed ? next : prev
    })
  }, [])
  // The synchronous first measure, and a re-measure whenever the row set changes — a flip, a new route, or
  // the first payload. A layout effect rather than an effect: measuring after paint would draw every token at
  // the top of the list for one frame.
  const stopCount = view?.stops.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: `measure` is stable; `stopCount` is the row-set change that needs a synchronous re-measure
  useLayoutEffect(() => {
    measure()
  }, [stopCount])
  // Later height changes that do NOT change the stop count re-measure through a `ResizeObserver` on the list.
  // A stop gaining or losing its arrivals line on a refetch (RouteStopRow renders that block only when it has
  // one) grows its row and shifts every node below it, so without this the tokens drift off their nodes until
  // the next flip or navigation — a live divergence from the RN screen, whose rows re-measure on `onLayout`.
  // The layout-effect-plus-observer shape is `MiniMap`'s; `ResizeObserver` is absent in jsdom (the guard),
  // where the conformance suite measures nothing anyway.
  useEffect(() => {
    const container = list.current
    if (container === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(container)
    return () => observer.disconnect()
  }, [measure])

  // The reveal's one beat: bring the boarding row up, once, as soon as it exists. `scrollIntoView` rather than
  // a computed offset, so the browser honours `scroll-behavior` and the rider's reduced-motion setting.
  const scrolled = useRef(false)
  const hereIndex = view?.hereIndex ?? -1
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above — `stopCount` is when the row exists to scroll to
  useEffect(() => {
    if (scrolled.current || hereIndex < 0) return
    const row = rows.current.get(hereIndex)
    if (row === undefined) return
    scrolled.current = true
    row.scrollIntoView({ block: 'start' })
  }, [hereIndex, stopCount])

  const openStop = (row: RouteStopRowView) =>
    navigate(`/stop/${encodeURIComponent(row.stopId)}?pole=${encodeURIComponent(row.stopId)}`)

  /**
   * Which stop's action sheet is open, if any.
   *
   * **A tap on a row opens this rather than navigating**, which is what `route-detail.spec.json` has
   * declared non-optionally since WP6-6b and what this renderer did not do until WP6-7b's parity audit found
   * it. The reason is in the spec's own note: the row's primary purpose is saving the route *at that pole*
   * (ADR-042), and a tap that navigated away made the common action the harder one — in fact impossible,
   * because ADR-032 makes this sheet the app's only favourite-creating affordance, so this app could not
   * create a favourite at all.
   */
  const [sheetRow, setSheetRow] = useState<RouteStopRowView | null>(null)

  // Which fact sheet is open, if any (ADR-044). Held here rather than per pill so only one can be.
  const [factSheet, setFactSheet] = useState<RouteFactKey | null>(null)

  return (
    <main className="min-h-dvh bg-bg pb-10">
      {/* The chrome, in flow and first — see the note above. The back control does not wait for the payload,
          deliberately, so a rider can leave a screen that is still loading. */}
      <BackButton />
      <header className="pushed-header sticky top-0 z-10 border-border border-b bg-bg/95 px-4 pb-3 backdrop-blur">
        {view ? (
          <div className="flex items-center gap-3">
            <RouteChip operator={view.header.operator} routeNo={view.header.routeNo} />
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-label text-muted">{view.header.origin}</p>
              <p className="m-0 flex items-center gap-1.5 truncate text-body font-semibold text-text">
                {/* A loop glyph for a circular service, a direction-of-travel arrow otherwise — the same
                    concepts the RN header draws, from the web icon set (ADR-075: the concept is shared, the
                    set is idiom). Decorative: the sentence beside it already says which it is. */}
                {view.header.circular ? (
                  <RotateCw size={14} className="shrink-0 text-subtle" aria-hidden />
                ) : (
                  <ArrowDown size={14} className="shrink-0 text-subtle" aria-hidden />
                )}
                <span className="truncate">{view.header.destination}</span>
              </p>
            </div>
            {/* A link rather than a button: the reverse direction has its own URL, so a rider can share or
                bookmark it and Back returns to this direction. Absent when there is nothing to flip to —
                `reverseId`'s presence *is* the answer (ADR-093 decision 6). */}
            {view.header.reverseId !== undefined ? (
              <Link
                to={`/route/${encodeURIComponent(view.header.reverseId)}`}
                aria-label={t(locale, 'reverseDirection')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text no-underline active:opacity-70"
              >
                <Repeat size={16} aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}
      </header>

      {view ? (
        <>
          {/* The static-facts strip (ADR-036, the Static tier). Each pill opens its detail sheet (ADR-044) —
              a `<button>` since WP6-6c, where it was an inert `<span>`. The spec declares that interaction
              `optional`, which is what made the inert version honest rather than hidden: the walker requires
              the *text* to be identical whether or not the affordance exists (ADR-069's overflow rule). */}
          {view.facts.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
              {view.facts.map((fact) => (
                <button
                  key={fact.key}
                  type="button"
                  onClick={() => setFactSheet(fact.key)}
                  className="flex items-center gap-1.5 rounded-full border-0 bg-surface px-3 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
                >
                  <FactGlyph fact={fact.key} />
                  <span className="text-caption font-medium text-muted tabular-nums">
                    {fact.value}
                  </span>
                  {fact.note ? (
                    <>
                      {/* Its own node, and the order is what the projection pins: React emits an expression
                          and an adjacent literal as separate text nodes (ADR-092), which is what the RN strip
                          already produces. */}
                      <span className="text-caption text-subtle">·</span>
                      <span className="text-caption text-subtle tabular-nums">{fact.note}</span>
                    </>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <div ref={list} className="relative mt-2">
            {view.stops.map((row, index) => (
              <RouteStopRow
                key={`${row.seq}-${row.stopId}`}
                row={row}
                index={index}
                onPress={setSheetRow}
                registerRow={registerRow}
              />
            ))}
            {/* The buses, over the rail. A token whose row has not reported its offset yet draws nothing
                rather than at zero — the first paint of a fresh route, and one frame long. */}
            {view.buses.map((bus, i) => {
              const to = bus.kind === 'node' ? bus.index : bus.to
              const near = tops.get(to)
              const behind = bus.kind === 'node' ? near : tops.get(bus.from)
              if (near === undefined || behind === undefined) return null
              const top =
                bus.kind === 'node' ? near + NODE_CENTRE : (near + behind) / 2 + NODE_CENTRE
              // biome-ignore lint/suspicious/noArrayIndexKey: ordinal identity is intentional — buses keep order, so the k-th token transitions to its new position (ADR-030)
              return <RailBusToken key={i} bus={bus} top={top - TOKEN_HALF} />
            })}
          </div>

          {/* The sheet a pill opens — one call, the same one the RN screen makes, handed the **view** rather
              than the payload so its fare timeline cannot name a stop differently from the schematic. */}
          {factSheet !== null ? (
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

          {/* The sheet a stop row opens: save this route at this pole, or go to the place. The route
              context it prints is the header's own view, so the sheet cannot name the journey differently
              from the screen behind it. */}
          {sheetRow !== null && query.data ? (
            <RouteStopSheet
              row={sheetRow}
              // **The payload's route id, never the URL parameter.** `routeDetailView` keys each row's
              // `saved` on `formatFavoriteRouteKey(pole, route.id)`, so a toggle written under any other
              // spelling would produce a key the star was not computed from — the favourite would be stored
              // and then read back as unsaved, silently. The URL param is the same string today; it is
              // percent-decoded by the router and has no such guarantee tomorrow.
              routeId={query.data.route.id}
              routeNo={view.header.routeNo}
              locale={locale}
              destination={view.header.destination}
              onClose={() => setSheetRow(null)}
              onViewStop={() => {
                setSheetRow(null)
                openStop(sheetRow)
              }}
            />
          ) : null}
        </>
      ) : query.isError ? (
        <p className="m-0 px-4 pt-4 text-body text-danger">{(query.error as Error).message}</p>
      ) : (
        // The fallback arm, and that ordering is a bug fix: `isLoading` is `isPending && isFetching`, so a
        // paused retry matches neither the loading nor the error arm and a trailing `null` renders nothing at
        // all, for ever (ADR-088, and `docs/07`'s undiagnosed row).
        <div className="flex flex-col gap-3 px-4 pt-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-sm bg-surface-2" />
          ))}
        </div>
      )}
    </main>
  )
}

/**
 * Which glyph denotes each static fact.
 *
 * ADR-075's table puts *"which concept each glyph denotes"* on the identity side and *"the set (Lucide /
 * SF Symbols / Material Symbols)"* on the idiom side, so a per-renderer table of the same four concepts is
 * the correct residue — and it is what is left of `RouteMeta` once the pills themselves are the kernel's.
 */
const GLYPH: Record<RouteFactKey, LucideIcon> = {
  fare: CreditCard,
  freq: Repeat,
  hours: ClockFading,
  stops: MapPin,
}

function FactGlyph({ fact }: { fact: RouteFactKey }) {
  const Glyph = GLYPH[fact] ?? Star
  return <Glyph size={14} className="shrink-0 text-text" aria-hidden />
}

/**
 * The words the fact sheets' composed strings are built from — the day names an unnamed mask is joined out
 * of, and the passenger classes a concession legend keys.
 *
 * At the injection boundary because the kernel may not import `@nextbus/i18n` (ADR-054): it decides *which*
 * days a pattern runs and *what goes between them*; the catalogue owns the words. The RN screen passes the
 * identical four.
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

/** Where a node's centre falls inside a row, and half a token — both layout, both this renderer's. */
const NODE_CENTRE = 12 + 26 / 2
const TOKEN_HALF = 12
