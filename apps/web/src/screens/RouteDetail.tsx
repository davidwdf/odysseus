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
import { ClockFading, CreditCard, type LucideIcon, MapPin, Repeat, Star } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { DirectionSwapIcon } from '../components/DirectionSwapIcon'
import { JourneyLines } from '../components/JourneyLines'
import { RailBusToken } from '../components/RailBusToken'
import { RouteChip } from '../components/RouteChip'
import { RouteFactSheet } from '../components/RouteFactSheet'
import { RouteStopRow } from '../components/RouteStopRow'
import { RouteStopSheet } from '../components/RouteStopSheet'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { useRailFlip } from '../hooks/useRailFlip'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'
import { CollapsingHeader } from '../shell/CollapsingHeader'

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
 * ## Where this differs from the RN screen — a much shorter list since ADR-100
 *
 * Three of the four entries that used to sit here were **not** idiom, and the owner's review said so: the
 * header that stayed put where the RN one collapses, the bus tokens that held still where the RN ones bob,
 * and the arrival figures that cut where the RN ones roll. Signature motion is identity; only
 * platform-conventional detail is idiom. All three are ported and what is left is this:
 *
 *  · **The direction toggle is a link.** Flipping navigates to the reverse route's own URL, because a URL
 *    that names a direction is a URL a rider can share — where the RN screen holds the flip locally so Back
 *    exits the screen rather than the flip. The *motion* is no longer part of the difference: react-router
 *    keeps this component mounted across the change of `:id`, so the header runs the same lyrics-style name
 *    swap and the rows the same cascade (see `swapNonce` below).
 *  · **The auto-scroll is `scrollIntoView` plus `scroll-margin-top`.** No measured offset, no reveal gate, and
 *    the browser honours reduced motion for free. `docs/07` records that the RN equivalent does not land on
 *    web at all, which is the sharpest illustration in the repo of why *how* a screen scrolls is idiom.
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

  /**
   * The direction flip's motion, and the one piece of state this screen keeps that the RN screen also keeps.
   *
   * **The toggle stays a link.** The reverse direction has its own URL and that is this renderer's honest
   * difference (ADR-093 decision 6) — a rider can share or bookmark a direction, where the RN screen holds
   * the flip locally so Back exits the screen rather than the flip. What ADR-100 changes is that the URL
   * change no longer has to mean *no motion*: react-router keeps this component mounted across a change of
   * `:id`, so the header can run the same 380 ms name swap and the rows the same 26 ms cascade the RN screen
   * runs — driven, as there, by a nonce the tap bumps.
   *
   * `armFlip` runs before the navigation and ignores the clicks react-router itself ignores: a ⌘-click opens
   * a tab and leaves this one where it was, so animating a swap that never happened would be a lie.
   */
  const [swapNonce, setSwapNonce] = useState(0)
  const flipping = useRef(false)
  const lastId = useRef(id)
  const armFlip = useCallback((event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return
    flipping.current = true
    setSwapNonce((previous) => previous + 1)
  }, [])
  // Arriving at a *different* route is not a flip: it gets the screen's own reveal, not the cascade. Adjusted
  // during render rather than in an effect, which is React's documented shape for this — an effect runs after
  // paint, so every row of the new route would cascade for one frame first.
  if (id !== lastId.current) {
    lastId.current = id
    if (flipping.current) flipping.current = false
    else if (swapNonce !== 0) setSwapNonce(0)
  }

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
   * The row elements, so the reveal below can scroll to the boarding one. **That is all this screen keeps
   * now, and it is not a measurement** — it hands the element to `scrollIntoView`.
   *
   * Until ADR-110 there was a second registry here: every row's `top`, taken with `getBoundingClientRect`
   * and kept fresh by a `ResizeObserver`, so an absolutely positioned overlay could put a bus at a node. It
   * is gone, along with the observer, the layout effect, the equality guard and two constants. Where a bus
   * sits is now two constant CSS expressions on a token that lives *inside* its own row (see
   * `RailBusToken`), which cannot go stale for the reason a measurement always can: there is nothing left to
   * refresh. That registry put a bus in the wrong place twice, once for a whole wave (ADR-108).
   */
  const rows = useRef(new Map<number, HTMLElement>())
  const registerRow = useCallback((index: number, el: HTMLElement | null) => {
    if (el === null) rows.current.delete(index)
    else rows.current.set(index, el)
  }, [])
  const list = useRef<HTMLDivElement | null>(null)
  const stopCount = view?.stops.length ?? 0

  /**
   * What a re-parent costs, bought back: a token that moves between rows is a **new element**, and no CSS
   * transition survives that, so the travel is `element.animate()` over a measured delta (`useRailFlip`).
   *
   * The reset is keyed on **the payload's** route, not on the URL's — and that distinction is a defect
   * caught in a browser rather than a nicety. `placeholderData: keepPreviousData` holds the current
   * direction on screen while the reverse loads (ADR-046), so a flip changes `:id` in one commit and the
   * buses one or more commits later. Keyed on `id`, the reset fires against the *old* direction's tokens
   * and has nothing to forget; the commit that actually swaps them then reads a stale record and slides
   * the k-th outbound bus into the k-th inbound one's place — a journey that never happened. Keyed on the
   * payload, the reset lands on exactly the commit the buses change in. Measured: one token animated
   * across a 1A flip before, none after.
   */
  useRailFlip(list, query.data?.route.id)

  /**
   * Which row draws which bus — a bus **at** node N belongs to row N, and a bus on the segment *into* node N
   * belongs to row **N−1**, whose bottom half it rides.
   *
   * A grouping rather than a lookup, because both can land on one row: the origin bus is held on node 0
   * until it is nearly leaving (`ORIGIN_BUS_DEPARTS_WITHIN_SEC`), so a rail can carry a bus on node 0 and
   * another approaching node 1 at the same time. The order within a row is `view.buses`' own, which is what
   * keeps the sequence both conformance suites read — the tokens in document order — byte-identical to the
   * overlay's.
   */
  const busesByRow = new Map<number, ReactNode[]>()
  view?.buses.forEach((bus, ordinal) => {
    const owner = bus.kind === 'node' ? bus.index : bus.from
    // Ordinal identity is intentional and unchanged — buses keep order, so the k-th token travels to its new
    // position (ADR-030). It is carried explicitly now rather than left implicit in a map's index, because a
    // row renders only its own and `useRailFlip` matches a moved token to its old place by it.
    // biome-ignore lint/suspicious/noArrayIndexKey: ordinal identity is the point — see above and ADR-030
    const token = <RailBusToken key={ordinal} ordinal={ordinal} bus={bus} />
    const carried = busesByRow.get(owner)
    if (carried === undefined) busesByRow.set(owner, [token])
    else carried.push(token)
  })

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
      {/* The collapsing header (ADR-033, ADR-100) — the same component Place detail uses, so the two
          screens feel like one family. The badge is the `RouteChip`: centred and 1.45× at rest, travelling
          to the left of a glass bar as the rider scrolls. `header.label` is the whole journey on one line,
          which is what the RN header shows at its expanded size and what this used to put only in the tab
          title. */}
      {view ? (
        <CollapsingHeader
          expandedHeight={168}
          labelExpandedTop={96}
          labelExpandedSize={20}
          labelCollapsedSize={15}
          badge={<RouteChip operator={view.header.operator} routeNo={view.header.routeNo} />}
          label={
            /* The from/to card, as on native: origin small and muted above, destination larger below —
               two nodes, which is what `route-detail.spec.json` declares and what a single composed
               `header.label` would have collapsed into one. `JourneyLines` also owns the flip's
               lyrics-style swap, which is why the nonce goes in here rather than to the header. */
            <JourneyLines
              origin={view.header.origin}
              destination={view.header.destination}
              circular={view.header.circular}
              nonce={swapNonce}
            />
          }
          collapsedLabel={<span className="truncate">{view.header.collapsedLabel}</span>}
          trailing={
            /* A link rather than a button: the reverse direction has its own URL, so a rider can share or
               bookmark it and Back returns to this direction. Absent when there is nothing to flip to —
               `reverseId`'s presence *is* the answer (ADR-093 decision 6). */
            view.header.reverseId !== undefined ? (
              <Link
                to={`/route/${encodeURIComponent(view.header.reverseId)}`}
                onClick={armFlip}
                aria-label={t(locale, 'reverseDirection')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text no-underline active:opacity-70"
              >
                <DirectionSwapIcon nonce={swapNonce} />
              </Link>
            ) : null
          }
        />
      ) : null}

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

          {/* The rail. `relative` is what makes it the coordinate space every token's `offsetTop` is read
              against — the only thing left on this element now the overlay is gone. */}
          <div ref={list} className="relative mt-2">
            {view.stops.map((row, index) => (
              <RouteStopRow
                key={`${row.seq}-${row.stopId}`}
                row={row}
                index={index}
                animateIn={swapNonce > 0}
                tokens={busesByRow.get(index)}
                onPress={setSheetRow}
                registerRow={registerRow}
              />
            ))}
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
