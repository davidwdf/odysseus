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
//  · `animate` — a recorder that also returns a controllable stand-in, because an exit removes its own
//    ghost from `onfinish` and nothing in jsdom will ever fire that. What the hook must get right is
//    *which* keyframes it asks for on *which* element, not what the compositor then does with them.
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
  animation: { onfinish: (() => void) | null; oncancel: (() => void) | null }
}
let recorded: Recorded[] = []

/**
 * One token per bus, each parked at the top of the row its `data-row` names.
 *
 * `at` — the route coordinate — defaults to the row, which is the ordinary case: a bus's place along the
 * route *is* the row it is drawn against. A test passes them apart on purpose to model the case where they
 * differ, the list reflowing under a bus that has not moved.
 */
interface Bus {
  ordinal: number
  row: number
  at?: number
}
function Harness({ buses, routeId }: { buses: Bus[]; routeId: string }) {
  const list = useRef<HTMLDivElement | null>(null)
  const ghosts = useRef<HTMLDivElement | null>(null)
  useRailFlip(list, ghosts, routeId)
  return (
    <div ref={list}>
      {buses.map((bus) => (
        <span
          key={bus.ordinal}
          // Named exactly as `RailBusToken` names itself. Not decoration: the exit clones the token and
          // strips it, and an unnamed token could not tell a stripped clone from an unstripped one — which
          // is how an injected defect that kept the ghost's `aria-label` first went unnoticed here.
          role="img"
          aria-label={`Bus at stop ${bus.row}`}
          data-bus-ordinal={bus.ordinal}
          data-bus-at={bus.at ?? bus.row}
          data-row={bus.row}
        />
      ))}
      <div ref={ghosts} data-ghosts />
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

/** A recorded animation is a *travel* when it moves; the two pops scale instead. */
const isTravel = (r: Recorded) => String(r.keyframes[0]?.transform ?? '').startsWith('translateY')
const isEnter = (r: Recorded) =>
  r.keyframes[0]?.opacity === 0 && String(r.keyframes[1]?.transform) === 'scale(1)'
const isLeave = (r: Recorded) =>
  r.keyframes[1]?.opacity === 0 && String(r.keyframes[0]?.transform) === 'scale(1)'

/** The keyframe deltas asked for since the last `recorded = []`, in `translateY(…px)` order. */
function travels(): { ordinal: string | null; from: string; to: string }[] {
  return recorded.filter(isTravel).map((r) => ({
    ordinal: r.target.getAttribute('data-bus-ordinal'),
    from: String(r.keyframes[0]?.transform ?? ''),
    to: String(r.keyframes[1]?.transform ?? ''),
  }))
}

/** Which tokens were popped in, by ordinal. */
function entrances(): (string | null)[] {
  return recorded.filter(isEnter).map((r) => r.target.getAttribute('data-bus-ordinal'))
}

/** The exits: one per departed bus, each on a stripped clone parked in the ghost layer. */
function exits(): { inGhostLayer: boolean; top: string; announced: boolean }[] {
  return recorded.filter(isLeave).map((r) => ({
    inGhostLayer: r.target.parentElement?.hasAttribute('data-ghosts') === true,
    top: r.target.style.top,
    announced:
      r.target.getAttribute('role') !== null || r.target.getAttribute('aria-label') !== null,
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
    const animation = { cancel: () => {}, onfinish: null, oncancel: null }
    recorded.push({ target: this, keyframes, options, animation })
    return animation as unknown as Animation
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

  it('is matched by where it is on the route, and the ordinal is not consulted', () => {
    /*
      Two buses, each advancing one node — with their ordinals **relabelled** between the commits, which is
      what a re-index does. Matched by ordinal, the deltas would be nonsense; matched by route coordinate,
      each bus is recognised as itself.

      That the ordinal is now irrelevant here is the point of ADR-111: it is a slot in `view.buses`, and a
      slot is not a vehicle. It still keys the React element, which is all it was ever good for.
    */
    render([
      { ordinal: 0, row: 3 },
      { ordinal: 1, row: 8 },
    ])
    recorded = []
    render([
      { ordinal: 4, row: 4 },
      { ordinal: 5, row: 9 },
    ])
    expect(travels()).toEqual([
      { ordinal: '4', from: `translateY(${-ROW}px)`, to: 'translateY(0px)' },
      { ordinal: '5', from: `translateY(${-ROW}px)`, to: 'translateY(0px)' },
    ])
    expect(entrances(), 'a bus that only advanced a node was treated as a new one').toEqual([])
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
    render([{ ordinal: 0, row: 6, at: 6 }])
    recorded = []
    render([{ ordinal: 0, row: 8, at: 6 }])
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

describe('a bus that enters or leaves the rail', () => {
  it('pops in rather than appearing, and pops out rather than vanishing', () => {
    recorded = []
    render([{ ordinal: 0, row: 3 }])
    expect(entrances(), 'a bus arriving on the rail was not drawn arriving').toEqual(['0'])
    expect(travels()).toEqual([])

    recorded = []
    render([])
    const out = exits()
    expect(out, 'a bus leaving the rail was not drawn leaving').toHaveLength(1)
    // Positioned against the list at the offset it last occupied, because the row it left from may not be
    // there any more — and stripped, because a bus that has left must not be announced or projected.
    expect(out[0]).toEqual({ inGhostLayer: true, top: `${3 * ROW}px`, announced: false })
  })

  it('does not slide a bus that reached the terminus back to the origin', () => {
    /*
      **The owner's report, and ADR-030's ordinal identity meeting its limit.** When the lead bus leaves the
      rail every bus behind it shifts up one ordinal, so the k-th token is a different vehicle — and matched
      by ordinal it travels the whole length of the schematic the wrong way. Measured in the lab at 1120 px
      on a 17-stop rail.

      A bus travels *forward*, so a candidate further along the route than the token cannot be that token's
      past. What is left over is the pair of events a rider should actually see.
    */
    render([{ ordinal: 0, row: 16 }])
    recorded = []
    render([{ ordinal: 0, row: 0 }])
    expect(travels(), 'the bus slid back up the rail').toEqual([])
    expect(entrances(), 'the bus at the origin did not pop in').toEqual(['0'])
    expect(exits(), 'the bus that reached the terminus did not pop out').toHaveLength(1)
  })

  it('re-lets the ordinals correctly when the lead of three departs', () => {
    // The routine case: three buses, the lead reaches the terminus. The two behind it each advance one
    // node, and each should be recognised as itself rather than as the ordinal it inherited.
    render([
      { ordinal: 0, row: 4 },
      { ordinal: 1, row: 9 },
      { ordinal: 2, row: 15 },
    ])
    recorded = []
    render([
      { ordinal: 0, row: 5 },
      { ordinal: 1, row: 10 },
    ])
    expect(travels().map((t) => t.from)).toEqual([`translateY(${-ROW}px)`, `translateY(${-ROW}px)`])
    expect(entrances(), 'a surviving bus was treated as a new one').toEqual([])
    expect(exits(), 'the departed lead was not drawn leaving').toHaveLength(1)
  })

  it('lets an ETA revision nudge a bus back a node without re-minting it', () => {
    // A stop's estimate grows, so the bus that was reaching it is now only approaching it. That is a move
    // backwards, and a real one — the tolerance exists for exactly this and for nothing longer.
    render([{ ordinal: 0, row: 7, at: 7 }])
    recorded = []
    render([{ ordinal: 0, row: 6, at: 6.5 }])
    expect(travels().map((t) => t.from)).toEqual([`translateY(${ROW}px)`])
    expect(entrances()).toEqual([])
    expect(exits()).toEqual([])
  })

  it('does not take its own ghost for a bus on the next round', () => {
    /*
      The ghost layer lives **inside** the list, which is the element this hook queries — so a clone that
      kept `data-bus-ordinal` would be counted as a bus for the 220 ms of its exit: a phantom at the
      terminus, entering the rail every round until it faded. Which is why the clone is stripped of both
      data attributes and not only of its accessible name.
    */
    render([
      { ordinal: 0, row: 3 },
      { ordinal: 1, row: 9 },
    ])
    render([{ ordinal: 0, row: 4 }]) // the bus at row 9 leaves; its ghost is parked in the layer
    expect(exits()).toHaveLength(1)

    recorded = []
    render([{ ordinal: 0, row: 5 }])
    expect(travels().map((t) => t.from)).toEqual([`translateY(${-ROW}px)`])
    expect(entrances(), 'the departed bus’s ghost was counted as a bus arriving').toEqual([])
  })

  it('travels half a row when a bus leaves a node for the segment out of it', () => {
    // A node and the segment leading out of it are different places, half a row apart — which is why a
    // segment's coordinate is the *half*-step between the nodes it spans. Were the two the same number, the
    // identity rule would read this as a reflow and the bus would cover the half-row without moving.
    render([{ ordinal: 0, row: 6, at: 6 }])
    recorded = []
    render([{ ordinal: 0, row: 6.5, at: 6.5 }])
    expect(travels().map((t) => t.from)).toEqual([`translateY(${-ROW / 2}px)`])
  })

  it('draws neither pop when the rider has asked for less motion', () => {
    render([{ ordinal: 0, row: 3 }])
    stubReducedMotion(true)
    recorded = []
    render([
      { ordinal: 0, row: 3 },
      { ordinal: 1, row: 9 },
    ])
    render([])
    expect(recorded).toEqual([])
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
    // And no exit, either: nothing left the rail, the whole rail was replaced.
    expect(exits(), 'a flip drew an exit for a bus that did not go anywhere').toEqual([])
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
