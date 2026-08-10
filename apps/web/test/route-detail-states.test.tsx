// The DOM renderer's Route detail conformance suite: it drives the published spec (WP6-6b, ADR-094) —
// `packages/contract/ui/route-detail.spec.json`, twenty states, nineteen of them projected.
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
import { RailBusToken } from '../src/components/RailBusToken'
import { RouteStopRow } from '../src/components/RouteStopRow'

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
  // ADR-114's two arms. Same sentence today and two states deliberately: one is worth retrying and the
  // other never will be, so giving either its own words later is an edit to one `shows`.
  noLiveBoard: 'a-citybus-route-says-its-times-are-per-stop-rather-than-reading-as-empty',
  arrivalsUnavailable: 'a-round-the-route-feed-did-not-answer-is-not-a-route-with-no-buses',
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
    expect(Object.keys(routeDetailSpec.states).length).toBeGreaterThanOrEqual(20)
    const projected = Object.entries(routeDetailSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(18)
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
    // **The sheet closes after its exit animation, not during it**, which is a deliberate change: a panel
    // that vanishes the instant you press it has no slide-out, and `BottomSheet.requestClose()` therefore
    // runs the 220 ms transform and *then* calls `onClose`. The store is written immediately either way —
    // the favourite is gone before the animation starts, which is the ordering that matters to a rider.
    expect(
      container.querySelector('dialog'),
      'the sheet closed before it could animate out',
    ).not.toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    expect(container.querySelector('dialog'), 'the sheet stayed open').toBeNull()
  })

  it('nests no tap target inside another, sheet included', async () => {
    await openFirstStop()
    const interactive = [...container.querySelectorAll(INTERACTIVE)]
    expect(interactive.filter((el) => el.parentElement?.closest(INTERACTIVE))).toHaveLength(0)
  })

  it('does not let the dialog itself scroll, which would drag the panel off the bottom edge', async () => {
    // The panel hangs `UNDERLAP` px below the viewport on purpose, so an upward rubber-band never bares the
    // scrim. That also makes the `<dialog>` — which the UA stylesheet gives `overflow: auto` — a scroll
    // container with 320 px of content in it, and a mouse wheel scrolled it: the panel slid up and left a
    // screenful of empty sheet behind it. Invisible to a touch device, because a drag is handled by the
    // pointer handlers and never reaches a scroller, so this is one of the few defects that exists only on
    // the platform this renderer is *for*.
    await openFirstStop()
    const dialog = container.querySelector('dialog')
    expect(dialog?.className, 'the dialog can scroll its own underlap').toContain('overflow-hidden')
    // …and the content that is *meant* to scroll is the panel's body, which keeps its own scroller.
    expect(container.querySelector('.sheet-panel')).not.toBeNull()
  })

  it('cancels the entrance keyframes before it writes the exit transform', async () => {
    // **The one thing here that a projection could never fail on, and it shipped broken for an afternoon.**
    //
    // `.sheet-panel` runs `sheet-in` with `animation-fill-mode: both`, so after the entrance settles the
    // animation *keeps* applying `transform: none` — and a filled animation outranks inline style in the
    // cascade. `requestClose()` wrote `style.transform` and the computed value stayed at the identity
    // matrix: on a scrim tap or `Escape` the panel sat perfectly still for 220 ms and then blinked out.
    // Drag-to-dismiss animated correctly the whole time, because `onPointerDown` cancels before it drags —
    // which is precisely why the cancel is one function called from both paths now.
    //
    // jsdom runs no animations, so this asserts the *mechanism* rather than the picture: the panel's
    // animations are cancelled, and only then is the exit transform written. That is the smallest claim
    // that fails if the call is dropped again.
    await openFirstStop()
    const panel = container.querySelector<HTMLElement>('.sheet-panel')
    const scrim = container.querySelector<HTMLElement>('.sheet-scrim')
    if (!panel || !scrim) throw new Error('the sheet rendered without a panel or a scrim')
    let transformWhenCancelled: string | null = null
    const cancel = vi.fn(() => {
      transformWhenCancelled = panel.style.transform
    })
    panel.getAnimations = () => [{ cancel } as unknown as Animation]
    act(() => {
      scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(cancel, 'the entrance keyframes were left filling over the exit').toHaveBeenCalled()
    expect(transformWhenCancelled, 'cancelled after the transform, which is too late').toBe('')
    expect(panel.style.transform, 'no exit transform was written at all').not.toBe('')
  })
})

describe('a bus rides inside its own row, and nothing measures where it goes', () => {
  /**
   * **The replacement for a registry that put a bus in the wrong place twice.**
   *
   * Until ADR-110 the tokens were an overlay whose `top` came from measured row offsets, kept fresh by a
   * `ResizeObserver`; the two tests that used to live here pinned that subscription, because it had stopped
   * seeing things — first watching only the list container (blind to a reflow that leaves the list the same
   * height), then never attaching at all (ADR-108). They are gone with the mechanism they guarded, and what
   * replaces them is stronger than what they could assert: **no measured number reaches the DOM at all.**
   *
   * jsdom lays nothing out, so a positional assertion here would compare zeroes either way — but structure
   * and a literal CSS expression are things it *can* see, and they are the whole of the new invariant. A
   * token in the wrong row, or a token whose `top` is a computed pixel value, is the defect; both are read
   * straight off the tree.
   */
  const CASE = FIXTURE.busMidRoute as string

  /** The stop rows, in document order. */
  function rowElements(): HTMLElement[] {
    return [...container.querySelectorAll('button')].filter((b) => b.className.includes('min-h-16'))
  }

  async function mountCase(): Promise<void> {
    const c = caseNamed(CASE)
    const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
    route = () => Promise.resolve(detail)
    vi.setSystemTime(Date.parse(c.args.now))
    await mountSettled(`/route/${encodeURIComponent(detail.route.id)}`)
  }

  it('draws each token inside the row the kernel names, not in an overlay', async () => {
    await mountCase()
    const rows = rowElements()
    const view = viewFor(caseNamed(CASE))
    const tokens = [...container.querySelectorAll('[role="img"][aria-label]')]
    expect(tokens.length, 'the fixture drew no bus tokens').toBe(view.buses.length)
    view.buses.forEach((bus, ordinal) => {
      // A bus AT node N belongs to row N; a bus on the segment INTO node N belongs to row N−1, whose
      // bottom half it rides. `railBus` only ever emits `from: toIndex − 1`, so there is no third case.
      const owner = bus.kind === 'node' ? bus.index : bus.from
      // The row button's **sibling**, not its descendant: a labelled `role="img"` inside a button is folded
      // into that button's accessible name, so the wrapper is what the token is positioned against.
      expect(
        tokens[ordinal]?.parentElement === rows[owner]?.parentElement,
        `bus ${ordinal} (${bus.kind}) does not belong to row ${owner} — its position is not that row's any more`,
      ).toBe(true)
      expect(
        rows[owner]?.contains(tokens[ordinal] ?? null),
        `bus ${ordinal} is inside the row's button, which folds its label into the button's name`,
      ).toBe(false)
    })
  })

  it('positions it with a constant expression, so no reflow can leave it behind', async () => {
    await mountCase()
    const view = viewFor(caseNamed(CASE))
    const tokens = [...container.querySelectorAll('[role="img"][aria-label]')]
    view.buses.forEach((bus, ordinal) => {
      const token = tokens[ordinal]
      if (!(token instanceof window.HTMLElement))
        throw new Error(`bus ${ordinal} is not an element`)
      // `13px` is NODE_CENTRE (25) less half a token (12). The segment case adds half of the *from* row,
      // and it is a percentage rather than a number precisely so a row that grows an arrivals line takes
      // its bus with it — which is the reflow the observer used to have to notice.
      expect(
        token.style.top,
        `bus ${ordinal} is positioned by a computed value — that is a number that can go stale`,
      ).toBe(bus.kind === 'node' ? '13px' : 'calc(50% + 13px)')
    })
  })

  it('tells the travel where each bus is on the route, not merely which row it is in', async () => {
    // `data-bus-at` is what `useRailFlip` matches a moved token to its past by (ADR-111), and a segment is
    // deliberately the **half**-step between the nodes it spans: a node and the segment leading out of it
    // are different places half a row apart, and one number has to order them. The row alone cannot — both
    // of those live in the same row.
    await mountCase()
    const view = viewFor(caseNamed(CASE))
    const tokens = [...container.querySelectorAll('[role="img"][aria-label]')]
    expect(tokens.map((el) => el.getAttribute('data-bus-at'))).toEqual(
      view.buses.map((bus) => String(bus.kind === 'node' ? bus.index : bus.from + 0.5)),
    )
  })

  it('projects the tokens in the model’s order', async () => {
    await mountCase()
    const view = viewFor(caseNamed(CASE))
    const labels = [...container.querySelectorAll('[role="img"][aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    )
    expect(labels).toEqual(view.buses.map((bus) => bus.label))
  })

  it('draws two buses on one row in the model’s order, not its own', () => {
    /*
      The tie the overlay never had to think about, and no corpus case reaches: a bus held on the origin
      node while the one behind it approaches stop 1 puts a **node** token and a **segment** token in row 0.
      (`railBus` makes stop 0 a node token even when it is not due, and `ORIGIN_BUS_DEPARTS_WITHIN_SEC`
      keeps it visible for two minutes.)

      It matters because document order is what both conformance suites project. With an overlay the order
      was `view.buses`' by construction — one map, one parent. Per-row parenting makes it the row's job, so
      the row is driven directly here rather than through a payload that cannot produce the case.
    */
    const row = caseNamed(CASE)
    const view = viewFor(row)
    const first = view.stops[0]
    if (first === undefined) throw new Error('the fixture has no first stop')
    root = createRoot(container)
    act(() => {
      root?.render(
        <RouteStopRow
          row={first}
          index={0}
          animateIn={false}
          tokens={[
            <RailBusToken
              key={0}
              ordinal={0}
              bus={{ kind: 'node', index: 0, label: 'at the terminus' }}
            />,
            <RailBusToken
              key={1}
              ordinal={1}
              bus={{ kind: 'segment', from: 0, to: 1, label: 'approaching stop 1' }}
            />,
          ]}
          onPress={() => {}}
          registerRow={() => {}}
        />,
      )
    })
    const tokens = [...container.querySelectorAll('[role="img"][aria-label]')]
    expect(tokens.map((el) => el.getAttribute('aria-label'))).toEqual([
      'at the terminus',
      'approaching stop 1',
    ])
    expect(tokens.map((el) => (el as HTMLElement).style.top)).toEqual(['13px', 'calc(50% + 13px)'])
  })
})
