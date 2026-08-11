import { CLIENT_POLICY_DEFAULTS, type DataSource, type Eta, type EtaFailure } from '@nextbus/core'
import { useEffect, useState } from 'react'
import { dataSource as appDataSource } from '../adapters/datasource'

/** What the last live round said, and the clock to read it against. */
export interface LiveRoute {
  /**
   * The reduced session, or **`null` until a round has actually landed** — and the difference is a bug this
   * hook shipped for one run of the suite.
   *
   * `applyLiveEtasToRouteDetail`'s contract is that the list it is handed is the *complete current set*, so
   * an empty one means "nothing is due anywhere" and blanks every row. That is a real live state and the
   * right answer for it — but it is emphatically not the answer before the first frame, and a hook that
   * returned `{ etas: [] }` from the moment it mounted made every KMB route render with no times at all.
   * The conformance suite caught it, which is what it is for. `null` says *"I have no session"*, and a caller
   * that merges it anyway has a type error rather than a silent screen of blanks.
   *
   * **Tagged with the route it came from**, because `setRound(null)` runs in an effect and an effect runs
   * after paint. Browser Back from a Citybus route to a KMB one, or the direction toggle: the route id and
   * the payload change in the same commit, so without the tag one painted frame merges the previous route's
   * round onto the new route's document — every reading filtered out as another route's, every row blank,
   * and the old route's `failed` marking kerbs on a route nothing asked about. The caller compares.
   */
  round: { routeId: string; etas: readonly Eta[]; failed: readonly EtaFailure[] } | null
  /** The screen's clock, ticking at the served cadence. */
  now: number
  /** Whether a subscription is open. The screen draws nothing different for it; a test can see it. */
  live: boolean
}

/**
 * Feed a Route detail screen's per-stop times by **subscription** — the times a Citybus or GMB route has no
 * other way to get (ADR-116/119, proposals/05).
 *
 * ## It hands the readings back instead of writing them into the query cache, unlike its two siblings
 *
 * `useLiveEtas` and `useLiveNearby` merge each frame into the screen's query key with `setQueryData`, and that
 * is right for them: a Place or Nearby payload **carries readings of its own**, so when the HTTP query
 * refetches, live values are replaced by fresh ones and nothing is lost. A Citybus route payload carries
 * `eta: null` on every stop — that is the entire problem this feature exists to solve — so the same shape
 * would blank every time on screen at each refetch and refill it one frame later. Handing the readings to the
 * screen, which merges them at render, is immune to that by construction: the base document may be replaced
 * as often as it likes.
 *
 * Two consequences, stated because they are trade-offs rather than free wins:
 *
 *  · **ADR-058's persisted copy holds the HTTP payload, not the merged one.** A cold start therefore replays a
 *    route that says *"live times unavailable"* and subscribes immediately, rather than replaying yesterday's
 *    minutes as though they were current. For a screen whose readings all come from a live round, that is the
 *    honest direction.
 *  · **The readings live in this hook's state**, so a screen that unmounts loses them — which is what
 *    unsubscribing means anyway.
 *
 * ## `wanted` cannot be read off a merged view, and here it never has to be
 *
 * The field that asks for a subscription (`liveArrivals`) is cleared by the merge, because absence is what
 * *answered* means on the wire. Merging at render leaves the **cached** payload untouched, so the request stays
 * true for as long as the route is one that needs it and no latch is required. The version of this hook that
 * merged into the cache needed one, and without it unsubscribed itself the moment it succeeded.
 *
 * ## One subscription per route id
 *
 * The listener sets state, which re-renders the screen. Anything derived from a frame in these dependencies
 * would resubscribe on every round — and a subscription fetches one immediately, which makes that a request
 * storm rather than a wasted render. `routeId` and the injected seams are all that is in here.
 */
export function useLiveRoute(
  routeId: string | undefined,
  opts: { source?: DataSource; wanted?: boolean; refreshAfterMs?: number } = {},
): LiveRoute {
  const { source = appDataSource, wanted = false, refreshAfterMs } = opts
  const tickMs = refreshAfterMs ?? CLIENT_POLICY_DEFAULTS.refreshAfterMs
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(tick)
  }, [tickMs])

  const [round, setRound] = useState<LiveRoute['round']>(null)

  const live = wanted && routeId !== undefined
  useEffect(() => {
    if (!live || routeId === undefined) return
    // Dropped on the way in as well as on the way out: the readings belong to the route being watched, and
    // carrying one route's minutes onto another's schematic would put a bus at a kerb it never calls at. The
    // direction toggle navigates between two route ids, so this is the ordinary case rather than a corner one.
    setRound(null)
    const subscription = source.watchRoute(
      routeId,
      (etas, failed) => setRound({ routeId, etas, failed: failed ?? [] }),
      { refreshAfterMs },
    )
    return () => {
      subscription.unsubscribe()
      setRound(null)
    }
  }, [live, routeId, refreshAfterMs, source])

  return { round, now, live }
}
