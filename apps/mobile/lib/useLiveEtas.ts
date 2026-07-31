import {
  applyLiveEtasToStopDetail,
  CLIENT_POLICY_DEFAULTS,
  type DataSource,
  type StopDetail,
} from '@nextbus/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { dataSource as appDataSource } from './datasource'

/**
 * Feed a Place screen's ETAs by **subscription** instead of by re-fetching the whole stop.
 *
 * This is WP5-0: `watch()` — the seam ADR-004 has claimed since v1 would be swapped for a socket without
 * the UI noticing — had **zero callers**. Nothing under `apps/mobile/app/**` reached it, so WP5-2's
 * "substitute a fake data source and show no screen changed" measured nothing at all. This hook is the
 * consumer that makes the claim testable, and it is deliberately the smallest one that can be: ten lines,
 * no rules, no state of its own.
 *
 * ## It writes through to the query cache, and that is the load-bearing decision
 *
 * `useQuery({ queryKey: ['stop', id] })` stays as the initial fetch **and as the persistence vehicle**:
 * `QueryProvider`'s persister dehydrates any query whose status is `success`, so a `setQueryData` write
 * keeps ADR-058's offline replay working — but only if it lands on the *same* key. Writing to a
 * `['live', 'stop', id]` key of its own would freeze the persisted entry at its last HTTP fetch, and a
 * cold start would then read a key that was never dehydrated. This is the repo's first `setQueryData`,
 * which is why that is spelled out rather than assumed.
 *
 * The updater is the kernel's `applyLiveEtasToStopDetail` — a **merge**, not a replacement. A frame
 * carries readings and nothing else, so replacing the payload would drop `stop`, `members` and each row's
 * `route`, all of which the screen reads; the result renders as a screen with no name and no map pins.
 * The merge also sets a row with no live reading to `null` rather than leaving its last value, which is
 * `gone`'s honesty rule (ADR-008) reaching the screen.
 *
 * ## It returns the clock, because the refetch it replaced *was* the clock
 *
 * `refetchInterval` did two jobs and only one of them was obvious. It fetched, and it **re-rendered** —
 * and a screen's `const now = Date.now()` only advances when something re-renders it. Deleting it took the
 * clock with it: a round in which nothing changed calls no listener (by design, ADR-008), `useClientPolicy`
 * has a `staleTime` and no interval, and `refetchOnWindowFocus` is `false`. So on a quiet stop nothing
 * re-rendered at all, and the one cue that exists to say *"these times have stopped arriving"* —
 * `etaReadout`'s `stale` flag, at 90 s — **could never fire**. The screen kept showing confident minutes
 * against a frozen clock. Found by review after WP5-0 shipped, not by a test.
 *
 * So the clock comes back out of this hook rather than from a `useNow` a screen has to remember to call.
 * The pairing is the whole point: converting a screen off `refetchInterval` is exactly the moment its clock
 * stops, and a hook that hands the replacement back cannot be half-adopted. A separate hook could be
 * forgotten, and a grep-level gate asserting "calls `useNow`" would pass on a screen that called it and
 * used `Date.now()` anyway — the same *"referenced is not rendered"* trap that killed WP4-1's cheap gate.
 *
 * **Why a tick is not the countdown ADR-008 forbids.** What that rule bans is *fabricated precision* — a
 * per-second countdown implying the estimate is refreshing when it is not. Recomputing "minutes until this
 * fixed timestamp" on the served cadence is arithmetic on data we were given, it is the granularity riders
 * have seen since v1 (the 30 s refetch did exactly this), and it is what makes the staleness cue possible
 * at all. The tick is `refreshAfterMs`, so the cue appears within one cadence of becoming true.
 *
 * Not handled, and worth knowing: **nothing in this repo pauses on background.** The tick keeps running
 * while the app is hidden, exactly as three `refetchInterval`s already do. That is a battery question for
 * whoever adds visibility handling, not a correctness one — and it is one of the arguments for the socket.
 *
 * ## What it deliberately does not do
 *
 * It does not tell the screen which engine is driving. `EdgeClient.watch()` uses the poll emulator unless
 * a transport is configured, so today this is polling wearing a subscription's clothes — and a screen
 * that branched on it would be a screen with two behaviours to keep working. Saying "live" rather than
 * "polling" to a rider needs an i18n key and a decision about what the word promises; it is a follow-up,
 * not something to improvise at a call site.
 *
 * ## `enabled` exists because of a race the seam proof found, not because it is tidy
 *
 * The updater cannot invent a `StopDetail` — a frame carries readings and nothing else — so a reading that
 * arrives *before* the initial `getStop` resolves has nowhere to go, and returning `undefined` makes
 * react-query treat it as "no change". That drop is **not** self-healing: the poll emulator, like the shard
 * it emulates, sends a `delta` only when something has *changed*, so having sent a reading once it will not
 * send it again until the bus moves. The reading is lost for a whole cadence, or longer.
 *
 * It also made the two engines diverge, which is how it was found rather than shipped. Measured by removing
 * this gate and running `apps/mobile/test/seam-substitution.test.tsx`: the scripted socket rendered `—` every
 * time (`createMemoryTransport` delivers synchronously inside `subscribe`, so it always loses), while the poll
 * emulator rendered `4 min` on one run and `—` on the next — its round resolves a microtask or two later, so
 * the outcome depends on how the query's promise chain happens to interleave. Two engines, one screen,
 * different arrivals, and *flaky* on the engine that ships. Caught before a rider could.
 *
 * So the subscription waits until there is something to merge into. Gating it is better than remembering the
 * dropped frame in a ref: no ETA request goes out before we know the stop resolves at all, and the hook
 * keeps no state, which is what lets it stay ten lines on three platforms.
 *
 * @param opts.source injected by the seam-substitution test, which is the whole point of the exercise:
 * swapping the data source must reach the screen without editing it.
 * @param opts.enabled pass the query's own `isSuccess` — see above. A persisted entry restored on a cold
 * start is already `success`, so offline replay subscribes immediately rather than waiting for the network.
 * @param opts.refreshAfterMs pass the **resolved** `ClientPolicy.refreshAfterMs`. Not optional in spirit,
 * only in type: the `DataSource` is constructed at module scope, before any policy has been fetched, so
 * omitting it silently reinstates the compiled-in default and an edge that moved the cadence would move it
 * for the three `refetchInterval` screens and not for this one — ADR-053's own defect, one layer down.
 */
export function useLiveEtas(
  stopId: string | undefined,
  opts: { source?: DataSource; enabled?: boolean; refreshAfterMs?: number } = {},
): { now: number } {
  const { source = appDataSource, enabled = true, refreshAfterMs } = opts
  const tickMs = refreshAfterMs ?? CLIENT_POLICY_DEFAULTS.refreshAfterMs
  const [now, setNow] = useState(() => Date.now())
  // The clock, and why this hook of all places owns it — see the block comment above.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(tick)
  }, [tickMs])

  const queryClient = useQueryClient()
  useEffect(() => {
    if (!stopId || !enabled) return
    const subscription = source.watch(
      [{ stopId }],
      (etas) => {
        queryClient.setQueryData<StopDetail>(['stop', stopId], (previous) =>
          previous === undefined ? previous : applyLiveEtasToStopDetail(previous, etas),
        )
      },
      { refreshAfterMs },
    )
    return () => subscription.unsubscribe()
  }, [stopId, enabled, refreshAfterMs, source, queryClient])

  return { now }
}
