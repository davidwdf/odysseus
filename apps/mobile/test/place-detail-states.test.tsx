// @vitest-environment jsdom
//
// The React Native Place screen's conformance suite: **the same published spec the DOM screen drives**
// (WP6-3b, ADR-088) — `packages/contract/ui/place-detail.spec.json`, one file, two renderers, thirteen
// states.
//
// WHY BOTH SIDES OF THIS EXIST
// ADR-069's honest gap was a projection suite on one renderer and none on the other, pointing the wrong way:
// `apps/mobile` is the app riders use today. This is the half that measures the **reference implementation**
// against the specification extracted from it — and it is the first suite in the repo that renders this
// screen at all, which is the debt WP6-3a recorded when it rewired ~90 lines of JSX with nothing to catch a
// mis-bound field.
//
// THE SEAMS ARE MOCKED; THE SCREEN AND THE QUERY ARE REAL. Four seams (`useLocation`, `useLiveEtas`,
// `useClientPolicy`, the `DataSource`) plus the platform modules jsdom has no answer for — `expo-router`'s
// params and navigation, the safe-area insets, and the locale provider, which reaches `expo-localization`.
// TanStack Query is deliberately not mocked: `loading` and `failed` *are* its states.
//
// THE FIXTURES ARE THE CORPUS'S OWN `placeDetailView` CASES, one per state, so this suite's goldens and the
// DOM suite's are the same bytes and the same kernel call.

import placeDetailSpec from '@nextbus/contract/ui/place-detail.spec.json'
import placeRowSpec from '@nextbus/contract/ui/place-row.spec.json'
import {
  CLIENT_POLICY_DEFAULTS,
  feedNotice,
  type Locale,
  newestPlaceBoard,
  type PlaceDetailView,
  placeDetailView,
  type StopDetail,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-detail.spec.json'
import { CATALOGUE, type MessageKey, operatorName, poleSideLabel, t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
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
  args: {
    detail: unknown
    locale: Locale
    now: string
    here?: { lat: number; lng: number }
    arrivedFromPole?: string
    policy?: typeof CLIENT_POLICY_DEFAULTS
  }
  expect: unknown
}

const CASES = corpus.groups.placeDetailView.cases as unknown as CorpusCase[]

/** The corpus case each state is driven from — the identical table as the DOM suite's. */
const FIXTURE: Record<string, string> = {
  content: 'a-lone-stop-is-one-flat-list',
  groupedKerbs: 'a-merged-place-groups-its-rows-under-each-kerb',
  sidedKerbs: 'two-kerbs-that-print-the-same-heading-get-a-compass-side',
  namedKerbs: 'where-the-kerbs-own-names-differ-the-name-is-the-answer',
  crowdedKerbs: 'where-nothing-can-tell-two-kerbs-apart-the-app-says-so',
  empty: 'a-place-with-nothing-at-all-still-has-a-name-and-a-count',
  incomplete: 'a-refusing-kerb-marks-the-place-incomplete',
  timetabledRows: 'a-route-with-no-reading-falls-back-to-its-timetable',
  remarkedRows: 'a-remark-rides-the-row',
  unlocated: 'without-a-fix-the-distance-and-walk-stay-silent',
  imminentRows: 'a-served-policy-moves-the-imminence-band',
  dueRows: 'an-arrival-inside-the-minute-reads-due',
}

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the placeDetailView corpus case \`${name}\` moved`)
  return found
}

const labelsFor = (locale: Locale) => ({
  operator: (o: Parameters<typeof operatorName>[0]) => operatorName(o, locale),
  servedBy: t(locale, 'servedBy'),
  routeCount: (n: number) => `${n} ${t(locale, 'routesLabel')}`,
  side: (octant: number) => poleSideLabel(octant, locale),
})

function viewFor(c: CorpusCase): PlaceDetailView {
  return placeDetailView(fromCorpus<StopDetail>(c.args.detail), {
    locale: c.args.locale,
    now: Date.parse(c.args.now),
    labels: labelsFor(c.args.locale),
    ...(c.args.here === undefined ? {} : { here: c.args.here }),
    ...(c.args.arrivedFromPole === undefined ? {} : { arrivedFromPole: c.args.arrivedFromPole }),
    ...(c.args.policy === undefined ? {} : { policy: c.args.policy }),
  })
}

// ── the seams, and the platform modules ────────────────────────────────────────────────────────

let locationState: LocationState = { status: 'loading' }
let stop: () => Promise<StopDetail> = () => Promise.reject(new Error('no fixture set'))
let now = 0
/** The route parameter the screen reads its place id from. */
let placeId = 'CTB:000000'

vi.mock('../lib/useLocation', () => ({
  useLocation: () => ({ state: locationState, request: () => {} }),
}))
vi.mock('../lib/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../lib/useLiveEtas', () => ({ useLiveEtas: () => ({ now }) }))
vi.mock('../lib/datasource', () => ({
  dataSource: { getStop: () => stop(), getClientPolicy: () => Promise.resolve(undefined) },
}))
// `expo-router` cannot load outside Metro. `useLocalSearchParams` is the screen's **input**, not decoration:
// without it there is no id, the query is disabled and the screen renders nothing — the DOM suite's first run
// proved that is indistinguishable from a renderer that draws nothing, so it is supplied here.
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: placeId }),
  useRouter: () => ({ push: () => {}, back: () => {} }),
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// **`nativewind` cannot be imported here at all**, and the reason is worth writing down because the error
// gives nothing away: it re-exports `react-native-css-interop`, whose `main` is `"dist/index"` with **no
// extension**, so the resolver hands node `dist/index.d.ts` and the run dies with
// `SyntaxError: Unexpected token 'typeof'` and no stack, no file and no package name. It arrives through
// `cssInterop`, which `GlassView` calls — found by bisecting the screen's imports one at a time.
//
// Mocking it is the right substitution rather than a workaround: `cssInterop` teaches NativeWind to apply
// `className` to a third-party component, which is **styling**, and the two members below are the only two
// the app imports (`grep -rn "from 'nativewind'" apps/mobile`). A suite whose subject is the text loses
// nothing; a suite that cannot load reports nothing.
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
// `expo-blur` reaches `expo-modules-core`, which reads `globalThis.expo.EventEmitter` at import time — a
// Metro/native global. `GlassView` (inside the collapsing header) is the only thing that wants it, and glass
// is **material**, which ADR-075 puts squarely on the idiom side: it draws no text, so a plain view is a
// faithful substitution for a suite whose subject is the text. Same argument as the safe-area insets above.
vi.mock('expo-blur', async () => ({ BlurView: (await import('react-native')).View }))
// `useLocale` reaches `expo-localization` → `expo-modules-core` → `__DEV__`, a Metro global that does not
// exist here. Pinning the locale is the right answer rather than defining the global: the corpus fixtures are
// `en`, so a locale this suite did not control would compare an English projection against a Chinese render.
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => 'en' }))

const PlaceDetailScreen = (await import('../app/stop/[id]')).default

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

/** `react-native-web` renders a `Pressable` as `div[role="button"]`, where the DOM app writes `<button>`. */
const INTERACTIVE = '[role="button"], button, a[href]'

function textOf(node: Node): string[] {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  const text: string[] = []
  let current = walker.nextNode()
  while (current) {
    const value = (current.textContent ?? '').trim()
    if (value) text.push(value)
    current = walker.nextNode()
  }
  return text
}

/**
 * The tree, read in **reading order** — and here that is *not* document order, which is the one thing this
 * driver does that the DOM one does not.
 *
 * The screen's root has two children: the scrolling content, then the floating `StopHeader`. The header is
 * last because in React Native later siblings paint on top, and it is where the place's **name** is — so
 * document order would put the title after every row, and the two renderers would disagree about the order
 * of a screen that looks identical. Worse, `CollapsingHeader` renders its label **twice**, in an expanded
 * slot and a collapsed marquee it cross-fades between, so document order would also report the name twice.
 *
 * Reading the chrome first, de-duplicated, is therefore this renderer's honest reading of its own structure —
 * ADR-069 decision 7's rule that *the declaration is shared and the reading is not*. It is worth being
 * precise about what it costs: this driver **cannot see a name drawn in the wrong place on screen**, only a
 * name that is missing or wrong. That limitation is declared on the spec's `name` slot rather than left to be
 * discovered.
 */
function readTree(host: HTMLElement): RenderedTree {
  const screen = host.firstElementChild
  const body = screen?.children[0]
  const chrome = screen?.children[1]
  const chromeText = chrome ? [...new Set(textOf(chrome))] : []
  const bodyText = body ? textOf(body) : []
  const interactive = [...host.querySelectorAll(INTERACTIVE)]
  return {
    text: [...chromeText, ...bodyText],
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
        <PlaceDetailScreen />
      </QueryClientProvider>,
    )
  })
  return readTree(container)
}

/**
 * Mount, then wait — bounded — until the screen has something to say.
 *
 * **"Has any text at all" is the condition, and it is chosen rather than convenient.** This screen shows no
 * word while it loads: the header's label is `''` until the place has a name and the body is four skeleton
 * blocks, so its loading tree is *empty*. That makes an empty tree the precise signal for "not settled yet",
 * and it makes the timeout a **finding** rather than a flake — a state that never produces a string is a
 * screen that shows a rider nothing, which is what `failed` turned out to be.
 *
 * The first draft polled for a `[data-testid="skeleton"]` that nothing renders, so it always returned
 * immediately and reported every state as missing its title. WP6-2 hit the same class of mistake and it is
 * worth stating again: *a harness that looks at the wrong moment is indistinguishable from a renderer that is
 * wrong.*
 */
async function mountSettled(): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tree = readTree(container)
    if (tree.text.length > 0) return tree
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error('the screen settled with no text at all — it is showing the rider nothing')
}

const FETCH_FAILURE = 'unknown stop: P:CTB:001992'

/**
 * `navigator.onLine` is a prototype getter, so the state a screen reads is set by redefining it. Under
 * `react-native-web` `useOnline` reads the browser's own API; on native there is none and it answers `true`.
 */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

/**
 * The freshness notice the screen will have computed for this payload — the same two kernel calls it makes
 * (ADR-150), over the same clock and the same policy.
 *
 * **Several of these fixtures produce a sentence rather than silence, and that is the data being honest.**
 * Most `placeDetailView` corpus cases are a payload captured on 27 July viewed at a `now` on the 29th — a
 * coherent snapshot, two days old — so their readouts are all departed and the screen says when the board
 * was published. It also puts ADR-133's recorded limitation in the goldens: `formatClock` prints a
 * wall-clock with no date, so a two-day-old board reads as this morning.
 */
function noticeFor(detail: StopDetail, at: number, opts: { online: boolean }) {
  return feedNotice({
    lastUpdatedIso: newestPlaceBoard([detail]),
    now: at,
    online: opts.online,
    trouble: 'none',
    staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
  })
}

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  if (state === 'loading') {
    stop = () => new Promise<StopDetail>(() => {})
    return { view: {}, tree: mount() }
  }
  if (state === 'failed') {
    stop = () => Promise.reject(new Error(FETCH_FAILURE))
    return { view: { error: FETCH_FAILURE }, tree: await mountSettled() }
  }
  if (state === 'offline') {
    // **The state that could not be told from a loaded screen until ADR-150**: the same place, the same
    // rows, and one sentence saying the rider's own network is gone rather than that the data is old.
    const c = caseNamed(FIXTURE.content as string)
    now = Date.parse(c.args.now)
    locationState = { status: 'undetermined' }
    const detail = fromCorpus<StopDetail>(c.args.detail)
    placeId = detail.stop.id
    stop = () => Promise.resolve(detail)
    setOnline(false)
    return {
      view: { ...viewFor(c), notice: noticeFor(detail, now, { online: false }) },
      tree: await mountSettled(),
    }
  }
  const name = FIXTURE[state]
  if (name === undefined) return null
  const c = caseNamed(name)
  now = Date.parse(c.args.now)
  locationState =
    c.args.here === undefined
      ? { status: 'undetermined' }
      : { status: 'ready', ...c.args.here, stale: false }
  const detail = fromCorpus<StopDetail>(c.args.detail)
  placeId = detail.stop.id
  stop = () => Promise.resolve(detail)
  return {
    view: { ...viewFor(c), notice: noticeFor(detail, now, { online: true }) },
    tree: await mountSettled(),
  }
}

beforeEach(() => {
  locationState = { status: 'loading' }
  stop = () => Promise.reject(new Error('no fixture set'))
  // Restored per test: `offline` redefines it, and a leaked `false` would add a sentence to every state
  // that ran after it.
  setOnline(true)
  now = 0
  placeId = 'CTB:000000'
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to Place detail’s published spec, state by state', () => {
  it('has the states the spec declares, and a corpus case for each projected one', () => {
    expect(placeDetailSpec.component).toBe('PlaceDetail')
    expect(Object.keys(placeDetailSpec.states).length).toBeGreaterThanOrEqual(13)
    const projected = Object.entries(placeDetailSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(9)
    for (const state of projected) {
      expect(
        FIXTURE[state] !== undefined || ['loading', 'failed', 'offline'].includes(state),
        `${state} is projected and this driver cannot reach it`,
      ).toBe(true)
    }
  })

  it('exercises all three readout arms, a remark and an absent walk — the control the injection found missing', () => {
    // **The anti-vacuous control, and it exists because an injected defect passed.** Deleting the published
    // frequency from the row component left both suites green: no fixture had a row with a `headway` readout,
    // so the spec's middle arm was declared and never projected. A `oneOf` case nothing drives is a
    // specification looking at nothing, which is this repo's most-repeated failure.
    //
    // So the coverage is asserted rather than assumed: every arm of the readout, the `when`-gated remark, and
    // at least one kerb with no walk time. Add a state and this stays honest; remove one and it goes red.
    const views = Object.values(FIXTURE).map((name) => viewFor(caseNamed(name)))
    const rows = views.flatMap((view) => [...view.rows, ...view.groups.flatMap((g) => g.rows)])
    const kinds = new Set(rows.map((row) => row.readout.kind))
    expect([...kinds].sort()).toEqual(['eta', 'headway', 'none'])
    const labels = new Set(
      rows.flatMap((row) => (row.readout.kind === 'eta' ? [row.readout.label.kind] : [])),
    )
    expect(labels.has('mins'), 'no fixture has a minutes readout').toBe(true)
    expect(labels.has('due'), 'no fixture has a "Due" readout').toBe(true)
    expect(
      rows.some((row) => row.remark !== undefined),
      'no fixture row carries a remark',
    ).toBe(true)
    expect(
      views.some((view) => view.groups.some((group) => group.walk === undefined)),
      'no fixture has a kerb with no walk time, so the `when` gate is never exercised',
    ).toBe(true)
  })

  it('draws a skeleton whenever it has no answer, whatever the query state', () => {
    // The regression guard for the blank screen: `loading`'s declared projection is *no text*, which is
    // right — nothing is claimed while nothing is known — but "no text" is also what a screen that renders
    // NOTHING produces, and that is the bug this row found. So the skeleton is asserted as an **element**,
    // which is the only observable difference between the two, and it is why the arms are ordered with
    // "we have no answer" last. A query that is pending and not fetching takes the same arm by construction.
    stop = () => new Promise<StopDetail>(() => {})
    mount()
    // `Skeleton` is four `bg-surface-2` blocks under `react-native-web`, which compiles the class to a
    // generated `css-view-*` rule — so the count of the *body's* leaf views is what distinguishes "four
    // placeholder blocks" from "nothing". Four is the number the screen renders; `>= 4` rather than `=== 4`
    // because the wrapper is this component's business and not the spec's.
    const body = container.firstElementChild?.children[0]
    expect(body?.querySelectorAll('div').length ?? 0).toBeGreaterThanOrEqual(4)
  })

  for (const state of Object.keys(placeDetailSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(placeDetailSpec, harness, { PlaceRow: placeRowSpec }).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }
})
