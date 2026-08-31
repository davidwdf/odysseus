import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DETENT,
  dragVelocity,
  FLICK_VELOCITY,
  OVERDRAG_RESISTANCE,
  ROUTE_DETENTS,
  resist,
  resolveDetent,
  settleDetent,
  stepDetent,
} from '../src/components/sheet/detents'

/**
 * The draggable sheet's arithmetic, tested as numbers — which is the whole reason it is a module and
 * not a closure inside the component. A drag cannot be exercised in jsdom (no layout, no real pointer
 * timings), so the alternative to this would be a component whose behaviour is only ever checked by
 * hand, and gestures are exactly where "it felt right when I tried it" stops being evidence.
 */
describe('sheet detents', () => {
  it('opens at half, which is the only shape where both halves are usable', () => {
    // Not a tautology: the constant is what `DraggableSheet` defaults to, and the reason there are
    // three detents rather than two is that this middle one is the resting shape the other two are
    // departures from. Changing it should be a decision, and this is where the decision is recorded.
    expect(DEFAULT_DETENT).toBe('half')
    expect(resolveDetent(ROUTE_DETENTS, DEFAULT_DETENT).fraction).toBeCloseTo(0.55)
  })

  it('falls back to the smallest detent rather than crashing on a name it does not know', () => {
    expect(resolveDetent(ROUTE_DETENTS, 'nonsense').name).toBe('map')
  })

  describe('settling', () => {
    it('picks the nearest rest for a slow release', () => {
      expect(settleDetent(0.25, 0, ROUTE_DETENTS, 'half').name).toBe('map')
      expect(settleDetent(0.5, 0, ROUTE_DETENTS, 'half').name).toBe('half')
      expect(settleDetent(0.8, 0, ROUTE_DETENTS, 'half').name).toBe('list')
    })

    it('follows a flick even when the detent behind is nearer', () => {
      // **The rule that makes a throw feel right.** Released just above `half` and moving fast
      // upward: proximity says stay at `half`, and staying reads as the gesture having failed. This
      // is the case a nearest-only implementation gets wrong, and it gets it wrong in the direction
      // riders notice.
      expect(settleDetent(0.57, FLICK_VELOCITY + 0.1, ROUTE_DETENTS, 'half').name).toBe('list')
      expect(settleDetent(0.53, -FLICK_VELOCITY - 0.1, ROUTE_DETENTS, 'half').name).toBe('map')
    })

    it('treats a fast-but-not-flicked release as a slow one', () => {
      // The boundary. Just under the threshold is proximity, so a firm-but-deliberate drag lands
      // where the hand left it rather than overshooting.
      expect(settleDetent(0.57, FLICK_VELOCITY - 0.01, ROUTE_DETENTS, 'half').name).toBe('half')
    })

    it('moves exactly one detent per flick, never two', () => {
      // A hard throw from the bottom reaches the middle, not the top. Skipping detents would make
      // the sheet unpredictable in the one situation where a rider is being least precise.
      expect(settleDetent(0.22, 9, ROUTE_DETENTS, 'map').name).toBe('half')
    })

    it('clamps a flick at the ends', () => {
      expect(settleDetent(0.88, 9, ROUTE_DETENTS, 'list').name).toBe('list')
      expect(settleDetent(0.22, -9, ROUTE_DETENTS, 'map').name).toBe('map')
    })
  })

  describe('over-drag', () => {
    it('leaves a drag inside the range untouched', () => {
      expect(resist(0.4, ROUTE_DETENTS)).toBeCloseTo(0.4)
    })

    it('still moves past each end, at a third', () => {
      // A sheet that stops dead under a moving finger reads as broken or as having been let go. This
      // is what says "this is the end" while staying attached to the hand.
      expect(resist(0.98, ROUTE_DETENTS)).toBeCloseTo(0.88 + 0.1 * OVERDRAG_RESISTANCE)
      expect(resist(0.12, ROUTE_DETENTS)).toBeCloseTo(0.22 - 0.1 * OVERDRAG_RESISTANCE)
    })
  })

  describe('velocity', () => {
    it('is fractions of the container per second, signed so up is positive', () => {
      // 100 px of an 800 px container in 100 ms = an eighth of the sheet in a tenth of a second.
      expect(dragVelocity(100, 800, 100)).toBeCloseTo(1.25)
      expect(dragVelocity(-100, 800, 100)).toBeCloseTo(-1.25)
    })

    it('cannot divide by zero when two pointer events share a timestamp', () => {
      // Which they do. Without the floor a gentle release becomes an infinite flick, and the sheet
      // jumps a detent for a gesture that barely moved.
      expect(Number.isFinite(dragVelocity(4, 800, 0))).toBe(true)
    })
  })

  describe('keyboard', () => {
    it('steps one detent at a time and stops at both ends', () => {
      // The handle is a `<button>` for this: a sheet that can only be dragged cannot be operated
      // without a pointing device, and on this screen everything lives inside it.
      expect(stepDetent(ROUTE_DETENTS, 'map', 1).name).toBe('half')
      expect(stepDetent(ROUTE_DETENTS, 'half', 1).name).toBe('list')
      expect(stepDetent(ROUTE_DETENTS, 'list', 1).name).toBe('list')
      expect(stepDetent(ROUTE_DETENTS, 'map', -1).name).toBe('map')
    })
  })
})
