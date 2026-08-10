// The action sheet shows this route's times at the stop a rider tapped — and, more importantly, only asks
// upstream when there is nothing to show (ADR-115).
//
// WHY THIS FILE IS MOSTLY ABOUT CALL COUNTS
// On Citybus and GMB the route view has no times at all: those operators publish no route-level feed, which
// is what `liveArrivals: 'perStopOnly'` says (ADR-114). Their per-pole boards answer fine, so the sheet a
// rider already opens is the cheapest honest place to put one stop's times — one call, about the thing they
// just asked about, instead of an accordion or a 36-call fan-out.
//
// "One call" is the entire justification, so it is what this file asserts hardest. Three conditions gate the
// fetch and each is load-bearing:
//
//   · the row's own readings win → a KMB route costs NOTHING extra, and the sheet cannot contradict the list;
//   · `liveArrivals !== 'answered'` → a route that WAS asked and has nothing due must not fetch to re-learn
//     the same nothing, on every tap, for ever;
//   · a sheet must be open → nothing is fetched until a rider asks.
//
// The four render arms are asserted on the component directly, because their ORDER is the point and jsdom can
// see it: `loading` must never fall through to "No scheduled service". `docs/07` still carries a 🔴 for that
// exact arm being reached by a paused fetch on Nearby, which is why it is pinned here rather than trusted.

import {
  type EtaReport,
  type RouteDetail as RouteDetailPayload,
  type RouteStopArrival,
  type RouteStopRowView,
  routeDetailView,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/route-detail.spec.json'
import { t } from '@nextbus/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteStopSheet } from '../src/components/RouteStopSheet'

const LOCALE = 'en' as const

/** JSON `null` → the language's absent value, at the boundary. Same helper as the state suites. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

interface CorpusCase {
  name: string
  args: { detail: unknown; locale: typeof LOCALE; now: string }
}
const CASES = corpus.groups.routeDetailView.cases as unknown as CorpusCase[]
function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the routeDetailView corpus case \`${name}\` moved`)
  return found
}

/** The Citybus route whose rows are all empty because nobody asked, and the KMB one whose rows are full. */
const PER_STOP_ONLY = 'a-citybus-route-says-its-times-are-per-stop-rather-than-reading-as-empty'
const ANSWERED = 'a-bus-mid-route-rides-the-segment-leading-into-its-stop'
/** A KMB route the feed did not answer for — rows empty, and worth retrying, so the sheet may ask. */
const UNAVAILABLE = 'a-round-the-route-feed-did-not-answer-is-not-a-route-with-no-buses'

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

let route: () => Promise<RouteDetailPayload> = () => Promise.reject(new Error('no fixture set'))
let etaCalls: { stopId: string; routeIds?: string[] }[] = []
let etas: () => Promise<EtaReport> = () => Promise.resolve({ etas: [] })

vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getRoute: () => route(),
    // Declared because the screen now subscribes when the wire says its times are per-stop (ADR-116/119).
    // A no-op subscription rather than a fake round: this suite is about what the screen *draws* for a given
    // payload, and a live round would make the payload under test a moving target. The subscription itself is
    // covered in `route-live-times.test.tsx`.
    watchRoute: () => ({ unsubscribe: () => {} }),
    getEtas: (stopId: string, routeIds?: string[]) => {
      etaCalls.push({ stopId, ...(routeIds === undefined ? {} : { routeIds }) })
      return etas()
    },
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

const { RouteDetail } = await import('../src/screens/RouteDetail')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  etaCalls = []
  etas = () => Promise.resolve({ etas: [] })
  // jsdom has no layout, so no `scrollIntoView` — the same substitution the state suites make.
  Element.prototype.scrollIntoView = () => {}
  // …and no `showModal`, which the sheet is a real `<dialog>` behind (ADR-103). Discovered by WP6-7b:
  // no test in this repo had ever opened one.
  window.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  window.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
  vi.useFakeTimers({ shouldAdvanceTime: true })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

/** Mount the screen on a payload and settle it. */
async function mountPayload(detail: RouteDetailPayload, nowIso: string): Promise<void> {
  route = () => Promise.resolve(detail)
  vi.setSystemTime(Date.parse(nowIso))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/route/${encodeURIComponent(detail.route.id)}`]}>
          <Routes>
            <Route path="/route/:id" element={<RouteDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!container.querySelector('.animate-pulse')) break
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(10)
    })
  }
}

/** …from a corpus case, which is how most of these start. */
async function mountCase(name: string): Promise<RouteDetailPayload> {
  const c = caseNamed(name)
  const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
  await mountPayload(detail, c.args.now)
  return detail
}

/** The labels `routeDetailView` composes with — the screen's own five (ADR-054). */
const LABELS = {
  stopCount: (n: number) => `${n} stops`,
  holiday: 'hol',
  circularVia: (place: string) => `Circular via ${place}`,
  busApproaching: (stop: string) => `Bus approaching ${stop}`,
  busAtStop: (stop: string) => `Bus at ${stop}`,
}

/** Tap the nth stop row, which is what opens the sheet (ADR-032, ADR-098). */
async function tapRow(index: number): Promise<void> {
  const row = [...container.querySelectorAll('button')].filter((b) =>
    b.className.includes('min-h-16'),
  )[index]
  if (!row) throw new Error(`no stop row ${index} to tap`)
  await act(async () => {
    row.click()
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
    vi.advanceTimersByTime(10)
  })
}

const tapFirstRow = () => tapRow(0)

// ── when it asks ───────────────────────────────────────────────────────────────────────────────

describe('the sheet asks for one stop’s board, and only when there is nothing to show', () => {
  it('asks nothing until a rider taps', async () => {
    await mountCase(PER_STOP_ONLY)
    expect(etaCalls, 'a route nobody has tapped fetched a board').toEqual([])
  })

  it('asks for exactly one pole, scoped to this route', async () => {
    const detail = await mountCase(PER_STOP_ONLY)
    await tapFirstRow()
    // One call, named for the pole the rider tapped and narrowed to the route they are looking at — the
    // whole cost argument for doing this in the sheet rather than fanning out the schematic.
    expect(etaCalls).toEqual([{ stopId: detail.stops[0]?.stop.id, routeIds: [detail.route.id] }])
  })

  it('asks nothing for a row that already has its own readings, even on an incomplete round', async () => {
    /*
      **A partial round, which the wire permits and the edge does not yet produce** — so this is the one
      assertion here written against the contract rather than against today's server, and it is deliberate.

      Every route the edge currently emits is all-or-nothing: `.catch(() => [])` empties the whole map, and
      `perStopOnly` never fills it. That makes "the row's own readings win" look redundant against
      `liveArrivals !== 'answered'`, and an injection proved it *was* — removing the condition broke
      nothing, because no fixture had both an incomplete round and a row with times.

      It stops being redundant the moment the route view fans out per pole with a budget, which is the next
      row of work: then some poles answer and some do not, on one route, and a rider tapping a stop that
      already shows a time must not spend a call to be told it again. Pinned now, while the reason is
      legible.
    */
    const c = caseNamed(ANSWERED)
    const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
    const partial: RouteDetailPayload = { ...detail, liveArrivals: 'unavailable' }

    /*
      Tap the row that demonstrably HAS a reading, asked of the **view** rather than of the payload.

      The first draft kept row 0's `eta` and asserted `.not.toBeNull()` on it — which passes for
      `undefined`, and `fromCorpus` turns wire `null` into exactly that. So it tapped a row with no reading
      and "proved" the opposite of its own name. The view is the honest question either way: `upcoming`
      drops arrivals already in the past, so a payload with an `eta` can still produce a row with none.
    */
    const rows = routeDetailView(partial, {
      locale: LOCALE,
      now: Date.parse(c.args.now),
      labels: LABELS,
    }).stops
    const withReading = rows.findIndex((r: RouteStopRowView) => r.arrivals.length > 0)
    expect(withReading, 'no row on this fixture has a reading — pick another case').toBeGreaterThan(
      -1,
    )

    await mountPayload(partial, c.args.now)
    await tapRow(withReading)
    expect(etaCalls, 'the sheet re-fetched a time that was already on the row').toEqual([])
  })

  it('asks nothing when the round answered and nothing is due', async () => {
    // The condition that is easy to leave out and expensive to get wrong: this route was asked about and
    // has no buses coming. Fetching would find the same nothing, on every tap, for ever.
    const c = caseNamed(ANSWERED)
    const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
    const emptied: RouteDetailPayload = {
      ...detail,
      stops: detail.stops.map((s) => ({ ...s, eta: null })),
    }
    // `liveArrivals` absent = the round answered (ADR-114), which is exactly this case.
    expect(emptied.liveArrivals).toBeUndefined()
    await mountPayload(emptied, c.args.now)
    await tapFirstRow()
    expect(etaCalls, 'an answered round was asked again').toEqual([])
  })

  it('does ask when the round failed, because that one is worth retrying', async () => {
    await mountCase(UNAVAILABLE)
    await tapFirstRow()
    expect(etaCalls.length, 'a failed round is the case a retry is for').toBe(1)
  })
})

// ── what it shows ──────────────────────────────────────────────────────────────────────────────

describe('the sheet’s four arms, in order', () => {
  const row = {
    seq: 1,
    stopId: 'CTB:002009',
    name: { label: 'Lung Mun Oasis' },
    arrivals: [] as RouteStopArrival[],
    here: false,
    first: true,
    last: false,
    saved: false,
  }
  const arrival = (mins: number): RouteStopArrival => ({
    iso: new Date(Date.parse('2026-08-09T09:00:00+08:00') + mins * 60_000).toISOString(),
    label: { kind: 'mins', value: mins, unit: 'min' },
    urgency: 'normal',
    stale: false,
  })

  function render(props: {
    arrivals: RouteStopArrival[]
    incomplete: boolean
    loading: boolean
  }): string {
    root = createRoot(container)
    act(() => {
      root?.render(
        <RouteStopSheet
          row={row}
          routeId="CTB:962:outbound:1"
          routeNo="962"
          destination="Causeway Bay"
          locale={LOCALE}
          onClose={() => {}}
          onViewStop={() => {}}
          {...props}
        />,
      )
    })
    return (container.textContent ?? '').replace(/\s+/g, ' ')
  }

  it('shows the times when there are times', () => {
    const text = render({ arrivals: [arrival(3), arrival(11)], incomplete: false, loading: false })
    expect(text).toContain('3')
    expect(text).toContain('11')
    expect(text).not.toContain(t(LOCALE, 'noService'))
  })

  it('says a board that refused us refused us, not that nothing is due', () => {
    // ADR-077, one level down. `incomplete` beats the empty list, because "we could not ask" and "nothing
    // is coming" are different sentences and only one of them is true.
    const text = render({ arrivals: [], incomplete: true, loading: false })
    expect(text).toContain(t(LOCALE, 'etasUnavailable'))
    expect(text).not.toContain(t(LOCALE, 'noService'))
  })

  it('never renders waiting as nothing due', () => {
    // The arm ordering, and the reason it is pinned: `docs/07` carries a 🔴 for a paused fetch reaching
    // "No scheduled service" on Nearby. A skeleton is not a claim about buses.
    const text = render({ arrivals: [], incomplete: false, loading: true })
    expect(text).not.toContain(t(LOCALE, 'noService'))
    expect(text).not.toContain(t(LOCALE, 'etasUnavailable'))
    expect(container.querySelector('.animate-pulse'), 'no waiting state at all').not.toBeNull()
  })

  it('says nothing is due only when we asked, were answered, and the answer was nothing', () => {
    const text = render({ arrivals: [], incomplete: false, loading: false })
    expect(text).toContain(t(LOCALE, 'noService'))
  })

  it('still offers both actions in every arm', () => {
    // The sheet's job did not change: it is the app's only favourite-creating affordance (ADR-032, ADR-098),
    // and a readout above the actions must not have pushed either of them out.
    for (const props of [
      { arrivals: [arrival(3)], incomplete: false, loading: false },
      { arrivals: [], incomplete: true, loading: false },
      { arrivals: [], incomplete: false, loading: true },
      { arrivals: [], incomplete: false, loading: false },
    ]) {
      const text = render(props)
      expect(text).toContain(t(LOCALE, 'addFavorite'))
      expect(text).toContain(t(LOCALE, 'viewStop'))
      act(() => root?.unmount())
    }
  })
})
