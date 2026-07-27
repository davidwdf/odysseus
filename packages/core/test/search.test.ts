import { describe, expect, it } from 'vitest'
import corpus from '../spec/search.spec.json'
import {
  buildRouteTrie,
  compareRouteNo,
  indexAlphabet,
  isCompleteRoute,
  nextValidChars,
  normalizeRouteQuery,
  type RouteCategory,
  type RouteFilter,
  type RouteLite,
  type RouteTrieNode,
  routeCategories,
  routeMatchesFilter,
  type StopLite,
  searchRoutes,
  searchStops,
  stopMatchesOperators,
} from '../src/search'
import type { Locale, OperatorId } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/search.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/** The corpus expresses a trie as nested JSON, because a Map is not JSON. */
interface TrieShape {
  terminal: boolean
  children: Record<string, TrieShape>
}
const toShape = (node: RouteTrieNode): TrieShape => ({
  terminal: node.terminal,
  children: Object.fromEntries([...node.children].map(([ch, child]) => [ch, toShape(child)])),
})

describe('search#routeCategories', () => {
  for (const c of cases<{ routeNo: string }, RouteCategory[]>('routeCategories')) {
    it(c.id, () => {
      expect(routeCategories(c.args.routeNo)).toEqual(c.expect)
    })
  }
})

describe('search#routeMatchesFilter', () => {
  for (const c of cases<{ route: RouteLite; filter: RouteFilter }, boolean>('routeMatchesFilter')) {
    it(c.id, () => {
      expect(routeMatchesFilter(c.args.route, c.args.filter)).toBe(c.expect)
    })
  }
})

describe('search#stopMatchesOperators', () => {
  for (const c of cases<{ stopId: string; operators: OperatorId[] }, boolean>(
    'stopMatchesOperators',
  )) {
    it(c.id, () => {
      expect(stopMatchesOperators(c.args.stopId, c.args.operators)).toBe(c.expect)
    })
  }
})

describe('search#buildRouteTrie', () => {
  for (const c of cases<{ routeNos: string[] }, TrieShape>('buildRouteTrie')) {
    it(c.id, () => {
      expect(toShape(buildRouteTrie(c.args.routeNos))).toEqual(c.expect)
    })
  }
})

describe('search#nextValidChars', () => {
  for (const c of cases<{ routeNos: string[]; prefix: string }, string[]>('nextValidChars')) {
    it(c.id, () => {
      const got = [...nextValidChars(buildRouteTrie(c.args.routeNos), c.args.prefix)].sort()
      expect(got).toEqual(c.expect)
    })
  }
})

describe('search#isCompleteRoute', () => {
  for (const c of cases<{ routeNos: string[]; prefix: string }, boolean>('isCompleteRoute')) {
    it(c.id, () => {
      expect(isCompleteRoute(buildRouteTrie(c.args.routeNos), c.args.prefix)).toBe(c.expect)
    })
  }
})

describe('search#indexAlphabet', () => {
  for (const c of cases<{ routeNos: string[] }, { digits: string[]; letters: string[] }>(
    'indexAlphabet',
  )) {
    it(c.id, () => {
      expect(indexAlphabet(c.args.routeNos)).toEqual(c.expect)
    })
  }
})

describe('search#compareRouteNo', () => {
  for (const c of cases<{ a: string; b: string }, number>('compareRouteNo')) {
    it(c.id, () => {
      // The corpus states the SIGN only — collator magnitudes are platform-specific.
      expect(Math.sign(compareRouteNo(c.args.a, c.args.b))).toBe(c.expect)
    })
  }
})

describe('search#normalizeRouteQuery', () => {
  for (const c of cases<{ q: string }, string>('normalizeRouteQuery')) {
    it(c.id, () => {
      expect(normalizeRouteQuery(c.args.q)).toBe(c.expect)
    })
  }
})

describe('search#searchRoutes', () => {
  for (const c of cases<
    { routes: RouteLite[]; query: string; filter: RouteFilter; limit: number },
    string[]
  >('searchRoutes')) {
    it(c.id, () => {
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
    it(c.id, () => {
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
