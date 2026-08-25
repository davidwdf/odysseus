// @vitest-environment jsdom
//
// The React Native Route screen's conformance suite: **the same published spec the DOM screen drives**
// (WP6-6b, ADR-094) — `packages/contract/ui/route-detail.spec.json`, twenty states, nineteen projected.
//
// WHY BOTH SIDES OF THIS EXIST
// ADR-069's honest gap was a projection suite on one renderer and none on the other, pointing the wrong way:
// `apps/mobile` is the app riders use today. This is the half that measures the **reference implementation**
// against the specification extracted from it, and — as with Place detail before WP6-3b — it is the first
// suite in the repo that renders this screen at all.
//
// THE SEAMS ARE MOCKED; THE SCREEN, THE STORE AND THE QUERY ARE REAL. The `DataSource`, the served policy,
// and the platform modules jsdom has no answer for (`expo-router`'s params, the safe-area insets, the locale
// provider, `nativewind`, `expo-blur`). The preferences store is **not** mocked: which rows are starred is
// this screen's input, and `savedStop` is a state about it. Reanimated is aliased to `test/reanimated-shim.tsx`
// in `vitest.config.ts` — read its header before touching this file.
//
// THE FIXTURES ARE THE CORPUS'S OWN `routeDetailView` CASES, one per state, so this suite's goldens and the
// DOM suite's are the same bytes and the same kernel call.

import routeDetailSpec from '@nextbus/contract/ui/route-detail.spec.json'
import {
  CLIENT_POLICY_DEFAULTS,
  feedNotice,
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
    arrivedFromStop?: string
    flipped?: boolean
    savedRouteKeys?: string[]
    policy?: typeof CLIENT_POLICY_DEFAULTS
  }
  expect: unknown
}

const CASES = corpus.groups.routeDetailView.cases as unknown as CorpusCase[]

/** The corpus case each state is driven from — the identical table as the DOM suite's. */
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
  // Driven with the clock moved past the served threshold rather than with an old fixture — see the note in
  // `fixture`. The case is kept because its two boards of different ages are what makes "the newest board on
  // screen" a real question rather than a single value.
  stale: 'a-stale-board-dims-every-slot-on-its-row-together',
  // The same payload as `content`, with the platform reporting no network.
  offline: 'a-bus-mid-route-rides-the-segment-leading-into-its-stop',
  sparseFacts: 'a-sparse-service-block-yields-only-the-facts-it-can-support',
  noFacts: 'a-route-with-no-service-block-has-no-facts-strip-at-all',
  holidayFare: 'a-holiday-fare-is-a-note-on-the-fare-pill-never-a-pill-of-its-own',
  empty: 'an-empty-sequence-still-names-the-route-from-its-own-labels',
  // ADR-114's two arms. Same sentence today and two states deliberately: one is worth retrying and the
  // other never will be, so giving either its own words later is an edit to one `shows`.
  noLiveBoard: 'a-citybus-route-says-its-times-are-per-stop-rather-than-reading-as-empty',
  arrivalsUnavailable: 'a-round-the-route-feed-did-not-answer-is-not-a-route-with-no-buses',
  // ADR-116's answer to the first of those two: the same Citybus route, once a live route watch has
  // answered it. Reached from a payload a round produced, which is what a driver is allowed to do.
  liveRouteTimes: 'a-live-route-watch-fills-the-rows-a-citybus-route-cannot-fill-itself',
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

/**
 * `navigator.onLine` is a prototype getter, so the state a screen reads is set by redefining it. Under
 * `react-native-web` `useOnline` reads the browser's own API; on native there is none and it answers `true`.
 */
function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online })
}

/**
 * The freshness notice the screen will have computed for this view — the same kernel call it makes, over the
 * view's own `lastUpdatedIso` (ADR-133, wired on this renderer by ADR-150).
 *
 * Silent for every fixture but `stale` and `offline`: this corpus's boards are seconds old, which is what a
 * working route looks like and is exactly when the line must not appear.
 */
function noticeFor(view: RouteDetailView, at: number, opts: { online: boolean }) {
  return feedNotice({
    lastUpdatedIso: view.lastUpdatedIso,
    now: at,
    online: opts.online,
    trouble: 'none',
    staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
  })
}

function viewFor(c: CorpusCase, at = Date.parse(c.args.now)): RouteDetailView {
  return routeDetailView(fromCorpus<RouteDetailPayload>(c.args.detail), {
    locale: c.args.locale,
    now: at,
    labels,
    ...(c.args.arrivedFromStop === undefined ? {} : { arrivedFromStop: c.args.arrivedFromStop }),
    ...(c.args.flipped === undefined ? {} : { flipped: c.args.flipped }),
    ...(c.args.savedRouteKeys === undefined ? {} : { savedRouteKeys: c.args.savedRouteKeys }),
    ...(c.args.policy === undefined ? {} : { policy: c.args.policy }),
  })
}

// ── the seams, and the platform modules ────────────────────────────────────────────────────────

let route: () => Promise<RouteDetailPayload> = () => Promise.reject(new Error('no fixture set'))
/** The route parameters the screen reads its id and its boarding stop from. */
let params: { id: string; stop?: string } = { id: 'KMB:264X:outbound:1' }

vi.mock('../lib/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../lib/datasource', () => ({
  dataSource: { getRoute: () => route(), getClientPolicy: () => Promise.resolve(undefined) },
}))
// `expo-router` cannot load outside Metro, and `useLocalSearchParams` is this screen's **input**: without an
// id the query is disabled and the screen renders nothing, which the DOM suite's first run proved is
// indistinguishable from a renderer that draws nothing.
// `useNavigation` is reached through `usePageRevealReady`, which subscribes to the stack's opening
// `transitionEnd` — a navigator event there is no navigator for here. A listener that never fires is the
// honest stand-in: the reveal's second beat is *when* the auto-scroll runs, and where a row ends up on screen
// is geometry (`docs/07` records that the real scroll does not land on web at all). The spec says as much on
// `anchored`, whose claim is that the anchor changes **nothing** about what is shown.
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  useRouter: () => ({ push: () => {}, back: () => {} }),
  useNavigation: () => ({ addListener: () => () => {} }),
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// See `place-detail-states.test.tsx` for the long version of both: `nativewind` re-exports a package whose
// `main` has no extension, so the resolver hands node a `.d.ts` and the run dies at import with no stack; and
// `expo-blur` reads a Metro global at import time. Both are styling and material, which ADR-075 puts on the
// idiom side, and neither draws text.
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
vi.mock('expo-blur', async () => ({ BlurView: (await import('react-native')).View }))
// **Two more than the Place screen needed, and both die the same way** — with `SyntaxError: Unexpected token
// 'typeof'` and no stack, no file and no package name, because their `main` resolves to a `.d.ts`. Found by
// bisecting the import graph one module at a time, which is the second time this wave that has been the only
// way in: `react-native-svg` (reached through `BusGlyph`, the double-decker inside the bus token) and
// `react-native-gesture-handler` (reached through `BottomSheet`, the tapped-stop sheet).
//
// Both substitutions are honest for this suite's subject. The glyph is a **graphic** — the token's meaning is
// its accessible name, which the shim leaves untouched and which is the whole point of ADR-093 decision 3 —
// and a gesture is motion, which ADR-075 puts on the idiom side. What this suite therefore cannot see is a
// drawn bus or a pan; what it can see is every string the screen shows in each of the spec's states.
vi.mock('react-native-svg', async () => {
  const { View } = await import('react-native')
  return { default: View, Svg: View, Rect: View, Path: View, G: View, Circle: View }
})
vi.mock('react-native-gesture-handler', async () => {
  const { View } = await import('react-native')
  const pan = () => ({ onBegin: () => pan(), onChange: () => pan(), onEnd: () => pan() })
  return { Gesture: { Pan: pan }, GestureDetector: View }
})
// `useLocale` reaches `expo-localization` → a Metro global. Pinning it is the right answer rather than
// defining the global: the corpus fixtures are `en`, so an uncontrolled locale would compare an English
// projection against a Chinese render.
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => 'en' }))

/**
 * `onLayout` needs a `ResizeObserver`, and jsdom has none.
 *
 * **Without this the bus tokens do not render at all**, and the reason is worth writing down because it looks
 * exactly like a renderer that draws no buses: each stop row reports its own offset on layout, and a token
 * whose target row has not reported one is skipped — correctly, since there is nowhere to put it. So a harness
 * with no layout engine sees an empty rail, which is the fourth appearance this wave of *a harness that looks
 * at the wrong moment (or cannot supply the input) is indistinguishable from a renderer that is wrong.*
 *
 * The stub fires once per observed element with jsdom's zero rect, which is enough: every row reports an
 * offset of 0, every token therefore has a position, and **this suite's subject is the token's name rather
 * than its `top`** — where it lands is geometry, and the spec's `idiom` list says so. It is the same
 * substitution as the reanimated shim, for the same reason.
 */
class ImmediateResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve(): void {}
  disconnect(): void {}
}

// Installed at module scope, **before** `react-native-web` is imported: its `useElementLayout` captures the
// constructor once, so assigning it inside `beforeEach` is too late and the rail stays empty.
globalThis.ResizeObserver = ImmediateResizeObserver as unknown as typeof ResizeObserver

const RouteDetailScreen = (await import('../app/route/[id]')).default
const { usePreferences } = await import('../lib/preferences')

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
 * The tree, read in **reading order** — which here is not document order, twice over.
 *
 * **1. The floating header is the root's *last* child**, because in React Native later siblings paint on top,
 * and it is where the route number and both ends of the journey are. Document order would put them after 34
 * stop rows. Same reason and same treatment as the Place screen's driver.
 *
 * **2. Inside that header, later siblings paint on top too**, so its own children are read in reverse: the
 * morphing badge (the route number) is rendered last precisely so it sits above the journey card, which means
 * reverse order *is* visual order. Without this the chrome would read origin-destination-number and the two
 * renderers would disagree about the order of a screen that looks identical.
 *
 * **And the collapsed journey label is dropped.** `CollapsingHeader` renders a one-line marquee (`→ Central`)
 * that cross-fades in as the header shrinks, so at rest it is present in the tree and invisible on screen —
 * and `apps/web` has no collapsed size at all. That is why the spec projects `origin` and `destination` and
 * **not** the two composed labels, and why each suite asserts the narrower thing separately (see the test
 * below). What this driver therefore cannot see is a journey drawn in the wrong place *on screen*, only one
 * that is missing or wrong — declared on the spec's `routeNo` slot rather than left to be discovered.
 *
 * The bus tokens are appended last, from their accessible names: a token is a graphic whose whole content is
 * its name, so it contributes no text node at all. The DOM driver makes the same move for the same reason.
 */
function readTree(host: HTMLElement, view: RouteDetailView | undefined): RenderedTree {
  const screen = host.firstElementChild
  const body = screen?.children[0]
  const chrome = screen?.children[1]
  // The composed labels to drop — **minus whatever is also a plain field**, which is the clause the circular
  // route found: a loop's `collapsedLabel` *is* its `destination` ("Circular via Tin Shui Wai"), because there
  // is no arrow and no origin to shorten away. Dropping the string outright therefore deleted the destination
  // as well and the suite reported the fare two nodes later. A composed label that happens to equal a plain
  // field is the plain field.
  const composed = new Set(
    [view?.header.label].filter(
      (value): value is string =>
        value !== undefined && value !== view?.header.origin && value !== view?.header.destination,
    ),
  )
  // **Reverse order, with the collapsed marquee dropped structurally rather than by value.** Later siblings
  // paint on top in React Native, so reversing `CollapsingHeader`'s children is visual order: the back lens
  // (no text), the morphing badge, the collapsed one-line marquee, then the expanded journey card.
  //
  // The marquee is dropped as a **node** because at rest it is in the tree and invisible on screen — and
  // dropping it by *value* is what the circular route caught: a loop's `collapsedLabel` **is** its
  // `destination` ("Circular via Tin Shui Wai"), since there is no arrow and no origin to shorten away, so a
  // value filter deleted the destination too and the suite reported the fare two nodes later. One node, the
  // first one in visual order whose whole text is that label.
  const children = chrome === undefined || chrome === null ? [] : [...chrome.children].reverse()
  const collapsedNode = children.find((child) => {
    const text = textOf(child)
    return text.length === 1 && text[0] === view?.header.collapsedLabel
  })
  const chromeText = [
    ...new Set(
      children
        .filter((child) => child !== collapsedNode)
        .flatMap((child) => textOf(child))
        .filter((value) => !composed.has(value)),
    ),
  ]
  const bodyText = body ? textOf(body) : []
  const busLabels = [...host.querySelectorAll('[role="img"][aria-label]')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  )
  const interactive = [...host.querySelectorAll(INTERACTIVE)]
  return {
    text: [...chromeText, ...bodyText, ...busLabels],
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <RouteDetailScreen />
      </QueryClientProvider>,
    )
  })
}

/**
 * Mount, then wait — bounded — until the screen has something to say.
 *
 * "Has any text at all" is the condition, as on Place detail: this screen shows no word while it loads (the
 * header is absent and the body is five skeleton blocks), which makes an empty tree the precise signal for
 * "not settled" and a timeout a **finding** rather than a flake.
 */
async function mountSettled(view: RouteDetailView | undefined): Promise<RenderedTree> {
  mount()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tree = readTree(container, view)
    if (tree.text.length > 0) return tree
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error('the screen settled with no text at all — it is showing the rider nothing')
}

const FETCH_FAILURE = 'unknown route: KMB:999X:outbound:1'

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  if (state === 'loading') {
    route = () => new Promise<RouteDetailPayload>(() => {})
    mount()
    return { view: {}, tree: readTree(container, undefined) }
  }
  if (state === 'failed') {
    route = () => Promise.reject(new Error(FETCH_FAILURE))
    return { view: { error: FETCH_FAILURE }, tree: await mountSettled(undefined) }
  }
  const name = FIXTURE[state]
  if (name === undefined) return null
  const c = caseNamed(name)
  const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
  route = () => Promise.resolve(detail)
  usePreferences.setState({ favoriteRoutes: [...(c.args.savedRouteKeys ?? [])] })
  /**
   * **`stale` is driven with the clock moved past the served threshold, not with a stale fixture** (ADR-150).
   *
   * It used to be driven by a corpus case whose *one* row carries an old board, because the state was about
   * that row dimming — and since ADR-123 there is no per-row cue to observe. What replaced it is a statement
   * about the screen, so the fixture has to make the whole screen old: `now` moves past `staleAfterMs`, and
   * the same clock produces the view, so the readings age with it rather than diverging from a golden taken
   * at another moment.
   */
  const at =
    state === 'stale'
      ? Date.parse(c.args.now) + CLIENT_POLICY_DEFAULTS.staleAfterMs + 1_000
      : Date.parse(c.args.now)
  setOnline(state !== 'offline')
  vi.setSystemTime(at)
  const view = viewFor(c, at)
  // **`flipped` is reached by flipping**, which is the honest path on this renderer: the toggle sets a local
  // override rather than navigating, so a driver that set the state directly would be asserting that the
  // screen renders a view it was handed — which nothing doubted. The mocked `DataSource` answers any id with
  // the same payload, so the reverse direction is this fixture's own rows seen with the anchor dropped, which
  // is exactly what the corpus case records.
  params =
    c.args.arrivedFromStop === undefined
      ? { id: detail.route.id }
      : { id: detail.route.id, stop: c.args.arrivedFromStop }
  const notice = noticeFor(view, at, { online: state !== 'offline' })
  const tree = await mountSettled(view)
  if (c.args.flipped !== true) return { view: { ...view, notice }, tree }
  const toggle = [...container.querySelectorAll(INTERACTIVE)].find(
    (el) => el.getAttribute('aria-label') === t(LOCALE, 'reverseDirection'),
  )
  if (!toggle) throw new Error('no reverse toggle to press — this driver cannot reach `flipped`')
  await act(async () => {
    ;(toggle as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { view: { ...view, notice }, tree: readTree(container, view) }
}

beforeEach(() => {
  route = () => Promise.reject(new Error('no fixture set'))
  params = { id: 'KMB:264X:outbound:1' }
  vi.useFakeTimers({ shouldAdvanceTime: true })
  usePreferences.setState({ favoriteRoutes: [] })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

/**
 * **The four map states this renderer has no map for** (ADR-154) — named here rather than filtered
 * silently, because ADR-069's whole finding was that an asymmetry living only in a driver is an
 * asymmetry nobody sees. The published spec carries the same statement in its `idiom` list, so the
 * gap is legible to a reader who never opens this file.
 *
 * The map is MapLibre GL JS, which is WebGL and web-only. The React Native equivalent is a **native
 * module** (`@maplibre/maplibre-react-native`), so adding it would end this app's ability to run in
 * Expo Go — which is how it is developed. That is a real cost against a renderer ADR-075 is in the
 * process of retiring, so the map ships on `apps/web` and this list is the receipt.
 *
 * If `apps/mobile` outlives that plan, these four are the row to close, and closing it is a fixture
 * table and a component rather than a spec change: the states are already declared and already
 * measured on the other side.
 */
const NO_MAP_ON_NATIVE = new Set(['pathSurveyed', 'pathApproximate', 'pathAbsent', 'pathPending'])

describe('apps/mobile conforms to Route detail’s published spec, state by state', () => {
  it('has the states the spec declares, and a corpus case for each projected one', () => {
    expect(routeDetailSpec.component).toBe('RouteDetail')
    expect(Object.keys(routeDetailSpec.states).length).toBeGreaterThanOrEqual(21)
    const projected = Object.entries(routeDetailSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(21)
    for (const state of projected) {
      // `NO_MAP_ON_NATIVE` is the declared, documented exception — and it is checked rather than
      // trusted: a state named there that the spec has dropped would sit in this set for ever,
      // quietly excusing nothing.
      if (NO_MAP_ON_NATIVE.has(state)) continue
      expect(
        FIXTURE[state] !== undefined || state === 'loading' || state === 'failed',
        `${state} is projected and this driver cannot reach it`,
      ).toBe(true)
    }
    for (const state of NO_MAP_ON_NATIVE) {
      expect(state in routeDetailSpec.states, `${state} is excused and no longer exists`).toBe(true)
    }
  })

  it('exercises every arm its fixtures are meant to — the control the WP6-3b injection found missing', () => {
    // The same audit as the DOM suite's, deliberately duplicated: *the declaration is shared and the reading
    // is not* (ADR-069 decision 7), and this is a reading. A `oneOf` case nothing drives is a specification
    // looking at nothing.
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
      'no fixture leaves the rail empty',
    ).toBe(true)
    expect(
      views.some((v) => v.facts.some((f) => f.note !== undefined)),
      'no fixture has a holiday note',
    ).toBe(true)
    expect(
      views.some((v) => v.facts.length === 0),
      'no fixture has an absent strip',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.name.code === undefined)),
      'no fixture has a stop with no printed code',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.arrivals.length === 0)),
      'no fixture has a row with no reading',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.saved)),
      'no fixture has a saved row',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.incomplete === true)),
      'no fixture has a kerb the round could not ask about, so `stopIncomplete` is declared and driven by nothing',
    ).toBe(true)
    expect(
      views.some((v) => v.stops.some((s) => s.incomplete === true && s.arrivals.length > 0)),
      'no fixture has a refused kerb that kept its last reading — the row shape where the marker and a time must both show',
    ).toBe(true)
    expect(
      views.some((v) => v.header.circular),
      'no fixture is a loop',
    ).toBe(true)
    expect(
      views.some((v) => v.header.reverseId !== undefined),
      'no fixture has a reverse direction, so the toggle is never drawn',
    ).toBe(true)
  })

  it('draws a skeleton whenever it has no answer, whatever the query state', () => {
    // The regression guard for the blank screen (ADR-088): `loading` projects *no text*, which is right and is
    // also what a screen rendering NOTHING produces, so the skeleton is asserted as an **element**.
    route = () => new Promise<RouteDetailPayload>(() => {})
    mount()
    const body = container.firstElementChild?.children[0]
    expect(body?.querySelectorAll('div').length ?? 0).toBeGreaterThanOrEqual(5)
  })

  it('gives every bus token a role and the kernel’s own name', async () => {
    // ADR-093 decision 3, asserted on the **renderer** rather than through the projection: the tokens carry a
    // `role` and an `accessibilityLabel`, and the label is `RailBus.label` rather than something this screen
    // composed. Before WP6-6a they carried neither, which no test could have noticed — the projection cannot
    // see a graphic, and that is exactly how the hole was found.
    const c = caseNamed(FIXTURE.busMidRoute as string)
    const view = viewFor(c)
    route = () => Promise.resolve(fromCorpus<RouteDetailPayload>(c.args.detail))
    params = { id: view.header.routeNo === '' ? 'x' : 'KMB:264X:outbound:1' }
    vi.setSystemTime(Date.parse(c.args.now))
    // Settled, not merely mounted: the tokens exist only once the payload has arrived, and a bare `mount()`
    // reported zero of them — which is the *"a harness that looks at the wrong moment is indistinguishable
    // from a renderer that is wrong"* trap this wave has now hit four times.
    await mountSettled(view)
    const tokens = [...container.querySelectorAll('[role="img"][aria-label]')]
    expect(tokens.length, 'no named bus token on the rail').toBe(view.buses.length)
    expect(tokens.map((el) => el.getAttribute('aria-label'))).toEqual(
      view.buses.map((bus) => bus.label),
    )
  })

  for (const state of Object.keys(routeDetailSpec.states)) {
    if (NO_MAP_ON_NATIVE.has(state)) {
      it.skip(`in ${state} — no map on this renderer, see NO_MAP_ON_NATIVE`, () => {})
      continue
    }
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
