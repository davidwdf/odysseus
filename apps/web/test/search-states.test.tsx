// The DOM renderer's Search conformance suite: it drives the published spec (WP6-5b, ADR-092) —
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
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
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

vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getSearchIndex: () => getIndex(),
    getClientPolicy: () => Promise.resolve(undefined),
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
  Search: typeof import('../src/screens/Search')['Search']
  usePreferences: typeof import('../src/lib/preferences')['usePreferences']
}
async function freshModules(): Promise<Screens> {
  vi.resetModules()
  const [screen, store] = await Promise.all([
    import('../src/screens/Search'),
    import('../src/lib/preferences'),
  ])
  return { Search: screen.Search, usePreferences: store.usePreferences }
}
let screens: Screens

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

/**
 * The tree, with the **shell's back label** dropped — as on Place detail: `BackButton` renders the word
 * "Back" on every pushed destination and is asserted in `test/shell.test.tsx`. The spec is about searching.
 *
 * The field itself contributes nothing here: an `<input>`'s value and placeholder are attributes, not text
 * nodes. That is the platform split the spec names in `idiom`, and the RN driver is the side that has to do
 * something about it — it drops the field's **subtree**, which is the structural way to say "not this
 * element". Filtering by *value* was tried first and was wrong for a reason worth keeping: with the query
 * `2` it also deleted the keypad's `2` key, and the suite reported a divergence twelve nodes later.
 */
function readTree(host: HTMLElement, _query: string): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  // `Set<string>` explicitly — see the twin note in `route-detail-states.test.tsx`. `t()` returns the
  // branded `LocalizedString`, and this set is queried with plain strings read out of the tree.
  const noise = new Set<string>([t(LOCALE, 'back')])
  const text: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value && !noise.has(value)) text.push(value)
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

function mount(): void {
  const { Search } = screens
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <Search />
      </MemoryRouter>,
    )
  })
}

/** Mount, then wait — bounded — until the index has arrived and the skeleton has gone. */
async function mountSettled(query: string): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!container.querySelector('.animate-pulse')) return readTree(container, query)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error('the screen never left its loading state')
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
    const el = [...container.querySelectorAll('button')].find(
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
  localStorage.clear()
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to Search’s published spec, state by state', () => {
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
