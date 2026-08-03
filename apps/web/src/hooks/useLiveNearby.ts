import {
  applyLiveEtasToNearby,
  CLIENT_POLICY_DEFAULTS,
  type DataSource,
  liveTargetsKey,
  type NearbyStop,
  type WatchTarget,
} from '@nextbus/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { dataSource as appDataSource } from '../adapters/datasource'

/**
 * Feed the Nearby list's arrivals by **one subscription** instead of by refetching the whole list.
 *
 * This is WP5-7, and it is the row `applyLiveEtasToNearby` was written for: that kernel function has been
 * corpus-pinned with **no consumer** since Wave 5 began, because the poll emulator issued one request per
 * target and Nearby watches up to six places. Six requests per window where the screen issued one is a
 * regression a rider pays for a feature they cannot see, so the endpoint had to come first
 * (`/v1/etas?ids=…`). It now does, and the transport asks once per round.
 *
 * ## The twin of `apps/mobile/lib/useLiveNearby.ts`, deliberately hand-copied
 *
 * The rule is shared and the wiring is not (ADR-068/069, ADR-075): `liveTargetsKey`,
 * `applyLiveEtasToNearby` and `retainFailedPoles` live in `@nextbus/core` and are called identically by
 * both renderers, while the `useQuery`/`useEffect` plumbing is per renderer — the same split
 * `useLocation` and `useClientPolicy` already have in this directory. `packages/api-client` cannot hold
 * this file: `layers.json` gives the `client` layer `"npm": []`, so it may not import React at all.
 *
 * Read `apps/mobile/lib/useLiveEtas.ts` for the arguments about writing through to the query cache, about
 * the clock and about `enabled`; they apply here unchanged and are not repeated. Three things differ from
 * that Place-screen hook:
 *
 *  · **The query key is the list's, `['nearby', lat, lng]`,** so the write lands on the same entry
 *    ADR-058's persister dehydrates. A key of its own would freeze the persisted copy at its last HTTP
 *    fetch and a cold start would read something that was never written.
 *  · **The merge is `applyLiveEtasToNearby`,** which attributes a reading to a card through
 *    `memberStopIds` — an `Eta.stopId` is a *pole* while a card's id may be a merged `P:` place
 *    (ADR-042), so comparing them directly leaves every interesting place with an empty card.
 *  · **The subscription's identity is a string, not the array,** which is the one thing here that is not
 *    a copy of the Place screen. See below.
 *
 * ## `liveTargetsKey` is not tidiness; an array dependency is a request storm
 *
 * The effect below has to depend on the target set. A `WatchTarget[]` built per render is a new array
 * every time, and the subscription's own readings are written into the query cache, which re-renders the
 * screen, which builds a new array — and `subscribe` fires a round *immediately*. So an array dependency
 * makes a subscription resubscribe on its own output, unboundedly, one HTTP request per turn. The kernel's
 * `liveTargetsKey` is the fix and it is in the kernel rather than here because both renderers need the
 * same answer to "is this the same subscription?": keyed on the set in one and on the ordered list in the
 * other, the two would resubscribe at different moments for the same rider action, which is drift on the
 * spec rather than on the pixels (ADR-075). It runs over the *accepted* set, so a Nearby list that merely
 * reorders as a rider walks a few metres is one subscription, and an empty string means there is nothing
 * watchable — the condition for not opening anything at all.
 *
 * ## What a card says during an outage, on the live path as well as the first paint
 *
 * `applyLiveEtasToNearby` is called **with the round's own failure set** (WP5-14, ADR-081), so the "Live
 * times unavailable" marker survives the handover from the HTTP fetch to the subscription instead of
 * clearing on the first round. It shipped the other way for one wave, and the reason was recorded rather
 * than hidden: the frames carried no failure list (ADR-073), so ADR-077 decision 2 chose the direction
 * that loses information over the one that keeps a stale claim — *"the fix is frames that carry `failed`,
 * which is a wire change to make when a screen renders per-kerb failure."* This hook is that screen, so
 * the wire changed.
 *
 * Three things about it are worth knowing at this call site. The set is **replaced, never merged** — an
 * absent argument still clears the field, which is what keeps a recovered kerb's marker from outliving
 * the recovery. A round whose failure set moved is **news even when no reading did**, which is why this
 * listener now fires on rounds it used to sleep through. And the marker is **per card**, attributed
 * through `memberStopIds`, so an outage at one kerb of one place does not mark the whole screen.
 *
 * @param at the fix the list was fetched for — already snapped to a 25 m cell by the shared controller,
 * which is what makes the query key stable enough to cache (ADR-058). `null` before a fix arrives.
 * @param stopIds the ids of the places on screen, in any order. Take them from the query's own data, not
 * from a derived view: the two are the same set and a screen deriving a subset would be deciding
 * something the kernel should.
 * @param opts.source injected by a seam-substitution test — the point of the exercise being that swapping
 * the data source reaches the screen without editing it.
 * @param opts.enabled pass the query's own `isSuccess`. The merge cannot invent a list, so a reading that
 * arrives before the first fetch resolves has nowhere to go and is lost for a whole cadence (the poll
 * emulator, like the shard, re-sends a reading only when it changes).
 * @param opts.refreshAfterMs pass the **resolved** `ClientPolicy.refreshAfterMs`, for the reason
 * `useLiveEtas` gives: the `DataSource` is built at module scope, before any policy has been fetched.
 */
export function useLiveNearby(
  at: { lat: number; lng: number } | null,
  stopIds: readonly string[],
  opts: { source?: DataSource; enabled?: boolean; refreshAfterMs?: number } = {},
): { now: number } {
  const { source = appDataSource, enabled = true, refreshAfterMs } = opts
  const tickMs = refreshAfterMs ?? CLIENT_POLICY_DEFAULTS.refreshAfterMs
  const [now, setNow] = useState(() => Date.now())
  // The clock. Nearby had none at all before this — no `refetchInterval`, no interval anywhere — so its
  // `Date.now()` never advanced and `etaReadout`'s staleness cue could never fire. That was the same
  // defect `useLiveEtas` documents for the Place screen, present here already and worse, because the
  // data was frozen too. Fixed by adopting the subscription rather than by adding an interval, which is
  // why the pairing lives in this hook.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(tick)
  }, [tickMs])

  // Recomputed every render and deliberately **not** memoized: its input is an array, so a memo keyed on
  // `stopIds` would recompute anyway and would only hide that. The string is what has to be stable, and
  // it is — `liveTargetsKey` is a pure function of the accepted set.
  const key = liveTargetsKey(stopIds.map((stopId): WatchTarget => ({ stopId })))
  // Memoized on the **key**, so the array handed to `watch()` has one identity for as long as the
  // subscription does. `useRef` would do the same job with more moving parts.
  //
  // The suppression below is the whole point of this hook and not a shortcut: naming `stopIds` would
  // rebuild the array on every render, which is the request storm the block comment above describes.
  // `key` IS the identity of that set — it is a pure function of it — so it is the correct dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the identity of `stopIds`; see above
  const targets = useMemo(
    () => (key.length === 0 ? [] : stopIds.map((stopId): WatchTarget => ({ stopId }))),
    [key],
  )

  const queryClient = useQueryClient()
  const lat = at?.lat
  const lng = at?.lng
  // `targets` is derived from `key` and from nothing else, so naming both would add a dependency that
  // changes at exactly the same moments — and naming `stopIds` instead is the storm.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `targets` is derived from `key`; see above
  useEffect(() => {
    if (!enabled || lat === undefined || lng === undefined || key === '') return
    const subscription = source.watch(
      targets,
      (etas, failed) => {
        queryClient.setQueryData<NearbyStop[]>(['nearby', lat, lng], (previous) =>
          previous === undefined ? previous : applyLiveEtasToNearby(previous, etas, failed),
        )
      },
      { refreshAfterMs },
    )
    return () => subscription.unsubscribe()
    // `key` and not `targets`: see the block comment above.
  }, [key, lat, lng, enabled, refreshAfterMs, source, queryClient])

  return { now }
}
