import { describe, expect, it } from 'vitest'
import corpus from '../spec/fare-stages.spec.json'
import { fareStageStarts } from '../src/fare-stages'
import { specCases } from './corpus'

describe('fare-stages#fareStageStarts', () => {
  for (const c of specCases<{ fares: (string | null)[] }, boolean[]>(corpus, 'fareStageStarts')) {
    it(c.name, () => {
      expect(fareStageStarts(c.args.fares)).toEqual(c.expect)
    })
  }

  it('always answers one flag per stop', () => {
    // A caller zips this against its rows by index, so a length mismatch would silently shift every
    // header down the list rather than failing anywhere near the cause.
    for (const c of specCases<{ fares: (string | null)[] }, boolean[]>(corpus, 'fareStageStarts')) {
      expect(fareStageStarts(c.args.fares)).toHaveLength(c.args.fares.length)
    }
  })
})
