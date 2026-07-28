import { describe, expect, it, vi } from 'vitest'
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
    it(c.name, () => {
      expect(etaView(c.args.arrivalIso, at(c.args.nowIso))).toEqual(c.expect)
    })
  }
})

describe('eta#formatRelative', () => {
  for (const c of cases<{ arrivalIso: string; nowIso: string; locale: Locale }, string>(
    'formatRelative',
  )) {
    it(c.name, () => {
      expect(formatRelative(c.args.arrivalIso, at(c.args.nowIso), c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#etaLabelParts', () => {
  for (const c of cases<{ arrivalIso: string; nowIso: string; locale: Locale }, EtaLabelParts>(
    'etaLabelParts',
  )) {
    it(c.name, () => {
      expect(etaLabelParts(c.args.arrivalIso, at(c.args.nowIso), c.args.locale)).toEqual(c.expect)
    })
  }
})

describe('eta#isStale', () => {
  for (const c of cases<{ dataTimestamp: string; nowIso: string }, boolean>('isStale')) {
    it(c.name, () => {
      const eta = toEta({ routeId: 'KMB:1:outbound:1', operator: 'KMB', arrivals: [] })
      expect(isStale({ ...eta, dataTimestamp: c.args.dataTimestamp }, at(c.args.nowIso))).toBe(
        c.expect,
      )
    })
  }
})

describe('eta#dedupeEtas', () => {
  for (const c of cases<{ etas: EtaRow[] }, string[]>('dedupeEtas')) {
    it(c.name, () => {
      expect(dedupeEtas(c.args.etas.map(toEta)).map((e) => e.routeId)).toEqual(c.expect)
    })
  }
})

describe('eta#formatFare', () => {
  for (const c of cases<{ fare: string }, string>('formatFare')) {
    it(c.name, () => {
      expect(formatFare(c.args.fare)).toBe(c.expect)
    })
  }
})

describe('eta#fareRange', () => {
  for (const c of cases<{ fares: Array<string | null> }, { min: string; max: string } | null>(
    'fareRange',
  )) {
    it(c.name, () => {
      expect(fareRange(nullToUndefined(c.args.fares))).toEqual(c.expect ?? undefined)
    })
  }
})

describe('eta#formatFareRange', () => {
  for (const c of cases<{ range: { min: string; max: string } }, string>('formatFareRange')) {
    it(c.name, () => {
      expect(formatFareRange(c.args.range)).toBe(c.expect)
    })
  }
})

describe('eta#fareStages', () => {
  for (const c of cases<{ fares: Array<string | null> }, FareStage[]>('fareStages')) {
    it(c.name, () => {
      expect(fareStages(nullToUndefined(c.args.fares))).toEqual(c.expect)
    })
  }
})

describe('eta#estimateChildFare', () => {
  for (const c of cases<{ adultFare: string }, string | null>('estimateChildFare')) {
    it(c.name, () => {
      expect(estimateChildFare(c.args.adultFare)).toBe(c.expect ?? undefined)
    })
  }
})

describe('eta#estimateElderlyFare', () => {
  for (const c of cases<{ adultFare: string }, string | null>('estimateElderlyFare')) {
    it(c.name, () => {
      expect(estimateElderlyFare(c.args.adultFare)).toBe(c.expect ?? undefined)
    })
  }
})

describe('eta#formatJourney', () => {
  for (const c of cases<{ min: number; locale: Locale }, string>('formatJourney')) {
    it(c.name, () => {
      expect(formatJourney(c.args.min, c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#formatHeadway', () => {
  for (const c of cases<{ headway: { min: number; max: number }; locale: Locale }, string>(
    'formatHeadway',
  )) {
    it(c.name, () => {
      expect(formatHeadway(c.args.headway, c.args.locale)).toBe(c.expect)
    })
  }
})

describe('eta#formatServiceHours', () => {
  for (const c of cases<{ hours: { start: string; end: string } }, string>('formatServiceHours')) {
    it(c.name, () => {
      expect(formatServiceHours(c.args.hours)).toBe(c.expect)
    })
  }
})

describe('eta#classifyRemark', () => {
  for (const c of cases<{ remark: I18nText }, RemarkKind>('classifyRemark')) {
    it(c.name, () => {
      expect(classifyRemark(c.args.remark)).toBe(c.expect)
    })
  }
})

describe('eta#formatClock', () => {
  for (const c of cases<{ arrivalIso: string }, string>('formatClock')) {
    it(c.name, () => {
      expect(formatClock(c.args.arrivalIso)).toBe(c.expect)
    })
  }

  it('does not depend on the host time zone', () => {
    // The property the corpus rows cannot assert on their own, because a single run only ever has one
    // host zone: a corpus written on a Hong Kong laptop would have passed there and failed on a UTC CI
    // runner. That is exactly what happened before — `formatClock` used `toLocaleTimeString`, which
    // reads the device zone, so a rider in London saw their own local time on a Hong Kong bus board.
    // The arithmetic form consults no zone at all, so moving TZ underneath it must change nothing.
    // (`vi.stubEnv` rather than `process.env` directly: the kernel's tsconfig sets `"types": []`, so
    // Node globals are deliberately not in scope here — WP1-4.)
    const arrival = '2026-07-27T04:05:00Z'
    const seen = new Set<string>()
    try {
      for (const tz of ['Asia/Hong_Kong', 'America/New_York', 'UTC', 'Pacific/Kiritimati']) {
        vi.stubEnv('TZ', tz)
        seen.add(formatClock(arrival))
      }
    } finally {
      vi.unstubAllEnvs()
    }
    expect([...seen]).toEqual(['12:05'])
  })
})
