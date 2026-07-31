import { describe, expect, it } from 'vitest'
import corpus from '../spec/stop-detail.spec.json'
import {
  dedupeRoutes,
  operatorsOf,
  orderPoles,
  type PoleHeading,
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

describe('stop-detail#dedupeRoutes', () => {
  for (const c of cases<{ routes: StopDetailRoute[] }, Array<{ routeId: string; stopId: string }>>(
    'dedupeRoutes',
  )) {
    it(c.name, () => {
      expect(rows(dedupeRoutes(c.args.routes))).toEqual(c.expect)
    })
  }
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
