// The DOM renderer's Place-screen conformance suite: it drives the published spec (WP6-3b, ADR-088) —
// `packages/contract/ui/place-detail.spec.json`, thirteen states, eight of them projected.
//
// WHAT THIS ADDS OVER NEARBY'S
// Nearby's states are branches over an **async status**. Place detail has those and a second axis: branches
// over the **shape of the data** — one kerb or several, and where several, which of ADR-080's three tiers of
// telling two of them apart applies. Each tier exists only for a payload that has it, and a renderer forgets
// a tier the way it forgets a readout arm: silently, and for the population that needs it most. So the
// fixtures are the corpus's own `placeDetailView` cases, one per state, and they line up one to one — which
// is the evidence that the states are the data's rather than invented.
//
// THE SEAMS ARE MOCKED; THE SCREEN AND THE QUERY ARE REAL. `useLocation`, `useLiveEtas`, `useClientPolicy`
// and the `DataSource` are replaced. TanStack Query deliberably is not: `loading`, `failed` and the loaded
// states *are* its states, and mocking `useQuery` would assert against a mock of the thing under test.
//
// THE EXPECTED VIEW IS THE KERNEL'S OWN OUTPUT, not the corpus's recorded `expect`, and the difference is
// one word: the corpus's `labels` are a language-neutral **fixture** while the screen passes the app's
// catalogue. `it('reproduces the corpus goldens…')` below pins how far the two agree — 14 of 15 cases
// exactly, with the one disagreement named — so the catalogue cannot drift away from the corpus unnoticed
// while this suite keeps measuring the renderer, which is its subject.

import placeDetailSpec from '@nextbus/contract/ui/place-detail.spec.json'
import placeRowSpec from '@nextbus/contract/ui/place-row.spec.json'
import {
  CLIENT_POLICY_DEFAULTS,
  feedNotice,
  formatFavoriteRouteKey,
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
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
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

/** The corpus case each state is driven from. A missing one is a thrown error, never a skipped state. */
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

/** The four words the screen composes with — the identical bundle, from the identical catalogue. */
const labelsFor = (locale: Locale) => ({
  operator: (o: Parameters<typeof operatorName>[0]) => operatorName(o, locale),
  servedBy: t(locale, 'servedBy'),
  routeCount: (n: number) => `${n} ${t(locale, 'routesLabel')}`,
  side: (octant: number) => poleSideLabel(octant, locale),
})

/** What the kernel says this case's screen contains — the same call the screen makes. */
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

// ── the four seams ─────────────────────────────────────────────────────────────────────────────

let locationState: LocationState = { status: 'loading' }
let stop: () => Promise<StopDetail> = () => Promise.reject(new Error('no fixture set'))
let now = 0
/** The id in the URL the screen is mounted at — the fixture's own place id, so the query key is real. */
let placeId = 'CTB:000000'

vi.mock('../src/hooks/useLocation', () => ({
  useLocation: () => ({ state: locationState, request: () => {} }),
}))
vi.mock('../src/hooks/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
// The subscription is a seam, and the clock comes out of it — pinned to the corpus case's own `now`, so every
// readout in the expected view is the corpus's rather than the wall clock's.
vi.mock('../src/hooks/useLiveEtas', () => ({ useLiveEtas: () => ({ now }) }))
vi.mock('../src/adapters/datasource', () => ({
  dataSource: { getStop: () => stop(), getClientPolicy: () => Promise.resolve(undefined) },
}))

const { PlaceDetail, CARD_DOCKED_BOTTOM, SNAP_BASE, tailRoom } = await import(
  '../src/screens/PlaceDetail'
)
// The preference store is real, not mocked: which routes a rider saved at this place is this screen's
// input, so a mock of it would be a mock of the thing the star block below is about.
const { usePreferences } = await import('../src/lib/preferences')
const { PLACE_PATH } = await import('../src/shell/destinations')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

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
 * The tree, read in **reading order** — which for this screen is document order, because the DOM app puts
 * its header in flow ahead of the content.
 *
 * The RN driver has to do one thing this does not, and the asymmetry is the point rather than a fudge: over
 * there the collapsing header is an overlay rendered *last* for paint order, and it renders its label twice
 * (an expanded slot and a collapsed marquee it cross-fades between). Both apps put the name at the top of
 * the screen; only this one puts it first in the tree. What neither driver can see is a name that is on
 * screen in the wrong *place* — declared on the spec's `name` slot rather than left to be discovered.
 *
 * The back control's label is dropped, and that is not a special case: `BackButton` renders the word "Back",
 * which is shell chrome present on every pushed destination and is asserted in `test/shell.test.tsx`. The
 * spec is about the place, so the driver hands the walker the screen's content and not the shell's.
 */
function readTree(host: HTMLElement): RenderedTree {
  const back = host.querySelector('header button')
  const text = textOf(host).filter((value) => value !== back?.textContent?.trim())
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

/**
 * Mounted **behind its route**, not as a bare element, and that is load-bearing rather than ceremony: this
 * screen reads its place id from `useParams()` and its arrived-from kerb from `useSearchParams()`. Rendered
 * without a matching route both are empty, the query is `enabled: false`, and the screen renders nothing at
 * all — which the first run of this suite reported as *"did not render at index 0"* for every state. A
 * harness that cannot supply the input is indistinguishable from a renderer that draws nothing.
 */
function mount(): RenderedTree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={[`/stop/${encodeURIComponent(placeId)}`]}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path={PLACE_PATH} element={<PlaceDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
  return readTree(container)
}

/**
 * Mount, then wait — bounded — until the screen has left its loading branch.
 *
 * A fixed number of microtask flushes is what WP6-2's first draft did, and it read two states' trees while
 * the screen was still loading: *a harness that looks at the wrong moment is indistinguishable from a
 * renderer that is wrong.* The condition here is the skeleton's absence, since this screen shows no word
 * while it loads.
 */
async function mountSettled(): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!container.querySelector('.animate-pulse')) return readTree(container)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(
    `the screen never left its loading state — text: ${JSON.stringify(readTree(container).text)}`,
  )
}

const FETCH_FAILURE = 'unknown stop: P:CTB:001992'

/** jsdom's `navigator.onLine` is a prototype getter, so the state a screen reads is set by redefining it. */
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
 * was published. It also shows the limitation ADR-133 recorded in the goldens themselves: `formatClock`
 * prints a wall-clock with no date, so a two-day-old board reads as this morning.
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

/** How this renderer is put into each declared state, and the view each corresponds to. */
async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  if (state === 'loading') {
    // A promise that never settles: the point of this state is what is on screen *before* an answer.
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
  // `null` for the four states the spec declares without a projection (`stale`, `offline`, `codedPlace`,
  // `mappedKerbs`) — `conformStates` skips those itself, and never silently: a projected state with no
  // fixture is a finding.
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

describe('apps/web conforms to Place detail’s published spec, state by state', () => {
  it('has the states the spec declares, and a corpus case for each projected one', () => {
    // The anti-vacuous control. A spec whose states were all `unenforced`, or a driver quietly missing
    // fixtures, would both make the run below assert nothing.
    expect(placeDetailSpec.component).toBe('PlaceDetail')
    expect(Object.keys(placeDetailSpec.states).length).toBeGreaterThanOrEqual(13)
    const projected = Object.entries(placeDetailSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(9)
    // Every projected state is either driven from a named corpus case or is one of the two async branches.
    for (const state of projected) {
      expect(
        FIXTURE[state] !== undefined || ['loading', 'failed', 'offline'].includes(state),
        `${state} is projected and this driver cannot reach it`,
      ).toBe(true)
    }
    for (const name of Object.values(FIXTURE)) expect(caseNamed(name).name).toBe(name)
  })

  // One `it` per state, so a failure names the state rather than the suite.
  for (const state of Object.keys(placeDetailSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      // Only this state is offered, so `conformStates` reports every *other* projected state as
      // unreachable — filter to the one under test. The loop covers them all and the control above keeps
      // the set honest.
      const findings = conformStates(placeDetailSpec, harness, { PlaceRow: placeRowSpec }).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }

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
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('reproduces the corpus goldens with the app’s own catalogue, with one named exception', () => {
    // The corpus's `labels` are a language-neutral **fixture**; the app's are the catalogue. This is what
    // keeps the two from drifting apart in silence, and it is also where the one live difference is
    // recorded: the fixture calls GMB *"Minibus"* and the English catalogue says *"GMB"* — an acronym a
    // rider has to know where the Chinese is a phrase they recognise (`專線小巴`). `docs/07` carries it.
    const diverging: string[] = []
    for (const c of CASES) {
      if (JSON.stringify(viewFor(c)) !== JSON.stringify(fromCorpus(c.expect)))
        diverging.push(c.name)
    }
    expect(diverging).toEqual(['where-the-kerbs-own-names-differ-the-name-is-the-answer'])
  })
})

describe('the saved-state star — the other half of WP6-8’s blocker', () => {
  /**
   * **Why this exists, and why the spec is right to go on calling the star idiom.**
   *
   * `place-row.spec.json` lists the star under `idiom` — *"present on native … it has no text, so no slot
   * can declare it"* — and the second clause is still true and is exactly why this block is here rather
   * than in the projection. What was false was the first clause's premise: the star was absent on the web
   * because favourites were said to be `apps/web`'s at WP6-4, and WP6-4 ported the screen that *reads*
   * favourites and neither affordance that *writes* one. So a web rider could not see which routes they had
   * saved at a kerb, and could not unsave one.
   *
   * The star adds no text node, so every projected state above is unchanged by it — which is the property
   * that lets it be idiom and the reason nothing above would have caught its absence.
   */
  const CASE = FIXTURE.content as string

  const mountWith = async (saved: string[]) => {
    const c = caseNamed(CASE)
    now = Date.parse(c.args.now)
    locationState =
      c.args.here === undefined
        ? { status: 'undetermined' }
        : { status: 'ready', ...c.args.here, stale: false }
    const detail = fromCorpus<StopDetail>(c.args.detail)
    placeId = detail.stop.id
    stop = () => Promise.resolve(detail)
    usePreferences.setState({ favoriteRoutes: saved })
    await mountSettled()
    return viewFor(c)
  }

  const stars = () => [...container.querySelectorAll('button[aria-pressed]')]

  it('draws no star at all when nothing at this place is saved', async () => {
    await mountWith([])
    expect(stars()).toHaveLength(0)
  })

  it('draws exactly one, on the row that is saved, and marks it pressed', async () => {
    const view = await mountWith([])
    const row = (view.grouped ? view.groups.flatMap((g) => g.rows) : view.rows)[0]
    if (!row) throw new Error('the fixture has no rows')
    const key = formatFavoriteRouteKey(row.stopId, row.routeId)
    await mountWith([key])
    expect(stars()).toHaveLength(1)
    expect(stars()[0]?.getAttribute('aria-pressed')).toBe('true')
    // The name is a word, not a graphic: without it the star is invisible to a screen reader — the same
    // hole ADR-093 found in the bus token, on a control rather than an indicator.
    expect(stars()[0]?.getAttribute('aria-label')).toBe(t(LOCALE, 'saved'))
  })

  it('unsaves on press, and takes the star with it', async () => {
    const view = await mountWith([])
    const row = (view.grouped ? view.groups.flatMap((g) => g.rows) : view.rows)[0]
    if (!row) throw new Error('the fixture has no rows')
    const key = formatFavoriteRouteKey(row.stopId, row.routeId)
    await mountWith([key])
    const star = stars()[0]
    act(() => {
      star?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(usePreferences.getState().favoriteRoutes).toEqual([])
    expect(stars(), 'the star outlived the favourite').toHaveLength(0)
  })

  it('keeps the star a sibling of the row, never nested inside it', async () => {
    // ADR-024, and the reason `PlaceRow` returns a flex container rather than a full-width button: a tap
    // target inside a tap target is ambiguous on every platform and invalid HTML on this one.
    const view = await mountWith([])
    const row = (view.grouped ? view.groups.flatMap((g) => g.rows) : view.rows)[0]
    if (!row) throw new Error('the fixture has no rows')
    await mountWith([formatFavoriteRouteKey(row.stopId, row.routeId)])
    const interactive = [...container.querySelectorAll(INTERACTIVE)]
    expect(interactive.filter((el) => el.parentElement?.closest(INTERACTIVE))).toHaveLength(0)
  })

  it('changes not one word of the projection, which is what keeps it idiom', async () => {
    // The control that makes the spec's classification honest rather than convenient: if the star ever
    // carried text, every Place-row projection would differ between the renderers and this would have to
    // become a declared slot.
    const view = await mountWith([])
    const bare = readTree(container).text
    const row = (view.grouped ? view.groups.flatMap((g) => g.rows) : view.rows)[0]
    if (!row) throw new Error('the fixture has no rows')
    await mountWith([formatFavoriteRouteKey(row.stopId, row.routeId)])
    expect(readTree(container).text).toEqual(bare)
  })
})

describe('the map scroll-spy’s geometry — the half no projection can reach', () => {
  /**
   * Two numbers had to agree and did not: the spy tested `STICKY_TOP + MAP_HEIGHT` (206) while a section's
   * snap point was a hard-coded `scroll-mt-[214px]`, so a kerb scrolled to by a tap landed **below** the
   * line the spy tested and the kerb above it stayed lit. Tapping any dot highlighted the wrong one, every
   * time, on every place with more than one kerb.
   *
   * Neither of these is a *word*, so `conformStates` cannot see either — the same blind spot ADR-098 names
   * for interaction destinations, one screen over. Nor can jsdom see much of it: it lays nothing out, and
   * its CSSOM rejects both expressions below. So what is asserted is the shape of the fix — one declared
   * snap point per section, inset-aware, and a tail expression that leaves the last kerb room to reach the
   * line. The pixels themselves were measured in a browser and are recorded in ADR-106.
   */
  it('gives every kerb section one declared snap point, inset-aware', async () => {
    await fixture('groupedKerbs')
    const sections = [...container.querySelectorAll('section')]
    expect(sections.length, 'the grouped fixture rendered no kerb sections').toBeGreaterThan(1)
    for (const section of sections) {
      // jsdom re-serialises the `calc()` into something of its own (`calc(228px + env(0px * , * …))`), so
      // this asserts the two things that survive that: the base offset, and that the safe-area inset is
      // part of it. A bare `214px` — the literal this replaced — has neither.
      expect(section.style.scrollMarginTop).toContain(`${SNAP_BASE}px`)
      expect(section.style.scrollMarginTop).toContain('safe-area-inset-top')
    }
    const [first] = sections
    expect(
      sections.every((s) => s.style.scrollMarginTop === first?.style.scrollMarginTop),
      'two kerbs snapped to different places',
    ).toBe(true)
  })

  it('pads a grouped place so its last kerb can reach the line, and a lone stop not at all', () => {
    // Without the tail the last dot is unreachable: a place whose content is shorter than a viewport stops
    // scrolling before its final heading gets near the line, so tapping that dot moves nothing and lights
    // nothing. `apps/mobile` measures `lastGroupH` for exactly this.
    const grouped = tailRoom(true, 400)
    expect(grouped).toContain('100dvh')
    expect(grouped).toContain(`${SNAP_BASE}px`)
    expect(grouped, 'the measured group height is not subtracted').toContain('400px')
    expect(grouped, 'a short last group could pad the page negatively').toMatch(/^max\(\d+px,/)
    // A place with one flat list has nothing to scroll anywhere, so it gets a flat tail — the RN screen's
    // `paddingBottom: 32` on the same branch.
    expect(tailRoom(false, 400)).toMatch(/^\d+px$/)
  })

  /**
   * …and the same claim as **behaviour**, which is what the two assertions above cannot state: scroll the
   * page as far as it goes and the LAST kerb's dot is the lit one.
   *
   * Everything real is real — the screen, its spy, its listener, its tail expression and `MiniMap`'s own
   * choice of which dot is lit. What the test supplies is the one thing jsdom does not: a layout. Three
   * numbers are given (the chrome above the first kerb, a kerb's height, the viewport) and **everything
   * else is derived from the screen's own output** — the page's height from the tail `tailRoom` returns,
   * how far it can scroll from that, and the spy's line from where the card reports itself. Nothing here
   * restates the tail formula, which is what stops it agreeing with a broken one.
   *
   * The control is the first assertion: at rest the FIRST kerb is lit. A model that could not tell the two
   * apart would pass the interesting one for free.
   */
  it('scrolls far enough for the last kerb to reach the line, and lights that kerb', async () => {
    /** The chrome above the first kerb — header, summary, map card. Any value: nothing depends on it. */
    const CHROME = 320
    /** A kerb group's height, and the one the tail is measured against. */
    const KERB = 120
    const VIEWPORT = window.innerHeight
    expect(VIEWPORT, 'jsdom reports no viewport height to model against').toBeGreaterThan(0)

    const c = caseNamed(FIXTURE.groupedKerbs as string)
    const view = viewFor(c)
    if (!view.grouped) throw new Error('the grouped fixture is not grouped')
    const lastPole = view.groups.at(-1)?.poleId
    if (lastPole === undefined) throw new Error('the grouped fixture has no kerbs')
    const litFor = (poleId: string) => view.pins.findIndex((pin) => pin.ids.includes(poleId))
    // The kerbs must be on **different** dots, or "the last one lights" is true of any of them. ADR-086
    // folds poles published at one coordinate into a single pin, so this is a claim about the fixture.
    expect(litFor(lastPole), 'the last kerb is on no pin at all').toBeGreaterThanOrEqual(0)
    expect(litFor(lastPole), 'every kerb in this fixture folds into one dot').not.toBe(
      litFor(view.groups[0]?.poleId as string),
    )

    // `MiniMap` draws no pins until it has measured itself, and jsdom measures everything as zero.
    const restoreWidth = stubClientWidth(320)
    try {
      await fixture('groupedKerbs')
      const card = container.querySelector('div.sticky')
      const sections = [...container.querySelectorAll('section')]
      if (!card) throw new Error('the docked map card is not on screen')
      expect(sections).toHaveLength(view.groups.length)

      // The card is docked; only its bottom edge is read, and the spy adds the gap back itself.
      card.getBoundingClientRect = () => rect(0, CARD_DOCKED_BOTTOM)
      /** Put the page at `scroll` and let the spy look. */
      const scrollTo = (scroll: number) => {
        sections.forEach((section, i) => {
          section.getBoundingClientRect = () => rect(CHROME + i * KERB - scroll, KERB)
        })
        act(() => window.dispatchEvent(new Event('scroll')))
      }
      /** Which dot `MiniMap` is drawing lit — the undimmed one. Its dots are in `view.pins` order. */
      const lit = () => {
        const dots = [...card.querySelectorAll('div.rounded-full')]
        expect(dots, 'the map drew no dots to light').toHaveLength(view.pins.length)
        const undimmed = dots.filter((dot) => (dot as HTMLElement).style.opacity === '1')
        expect(undimmed, 'exactly one dot is lit at a time').toHaveLength(1)
        return dots.indexOf(undimmed[0] as Element)
      }

      scrollTo(0)
      expect(lit(), 'at rest the first kerb is the lit one').toBe(
        litFor(view.groups[0]?.poleId as string),
      )

      // How far this page can actually scroll, from the tail the screen itself declares for a kerb of
      // this height. `tailRoom` is the screen's own function; `evaluateLength` only does the arithmetic a
      // browser would do to it.
      const tail = evaluateLength(tailRoom(true, KERB), VIEWPORT)
      const page = CHROME + sections.length * KERB + tail
      scrollTo(Math.max(0, page - VIEWPORT))
      expect(
        lit(),
        'scrolled to the very bottom, the last kerb never reaches the spy’s line — it has no tail room',
      ).toBe(litFor(lastPole))
    } finally {
      restoreWidth()
    }
  })
})

/** A `DOMRect` with the two edges this screen reads, and zeroes for the rest. */
function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

/**
 * Make every element report a width, for as long as the returned function has not been called.
 * `MiniMap` takes its first measurement from `clientWidth`, which jsdom answers 0 for because it lays
 * nothing out — and with no width it frames no tiles and draws no dots at all.
 */
function stubClientWidth(width: number): () => void {
  const proto = window.HTMLElement.prototype
  const original = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => width })
  return () => {
    if (original) Object.defineProperty(proto, 'clientWidth', original)
    else Reflect.deleteProperty(proto, 'clientWidth')
  }
}

/**
 * Evaluate a CSS length the way a browser would, so a suite can ask how tall a page is.
 *
 * jsdom's CSSOM rejects `max()` wrapping a nested `calc(env(…))` outright — that is why `tailRoom` is
 * exported at all — so this substitutes the two values a browser knows (the viewport, and a safe-area
 * inset of zero) and folds the functions from the inside out. It understands `max`, `min`, `calc` and
 * `+`/`-`; anything else throws rather than guesses, so a tail expression that grows an operator this
 * cannot read fails loudly instead of quietly agreeing.
 */
function evaluateLength(expr: string, viewportPx: number): number {
  let s = expr.replace(/100dvh/g, `${viewportPx}px`).replace(/env\([^()]*\)/g, '0px')
  const sum = (terms: string) => {
    const parts = terms.trim().split(/\s+/)
    let total = Number.NaN
    let sign = 1
    for (const part of parts) {
      if (part === '+' || part === '-') {
        sign = part === '+' ? 1 : -1
        continue
      }
      const px = /^(-?[\d.]+)px$/.exec(part)
      if (!px) throw new Error(`\`${expr}\` contains \`${part}\`, which this evaluator cannot read`)
      total = Number.isNaN(total) ? Number(px[1]) : total + sign * Number(px[1])
    }
    return total
  }
  for (let guard = 0; guard < 8 && s.includes('('); guard += 1) {
    s = s.replace(/(max|min|calc)\(([^()]*)\)/, (_all, fn: string, body: string) => {
      const values = body.split(',').map(sum)
      if (fn === 'calc' && values.length !== 1) throw new Error(`\`${expr}\`: calc takes one term`)
      return `${fn === 'max' ? Math.max(...values) : fn === 'min' ? Math.min(...values) : values[0]}px`
    })
  }
  return sum(s)
}
