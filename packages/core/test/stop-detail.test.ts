import { describe, expect, it } from 'vitest'
import corpus from '../spec/stop-detail.spec.json'
import {
  boardingPoleId,
  dedupeRoutes,
  operatorsOf,
  orderPoles,
  type PoleDistinction,
  type PoleDistinctionInput,
  type PoleHeading,
  poleDistinctions,
  poleSideOctants,
  type StopDetailPole,
  type StopDetailRoute,
} from '../src/stop-detail'
import type { OperatorId } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/stop-detail.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/** A surviving route row, stated as the two things that matter: the line, and the pole it leaves
 *  from. `dedupeRoutes` chooses both at once, and only one of them is the route. */
const rows = (routes: StopDetailRoute[]) =>
  routes.map((r) => ({ routeId: r.route.id, stopId: r.stopId }))

/** The corpus states distances as an object because a Map is not JSON. */
const distances = (byPole: Record<string, number>) => new Map(Object.entries(byPole))

describe('stop-detail#boardingPoleId', () => {
  type Args = { poleId: string; members: StopDetailPole[] }
  for (const c of cases<Args, string>('boardingPoleId')) {
    it(c.name, () => {
      expect(boardingPoleId(c.args.poleId, c.args.members)).toBe(c.expect)
    })
  }

  it('is idempotent, so asking twice is asking once', () => {
    // A property, not a value, and it is load-bearing because the two callers can meet an answer this
    // function already gave: the Place screen groups its rows by the result *and* passes `members` to
    // `dedupeRoutes`, which asks again. It holds because the answer is always a member id (or an id
    // the place does not name at all), and a member never maps away from itself.
    for (const c of cases<Args, string>('boardingPoleId')) {
      const once = boardingPoleId(c.args.poleId, c.args.members)
      expect(boardingPoleId(once, c.args.members)).toBe(once)
    }
  })

  it('never invents a pole: the answer is a member, or the id it was asked about', () => {
    // The safety property. A folded pole id is one a rider may have saved as a favourite (ADR-062),
    // so the one thing this rule must never do is answer with some *other* pole — that would group a
    // row under a kerb nobody asked for, and collapse two genuinely different rows into one.
    for (const c of cases<Args, string>('boardingPoleId')) {
      const got = boardingPoleId(c.args.poleId, c.args.members)
      const isMember = c.args.members.some((m) => m.id === got)
      expect(isMember || got === c.args.poleId, `${c.name}: invented ${got}`).toBe(true)
    }
  })
})

describe('stop-detail#dedupeRoutes', () => {
  type Args = { routes: StopDetailRoute[]; members?: StopDetailPole[] }
  for (const c of cases<Args, Array<{ routeId: string; stopId: string }>>('dedupeRoutes')) {
    it(c.name, () => {
      // `members` is absent from most rows on purpose — that is the default, and it is the answer for
      // every place with no folded pole. Passing `[]` here instead would leave the default untested.
      expect(rows(dedupeRoutes(c.args.routes, c.args.members))).toEqual(c.expect)
    })
  }

  it('never returns a row whose stopId it was not given', () => {
    // The property behind the second new corpus row, asserted over the whole group rather than in one
    // case. `SaveStar` persists `${row.stopId}|${routeId}`, so a collapse that re-based a surviving
    // row would mint a favourite key that matches no row on the Favourites tab — the orphaning
    // WP5-11 exists to prevent, arriving from the display side.
    for (const c of cases<Args, unknown>('dedupeRoutes')) {
      const given = new Set(c.args.routes.map((r) => r.stopId))
      for (const r of dedupeRoutes(c.args.routes, c.args.members)) {
        expect(given.has(r.stopId), `${c.name}: invented ${r.stopId}`).toBe(true)
      }
    }
  })
})

describe('stop-detail#operatorsOf', () => {
  for (const c of cases<{ routes: StopDetailRoute[] }, OperatorId[]>('operatorsOf')) {
    it(c.name, () => {
      expect(operatorsOf(c.args.routes)).toEqual(c.expect)
    })
  }
})

describe('stop-detail#orderPoles', () => {
  for (const c of cases<
    { poles: StopDetailPole[]; arrivedFrom: string | null; distanceM: Record<string, number> },
    string[]
  >('orderPoles')) {
    it(c.name, () => {
      const got = orderPoles(
        c.args.poles,
        c.args.arrivedFrom ?? undefined,
        distances(c.args.distanceM),
      )
      expect(got.map((p) => p.id)).toEqual(c.expect)
    })
  }

  it('leaves the caller’s array alone', () => {
    // A property, not a value: the screen holds `members` straight off the query cache and renders
    // the map pins from it while the list renders from this. Sorting in place would reorder the
    // pins as a side effect of ordering the list — and only once the fix landed, so it would look
    // like a map bug rather than a mutation.
    const [c] = cases<
      { poles: StopDetailPole[]; arrivedFrom: string | null; distanceM: Record<string, number> },
      string[]
    >('orderPoles').filter((x) => x.args.poles.length > 1)
    if (!c) throw new Error('no multi-pole row in the corpus to test mutation against')
    const before = c.args.poles.map((p) => p.id)
    orderPoles(c.args.poles, undefined, distances(c.args.distanceM))
    expect(c.args.poles.map((p) => p.id)).toEqual(before)
  })
})

describe('stop-detail#poleSideOctants', () => {
  /** The corpus omits every pole that gets nothing, so the Map is compared as a plain object. */
  const sides = (poles: PoleHeading[]) => Object.fromEntries(poleSideOctants(poles))

  for (const c of cases<{ poles: PoleHeading[] }, Record<string, number>>('poleSideOctants')) {
    it(c.name, () => {
      expect(sides(c.args.poles)).toEqual(c.expect)
    })
  }

  it('is order-independent, and leaves the caller’s array alone', () => {
    // Two properties over every row rather than values, so they belong here. Order-independence is
    // load-bearing because the screen hands this `orderPoles`' output — three tiers that move a pole
    // when a location fix lands — and a side that changed as the list reordered would look like a
    // live-data bug. Non-mutation matters for the same reason it does for `orderPoles`: the caller
    // draws its map pins from the very array it passes in.
    for (const c of cases<{ poles: PoleHeading[] }, Record<string, number>>('poleSideOctants')) {
      const before = c.args.poles.map((p) => p.id)
      expect(sides([...c.args.poles].reverse())).toEqual(c.expect)
      expect(c.args.poles.map((p) => p.id)).toEqual(before)
    }
  })

  it('never labels two poles of one place with the same side', () => {
    // The rule's whole purpose stated as an invariant. A row asserts what one place produces; this
    // asserts the thing that must be true of every place, and it is the assertion that fails if a
    // port keeps the separation guard but drops the distinctness one — which is the likelier of the
    // two omissions, because reciprocity makes a pair look like it can never collide.
    for (const c of cases<{ poles: PoleHeading[] }, Record<string, number>>('poleSideOctants')) {
      const labelled = poleSideOctants(c.args.poles)
      const byHeading = new Map<string, number[]>()
      for (const pole of c.args.poles) {
        const octant = labelled.get(pole.id)
        if (octant === undefined) continue
        byHeading.set(pole.heading, [...(byHeading.get(pole.heading) ?? []), octant])
      }
      for (const octants of byHeading.values())
        expect(new Set(octants).size, `${c.name}: two poles share a side`).toBe(octants.length)
    }
  })
})

describe('stop-detail#poleDistinctions', () => {
  type Args = { poles: PoleDistinctionInput[] }
  /** The corpus states the map as ENTRIES, because a pole with nothing to say must be absent from it
   *  and an object cannot express "absent" distinguishably from "present and empty". */
  const entries = (poles: PoleDistinctionInput[]) => [...poleDistinctions(poles).entries()]

  for (const c of cases<Args, Array<[string, PoleDistinction]>>('poleDistinctions')) {
    it(c.name, () => {
      expect(entries(c.args.poles)).toEqual(c.expect)
    })
  }

  it('never returns an answer with nothing in it', () => {
    // The shape rule the record form makes possible to get wrong: `{}` in the map would render as an
    // empty caption line under a heading, which is worse than silence because it looks like a bug.
    for (const c of cases<Args, unknown>('poleDistinctions')) {
      for (const [id, d] of poleDistinctions(c.args.poles)) {
        expect(Object.keys(d).length, `${c.name} / ${id}`).toBeGreaterThan(0)
      }
    }
  })

  it('two poles under one heading share an octant only if both are crowded', () => {
    // **The replacement for `poleSideOctants`' "never labels two poles with the same side".** That
    // invariant must NOT be extended over this group: the unit tier deliberately gives two poles of one
    // unit the same compass word, because the unit is what is being placed. The weaker rule is the
    // correct one, and a reviewer who "fixes" the unit tier out of existence fails here.
    for (const c of cases<Args, unknown>('poleDistinctions')) {
      const got = poleDistinctions(c.args.poles)
      const byHeading = new Map<string, PoleDistinctionInput[]>()
      for (const pole of c.args.poles) {
        const group = byHeading.get(pole.heading) ?? []
        group.push(pole)
        byHeading.set(pole.heading, group)
      }
      for (const group of byHeading.values()) {
        const seen = new Map<number, string>()
        for (const pole of group) {
          const octant = got.get(pole.id)?.octant
          if (octant === undefined) continue
          const twin = seen.get(octant)
          if (twin !== undefined) {
            expect(got.get(pole.id)?.crowded, `${c.name} / ${pole.id}`).toBe(true)
            expect(got.get(twin)?.crowded, `${c.name} / ${twin}`).toBe(true)
          }
          seen.set(octant, pole.id)
        }
      }
    }
  })

  it('agrees with poleSideOctants on every pole that function speaks about', () => {
    // The zero-regression assertion in executable form: the side tier *is* one call to the same private
    // helper, so a pole `poleSideOctants` gives a side must get the identical octant here. Written as a
    // property over every row rather than as one row, because it is the claim the whole tier ordering
    // rests on and a single fixture could satisfy it by luck.
    for (const c of cases<Args, unknown>('poleDistinctions')) {
      const got = poleDistinctions(c.args.poles)
      for (const [id, octant] of poleSideOctants(c.args.poles)) {
        expect(got.get(id)?.octant, `${c.name} / ${id}`).toBe(octant)
      }
    }
  })

  it('is order-independent, and leaves the caller’s array alone', () => {
    // Same two properties `poleSideOctants` carries, and for the same reason: the screen hands this
    // `orderPoles`' output — which moves a pole when a location fix lands — and draws its map pins from
    // the very array it passes in.
    for (const c of cases<Args, unknown>('poleDistinctions')) {
      const before = c.args.poles.map((p) => p.id)
      const forward = poleDistinctions(c.args.poles)
      const reversed = poleDistinctions([...c.args.poles].reverse())
      expect([...reversed.entries()].sort(), c.name).toEqual([...forward.entries()].sort())
      expect(
        c.args.poles.map((p) => p.id),
        c.name,
      ).toEqual(before)
    }
  })
})
