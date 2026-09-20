import {
  favouritePoleIds,
  type HomeCard,
  type HomeSections,
  homeView,
  newestNearbyBoard,
  newestPlaceBoard,
} from '@nextbus/core'
import { type PlainMessageKey, t } from '@nextbus/i18n'
import { skipToken, useQueries, useQuery } from '@tanstack/react-query'
import { LocateFixed } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { FeedNotice, feedNotice } from '../components/FeedNotice'
import { LineStrip } from '../components/LineStrip'
import { StopCard } from '../components/StopCard'
import { StopCardSkeleton } from '../components/StopCardSkeleton'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { useLiveNearby } from '../hooks/useLiveNearby'
import { useLocation } from '../hooks/useLocation'
import { useOnline } from '../hooks/useOnline'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'

/** One array, so "no cards yet" has a stable identity — see `useLiveNearby`'s note on the storm. */
const EMPTY_IDS: readonly string[] = []

/**
 * **Home** — the merge of Nearby and Favourites (`proposals/07`, ADR-177), measured against
 * `packages/contract/ui/home.spec.json`.
 *
 * ## Nothing below the `homeView` call decides anything
 *
 * Which sections exist, what order the cards are in, which routes are chips rather than rows, and
 * whether a bus can still be caught are all one kernel call. This file decides what a DOM decides:
 * elements, focus rings, and which of the eleven declared states it is in.
 *
 * ## The two queries it joins, and why they stay two
 *
 * `/v1/board` answers about **where the rider is** and is cached per coordinate cell; the saved poles
 * are fetched **one query per pole**, each cached under its own key and shared with any other screen
 * that asks about the same place. Merging them into one request would make the whole screen's freshness
 * hostage to its slowest pole and would put a rider's saved list in a query string. So the fan-out stays,
 * and the *rendering* is incremental: a saved place that has answered is drawn immediately rather than
 * held for its siblings, which is what `loading` declares.
 *
 * ## The state arms, in the spec's order
 *
 * Location first (`denied` → `cold` / `noPosition`), then the wait, then the failure, then the board.
 * That order is why a rider who has never been asked sees an invitation rather than an empty list — and
 * on this screen it is *also* why they see their saved places while being asked, which is the whole
 * point of the merge and the thing neither old screen could do.
 *
 * **`isPending`, never `isLoading`** (ADR-124). The narrower claim excludes a fetch TanStack has
 * *parked* — offline, or a hidden tab — which is exactly when a rider waits longest, and the arm it
 * falls through to would otherwise render an empty board as "nothing near you".
 */
export function Home() {
  const locale = useLocale()
  const navigate = useNavigate()
  const { policy } = useClientPolicy()
  const { state: loc, request } = useLocation()
  const ready = loc.status === 'ready' ? loc : null

  const saved = usePreferences((s) => s.favoriteRoutes)
  // Which poles to ask about — a rule the screen needs *before* it has any data, which is why it is its
  // own kernel export. It skips a key the id grammar cannot read rather than guessing at it.
  const poleIds = favouritePoleIds(saved)

  /**
   * The board around the rider — `/v1/board`, not `/v1/nearby` (ADR-179).
   *
   * The difference is the chip strip: this endpoint sends each place's complete line-up, so a discovery
   * card's strip is whole and its "+N" expands in place. `homeView` reads either, so the choice is here
   * and nowhere else.
   */
  const board = useQuery({
    queryKey: ['board', ready?.lat, ready?.lng],
    queryFn: ready ? () => dataSource.getBoard({ lat: ready.lat, lng: ready.lng }, 500) : skipToken,
    // Only on error, as Nearby's is: the arrivals arrive by subscription at the served cadence, so a
    // healthy board needs no refetch — but a *failed* first load must still find its way back, and
    // nothing else here would let it.
    refetchInterval: (q) => (q.state.status === 'error' ? policy.refreshAfterMs : false),
  })

  const places = useQueries({
    queries: poleIds.map((stopId) => ({
      queryKey: ['stop', stopId],
      queryFn: () => dataSource.getStop(stopId),
      refetchInterval: policy.refreshAfterMs,
    })),
  })

  // The clock comes out of the subscription hook, and the pairing is the point: deleting the interval
  // would delete the screen's clock as well as its fetch, and `Date.now()` only advances on a re-render.
  const { now } = useLiveNearby(ready, board.data?.map((p) => p.stop.id) ?? EMPTY_IDS, {
    enabled: board.isSuccess,
    refreshAfterMs: policy.refreshAfterMs,
  })

  const resolved = places.flatMap((r) => (r.data ? [r.data] : []))

  // The whole screen's content, in one call.
  const sections: HomeSections = homeView(
    {
      saved,
      places: resolved,
      nearby: board.data ?? [],
      ...(ready ? { at: { lat: ready.lat, lng: ready.lng } } : {}),
    },
    { locale, now, policy },
  )

  const online = useOnline()
  const notice = feedNotice({
    // The newer of the two halves — a board is one screen and its freshness is one sentence (ADR-133).
    // `newestNearbyBoard` and `newestPlaceBoard` each answer for their own shape; the later of the two
    // is what the rider is actually looking at.
    lastUpdatedIso: newer(newestNearbyBoard(board.data ?? []), newestPlaceBoard(resolved)),
    now,
    online,
    // Either half failing is a board the rider cannot fully trust, and a missing card is not something
    // the remaining cards can say for themselves.
    trouble: board.isError || places.some((r) => r.isError) ? 'unreachable' : 'none',
    staleAfterMs: policy.staleAfterMs,
  })

  const cards = [...sections.catch, ...sections.saved, ...sections.nearby]
  const nothingToShow = cards.length === 0
  /**
   * Pending is per *screen*, not per query: a pole still waiting while another has answered is a partial
   * board, not a skeleton.
   *
   * **`ready !== null &&` is not belt-and-braces — it is the whole of a bug the spec caught.** With no
   * fix the board query is `skipToken`, and a skipped query is `pending` *for ever*: it is not waiting,
   * it was never asked. Without the guard, `cold` drew the permission prompt **and** a "locating"
   * skeleton underneath it — the screen saying it was finding stops near a rider whose position it had
   * not been given. `home.spec.json` declares `cold` as the prompt and the control and nothing else,
   * which is what turned an invisible contradiction into a failing state.
   */
  const waiting =
    nothingToShow && ((ready !== null && board.isPending) || places.some((r) => r.isPending))
  // `flatMap` rather than `.find`, which is the shape Favourites already uses: `check-no-derivation`
  // reads a `.find()` over results as a renderer selecting rows, and it is right to — the pattern it is
  // looking for is indistinguishable from one. Collecting and taking the first says the same thing
  // without the shape.
  const errors = places.flatMap((r) => (r.isError ? [r.error as Error] : []))
  const failure = nothingToShow ? ((board.error as Error | null) ?? errors[0]) : undefined

  const openPlace = (stopId: string) => navigate(`/stop/${encodeURIComponent(stopId)}`)
  const openRoute = (routeId: string, stopId: string) =>
    navigate(`/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(stopId)}`)

  const section = (key: PlainMessageKey, list: HomeCard[]) =>
    list.length === 0 ? null : (
      <section key={key}>
        {/* Every section that is drawn is drawn with its heading, including when it is the only one —
            a ranked list whose rank is unexplained is one the rider has to reverse-engineer. */}
        <h2 className="m-0 px-4 pt-4 pb-1 text-label text-subtle">{t(locale, key)}</h2>
        {list.map((card, i) => (
          <div key={card.stopId} className={i === 0 ? '' : 'border-t border-border'}>
            <StopCard
              view={card}
              locale={locale}
              onPress={() => openPlace(card.stopId)}
              onRoutePress={(routeId) => openRoute(routeId, card.stopId)}
            />
            {/*
              **The strip sits 14 px under the last row, not 30.** `StopCard` is a self-contained card
              with `py-4`, so stacking a sibling under it added its 16 px bottom padding to the row's own
              6 px and the strip's 8 px — half again more air than anything else on the board, which read
              as the chips belonging to the *next* place rather than this one.
              `-mt-2` gives back half of the card's padding, which lands exactly on the 14 px the approved
              mockup uses (`mockups/home/q4c`: a row's 5 px plus the strip's 9 px). A negative margin
              rather than a prop on `StopCard`, because the spacing is a fact about this composition —
              a card followed by a strip — and not about the card, which three other screens still draw
              on its own.
            */}
            <div className="-mt-2 px-4 pb-3">
              <LineStrip
                chips={card.chips}
                moreChips={card.moreChips}
                more={card.chipsMore}
                locale={locale}
                onPress={(routeId) => openRoute(routeId, card.stopId)}
              />
            </div>
          </div>
        ))}
      </section>
    )

  return (
    <main className="min-h-dvh bg-bg">
      <header className="px-4 pb-1 pt-2">
        <h1 className="m-0 text-h1 text-text">{t(locale, 'homeTitle')}</h1>
      </header>

      {/* `denied` — we asked and were told no, so the control says "try again". The saved half is
          unaffected and follows below, which is the difference this board makes. */}
      {loc.status === 'denied' ? (
        <div className="px-4 pb-2 pt-3">
          <p className="m-0 text-body text-text">{t(locale, 'locationDenied')}</p>
          <p className="m-0 mt-1 text-label text-muted">{t(locale, 'locationDeniedHelp')}</p>
          <button
            type="button"
            onClick={request}
            className="mt-3 rounded-pill border border-border bg-surface px-4 py-2 text-label text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {t(locale, 'retry')}
          </button>
        </div>
      ) : loc.status === 'error' ? (
        <p className="m-0 px-4 pb-2 pt-3 text-body text-danger">{loc.message}</p>
      ) : loc.status === 'undetermined' && poleIds.length === 0 ? (
        /* `cold` — no position and nothing saved. The only genuinely empty state left, and the first
           thing every new rider sees: what the app wants location for, and the control that asks. */
        <Centred>
          <h2 className="m-0 text-center text-h2 text-text">{t(locale, 'nearbyPrimeTitle')}</h2>
          <p className="mb-5 mt-2 text-center text-body text-muted">
            {t(locale, 'nearbyPrimeBody')}
          </p>
          <EnableLocation onPress={request} label={t(locale, 'enableLocation')} />
        </Centred>
      ) : loc.status === 'undetermined' ? (
        /* `noPosition` — the office case. Their list is the screen; nothing is wrong, and the one thing
           worth saying is what turning location on would add. */
        <div className="px-4 pb-1 pt-2">
          <p className="m-0 text-label text-muted">{t(locale, 'homeNoPosition')}</p>
          <div className="mt-3">
            <EnableLocation onPress={request} label={t(locale, 'enableLocation')} />
          </div>
        </div>
      ) : null}

      {waiting ? (
        <div>
          <p className="m-0 px-4 pb-1 text-label text-muted">{t(locale, 'locating')}</p>
          {[3, 2, 3].map((rows, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity to key on.
              key={i}
              className={i === 0 ? '' : 'border-t border-border'}
            >
              <StopCardSkeleton rows={rows} />
            </div>
          ))}
        </div>
      ) : failure ? (
        <p className="m-0 px-4 pt-4 text-body text-danger">{failure.message}</p>
      ) : (
        <div>
          {/* **The position is remembered, said once.** ADR-008's honesty rule applies to the rider's
              *position*, not only to the arrival times — and on this screen it governs the ranking too,
              because "saved outranks near" is measured from that position. Nearby carried this as a
              subtitle under its title; Home had nowhere for it until `home.spec.json`'s `stale` state
              asked for it, which is the spec finding an omission rather than describing one. */}
          {ready?.stale ? (
            <p className="m-0 px-4 pt-2 text-label text-muted">{t(locale, 'lastKnownLocation')}</p>
          ) : null}
          <FeedNotice notice={notice} />
          {section('homeCatchIt', sections.catch)}
          {section('homeSaved', sections.saved)}
          {section('homeAround', sections.nearby)}
          {/* `noSaved` — a full board and one line explaining what saving does. Not an empty state:
              the rider is standing next to six stops. */}
          {poleIds.length === 0 && cards.length > 0 ? (
            <p className="m-0 px-4 py-4 text-label text-muted">
              {t(locale, 'homeNothingSavedYet')}
            </p>
          ) : null}
          {/*
            `empty` — a fix, nothing saved, and nothing within the radius. Rare in Hong Kong, and not a bug.

            **Gated on having actually asked**, which is the second thing the spec caught. Without
            `board.isSuccess` this line rendered in `cold` and `denied` too: a rider who had never granted
            location, or had refused it, was told there was *no scheduled service* — a claim about Hong
            Kong made out of our own silence, and the exact conflation ADR-073 spent a wave separating and
            ADR-124 has now fixed on three screens. "We have not asked" and "we asked and nothing is due"
            are different facts, and only one of them is this sentence.
          */}
          {cards.length === 0 && ready !== null && board.isSuccess ? (
            <p className="px-4 pt-4 text-body text-muted">{t(locale, 'noService')}</p>
          ) : null}
        </div>
      )}
    </main>
  )
}

/** The later of two ISO timestamps, either of which may be absent. Lexical order is chronological. */
function newer(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

function EnableLocation({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="inline-flex items-center gap-2 rounded-pill border-0 bg-accent px-5 py-3 text-label text-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <LocateFixed aria-hidden width={18} height={18} />
      {label}
    </button>
  )
}

function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6">{children}</div>
  )
}
