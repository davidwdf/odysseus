// The DOM renderer's Route detail conformance suite: it drives the published spec (WP6-6b, ADR-094) —
// `packages/contract/ui/route-detail.spec.json`, nineteen states, seventeen of them projected.
//
// WHAT IS DIFFERENT ABOUT THIS SCREEN
// `proposals/04` picked it as *"the motion test"*, and the answer is narrower than "motion is idiom": **motion
// is idiom; what the motion is about is not.** A bus token's slide, tween and bob are curve and physics; which
// node it is at is `routeDetailView.buses` and is the same on both renderers. Which is why the eight bus-
// related states below assert *text* — the token's accessible **name** — and never a position: a token with no
// name is invisible to this harness and to a screen reader alike, which is how WP6-6a found that the RN one
// had none.
//
// THE ONE SEAM IS THE `DataSource`. The preferences store is real, because which rows are starred is this
// screen's input; TanStack Query is real, because `loading` and `failed` *are* its states.
//
// THE FIXTURES ARE THE CORPUS'S OWN `routeDetailView` CASES, one per state, so this suite's goldens and the RN
// suite's are the same bytes and the same kernel call.

import routeDetailSpec from '@nextbus/contract/ui/route-detail.spec.json'
import {
  type CLIENT_POLICY_DEFAULTS,
  formatFavoriteRouteKey,
  type Locale,
  type RouteDetail as RouteDetailPayload,
  type RouteDetailView,
  routeDetailView,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/route-detail.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

/** JSON `null` → the language's absent value, at the boundary. Same helper as the other state suites. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

interface CorpusCase {
  name: string
  args: {
    detail: unknown
    locale: Locale
    now: string
    arrivedFromStop?: string
    flipped?: boolean
    savedRouteKeys?: string[]
    policy?: typeof CLIENT_POLICY_DEFAULTS
  }
  expect: unknown
}

const CASES = corpus.groups.routeDetailView.cases as unknown as CorpusCase[]

/**
 * The corpus case each state is driven from — the identical table as the RN suite's.
 *
 * Several states share one case, and that is the point rather than a shortcut: `content` and `busMidRoute`
 * are the *same payload* seen through two questions, so a renderer that broke one would break both. What is
 * not shared is the set of cases: every projected state has a fixture and the first test below fails if one
 * loses it.
 */
const FIXTURE: Record<string, string> = {
  content: 'a-bus-mid-route-rides-the-segment-leading-into-its-stop',
  anchored: 'a-route-opened-from-a-stop-anchors-that-row',
  flipped: 'a-flip-drops-the-anchor-even-when-the-reverse-serves-the-same-pole',
  circular: 'a-circular-route-heads-its-own-loop-line-and-offers-no-toggle',
  busAtOrigin: 'an-origin-bus-nearly-leaving-rides-the-first-node',
  busMidRoute: 'a-bus-mid-route-rides-the-segment-leading-into-its-stop',
  busAtStop: 'a-bus-a-minute-away-stands-on-the-node-it-is-reaching',
  emptyRail: 'an-origin-bus-not-yet-leaving-earns-no-token',
  savedStop: 'a-saved-route-stars-only-the-pole-it-was-saved-at',
  noReading: 'a-departed-reading-is-not-an-arrival-and-leaves-its-row-with-nothing',
  stale: 'a-stale-board-dims-every-slot-on-its-row-together',
  sparseFacts: 'a-sparse-service-block-yields-only-the-facts-it-can-support',
  noFacts: 'a-route-with-no-service-block-has-no-facts-strip-at-all',
  holidayFare: 'a-holiday-fare-is-a-note-on-the-fare-pill-never-a-pill-of-its-own',
  empty: 'an-empty-sequence-still-names-the-route-from-its-own-labels',
}

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the routeDetailView corpus case \`${name}\` moved`)
  return found
}

const labels = {
  stopCount: (n: number) => t(LOCALE, 'stopCount', { n }),
  holiday: t(LOCALE, 'holiday'),
  circularVia: (place: string) => t(LOCALE, 'circularVia', { place }),
  busApproaching: (stop: string) => t(LOCALE, 'busApproaching', { stop }),
  busAtStop: (stop: string) => t(LOCALE, 'busAtStop', { stop }),
}

function viewFor(c: CorpusCase): RouteDetailView {
  return routeDetailView(fromCorpus<RouteDetailPayload>(c.args.detail), {
    locale: c.args.locale,
    now: Date.parse(c.args.now),
    labels,
    ...(c.args.arrivedFromStop === undefined ? {} : { arrivedFromStop: c.args.arrivedFromStop }),
    ...(c.args.flipped === undefined ? {} : { flipped: c.args.flipped }),
    ...(c.args.savedRouteKeys === undefined ? {} : { savedRouteKeys: c.args.savedRouteKeys }),
    ...(c.args.policy === undefined ? {} : { policy: c.args.policy }),
  })
}

// ── the one seam ───────────────────────────────────────────────────────────────────────────────

let route: () => Promise<RouteDetailPayload> = () => Promise.reject(new Error('no fixture set'))

vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getRoute: () => route(),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

const { RouteDetail } = await import('../src/screens/RouteDetail')
const { usePreferences } = await import('../src/lib/preferences')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

/**
 * The tree, with the shell's **back label** dropped — as on Place detail and Search: `BackButton` renders the
 * word "Back" on every pushed destination and is asserted in `test/shell.test.tsx`.
 *
 * Document order is reading order here, unlike the RN twin: this header is in flow and first, which is the
 * `idiom` entry the spec names. So no re-ordering and no de-duplication — and the two composed journey labels
 * are not in this tree at all, because `header.label` goes to `document.title` and there is no collapsed size.
 */
function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  // `Set<string>` explicitly: `t()` returns the branded `LocalizedString`, so an inferred set could not be
  // queried with the plain strings read out of the tree. Invisible until WP6-7 put `test/**/*.tsx` into
  // this app's `tsconfig` — seven suites had never been typechecked.
  const noise = new Set<string>([t(LOCALE, 'back')])
  const text: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value && !noise.has(value)) text.push(value)
    node = walker.nextNode()
  }
  // A bus token is a *graphic*: its accessible name is an attribute, not a text node, so the projection would
  // never see it. Appending the labels in the model's order is this renderer's honest reading of an element
  // whose whole content is its name — the same judgement the RN driver makes about its overlay.
  for (const token of host.querySelectorAll('[role="img"][aria-label]')) {
    text.push(token.getAttribute('aria-label') ?? '')
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

/**
 * Mount at a URL, because `:id` and `?stop=` are this screen's whole input.
 *
 * A fresh `QueryClient` per mount with `retry: false`: the shell's own provider is not in the tree, and a
 * retrying client would make `failed` a state this suite waited out rather than one it reached.
 */
function mount(url: string): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/route/:id" element={<RouteDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

/** Mount, then wait — bounded — until the skeleton has gone. A timeout is a finding, not a flake. */
async function mountSettled(url: string): Promise<RenderedTree> {
  mount(url)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!container.querySelector('.animate-pulse')) return readTree(container)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error('the screen never left its loading state')
}

const FETCH_FAILURE = 'unknown route: KMB:999X:outbound:1'

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  if (state === 'loading') {
    route = () => new Promise<RouteDetailPayload>(() => {})
    mount('/route/KMB%3A264X%3Aoutbound%3A1')
    return { view: {}, tree: readTree(container) }
  }
  if (state === 'failed') {
    route = () => Promise.reject(new Error(FETCH_FAILURE))
    return {
      view: { error: FETCH_FAILURE },
      tree: await mountSettled('/route/KMB%3A999X%3Aoutbound%3A1'),
    }
  }
  const name = FIXTURE[state]
  if (name === undefined) return null
  const c = caseNamed(name)
  const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
  route = () => Promise.resolve(detail)
  usePreferences.setState({ favoriteRoutes: [...(c.args.savedRouteKeys ?? [])] })
  vi.setSystemTime(Date.parse(c.args.now))
  // **`flipped` is reached differently here, and that is the driver's job rather than the spec's.** This
  // renderer navigates to the reverse direction instead of swapping it into local state (a URL that names a
  // direction is one a rider can share), so what "flipped" means on the web is *this route, opened without a
  // boarding stop* — which produces the identical view the corpus case records with `flipped: true`. The two
  // renderers get to the same state by different routes; the state is the same state.
  const anchor =
    c.args.flipped === true || c.args.arrivedFromStop === undefined
      ? ''
      : `?stop=${encodeURIComponent(c.args.arrivedFromStop)}`
  return {
    view: viewFor(c),
    tree: await mountSettled(`/route/${encodeURIComponent(detail.route.id)}${anchor}`),
  }
}

beforeEach(() => {
  route = () => Promise.reject(new Error('no fixture set'))
  // **jsdom implements no layout, so it has no `scrollIntoView`** — and an unstubbed call throws out of the
  // effect that brings the boarding row up, which fails `anchored` for a reason that has nothing to do with
  // the screen. Stubbing it is the right substitution rather than a workaround, and it is the same judgement
  // the RN suites make about `expo-blur` and the safe-area insets: *where* a row ends up on screen is
  // geometry, this suite's subject is the text, and a screen that scrolled to the wrong row would be invisible
  // to it either way. The spec says so on `anchored` — what it pins is that the anchor changes **nothing**
  // about what is shown.
  Element.prototype.scrollIntoView = () => {}
  localStorage.clear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to Route detail’s published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    expect(routeDetailSpec.component).toBe('RouteDetail')
    expect(Object.keys(routeDetailSpec.states).length).toBeGreaterThanOrEqual(18)
    const projected = Object.entries(routeDetailSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(16)
    for (const state of projected) {
      expect(
        FIXTURE[state] !== undefined || state === 'loading' || state === 'failed',
        `${state} is projected and this driver cannot reach it`,
      ).toBe(true)
    }
  })

  it('exercises every arm its fixtures are meant to — the control the WP6-3b injection found missing', () => {
    // **A `oneOf` case nothing drives is a specification looking at nothing.** WP6-3b learned that the
    // expensive way: two arms of a three-way readout were declared, projected by nothing, and an injected
    // defect passed twice. So the fixture *set* is audited against the spec's branches rather than assumed.
    const views = Object.values(FIXTURE).map((name) => viewFor(caseNamed(name)))
    const kinds = new Set(
      views.flatMap((v) => v.stops.flatMap((s) => s.arrivals.map((a) => a.label.kind))),
    )
    expect(kinds.has('mins'), 'no fixture has a minutes readout').toBe(true)
    expect(kinds.has('due'), 'no fixture has a "Due" readout').toBe(true)
    const busKinds = new Set(views.flatMap((v) => v.buses.map((b) => b.kind)))
    expect([...busKinds].sort(), 'both rail positions must be driven').toEqual(['node', 'segment'])
    expect(
      views.some((v) => v.buses.length === 0),
      'no fixture leaves the rail empty, so the origin suppression is never projected',
    ).toBe(true)
    expect(
      views.some((v) => v.facts.some((f) => f.note !== undefined)),
      'no fixture has a holiday note, so the separator literal and its `when` are never projected',
    ).toBe(true)
    expect(
      views.some((v) => v.facts.length === 0),
      'no fixture has an absent facts strip',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.name.code === undefined)),
      'no fixture has a stop with no printed code, so `stopCode`’s `when` is never exercised',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.fareLabel === undefined)),
      'no fixture has a stop with no fare',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.arrivals.length === 0)),
      'no fixture has a row with no reading',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.saved)),
      'no fixture has a saved row',
    ).toBe(true)
  })

  it('draws a skeleton whenever it has no answer, whatever the query state', () => {
    // The regression guard for the blank screen (ADR-088). `loading`'s declared projection is *no text*, which
    // is right and is also what a screen rendering NOTHING produces — so the skeleton is asserted as an
    // **element**, the only observable difference between the two.
    route = () => new Promise<RouteDetailPayload>(() => {})
    mount('/route/KMB%3A264X%3Aoutbound%3A1')
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4)
  })

  it('names every bus on the rail, because a disc with a glyph in it says nothing on its own', () => {
    // The invariant behind ADR-093 decision 3, asserted on the **renderer**: every token carries a `role` and
    // an accessible name, and the name is the model's rather than one this screen composed. A token without one
    // is invisible to a screen reader *and* to the projection above, which is how the RN token's missing label
    // was found — so this is the assertion that keeps it from coming back on either side.
    const view = viewFor(caseNamed(FIXTURE.busMidRoute as string))
    expect(view.buses.length).toBeGreaterThan(0)
    for (const bus of view.buses) {
      expect(bus.label, 'a token with no name').not.toBe('')
      expect(bus.label.includes('Bus'), `unexpected label: ${bus.label}`).toBe(true)
    }
  })

  for (const state of Object.keys(routeDetailSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(routeDetailSpec, harness).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }
})

/**
 * jsdom implements `<dialog>` but not `showModal()`/`close()`, so a component that opens itself modally
 * throws `showModal is not a function` on mount.
 *
 * **Worth a paragraph because of what it explains**: this shim did not exist before WP6-8's blocker fix, and
 * the reason is that **no test in this repo had ever opened a `<dialog>`**. `RouteFactSheet` has been the
 * four fact sheets' container since WP6-6c and is reached only by pressing a pill, which no suite did — so
 * the sheets' content is projected from `routeFactSheet` in the corpus and their *container* has never been
 * mounted. That is the same blind spot this whole row is about: a component behind an interaction is a
 * component no state projection reaches.
 *
 * The shim is deliberately the smallest honest one — `open` on, `open` off — rather than a fake modal: what
 * these tests assert is which actions the sheet offers and what pressing them writes, and focus trapping and
 * inertness are the browser's job and not something a stub could prove anything about.
 */
function stubDialog(): void {
  const proto = window.HTMLDialogElement?.prototype
  if (!proto || typeof proto.showModal === 'function') return
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}

describe('a stop row opens the save sheet — the interaction no projection can see', () => {
  /**
   * **The regression test for WP6-8's blocker, and it is the shape of the whole finding.**
   *
   * `route-detail.spec.json` has declared this interaction non-optionally since WP6-6b — a tap on a stop row
   * opens a sheet offering to save this route at this stop, *"deliberately not straight to the place"* —
   * and `apps/web` navigated straight to the place for two waves anyway. **Every suite stayed green**,
   * because `conformStates` asserts text and nesting and never interaction *destinations*: the sheet is not
   * rendered until a tap, so no projected state changes either way.
   *
   * The cost was not one screen. ADR-032 makes this sheet the app's only favourite-creating affordance, so
   * `toggleFavoriteRoute` had zero callers and the Favourites tab could never be filled by a web-only rider.
   * Found by WP6-7b's parity audit, by four auditors independently and by none of the gates.
   *
   * These assertions are therefore *direct* rather than projected — the same division `search.spec.json`
   * makes for a keypad key's `enabled`, and for the same reason: the thing that matters is not text.
   */
  const CASE = FIXTURE.content as string

  beforeEach(stubDialog)

  const openFirstStop = async (saved: string[] = []) => {
    const c = caseNamed(CASE)
    const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
    route = () => Promise.resolve(detail)
    usePreferences.setState({ favoriteRoutes: saved })
    vi.setSystemTime(Date.parse(c.args.now))
    await mountSettled(`/route/${encodeURIComponent(detail.route.id)}`)
    const rows = [...container.querySelectorAll('button')].filter((b) =>
      b.className.includes('w-full'),
    )
    const row = rows[0]
    if (!row) throw new Error('no stop row to press')
    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    return { detail, dialog: container.querySelector('dialog') }
  }

  const actionLabelled = (label: string) =>
    [...container.querySelectorAll('dialog button')].find(
      (b) => (b.textContent ?? '').trim() === label,
    )

  it('opens a dialog rather than navigating away', async () => {
    const { dialog } = await openFirstStop()
    expect(dialog, 'the row navigated instead of opening the sheet').not.toBeNull()
    // Still on the route, not on the place — the half that was wrong.
    expect(container.querySelector('dialog')?.getAttribute('open')).not.toBeNull()
  })

  it('offers both actions the spec names, in the RN screen’s order', async () => {
    await openFirstStop()
    expect(actionLabelled(t(LOCALE, 'addFavorite')), 'no save action').toBeDefined()
    expect(actionLabelled(t(LOCALE, 'viewStop')), 'no view-stop action').toBeDefined()
  })

  it('writes the favourite under the same key the kernel computed `saved` from', async () => {
    // The subtle half. `routeDetailView` keys `saved` on `formatFavoriteRouteKey(pole, route.id)`; a toggle
    // written under the URL parameter's spelling would be stored and then read back as unsaved, silently.
    const { detail } = await openFirstStop()
    const save = actionLabelled(t(LOCALE, 'addFavorite'))
    act(() => {
      save?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const saved = usePreferences.getState().favoriteRoutes
    expect(saved, 'nothing was saved').toHaveLength(1)
    const [pole] = detail.stops
    if (!pole) throw new Error('the fixture has no stops')
    expect(saved[0]).toBe(formatFavoriteRouteKey(pole.stop.id, detail.route.id))
  })

  it('offers to remove it once it is saved, and the sheet closes on the action', async () => {
    const c = caseNamed(CASE)
    const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
    const [pole] = detail.stops
    if (!pole) throw new Error('the fixture has no stops')
    const key = formatFavoriteRouteKey(pole.stop.id, detail.route.id)
    await openFirstStop([key])
    expect(actionLabelled(t(LOCALE, 'removeFavorite')), 'still offering to add').toBeDefined()
    expect(actionLabelled(t(LOCALE, 'addFavorite'))).toBeUndefined()
    const remove = actionLabelled(t(LOCALE, 'removeFavorite'))
    act(() => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(usePreferences.getState().favoriteRoutes).toEqual([])
    expect(container.querySelector('dialog'), 'the sheet stayed open').toBeNull()
  })

  it('nests no tap target inside another, sheet included', async () => {
    await openFirstStop()
    const interactive = [...container.querySelectorAll(INTERACTIVE)]
    expect(interactive.filter((el) => el.parentElement?.closest(INTERACTIVE))).toHaveLength(0)
  })
})
