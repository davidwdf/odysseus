import {
  applyLiveEtasToRouteDetail,
  displayName,
  type RouteDetail as RouteDetailPayload,
  type RouteDetailView,
  type RouteFactKey,
  type RouteStopRowView,
  routeDetailView,
  routeFactSheet,
  routeMarkers,
  routeStopBoard,
  type ServiceDayType,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ClockFading, CreditCard, type LucideIcon, MapPin, Repeat, Star } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { DirectionSwapIcon } from '../components/DirectionSwapIcon'
import { FeedNotice, feedNotice } from '../components/FeedNotice'
import { JourneyLines } from '../components/JourneyLines'
import { RailBusToken } from '../components/RailBusToken'
import { RouteFactSheet } from '../components/RouteFactSheet'
import { RouteMap } from '../components/RouteMap'
import { RouteStopRow } from '../components/RouteStopRow'
import { RouteStopSheet } from '../components/RouteStopSheet'
import { DraggableSheet } from '../components/sheet/DraggableSheet'
import { DEFAULT_DETENT, ROUTE_DETENTS, resolveDetent } from '../components/sheet/detents'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { useLiveRoute } from '../hooks/useLiveRoute'
import { useOnline } from '../hooks/useOnline'
import { useRailFlip } from '../hooks/useRailFlip'
import { useRiderPosition } from '../hooks/useRiderPosition'
import { useRoutePath } from '../hooks/useRoutePath'
import { usePreferences } from '../lib/preferences'
import { useStableValue } from '../lib/useStableValue'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'
import { RouteContextCard } from './route/RouteContextCard'

/**
 * Route detail, rendered by React DOM from the identical kernel function the React Native screen uses
 * (WP6-6b). Put this file beside `apps/mobile/app/route/[id].tsx` and the difference is elements, classes and
 * motion: `routeDetailView` produces both journey labels, the facts strip and its holiday note, every row's
 * name/code/fare/readouts, which rows are the rider's saved ones, the boarding anchor, and **which node each
 * bus is at** — once, for both.
 *
 * `packages/contract/ui/route-detail.spec.json` declares what it must show in each of twenty states, and
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
    // The served cadence (ADR-053), matched to the edge's coalescing TTL. It stays the fetch **and** the
    // clock even when a route watch is running (ADR-116/119): the live readings are merged at render rather
    // than written into this entry, so a refetch replaces only the static half — the stops, the fares, the
    // patterns — and cannot blank a time on screen. That is the whole reason `useLiveRoute` hands its
    // readings back instead of calling `setQueryData` the way its two siblings do.
    refetchInterval: policy.refreshAfterMs,
    // Holds the current direction on screen while a flip's payload loads, so a not-yet-cached reverse never
    // flashes the skeleton (ADR-046).
    placeholderData: keepPreviousData,
  })

  // The line, on its own clock — a day-cached body has no business sharing an entry with a
  // 30-second one, and the stop list is useful long before the geography arrives (ADR-152).
  const routePath = useRoutePath(id)
  /**
   * The stops as the map needs them — where each one is, and what it is called — in travel order.
   *
   * Taken from the **static** payload rather than the live-merged one: a stop's position and name are
   * not readings, and deriving them from `detail` would rebuild every marker each time an arrival
   * ticked. The name is **`displayName`'s** — the kernel function `routeDetailView` builds every row's
   * name with — rather than a second spelling of it, which is the mistake ADR-093 decision 11 records
   * this screen making once already. It is also what `routeMarkers` reads its `BBI` token out of, and
   * `titleCaseName` keeps that in capitals; nothing else states that coupling, so `route-markers.test.ts`
   * pins it.
   */
  const stopPoints = useStableValue(
    useMemo(
      () =>
        (query.data?.stops ?? []).map((s) => ({
          location: s.stop.location,
          name: displayName(s.stop.name[locale]).label,
        })),
      [query.data?.stops, locale],
    ),
  )

  /**
   * What each stop **is** — terminus, interchange, or ordinary — computed once here and handed to both
   * the map and the list.
   *
   * One call rather than two, and that is the point rather than a saving: a rider who sees a hexagon on
   * the map and scrolls down to find a circle in the list is looking at two claims about one stop. The
   * rule itself is corpus-pinned in `packages/core` (ADR-068), so what this guarantees is that the two
   * *renderings* on this screen read the same answer.
   */
  const markers = useMemo(() => routeMarkers(stopPoints), [stopPoints])

  /**
   * The rider's own position, for the map's mark (M5).
   *
   * **Deliberately not `useLocation`.** That one is the shared controller and snaps every coordinate
   * to a 25 m cell before it leaves the device, which is right for anything sent upstream and wrong
   * for drawing where someone is standing: a snapped dot teleports between grid cells while the map
   * scrolls smoothly under it. This one never leaves the device — see the hook's own note.
   */
  const rider = useRiderPosition()

  /**
   * The whole screen's content, in one call. Nothing below this line decides anything.
   *
   * The **words** it composes with are handed in and never imported by the kernel (ADR-054), and they are the
   * identical five the RN screen passes. `flipped` is false here and always will be: this renderer navigates
   * to the reverse direction rather than swapping it in, so there is no state in which the rider has flipped
   * *and* the arrived-from stop belongs to the other bound — the URL carries whichever pair is true.
   */
  /**
   * The live route watch (ADR-116/119), and the merge that puts its readings on the schematic.
   *
   * `wanted` is the wire's own statement that this route's embedded times are not a complete answer — which is
   * exactly the condition ADR-114 invented the field for. Read off the **cached** payload rather than off the
   * view, and that is what keeps it stable: the merge below clears the field (absence is what *answered*
   * means), so a request derived from the merged document would switch itself off on its first success.
   *
   * A KMB route never asks: its bulk feed answers, no subscription opens, and the only cost is one
   * `setInterval` for the clock — which this screen needed anyway.
   */
  const wantsLive = query.data?.liveArrivals !== undefined
  const online = useOnline()
  const { round, now } = useLiveRoute(query.data?.route.id, {
    wanted: wantsLive,
    refreshAfterMs: policy.refreshAfterMs,
  })

  /**
   * The payload the screen renders: whatever was fetched, with whatever the round has said since.
   *
   * Merged **at render** rather than into the query cache, and both halves of that matter: a refetch cannot
   * blank a live time (see the `refetchInterval` above), and the kernel decides every question about which
   * reading belongs to which row — this line joins two `@nextbus/core` calls and answers nothing itself.
   *
   * The round is merged only onto **its own** route: the hook clears it in an effect, and an effect runs
   * after paint, so on a direction flip or a Back navigation the id and the payload change one frame before
   * the clear. Comparing here costs nothing and removes the frame in which the previous route's readings
   * would be filtered out of this one — 41 blank rows — and its `failed` would mark kerbs on a route nobody
   * asked about.
   *
   * `round` is `null` until a frame has landed, and the merge is skipped for exactly that long. It has to be:
   * the reading list a merge is handed is the *complete current set*, so an empty one means "nothing is due
   * anywhere" — true of a live round that found nothing, and false of a screen that has not been told
   * anything yet. Merging `[]` on first paint blanked every time on every KMB route, which the conformance
   * suite caught before a rider could.
   */
  const detail: RouteDetailPayload | undefined =
    query.data && round?.routeId === query.data.route.id
      ? applyLiveEtasToRouteDetail(query.data, round.etas, round.failed)
      : query.data

  const view: RouteDetailView | undefined = detail
    ? routeDetailView(detail, {
        locale,
        now,
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

  /**
   * The screen's freshness notice (ADR-133) — the kernel joins the view's newest board to the network's
   * state. `trouble` is `unreachable` only for a failure that reached *us*: an `EdgeRequestError` means the
   * Worker answered and said no, and a bare rejection means the fetch never got there. Both are ours to
   * report; an **upstream** board refusing is not passed here at all, because the rows already say it.
   */
  const notice = feedNotice({
    lastUpdatedIso: view?.lastUpdatedIso ?? null,
    now,
    online,
    trouble: query.isError ? 'unreachable' : 'none',
    staleAfterMs: policy.staleAfterMs,
  })

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
  /**
   * The stop the rider is looking at on the map — set by tapping a marker, and the camera follows it
   * (`RouteMap`). `undefined` until they ask: a screen that opened with a stop pre-selected would be
   * answering a question nobody put.
   *
   * ⚠️ **Row taps do not set this yet.** §8d makes a row tap the primary way to focus a stop and moves
   * the action sheet onto a per-row `⋯`, but that is a *declared* interaction in
   * `route-detail.spec.json` (`stopName` → "a sheet offering to save this route…"), so it moves with
   * the spec and both drivers rather than ahead of them. Until then a marker is the only way in, which
   * is a smaller surface than §8d describes and not a different one.
   */
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>(undefined)
  /**
   * Whether the context card has stepped aside into its pill (round 4).
   *
   * Collapsed by **anything that means the rider has started reading** — dragging the sheet off its
   * opening detent, touching the map, or scrolling the stop list.
   *
   * Scrolling was excluded at first, because round 4 tried it and the card flickered: a list flick is
   * the most common gesture on this screen, and collapsing on *movement* means collapsing dozens of
   * times a minute. What makes it work is the owner's own rule — the card comes back when the list is
   * **all the way at the top**, not when the scrolling stops. That is a place rather than a moment, a
   * rider can return to it deliberately, and it cannot oscillate: the only way back to zero is to ask
   * for it.
   */
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  /**
   * True while a scroll this screen *caused* is still settling.
   *
   * The header re-opens when the stop list is back at the top, which is a deliberate place a rider
   * returns to — but `scrollIntoView` reaches the same place for a completely different reason, and a
   * rider tapping stop 1 to see it on the map got the card thrown back over the map instead. The flag
   * is the difference between "the list is at the top" and "the rider put it there".
   */
  const programmaticScroll = useRef(false)
  /**
   * How much of the map the sheet is covering, as a fraction — the camera's `padding`.
   *
   * Kept here rather than read from the DOM because it is the sheet's own declared detent, and a
   * measurement would be a second answer to a question that already has one (ADR-110's lesson, one
   * screen along).
   */
  const [sheetFraction, setSheetFraction] = useState(
    () => resolveDetent(ROUTE_DETENTS, DEFAULT_DETENT).fraction,
  )
  const focusStop = useCallback((index: number) => {
    setFocusedIndex(index)
    // The scroll below is OURS, and the header must not read it as the rider returning to the top.
    // Tapping the first stop lands the list at zero as a side effect, and without this the card
    // sprang open at the exact moment the rider was asking to look at the map instead.
    programmaticScroll.current = true
    // `nearest`, not `start`. The map sits **above** the list in one scrolling page, so scrolling a row
    // to the top would push the map — the thing the rider just tapped — off the screen to show them the
    // row it was already about. `nearest` does nothing when the row is visible and moves the minimum
    // when it is not. (The mockup had no such tension: it split the screen into a map pane and a list
    // pane that scrolled independently. This layout is a single column, and that is the trade.)
    rows.current.get(index)?.scrollIntoView({ block: 'nearest' })
  }, [])

  /**
   * A row tap. §8d: it **focuses the stop on the map and does nothing else** — the actions moved to the
   * `⋯` beside it. It keeps the `RouteStopRowView` argument even though only the index is used, because
   * the sheet still takes the row and the two handlers must not disagree about what a row is.
   */
  const onRowPress = useCallback(
    (_row: RouteStopRowView, index: number) => {
      focusStop(index)
    },
    [focusStop],
  )

  const list = useRef<HTMLDivElement | null>(null)
  const stopCount = view?.stops.length ?? 0

  /**
   * What a re-parent costs, bought back: a token that moves between rows is a **new element**, and no CSS
   * transition survives that, so the travel is `element.animate()` over a measured delta (`useRailFlip`) —
   * as are the pops a bus makes entering and leaving the rail (ADR-111).
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
  const ghosts = useRef<HTMLDivElement | null>(null)
  useRailFlip(list, ghosts, query.data?.route.id)

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
    const token = (
      <RailBusToken
        // biome-ignore lint/suspicious/noArrayIndexKey: ordinal identity is the point — see above and ADR-030
        key={ordinal}
        ordinal={ordinal}
        bus={bus}
        // Only a bus standing AT a node wears that node's shape. One on the segment between two stops
        // is at no stop, and giving it the shape of one it has not reached would be a claim the data
        // does not support — the same reason it sits at the midpoint rather than a fraction along.
        shape={bus.kind === 'node' ? (markers[bus.index]?.kind ?? 'stop') : 'stop'}
        vehicle={view.vehicle}
      />
    )
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

  /**
   * The tapped stop's own board, fetched **only when there is nothing to show** (ADR-115).
   *
   * On Citybus and GMB the route view carries no times at all — those operators publish no route-level
   * feed, which is what `liveArrivals: 'perStopOnly'` says (ADR-114) — but their *per-pole* boards answer
   * perfectly well. So a rider who taps one stop gets that stop's times, for the cost of one call about
   * the thing they just asked about, and no accordion: the sheet they already opened is where it goes.
   *
   * Three conditions, and each is doing work. **The row's own readings win**, so a KMB route costs no
   * extra call and the sheet cannot disagree with the list behind it. `liveArrivals !== 'answered'` is the
   * rest: a route whose round *did* answer and has nothing due must not trigger a fetch that would find
   * the same nothing — that would be a request per tap, for ever, to re-learn what the payload said.
   * And `sheetRow` gates it, so nothing is fetched until a rider asks.
   */
  const boardPole =
    sheetRow !== null && sheetRow.arrivals.length === 0 ? sheetRow.stopId : undefined
  const boardRoute = query.data?.route.id
  const wantsBoard =
    boardPole !== undefined &&
    boardRoute !== undefined &&
    // …**or this kerb in particular refused.** Once a live round answers, the merge clears `liveArrivals`
    // — the screen-level sentence is gone and this reads `'answered'` — but a round asks each pole
    // separately, so one kerb can still have refused and its row says so (ADR-120). The rider tapping
    // *that* row is the one who most wants an answer, and a retry is exactly what a retryable failure is
    // for. Without this clause the board is never fetched and the sheet's last arm prints "No scheduled
    // service" under a row that just said we could not ask.
    (view?.liveArrivals !== 'answered' || sheetRow?.incomplete === true)
  const board = useQuery({
    queryKey: ['etas', boardPole, boardRoute],
    enabled: wantsBoard,
    queryFn: () => dataSource.getEtas(boardPole as string, [boardRoute as string]),
    // The served cadence, as everywhere else — a sheet left open keeps up with the screen behind it.
    refetchInterval: policy.refreshAfterMs,
  })

  // Which fact sheet is open, if any (ADR-044). Held here rather than per pill so only one can be.
  const [factSheet, setFactSheet] = useState<RouteFactKey | null>(null)

  /**
   * The static-facts strip, hoisted out of the tree because it now lives **inside the context card**
   * (`proposals/06 §8`, round 4) — and a card that built its own facts would be a second place that
   * knows what a fact pill is. The card is handed the finished nodes and decides only whether there
   * is room for them.
   */
  const factsStrip =
    view !== undefined && view.facts.length > 0 ? (
      <div className="flex flex-wrap justify-center gap-2 px-4 pt-3 pb-1">
        {view.facts.map((fact) => (
          <button
            key={fact.key}
            type="button"
            onClick={() => setFactSheet(fact.key)}
            className="flex items-center gap-1.5 rounded-full border-0 bg-surface px-3 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
          >
            <FactGlyph fact={fact.key} />
            <span className="text-caption font-medium text-muted tabular-nums">{fact.value}</span>
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
    ) : null

  return (
    /**
     * **The map is the screen**, and everything else floats over it or sits in the sheet — round 3/4
     * of the mockups (`docs/proposals/06 §8`).
     *
     * `fixed inset-0` rather than a tall scrolling page: the map is a layer, not a block in flow, and
     * the only thing that scrolls is the list inside the sheet. That is what lets the sheet be dragged
     * to three heights without the document's own scroll fighting it, and it is why the sticky-map
     * workaround this replaces is gone — there is no page scroll left to be sticky against.
     */
    <main className="fixed inset-0 overflow-hidden bg-bg">
      {/* The chrome, in flow and first — see the note above. The back control does not wait for the payload,
          deliberately, so a rider can leave a screen that is still loading. */}
      <BackButton />
      {/* Round 4's context card, in place of the collapsing header (`proposals/06 §8`, ADR-156).
          `CollapsingHeader` is still Place detail's and is untouched — the two screens stop being one
          family here on purpose, because only this one has a map underneath to get out of the way of. */}
      {view ? (
        <RouteContextCard
          header={view.header}
          facts={factsStrip}
          collapsed={chromeCollapsed}
          expandLabel={t(locale, 'routeShowDetails')}
          collapseLabel={t(locale, 'routeHideDetails')}
          onCollapse={() => setChromeCollapsed(true)}
          onExpand={() => setChromeCollapsed(false)}
          journey={
            /* Origin small and muted above, destination larger below — two nodes, which is what
               `route-detail.spec.json` declares and what one composed label would have collapsed into
               one. `JourneyLines` also owns the flip's lyrics-style swap, which is why the nonce goes
               here rather than to the card. */
            <JourneyLines
              origin={view.header.origin}
              destination={view.header.destination}
              circular={view.header.circular}
              nonce={swapNonce}
            />
          }
          swap={
            /* A link rather than a button: the reverse direction has its own URL, so a rider can share
               or bookmark it and Back returns to this direction. Absent when there is nothing to flip
               to — `reverseId`'s presence *is* the answer (ADR-093 decision 6). */
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
          {/* **Live times are not the whole truth on this route, said once** (ADR-114).
              `liveArrivals` distinguishes three things `eta: null` on every row could not: the round
              answered and nothing is due, the round did not answer, and this operator publishes no
              route-level feed at all (Citybus, GMB). The last is permanent, and its honest upgrade is to
              point at the per-pole boards that *do* answer — a string of its own, and the owner's call.

              Above the schematic and never per row: a rider cannot act on *which* rows, and 34 copies of
              one sentence is not more honest than one. `text-muted`, not a warning colour — nothing is
              wrong with the route. */}
          {view.liveArrivals !== 'answered' ? (
            <p className="m-0 px-4 pt-2 pb-1 text-label text-muted">
              {t(locale, 'etasUnavailable')}
            </p>
          ) : null}

          {/* And the screen's own freshness line, which answers a different question: `etasUnavailable`
              above says *an upstream board refused us*, this says *we have stopped being fed at all*. Both
              can be true, and they are two sentences because a rider acts on them differently — one is
              nothing they can do, the other may be their network. ADR-133. */}
          <FeedNotice notice={notice} />

          {/*
            **The map is the base layer**, full bleed under everything else (round 3/4). Not a strip
            above a list any more: `RouteMap` fills the shell and the sheet sits over it.

            `padding` is what makes the camera honest about that. The sheet covers the bottom of the
            map, so a `fitBounds` that framed the whole viewport would centre the route *behind* the
            sheet — a rider looking at the visible half would see the top of their route and nothing
            else. Every camera move is inset by the sheet's own height, so "centred" means centred in
            the part they can actually see.
          */}
          <RouteMap
            path={routePath.data}
            pending={routePath.isPending}
            stops={stopPoints}
            focusedIndex={focusedIndex}
            boardingIndex={view.hereIndex >= 0 ? view.hereIndex : undefined}
            onSelectStop={focusStop}
            rider={rider}
            visibleInset={{ bottom: sheetFraction, top: CHROME_INSET_FRACTION }}
            onInteract={() => setChromeCollapsed(true)}
            controlLabels={{
              recentre: t(locale, 'mapShowWholeRoute'),
              locate: t(locale, 'mapShowMyLocation'),
            }}
            className="absolute inset-0"
          />

          {/*
            **The stop list, in a draggable sheet** — three detents, opening at `half` (round 2's
            shapes, the owner's default). The sheet owns the only scrolling on this screen now, which
            is what lets it be dragged without the document's own scroll fighting the gesture.

            The freshness notice and the live-times line ride *inside* it rather than over the map:
            both are sentences about the readings, and the readings are here.
          */}
          <DraggableSheet
            label={t(locale, 'routeStopsSheet')}
            initial={DEFAULT_DETENT}
            onContentScroll={(top) => {
              if (programmaticScroll.current) {
                // One event only: `scrollIntoView` is a single jump here, not a smooth animation.
                programmaticScroll.current = false
                return
              }
              setChromeCollapsed(top > 0)
            }}
            onDetentChange={(d) => {
              setSheetFraction(d.fraction)
              // Dragging off the opening detent is the rider saying they have started reading.
              if (d.name !== DEFAULT_DETENT) setChromeCollapsed(true)
            }}
          >
            {/* The rail. `relative` is what makes it the coordinate space every token's `offsetTop` is read
              against — the only thing left on this element now the overlay is gone. */}
            <div ref={list} className="relative mt-2">
              {view.stops.map((row, index) => (
                <RouteStopRow
                  key={`${row.seq}-${row.stopId}`}
                  row={row}
                  index={index}
                  animateIn={swapNonce > 0}
                  // Reserve the arrivals line while the round is still out. `round === null` is
                  // `useLiveRoute` saying "no round has landed", which is exactly the window in which every
                  // row is about to gain a line at once — see the skeleton's note in `RouteStopRow`.
                  arrivalsPending={wantsLive && round === null}
                  tokens={busesByRow.get(index)}
                  kind={markers[index]?.kind ?? 'stop'}
                  selected={index === focusedIndex}
                  onPress={onRowPress}
                  onMenu={setSheetRow}
                  registerRow={registerRow}
                />
              ))}
              {/* Where a departed bus is drawn out (ADR-111). Rendered **empty and never filled by React**,
                which is the whole point: `useRailFlip` appends a stripped clone of the token here for the
                220 ms of its exit, and React does not reconcile the children of an element it renders with
                none. `aria-hidden` because a bus that has left must not be announced — the clone loses its
                `role` and `aria-label` too, so the conformance walker cannot see it either. */}
              <div
                ref={ghosts}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden"
              />
            </div>
          </DraggableSheet>

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
              /* The readout the sheet shows: the row's own if it has any, else the board fetched for this
                 pole. `routeStopBoard` picks which of a report's readings belongs to *this* pole and
                 formats it exactly as the row would — a place with two kerbs on one route has two
                 readings, and on a schematic those are different rows. */
              {...(sheetRow.arrivals.length > 0
                ? { arrivals: sheetRow.arrivals, incomplete: false }
                : routeStopBoard(board.data, {
                    poleId: sheetRow.stopId,
                    routeId: query.data.route.id,
                    now: Date.now(),
                    locale,
                    policy,
                  }))}
              loading={wantsBoard && board.isFetching && board.data === undefined}
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
/**
 * How much of the map's height the floating chrome covers, as a fraction — the back lens and the
 * context card at its expanded size.
 *
 * A constant rather than a measurement, and that is the same call ADR-110 made about the rail: the
 * card's height is a layout decision this file already owns, so measuring it would be asking the DOM
 * for an answer we wrote. It only has to be close — it insets a camera, not a hit target.
 *
 * 0.14 is the expanded card against a phone viewport. The first attempt used 0.22, and combined with
 * the sheet's 0.55 that left barely a quarter of the height to frame a route in, so `fitBounds`
 * zoomed out until the whole route was a thumbnail. Padding is subtracted from the space available,
 * and over-stating it is not a safe direction to err in.
 */
const CHROME_INSET_FRACTION = 0.14

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
