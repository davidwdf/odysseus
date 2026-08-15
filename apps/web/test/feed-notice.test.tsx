// **The arm no conformance state can drive: our own edge is unreachable while the screen still has data**
// (ADR-133's `unreachable`, wired on every screen by ADR-150).
//
// WHY IT NEEDS ITS OWN SUITE. A screen spec's states are driven from corpus fixtures, and `trouble` is not a
// property of any fixture: it is the state of the *last request*, which only the renderer's own query
// machinery knows. `stale` and `offline` are reachable from a fixture plus a clock or a platform flag, so
// they are declared and projected. This one is reachable only by letting a real fetch fail while a real cache
// holds an answer — which is also exactly the situation it exists for: **the Worker is down and the rider is
// still looking at the last thing we knew.**
//
// THE STATE IT MUST NOT BECOME. A failure with data on screen is not a failed screen. Nearby shows its error
// text only when `query.data === undefined`, so this pairing — cards *and* a sentence — is the one a rider
// gets, and it is the arm that separates "we cannot reach us" from "you are offline": the first is ours to
// fix and the second is theirs, and ADR-133's precedence puts the rider's own network first because it
// explains ours.

import {
  CLIENT_POLICY_DEFAULTS,
  type Locale,
  type NearbyStop,
  newestNearbyBoard,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { t } from '@nextbus/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

const CASE = corpus.groups.nearbyView.cases.find((c) => c.args.stops.length > 0)
if (!CASE) throw new Error('the nearbyView corpus group moved')
const FIXTURE = CASE
const NOW = Date.parse(FIXTURE.args.now)
const READY = { status: 'ready', lat: 22.38, lng: 114.19, stale: false } as const

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

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

/**
 * Mount with the cache already holding the fixture, then let the refetch fail.
 *
 * Seeding the cache is what makes this the *real* pairing rather than a contrived one: it is what ADR-058's
 * persisted cache does on a cold start, and what a successful earlier round leaves behind. The query then has
 * `data` **and** `error`, which is the branch the screen was written for and the only one `trouble` reaches.
 *
 * **It settles on the rendered tree, not on the query, and the first draft got that wrong.** Waiting for
 * `fetchStatus: 'idle'` returns on the tick the query *settles*, which is one flush before the observer has
 * re-rendered the screen — so the assertion read a tree with the cards and no sentence and reported a
 * renderer that was working correctly as broken. It passed on the first run and failed on the next, which is
 * the signature. This repo's own advice, from two earlier instances: *a harness that looks at the wrong
 * moment is indistinguishable from a renderer that is wrong* — so the condition has to be the thing under
 * test, and the failure has to print what it actually found.
 */
async function mountWithCachedData(opts: {
  fail: boolean
  until: (shown: string[]) => boolean
}): Promise<string[]> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const stops = fromCorpus<NearbyStop[]>(FIXTURE.args.stops)
  client.setQueryData(['nearby', READY.lat, READY.lng], stops)
  nearby = opts.fail
    ? () => Promise.reject(new Error('nearby: 502 upstream'))
    : () => Promise.resolve(stops)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Nearby />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
  let shown = text()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const settled = client.getQueryState(['nearby', READY.lat, READY.lng])?.fetchStatus === 'idle'
    shown = text()
    if (settled && opts.until(shown)) return shown
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`the screen never reached the state under test — text: ${JSON.stringify(shown)}`)
}

beforeEach(() => {
  // React 19 only flushes inside `act` when the environment says so, and without it the assertions read a
  // tree from before the refetch settled — a suite that tests the scheduler rather than the screen.
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  nearby = () => Promise.resolve([])
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
})

describe('the freshness notice’s `unreachable` arm, which no fixture can carry', () => {
  it('says we cannot be reached, and keeps the cards', async () => {
    const shown = await mountWithCachedData({
      fail: true,
      until: (drawn) => drawn.includes(t(LOCALE, 'feedUnreachable')),
    })
    expect(shown).toContain(t(LOCALE, 'feedUnreachable'))
    // The whole point of the arm: the last known list is still there. A screen that replaced its cards with
    // the reason would be the `offline` state's own `mustNot`, and ADR-073's rule broken from the other side.
    expect(shown.some((line) => line.includes('Belair Garden'))).toBe(true)
    // And not the rider's own network, which is the sentence with the opposite owner.
    expect(shown).not.toContain(t(LOCALE, 'feedOffline'))
  })

  it('says nothing at all once the same request succeeds', async () => {
    // The settled condition here is the *cards*, not a sentence: the whole assertion is that no sentence
    // ever appears, so waiting for one would either hang or pass vacuously.
    const shown = await mountWithCachedData({
      fail: false,
      until: (drawn) => drawn.some((line) => line.includes('Belair Garden')),
    })
    for (const key of ['feedUnreachable', 'feedOffline'] as const) {
      expect(shown).not.toContain(t(LOCALE, key))
    }
    // Nor the freshness line: these boards are seconds old on the corpus's own clock. A notice that fires
    // while everything works is one riders learn to ignore before the day it matters (ADR-122).
    expect(shown).not.toContain(
      t(LOCALE, 'feedLastUpdated', {
        time: '00:00',
      }),
    )
    expect(shown.some((line) => line.startsWith('Last updated'))).toBe(false)
  })

  it('reads the board’s own clock, not the moment we fetched it', () => {
    // The reason `newestNearbyBoard` exists rather than a `.map` in each screen. `observedAt` is stamped by
    // our own layer on every fetch, so a screen that read it would say "last updated" about a feed that had
    // stopped publishing hours ago. Asserted here against the *fixture* rather than only in the corpus,
    // because this is the file a reader lands on when the sentence looks wrong.
    const stops = fromCorpus<NearbyStop[]>(FIXTURE.args.stops)
    const boards = stops.flatMap((stop) => stop.etas.map((eta) => eta.dataTimestamp))
    expect(boards.length, 'the fixture has no boards to choose between').toBeGreaterThan(0)
    const newest = newestNearbyBoard(stops)
    expect(newest).not.toBeNull()
    for (const board of boards) {
      expect(Date.parse(newest as string)).toBeGreaterThanOrEqual(Date.parse(board))
    }
  })
})
