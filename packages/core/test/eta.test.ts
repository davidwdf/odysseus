import { describe, expect, it, vi } from 'vitest'
import corpus from '../spec/eta.spec.json'
import {
  classifyRemark,
  dedupeEtas,
  type EtaLabelParts,
  type EtaReadout,
  type EtaUrgency,
  type EtaView,
  estimateChildFare,
  estimateElderlyFare,
  etaBoardingKey,
  etaLabelParts,
  etaLineKey,
  etaReadout,
  etaUrgency,
  etaView,
  type FareStage,
  type FeedNotice,
  type FeedTrouble,
  fareRange,
  fareStages,
  feedNotice,
  formatClock,
  formatFare,
  formatFareRange,
  formatHeadway,
  formatJourney,
  formatRelative,
  formatServiceHours,
  isStale,
  newestBoard,
  newestNearbyBoard,
  newestPlaceBoard,
  type RemarkView,
  remarkView,
} from '../src/eta'
import type { Eta, I18nText, Locale, NearbyStop, RemarkKind, StopDetail } from '../src/types'
import { at, nullToUndefined, specCases } from './corpus'

// Every `describe` below is one `@spec` group in ../spec/eta.spec.json, driven by the corpus rather
// than by hand-written cases — so a rule change is an edit to the JSON and this file never needs to
// be touched. See ./corpus.ts for why the corpus is data and not TypeScript.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/** The four fields `dedupeEtas` reads; the rest of `Eta` is filled with inert values. `stopId` joined
 *  them in WP5-9 — it is the pole a reading's board was called at, and therefore half its identity —
 *  so it is stated per row rather than defaulted here: a default would have made every row a
 *  single-pole row and the cross-pole cases unwritable. */
interface EtaRow {
  routeId: string
  operator: Eta['operator']
  stopId: string
  arrivals: string[]
}
const toEta = (row: EtaRow): Eta => ({
  ...row,
  dataTimestamp: '2026-07-27T12:00:00+08:00',
  observedAt: '2026-07-27T12:00:00+08:00',
})

describe('eta#etaView', () => {
  // `dueUnderSec` is optional in the corpus: absent means "the shipped default", which is what every
  // row but the last two states. It is served policy now (ADR-053), so it rides in `args`.
  for (const c of cases<{ arrivalIso: string; nowIso: string; dueUnderSec?: number }, EtaView>(
    'etaView',
  )) {
    it(c.name, () => {
      expect(etaView(c.args.arrivalIso, at(c.args.nowIso), c.args.dueUnderSec)).toEqual(c.expect)
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
  for (const c of cases<
    { arrivalIso: string; nowIso: string; locale: Locale; dueUnderSec?: number },
    EtaLabelParts
  >('etaLabelParts')) {
    it(c.name, () => {
      expect(
        etaLabelParts(c.args.arrivalIso, at(c.args.nowIso), c.args.locale, c.args.dueUnderSec),
      ).toEqual(c.expect)
    })
  }
})

describe('eta#etaUrgency', () => {
  for (const c of cases<
    {
      arrivalIso: string | null
      nowIso: string
      policy?: { dueUnderSec: number; warnUnderSec: number }
    },
    EtaUrgency
  >('etaUrgency')) {
    it(c.name, () => {
      // `null` is the corpus's absent value (see ./corpus.ts) — a route listed with no reading at
      // all, which is a different thing from a departed one.
      expect(etaUrgency(c.args.arrivalIso ?? undefined, at(c.args.nowIso), c.args.policy)).toBe(
        c.expect,
      )
    })
  }
})

describe('eta#etaReadout', () => {
  for (const c of cases<
    {
      eta: Eta
      locale: Locale
      nowIso: string
      policy?: { dueUnderSec: number; warnUnderSec: number; staleAfterMs: number }
    },
    EtaReadout
  >('etaReadout')) {
    it(c.name, () => {
      expect(etaReadout(c.args.eta, c.args.locale, at(c.args.nowIso), c.args.policy)).toEqual(
        c.expect,
      )
    })
  }
})

describe('eta#remarkView', () => {
  for (const c of cases<
    { remark: I18nText | null; locale: Locale; servedKind: RemarkKind | null },
    RemarkView | null
  >('remarkView')) {
    it(c.name, () => {
      // Both `null`s are the corpus's absent value (see ./corpus.ts): no remark at all on the way in,
      // and nothing to render on the way out.
      const got = remarkView(
        c.args.remark ?? undefined,
        c.args.locale,
        c.args.servedKind ?? undefined,
      )
      expect(got ?? null).toEqual(c.expect)
    })
  }
})

describe('eta#isStale', () => {
  for (const c of cases<{ dataTimestamp: string; nowIso: string; staleAfterMs?: number }, boolean>(
    'isStale',
  )) {
    it(c.name, () => {
      const eta = toEta({
        routeId: 'KMB:1:outbound:1',
        operator: 'KMB',
        stopId: 'KMB:ST141',
        arrivals: [],
      })
      expect(
        isStale(
          { ...eta, dataTimestamp: c.args.dataTimestamp },
          at(c.args.nowIso),
          c.args.staleAfterMs,
        ),
      ).toBe(c.expect)
    })
  }
})

describe('eta#etaLineKey', () => {
  for (const c of cases<{ operator: Eta['operator']; routeId: string }, string>('etaLineKey')) {
    it(c.name, () => {
      expect(etaLineKey(c.args)).toBe(c.expect)
    })
  }
})

describe('eta#etaBoardingKey', () => {
  for (const c of cases<{ operator: Eta['operator']; routeId: string; stopId: string }, string>(
    'etaBoardingKey',
  )) {
    it(c.name, () => {
      expect(etaBoardingKey(c.args)).toBe(c.expect)
    })
  }
})

describe('eta#dedupeEtas', () => {
  for (const c of cases<{ etas: EtaRow[] }, string[]>('dedupeEtas')) {
    it(c.name, () => {
      expect(dedupeEtas(c.args.etas.map(toEta)).map((e) => e.routeId)).toEqual(c.expect)
    })
  }

  // Not a corpus row: the corpus states which *readings* survive, and this is about the pole they are
  // filed under. A key that dropped the pole would still satisfy every row above whose expectation is
  // a route id — the cross-pole rows would fail, but a *later* regression that re-fused two poles of
  // one line while keeping both route ids (they differ, after all) would not.
  it('files each survivor under the pole its own board was called at', () => {
    const rows = cases<{ etas: EtaRow[] }, string[]>('dedupeEtas').find(
      (c) => c.name === 'one-line-at-two-poles-keeps-a-reading-for-each',
    )
    if (!rows) throw new Error('the named cross-pole row is gone; see REQUIRED_ROWS')
    expect(dedupeEtas(rows.args.etas.map(toEta)).map((e) => e.stopId)).toEqual([
      'KMB:C052B4D46E1F48EA',
      'KMB:BD53690B9DA1C956',
    ])
  })
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

describe('eta#feedNotice', () => {
  for (const c of specCases<
    {
      lastUpdatedIso: string | null
      now: number
      online: boolean
      trouble: FeedTrouble
      staleAfterMs: number
    },
    FeedNotice
  >(corpus, 'feedNotice')) {
    it(c.name, () => {
      expect(feedNotice(c.args)).toEqual(c.expect)
    })
  }
})

describe('eta#newestBoard', () => {
  for (const c of specCases<{ timestamps: (string | null)[] }, string | null>(
    corpus,
    'newestBoard',
  )) {
    it(c.name, () => {
      expect(newestBoard(c.args.timestamps)).toBe(c.expect)
    })
  }
})

// The two payload adapters. Their cases carry whole wire documents rather than a list of strings, and that
// is the point of having them at all: the field a board's clock lives on is a domain decision, so each
// group has a case that fails if anyone reads `observedAt` — the one our own layer stamps, which is fresh
// on every refetch for ever (ADR-150).

describe('eta#newestNearbyBoard', () => {
  for (const c of specCases<{ stops: NearbyStop[] }, string | null>(corpus, 'newestNearbyBoard')) {
    it(c.name, () => {
      expect(newestNearbyBoard(c.args.stops)).toBe(c.expect)
    })
  }
})

describe('eta#newestPlaceBoard', () => {
  for (const c of specCases<{ places: StopDetail[] }, string | null>(corpus, 'newestPlaceBoard')) {
    it(c.name, () => {
      expect(newestPlaceBoard(c.args.places)).toBe(c.expect)
    })
  }
})
