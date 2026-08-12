// The reserved arrivals line on Route detail's schematic — and the distinction it must NOT blur.
//
// WHAT IT IS FOR. A route watch resolves every pole server-side and answers in one round (ADR-116), so on a
// slow round all 34 rows gain their arrivals line at the same instant: the rail, every bus token's row and
// the reveal of the originating stop all jump together. `arrivalsPending` reserves the line so the height is
// settled before any number exists.
//
// WHY IT IS TESTED RATHER THAN LOOKED AT. The window is the length of one round — about 200 ms against a warm
// cache — so catching it in a browser is a race, and a race is not evidence. What is checkable is the rule,
// and the rule has three arms.
//
// THE ARM THAT MATTERS IS THE SECOND. "No bus due" and "we have not asked yet" are different facts, and one
// placeholder for both is the exact conflation ADR-073 wrote down and ADR-124 found twice more. A skeleton
// that outlived its round would be a screen telling a rider it is still working when it has already answered
// — the same lie in the other direction. So the middle test is the one to keep if the others ever go.

import type { RouteStopRowView } from '@nextbus/core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteStopRow } from '../src/components/RouteStopRow'

vi.mock('../src/providers/LocaleProvider', () => ({ useLocale: () => 'en' }))

/** A row with everything the component reads, so a change to the view model fails here loudly. */
const ROW: RouteStopRowView = {
  seq: 1,
  stopId: 'KMB:18492910339E23AA',
  name: { label: 'Sau Mau Ping (Central)', code: 'KT975' },
  arrivals: [],
  here: false,
  first: true,
  last: false,
  saved: false,
  incomplete: false,
  fareLabel: null,
} as unknown as RouteStopRowView

const WITH_TIME: RouteStopRowView = {
  ...ROW,
  arrivals: [
    {
      iso: '2026-08-12T13:00:00+08:00',
      label: { kind: 'mins', value: 3, unit: 'min' },
      urgency: 'soon',
      stale: false,
    },
  ],
} as unknown as RouteStopRowView

// The same mount harness `bus-token.test.tsx` documents: a real root into a real host, so the row is the
// component React produced rather than a rendering of it.
let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = createRoot(container)
})

function draw(row: RouteStopRowView, arrivalsPending: boolean): HTMLElement {
  act(() => {
    root?.render(
      <RouteStopRow
        row={row}
        index={0}
        animateIn={false}
        arrivalsPending={arrivalsPending}
        tokens={null}
        onPress={() => {}}
        registerRow={() => {}}
      />,
    )
  })
  return container
}

/** The reserved line: wordless bars, so it is found by shape rather than by text. */
const bars = (host: HTMLElement) => host.querySelectorAll('span.bg-surface-2')

afterEach(() => {
  act(() => root?.unmount())
  root = null
})

describe('the arrivals line is reserved only while the round is out', () => {
  it('draws the placeholder when the round has not answered', () => {
    const container = draw(ROW, true)
    expect(bars(container).length, 'no line was reserved, so the row will jump').toBe(2)
    // A layout promise, not content — and this is the half a projection would otherwise catch fire on.
    const line = container.querySelector('[aria-hidden="true"] span.bg-surface-2')?.parentElement
    expect(line?.textContent).toBe('')
  })

  it('draws NOTHING when the round answered and there is simply no bus due', () => {
    // **The arm that matters.** Same empty `arrivals`, different reason — and the screen must not dress one
    // as the other. A placeholder here would say "still working" about a question already answered, which is
    // ADR-073's conflation pointing the other way.
    const container = draw(ROW, false)
    expect(bars(container).length, 'a quiet stop was drawn as a loading one').toBe(0)
  })

  it('draws the times, not the placeholder, once they arrive', () => {
    const container = draw(WITH_TIME, true)
    expect(bars(container).length).toBe(0)
    expect(container.textContent).toContain('3')
    expect(container.textContent).toContain('min')
  })

  it('reserves a line whose two bars differ, because the slots they stand in for do', () => {
    // The first slot is `text-body font-semibold` and the rest are `text-caption`. Two identical bars would
    // settle the row to the wrong height, which is the whole defect this exists to fix.
    const container = draw(ROW, true)
    const drawn = [...bars(container)] as HTMLElement[]
    expect(drawn).toHaveLength(2)
    const [lead, rest] = drawn
    expect(lead?.className).not.toBe(rest?.className)
  })
})
