// The bus token's idle motion, and the one property that is not a matter of taste: **the bounce has to be
// centred on the node**.
//
// The owner reported the bouncing buses looking misaligned. The disc was pixel-exact on its node and the
// glyph pixel-exact in the disc — measured in a browser, dx 0.0 / dy 0.0 for every token — but the *moving*
// glyph was not. Its ink centre travelled −0.47 px to **+1.00 px** against the disc centre: a whole pixel
// low at every landing, never a whole pixel high, mean +0.27 px. On a 24 px disc that reads as a bus that
// does not sit in its own token.
//
// The cause is that the squash is not a pure squeeze. Its origin is `center bottom` of a box TALLER than
// the glyph's ink — the glyph is drawn to y 22.1 of a 24 viewBox — so squeezing about that point also
// translates the ink down, and it runs on the bob's clock, in phase, so on the downstroke the two add.
//
// jsdom lays nothing out and runs no animations, so this cannot be measured here the way it was in the
// browser. What it CAN do is recompute the invariant from the same two sources the browser reads: the
// glyph's own rect coordinates, and the keyframes in `index.css`. If either drifts — a rect nudged, a
// constant "restored" to the native ±0.5 — the swing stops being symmetric and this fails.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BusGlyph } from '../src/components/BusGlyph'
import { RailBusToken } from '../src/components/RailBusToken'

/**
 * This app's own source, addressed the way `shell-parity.test.ts` addresses `apps/mobile`'s — walk up until
 * the directory exists. Its docblock has the full reasoning; the short version is that `import.meta.url` is
 * an `http://localhost/…` URL under the jsdom environment and a cwd-relative path is right only when vitest
 * is invoked from `apps/web`. Getting it wrong throws at *import* time, which reports the file as failed
 * rather than the tests — a suite that appears to run while asserting nothing.
 */
function findWebSrc(): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'apps', 'web', 'src')
    if (existsSync(join(candidate, 'index.css'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no apps/web/src above ${process.cwd()}`)
    dir = parent
  }
}

const CSS = readFileSync(join(findWebSrc(), 'index.css'), 'utf8')

/** The one value in the keyframe block, e.g. `translateY(-0.75px)` → -0.75. */
function keyframeValues(name: string, fn: string): { from: number; to: number } {
  const block = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS)
  if (!block?.[1]) throw new Error(`no @keyframes ${name} in index.css`)
  const nums = [...block[1].matchAll(new RegExp(`${fn}\\(([^)]*)\\)`, 'g'))].map((m) =>
    Number.parseFloat((m[1] ?? '').split(',').pop() ?? ''),
  )
  const [from, to] = nums
  if (from === undefined || to === undefined)
    throw new Error(`@keyframes ${name}: expected two stops`)
  return { from, to }
}

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
})

describe('the bus token’s bounce', () => {
  it('swings symmetrically about the node once the squash is accounted for', () => {
    // 1. The glyph's ink extent, from its own rects — geometry, not a number copied into this file.
    act(() => {
      root?.render(<BusGlyph size={GLYPH} />)
    })
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('BusGlyph rendered no svg')
    const stroke = Number.parseFloat(svg.querySelector('rect')?.getAttribute('stroke-width') ?? '')
    const rects = [...svg.querySelectorAll('rect')].map((r) => ({
      y: Number.parseFloat(r.getAttribute('y') ?? ''),
      h: Number.parseFloat(r.getAttribute('height') ?? ''),
    }))
    const inkTop = Math.min(...rects.map((r) => r.y)) - stroke / 2
    const inkBottom = Math.max(...rects.map((r) => r.y + r.h)) + stroke / 2
    // The whole reason this is a problem: the ink does not reach the bottom of the viewBox, so
    // `transform-origin: center bottom` is anchored in mid-air below the wheels.
    expect(inkBottom, 'the glyph now fills its viewBox — re-derive the squash offset').toBeLessThan(
      VIEWBOX,
    )

    // 2. What the squash does to the ink centre: scale about the box's bottom edge.
    const scale = GLYPH / VIEWBOX
    const boxHeight = GLYPH
    const inkCentre = ((inkTop + inkBottom) / 2) * scale
    const squashY = keyframeValues('bus-squash', 'scale').to
    const squashDrop = (boxHeight - inkCentre) * (1 - squashY)

    // 3. The bob's two ends, plus that drop at the end where they coincide — the squash and the bob share
    //    one 550 ms clock and one direction, which is what makes them add rather than average out.
    const bob = keyframeValues('bus-bob', 'translateY')
    const top = bob.from
    const bottom = bob.to + squashDrop

    expect(top, 'the bounce no longer reaches above the node').toBeLessThan(0)
    expect(bottom, 'the bounce no longer reaches below the node').toBeGreaterThan(0)
    // The claim: the midpoint of the swing is the node itself. A flat ±0.5 bob — the native constant, and
    // what this used to be — lands at +0.25 here and fails.
    expect(
      (top + bottom) / 2,
      `bounce midpoint is ${((top + bottom) / 2).toFixed(3)}px off the node, not centred on it`,
    ).toBeCloseTo(0, 1)
  })

  it('translates outside the rotation, so a bob cannot move the glyph sideways', () => {
    // `apps/mobile` writes `transform: [translateY, rotateZ]`, which composes translate-last. Nested
    // elements compose outermost-last, so the bob has to be the OUTER span. With the rock outside it, the
    // bob's travel was itself rotated by up to 6° and the glyph drifted sideways — measured at ±0.11 px on
    // something that should only ever move vertically.
    act(() => {
      root?.render(
        <RailBusToken bus={{ kind: 'node', index: 0, label: 'Bus at a stop' }} top={0} />,
      )
    })
    const bob = container.querySelector('.bus-bob')
    const rock = container.querySelector('.bus-rock')
    const squash = container.querySelector('.bus-squash')
    expect(bob, 'no bob layer').not.toBeNull()
    expect(
      bob?.contains(rock ?? null),
      'the rock is not inside the bob — translation is being rotated',
    ).toBe(true)
    expect(rock?.contains(squash ?? null), 'the squash is not innermost').toBe(true)
    expect(squash?.querySelector('svg'), 'the glyph is not inside the squash').not.toBeNull()
  })
})

/** `RailBusToken`'s `TOKEN * 0.66`, and the glyph's grid. */
const GLYPH = 24 * 0.66
const VIEWBOX = 24
