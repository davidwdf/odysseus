// **The wait is the same shape as what arrives** — `StopCardSkeleton`, wired into Nearby and Favourites.
//
// WHAT THIS CAN AND CANNOT SEE
// jsdom loads no stylesheet, so no suite here can measure that a skeleton bar is 28 px tall or that the
// list stops jumping. What it *can* do is hold the two claims that are structural rather than visual, and
// those turn out to be the two that actually rot:
//
//   1. **The skeleton is invisible to the conformance walker.** It is `aria-hidden` and contributes no
//      text. This is the one that would bite silently: the walker reads *presence*, not visibility, so a
//      labelled placeholder projects into every state that mounts before its data — the trap
//      `RouteStopRow`'s own skeleton note records, found the hard way on the route screen.
//   2. **The skeleton's box is `StopCard`'s box.** Both files are read and their outer `<section>` and
//      their row wrapper are required to carry the same layout classes. Not a tautology — they are two
//      components in two files, and the *reason* the old skeleton moved the layout when it was replaced is
//      that nothing tied its geometry to the thing it stood in for. If someone re-pads `StopCard`, this
//      fails.
//
// The per-bar sizes in `StopCardSkeleton`'s table (a name bar is `text-h3`'s 24 px line box, and so on)
// stay **unenforced**, and the component says so. A rule nobody can fail is prose.

import type { StopCardView } from '@nextbus/core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StopCard } from '../src/components/StopCard'
import { StopCardSkeleton } from '../src/components/StopCardSkeleton'

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

function render(node: React.ReactNode): void {
  act(() => root?.render(node))
}

const CARD: StopCardView = {
  stopId: 'KMB:ST311',
  name: { label: 'Nathan Road / Pak Hoi Street', code: 'ST311' },
  caption: 'Southbound  ·  90m · 2 min walk',
  bearingDeg: 190,
  rows: [
    {
      routeId: 'KMB:1:O:1',
      operator: 'KMB',
      routeNo: '1',
      headline: 'Chuk Yuen Estate',
      label: { kind: 'mins', value: 6, unit: 'min' },
      urgency: 'normal',
      stale: false,
    },
  ],
  remaining: 0,
  incomplete: false,
}

describe('the conformance walker cannot see it', () => {
  it('is aria-hidden', () => {
    render(<StopCardSkeleton />)
    const section = container.querySelector('section')
    expect(section?.getAttribute('aria-hidden')).toBe('true')
  })

  it('contributes no text at all', () => {
    render(<StopCardSkeleton rows={4} />)
    expect(container.textContent?.trim()).toBe('')
  })

  it('exposes no accessible name anywhere inside it', () => {
    render(<StopCardSkeleton rows={4} />)
    const labelled = container.querySelectorAll('[aria-label],[role],[alt],[title]')
    expect([...labelled].map((e) => e.tagName)).toEqual([])
  })
})

describe('it stands in for the right number of rows', () => {
  it.each([1, 2, 3, 5])('draws %i', (rows) => {
    render(<StopCardSkeleton rows={rows} />)
    // The row wrappers are the section's second child's children — the same place `StopCard` puts them.
    const list = container.querySelector('section > div:nth-of-type(2)')
    expect(list?.children.length).toBe(rows)
  })
})

describe('its box is StopCard s box', () => {
  /** The classes that decide a box: padding, gap, flex behaviour. Colour and animation are not layout. */
  const layout = (el: Element | null | undefined): string[] =>
    (el?.className ?? '')
      .split(/\s+/)
      .filter((c) => /^(p|m|gap|flex|items|justify|min-w|shrink)/.test(c))
      .sort()

  it('uses the same outer padding as a real card', () => {
    render(<StopCard view={CARD} locale="en" />)
    const real = layout(container.querySelector('section'))
    act(() => root?.render(<StopCardSkeleton />))
    const fake = layout(container.querySelector('section'))
    // `animate-pulse` is not a layout class and is filtered out above, so these must match exactly.
    expect(fake).toEqual(real)
  })

  it('uses the same row box as a real route row', () => {
    render(<StopCard view={CARD} locale="en" />)
    // A real row is a plain `<div>` when it does not navigate — this card passes no `onRoutePress`.
    const real = layout(container.querySelector('section > div:nth-of-type(2) > div'))
    act(() => root?.render(<StopCardSkeleton rows={1} />))
    const fake = layout(container.querySelector('section > div:nth-of-type(2) > div'))
    expect(fake).toEqual(real)
  })

  it('uses the same inner flex box around the chip and destination', () => {
    render(<StopCard view={CARD} locale="en" />)
    const real = layout(container.querySelector('section > div:nth-of-type(2) > div > div'))
    act(() => root?.render(<StopCardSkeleton rows={1} />))
    const fake = layout(container.querySelector('section > div:nth-of-type(2) > div > div'))
    // This is the one that caught ADR-166's bug in the real row: `min-w-0` on BOTH flex levels.
    expect(fake).toEqual(real)
  })
})
