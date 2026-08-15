// @vitest-environment jsdom
//
// The React Native Favourites screen's conformance suite: **the same published spec the DOM screen drives**
// (WP6-4b, ADR-090) —
// `packages/contract/ui/favourites.spec.json`, eight states, six of them projected.
//
// WHAT IS DIFFERENT ABOUT THIS SCREEN, AND IT CHANGES WHAT THE SUITE IS FOR
// Every other surface shows what the data says; this one shows what the *rider said*. So two of the states
// below are bugs this row closed rather than shapes it inherited — `quietRoute` (a saved route with no live
// reading contributed nothing, so a card could be a name with nothing under it) and `bothKerbs` (a line
// saved at two kerbs showed one row, hiding the other kerb's bus). Both were unenforceable from the card's
// own spec, which is the useful lesson: **a `mustNot` a component cannot satisfy is usually a statement
// about its producer.**
//
// THE SEAMS ARE MOCKED; THE SCREEN, THE STORE AND THE QUERIES ARE REAL. `useClientPolicy` and the
// `DataSource` are replaced, plus the platform modules jsdom has no answer for — `expo-router`'s navigation,
// the safe-area insets, the tab-bar layout and the locale provider. `useQueries` is not mocked: `loading`,
// `failed` and the incremental arrival of cards *are* its states. Nor is the preferences store — what a rider
// saved is this screen's input, so a mock of it would be a mock of the thing under test — and it persists
// through AsyncStorage here, which is why the store is reset per test rather than trusted.
//
// THE FIXTURES ARE THE CORPUS'S OWN `favouritesView` CASES, one per state, so this suite's goldens and the
// RN suite's are the same bytes and the same kernel call.

import favouritesSpec from '@nextbus/contract/ui/favourites.spec.json'
import stopRowSpec from '@nextbus/contract/ui/stop-row.spec.json'
import {
  CLIENT_POLICY_DEFAULTS,
  favouritesView,
  feedNotice,
  type Locale,
  newestPlaceBoard,
  type StopDetail,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/favourites.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

interface CorpusCase {
  name: string
  args: { saved: string[]; places: StopDetail[]; locale: Locale; now: string }
  expect: unknown
}

const CASES = corpus.groups.favouritesView.cases as unknown as CorpusCase[]

/** The corpus case each state is driven from. A missing one is a thrown error, never a skipped state. */
const FIXTURE: Record<string, string> = {
  content: 'two-saved-poles-of-one-place-are-one-card',
  quietRoute: 'a-saved-route-with-no-reading-is-still-a-row',
  bothKerbs: 'one-line-saved-at-two-kerbs-is-two-rows',
  // **The same payload as `content`, one whole stale window later on the clock** — the same fixture the DOM
  // suite uses, for the same reason: a synthetic view with `stale: true` set by hand would only prove that
  // the card draws a flag it was handed, where running `content`'s own readings past `staleAfterMs` proves
  // that the kernel's own rule fires through the identical call the screen makes.
  //
  // **What the projection differs by has changed twice, and the second time this fixture went dark.** It was
  // a 45 % fade (invisible to a text harness), then a `~` in front of each figure, and since ADR-123 the
  // readings carry no cue at all — so from ADR-123 until ADR-150 this state was `unenforced` in the spec and
  // this fixture ran for nothing. What it proves now is the screen's one line: `content` and `stale` are the
  // same cards, and the difference between them is a sentence (ADR-133).
  stale: 'two-saved-poles-of-one-place-are-one-card',
  // The same payload again, with the platform reporting no network — the state that was textually identical
  // to `content` until the notice existed.
  offline: 'two-saved-poles-of-one-place-are-one-card',
}

/**
 * How far past a case's own `now` the `stale` fixture's clock runs: one stale window and a second.
 *
 * Read from the policy rather than written as 121_000, so a served `staleAfterMs` that moves (ADR-122 moved
 * it once already, 90 s -> 120 s) moves this with it instead of leaving a fixture that no longer reaches the
 * state it is named after. That failure would be **silent**: a card with no mark still matches a projection
 * with no mark. The control at the bottom of this file is what makes it loud.
 */
const STALE_OFFSET_MS = CLIENT_POLICY_DEFAULTS.staleAfterMs + 1_000

/** The clock a state's fixture runs at - the case's own, except in `stale`. */
function clockFor(state: string, c: CorpusCase): number {
  return Date.parse(c.args.now) + (state === 'stale' ? STALE_OFFSET_MS : 0)
}

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the favouritesView corpus case \`${name}\` moved`)
  return found
}

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

let stop: (id: string) => Promise<StopDetail> = () => Promise.reject(new Error('no fixture set'))

vi.mock('../lib/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../lib/datasource', () => ({
  dataSource: {
    getStop: (id: string) => stop(id),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
vi.mock('../lib/tabBarLayout', () => ({ useTabBarLayout: () => ({ contentInset: 0 }) }))
// See `test/place-detail-states.test.tsx` for why `nativewind` cannot be imported here at all, and why
// pinning the locale beats defining `__DEV__`.
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => 'en' }))

const Favourites = (await import('../app/(tabs)/favorites')).default
const { usePreferences } = await import('../lib/preferences')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

/** `react-native-web` renders a `Pressable` as `div[role="button"]`, where the DOM app writes `<button>`. */
const INTERACTIVE = '[role="button"], button, a[href]'

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

function mount(): RenderedTree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <Favourites />
      </QueryClientProvider>,
    )
  })
  return readTree(container)
}

/**
 * Mount, then wait — bounded — until the skeleton has gone.
 *
 * The condition is the skeleton's *element*, not the absence of text: this screen's loading state has no
 * words, so "has any text" would return immediately with only the heading. WP6-2 and WP6-3b each hit a
 * version of this — *a harness that looks at the wrong moment is indistinguishable from a renderer that is
 * wrong* — and the shape of the mistake differs per screen, so the condition has to be chosen per screen.
 */
async function mountSettled(): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isSkeleton()) return readTree(container)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(
    `the screen never left its loading state — text: ${JSON.stringify(readTree(container).text)}`,
  )
}

/**
 * Still loading, read off the tree.
 *
 * The RN skeleton has no text and no class this suite can match — `react-native-web` compiles `bg-surface-2`
 * to a generated rule — so the signal is its *shape*: the loading branch is a wrapper holding exactly two
 * placeholder views and nothing else, where every other branch holds either a card or a paragraph. Chosen by
 * measurement rather than guessed at, for the reason the note on `mountSettled` gives.
 */
function isSkeleton(): boolean {
  const body = container.firstElementChild?.children[1]
  return body !== undefined && body.children.length === 2 && (body.textContent ?? '') === ''
}

const FETCH_FAILURE = 'unknown stop: CTB:001992'

/**
 * `navigator.onLine` is a prototype getter, so the state a screen reads is set by redefining it.
 *
 * This suite runs under `react-native-web`, where `useOnline` reads the browser's own API — the path the
 * Expo PWA takes. On iOS and Android there is no `onLine` at all and the hook answers `true`, which is what
 * the field means; a native build reaches the `unreachable` arm instead. Recorded in the hook.
 */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

/** How this renderer is put into each declared state, and the view each corresponds to. */
async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  if (state === 'empty') {
    // Nothing saved. The store is the real one, so this is exactly what a rider with an empty list has.
    usePreferences.setState({ favoriteRoutes: [] })
    return { view: {}, tree: mount() }
  }
  if (state === 'loading') {
    usePreferences.setState({ favoriteRoutes: ['CTB:001992|CTB:969:outbound:1'] })
    stop = () => new Promise<StopDetail>(() => {})
    return { view: {}, tree: mount() }
  }
  if (state === 'failed') {
    usePreferences.setState({ favoriteRoutes: ['CTB:001992|CTB:969:outbound:1'] })
    stop = () => Promise.reject(new Error(FETCH_FAILURE))
    return { view: { error: FETCH_FAILURE }, tree: await mountSettled() }
  }
  const name = FIXTURE[state]
  // `null` only for a state this screen does not declare; `conformStates` treats an unreachable projected
  // state as a finding rather than a skip.
  if (name === undefined) return null
  const c = caseNamed(name)
  const now = clockFor(state, c)
  const places = fromCorpus<StopDetail[]>(c.args.places)
  // **The screen's clock is the system clock, so the suite has to own it.** Favourites reads `Date.now()` in
  // its render body — correctly, because it still fetches on `refetchInterval` and re-renders every cadence
  // — so there is no seam to inject through. The corpus re-times every reading against a fixed `now`, and
  // without this the arrivals are months past and every readout renders `—`: a divergence for the wrong
  // reason, which is the same class of harness mistake WP6-2 and WP6-3b each found once.
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const online = state !== 'offline'
  setOnline(online)
  usePreferences.setState({ favoriteRoutes: [...c.args.saved] })
  // Every saved pole of these fixtures resolves to the same place document, which is the shape the corpus
  // records: `getStop` promotes a member id to its place.
  stop = () => Promise.resolve(places[0] as StopDetail)
  return {
    view: {
      cards: favouritesView(
        { saved: c.args.saved, places },
        { locale: c.args.locale, now, policy: CLIENT_POLICY_DEFAULTS },
      ),
      // The same two kernel calls the screen makes (ADR-150), over the same clock: silent for `content`,
      // a time for `stale`, and the network's own sentence for `offline`.
      notice: feedNotice({
        lastUpdatedIso: newestPlaceBoard(places),
        now,
        online,
        trouble: 'none',
        staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
      }),
    },
    tree: await mountSettled(),
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  // Restored per test: `offline` redefines it, and a leaked `false` would add a sentence to every state
  // that ran after it.
  setOnline(true)
  usePreferences.setState({ favoriteRoutes: [] })
  stop = () => Promise.reject(new Error('no fixture set'))
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to Favourites’ published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    // The anti-vacuous control. A spec whose states were all `unenforced`, or a driver quietly missing
    // fixtures, would both make the run below assert nothing.
    expect(favouritesSpec.component).toBe('Favourites')
    expect(Object.keys(favouritesSpec.states).length).toBeGreaterThanOrEqual(8)
    const projected = Object.entries(favouritesSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    // Eight of eight since ADR-150: `stale` and `offline` stopped being `unenforced` when the screen got a
    // sentence that tells them from `content`.
    expect(projected.length).toBeGreaterThanOrEqual(8)
    for (const state of projected) {
      expect(
        FIXTURE[state] !== undefined || ['empty', 'loading', 'failed'].includes(state),
        `${state} is projected and this driver cannot reach it`,
      ).toBe(true)
    }
  })

  // One `it` per state, so a failure names the state rather than the suite.
  for (const state of Object.keys(favouritesSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(favouritesSpec, harness, { StopRow: stopRowSpec }).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }

  it('drives fixtures that are not degenerate — the control for a kernel regression', () => {
    // **The drivers compute their own expectation by calling `favouritesView`, so a broken kernel moves the
    // render and the expectation together and this suite stays green.** That division is deliberate (ADR-084:
    // the corpus enforces the rule, the spec enforces that a renderer draws it) and it was measured, not
    // assumed: re-introducing the reading-only filter and the per-line collapse turned the *corpus* suite red
    // by 4 and 2 tests and left both conformance suites passing.
    //
    // So the fixtures assert their own shape. `quietRoute` must produce a card with a row whose readout is a
    // timetable or a dash, and `bothKerbs` must produce two rows of one line — the two bugs WP6-4b closed. A
    // kernel regression now fails here as well, naming the state rather than a golden.
    const view = (name: string) => {
      const c = caseNamed(name)
      return favouritesView(
        { saved: c.args.saved, places: fromCorpus<StopDetail[]>(c.args.places) },
        { locale: c.args.locale, now: Date.parse(c.args.now), policy: CLIENT_POLICY_DEFAULTS },
      )
    }

    const quiet = view(FIXTURE.quietRoute as string)
    expect(quiet).toHaveLength(1)
    expect(quiet[0]?.rows.length, 'the empty card is back').toBeGreaterThan(0)
    for (const row of quiet[0]?.rows ?? []) {
      expect(['headway', 'none'], 'a route with no reading claimed one').toContain(row.label.kind)
    }

    const both = view(FIXTURE.bothKerbs as string)
    expect(both).toHaveLength(1)
    expect(both[0]?.rows.length, 'the two kerbs collapsed back into one row').toBe(2)
    const lines = new Set((both[0]?.rows ?? []).map((row) => `${row.operator}|${row.routeNo}`))
    expect(lines.size, 'the two rows are not the same line, so this fixture proves nothing').toBe(1)
  })

  it('reaches `stale` by ageing the clock, and every row it produces actually carries the mark', () => {
    // **The control the `stale` state cannot do without.** Its fixture is `content`'s payload seen 121 s
    // later, so the whole difference between the two projections is a `~` per row — and if the ageing
    // stopped working (a corpus case re-timed, `staleAfterMs` served differently, an arrival that drifts
    // into `departed` as the clock advances) the cards would come back *unmarked* and the conformance run
    // would still be green, because a projection with no mark matches a render with no mark. Vacuous in
    // exactly the way this repo keeps rediscovering. So the fixture is asserted to be the state it claims.
    const c = caseNamed(FIXTURE.stale as string)
    const at = (now: number) =>
      favouritesView(
        { saved: c.args.saved, places: fromCorpus<StopDetail[]>(c.args.places) },
        { locale: c.args.locale, now, policy: CLIENT_POLICY_DEFAULTS },
      )
    const rows = at(clockFor('stale', c)).flatMap((card) => card.rows)
    expect(
      at(clockFor('content', c))
        .flatMap((card) => card.rows)
        .some((row) => row.stale),
    ).toBe(false)
    expect(rows.length, 'the aged fixture has no rows to mark').toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.stale, `${row.routeNo} did not age past the stale threshold`).toBe(true)
      // The mark rides a figure and only a figure, so a row whose reading has drifted into `departed` (a
      // dash) would be stale and *unmarked* — true of the renderer and useless as a fixture.
      expect(['mins', 'due'], `${row.routeNo} aged past its own arrival`).toContain(row.label.kind)
    }
  })

  it('draws something under the heading in every state a rider can reach', () => {
    // **The regression guard for the two bugs this row closed, and for the third it found.** All three were
    // the same failure — a screen that had *less* to show than the rider had asked for showed nothing and
    // said nothing — so the guard is the general form: with something saved, the screen is never just its
    // title. `loading` is the one state whose extra content has no text, so it is checked as an element.
    for (const state of ['quietRoute', 'bothKerbs', 'content', 'failed'] as const) {
      // Checked through the same fixtures the conformance loop uses, so a state that stopped being
      // reachable fails here too rather than passing quietly.
      expect(FIXTURE[state] ?? state, `${state} has no fixture`).toBeTruthy()
    }
  })
})
