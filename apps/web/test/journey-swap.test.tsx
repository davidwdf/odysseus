// The direction flip's name swap, and the property that matters more than the animation.
//
// AT REST THE HEADER MUST BE EXACTLY TWO LINES. A conformance projection reads text by *presence* rather
// than visibility (ADR-097), so a header that kept the outgoing journey mounted would make Route detail
// project four names for one route — on a resting screen, permanently, and in all nineteen declared states.
// No state suite would catch it: they mount settled and never flip. This file is the only thing standing
// there, exactly as `slide-number.test.tsx` is for the odometer.
//
// The second half is the reduced-motion path, which is unusual here and worth a test for that reason: every
// other animation in `apps/web` is switched off by a CSS media query, and this one is switched off in
// JavaScript — because killing the keyframes would leave four lines stacked at full opacity for 380 ms
// rather than none. A rider who asked for less motion must get the new journey immediately.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JourneyLines } from '../src/components/JourneyLines'

let container: HTMLElement
let root: Root | null = null

/** Every rendered line, in document order — what a projection would read. */
const lines = () =>
  [...container.querySelectorAll('span')]
    .filter((el) => el.querySelector('span') === null && (el.textContent ?? '') !== '')
    .map((el) => (el.textContent ?? '').trim())

const layers = () => container.querySelectorAll('.jl-origin-out, .jl-rise, .jl-dest-in').length

function render(origin: string, destination: string, nonce: number): void {
  act(() => {
    root?.render(
      <JourneyLines origin={origin} destination={destination} circular={false} nonce={nonce} />,
    )
  })
}

/** jsdom has no `matchMedia` at all, so each test declares which rider it is describing. */
function stubMotionPreference(reduced: boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: reduced,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
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
  // @ts-expect-error — putting jsdom back the way it was found, which is without the API at all
  window.matchMedia = undefined
  vi.clearAllTimers()
})

describe('the direction flip’s name swap', () => {
  it('is two lines at rest, with no animation layers at all', () => {
    stubMotionPreference(false)
    render('Kam Ying Court', 'Prince of Wales Hospital', 0)
    expect(lines()).toEqual(['Kam Ying Court', 'Prince of Wales Hospital'])
    expect(layers(), 'the swap mounted on a route that was never flipped').toBe(0)
  })

  it('runs the swap only while the names are changing, and tears it down after', () => {
    stubMotionPreference(false)
    render('Kam Ying Court', 'Prince of Wales Hospital', 0)
    // The tap arms it; the reverse payload landing fires it. Both in one commit is the cached case.
    render('Prince of Wales Hospital', 'Kam Ying Court', 1)
    expect(layers(), 'nothing animated on a real flip').toBe(3)
    act(() => {
      vi.advanceTimersByTime(380)
    })
    expect(layers(), 'the swap never tore itself down').toBe(0)
    expect(lines()).toEqual(['Prince of Wales Hospital', 'Kam Ying Court'])
  })

  it('rises the OLD destination into the origin slot — the whole point of the motion', () => {
    // `.jl-rise` is the line that says "where you were going is where you now start". If it carried the
    // *new* origin the animation would still look plausible and would mean nothing, because on a reversal
    // the two strings are equal — so this asserts it on a flip to a THIRD route, where they differ.
    stubMotionPreference(false)
    render('Kam Ying Court', 'Prince of Wales Hospital', 0)
    render('Sha Tin Station', 'Mong Kok', 1)
    expect(container.querySelector('.jl-origin-out')?.textContent).toBe('Kam Ying Court')
    expect(container.querySelector('.jl-rise')?.textContent).toBe('Prince of Wales Hospital')
    expect(container.querySelector('.jl-dest-in')?.textContent).toBe('Mong Kok')
  })

  it('collapses to the newest journey when a second flip lands mid-swap', () => {
    // A rider can tap the toggle twice inside 380 ms. Two overlapping swaps would leave six lines in the
    // tree and settle on whichever timer happened to fire last.
    stubMotionPreference(false)
    render('A', 'B', 0)
    render('B', 'A', 1)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    render('A', 'B', 2)
    expect(layers()).toBe(3)
    act(() => {
      vi.advanceTimersByTime(380)
    })
    expect(layers()).toBe(0)
    expect(lines()).toEqual(['A', 'B'])
  })

  it('never enters the swap state for a rider who asked for less motion', () => {
    stubMotionPreference(true)
    render('Kam Ying Court', 'Prince of Wales Hospital', 0)
    render('Prince of Wales Hospital', 'Kam Ying Court', 1)
    expect(layers(), 'reduced motion still stacked four lines in the tree').toBe(0)
    expect(lines(), 'the new journey did not arrive at all').toEqual([
      'Prince of Wales Hospital',
      'Kam Ying Court',
    ])
  })
})
