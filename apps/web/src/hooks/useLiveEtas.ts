import {
  applyLiveEtasToStopDetail,
  CLIENT_POLICY_DEFAULTS,
  type DataSource,
  type StopDetail,
} from '@nextbus/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { dataSource as appDataSource } from '../adapters/datasource'

/**
 * Feed the Place screen's ETAs by **subscription** instead of by re-fetching the whole stop — the twin of
 * `apps/mobile/lib/useLiveEtas.ts`, deliberately hand-copied.
 *
 * The rule is shared and the wiring is not (ADR-068/069, ADR-075): `applyLiveEtasToStopDetail` lives in
 * `@nextbus/core` and is called identically by both renderers, while the `useEffect`/`setQueryData`
 * plumbing is per renderer — the same split `useLocation`, `useClientPolicy` and `useLiveNearby` already
 * have in this directory. `packages/api-client` cannot hold it: `layers.json` gives the `client` layer
 * `"npm": []`, so it may not import React at all.
 *
 * **Read the RN hook for the arguments**; three of them are load-bearing and none is repeated here:
 *
 *  · the write goes to the **same query key** the initial fetch uses (`['stop', id]`), because that is the
 *    entry ADR-058's persister dehydrates — a key of its own would freeze the offline copy at the last HTTP
 *    fetch;
 *  · the updater is a **merge**, not a replacement: a frame carries readings and nothing else, so replacing
 *    the payload drops `stop`, `members` and every row's `route`, and the screen renders with no name and no
 *    map pins;
 *  · it returns the **clock**, because the `refetchInterval` it replaced was the screen's clock as well as
 *    its fetch — without it `etaReadout`'s staleness cue can never fire, which shipped once and was found by
 *    review rather than by a test.
 *
 * `failed` is passed through and **replaced, never merged** (WP5-14, ADR-081), so a kerb that recovers stops
 * being marked within one round instead of carrying a stale claim for ever.
 */
export function useLiveEtas(
  stopId: string | undefined,
  opts: { source?: DataSource; enabled?: boolean; refreshAfterMs?: number } = {},
): { now: number } {
  const { source = appDataSource, enabled = true, refreshAfterMs } = opts
  const tickMs = refreshAfterMs ?? CLIENT_POLICY_DEFAULTS.refreshAfterMs
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(tick)
  }, [tickMs])

  const queryClient = useQueryClient()
  useEffect(() => {
    if (!stopId || !enabled) return
    const subscription = source.watch(
      [{ stopId }],
      (etas, failed) => {
        queryClient.setQueryData<StopDetail>(['stop', stopId], (previous) =>
          previous === undefined ? previous : applyLiveEtasToStopDetail(previous, etas, failed),
        )
      },
      { refreshAfterMs },
    )
    return () => subscription.unsubscribe()
  }, [stopId, enabled, refreshAfterMs, source, queryClient])

  return { now }
}
