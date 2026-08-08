// The arrival odometer's contract, and one property of it matters more than the animation.
//
// AT REST IT MUST BE A SINGLE TEXT NODE. A conformance projection reads text by *presence* rather than
// visibility (ADR-097), so a readout that kept both its old and new values in the tree would make every
// screen carrying an arrival project two figures for one bus — on a resting screen, permanently, on
// Nearby, Favourites, Place detail and the route schematic at once. No state suite would catch it either,
// because they mount settled and never change a value; this file is the only thing standing there.
//
// The animation itself is CSS, so what is asserted here is the *structure* each phase produces: which
// characters are static, which slide, and that the machinery tears itself down.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlideNumber } from '../src/components/SlideNumber'
import { splitChange } from '../src/lib/odometer'

let container: HTMLElement
let root: Root | null = null

const text = () => (container.textContent ?? '').trim()
const sliding = () => container.querySelectorAll('.odo-in, .odo-out').length

function render(value: string): void {
  act(() => {
    root?.render(<SlideNumber value={value} />)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('the arrival odometer', () => {
  it('is one text node at rest, with no animation machinery at all', () => {
    render('12')
    expect(text()).toBe('12')
    expect(sliding(), 'the transition mounted on a value that never changed').toBe(0)
  })

  it('mounts the sliding pair only while a value is changing, and tears it down after', () => {
    render('12')
    render('11')
    expect(sliding(), 'nothing slid on a real change').toBe(2)
    act(() => {
      vi.advanceTimersByTime(260)
    })
    expect(sliding(), 'the transition never tore itself down').toBe(0)
    expect(text()).toBe('11')
  })

  it('slides only the characters that changed', () => {
    // The whole reason for the diff: "52 min" → "51 min" must not lurch the "5" or the " min". Asserted on
    // the helper as well as through the component, because the component only shows the *result*.
    expect(splitChange('52 min', '51 min')).toEqual({
      prefix: '5',
      suffix: ' min',
      prevMid: '2',
      nextMid: '1',
    })
    // Nothing shared: the whole readout slides.
    expect(splitChange('1 min', 'Due')).toEqual({
      prefix: '',
      suffix: '',
      prevMid: '1 min',
      nextMid: 'Due',
    })
  })

  it('keeps the unchanged characters out of the sliding box', () => {
    render('52 min')
    render('51 min')
    const outgoing = container.querySelector('.odo-out')
    const incoming = container.querySelector('.odo-in')
    expect(outgoing?.textContent).toBe('2')
    expect(incoming?.textContent).toBe('1')
    // Mid-flight the tree carries exactly TWO copies of the changing characters and no more — the
    // prefix, both middles, the suffix. An earlier version drew a third as an invisible sizer and this
    // read `"5112 min"`; an inline grid sizes the box instead.
    expect(text()).toBe('512 min')
    act(() => {
      vi.advanceTimersByTime(260)
    })
    expect(text(), 'and it settles to exactly the new value').toBe('51 min')
  })

  it('does not announce the value on its way out', () => {
    // A screen reader should hear one arrival, not two: the outgoing copy is decorative for 260 ms.
    render('12')
    render('11')
    expect(container.querySelector('.odo-out')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.odo-in')?.hasAttribute('aria-hidden')).toBe(false)
  })

  it('collapses to the new value when a second change lands mid-flight', () => {
    // A live screen refetches on a cadence and a rider can sit on it — two changes inside 260 ms must not
    // leave three values in the tree, which is what a per-change timer with no reset would do.
    render('12')
    render('11')
    act(() => {
      vi.advanceTimersByTime(100)
    })
    render('10')
    expect(sliding()).toBe(2)
    act(() => {
      vi.advanceTimersByTime(260)
    })
    expect(sliding()).toBe(0)
    expect(text()).toBe('10')
  })
})
