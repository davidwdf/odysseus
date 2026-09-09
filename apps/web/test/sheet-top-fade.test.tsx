// A sheet's scrolling body fades where its content passes under its top edge — and does NOT fade while it
// is at the top, which is the half of the behaviour worth a test.
//
// WHAT JSDOM CAN AND CANNOT SEE HERE
// The fade itself is a CSS mask on `.sheet-scroll`, and jsdom applies no `@property`, no transition and no
// mask — so what is testable is the *state*: the class that carries the rule and the `data-scrolled`
// attribute the rule keys on. That split is deliberate rather than a compromise. The mask is one
// declaration in `index.css` with nothing conditional in it; the condition is this component, and the
// condition is where a mistake would be silent. `search-scroll.test.tsx` draws the same line.
//
// The third case is the one that pays: both of the app's scrolling sheets must reach the same component,
// because they sit on different backgrounds and a per-host gradient is exactly what this is not.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { RouteFactSheet } from '../src/components/RouteFactSheet'
import { DraggableSheet } from '../src/components/sheet/DraggableSheet'
import { SheetScroll } from '../src/components/sheet/SheetScroll'
import { stubDialog } from './dialogShim'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  stubDialog()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

/** Fire a real scroll event at the container, having moved its offset the way a finger would. */
function scrollTo(node: HTMLElement, top: number): void {
  node.scrollTop = top
  act(() => {
    node.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}

it('does not fade at the top, and fades once there is something above', () => {
  act(() => {
    root.render(
      <SheetScroll className="overflow-y-auto">
        <p>a row</p>
      </SheetScroll>,
    )
  })
  const scroller = host.querySelector<HTMLElement>('.sheet-scroll')
  expect(scroller).not.toBeNull()
  if (scroller === null) return

  expect(scroller.dataset.scrolled).toBe('false')
  scrollTo(scroller, 40)
  expect(scroller.dataset.scrolled).toBe('true')
  // …and back: a rider who returns to the top gets the top row drawn whole again.
  scrollTo(scroller, 0)
  expect(scroller.dataset.scrolled).toBe('false')
})

it('still reports the offset its host asked for', () => {
  // `DraggableSheet`'s `onContentScroll` is how Route detail collapses its header (ADR-043), and the fade
  // moved into that same container — so the pass-through is not an incidental prop.
  const seen: number[] = []
  act(() => {
    root.render(
      <DraggableSheet label="Stops" onContentScroll={(top) => seen.push(top)}>
        <p>a row</p>
      </DraggableSheet>,
    )
  })
  const scroller = host.querySelector<HTMLElement>('.sheet-scroll')
  if (scroller === null) throw new Error('the draggable sheet has no fading scroll container')
  scrollTo(scroller, 12)
  scrollTo(scroller, 0)
  expect(seen).toEqual([12, 0])
})

it('is the same component in the modal sheet', () => {
  act(() => {
    root.render(
      <RouteFactSheet
        locale="en"
        onClose={() => {}}
        sheet={{
          kind: 'stops',
          stats: [{ stat: 'stops', value: '42', estimate: false }],
        }}
      />,
    )
  })
  expect(host.querySelectorAll('.sheet-scroll')).toHaveLength(1)
})
