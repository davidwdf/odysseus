// @vitest-environment jsdom
//
// **The RN half of `apps/web/test/nearby-offline.test.tsx`** — the same four claims, driven through
// `apps/mobile`'s own screen and its own provider.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE DOM ONE. ADR-124 landed with a regression suite on `apps/web`
// only, because the agent that fixed it owned that app. That is ADR-069's asymmetry pointed the wrong way
// again — `apps/mobile` is the app riders use today, and it carries the identical `isPending` edit — so the
// claim is measured on both renderers or it is measured on the one that has not shipped.
//
// WHAT IS BEING MEASURED. TanStack **parks** a fetch in two ways, and a parked query is `isLoading === false`
// *and* `isError === false`, so a screen branching on `isLoading` falls through to its list arm and prints
// `nearbyView([])`'s empty result as **"No scheduled service"** — our silence rendered as a claim about Hong
// Kong (ADR-073's conflation, one layer up). The two gates:
//
//  · **`networkMode`** — `'online'` refuses to run the query at all while `onlineManager` says the device is
//    offline. Fixed at the provider: both apps are `networkMode: 'always'`, bound together by
//    `apps/web/test/shell-parity.test.ts`.
//  · **the focus gate** — `retryer.canContinue()` ANDs `focusManager.isFocused()`, so a retry scheduled while
//    `document.visibilityState === 'hidden'` waits for `visibilitychange`. Deliberately kept, which is why
//    the *screen* must be honest: branch on `isPending` (status alone) and let the skeleton be the fallback.
//
// MIRRORED ASSERTIONS, NOT MIRRORED MECHANICS. The DOM suite mounts the real `QueryProvider` and nothing
// else; this one must also replace the environment Metro would supply — the six mocks `docs/11` records for
// the RN screen suites (`useLocation`, `useClientPolicy`, `useLiveNearby`, the `DataSource`, plus
// `expo-router` and the safe-area context, with `useLocale` pinned because `expo-localization` reaches
// `__DEV__`) and a **seventh** here: AsyncStorage, which the RN provider persists through. Each is the
// smallest thing the screen or provider actually uses, and none of them touches the two pause gates, which
// are `QueryClient` and `focusManager` behaviour and are therefore the app's real ones.

import {
  CLIENT_POLICY_DEFAULTS,
  type Locale,
  type NearbyStop,
  type StopCardView,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
import { onlineManager, type QueryClient, useQueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

const found = corpus.groups.nearbyView.cases.find((c) => c.args.stops.length > 0)
if (!found) throw new Error('the nearbyView corpus group moved')
// Re-bound after the guard rather than narrowed through it — `apps/mobile` resolves TypeScript 6.0.3, which
// does not carry the narrowing from a module-level throw into a nested closure (ADR-069's finding).
const CASE = found
const NOW = Date.parse(CASE.args.now)

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

const READY: LocationState = { status: 'ready', lat: 22.38, lng: 114.19, stale: false }

let nearby: () => Promise<NearbyStop[]> = () => Promise.resolve([])

vi.mock('../lib/useLocation', () => ({
  useLocation: () => ({ state: READY, request: () => {} }),
}))
vi.mock('../lib/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../lib/useLiveNearby', () => ({ useLiveNearby: () => ({ now: NOW }) }))
vi.mock('../lib/datasource', () => ({
  dataSource: { getNearby: () => nearby(), getClientPolicy: () => Promise.resolve(undefined) },
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => 'en' }))
// **The seventh mock, and the only one this file adds to the six the other RN suites need.** The provider
// under test persists through `AsyncStorage`, whose entry point reaches the `RCTAsyncStorage` native module —
// absent here, as it would be in any non-Metro environment. An in-memory map is the honest substitution: what
// is under test is which *branch the screen draws*, and the persisted-cache policy (ADR-058) is asserted
// where a cold start is measurable, in `apps/web/test/shell.test.tsx`.
/**
 * The store behind the mock below, **declared out here so `beforeEach` can empty it**.
 *
 * Learnt the hard way, and it is the RN-specific half of this file: with the map hidden inside the mock
 * factory it outlived every test in the file, so the first test's successful `[]` was *persisted*, restored
 * into the next mount, and — inside a 15 s `staleTime` — never refetched. Three tests then failed for a
 * reason that had nothing to do with the screen, and the offline one "reproduced" nothing at all. The DOM
 * suite gets this for free: its persister is `localStorage`, which `beforeEach` already clears.
 */
const persisted = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(persisted.get(key) ?? null),
    setItem: (key: string, value: string) => {
      persisted.set(key, value)
      return Promise.resolve()
    },
    removeItem: (key: string) => {
      persisted.delete(key)
      return Promise.resolve()
    },
  },
}))

const Nearby = (await import('../app/(tabs)/index')).default
const { QueryProvider } = await import('../providers/QueryProvider')

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

function translate(key: string): string {
  if (!(key in CATALOGUE)) {
    throw new Error(`\`${key}\` is not in @nextbus/i18n's catalogue`)
  }
  return (t as unknown as (locale: Locale, key: MessageKey) => string)(LOCALE, key as MessageKey)
}

function mount() {
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryProvider>
        <Grab />
        <Nearby />
      </QueryProvider>,
    )
  })
}

/**
 * Real time in 50 ms slices, flushing React between each.
 *
 * Real timers rather than fake ones, and the slicing is the load-bearing part: the retryer's delay is a
 * `setTimeout` **outside** React, so one long awaited `act()` leaves its continuation queued behind the act
 * scope and the healthy case looks like a permanent wait. Copied from `apps/web/test/query-failure-state.test.tsx`,
 * where the mistake was made and diagnosed once already.
 */
async function tick(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
}

/** Tick until `phrase` is on screen, and fail naming what was there instead. */
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
  // Both persisters, because a cache surviving into the next test is a cold start it never asked for — see
  // `persisted` above for the three failures that bought this line.
  localStorage.clear()
  persisted.clear()
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
  // `onlineManager` and `focusManager` are module singletons shared by every suite in this process, so a test
  // that flips one and does not put it back leaks into the next file. `setOnline` rather than an `online`
  // event, because `onlineManager` detaches its window listeners once the last `QueryClient` unmounts.
  setVisibility('visible')
  act(() => {
    onlineManager.setOnline(true)
  })
})

const OFFLINE = () => Promise.reject(new TypeError('Failed to fetch'))
const NO_SERVICE = translate('noService')
const LOCATING = translate('locating')

describe('the RN Nearby never says "no service" out of its own silence', () => {
  it('says so when the edge really did answer with nothing', async () => {
    // The control that makes every `not.toContain` below mean something: the sentence is still reachable, and
    // still the right thing to say, when the list is genuinely empty.
    nearby = () => Promise.resolve([])
    mount()
    await tick(400)
    expect(text()).toContain(NO_SERVICE)
  })

  it('does not, when the device believes it is offline and nothing is cached', async () => {
    nearby = OFFLINE
    mount()
    act(() => {
      onlineManager.setOnline(false)
    })
    await tick(2_000)
    expect(text()).not.toContain(NO_SERVICE)
    // And it says the true thing instead — the fetch was attempted and failed, which is the spec's `failed`
    // state and the only one ADR-079's error-path `refetchInterval` can recover from. Under `networkMode:
    // 'online'` this request would never have been made at all.
    expect(text()).toContain('Failed to fetch')
  })

  it('does not, while a hidden document has the retry parked', async () => {
    // The gate that is still live by design. `isLoading` is false (nothing is fetching) and `isError` is
    // false (the retry has not given up), so the old branch fell straight through to the list with an empty
    // `cards`. The wait is real, so the skeleton — labelled "Locating…" on this renderer — is the honest arm.
    setVisibility('hidden')
    nearby = OFFLINE
    mount()
    await tick(1_500)
    // **The state itself, asserted, so this test cannot pass vacuously.** If the focus gate ever stopped
    // parking the retry — a library change, or a jsdom that reports the document visible — the query would
    // settle on `error`, the screen would honestly show the reason, and the two assertions below would still
    // both hold while measuring nothing. `paused` with one failure on record *is* the state `isLoading` calls
    // false, which is the whole reason the branch is on `isPending`.
    const parked = client?.getQueryState(['nearby', READY.lat, READY.lng])
    expect(parked?.status).toBe('pending')
    expect(parked?.fetchStatus).toBe('paused')
    expect(parked?.fetchFailureCount).toBe(1)
    expect(text()).not.toContain(NO_SERVICE)
    expect(text()).toContain(LOCATING)
  })

  it('keeps the last known list when a refresh fails, rather than replacing it with the reason', async () => {
    // ADR-058's `offline` state, and the one the fix could have broken: `networkMode: 'always'` makes a cold
    // offline start with a restored cache reach `error` **with data**, where before it merely paused — so an
    // error arm firing on `isError` alone would replace the replayed list with a sentence, which the spec's
    // `offline` state forbids in as many words ("never a blank list").
    const stops = fromCorpus<NearbyStop[]>(CASE.args.stops)
    const expected = fromCorpus<StopCardView[]>(CASE.expect)
    // `StopCardView.name` is already resolved to the active locale by `nearbyView` — `{ label, code }`, not
    // an `I18nText`. The label is what the card renders as its heading.
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
