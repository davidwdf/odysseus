// The DOM renderer's Home conformance suite: it drives the published spec (ADR-177/180) —
// `packages/contract/ui/home.spec.json`, eleven states, all eleven projected.
//
// WHAT IS DIFFERENT ABOUT THIS SCREEN
// Nearby and Favourites each had states that were only ever describing their own ignorance of the other
// half — Nearby's four location branches, Favourites' `empty`. Home has neither, and **that is what this
// suite exists to hold**: `noPosition`, `noSaved` and `denied` are asserted as *content* states, each
// drawn with a full board of the other half, and a regression that turned any of them back into an
// apology fails here rather than being noticed by a rider.
//
// THE SEAMS ARE MOCKED; THE SCREEN, THE STORE AND THE QUERIES ARE REAL. `useLocation`, `useLiveNearby`,
// `useClientPolicy` and the `DataSource` are replaced — the four seams the screen reads the world
// through. TanStack Query is not: `loading`, `failed` and the incremental arrival of saved cards *are*
// its states. Nor is the preferences store, because what a rider saved is this screen's input.
//
// THE FIXTURES ARE THE `homeView` CORPUS'S OWN CASES, so this suite's goldens are the kernel's bytes.

import homeSpec from '@nextbus/contract/ui/home.spec.json'
import stopRowSpec from '@nextbus/contract/ui/stop-row.spec.json'
import {
  type BoardPlace,
  CLIENT_POLICY_DEFAULTS,
  feedNotice,
  homeView,
  type Locale,
  newestNearbyBoard,
  newestPlaceBoard,
  type StopDetail,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/home.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
import {
  type ComponentSpec,
  conformStates,
  type RenderedTree,
  type StatefulHarness,
} from '@nextbus/ui-spec'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

interface CorpusCase {
  name: string
  args: {
    saved: string[]
    places: StopDetail[]
    nearby: BoardPlace[]
    locale: Locale
    now: string
    at?: { lat: number; lng: number }
  }
}
const CASES = corpus.groups.homeView.cases as unknown as CorpusCase[]

/** The corpus case each state is driven from. A missing one throws — never a silently skipped state. */
const FIXTURE: Record<string, string> = {
  content: 'a-saved-place-is-never-demoted-for-being-distant',
  catchable: 'the-band-is-tight-when-the-walk-nearly-eats-the-arrival',
  noSaved: 'nothing-saved-is-the-nearby-list-and-nothing-else',
  noPosition: 'no-fix-is-the-saved-list-and-nothing-else',
  stale: 'a-saved-place-is-never-demoted-for-being-distant',
  offline: 'a-saved-place-is-never-demoted-for-being-distant',
}

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the homeView corpus case \`${name}\` moved`)
  return found
}

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

// ── the four seams ─────────────────────────────────────────────────────────────────────────────

let locationState: LocationState = { status: 'loading' }
let board: () => Promise<BoardPlace[]> = () => Promise.resolve([])
let stop: (id: string) => Promise<StopDetail> = () => Promise.reject(new Error('no fixture set'))
let clock = 0

vi.mock('../src/hooks/useLocation', () => ({
  useLocation: () => ({ state: locationState, request: () => {} }),
}))
vi.mock('../src/hooks/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
// The subscription is a seam of its own, and the clock comes out of it — pinned to the corpus case's
// `now` so every readout in the expected view is the corpus's rather than the wall clock's.
vi.mock('../src/hooks/useLiveNearby', () => ({ useLiveNearby: () => ({ now: clock }) }))
vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getBoard: () => board(),
    getStop: (id: string) => stop(id),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

const { Home } = await import('../src/screens/Home')
const { usePreferences } = await import('../src/lib/preferences')

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
  const read = t as unknown as (l: Locale, k: MessageKey, a?: Record<string, unknown>) => string
  return read(LOCALE, key as MessageKey, args)
}

function mount(): RenderedTree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <Home />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
  return readTree(container)
}

/**
 * Mount, then wait — bounded — until the skeleton has gone.
 *
 * The condition is the skeleton's *element* rather than the presence of text: this screen always draws
 * its heading, so "has any text" would return on the first frame with nothing else settled. Each screen's
 * loading state needs its own condition, which is the lesson WP6-2 and WP6-3b each learnt once — *a
 * harness that looks at the wrong moment is indistinguishable from a renderer that is wrong.*
 */
async function mountSettled(): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!container.querySelector('.animate-pulse')) return readTree(container)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`the screen never settled — text: ${JSON.stringify(readTree(container).text)}`)
}

const FETCH_FAILURE = 'unknown board: 22.3,114.2'

/** jsdom's `navigator.onLine` is a prototype getter, so the state a screen reads is set by redefining it. */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

const READY = (at: { lat: number; lng: number }): LocationState => ({
  status: 'ready',
  lat: at.lat,
  lng: at.lng,
})

/** The view the screen must end up drawing, built from the same kernel call the screen makes. */
function expectedView(c: CorpusCase, now: number, online: boolean) {
  const places = fromCorpus<StopDetail[]>(c.args.places)
  const nearby = fromCorpus<BoardPlace[]>(c.args.nearby)
  const sections = homeView(
    { saved: c.args.saved, places, nearby, ...(c.args.at ? { at: c.args.at } : {}) },
    { locale: LOCALE, now, policy: CLIENT_POLICY_DEFAULTS },
  )
  const a = newestNearbyBoard(nearby)
  const b = newestPlaceBoard(places)
  return {
    // The three sections, separately — the spec declares a heading immediately before *its own* board,
    // which is the shape of the screen. A flattened `cards` made the walker expect one list under two
    // headings and report the first place name where the second heading should be.
    catch: sections.catch,
    saved: sections.saved,
    nearby: sections.nearby,
    notice: feedNotice({
      lastUpdatedIso: a === null ? b : b === null ? a : a > b ? a : b,
      now,
      online,
      trouble: 'none',
      staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
    }),
  }
}

/** How this renderer is put into each declared state. */
async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  if (state === 'cold') {
    // No position, nothing saved — a cold install, and the only genuinely empty state left.
    locationState = { status: 'undetermined' }
    usePreferences.setState({ favoriteRoutes: [] })
    return { view: {}, tree: mount() }
  }
  if (state === 'denied') {
    locationState = { status: 'denied', canAskAgain: false }
    usePreferences.setState({ favoriteRoutes: [] })
    return { view: {}, tree: mount() }
  }
  if (state === 'loading') {
    const c = caseNamed(FIXTURE.content as string)
    clock = Date.parse(c.args.now)
    locationState = READY(c.args.at as { lat: number; lng: number })
    usePreferences.setState({ favoriteRoutes: [...c.args.saved] })
    board = () => new Promise<BoardPlace[]>(() => {})
    stop = () => new Promise<StopDetail>(() => {})
    return { view: {}, tree: mount() }
  }
  if (state === 'failed') {
    const c = caseNamed(FIXTURE.content as string)
    clock = Date.parse(c.args.now)
    locationState = READY(c.args.at as { lat: number; lng: number })
    usePreferences.setState({ favoriteRoutes: [] })
    board = () => Promise.reject(new Error(FETCH_FAILURE))
    return { view: { error: FETCH_FAILURE }, tree: await mountSettled() }
  }
  if (state === 'empty') {
    // A fix, nothing saved, and nothing within the radius. No boards at all, so the notice is silent —
    // a screen with nothing to report its freshness *about* must not say "last updated".
    const c = caseNamed(FIXTURE.content as string)
    clock = Date.parse(c.args.now)
    locationState = READY(c.args.at as { lat: number; lng: number })
    usePreferences.setState({ favoriteRoutes: [] })
    board = () => Promise.resolve([])
    return {
      view: {
        cards: [],
        notice: feedNotice({
          lastUpdatedIso: null,
          now: clock,
          online: true,
          trouble: 'none',
          staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
        }),
      },
      tree: await mountSettled(),
    }
  }

  const name = FIXTURE[state]
  if (name === undefined) return null
  const c = caseNamed(name)
  const places = fromCorpus<StopDetail[]>(c.args.places)
  const nearby = fromCorpus<BoardPlace[]>(c.args.nearby)

  // `stale` and `offline` are the `content` fixture with one thing changed — the clock, or the platform's
  // network. That is exactly the claim: the cards are the same cards, and one sentence tells them apart.
  const now =
    state === 'stale'
      ? Date.parse(c.args.now) + CLIENT_POLICY_DEFAULTS.staleAfterMs + 1_000
      : Date.parse(c.args.now)
  const online = state !== 'offline'
  setOnline(online)
  clock = now
  vi.spyOn(Date, 'now').mockReturnValue(now)

  // `noPosition` is the case with no `at` in the corpus, so the location seam follows the fixture rather
  // than being set independently — which is what keeps the golden and the screen looking at one world.
  // `stale` is a *remembered* fix, not merely an old board — the flag is what the screen reads, and
  // without it the state was indistinguishable from `content` with a late clock.
  locationState =
    c.args.at === undefined
      ? { status: 'undetermined' }
      : { ...READY(c.args.at), ...(state === 'stale' ? { stale: true } : {}) }
  usePreferences.setState({ favoriteRoutes: [...c.args.saved] })
  board = () => Promise.resolve(nearby)
  // Every saved pole of these fixtures resolves to the same place document: `getStop` promotes a member
  // id to its place, which is the shape the corpus records.
  stop = () => (places[0] ? Promise.resolve(places[0]) : Promise.reject(new Error('no place')))

  return { view: expectedView(c, now, online), tree: await mountSettled() }
}

beforeEach(() => {
  vi.restoreAllMocks()
  locationState = { status: 'loading' }
  board = () => Promise.resolve([])
  stop = () => Promise.reject(new Error('no fixture set'))
  clock = 0
  // Restored per test: `offline` redefines it, and a leaked `false` would add a sentence to every state
  // that ran after it — the sort of cross-test leak that reads as a renderer bug.
  setOnline(true)
  usePreferences.setState({ favoriteRoutes: [] })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to Home’s published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    // The anti-vacuous control. A spec whose states were all `unenforced`, or a driver silently missing
    // fixtures, would both make the run below assert nothing.
    expect(homeSpec.component).toBe('Home')
    expect(Object.keys(homeSpec.states).length).toBeGreaterThanOrEqual(11)
    expect(CASES.length).toBeGreaterThanOrEqual(8)
  })

  // One `it` per state, so a failure names the state rather than the suite.
  for (const state of Object.keys(homeSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      // **The imported spec is cast, and that is not a loosening.** A `.spec.json` is validated against
      // `ComponentSpecSchema` when it is *emitted* — `pnpm test` in `packages/contract` fails on a file that
      // does not parse — so the schema is the gate and TypeScript's inference of a JSON literal is not. That
      // inference also cannot see through a discriminated node (`oneOf` with a case that draws nothing), which
      // is a real shape in `stop-row.spec.json` since ADR-177's catchability marker.
      const findings = conformStates(homeSpec as ComponentSpec, harness, {
        StopRow: stopRowSpec as ComponentSpec,
      }).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings.map((f) => f.message)).toEqual([])
    })
  }

  // The claim the merge is *for*, restated as the thing a reader cares about: the three states that used
  // to be apologies now carry a board. A structural regression here is a rider losing half the screen.
  it('draws a full board in the three states that used to be apologies', async () => {
    for (const state of ['noSaved', 'noPosition'] as const) {
      const rendered = await fixture(state)
      if (!rendered) throw new Error(`no fixture for ${state}`)
      const v = rendered.view as { catch?: unknown[]; saved?: unknown[]; nearby?: unknown[] }
      const cards = [...(v.catch ?? []), ...(v.saved ?? []), ...(v.nearby ?? [])]
      expect(cards.length, `${state} has nothing to show`).toBeGreaterThan(0)
      // And it is content, not an empty state: the old screens' own "nothing here" copy is absent.
      expect(rendered.tree.text).not.toContain(translate('favoritesEmpty'))
      expect(rendered.tree.text).not.toContain(translate('noService'))
    }
  })
})
