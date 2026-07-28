import { describe, expect, it } from 'vitest'
import corpus from '../spec/ids.spec.json'
import {
  type FavoriteRouteKeyParts,
  formatFavoriteRouteKey,
  formatPlaceId,
  formatRouteId,
  formatStopId,
  memberStopIds,
  type PlaceIdParts,
  parseFavoriteRouteKey,
  parsePlaceId,
  parseRouteId,
  parseStopId,
  parseStopOrPlaceId,
  type RouteIdParts,
  type StopIdParts,
  type StopOrPlaceIdParts,
} from '../src/ids'
import type { Bound, OperatorId } from '../src/types'
import { specCases } from './corpus'

// The id grammar's corpus-driven suite (WP1-2, ADR-059), moved here from `apps/mobile/test/` and
// converted to the `@spec` harness at integration.
//
// It lived in the app only because `packages/core` had no test runner when WP1-2 landed, and its
// corpus lived in `packages/contract` as "the port-facing artefact". Both reasons dissolved once
// WP1-5 landed: `core` has a runner, and *every* corpus is port-facing — WP1-5's are equally meant
// for Swift and Kotlin, so that argument never distinguished them. Leaving it split had a real
// cost, not just an untidy one: `src/ids.ts` was covered by **neither** gate. It carried no `@spec`
// tag, so the rot check could not see it, and it was missing from the coverage `include` list, so
// the "100% branches on core" figure silently excluded the module that parses persisted rider
// state. Both are now closed.
//
// The ABNF stays at `packages/contract/src/ids/id-grammar.abnf` — that is a grammar specification,
// not test data.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

describe('ids#parseStopId', () => {
  for (const c of cases<{ id: string }, StopIdParts | null>('parseStopId')) {
    it(c.name, () => {
      expect(parseStopId(c.args.id)).toEqual(c.expect)
    })
  }
})

describe('ids#parsePlaceId', () => {
  for (const c of cases<{ id: string }, PlaceIdParts | null>('parsePlaceId')) {
    it(c.name, () => {
      expect(parsePlaceId(c.args.id)).toEqual(c.expect)
    })
  }
})

describe('ids#parseStopOrPlaceId', () => {
  for (const c of cases<{ id: string }, StopOrPlaceIdParts | null>('parseStopOrPlaceId')) {
    it(c.name, () => {
      expect(parseStopOrPlaceId(c.args.id)).toEqual(c.expect)
    })
  }
})

describe('ids#parseRouteId', () => {
  for (const c of cases<{ id: string }, RouteIdParts | null>('parseRouteId')) {
    it(c.name, () => {
      expect(parseRouteId(c.args.id)).toEqual(c.expect)
    })
  }
})

describe('ids#parseFavoriteRouteKey', () => {
  for (const c of cases<{ id: string }, FavoriteRouteKeyParts | null>('parseFavoriteRouteKey')) {
    it(c.name, () => {
      expect(parseFavoriteRouteKey(c.args.id)).toEqual(c.expect)
    })
  }
})

describe('ids#memberStopIds', () => {
  for (const c of cases<{ id: string }, string[]>('memberStopIds')) {
    it(c.name, () => {
      expect(memberStopIds(c.args.id)).toEqual(c.expect)
    })
  }
})

describe('ids#formatStopId', () => {
  for (const c of cases<{ operator: OperatorId; rawId: string }, string>('formatStopId')) {
    it(c.name, () => {
      expect(formatStopId(c.args.operator, c.args.rawId)).toBe(c.expect)
    })
  }
})

describe('ids#formatRouteId', () => {
  for (const c of cases<
    { operator: OperatorId; routeNo: string; bound: Bound; serviceType: string },
    string
  >('formatRouteId')) {
    it(c.name, () => {
      expect(formatRouteId(c.args.operator, c.args.routeNo, c.args.bound, c.args.serviceType)).toBe(
        c.expect,
      )
    })
  }
})

describe('ids#formatPlaceId', () => {
  for (const c of cases<{ memberIds: string[] }, string>('formatPlaceId')) {
    it(c.name, () => {
      expect(formatPlaceId(c.args.memberIds)).toBe(c.expect)
    })
  }
})

describe('ids#formatFavoriteRouteKey', () => {
  for (const c of cases<{ stopId: string; routeId: string }, string>('formatFavoriteRouteKey')) {
    it(c.name, () => {
      expect(formatFavoriteRouteKey(c.args.stopId, c.args.routeId)).toBe(c.expect)
    })
  }
})

// ── Properties over the corpus, not values in it ────────────────────────────────────────────
// These belong in the suite rather than the corpus because they quantify over every row. A port
// that satisfied each row individually could still fail them.

describe('ids: round-trip properties', () => {
  it('every parseable stop id re-formats to itself', () => {
    for (const c of cases<{ id: string }, StopIdParts | null>('parseStopId')) {
      if (!c.expect) continue
      expect(formatStopId(c.expect.operator, c.expect.rawId)).toBe(c.args.id)
    }
  })

  it('every parseable route id re-formats to itself', () => {
    for (const c of cases<{ id: string }, RouteIdParts | null>('parseRouteId')) {
      if (!c.expect) continue
      const { operator, routeNo, bound, serviceType } = c.expect
      expect(formatRouteId(operator, routeNo, bound, serviceType)).toBe(c.args.id)
    }
  })

  it('every parseable place id re-formats to itself', () => {
    for (const c of cases<{ id: string }, PlaceIdParts | null>('parsePlaceId')) {
      if (!c.expect) continue
      // `members` are parsed `StopIdParts`, not raw strings — each carries its verbatim `id`
      // precisely so a caller can pass it straight back without re-formatting.
      expect(formatPlaceId(c.expect.members.map((m) => m.id))).toBe(c.args.id)
    }
  })
})
