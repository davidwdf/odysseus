import { describe, expect, it } from 'vitest'
import corpus from '../spec/location-mark.spec.json'
import {
  accuracyRadiusM,
  type HeadingSources,
  type LocationMark,
  locationMark,
} from '../src/location-mark'
import { specCases } from './corpus'

/**
 * JSON carries no `NaN` and no `Infinity`, so the corpus spells them as strings and every suite
 * decodes them — see the file's own `doc`. Done at the boundary rather than inside the rule, because
 * the rows exist to pin that a **non-finite reading is no reading**, and a port that passed the string
 * straight through would be testing string handling and reporting a pass.
 */
function decode(value: unknown): number | null | undefined {
  if (value === 'NaN') return Number.NaN
  if (value === 'Infinity') return Number.POSITIVE_INFINITY
  return value as number | null | undefined
}

describe('location-mark#locationMark', () => {
  for (const c of specCases<{ sources: Record<string, unknown> }, LocationMark>(
    corpus,
    'locationMark',
  )) {
    it(c.name, () => {
      const sources: HeadingSources = {}
      if ('compassDeg' in c.args.sources) sources.compassDeg = decode(c.args.sources.compassDeg)
      if ('courseDeg' in c.args.sources) sources.courseDeg = decode(c.args.sources.courseDeg)
      expect(locationMark(sources)).toEqual(c.expect)
    })
  }

  it('never invents a direction, over every combination of absent inputs', () => {
    // A property rather than a value, and the one sentence this whole module exists for: with nothing
    // usable to go on the answer is a DOT — never a dart at 0°, which is north and is a claim a rider
    // standing at a kerb will act on.
    const nothing = [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]
    for (const compassDeg of nothing) {
      for (const courseDeg of nothing) {
        expect(locationMark({ compassDeg, courseDeg })).toEqual({ kind: 'dot' })
      }
    }
  })
})

describe('location-mark#accuracyRadiusM', () => {
  for (const c of specCases<{ accuracyM: unknown }, number | null>(corpus, 'accuracyRadiusM')) {
    it(c.name, () => {
      expect(accuracyRadiusM(decode(c.args.accuracyM)) ?? null).toBe(c.expect)
    })
  }
})
