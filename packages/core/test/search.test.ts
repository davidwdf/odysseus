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
  type SearchIndex,
  type SearchView,
  type StopLite,
  searchRoutes,
  searchStops,
  searchView,
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

describe('search#searchView', () => {
  interface Args {
    index: SearchIndex
    mode: 'routes' | 'stops'
    query: string
    filter: RouteFilter
    recentRouteIds: string[]
    recentStopIds: string[]
    locale: Locale
  }
  const LABELS = {
    operator: (o: string) => ({ KMB: 'KMB', LWB: 'LWB', CTB: 'Citybus', GMB: 'Minibus' })[o] ?? o,
    category: (c: RouteCategory) =>
      ({ night: 'Night', airport: 'Airport', express: 'Express' })[c] ?? c,
  }
  const run = (a: Args) =>
    searchView(
      {
        index: a.index,
        mode: a.mode,
        query: a.query,
        filter: a.filter,
        recentRouteIds: a.recentRouteIds,
        recentStopIds: a.recentStopIds,
      },
      { locale: a.locale, labels: LABELS as never },
    )

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, SearchView>('searchView')
    // The anti-vacuous control: a group that resolved to nothing would make the loop assert nothing.
    expect(rows.length).toBeGreaterThanOrEqual(10)
    for (const c of rows) expect(run(c.args), c.name).toEqual(c.expect)
  })

  it('offers a chip for every operator in the index, and none for any other', () => {
    // ADR-037's promise as a property: a fifth operator lights up the day its adapter lands, and — the half
    // that matters more — a chip is never offered for an operator the index cannot produce a result for.
    for (const c of cases<Args, SearchView>('searchView')) {
      const got = run(c.args)
      const inIndex = new Set(c.args.index.routes.map((r) => r.operator))
      const offered = got.chips
        .filter((chip) => chip.key.startsWith('operator:'))
        .map((chip) => chip.key.slice('operator:'.length))
      expect([...offered].sort(), c.name).toEqual([...inIndex].sort())
    }
  })

  it('keeps the keypad and the list agreeing about what is findable', () => {
    // **The invariant that makes a dimmed key honest.** A rider presses a live key expecting a result; if
    // the keypad were computed over a wider set than the search, some keys would lead nowhere, and if it
    // were narrower, a reachable route would be unreachable. Asserted as containment in the direction that
    // can actually go wrong: every first character the keypad offers must begin some findable number.
    let checked = 0
    for (const c of cases<Args, SearchView>('searchView')) {
      const got = run(c.args)
      const findable = c.args.index.routes
        .filter((r) => routeMatchesFilter(r, c.args.filter))
        .map((r) => r.routeNo)
      for (const key of got.keypad.keys) {
        expect(findable, `${c.name}: keypad offers ${key}, which nothing matches`).toContain(key)
        checked += 1
      }
      for (const letter of got.keypad.letters) {
        expect(
          findable.some((no) => no.includes(letter)),
          `${c.name}: letter row offers ${letter}, which no findable number carries`,
        ).toBe(true)
      }
    }
    expect(checked, 'no corpus case produced a keypad at all').toBeGreaterThan(0)
  })

  it('never lists a recent the index cannot open', () => {
    // A saved id is a *reference*: the dataset is rebuilt daily, a route can leave it and clustering can
    // mint a new `P:` id for a place (ADR-042). So a history row must always name something openable —
    // rendering the id and hoping is the failure, and it is invisible until a rider taps it.
    for (const c of cases<Args, SearchView>('searchView')) {
      const got = run(c.args)
      if (got.source !== 'recents') continue
      const ids =
        got.list.kind === 'routes'
          ? got.list.routes.map((r) => r.id)
          : got.list.stops.map((s) => s.id)
      const known = new Set(
        got.list.kind === 'routes'
          ? c.args.index.routes.map((r) => r.id)
          : c.args.index.stops.map((s) => s.id),
      )
      for (const id of ids) expect(known.has(id), `${c.name}: listed ${id}`).toBe(true)
    }
  })

  it('tells "nothing matched" apart from "nothing searched"', () => {
    // Two empty lists, two different sentences. Collapsing them tells a rider who mistyped that they have
    // no history, which is the shape of every state bug this wave has found: a screen with less to show
    // than expected saying nothing about which less it is.
    const rows = cases<Args, SearchView>('searchView')
    const none = rows.filter((c) => run(c.args).source === 'none')
    const recents = rows.filter((c) => run(c.args).source === 'recents')
    expect(none.length, 'no corpus case reaches the no-results state').toBeGreaterThan(0)
    expect(recents.length, 'no corpus case reaches the recents state').toBeGreaterThan(0)
    for (const c of none) expect(c.args.query, `${c.name}: no-results without a query`).not.toBe('')
    for (const c of recents) expect(run(c.args).source).toBe('recents')
  })

  it('offers a category chip only where a category can narrow anything', () => {
    // A stop has no route number, so a category cannot filter it. A dimmed-but-present night-bus chip over
    // a stop list would offer a rider a filter that does nothing, which is worse than not offering it.
    for (const c of cases<Args, SearchView>('searchView')) {
      const got = run(c.args)
      const categories = got.chips.filter((chip) => chip.key.startsWith('category:'))
      expect(categories.length > 0, c.name).toBe(c.args.mode === 'routes')
    }
  })
})
