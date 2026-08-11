// The scroll-spy's **registry**, which is the one part of Place detail that outlives the elements it holds.
//
// WHY A SECOND HARNESS RATHER THAN A CASE IN `place-detail-states.test.tsx`
// That suite mounts one place per `it` and reads a tree. The claim here needs the opposite: **one mount that
// outlives two places**, because the defect is a ref callback's cleanup and a cleanup is only observable when
// an element goes away while the thing that registered it stays. So this file owns a router with a live
// `navigate`, and every assertion is about registry *membership* rather than about a rendering.
//
// WHAT IT WATCHES, AND HOW IT CAN SEE IT AT ALL
// `sections` is a `useRef(new Map())` inside the screen — no test can read it directly, and it should stay
// that way. But the scroll listener *iterates it* and calls `getBoundingClientRect()` on every member, so the
// set of elements measured during one scroll pass **is** the registry. This file records those calls. That is
// also why "the registry is empty after unmount" is not the assertion: once the screen unmounts, the listener
// is gone, the Map is unreachable and it dies with the fiber — the leak with a consequence is the one that
// survives *into the next place*, and that is what is measured below.
//
// WHY `ResizeObserver` IS DEFINED HERE AND NOWHERE ELSE IN THIS APP'S SUITES
// jsdom has none, and `measureTail` returns its cleanup **only** when it has one to disconnect. React 19 uses
// a returned cleanup *instead of* calling the ref back with `null`, so whether the last kerb's registration is
// ever undone depends entirely on whether `ResizeObserver` exists — absent in jsdom, present in every browser.
// A suite without the stub therefore exercises the one environment where the bug cannot happen. Defining it is
// what makes this file a browser rather than a rebuttal.

import {
  CLIENT_POLICY_DEFAULTS,
  type Locale,
  type PlaceDetailView,
  placeDetailView,
  type StopDetail,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-detail.spec.json'
import { operatorName, poleSideLabel, t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

interface CorpusCase {
  name: string
  args: { detail: unknown; locale: Locale; now: string }
}

const CASES = corpus.groups.placeDetailView.cases as unknown as CorpusCase[]

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the placeDetailView corpus case \`${name}\` moved`)
  return found
}

/**
 * Two **different merged places**, both grouped, from the corpus: three kerbs and two.
 *
 * Neither is a place the app can reach from the other by tapping — see the note at the bottom of this file
 * about how a rider gets here — but a query key is a query key, and this is the transition every deep link,
 * history entry and future related-places affordance takes.
 */
const PLACE_A = 'a-merged-place-groups-its-rows-under-each-kerb'
const PLACE_B = 'two-kerbs-that-print-the-same-heading-get-a-compass-side'

/** The four words the screen composes with — the identical bundle, from the identical catalogue. */
const labelsFor = (locale: Locale) => ({
  operator: (o: Parameters<typeof operatorName>[0]) => operatorName(o, locale),
  servedBy: t(locale, 'servedBy'),
  routeCount: (n: number) => `${n} ${t(locale, 'routesLabel')}`,
  side: (octant: number) => poleSideLabel(octant, locale),
})

/**
 * What the kernel says a detail's screen contains — the same call the screen makes, with **no fix**, which is
 * the location state this whole file runs in. `here` changes a group's walk time and the group order; leaving
 * it out means the expected kerb order is the data's own and does not depend on where a suite pretends to be.
 */
function viewOf(detail: StopDetail, at: string): PlaceDetailView {
  return placeDetailView(detail, { locale: LOCALE, now: Date.parse(at), labels: labelsFor(LOCALE) })
}

function detailOf(name: string): { detail: StopDetail; at: string } {
  const c = caseNamed(name)
  return { detail: fromCorpus<StopDetail>(c.args.detail), at: c.args.now }
}

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

const locationState: LocationState = { status: 'undetermined' }
let now = 0
/** Every place this run can answer for, by id — so one mount can be navigated between two of them. */
const details = new Map<string, StopDetail>()

vi.mock('../src/hooks/useLocation', () => ({
  useLocation: () => ({ state: locationState, request: () => {} }),
}))
vi.mock('../src/hooks/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../src/hooks/useLiveEtas', () => ({ useLiveEtas: () => ({ now }) }))
vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getStop: (id: string) => {
      const detail = details.get(id)
      return detail === undefined
        ? Promise.reject(new Error(`no fixture for \`${id}\``))
        : Promise.resolve(detail)
    },
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

const { PlaceDetail, CARD_DOCKED_BOTTOM } = await import('../src/screens/PlaceDetail')
const { PLACE_PATH } = await import('../src/shell/destinations')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

/** The chrome above the first kerb — header, summary, map card. Any value clear of the spy's line. */
const CHROME = 320
/** A kerb group's height. */
const KERB = 120

let container: HTMLElement
let root: Root | null = null
/** The router's own `navigate`, so a place → place move is a real navigation and not a remount. */
let go: ((to: string) => void) | null = null
/** The screen's query client, so a test can make the *same* place answer differently — a refetch. */
let client: QueryClient | null = null

/**
 * Publishes the router's `navigate` to the test.
 *
 * A **sibling** of `<Routes>`, deliberately: it must not be inside the element under test, or the act of
 * capturing the handle would change what is mounted.
 */
function NavHandle() {
  const navigate = useNavigate()
  useEffect(() => {
    go = (to) => navigate(to)
  }, [navigate])
  return null
}

const placePath = (id: string) => `/stop/${encodeURIComponent(id)}`

function render(initial: string) {
  const created = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client = created
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={[initial]}>
        <QueryClientProvider client={created}>
          <NavHandle />
          <Routes>
            <Route path={PLACE_PATH} element={<PlaceDetail />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    )
  })
}

/**
 * Flush until the screen shows exactly the expected number of kerb sections.
 *
 * Bounded, and it throws with what it *did* see — a harness that looks at the wrong moment is
 * indistinguishable from a renderer that is wrong, which is the lesson `place-detail-states.test.tsx` records.
 */
async function settle(sections: number): Promise<HTMLElement[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = [...container.querySelectorAll('section')]
    if (found.length === sections && !container.querySelector('.animate-pulse')) {
      return found as HTMLElement[]
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(
    `expected ${sections} kerb sections; saw ${container.querySelectorAll('section').length}` +
      `${container.querySelector('.animate-pulse') ? ' and the screen was still loading' : ''}`,
  )
}

async function navigateTo(id: string, sections: number): Promise<HTMLElement[]> {
  if (go === null) throw new Error('the router never published its navigate')
  act(() => go?.(placePath(id)))
  return settle(sections)
}

// ── watching the registry ──────────────────────────────────────────────────────────────────────

/** What each element reports when the screen measures it. Anything unset reports zeroes, which is what a
 *  browser reports for a **detached** node — so a leaked section behaves here exactly as it does there. */
const rects = new Map<Element, DOMRect>()
/** Every element the screen has measured since the list was last cleared, in call order. */
const measured: Element[] = []

function installRectRecorder(): () => void {
  const proto = window.Element.prototype
  const original = proto.getBoundingClientRect
  proto.getBoundingClientRect = function (this: Element): DOMRect {
    measured.push(this)
    // A node that has left the document has **no** client rects in a browser — all zeroes, wherever it used
    // to be. Modelling that is load-bearing rather than tidy: a leaked section's zero top is what wins the
    // spy's comparison and lights the wrong kerb. Keeping its old rect would hide the whole consequence.
    if (!this.isConnected) return rect(0, 0)
    return rects.get(this) ?? rect(0, 0)
  }
  return () => {
    proto.getBoundingClientRect = original
  }
}

/**
 * The kerb sections the scroll pass looked at — i.e. the registry's members.
 *
 * **Distinct** elements rather than reads, because a section can be measured twice in one `act`: the spy
 * reads every member once, and the bottom-most one is measured again by `measureTail` each time React
 * re-attaches an inline ref callback (which is every render, including the one the spy's own `setActivePole`
 * causes). Membership is the claim; the number of reads is not.
 */
const measuredSections = () => [...new Set(measured.filter((el) => el.tagName === 'SECTION'))]

/** Lay the page out at rest and let the spy look, exactly as a rider's first scroll does. */
function scrollPass(sections: HTMLElement[]) {
  const card = container.querySelector('div.sticky')
  if (!card) throw new Error('the docked map card is not on screen')
  rects.set(card, rect(0, CARD_DOCKED_BOTTOM))
  sections.forEach((section, i) => {
    rects.set(section, rect(CHROME + i * KERB, KERB))
  })
  measured.length = 0
  act(() => window.dispatchEvent(new Event('scroll')))
}

/** Which kerb an element is, for a failure message that names the leak rather than printing a DOM node. */
const headingOf = (el: Element) => el.querySelector('button')?.textContent?.trim() ?? '(no heading)'

/**
 * jsdom has no `ResizeObserver`, and the whole defect lives in the branch that only exists when it does.
 * See the file header. `observed` and `disconnected` are what let the second test below check that the fix
 * kept the observer's cleanup as well as adding the registry's.
 */
class FakeResizeObserver {
  static live: FakeResizeObserver[] = []
  readonly observed: Element[] = []
  disconnected = false
  constructor(_callback: ResizeObserverCallback) {
    FakeResizeObserver.live.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
}

let restoreRects: (() => void) | null = null
let restoreWidth: (() => void) | null = null

beforeEach(() => {
  now = 0
  details.clear()
  rects.clear()
  measured.length = 0
  FakeResizeObserver.live.length = 0
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
  go = null
  client = null
  restoreRects = installRectRecorder()
  restoreWidth = stubClientWidth(320)
})

afterEach(() => {
  // Unmounted deliberately: the screen's scroll listener is on `window`, so a suite that leaves one mounted
  // hands the next test a second spy reading a dead registry.
  if (root) act(() => root?.unmount())
  restoreRects?.()
  restoreWidth?.()
  Reflect.deleteProperty(globalThis, 'ResizeObserver')
})

describe('the kerb-section registry the scroll-spy reads', () => {
  it('holds exactly the kerbs on screen — the control that makes the next test able to fail', async () => {
    const a = detailOf(PLACE_A)
    now = Date.parse(a.at)
    details.set(a.detail.stop.id, a.detail)
    const view = viewOf(a.detail, a.at)
    expect(view.grouped, 'the fixture is not a merged place').toBe(true)
    expect(view.groups.length, 'a place with fewer than two kerbs cannot show this').toBe(3)

    render(placePath(a.detail.stop.id))
    const sections = await settle(view.groups.length)
    scrollPass(sections)
    // Anti-vacuous: if the recorder saw nothing, every assertion below about *what* it saw would pass for
    // free. The spy measures each registered section once per pass.
    expect(measuredSections()).toHaveLength(sections.length)
    expect(measuredSections().every((el) => sections.includes(el as HTMLElement))).toBe(true)
  })

  it('carries no kerb from the previous place into the next place’s registry', async () => {
    // **The leak.** The section ref callback registers the kerb and, for the bottom-most one only, returns
    // `measureTail`'s `ResizeObserver` cleanup. React 19 calls a returned cleanup *instead of* calling the ref
    // back with `null`, so the bottom kerb's `registerSection(poleId, null)` never ran: navigating to another
    // place left that kerb in the registry, holding a detached `<section>` and its rows alive, and the spy
    // went on measuring it. A detached node reports a zero rect, which is *above* the spy's line at every
    // scroll offset past the first heading — so it wins the "last heading to clear the line" comparison and
    // the active kerb becomes one that is not on this place at all. The dot that consequence lands on is the
    // next test.
    const a = detailOf(PLACE_A)
    const b = detailOf(PLACE_B)
    now = Date.parse(a.at)
    details.set(a.detail.stop.id, a.detail)
    details.set(b.detail.stop.id, b.detail)
    const viewA = viewOf(a.detail, a.at)
    const viewB = viewOf(b.detail, b.at)
    // The two places must share no kerb, or "a kerb from the previous place" is not a statement about either.
    const polesA = viewA.groups.map((g) => g.poleId)
    const polesB = viewB.groups.map((g) => g.poleId)
    expect(polesA.filter((id) => polesB.includes(id))).toEqual([])

    render(placePath(a.detail.stop.id))
    const first = await settle(viewA.groups.length)
    scrollPass(first)

    const second = await navigateTo(b.detail.stop.id, viewB.groups.length)
    expect(
      first.every((el) => !el.isConnected),
      'the first place’s sections are somehow still in the document',
    ).toBe(true)

    scrollPass(second)
    const seen = measuredSections()
    expect(
      seen.filter((el) => !el.isConnected).map(headingOf),
      'a kerb from the previous place is still in the scroll-spy’s registry',
    ).toEqual([])
    expect(seen, 'the registry holds more kerbs than the place has').toHaveLength(second.length)
  })

  it('lights exactly one dot on the place a rider is actually looking at', async () => {
    // The same defect as a rider sees it. `MiniMap` dims every pin as soon as it is given an `activeId`
    // (`hasActive`) and emphasises the one that contains it — so an active kerb belonging to the *previous*
    // place dims the whole map and lights nothing, which is the map losing its "you are here in the list"
    // cue entirely. `place-detail-states.test.tsx` asserts one dot is always lit for a single place; this is
    // that same invariant across a navigation.
    const a = detailOf(PLACE_A)
    const b = detailOf(PLACE_B)
    now = Date.parse(a.at)
    details.set(a.detail.stop.id, a.detail)
    details.set(b.detail.stop.id, b.detail)
    const viewA = viewOf(a.detail, a.at)
    const viewB = viewOf(b.detail, b.at)

    render(placePath(a.detail.stop.id))
    scrollPass(await settle(viewA.groups.length))
    const second = await navigateTo(b.detail.stop.id, viewB.groups.length)
    scrollPass(second)

    const card = container.querySelector('div.sticky')
    if (!card) throw new Error('the docked map card is not on screen')
    const dots = [...card.querySelectorAll('div.rounded-full')]
    expect(dots, 'the map drew no dots to light').toHaveLength(viewB.pins.length)
    const undimmed = dots.filter((dot) => (dot as HTMLElement).style.opacity === '1')
    expect(undimmed, 'no dot is lit, or more than one is').toHaveLength(1)
    // …and it is the first kerb's: at rest no heading has cleared the line, and the spy's fallback is the
    // top-most one. With a stale kerb in the registry that fallback is the stale one.
    const firstPole = viewB.groups[0]?.poleId as string
    expect(dots.indexOf(undimmed[0] as Element)).toBe(
      viewB.pins.findIndex((pin) => pin.ids.includes(firstPole)),
    )
  })

  it('drops a kerb from the registry when that kerb leaves the list, and disconnects its observer', async () => {
    // The same contract without a navigation: **a kerb section that leaves the tree leaves the registry,
    // whatever removed it.** Here it is the query's own data changing under the screen — one kerb fewer,
    // which is what a refetch does when a pole stops being published — and the element that goes is the
    // bottom-most one, the only one whose ref callback returns a cleanup at all.
    //
    // The second assertion is the guard against half a fix: a combined cleanup that forgot the observer
    // would pass the registry claim and leak a `ResizeObserver` on every re-render instead.
    const a = detailOf(PLACE_A)
    now = Date.parse(a.at)
    const view = viewOf(a.detail, a.at)
    const doomed = view.groups.at(-1)?.poleId
    if (doomed === undefined) throw new Error('the fixture has no kerbs')
    const shrunk: StopDetail = {
      ...a.detail,
      members: (a.detail.members ?? []).filter((member) => member.id !== doomed),
      routes: a.detail.routes.filter((row) => row.stopId !== doomed),
    }
    const shrunkView = viewOf(shrunk, a.at)
    expect(shrunkView.grouped, 'the shrunken place stopped being a merged one').toBe(true)
    expect(shrunkView.groups.map((g) => g.poleId)).toEqual(
      view.groups.filter((g) => g.poleId !== doomed).map((g) => g.poleId),
    )

    details.set(a.detail.stop.id, a.detail)
    render(placePath(a.detail.stop.id))
    const before = await settle(view.groups.length)
    scrollPass(before)
    const last = before.at(-1) as HTMLElement
    const observer = FakeResizeObserver.live.find((o) => o.observed.includes(last))
    expect(
      observer,
      'the bottom kerb was never measured, so this test proves nothing',
    ).toBeDefined()

    // A real refetch, not a remount: the same query key, asked again, answered with one kerb fewer.
    details.set(a.detail.stop.id, shrunk)
    await act(async () => {
      await client?.invalidateQueries({ queryKey: ['stop', a.detail.stop.id] })
    })
    const after = await settle(shrunkView.groups.length)
    expect(after.includes(last), 'the bottom kerb is still on screen').toBe(false)

    scrollPass(after)
    expect(
      measuredSections()
        .filter((el) => !el.isConnected)
        .map(headingOf),
      'the kerb that left the list is still in the registry',
    ).toEqual([])
    expect(
      observer?.disconnected,
      'the departed kerb’s ResizeObserver was never disconnected',
    ).toBe(true)
  })
})

/**
 * ## How much this is worth — the honest note the header points at
 *
 * The defect is real in every browser (see the header on `ResizeObserver`), and the map symptom above is
 * what a rider gets when it fires. **How often it fires today is a separate question, and the answer is
 * "rarely", so this is written down rather than sold as a crash.**
 *
 * The registry only outlives its elements while the screen stays mounted, and there are exactly two ways
 * for a kerb section to leave the tree without taking the screen with it:
 *
 *  1. **A place → place navigation.** Nothing on the shipping app *taps* through to another place — a row
 *     goes to Route detail, a heading scrolls, the map hands off to the platform. It takes a deep link
 *     landing on `/stop/:id` from another `/stop/:id`, or the related-places affordance neither renderer
 *     has yet. So the first two tests here drive a transition that is currently the router's to make and
 *     not a rider's — which is the strongest available statement of the *contract*, and the reason to fix
 *     it now rather than when something starts using it.
 *  2. **A refetch with one kerb fewer**, which is the last test and is live today: the persisted query
 *     cache means a screen can mount on yesterday's answer and be handed a fresh one, and the dataset is
 *     rebuilt daily, so a pole that stops being published takes its section out from under a mounted
 *     screen. Rare, silent, and permanent for the rest of that visit.
 *
 * Every other path — back to Nearby, out to a route, a reload — unmounts the screen, and the Map dies with
 * the fiber. **A leak with no symptom on the common path is still worth its four lines of fix**, because
 * what it costs to keep is a rule everyone has to remember: *a conditional cleanup on a ref that also
 * registers is a leak waiting for the first caller who navigates.*
 */

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
 * Make every element report a width. `MiniMap` takes its first measurement from `clientWidth`, which jsdom
 * answers 0 for because it lays nothing out — and with no width it draws no dots at all.
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
