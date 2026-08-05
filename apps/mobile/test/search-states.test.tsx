// @vitest-environment jsdom
//
// The React Native Search screen's conformance suite: **the same published spec the DOM screen drives**
// (WP6-5b, ADR-092) —
// `packages/contract/ui/search.spec.json`, ten states, eight of them projected.
//
// WHAT IS DIFFERENT ABOUT THIS SCREEN
// `proposals/04` picked it for *"interaction-heavy specs"*, and the answer is that a spec should mostly not
// try: a keypad that collapses, a field that focuses, a segment that slides are gesture and motion, which
// ADR-075 puts on the idiom side. What it **can** hold is the thing a rider infers from the interaction —
// **a key drawn as live means some route number continues that way** — and the `filteredToNothing` state is
// where that bites: with the *Night* chip on and a `2` typed, every digit is inert and the letter row is gone.
//
// THE SEAMS ARE MOCKED; THE SCREEN, THE STORE AND THE INDEX HOOK'S LOAD ORDER ARE REAL. Only the
// `DataSource` is replaced. The preferences store is not — what a rider looked at before is this screen's
// input — and neither is `useSearchIndex`, whose stale-while-revalidate order is the reason `loading` is so
// narrow a state.
//
// THE FIXTURES ARE THE CORPUS'S OWN `searchView` CASES, one per state, so this suite's goldens and the RN
// suite's are the same bytes and the same kernel call.

import searchSpec from '@nextbus/contract/ui/search.spec.json'
import { type Locale, type SearchIndex, type SearchView, searchView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/search.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

interface CorpusCase {
  name: string
  args: {
    index: SearchIndex
    mode: 'routes' | 'stops'
    query: string
    filter: { operators: string[]; categories: string[] }
    recentRouteIds: string[]
    recentStopIds: string[]
    locale: Locale
  }
  expect: unknown
}

const CASES = corpus.groups.searchView.cases as unknown as CorpusCase[]

/** The corpus case each state is driven from. A missing one is a thrown error, never a skipped state. */
const FIXTURE: Record<string, string> = {
  content: 'a-route-query-narrows-to-its-matches',
  stopsMode: 'a-stop-query-splits-the-printed-code-off-each-name',
  recents: 'a-recent-route-is-resolved-against-the-index',
  noMatches: 'a-stop-query-that-matches-nothing',
  filteredToNothing: 'a-category-filter-narrows-the-keypad-and-the-list-together',
  empty: 'no-query-and-no-history-is-the-empty-screen',
}

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the searchView corpus case \`${name}\` moved`)
  return found
}

// ── the one seam ───────────────────────────────────────────────────────────────────────────────

let getIndex: () => Promise<SearchIndex> = () => Promise.reject(new Error('no fixture set'))

vi.mock('../lib/datasource', () => ({
  dataSource: {
    getSearchIndex: () => getIndex(),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {}, back: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// See `test/place-detail-states.test.tsx` for why `nativewind` cannot be imported at all, and why pinning
// the locale beats defining `__DEV__`.
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
vi.mock('expo-blur', async () => ({ BlurView: (await import('react-native')).View }))
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => 'en' }))
// `AsyncStorage` is the RN index cache's backing store and has no jsdom implementation. An in-memory stub is
// the honest substitute: what this suite drives is the *screen*, and the load order the stub exercises is the
// same one — nothing cached, so the network copy is fetched.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
  },
}))

/**
 * Imported **per test**, not once — because `useSearchIndex` memoizes the index in module scope for the
 * session, which is right for the app and wrong for a suite driving eight different indexes: the memo from an
 * earlier state leaked into `loading` and `failed`, so both rendered a full chip row instead of a skeleton and
 * an error. The third variant of *a harness that looks at the wrong moment* this wave has met, and the only
 * one whose cause was a module rather than a clock.
 */
type Screens = {
  // `ComponentType` rather than `() => JSX.Element`: this app resolves TypeScript 6.0.3 (ADR-069's incidental
  // finding), where the global `JSX` namespace is gone in favour of `React.JSX`.
  Search: ComponentType
  usePreferences: typeof import('../lib/preferences')['usePreferences']
}
async function freshModules(): Promise<Screens> {
  vi.resetModules()
  const [screen, store] = await Promise.all([import('../app/search'), import('../lib/preferences')])
  return { Search: screen.default as ComponentType, usePreferences: store.usePreferences }
}
let screens: Screens

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

/** `react-native-web` renders a `Pressable` as `div[role="button"]`, where the DOM app writes `<button>`. */
const INTERACTIVE = '[role="button"], button, a[href]'

/**
 * The tree, with the **query field's subtree** dropped.
 *
 * This screen draws the typed number in a `<Text>`, because its keypad *is* the input; the DOM screen uses a
 * real `<input>`, whose value and placeholder are attributes and therefore not text nodes at all. That is the
 * one genuine platform split on this screen and the spec names it in `idiom` — so the reading is per renderer
 * (ADR-069 decision 7) and this is the side that has to act.
 *
 * **Structurally, not by value.** Filtering out text equal to the query was tried first in the DOM driver and
 * was wrong for a reason worth keeping: with the query `2` it also deleted the keypad's `2` key, and the suite
 * reported a divergence twelve nodes later. So the field is skipped by *position* — the screen's second body
 * child — which cannot delete something that merely looks like it.
 *
 * **And the position is conditional, which the first version got wrong.** In `loading` and `failed` there is
 * no field: the body is the header plus one branch, so `children[1]` is the skeleton or the **error message**,
 * and dropping it made the `failed` state look like it had never loaded. The field exists only where the chip
 * row does, which is what `children.length > 2` says. Fourth variant this wave of *a harness that looks at the
 * wrong thing being indistinguishable from a renderer that is wrong* — and the only one that hid a state's
 * entire content rather than its timing.
 */
function readTree(host: HTMLElement, _query: string): RenderedTree {
  const body = host.firstElementChild
  const field = (body?.children.length ?? 0) > 2 ? body?.children[1] : undefined
  const text: string[] = []
  const walk = (node: Node) => {
    if (node === field) return
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? '').trim()
      if (value) text.push(value)
      return
    }
    for (const child of node.childNodes) walk(child)
  }
  walk(host)
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

function mount(): void {
  const { Search } = screens
  root = createRoot(container)
  act(() => {
    root?.render(<Search />)
  })
}

/** Mount, then wait — bounded — until the index has arrived and the skeleton has gone. */
async function mountSettled(query: string): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // **"Settled" is anything beyond the two segment labels.** The RN loading branch is a pair of `Skeleton`
    // views with no text, so the tree holds exactly the header until the index resolves — *or fails*, which
    // is why the condition is not "the chips appeared": that never happens in the `failed` state and the
    // first version of this loop timed out there rather than reading the error it was asked about.
    const tree = readTree(container, query)
    if (tree.text.length > 2) return tree
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(
    'the screen never left its loading state — text: ' +
      JSON.stringify(readTree(container, query).text),
  )
}

/**
 * Type the case's query and set its filter through the screen's own controls, rather than by prop.
 *
 * **This is what makes it a *conformance* suite rather than a render test**: `mode`, `query` and `filter` are
 * the screen's own state, so the only honest way into a state is the way a rider gets there — press the
 * segment, press the chips, press the keys. A driver that reached in and set state would be asserting that
 * the screen renders a view it was handed, which nothing doubted.
 */
function drive(c: CorpusCase): void {
  const press = (label: string) => {
    const el = [...container.querySelectorAll<HTMLElement>(INTERACTIVE)].find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === label,
    )
    if (!el) throw new Error(`no control labelled "${label}" — the driver cannot reach this state`)
    act(() => el.click())
  }
  if (c.args.mode === 'stops') press(t(LOCALE, 'searchSegStops'))
  for (const operator of c.args.filter.operators) press(operatorLabel(operator))
  for (const category of c.args.filter.categories) press(categoryLabel(category))
  if (c.args.query !== '') {
    if (c.args.mode === 'routes') {
      for (const ch of c.args.query) press(ch)
    } else {
      const input = container.querySelector('input')
      if (!input) throw new Error('no stop field to type into')
      act(() => {
        // The one place a value is set rather than pressed: a text field has no per-character control, and a
        // platform keyboard is not something a suite can press.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set
        setter?.call(input, c.args.query)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
  }
}

const operatorLabel = (operator: string) =>
  ({ KMB: 'KMB', LWB: 'LWB', CTB: 'Citybus', GMB: 'GMB' })[operator] ?? operator
const categoryLabel = (category: string) =>
  ({
    night: t(LOCALE, 'filterNight'),
    airport: t(LOCALE, 'filterAirport'),
    express: t(LOCALE, 'filterExpress'),
  })[category] ?? category

const FETCH_FAILURE = 'index: 502 upstream'

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  screens = await freshModules()
  if (state === 'loading') {
    getIndex = () => new Promise<SearchIndex>(() => {})
    mount()
    return { view: {}, tree: readTree(container, '') }
  }
  if (state === 'failed') {
    getIndex = () => Promise.reject(new Error(FETCH_FAILURE))
    return { view: { error: FETCH_FAILURE }, tree: await mountSettled('') }
  }
  const name = FIXTURE[state]
  if (name === undefined) return null
  const c = caseNamed(name)
  getIndex = () => Promise.resolve(c.args.index)
  screens.usePreferences.setState({
    recentRoutes: [...c.args.recentRouteIds],
    recentStops: [...c.args.recentStopIds],
  })
  await mountSettled('')
  drive(c)
  return {
    view: searchView(
      {
        index: c.args.index,
        mode: c.args.mode,
        query: c.args.query,
        filter: c.args.filter as never,
        recentRouteIds: c.args.recentRouteIds,
        recentStopIds: c.args.recentStopIds,
      },
      {
        locale: c.args.locale,
        labels: {
          operator: (op) => operatorLabel(op),
          category: (cat) => categoryLabel(cat),
        },
      },
    ) satisfies SearchView,
    tree: readTree(container, c.args.query),
  }
}

beforeEach(() => {
  getIndex = () => Promise.reject(new Error('no fixture set'))
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to Search’s published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    expect(searchSpec.component).toBe('Search')
    expect(Object.keys(searchSpec.states).length).toBeGreaterThanOrEqual(10)
    const projected = Object.entries(searchSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(8)
    for (const state of projected) {
      expect(
        FIXTURE[state] !== undefined || state === 'loading' || state === 'failed',
        `${state} is projected and this driver cannot reach it`,
      ).toBe(true)
    }
  })

  for (const state of Object.keys(searchSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(searchSpec, harness).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }

  it('draws a live key only where one can lead somewhere, and never removes one', () => {
    // **The invariant the projection cannot see**, because `enabled` is a colour: a key drawn as live must
    // continue the prefix into some findable number. Asserted against the view's own answer, which is
    // corpus-pinned — so this checks the *renderer*, which is this suite's subject, and the two together
    // cover the rule end to end. The extreme case is `filteredToNothing`: ten keys, none of them pressable.
    const c = caseNamed(FIXTURE.filteredToNothing as string)
    const view = searchView(
      {
        index: c.args.index,
        mode: 'routes',
        query: c.args.query,
        filter: c.args.filter as never,
        recentRouteIds: [],
        recentStopIds: [],
      },
      { locale: 'en', labels: { operator: operatorLabel, category: categoryLabel } },
    )
    expect(view.keypad.digits).toHaveLength(10)
    expect(
      view.keypad.digits.every((d) => !d.enabled),
      'a night filter left a digit live',
    ).toBe(true)
    expect(
      view.keypad.letters.map((l) => l.char),
      'only N can begin a night route',
    ).toEqual(['N'])
  })
})
