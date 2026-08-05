import { describe, expect, it } from 'vitest'
import corpus from '../spec/stop-detail.spec.json'
// The two rules the pin-label property below re-derives, so that "the dot and the heading agree" is
// asserted against the *rules* rather than against a second copy of the expected strings.
import { parseStopId } from '../src/ids'
import {
  boardingPoleId,
  dedupeRoutes,
  type MapPin,
  mergeCoincidentPins,
  operatorsOf,
  orderPoles,
  type PlaceDetailView,
  type PoleDistinction,
  type PoleDistinctionInput,
  type PoleHeading,
  placeDetailView,
  poleDistinctions,
  poleSideOctants,
  type StopDetailPole,
  type StopDetailRoute,
} from '../src/stop-detail'
import { poleFlagCode } from '../src/stop-name'
import type { LatLng, Locale, OperatorId, ResolvedClientPolicy, StopDetail } from '../src/types'
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

describe('placeDetailView', () => {
  // The composition layer (WP6-3). Every case's `expect` is the whole view, so a change to any of the six
  // decisions it makes — the heading, the walk, the summary, the grouping, which poles are shown, the
  // readout fallback — is a corpus diff rather than something a renderer absorbs quietly.
  //
  // The `labels` a case is driven with are a *fixture*, not the app's catalogue: the corpus is
  // language-neutral data, and a Swift suite reading these bytes will supply its own. What the corpus pins
  // is the composition — where the separators go, what order the parts come in, and what is omitted.
  const LABELS = {
    operator: (o: string) => ({ KMB: 'KMB', LWB: 'LWB', CTB: 'Citybus', GMB: 'Minibus' })[o] ?? o,
    servedBy: 'Served by',
    routeCount: (n: number) => `${n} routes`,
    side: (octant: number) =>
      `${['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'][octant]} side`,
  }

  interface Args {
    detail: StopDetail
    locale: Locale
    now: string
    here?: { lat: number; lng: number }
    arrivedFromPole?: string
    policy?: ResolvedClientPolicy
  }

  /** Every optional argument a case may carry, forwarded — a case whose `policy` the driver dropped would
   *  record one expectation and assert another, and would pass wherever the band happened not to matter. */
  const optionsFor = (a: Args) => ({
    locale: a.locale,
    now: Date.parse(a.now),
    labels: LABELS,
    ...(a.here === undefined ? {} : { here: a.here }),
    ...(a.arrivedFromPole === undefined ? {} : { arrivedFromPole: a.arrivedFromPole }),
    ...(a.policy === undefined ? {} : { policy: a.policy }),
  })

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, PlaceDetailView>('placeDetailView')
    // The anti-vacuous control: a group that resolved to nothing would make the loop assert nothing.
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const c of rows) {
      const got = placeDetailView(c.args.detail, optionsFor(c.args))
      expect(got, c.name).toEqual(c.expect)
    }
  })

  it('never shows a boarding point with no rows left', () => {
    // A property over every case rather than one row, because it is what makes the compass side honest: a
    // side printed to tell a heading apart from one that is not on screen is noise, and `poleDistinctions`
    // is asked about exactly the set that ends up here.
    for (const c of cases<Args, PlaceDetailView>('placeDetailView')) {
      const got = placeDetailView(c.args.detail, optionsFor(c.args))
      for (const group of got.groups)
        expect(group.rows.length, `${c.name} / ${group.poleId}`).toBeGreaterThan(0)
    }
  })

  it('puts every row in exactly one place — grouped or flat, never both', () => {
    // The trap a renderer falls into: reading `groups` alone (and drawing nothing for most of Hong Kong,
    // which is single-pole) or reading both and drawing every row twice.
    //
    // The **at-least-one-row check belongs to the suite, not to a case** — which the first draft of this
    // test got wrong, asserting per case that something was there and then going red on the corpus row for
    // a place with no routes at all. A place with nothing due is a real state; what would be vacuous is a
    // corpus where *no* case had rows in either shape.
    let groupedRows = 0
    let flatRows = 0
    for (const c of cases<Args, PlaceDetailView>('placeDetailView')) {
      const got = placeDetailView(c.args.detail, optionsFor(c.args))
      const inGroups = got.groups.flatMap((g) => g.rows).length
      expect(got.grouped ? got.rows.length : inGroups, c.name).toBe(0)
      groupedRows += inGroups
      flatRows += got.rows.length
    }
    expect(groupedRows, 'no corpus case put rows under a kerb').toBeGreaterThan(0)
    expect(flatRows, 'no corpus case put rows in a flat list').toBeGreaterThan(0)
  })

  it('gives every member pole exactly one pin, and never an empty map', () => {
    // The map's half of "every row in exactly one place", and it is the property a folding rule most needs:
    // a pole silently dropped here vanishes from the map while keeping its group in the list, and the
    // scroll-spy then has a group whose dot cannot light up. `mergeCoincidentPins` carries the same
    // assertion over its own group; this one is about the *set of points this view hands it*, which is
    // where a member could go missing before the fold ever sees it.
    for (const c of cases<Args, PlaceDetailView>('placeDetailView')) {
      const got = placeDetailView(c.args.detail, optionsFor(c.args))
      const members = c.args.detail.members ?? []
      const pinned = got.pins.flatMap((pin) => pin.ids)
      expect(
        got.pins.length,
        `${c.name}: a place with no pin is a map with nothing on it`,
      ).toBeGreaterThan(0)
      if (members.length > 1) {
        expect([...pinned].sort(), c.name).toEqual(members.map((m) => m.id).sort())
      } else {
        // A lone stop is one pin at the place's own coordinate — the place id, not a member id, because
        // the wire may give a single-member place a merged `P:` id and the pin belongs to the place.
        expect(pinned, c.name).toEqual([c.args.detail.stop.id])
      }
    }
  })

  it('labels a pin with the printed code its heading uses — or, where there is none, with the raw id the heading omits', () => {
    // The reason the label belongs to the kernel and not to the map, stated as the property rather than as
    // an intention. `poleFlagCode` borrows a flag-shaped code from *another locale* when this one has none
    // (ADR-080), so a renderer composing a dot's label itself gets a **plausible** answer that disagrees
    // with the heading above it — at Prince Edward the heading would read `KMB · MK356` while the dot read
    // the raw id, and nothing would fail.
    //
    // Writing it down found the one place where the dot and the heading **already** disagree, and it is
    // pinned here rather than smoothed over: where the operator published no code at all, the dot falls
    // back to the raw pole id and the heading has nothing to fall back to, so at Tin Shui Wai Park the
    // Citybus dot reads `001992` while its heading reads `Citybus`. A hoist changes no behaviour (WP4-0's
    // rule), so the asymmetry is asserted in both directions and carried in `docs/07` with an owner.
    let withCode = 0
    let withoutCode = 0
    let unreadable = 0
    for (const c of cases<Args, PlaceDetailView>('placeDetailView')) {
      const got = placeDetailView(c.args.detail, optionsFor(c.args))
      if (!got.grouped) continue
      const members = c.args.detail.members ?? []
      for (const group of got.groups) {
        const pin = got.pins.find((p) => p.ids.includes(group.poleId))
        expect(pin, `${c.name}: ${group.poleId} has a group and no pin`).toBeDefined()
        const parts = pin?.label === undefined ? [] : pin.label.split(' · ')
        const member = members.find((m) => m.id === group.poleId)
        if (!member) throw new Error(`${c.name}: group ${group.poleId} is not a member`)
        const code = poleFlagCode(member.name, c.args.locale)
        const rawId = parseStopId(group.poleId)?.rawId
        if (code === undefined && rawId === undefined) {
          // An id neither rule can read: the dot carries **no label at all** and the heading names nothing
          // either — this is the `" · Southwest side"` defect ADR-085 pinned, seen from the map. Unreachable
          // by any id a real build produces; asserted so that "nothing at all" stays the answer rather than
          // becoming an `undefined` printed on a dot.
          expect(parts, `${c.name} / ${group.poleId}`).toEqual([])
          unreadable += 1
          continue
        }
        if (code === undefined) {
          // No printed code: the dot says the raw id, the heading says only the operator. **They disagree**,
          // and that is the finding this property exists to have made visible.
          expect(parts, `${c.name} / ${group.poleId}`).toContain(rawId)
          expect(group.heading, `${c.name} / ${group.poleId}`).not.toContain(rawId)
          withoutCode += 1
          continue
        }
        expect(parts, `${c.name} / ${group.poleId}`).toContain(code)
        expect(group.heading, `${c.name} / ${group.poleId}`).toContain(code)
        withCode += 1
      }
    }
    // Three anti-vacuous controls, one per branch, because a single total would let two of the three never
    // run — which is exactly how the disagreement in the middle branch would have stayed invisible.
    expect(withCode, 'no corpus case had a pole with a printed code').toBeGreaterThan(0)
    expect(withoutCode, 'no corpus case had a pole without one').toBeGreaterThan(0)
    expect(unreadable, 'no corpus case had a pole id neither rule can read').toBeGreaterThan(0)
  })

  it('says nothing about distance without a fix', () => {
    // ADR-008 applied to the rider's position: a distance we cannot measure is not one to estimate. The
    // summary keeps its direction, its operators and its count; no group carries a walk.
    const c = cases<Args, PlaceDetailView>('placeDetailView').find((x) => x.args.here === undefined)
    if (!c) throw new Error('no corpus case is unlocated — the fixture set moved')
    const got = placeDetailView(c.args.detail, optionsFor(c.args))
    expect(got.summary).not.toMatch(/walk/)
    for (const group of got.groups) expect(group.walk, group.poleId).toBeUndefined()
  })
})

describe('mergeCoincidentPins', () => {
  interface Args {
    points: Array<{ id: string; location: LatLng; operator?: OperatorId; label?: string }>
  }

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, MapPin[]>('mergeCoincidentPins')
    expect(rows.length).toBeGreaterThanOrEqual(6)
    for (const c of rows) {
      expect(mergeCoincidentPins(c.args.points), c.name).toEqual(c.expect)
    }
  })

  it('keeps every pole, exactly once', () => {
    // The property that matters most: folding is about where a dot is drawn, never about which poles the
    // map knows. A pole silently dropped here would vanish from the map while keeping its group in the
    // list — and the scroll-spy would then have a group whose dot cannot be highlighted.
    for (const c of cases<Args, MapPin[]>('mergeCoincidentPins')) {
      const folded = mergeCoincidentPins(c.args.points).flatMap((pin) => pin.ids)
      expect(folded.sort(), c.name).toEqual(c.args.points.map((p) => p.id).sort())
    }
  })

  it('leaves the caller’s array alone', () => {
    // The screen hands this the very array it draws its own list from, and `MiniMap` re-derives on every
    // render — the same two reasons `poleSideOctants` and `poleDistinctions` carry this assertion.
    const points = [
      { id: 'A', location: { lat: 22.3, lng: 114.1 }, label: 'X' },
      { id: 'B', location: { lat: 22.3, lng: 114.1 }, label: 'Y' },
    ]
    const before = JSON.stringify(points)
    mergeCoincidentPins(points)
    expect(JSON.stringify(points)).toBe(before)
  })
})
