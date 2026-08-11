// The route screen subscribes to a live route watch, and what a rider sees when it answers (ADR-116/119).
//
// WHAT THIS FILE IS FOR
// A Citybus or GMB route has no times at all: those operators publish no route-level feed, which is what
// `liveArrivals: 'perStopOnly'` says (ADR-114), and ADR-115 could only put one stop's times in a sheet a rider
// tapped. `/v1/live?route=` asks every pole of the route at once, and this is the screen end of it.
//
// Four things are asserted, and each is a decision that could plausibly have gone the other way:
//
//   · **who asks.** Only a route whose own payload says its times are not a complete answer. A KMB route must
//     not open a socket for readings it already has.
//   · **that the notice goes.** Rows with minutes under a line saying there are none is the screen
//     contradicting itself, and the merge clearing `liveArrivals` is what prevents it.
//   · **that a refetch cannot blank a time.** The readings are merged at *render* rather than written into
//     the query cache, precisely because refetching a Citybus route brings `eta: null` on every stop back.
//     This is the assertion that makes that shape non-negotiable.
//   · **that it stops.** A screen that unmounts leaves no subscription behind.

import type { Eta, EtaFailure, RouteDetail as RouteDetailPayload } from '@nextbus/core'
import corpus from '@nextbus/core/spec/route-detail.spec.json'
import { t } from '@nextbus/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

/** The Citybus route with nothing on it because nobody asked, and the KMB one whose feed answers. */
const PER_STOP_ONLY = 'a-citybus-route-says-its-times-are-per-stop-rather-than-reading-as-empty'
const ANSWERED = 'a-bus-mid-route-rides-the-segment-leading-into-its-stop'

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

let route: () => Promise<RouteDetailPayload> = () => Promise.reject(new Error('no fixture set'))
let routeFetches = 0

/** Every route watch this screen opened, with a way to push a round into it. */
interface Watch {
  routeId: string
  listener: (etas: Eta[], failed?: EtaFailure[]) => void
  unsubscribed: boolean
}
let watches: Watch[] = []

vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getRoute: () => {
      routeFetches += 1
      return route()
    },
    getClientPolicy: () => Promise.resolve(undefined),
    watchRoute: (routeId: string, listener: (etas: Eta[], failed?: EtaFailure[]) => void) => {
      const watch: Watch = { routeId, listener, unsubscribed: false }
      watches.push(watch)
      return {
        unsubscribe: () => {
          watch.unsubscribed = true
        },
      }
    },
  },
}))

const { RouteDetail } = await import('../src/screens/RouteDetail')

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  watches = []
  routeFetches = 0
  Element.prototype.scrollIntoView = () => {}
  vi.useFakeTimers({ shouldAdvanceTime: true })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

async function mountCase(name: string): Promise<RouteDetailPayload> {
  const c = caseNamed(name)
  const detail = fromCorpus<RouteDetailPayload>(c.args.detail)
  route = () => Promise.resolve(detail)
  vi.setSystemTime(Date.parse(c.args.now))
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
  return detail
}

/** Push one round into the open watch, as the transport would. A reading may name any route. */
async function pushRound(etas: Eta[], failed: EtaFailure[] = []): Promise<void> {
  const watch = watches.at(-1)
  if (!watch) throw new Error('no route watch is open')
  await act(async () => {
    watch.listener(etas, failed)
    await Promise.resolve()
  })
}

/** A reading for one pole of a route, `mins` minutes out from the mounted case's clock. */
function reading(routeId: string, stopId: string, mins: number): Eta {
  const at = new Date(Date.now() + mins * 60_000).toISOString()
  return {
    routeId,
    stopId,
    operator: 'CTB',
    arrivals: [at],
    dataTimestamp: new Date(Date.now() - 20_000).toISOString(),
    observedAt: new Date(Date.now() - 20_000).toISOString(),
  }
}

const NOTICE = t(LOCALE, 'etasUnavailable')
const text = () => container.textContent ?? ''

// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('a route whose times only a live watch can supply', () => {
  it('subscribes to the route it is showing, once', async () => {
    const detail = await mountCase(PER_STOP_ONLY)
    expect(watches.map((w) => w.routeId)).toEqual([detail.route.id])
  })

  it('does not subscribe for a route whose own feed answered', async () => {
    // The cost argument. A KMB route already carries its readings, so a socket here would be a round of
    // upstream calls for something the payload has, on the screen most riders use.
    await mountCase(ANSWERED)
    expect(watches).toEqual([])
  })

  it('puts the round’s readings on the rows and drops the notice with them', async () => {
    const detail = await mountCase(PER_STOP_ONLY)
    // Before: the ADR-114 sentence, and no times anywhere.
    expect(text()).toContain(NOTICE)

    const first = detail.stops[0]?.stop.id as string
    await pushRound([reading(detail.route.id, first, 7)])

    // After: a time on the row it was read at, and the explanation gone — there is nothing left to explain.
    expect(text()).toContain('7')
    expect(text()).not.toContain(NOTICE)
  })

  it('says so on the one row it could not ask about, and nowhere else', async () => {
    const detail = await mountCase(PER_STOP_ONLY)
    const answered = detail.stops[0]?.stop.id as string
    const refused = detail.stops[1]?.stop.id as string

    await pushRound(
      [reading(detail.route.id, answered, 4)],
      [
        {
          stopId: refused,
          error: { code: 'upstream_unavailable', message: 'no', retryable: true },
        },
      ],
    )

    // Once — on the refused row — rather than once for the screen. The screen-level line cannot say
    // "one of these kerbs", and every other row here answered.
    const occurrences = text().split(NOTICE).length - 1
    expect(occurrences).toBe(1)
    expect(text()).toContain('4')
  })

  it('survives a refetch of the route document without blanking a time', async () => {
    // **The assertion that fixes the shape.** Refetching a Citybus route brings `eta: null` on every stop, so
    // a hook that merged frames into the query cache would have every time on screen vanish here and come
    // back one round later. Merging at render makes that impossible: the base document may be replaced as
    // often as it likes.
    const detail = await mountCase(PER_STOP_ONLY)
    const first = detail.stops[0]?.stop.id as string
    await pushRound([reading(detail.route.id, first, 9)])
    expect(text()).toContain('9')

    const before = routeFetches
    await act(async () => {
      vi.advanceTimersByTime(31_000)
      await Promise.resolve()
    })
    expect(
      routeFetches,
      'the route document never refetched, so this proves nothing',
    ).toBeGreaterThan(before)
    expect(text()).toContain('9')
    expect(text()).not.toContain(NOTICE)
  })

  it('unsubscribes when the screen goes away', async () => {
    await mountCase(PER_STOP_ONLY)
    expect(watches.length).toBe(1)
    act(() => {
      root?.unmount()
      root = null
    })
    expect(watches.every((w) => w.unsubscribed)).toBe(true)
  })

  it('ignores a reading for another line, and says so again when a round matches nothing', async () => {
    // Two rules in one round, both the kernel's. A Citybus pole serves a dozen routes and the socket narrows
    // server-side, so a foreign reading should never arrive — but the listener is a public seam and the row
    // it would land on is a different service entirely. And a round that matched *nothing* leaves
    // `liveArrivals` standing, so the screen goes back to explaining itself rather than silently showing an
    // empty schematic.
    //
    // (This case does **not** pin the round's route tag: the round is tagged with the *watched* route, which
    // is unchanged here. That is `useLiveRoute`'s own suite — see `live-route-tag.test.tsx`.)
    const detail = await mountCase(PER_STOP_ONLY)
    const first = detail.stops[0]?.stop.id as string
    await pushRound([reading(detail.route.id, first, 8)])
    expect(text()).toContain('8')

    await pushRound(
      [reading('CTB:5B:outbound:1', first, 3)],
      [{ stopId: first, error: { code: 'upstream_unavailable', message: 'no', retryable: true } }],
    )
    // The stale round is ignored whole: no other route's time, and no marker from its failure set.
    expect(text()).not.toContain('3 min')
    expect(text()).toContain(NOTICE)
  })
})
