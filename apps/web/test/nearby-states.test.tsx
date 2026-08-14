// The DOM renderer's **screen** conformance suite: it drives `Nearby`'s published spec (WP6-2, ADR-084).
//
// WHAT THIS ADDS OVER THE CARD SUITE
// `nearby-projection.test.tsx` holds one component to a projection of one view model. A screen's states are
// not fields of a view model at all — they are branches over an async status: no fix yet, permission
// refused, a remembered position rather than a live one, the first fetch in flight, the fetch failed. The
// only way to hold a renderer to those is to **put it in each state and read the text back**, which is why
// the spec declares a projection per state and this file is the half that knows how to get there.
//
// THE SEAMS ARE MOCKED; THE SCREEN AND THE QUERY ARE REAL
// `useLocation`, `useLiveNearby`, `useClientPolicy` and the `DataSource` are replaced — they are the four
// seams the screen reads the world through. **TanStack Query is not**, deliberately: `loading`, `failed`
// and `content` *are* its states, and mocking `useQuery` would mean asserting against a mock of the thing
// under test. So the fetch is driven by resolving or rejecting the mocked data source and letting the real
// query machinery arrive at the branch.
//
// THE FIXTURES COME FROM THE CORPUS, so the golden cannot drift from what the kernel produces:
// `stop-card.spec.json`'s `nearbyView` group supplies both the `NearbyStop[]` the data source returns and
// the `StopCardView[]` the screen must end up drawing, with `now` pinned to the case's own clock.

import specs from '@nextbus/contract/ui/nearby.spec.json'
import stopRowSpec from '@nextbus/contract/ui/stop-row.spec.json'
import {
  CLIENT_POLICY_DEFAULTS,
  feedNotice,
  type Locale,
  type NearbyStop,
  newestNearbyBoard,
  type StopCardView,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

/** The corpus case a state is driven from. `now` is the case's own clock, so the readouts are its goldens. */
const NEARBY_CASES = corpus.groups.nearbyView.cases
const found = {
  withStops: NEARBY_CASES.find((c) => c.args.stops.length > 0),
  withoutStops: NEARBY_CASES.find((c) => c.args.stops.length === 0),
}
if (!found.withStops || !found.withoutStops) throw new Error('the nearbyView corpus group moved')
// Re-bound after the guard rather than narrowed through it: `apps/mobile` resolves **TypeScript 6.0.3**
// while every other package is on 5.9.3 (ADR-069's incidental finding), and 6.0 does not carry the
// narrowing from a module-level throw into a nested closure. Two `const`s cost nothing and compile on both.
const WITH_STOPS = found.withStops
const WITHOUT_STOPS = found.withoutStops

const NOW = Date.parse(WITH_STOPS.args.now)

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

// ── the four seams ─────────────────────────────────────────────────────────────────────────────

let locationState: LocationState = { status: 'loading' }
let nearby: () => Promise<NearbyStop[]> = () => Promise.resolve([])

vi.mock('../src/hooks/useLocation', () => ({
  useLocation: () => ({ state: locationState, request: () => {} }),
}))
vi.mock('../src/hooks/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
// The subscription is a seam of its own, and the clock comes out of it — pinned here to the corpus case's
// `now` so every ETA readout in the expected view is the corpus's rather than the wall clock's.
vi.mock('../src/hooks/useLiveNearby', () => ({ useLiveNearby: () => ({ now: NOW }) }))
vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getNearby: () => nearby(),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

// Imported after the mocks are declared — `vi.mock` is hoisted, but the intent is clearer stated.
const { Nearby } = await import('../src/screens/Nearby')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const text: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) text.push(value)
    node = walker.nextNode()
  }
  const interactive = [...host.querySelectorAll(INTERACTIVE)]
  return {
    text,
    interactive: interactive.length,
    nestedInteractive: interactive.filter((el) => el.parentElement?.closest(INTERACTIVE)).length,
  }
}

function translate(key: string, args?: Record<string, unknown>): string {
  if (!(key in CATALOGUE)) {
    throw new Error(`the spec names message \`${key}\`, which is not in @nextbus/i18n's catalogue`)
  }
  const read = t as unknown as (
    locale: Locale,
    key: MessageKey,
    args?: Record<string, unknown>,
  ) => string
  return read(LOCALE, key as MessageKey, args)
}

/** Mount the screen and let the query settle. Synchronous inside `act`, so the tree is final when it returns. */
function mount(): RenderedTree {
  const client = new QueryClient({
    // No retries: a `failed` state that retried three times before settling would make this suite slow and
    // its failures ambiguous. The screen's *own* error-path refetch is `refetchInterval`, which is what
    // ADR-079 fixed and what a fake timer would be needed to observe — not this file's subject.
    defaultOptions: { queries: { retry: false } },
  })
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Nearby />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
  return readTree(container)
}

/**
 * Mount, then wait until the screen has actually left its loading branch.
 *
 * A fixed number of microtask flushes is what the first draft did, and it was **wrong in the way that
 * matters**: two of the states read their tree while the screen was still showing "locating", so the suite
 * reported a divergence at index 2 rather than the state it was asked about. Polling for the transition —
 * bounded, and failing loudly with the text it actually found — is the difference between a suite that
 * tests the state and one that tests the scheduler.
 */
async function mountSettled(): Promise<RenderedTree> {
  mount()
  const locating = translate('locating')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tree = readTree(container)
    if (!tree.text.includes(locating)) return tree
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(
    `the screen never left its loading state — text: ${JSON.stringify(readTree(container).text)}`,
  )
}

const READY = { status: 'ready', lat: 22.38, lng: 114.19, stale: false } as const
const FETCH_FAILURE = 'nearby: 502 upstream'

/**
 * The freshness notice the screen will have computed for these stops — the same kernel call it makes, over
 * the same clock and the same policy (ADR-150).
 *
 * The driver **computes** it rather than restating the sentence, for the reason every other fixture here
 * computes its cards: a golden written by hand is a second specification, and this one would drift the first
 * time the precedence changed. What keeps it from being circular is that the screen's inputs are not the
 * driver's — the screen reads its boards out of the query cache the subscription writes to, and reads the
 * network off the platform.
 */
function noticeFor(stops: readonly NearbyStop[], opts: { online: boolean }) {
  return feedNotice({
    lastUpdatedIso: newestNearbyBoard(stops),
    now: NOW,
    online: opts.online,
    trouble: 'none',
    staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
  })
}

/** jsdom's `navigator.onLine` is a prototype getter, so the state a screen reads is set by redefining it. */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

/**
 * How this renderer is put into each declared state, and the view each corresponds to.
 *
 * Every state the spec projects has a case here; `default` returns `null` only for states this screen does
 * not declare, and `conformStates` treats an unreachable projected state as a finding rather than a skip.
 */
async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  const cards = fromCorpus<StopCardView[]>(WITH_STOPS.expect)
  const stops = fromCorpus<NearbyStop[]>(WITH_STOPS.args.stops)
  const notice = noticeFor(stops, { online: true })
  switch (state) {
    case 'undetermined':
      locationState = { status: 'undetermined' }
      return { view: {}, tree: mount() }
    case 'denied':
      locationState = { status: 'denied', canAskAgain: false }
      return { view: {}, tree: mount() }
    case 'locationError':
      locationState = { status: 'error', message: 'no fix available' }
      return { view: { error: 'no fix available' }, tree: mount() }
    case 'loading':
      locationState = { status: 'loading' }
      return { view: {}, tree: mount() }
    case 'content':
      locationState = READY
      nearby = () => Promise.resolve(stops)
      return { view: { cards, notice }, tree: await mountSettled() }
    case 'stale':
      // The one difference from `content`, and the whole reason the subtitle is declared per state.
      locationState = { ...READY, stale: true }
      nearby = () => Promise.resolve(stops)
      return { view: { cards, notice }, tree: await mountSettled() }
    case 'offline':
      // **The state that could not be told from `stale` until ADR-150.** A remembered fix *and* no network:
      // the subtitle says where the list is anchored, the notice says the rider's own network is gone, and
      // the two sentences are the reason this state is projected at all now.
      setOnline(false)
      locationState = { ...READY, stale: true }
      nearby = () => Promise.resolve(stops)
      return {
        view: { cards, notice: noticeFor(stops, { online: false }) },
        tree: await mountSettled(),
      }
    case 'empty': {
      const none = fromCorpus<NearbyStop[]>(WITHOUT_STOPS.args.stops)
      locationState = READY
      nearby = () => Promise.resolve(none)
      // No boards at all, so the notice is silent — which is the honest answer and not an accident: a
      // screen with nothing to report its freshness *about* must not say "last updated" with nothing to
      // put after it.
      return {
        view: { cards: [], notice: noticeFor(none, { online: true }) },
        tree: await mountSettled(),
      }
    }
    case 'failed':
      locationState = READY
      nearby = () => Promise.reject(new Error(FETCH_FAILURE))
      return { view: { error: FETCH_FAILURE }, tree: await mountSettled() }
    default:
      return null
  }
}

beforeEach(() => {
  locationState = { status: 'loading' }
  nearby = () => Promise.resolve([])
  // Restored per test, because `offline` redefines it and a leaked `false` would silently add a sentence to
  // every state that ran after it — the sort of cross-test leak that reads as a renderer bug.
  setOnline(true)
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to Nearby’s published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    // The anti-vacuous control. A spec whose states were all `unenforced`, or a driver silently missing
    // fixtures, would both make the run below assert nothing — and `conformStates` reports the second as a
    // finding rather than a skip precisely because it is indistinguishable from a passing screen.
    expect(specs.component).toBe('Nearby')
    expect(Object.keys(specs.states).length).toBeGreaterThanOrEqual(8)
    expect(NEARBY_CASES.length).toBeGreaterThanOrEqual(3)
  })

  // One `it` per state, so a failure names the state rather than the suite.
  for (const state of Object.keys(specs.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      // Only this state is offered, so `conformStates` reports every *other* projected state as
      // unreachable — filter to the one under test. The loop as a whole covers them all, and the control
      // above is what keeps the set honest.
      const findings = conformStates(specs, harness, { StopRow: stopRowSpec }).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }

  it('says the position is remembered in `stale` and does not in `content`', () => {
    // The assertion the per-state loop makes structurally, restated as the thing a reader cares about:
    // ADR-008's honesty rule applies to the position, and the only thing that carries it is this sentence.
    expect(translate('lastKnownLocation')).not.toBe(translate('appName'))
  })
})
