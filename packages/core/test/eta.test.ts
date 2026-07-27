import { describe, expect, it } from 'vitest'
import corpus from '../spec/eta.spec.json'
import {
  classifyRemark,
  dedupeEtas,
  type EtaLabelParts,
  type EtaView,
  estimateChildFare,
  estimateElderlyFare,
  etaLabelParts,
  etaView,
  type FareStage,
  fareRange,
  fareStages,
  formatClock,
  formatFare,
  formatFareRange,
  formatHeadway,
  formatJourney,
  formatRelative,
  formatServiceHours,
  formatStopCount,
  isStale,
  type RemarkKind,
} from '../src/eta'
import type { Eta, I18nText, Locale } from '../src/types'
import { at, nullToUndefined, specCases } from './corpus'

// Every `describe` below is one `@spec` group in ../spec/eta.spec.json, driven by the corpus rather
// than by hand-written cases — so a rule change is an edit to the JSON and this file never needs to
// be touched. See ./corpus.ts for why the corpus is data and not TypeScript.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/** The three fields `dedupeEtas` reads; the rest of `Eta` is filled with inert values. */
interface EtaRow {
  routeId: string
  operator: Eta['operator']
  arrivals: string[]
}
const toEta = (row: EtaRow): Eta => ({
  ...row,
  stopId: 'KMB:ST141',
  dataTimestamp: '2026-07-27T12:00:00+08:00',
  observedAt: '2026-07-27T12:00:00+08:00',
})

describe('eta#etaView', () => {
  for (const c of cases<{ arrivalIso: string; nowIso: string }, EtaView>('etaView')) {
    it(c.id, () => {
      expect(etaView(c.args.arrivalIso, at(c.args.nowIso))).toEqual(c.expect)
    })
  }
})

describe('eta#formatRelative', () => {
  for (const c of cases<{ arrivalIso: string; nowIso: string; locale: Locale }, string>(
    'formatRelative',
  )) {
    it(c.id, () => {
      expect(formatRelative(c.args.arrivalIso, at(c.args.nowIso), c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#etaLabelParts', () => {
  for (const c of cases<{ arrivalIso: string; nowIso: string; locale: Locale }, EtaLabelParts>(
    'etaLabelParts',
  )) {
    it(c.id, () => {
      expect(etaLabelParts(c.args.arrivalIso, at(c.args.nowIso), c.args.locale)).toEqual(c.expect)
    })
  }
})

describe('eta#isStale', () => {
  for (const c of cases<{ dataTimestamp: string; nowIso: string }, boolean>('isStale')) {
    it(c.id, () => {
      const eta = toEta({ routeId: 'KMB:1:outbound:1', operator: 'KMB', arrivals: [] })
      expect(isStale({ ...eta, dataTimestamp: c.args.dataTimestamp }, at(c.args.nowIso))).toBe(
        c.expect,
      )
    })
  }
})

describe('eta#dedupeEtas', () => {
  for (const c of cases<{ etas: EtaRow[] }, string[]>('dedupeEtas')) {
    it(c.id, () => {
      expect(dedupeEtas(c.args.etas.map(toEta)).map((e) => e.routeId)).toEqual(c.expect)
    })
  }
})

describe('eta#formatFare', () => {
  for (const c of cases<{ fare: string }, string>('formatFare')) {
    it(c.id, () => {
      expect(formatFare(c.args.fare)).toBe(c.expect)
    })
  }
})

describe('eta#fareRange', () => {
  for (const c of cases<{ fares: Array<string | null> }, { min: string; max: string } | null>(
    'fareRange',
  )) {
    it(c.id, () => {
      expect(fareRange(nullToUndefined(c.args.fares))).toEqual(c.expect ?? undefined)
    })
  }
})

describe('eta#formatFareRange', () => {
  for (const c of cases<{ range: { min: string; max: string } }, string>('formatFareRange')) {
    it(c.id, () => {
      expect(formatFareRange(c.args.range)).toBe(c.expect)
    })
  }
})

describe('eta#fareStages', () => {
  for (const c of cases<{ fares: Array<string | null> }, FareStage[]>('fareStages')) {
    it(c.id, () => {
      expect(fareStages(nullToUndefined(c.args.fares))).toEqual(c.expect)
    })
  }
})

describe('eta#estimateChildFare', () => {
  for (const c of cases<{ adultFare: string }, string | null>('estimateChildFare')) {
    it(c.id, () => {
      expect(estimateChildFare(c.args.adultFare)).toBe(c.expect ?? undefined)
    })
  }
})

describe('eta#estimateElderlyFare', () => {
  for (const c of cases<{ adultFare: string }, string | null>('estimateElderlyFare')) {
    it(c.id, () => {
      expect(estimateElderlyFare(c.args.adultFare)).toBe(c.expect ?? undefined)
    })
  }
})

describe('eta#formatStopCount', () => {
  for (const c of cases<{ n: number; locale: Locale }, string>('formatStopCount')) {
    it(c.id, () => {
      expect(formatStopCount(c.args.n, c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#formatJourney', () => {
  for (const c of cases<{ min: number; locale: Locale }, string>('formatJourney')) {
    it(c.id, () => {
      expect(formatJourney(c.args.min, c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#formatHeadway', () => {
  for (const c of cases<{ headway: { min: number; max: number }; locale: Locale }, string>(
    'formatHeadway',
  )) {
    it(c.id, () => {
      expect(formatHeadway(c.args.headway, c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#formatServiceHours', () => {
  for (const c of cases<{ hours: { start: string; end: string } }, string>('formatServiceHours')) {
    it(c.id, () => {
      expect(formatServiceHours(c.args.hours)).toBe(c.expect)
    })
  }
})

describe('eta#classifyRemark', () => {
  for (const c of cases<{ remark: I18nText }, RemarkKind>('classifyRemark')) {
    it(c.id, () => {
      expect(classifyRemark(c.args.remark)).toBe(c.expect)
    })
  }
})

// `formatClock` is the one formatter in eta.ts with no corpus, because it delegates to the platform's
// ICU *and to the host time zone* — a JSON row of expected output would assert a property of the
// machine, not of this code (see its JSDoc). What can be asserted portably is the contract's shape,
// its locale-invariance, and — deliberately — the host-zone dependence, so that fixing the bug shows
// up here as a red test rather than as a silent change in what riders see.
describe('eta#formatClock (untagged: platform ICU, see its JSDoc)', () => {
  const arrival = '2026-07-27T12:05:00+08:00'
  const locales: Locale[] = ['en', 'zh-Hant', 'zh-Hans']

  it('renders a zero-padded 24h HH:mm in every locale', () => {
    for (const locale of locales)
      expect(formatClock(arrival, locale)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
  })

  it('renders the same string in all three locales — the locale must not change the format', () => {
    const [en, hant, hans] = locales.map((l) => formatClock(arrival, l))
    expect(hant).toBe(en)
    expect(hans).toBe(en)
  })

  it('renders midnight as 00:00, never 24:00', () => {
    // `hour12: false` alone permits an h24 cycle in some ICU builds, which would print "24:00" for
    // midnight and read as an invalid time on a departure board.
    expect(formatClock('2026-07-28T00:00:00+08:00', 'en')).toBe(
      new Date('2026-07-28T00:00:00+08:00').toLocaleTimeString('en-HK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    )
    expect(formatClock('2026-07-28T00:00:00+08:00', 'en')).not.toBe('24:00')
  })

  it('KNOWN DEFECT: uses the host time zone, not Asia/Hong_Kong', () => {
    // A Hong Kong bus app must render a Hong Kong arrival in Hong Kong time regardless of where the
    // device thinks it is; there is no `timeZone` option here, so it does not. Asserted against the
    // host zone so the test is deterministic on any machine — and so that adding
    // `timeZone: 'Asia/Hong_Kong'` (the fix) turns this red and forces the decision to be recorded.
    const hostZone = new Intl.DateTimeFormat('en-HK', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(arrival))
    expect(formatClock(arrival, 'en')).toBe(hostZone)
  })
})
