// The bus tokens' travel between rows — `useRailFlip`, the half of ADR-110 that is not CSS.
//
// WHY THIS FILE EXISTS AT ALL
// The resting position is a literal now and `route-detail-states.test.tsx` reads it straight off the tree.
// What no suite there can reach is the *move*: jsdom lays nothing out, so every token is at 0 and every
// delta is 0. The travel was therefore verified in a browser — and the browser found a defect the plan had
// not anticipated (see `reset` below). A browser finding with no test is a finding that comes back, so the
// hook is driven here against a **declared** layout instead of a real one.
//
// WHAT IS STUBBED, AND WHY THAT IS HONEST
// Three things jsdom does not implement, each replaced by the smallest possible truthful stand-in:
//  · `offsetTop` — a getter that reads each token's `data-row`, i.e. *"rows are 64 px and a token sits at
//    the top of its own"*. That is a statement about layout, which is precisely what this file must supply
//    and must not test.
//  · `offsetParent` — left `null`, which ends the walk after one hop. The real chain is two hops and its
//    correctness is a browser fact, measured there (delta −104 px against a layout delta of −104 px).
//  · `animate` — a recorder. What the hook must get right is *which* keyframes it asks for, not what the
//    compositor then does with them.
// `matchMedia` is stubbed too, because jsdom has none and `prefersReducedMotion()` answers `true` without
// it — which would make every assertion below pass vacuously.

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRailFlip } from '../src/hooks/useRailFlip'

/** The row height this file declares. Nothing reads a real one. */
const ROW = 64

interface Recorded {
  target: HTMLElement
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
}
let recorded: Recorded[] = []

/**
 * One token per bus, each parked at the top of the row its `data-row` names.
 *
 * `at` defaults to the row, which is the ordinary case — a bus's target *is* the row it is drawn against.
 * A test passes them apart on purpose to model the one case where they differ: the list reflowing under a
 * bus that has not moved.
 */
interface Bus {
  ordinal: number
  row: number
  at?: string
}
function Harness({ buses, routeId }: { buses: Bus[]; routeId: string }) {
  const list = useRef<HTMLDivElement | null>(null)
  useRailFlip(list, routeId)
  return (
    <div ref={list}>
      {buses.map((bus) => (
        <span
          key={bus.ordinal}
          data-bus-ordinal={bus.ordinal}
          data-bus-at={bus.at ?? `n${bus.row}`}
          data-row={bus.row}
        />
      ))}
    </div>
  )
}

let container: HTMLElement
let root: Root | null = null

function render(buses: Bus[], routeId = 'KMB:1A:outbound:1'): void {
  act(() => {
    root?.render(<Harness buses={buses} routeId={routeId} />)
  })
}

/** The keyframe deltas asked for since the last `recorded = []`, in `translateY(…px)` order. */
function travels(): { ordinal: string | null; from: string; to: string }[] {
  return recorded.map((r) => ({
    ordinal: r.target.getAttribute('data-bus-ordinal'),
    from: String(r.keyframes[0]?.transform ?? ''),
    to: String(r.keyframes[1]?.transform ?? ''),
  }))
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduced-motion') ? reduce : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => {
  recorded = []
  Object.defineProperty(window.HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const row = this.getAttribute('data-row')
      return row === null ? 0 : Number(row) * ROW
    },
  })
  window.HTMLElement.prototype.animate = function animate(
    this: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    recorded.push({ target: this, keyframes, options })
    return { cancel: () => {} } as unknown as Animation
  } as typeof window.HTMLElement.prototype.animate
  stubReducedMotion(false)
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  // The accessor is on a shared prototype and must not outlive this file.
  delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a bus that moves', () => {
  it('plays back the distance it travelled, so the move is seen rather than teleported', () => {
    render([{ ordinal: 0, row: 2 }])
    expect(travels(), 'a bus appears where it is; it does not slide in from nowhere').toEqual([])

    recorded = []
    render([{ ordinal: 0, row: 5 }])

    // Three rows down, so the token starts three rows *up* from where it now is and travels to zero.
    expect(travels()).toEqual([
      { ordinal: '0', from: `translateY(${2 * ROW - 5 * ROW}px)`, to: 'translateY(0px)' },
    ])
    expect(recorded[0]?.options).toEqual({ duration: 500, easing: 'cubic-bezier(0, 0, 0.2, 1)' })
  })

  it('is matched to its old place by ordinal, not by position in the list', () => {
    // Two buses whose rows cross over. If the hook paired them up by document order instead of by the
    // identity `key` has carried since ADR-030, both deltas would come out wrong.
    render([
      { ordinal: 0, row: 8 },
      { ordinal: 1, row: 3 },
    ])
    recorded = []
    render([
      { ordinal: 1, row: 4 },
      { ordinal: 0, row: 9 },
    ])
    expect(travels().sort((a, b) => (a.ordinal ?? '').localeCompare(b.ordinal ?? ''))).toEqual([
      { ordinal: '0', from: `translateY(${-ROW}px)`, to: 'translateY(0px)' },
      { ordinal: '1', from: `translateY(${-ROW}px)`, to: 'translateY(0px)' },
    ])
  })

  it('does not move when the render changed nothing about where it is', () => {
    render([{ ordinal: 0, row: 4 }])
    recorded = []
    render([{ ordinal: 0, row: 4 }])
    expect(travels()).toEqual([])
  })

  it('cuts instead of travelling when the rider has asked for less motion', () => {
    // A media query reaches a CSS transition and reaches no `element.animate()` call, so this has to be
    // asked in JavaScript — the same call ADR-104's direction swap makes.
    render([{ ordinal: 0, row: 1 }])
    stubReducedMotion(true)
    recorded = []
    render([{ ordinal: 0, row: 6 }])
    expect(travels()).toEqual([])
  })

  it('is moved but not animated when the list reflows underneath it', () => {
    /*
      **The lab's finding, and the reason a motion lab was worth building.** A refetch that gives a stop two
      rows up an arrivals line displaces every bus below it by ~16 px. The bus has not moved — it is on the
      same node, and its node moved with it — so easing it into place would make it visibly lag its own rail
      for half a second. Measured in the lab before the fix: a reflow above a stationary bus fired a 32 px
      travel. The `transition-[top]` overlay this replaces had the identical fault, unwatched.

      So the record carries the *target* as well as the offset, and only a change of target is a move.
    */
    render([{ ordinal: 0, row: 6, at: 'n6' }])
    recorded = []
    render([{ ordinal: 0, row: 8, at: 'n6' }])
    expect(travels(), 'the bus travelled a distance it did not travel').toEqual([])
  })

  it('appears rather than slides when an ordinal is reused by a different bus', () => {
    // A bus reaching the terminus leaves the rail and its ordinal is re-let. Without dropping the record,
    // the next bus to take it would travel from wherever the last one happened to stop.
    render([{ ordinal: 0, row: 2 }])
    render([])
    recorded = []
    render([{ ordinal: 0, row: 30 }])
    expect(travels()).toEqual([])
  })
})

describe('a direction flip', () => {
  it('does not slide one direction’s buses into the other’s places', () => {
    /*
      **The defect a browser found and the plan did not anticipate.** `placeholderData: keepPreviousData`
      holds the current direction on screen while the reverse loads (ADR-046), so a flip changes the URL in
      one commit and the buses one or more commits later. Keyed on the URL's `:id`, the reset fires against
      the *old* direction's tokens, has nothing to forget, and the commit that actually swaps them then
      reads a stale record — sliding the k-th outbound bus across the screen into the k-th inbound one's
      place, a journey that never happened. Keyed on the payload's route id, the reset lands on the commit
      the buses change in. Both commits are rendered here, in order.
    */
    render([{ ordinal: 0, row: 2 }], 'KMB:1A:outbound:1')
    recorded = []
    // Commit 1: the reverse's payload has not landed, so these are still the outbound's buses.
    render([{ ordinal: 0, row: 2 }], 'KMB:1A:outbound:1')
    // Commit 2: the reverse's payload lands, and its buses are somewhere else entirely.
    render([{ ordinal: 0, row: 26 }], 'KMB:1A:inbound:1')
    expect(travels()).toEqual([])
  })

  it('still travels normally once the new direction is the one on screen', () => {
    render([{ ordinal: 0, row: 2 }], 'KMB:1A:outbound:1')
    render([{ ordinal: 0, row: 26 }], 'KMB:1A:inbound:1')
    recorded = []
    render([{ ordinal: 0, row: 27 }], 'KMB:1A:inbound:1')
    expect(travels()).toEqual([
      { ordinal: '0', from: `translateY(${-ROW}px)`, to: 'translateY(0px)' },
    ])
  })
})
