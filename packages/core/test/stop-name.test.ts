import { describe, expect, it } from 'vitest'
import corpus from '../spec/stop-name.spec.json'
import {
  isCircular,
  poleFlagCode,
  poleNameKey,
  splitStopCode,
  stripCircular,
  titleCaseName,
} from '../src/stop-name'
import type { I18nText, Locale } from '../src/types'
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

describe('stop-name#poleNameKey', () => {
  for (const c of specCases<{ label: string }, string>(corpus, 'poleNameKey')) {
    it(c.name, () => {
      expect(poleNameKey(c.args.label)).toBe(c.expect)
    })
  }

  it('is idempotent, so a key can safely be folded twice', () => {
    // The caller folds names it took off the wire, and a second fold happens the moment somebody
    // memoizes one. A fold that removed a character it also emits would be silently non-idempotent.
    for (const c of specCases<{ label: string }, string>(corpus, 'poleNameKey')) {
      expect(poleNameKey(poleNameKey(c.args.label)), c.name).toBe(c.expect)
    }
  })
})

describe('stop-name#poleFlagCode', () => {
  for (const c of specCases<{ name: I18nText; locale: Locale }, string | null>(
    corpus,
    'poleFlagCode',
  )) {
    it(c.name, () => {
      // JSON `null` is the language's absent value at this boundary — see `test/corpus.ts`.
      expect(poleFlagCode(c.args.name, c.args.locale) ?? null).toBe(c.expect)
    })
  }
})
