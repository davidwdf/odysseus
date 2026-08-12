// **"No scheduled service" is a claim about Hong Kong. Nearby used to make it out of its own silence.**
//
// docs/07 recorded it as *"an offline, paused fetch renders 'No scheduled service' on Nearby — a false
// claim, and the exact ADR-073 conflation one screen over from where it was fixed."* This file is that
// claim's regression suite, and it is deliberately separate from `nearby-states.test.tsx`: that suite
// builds its own `QueryClient` with `retry: false` and drives the spec's declared states, whereas the
// defect lives **between** the declared states, in query states the screen's branches did not name. Only
// the app's real provider produces them, so this file mounts the real `QueryProvider` and no other.
//
// The two ways a query sits `pending` with nothing to show, both measured in `query-failure-state.test.tsx`:
//
//  · **offline** — `networkMode: 'online'` refuses to run it at all (`pending` / `paused`,
//    `fetchFailureCount: 0`). Fixed at the provider with `networkMode: 'always'`, so this is now an error
//    the rider can read and `refetchInterval` can heal (ADR-079).
//  · **a hidden document** — the focus gate parks the *retry* until `visibilitychange`. Deliberately not
//    fixed; it resumes on its own. So the screen has to be honest about it, which is the second fix:
//    branch on `isPending` (status) and never on `isLoading` (`isPending && isFetching`), which is false
//    for a parked query and was what let it fall through to the list.
//
// The third case is the one the fix could have broken. `networkMode: 'always'` makes a cold *offline*
// start with a restored cache reach `status: 'error'` **with data**, where before it merely paused — so an
// error arm that fires on `isError` alone would replace ADR-058's replayed list with a sentence, which the
// spec's `offline` state forbids in as many words ("never a blank list").

import {
  CLIENT_POLICY_DEFAULTS,
  type Locale,
  type NearbyStop,
  type StopCardView,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
import { onlineManager, type QueryClient, useQueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryProvider } from '../src/providers/QueryProvider'

const LOCALE: Locale = 'en'

const WITH_STOPS = corpus.groups.nearbyView.cases.find((c) => c.args.stops.length > 0)
if (!WITH_STOPS) throw new Error('the nearbyView corpus group moved')
const CASE = WITH_STOPS
const NOW = Date.parse(CASE.args.now)

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

const READY: LocationState = { status: 'ready', lat: 22.38, lng: 114.19, stale: false }

let nearby: () => Promise<NearbyStop[]> = () => Promise.resolve([])

vi.mock('../src/hooks/useLocation', () => ({
  useLocation: () => ({ state: READY, request: () => {} }),
}))
vi.mock('../src/hooks/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../src/hooks/useLiveNearby', () => ({ useLiveNearby: () => ({ now: NOW }) }))
vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getNearby: () => nearby(),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

const { Nearby } = await import('../src/screens/Nearby')

let container: HTMLElement
let root: Root | null = null
let client: QueryClient | null = null

/** Renders nothing; exists so a test can invalidate the screen's own query from outside it. */
function Grab() {
  client = useQueryClient()
  return null
}

function text(): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) out.push(value)
    node = walker.nextNode()
  }
  return out
}

function mount() {
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <QueryProvider>
          <Grab />
          <Nearby />
        </QueryProvider>
      </MemoryRouter>,
    )
  })
}

/** Real time in 50 ms slices, flushing React between each — see `query-failure-state.test.tsx`. */
async function tick(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
}

/**
 * Tick until `phrase` is on screen, and fail naming what was there instead.
 *
 * Used for the *arrange* half of the last case, so that a slow first fetch cannot be mistaken for the
 * regression it is arranging — a fixed wait there reported "the list is missing" for a list that had
 * simply not arrived yet, which is the difference between testing the screen and testing the scheduler.
 */
async function tickUntil(phrase: string, maxMs = 3_000) {
  for (let elapsed = 0; elapsed < maxMs; elapsed += 50) {
    if (text().includes(phrase)) return
    await tick(50)
  }
  throw new Error(`never rendered ${JSON.stringify(phrase)} — text: ${JSON.stringify(text())}`)
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
  nearby = () => Promise.resolve([])
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  setVisibility('visible')
  act(() => {
    onlineManager.setOnline(true)
  })
})

const OFFLINE = () => Promise.reject(new TypeError('Failed to fetch'))
const NO_SERVICE = t(LOCALE, 'noService')
const LOCATING = t(LOCALE, 'locating')

describe('Nearby never says "no service" out of its own silence', () => {
  it('says so when the edge really did answer with nothing', async () => {
    // The control, and it is the assertion that makes every `not.toContain` below mean something: the
    // sentence is still reachable, and still the right thing to say, when the list is genuinely empty.
    nearby = () => Promise.resolve([])
    mount()
    await tick(400)
    expect(text()).toContain(NO_SERVICE)
  })

  it('does not, when the browser believes it is offline and nothing is cached', async () => {
    nearby = OFFLINE
    mount()
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await tick(2_000)
    expect(text()).not.toContain(NO_SERVICE)
    // And it says the true thing instead: the fetch was attempted and failed, which is the spec's
    // `failed` state — the one ADR-079's error-only `refetchInterval` recovers from.
    expect(text()).toContain('Failed to fetch')
  })

  it('does not, while a hidden document has the retry parked', async () => {
    // `isLoading` is false here (nothing is fetching) and `isError` is false (the retry has not given up),
    // so the old branch fell straight through to the list with an empty `cards`. The wait is real, so the
    // skeleton is the honest arm.
    setVisibility('hidden')
    nearby = OFFLINE
    mount()
    await tick(1_500)
    expect(text()).not.toContain(NO_SERVICE)
    expect(text()).toContain(LOCATING)
  })

  it('keeps the last known list when a refresh fails, rather than replacing it with the reason', async () => {
    // ADR-058's `offline` state. `networkMode: 'always'` makes this reachable where a paused refetch used
    // to hide it, so the error arm has to be the one that fires **only when there is nothing else**.
    const stops = fromCorpus<NearbyStop[]>(CASE.args.stops)
    const expected = fromCorpus<StopCardView[]>(CASE.expect)
    // `StopCardView.name` is already resolved to the active locale by `nearbyView` — `{ label, code }`,
    // not an `I18nText`. The label is what the card renders as its heading.
    const heading = expected[0]?.name.label
    if (!heading) throw new Error('the nearbyView corpus case has no cards')
    nearby = () => Promise.resolve(stops)
    mount()
    await tickUntil(heading)

    nearby = OFFLINE
    await act(async () => {
      await client?.invalidateQueries({ queryKey: ['nearby'] })
    })
    await tick(2_000)

    expect(text()).toContain(heading)
    expect(text()).not.toContain('Failed to fetch')
    expect(text()).not.toContain(NO_SERVICE)
  })
})
