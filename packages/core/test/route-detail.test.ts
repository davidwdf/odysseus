import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-detail.spec.json'
import { CLIENT_POLICY_DEFAULTS } from '../src/policy'
import {
  isOriginStop,
  type RouteEnds,
  type RouteHeaderNames,
  routeTerminusNames,
  upcoming,
  visibleBusMarkers,
} from '../src/route-detail'
import type { BusMarker } from '../src/route-position'
import type { I18nText, Locale } from '../src/types'
import { at, specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/route-detail.spec.json. JSON `null` becomes the
// language's absent value at the boundary (see test/corpus.ts) — here that is an absent `?stop=`
// parameter, an absent ETA block and an absent route payload, all three of which are ordinary
// states of the route screen rather than errors.

describe('route-detail#isOriginStop', () => {
  for (const c of specCases<{ routeStopId: string; origin: string | null }, boolean>(
    corpus,
    'isOriginStop',
  )) {
    it(c.name, () => {
      expect(isOriginStop(c.args.routeStopId, c.args.origin ?? undefined)).toBe(c.expect)
    })
  }
})

/** The rows of `upcoming`, whose cap is now a served policy value and so an optional argument. */
type UpcomingArgs = { arrivals: string[] | null; nowIso: string; maxArrivals?: number }

describe('route-detail#upcoming', () => {
  for (const c of specCases<UpcomingArgs, string[]>(corpus, 'upcoming')) {
    it(c.name, () => {
      expect(upcoming(c.args.arrivals ?? undefined, at(c.args.nowIso), c.args.maxArrivals)).toEqual(
        c.expect,
      )
    })
  }

  it('never shows more than the cap in force, whatever the corpus grows into', () => {
    // A property over every row rather than a value. The cap is the one part of this rule the
    // layout depends on — a fourth time wraps the column — so it is asserted across the whole
    // group instead of trusting that no future row quietly exceeds it.
    //
    // The bound is now each row's *own* cap rather than a literal 3, because the number is served
    // policy (ADR-053). That is a weaker-looking assertion that is actually the stronger one: pinned
    // at 3 it would have started failing the moment a row exercised an override, and the obvious fix
    // — deleting the property — is how a cap regression gets in.
    for (const c of specCases<UpcomingArgs, string[]>(corpus, 'upcoming')) {
      const cap = c.args.maxArrivals ?? CLIENT_POLICY_DEFAULTS.maxArrivals
      expect(
        upcoming(c.args.arrivals ?? undefined, at(c.args.nowIso), c.args.maxArrivals).length,
      ).toBeLessThanOrEqual(cap)
    }
  })
})

describe('route-detail#visibleBusMarkers', () => {
  for (const c of specCases<
    { markers: BusMarker[]; soonest: Array<string | null>; nowIso: string },
    BusMarker[]
  >(corpus, 'visibleBusMarkers')) {
    it(c.name, () => {
      expect(visibleBusMarkers(c.args.markers, c.args.soonest, at(c.args.nowIso))).toEqual(c.expect)
    })
  }

  it('only ever removes markers, never edits or reorders one', () => {
    // The suppression decides *whether* a bus is drawn. If it ever started deciding *where*, the
    // rail would have two places computing a position and they would disagree the moment one
    // changed — so the property is asserted directly rather than inferred from the rows.
    for (const c of specCases<
      { markers: BusMarker[]; soonest: Array<string | null>; nowIso: string },
      BusMarker[]
    >(corpus, 'visibleBusMarkers')) {
      const kept = visibleBusMarkers(c.args.markers, c.args.soonest, at(c.args.nowIso))
      expect(c.args.markers.filter((m) => kept.includes(m))).toEqual(kept)
    }
  })
})

describe('route-detail#routeTerminusNames', () => {
  for (const c of specCases<
    { stopNames: I18nText[]; route: RouteEnds | null; locale: Locale },
    RouteHeaderNames
  >(corpus, 'routeTerminusNames')) {
    it(c.name, () => {
      expect(
        routeTerminusNames(c.args.stopNames, c.args.route ?? undefined, c.args.locale),
      ).toEqual(c.expect)
    })
  }
})
