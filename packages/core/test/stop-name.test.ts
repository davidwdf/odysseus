import { describe, expect, it } from 'vitest'
import corpus from '../spec/stop-name.spec.json'
import { isCircular, splitStopCode, stripCircular, titleCaseName } from '../src/stop-name'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/stop-name.spec.json.

describe('stop-name#splitStopCode', () => {
  for (const c of specCases<{ name: string }, { label: string; code: string | null }>(
    corpus,
    'splitStopCode',
  )) {
    it(c.name, () => {
      const got = splitStopCode(c.args.name)
      // The absent `code` is normalized to JSON `null` here rather than in the rule, so the corpus
      // stays readable by an XCTest or JUnit suite that has no `undefined` to compare against.
      expect({ label: got.label, code: got.code ?? null }).toEqual(c.expect)
    })
  }
})

describe('stop-name#titleCaseName', () => {
  for (const c of specCases<{ name: string }, string>(corpus, 'titleCaseName')) {
    it(c.name, () => {
      expect(titleCaseName(c.args.name)).toBe(c.expect)
    })
  }

  it('is idempotent', () => {
    // A property over every row rather than a value. The route and stop screens both title-case a
    // label that has sometimes already been title-cased upstream of them, so a second pass must be
    // a no-op — and it is, precisely because a lower-case letter anywhere makes the rule bail. If
    // that guard is ever narrowed, this fails before a screen starts re-casing its own output.
    for (const c of specCases<{ name: string }, string>(corpus, 'titleCaseName')) {
      const once = titleCaseName(c.args.name)
      expect(titleCaseName(once)).toBe(once)
    }
  })
})

describe('stop-name#isCircular', () => {
  for (const c of specCases<{ name: string }, boolean>(corpus, 'isCircular')) {
    it(c.name, () => {
      expect(isCircular(c.args.name)).toBe(c.expect)
    })
  }
})

describe('stop-name#stripCircular', () => {
  for (const c of specCases<{ name: string }, string>(corpus, 'stripCircular')) {
    it(c.name, () => {
      expect(stripCircular(c.args.name)).toBe(c.expect)
    })
  }

  it('never invents a circular marker it did not strip', () => {
    // The pair has to stay consistent in one direction only: stripping can leave a name that is
    // still `isCircular` (the unbracketed marker), but it must never turn a plain destination into
    // one. This catches a regex edit that reordered the alternation into a capturing group and
    // re-inserted it.
    for (const c of specCases<{ name: string }, string>(corpus, 'stripCircular')) {
      if (!isCircular(c.args.name)) expect(isCircular(stripCircular(c.args.name))).toBe(false)
    }
  })
})
