import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-detail.spec.json'
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

describe('route-detail#upcoming', () => {
  for (const c of specCases<{ arrivals: string[] | null; nowIso: string }, string[]>(
    corpus,
    'upcoming',
  )) {
    it(c.name, () => {
      expect(upcoming(c.args.arrivals ?? undefined, at(c.args.nowIso))).toEqual(c.expect)
    })
  }

  it('never shows more than the cap, whatever the corpus grows into', () => {
    // A property over every row rather than a value. The cap is the one part of this rule the
    // layout depends on — a fourth time wraps the column — so it is asserted across the whole
    // group instead of trusting that no future row quietly exceeds it.
    for (const c of specCases<{ arrivals: string[] | null; nowIso: string }, string[]>(
      corpus,
      'upcoming',
    )) {
      expect(upcoming(c.args.arrivals ?? undefined, at(c.args.nowIso)).length).toBeLessThanOrEqual(
        3,
      )
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
