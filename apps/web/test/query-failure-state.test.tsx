// **Why a failed request used to settle `pending` instead of `error`**, and the two gates that did it.
//
// docs/07 carried this as an unexplained environmental bug: *"open `/stop/CTB:999999`, the Worker answers
// 404 once, `EdgeRequestError` is thrown, and the query settles at `status: 'pending'`,
// `fetchStatus: 'idle'` — so `isError` is false, the rider never sees why, and `refetchInterval`'s
// `status === 'error'` predicate never fires, so nothing ever retries either."* It also recorded the thing
// that made it baffling: **the identical rejection in `test/place-detail-states.test.tsx` lands on `error`
// and shows the message.** That suite builds its own `QueryClient` with `retry: false`; the app's provider
// does not, and the difference is entirely in TanStack's two *pause* gates:
//
//  1. **`networkMode`** (default `'online'`). While `onlineManager` believes the device is offline a query
//     is not run at all — `pending` / `paused`, `fetchFailureCount: 0`, no error, no attempt on record.
//  2. **the focus gate.** `retryer.canContinue()` requires `focusManager.isFocused()`, which is
//     `document.visibilityState !== 'hidden'`. A *retry* scheduled while the document is hidden is parked
//     until `visibilitychange`.
//
// And the reported `fetchStatus: 'idle'` — the detail that hid the mechanism, because it is
// indistinguishable from a query that was never asked — is what a **parked** query becomes when its last
// observer goes away: `Query.removeObserver` sees `#isInitialPausedFetch()` and calls
// `retryer.cancel({ revert: true })`, which restores the pre-fetch state and *erases the failure count*.
// `<StrictMode>`'s mount/unmount/mount and any navigation away from the screen both do it.
//
// Measured in a real browser as well as here, on 2026-08-11: `/stop/CTB:999999` against a live
// `pnpm dev:edge` reported `{status: 'pending', fetchStatus: 'paused', fetchFailureCount: 1}` in a
// background tab, and flipping `document.visibilityState` to `'visible'` resumed the retryer and settled it
// on `error: EdgeRequestError: unknown stop: CTB:999999`.
//
// The fix for gate 1 is `networkMode: 'always'` in the provider — asserted below. Gate 2 is left alone
// (parking a retry in a tab nobody is looking at is correct, and it resumes on its own), which is exactly
// why no screen may branch on `isLoading`: see `nearby-offline.test.tsx`.

import { onlineManager, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryProvider } from '../src/providers/QueryProvider'

let container: HTMLElement
let root: Root | null = null
let client: QueryClient | null = null

const KEY = ['probe'] as const

function Probe({ run }: { run: () => Promise<unknown> }) {
  client = useQueryClient()
  const q = useQuery({ queryKey: KEY, queryFn: run })
  return <div>{`${q.status}/${q.fetchStatus}`}</div>
}

/** The whole app provider, not a hand-rolled client: the defaults under test are *its* defaults. */
function mount(run: () => Promise<unknown>) {
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryProvider>
        <Probe run={run} />
      </QueryProvider>,
    )
  })
}

/**
 * Let real time pass in 50 ms slices, flushing React between each.
 *
 * Real timers rather than fake ones, and the slicing is not decoration: the retryer's delay is a
 * `setTimeout` **outside** React, and awaiting one long `act()` leaves its continuation queued behind the
 * act scope — the first draft of this file measured `pending/fetching` for four seconds in the *healthy*
 * case and would have "proved" a bug that is not there. Stops as soon as the query settles.
 */
async function settle(maxMs = 4_000): Promise<void> {
  for (let elapsed = 0; elapsed < maxMs; elapsed += 50) {
    if (state().status !== 'pending') return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
}

function state() {
  const found = client?.getQueryState(KEY as unknown as readonly unknown[])
  return {
    status: found?.status ?? 'no-query',
    fetchStatus: found?.fetchStatus ?? 'no-query',
    failures: found?.fetchFailureCount ?? -1,
  }
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  localStorage.clear()
  client = null
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  // `onlineManager` and `focusManager` are module singletons shared by every suite in this process, so a
  // test that flips one and does not put it back leaks into the next file. `setOnline` rather than an
  // `online` event, because `onlineManager` **detaches its window listeners** once the last `QueryClient`
  // unmounts — the event would be dispatched into nothing and the next test would start offline.
  setVisibility('visible')
  act(() => {
    onlineManager.setOnline(true)
  })
})

const REFUSED = () => Promise.reject(new Error('unknown stop: CTB:999999'))

describe('a request that fails reaches `error`, whatever the browser thinks of the network', () => {
  it('does, when the document is visible and the browser believes it is online', async () => {
    // The control. Without it the two assertions below could both pass on a harness that can never
    // observe an error at all, which is the failure shape this repo audits for by name.
    mount(REFUSED)
    await settle()
    expect(state()).toMatchObject({ status: 'error', fetchStatus: 'idle' })
  })

  it('does while the browser believes it is offline — it is not silently parked', async () => {
    // THE FIX, and the half that was permanent. With `networkMode: 'online'` this query never runs: it
    // sits `pending` / `paused` with `fetchFailureCount: 0` for as long as the rider is offline, so
    // `isError` is false, `isLoading` is false (nothing is fetching), and every screen falls through to
    // its empty branch. `refetchInterval`'s `status === 'error'` predicate (ADR-079) never fires either,
    // so there is no way out of it.
    mount(REFUSED)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await settle()
    expect(state()).toMatchObject({ status: 'error' })
    expect(state().failures).toBeGreaterThan(0)
  })

  it('runs the request rather than guessing from `navigator.onLine`', async () => {
    // The positive case of the same decision, and the reason it is right rather than merely convenient:
    // the app has a service worker (ADR-058/082), so a request made while the browser calls itself
    // offline can still be answered — from the Workbox cache, or over a link `navigator.onLine` is simply
    // wrong about (a captive portal reports `true`, some VPN stacks report `false`). Pausing means never
    // asking; asking costs one instantly-failing fetch.
    let asked = 0
    mount(() => {
      asked += 1
      return Promise.resolve({ ok: true })
    })
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await settle()
    expect(asked).toBeGreaterThan(0)
    expect(state()).toMatchObject({ status: 'success' })
  })
})

describe('the focus gate still parks a retry, which is why `pending` is not `isLoading`', () => {
  it('parks a hidden document’s retry at `pending` / `paused`, with nothing fetching', async () => {
    // Deliberately NOT fixed: parking a retry in a tab nobody is looking at is correct, and `onFocus`
    // resumes it. What is not acceptable is a screen reading this state as an answer — `isLoading` is
    // `isPending && isFetching` and is **false** here, which is the whole of the Nearby defect.
    setVisibility('hidden')
    mount(REFUSED)
    await settle(1_500)
    expect(state()).toMatchObject({ status: 'pending', fetchStatus: 'paused' })
    expect(state().failures).toBe(1)
  })

  it('resumes on `visibilitychange` and lands on `error`', async () => {
    setVisibility('hidden')
    mount(REFUSED)
    await settle(1_500)
    expect(state().status).toBe('pending')
    setVisibility('visible')
    await settle()
    expect(state()).toMatchObject({ status: 'error', fetchStatus: 'idle' })
  })

  it('reverts a parked query to the reported `pending` / `idle` when its last observer leaves', async () => {
    // The exact signature docs/07 recorded, reproduced: `Query.removeObserver` →
    // `#isInitialPausedFetch()` → `retryer.cancel({ revert: true })` → the pre-fetch state, **failure
    // count and all evidence erased**. `<StrictMode>` and any navigation away do this, which is why the
    // reported state looked like a query nobody had ever asked.
    setVisibility('hidden')
    mount(REFUSED)
    await settle(1_500)
    expect(state()).toMatchObject({ status: 'pending', fetchStatus: 'paused', failures: 1 })
    act(() => root?.unmount())
    root = null
    expect(state()).toMatchObject({ status: 'pending', fetchStatus: 'idle', failures: 0 })
  })
})
