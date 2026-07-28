import { describe, expect, it } from 'vitest'
import corpus from '../spec/search.spec.json'
import {
  compareRouteNo,
  indexAlphabet,
  isCompleteRoute,
  nextValidChars,
  normalizeRouteQuery,
  type RouteCategory,
  type RouteFilter,
  type RouteLite,
  routeCategories,
  routeKeys,
  routeMatchesFilter,
  routeSortKey,
  type StopLite,
  searchRoutes,
  searchStops,
  stopMatchesOperators,
} from '../src/search'
import type { Locale, OperatorId } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/search.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

describe('search#routeCategories', () => {
  for (const c of cases<{ routeNo: string }, RouteCategory[]>('routeCategories')) {
    it(c.name, () => {
      expect(routeCategories(c.args.routeNo)).toEqual(c.expect)
    })
  }
})

describe('search#routeMatchesFilter', () => {
  for (const c of cases<{ route: RouteLite; filter: RouteFilter }, boolean>('routeMatchesFilter')) {
    it(c.name, () => {
      expect(routeMatchesFilter(c.args.route, c.args.filter)).toBe(c.expect)
    })
  }
})

describe('search#stopMatchesOperators', () => {
  for (const c of cases<{ stopId: string; operators: OperatorId[] }, boolean>(
    'stopMatchesOperators',
  )) {
    it(c.name, () => {
      expect(stopMatchesOperators(c.args.stopId, c.args.operators)).toBe(c.expect)
    })
  }
})

describe('search#routeKeys', () => {
  for (const c of cases<{ routeNos: string[] }, string[]>('routeKeys')) {
    it(c.name, () => {
      expect(routeKeys(c.args.routeNos)).toEqual(c.expect)
    })
  }
})

describe('search#nextValidChars', () => {
  for (const c of cases<{ routeNos: string[]; prefix: string }, string[]>('nextValidChars')) {
    it(c.name, () => {
      const got = [...nextValidChars(routeKeys(c.args.routeNos), c.args.prefix)].sort()
      expect(got).toEqual(c.expect)
    })
  }
})

describe('search#isCompleteRoute', () => {
  for (const c of cases<{ routeNos: string[]; prefix: string }, boolean>('isCompleteRoute')) {
    it(c.name, () => {
      expect(isCompleteRoute(routeKeys(c.args.routeNos), c.args.prefix)).toBe(c.expect)
    })
  }
})

describe('search#routeSortKey', () => {
  for (const c of cases<{ routeNo: string }, string>('routeSortKey')) {
    it(c.name, () => {
      expect(routeSortKey(c.args.routeNo)).toBe(c.expect)
    })
  }
})

describe('search#indexAlphabet', () => {
  for (const c of cases<{ routeNos: string[] }, { digits: string[]; letters: string[] }>(
    'indexAlphabet',
  )) {
    it(c.name, () => {
      expect(indexAlphabet(c.args.routeNos)).toEqual(c.expect)
    })
  }
})

describe('search#compareRouteNo', () => {
  for (const c of cases<{ a: string; b: string }, number>('compareRouteNo')) {
    it(c.name, () => {
      // The corpus states the SIGN only — collator magnitudes are platform-specific.
      expect(Math.sign(compareRouteNo(c.args.a, c.args.b))).toBe(c.expect)
    })
  }
})

describe('search#normalizeRouteQuery', () => {
  for (const c of cases<{ q: string }, string>('normalizeRouteQuery')) {
    it(c.name, () => {
      expect(normalizeRouteQuery(c.args.q)).toBe(c.expect)
    })
  }
})

describe('search#searchRoutes', () => {
  for (const c of cases<
    { routes: RouteLite[]; query: string; filter: RouteFilter; limit: number },
    string[]
  >('searchRoutes')) {
    it(c.name, () => {
      const got = searchRoutes(c.args.routes, c.args.query, c.args.filter, c.args.limit)
      expect(got.map((r) => r.id)).toEqual(c.expect)
    })
  }

  it('defaults to no filter and a limit of 60 when they are omitted', () => {
    // The two default parameters are branches the corpus cannot express, because a JSON row has no
    // way to say "argument absent" distinctly from "argument null" for an optional positional.
    const routes: RouteLite[] = Array.from({ length: 70 }, (_, i) => ({
      id: `KMB:1${i}:outbound:1`,
      operator: 'KMB',
      routeNo: `1${i}`,
      bound: 'outbound',
      origin: { en: 'A', 'zh-Hant': '甲', 'zh-Hans': '甲' },
      destination: { en: 'B', 'zh-Hant': '乙', 'zh-Hans': '乙' },
    }))
    expect(searchRoutes(routes, '1')).toHaveLength(60)
  })
})

describe('search#searchStops', () => {
  for (const c of cases<
    { stops: StopLite[]; query: string; locale: Locale; operators: OperatorId[]; limit: number },
    string[]
  >('searchStops')) {
    it(c.name, () => {
      const got = searchStops(
        c.args.stops,
        c.args.query,
        c.args.locale,
        c.args.operators,
        c.args.limit,
      )
      expect(got.map((s) => s.id)).toEqual(c.expect)
    })
  }

  it('defaults to no operator filter and a limit of 60 when they are omitted', () => {
    const stops: StopLite[] = Array.from({ length: 70 }, (_, i) => ({
      id: `KMB:ST${i}`,
      name: { en: `CITY STOP ${i}`, 'zh-Hant': '城市站', 'zh-Hans': '城市站' },
      lat: 22.3,
      lng: 114.17,
    }))
    expect(searchStops(stops, 'city', 'en')).toHaveLength(60)
  })
})
