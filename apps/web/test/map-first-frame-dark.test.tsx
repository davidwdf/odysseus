// **A map must open in the rider's theme, not arrive at it.**
//
// The LandsD basemap is a raster cartography drawn for white paper, so dark mode is a filter over the
// tiles (`MapView`'s `DARK_RASTER`, ADR-041/049). That filter used to be applied only by the effect that
// keeps a live map in step with a rider who flips theme — and an effect cannot reach the layers before
// the style exists, so it waited on MapLibre's `load`. `load` fires *after* the initial tiles are fetched
// and drawn, which made the first second of every route detail a white map in a dark app.
//
// WHY IT IS A TEST RATHER THAN A LOOK. The fix is one word in the style object, and nothing on screen
// distinguishes it from the old behaviour once a second has passed — the failure is a *frame*, and a
// screenshot taken after load passes either way. What is checkable is the thing the engine is handed:
// the style MapLibre is constructed with already carries the inversion. So the engine is the seam this
// mocks, and the assertion is on its constructor argument.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/worker.mjs' }))

type Layer = { id: string; paint: Record<string, number> }
const constructed: { style: { layers: Layer[] } }[] = []

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor(options: { style: { layers: Layer[] } }) {
      constructed.push(options)
    }
    // The component attaches `error` and `load` and never sees either in jsdom: there is no WebGL
    // context here, which is exactly why the assertion is on construction and not on a rendered pixel.
    on() {}
    once() {}
    getLayer() {
      return undefined
    }
    isStyleLoaded() {
      return false
    }
    setPaintProperty() {}
    jumpTo() {}
    remove() {}
  }
  return { Map: FakeMap, setWorkerUrl: () => {} }
})

const { MapView } = await import('../src/components/MapView')
const { usePreferences } = await import('../src/lib/preferences')
const { LocaleProvider } = await import('../src/providers/LocaleProvider')

const CENTRE = { lat: 22.3193, lng: 114.1694 }

function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    createRoot(host).render(
      <LocaleProvider>
        <MapView centre={CENTRE} />
      </LocaleProvider>,
    )
  })
}

/** Every raster layer's paint, so the base and the label overlay are both covered. */
function paints(): Record<string, number>[] {
  const options = constructed.at(-1)
  if (!options) throw new Error('no map was constructed')
  return options.style.layers.map((l) => l.paint)
}

describe('the style a map is built from', () => {
  beforeEach(() => {
    constructed.length = 0
    // jsdom has no `matchMedia`; `systemPrefersDark` guards for it and resolves light, so an explicit
    // preference — not the OS — is what drives both cases here.
    usePreferences.setState({ appearance: 'light' })
  })

  it('opens dark when the rider is in dark mode — no white first frame', () => {
    usePreferences.setState({ appearance: 'dark' })
    mount()
    const layers = paints()
    expect(layers.length).toBeGreaterThan(1) // base + labels
    for (const paint of layers) {
      expect(paint['raster-brightness-min']).toBe(1)
      expect(paint['raster-brightness-max']).toBe(0)
      expect(paint['raster-hue-rotate']).toBe(180)
    }
  })

  it('opens light when the rider is in light mode', () => {
    mount()
    for (const paint of paints()) {
      expect(paint['raster-brightness-min']).toBe(0)
      expect(paint['raster-brightness-max']).toBe(1)
      expect(paint['raster-hue-rotate']).toBe(0)
    }
  })
})
