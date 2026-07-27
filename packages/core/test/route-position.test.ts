import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-position.spec.json'
import { type BusMarker, inferBusMarkers } from '../src/route-position'
import { at, specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/route-position.spec.json.

describe('route-position#inferBusMarkers', () => {
  for (const c of specCases<{ soonest: Array<string | null>; nowIso: string }, BusMarker[]>(
    corpus,
    'inferBusMarkers',
  )) {
    it(c.id, () => {
      expect(inferBusMarkers(c.args.soonest, at(c.args.nowIso))).toEqual(c.expect)
    })
  }

  it('returns markers in ascending stop order', () => {
    // A property over every row rather than a value: the route view draws these in sequence, so an
    // out-of-order marker list would paint buses in the wrong segments without any single row
    // necessarily failing.
    for (const c of specCases<{ soonest: Array<string | null>; nowIso: string }, BusMarker[]>(
      corpus,
      'inferBusMarkers',
    )) {
      const indexes = inferBusMarkers(c.args.soonest, at(c.args.nowIso)).map((m) => m.toIndex)
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    }
  })
})
