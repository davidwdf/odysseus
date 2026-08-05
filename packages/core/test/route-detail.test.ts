import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-detail.spec.json'
import { formatFavoriteRouteKey } from '../src/ids'
import { CLIENT_POLICY_DEFAULTS } from '../src/policy'
import {
  isOriginStop,
  type RouteDetailView,
  type RouteEnds,
  type RouteHeaderNames,
  routeDetailView,
  routeTerminusNames,
  upcoming,
  visibleBusMarkers,
} from '../src/route-detail'
import type { BusMarker } from '../src/route-position'
import type {
  I18nText,
  Locale,
  ResolvedClientPolicy,
  RouteDetail as RouteDetailPayload,
} from '../src/types'
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

describe('route-detail#routeDetailView', () => {
  // The composition layer (WP6-6a). Every case's `expect` is the whole view, so a change to any of the
  // sixteen decisions it makes — the two header labels, which fact is a note rather than a pill, which
  // node a bus is on, which row is starred — is a corpus diff rather than something a renderer absorbs
  // quietly.
  //
  // The `labels` a case is driven with are a **fixture**, not the app's catalogue: the corpus is
  // language-neutral data and a Swift suite reading these bytes supplies its own. What is pinned is the
  // *composition* — where the arrow goes, what order the parts come in, what is omitted.
  const LABELS = {
    stopCount: (n: number) => `${n} stops`,
    holiday: 'hol',
    circularVia: (place: string) => `Circular via ${place}`,
    busApproaching: (stop: string) => `Bus approaching ${stop}`,
    busAtStop: (stop: string) => `Bus at ${stop}`,
  }

  interface Args {
    detail: RouteDetailPayload
    locale: Locale
    now: string
    arrivedFromStop?: string
    flipped?: boolean
    savedRouteKeys?: string[]
    policy?: ResolvedClientPolicy
  }

  /** Every optional argument a case may carry, forwarded. A case whose `policy` the driver dropped would
   *  record one expectation and assert another, and would pass wherever the band happened not to matter —
   *  which is the corpus bug WP6-3a found in `placeDetailView`'s own served-policy row. */
  const optionsFor = (a: Args) => ({
    locale: a.locale,
    now: at(a.now),
    labels: LABELS,
    ...(a.arrivedFromStop === undefined ? {} : { arrivedFromStop: a.arrivedFromStop }),
    ...(a.flipped === undefined ? {} : { flipped: a.flipped }),
    ...(a.savedRouteKeys === undefined ? {} : { savedRouteKeys: a.savedRouteKeys }),
    ...(a.policy === undefined ? {} : { policy: a.policy }),
  })

  const rows = () => specCases<Args, RouteDetailView>(corpus, 'routeDetailView')
  const viewFor = (c: { args: Args }) => routeDetailView(c.args.detail, optionsFor(c.args))

  /**
   * How close two languages have to agree about the route's length.
   *
   * `distanceM` is a sum of haversines, and the geo corpus already states the rule for that class of
   * value: *"trigonometry does not agree to the last bit across languages, so the corpus states a
   * tolerance per row and every platform compares this way."* A composed view is the first place in this
   * repo where such a value sits **inside** an object compared for exact equality, so it is lifted out and
   * compared separately rather than quietly rounded — rounding it here would be a second, invisible
   * display rule competing with `formatDistance`, which rounds to the nearest 10 m under ADR-008.
   *
   * One metre, which is three orders of magnitude tighter than anything a rider is shown and still far
   * looser than a double's last bit.
   */
  const DISTANCE_TOLERANCE_M = 1

  it('matches the corpus, case for case', () => {
    const cases = rows()
    // The anti-vacuous control: a group that resolved to nothing would make the loop assert nothing.
    expect(cases.length).toBeGreaterThanOrEqual(15)
    for (const c of cases) {
      const { distanceM, ...got } = viewFor(c)
      const { distanceM: wanted, ...expected } = c.expect
      expect(got, c.name).toEqual(expected)
      expect(distanceM, c.name).toBeCloseTo(wanted, -Math.log10(DISTANCE_TOLERANCE_M))
    }
  })

  it('agrees with itself about which row the rider boarded at', () => {
    // The anchor is two fields — an index the reveal scrolls to and a flag the row is emphasised by — and
    // they are the same fact. A port that computed one from the payload and the other from the index would
    // scroll to one row and highlight another, which looks like a scroll bug and is not one.
    for (const c of rows()) {
      const view = viewFor(c)
      const flagged = view.stops.filter((s) => s.here).length
      expect(flagged, `${c.name}: ${flagged} rows flagged`).toBe(view.hereIndex >= 0 ? 1 : 0)
      if (view.hereIndex >= 0) expect(view.stops[view.hereIndex]?.here, c.name).toBe(true)
    }
  })

  it('never places a bus on a stop the route does not have, or on a segment into the origin', () => {
    // The safety property behind `RailBus`, and the reason the position is an index rather than a y: a
    // renderer reading `from`/`to` looks the two nodes up in its own measured table, so an out-of-range
    // index is a token drawn at `undefined` — which in the RN screen means "silently absent" and in the
    // DOM one means "pinned to the top of the list". The origin clause is the rule `railBus` exists for:
    // stop 0 has no segment leading into it, so a bus heading there is always ON the node.
    for (const c of rows()) {
      const view = viewFor(c)
      for (const bus of view.buses) {
        if (bus.kind === 'node') {
          expect(view.stops[bus.index], `${c.name}: node ${bus.index}`).toBeDefined()
        } else {
          expect(bus.from, `${c.name}: segment ${bus.from}→${bus.to}`).toBe(bus.to - 1)
          expect(bus.from, `${c.name}: a segment into the origin`).toBeGreaterThanOrEqual(0)
          expect(view.stops[bus.to], `${c.name}: segment to ${bus.to}`).toBeDefined()
        }
        expect(bus.label, `${c.name}: an unnamed bus token`).not.toBe('')
      }
    }
  })

  it('stars a row only where the rider’s own key names that pole and this route', () => {
    // `saved` is the one field built from a *key format*, and the format is `formatFavoriteRouteKey`'s
    // alone (ADR-059 bans ad-hoc id parsing). Reconstructing the key here rather than trusting the flag is
    // what makes this an assertion about the rule instead of an echo of it: a port that keyed on the
    // route's *number* rather than its id, or on a place id rather than the raw pole, would star rows the
    // Favourites tab does not list — and the two screens would disagree about what the rider saved.
    for (const c of rows()) {
      const view = viewFor(c)
      const saved = new Set(c.args.savedRouteKeys ?? [])
      for (const row of view.stops) {
        const key = formatFavoriteRouteKey(row.stopId, c.args.detail.route.id)
        expect(row.saved, `${c.name} / ${row.stopId}`).toBe(saved.has(key))
      }
    }
  })

  it('draws exactly one first and one last row, or none at all', () => {
    // Which connectors the rail draws above and below a node. Two `last` rows means two rails that stop
    // short; zero means a connector dangling below the final stop. Both are invisible in a screenshot of
    // the middle of a long route, which is why this is a property rather than a case.
    for (const c of rows()) {
      const view = viewFor(c)
      const ends = view.stops.length === 0 ? 0 : 1
      expect(view.stops.filter((s) => s.first).length, `${c.name}: first`).toBe(ends)
      expect(view.stops.filter((s) => s.last).length, `${c.name}: last`).toBe(ends)
    }
  })

  it('exercises every arm its own declarations have', () => {
    // THE COVERAGE CONTROL, and it is here because of what WP6-3b found the expensive way: two arms of a
    // three-way readout were declared, projected by nothing, and an injected defect passed twice. *A case
    // nothing drives is a specification looking at nothing.* So the fixtures are audited against the
    // branches rather than merely written — and this list is what a reviewer checks when a new arm is added.
    const views = rows().map(viewFor)
    const arms: Record<string, boolean> = {
      'a bus standing on a node': views.some((v) => v.buses.some((b) => b.kind === 'node')),
      'a bus on a segment': views.some((v) => v.buses.some((b) => b.kind === 'segment')),
      'an empty rail': views.some((v) => v.buses.length === 0),
      'a "Due" readout': views.some((v) =>
        v.stops.some((s) => s.arrivals.some((a) => a.label.kind === 'due')),
      ),
      'a figure readout': views.some((v) =>
        v.stops.some((s) => s.arrivals.some((a) => a.label.kind === 'mins')),
      ),
      'a row with no reading': views.some((v) => v.stops.some((s) => s.arrivals.length === 0)),
      'a stale board': views.some((v) => v.stops.some((s) => s.arrivals.some((a) => a.stale))),
      'a fresh board': views.some((v) => v.stops.some((s) => s.arrivals.some((a) => !a.stale))),
      'a circular header': views.some((v) => v.header.circular),
      'a header with a reverse to flip to': views.some((v) => v.header.reverseId !== undefined),
      'a header with none': views.some((v) => v.header.reverseId === undefined),
      'a holiday note on the fare pill': views.some((v) =>
        v.facts.some((f) => f.note !== undefined),
      ),
      'a fare span': views.some((v) =>
        v.facts.some((f) => f.key === 'fare' && f.value.includes('→')),
      ),
      'a single fare': views.some((v) =>
        v.facts.some((f) => f.key === 'fare' && !f.value.includes('→')),
      ),
      'no facts strip at all': views.some((v) => v.facts.length === 0),
      'a stop-count pill': views.some((v) => v.facts.some((f) => f.key === 'stops')),
      'a route with no stop-count pill': views.some(
        (v) => v.facts.length > 0 && !v.facts.some((f) => f.key === 'stops'),
      ),
      'a saved row': views.some((v) => v.stops.some((s) => s.saved)),
      'an anchored row': views.some((v) => v.hereIndex >= 0),
      'no anchor': views.some((v) => v.hereIndex === -1),
      'a name with a printed code': views.some((v) =>
        v.stops.some((s) => s.name.code !== undefined),
      ),
      'a name with none': views.some((v) => v.stops.some((s) => s.name.code === undefined)),
    }
    expect(
      Object.entries(arms)
        .filter(([, hit]) => !hit)
        .map(([arm]) => arm),
    ).toEqual([])
  })
})
