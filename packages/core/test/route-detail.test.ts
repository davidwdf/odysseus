import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-detail.spec.json'
import { formatFavoriteRouteKey } from '../src/ids'
import { CLIENT_POLICY_DEFAULTS } from '../src/policy'
import {
  isOriginStop,
  type RouteDetailView,
  type RouteEnds,
  type RouteFactSheetKind,
  type RouteFactSheetView,
  type RouteHeaderNames,
  routeDetailView,
  routeFactSheet,
  routeStopBoard,
  routeTerminusNames,
  upcoming,
  visibleBusMarkers,
} from '../src/route-detail'
import type { BusMarker } from '../src/route-position'
import type {
  EtaReport,
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
   * The live-fed Citybus case, asserted by **property** as well as by bytes.
   *
   * Its `expect` was computed by running this function, which is how a 200-line view model gets pinned at
   * all — and is also how a wrong composition would get pinned as correct. So the three claims that case
   * exists to make are restated here in a form that does not depend on those bytes: the notice is gone, the
   * kerb that refused says so on its own row, and every row the round answered has a readout. All three
   * were watched failing on a deliberate revert.
   */
  it('a live route watch answers the rows and marks only the kerb that refused', () => {
    const c = rows().find((row) => row.name.startsWith('a-live-route-watch-fills')) as {
      args: Args
    }
    expect(c, 'the live-fed corpus case has moved or been renamed').toBeTruthy()
    const view = viewFor(c)
    const refused = new Set((c.args.detail.failed ?? []).map((f) => f.stopId))
    expect(refused.size, 'the case no longer carries a refusing kerb').toBe(1)

    expect(view.liveArrivals).toBe('answered')
    for (const row of view.stops) {
      if (refused.has(row.stopId)) {
        expect(row.incomplete, `${row.stopId} refused and the row does not say so`).toBe(true)
        expect(row.arrivals, 'a refused kerb cannot also have a reading').toEqual([])
      } else {
        expect(
          row.incomplete,
          `${row.stopId} answered and the row calls it incomplete`,
        ).toBeUndefined()
      }
    }
    // …and the readings really arrived, or the two assertions above would hold over a screen of blanks.
    expect(view.stops.filter((row) => row.arrivals.length > 0).length).toBeGreaterThanOrEqual(2)
  })

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
      // ADR-114's three arms. The second and third are what a route with an empty rail *means*, and until
      // this row they were one thing: `arrivals: []` on every stop, with nothing anywhere saying whether
      // anybody had been asked. All three are needed because `src/route-detail.ts` is held to 100% branches.
      'a round that answered': views.some((v) => v.liveArrivals === 'answered'),
      'a round that did not answer': views.some((v) => v.liveArrivals === 'unavailable'),
      'an operator with no route-level feed': views.some((v) => v.liveArrivals === 'perStopOnly'),
      // …and the pairing that makes the point: an empty rail is not evidence either way.
      'an empty rail that was answered': views.some(
        (v) => v.buses.length === 0 && v.liveArrivals === 'answered',
      ),
      'an empty rail that was never asked about': views.some(
        (v) => v.buses.length === 0 && v.liveArrivals !== 'answered',
      ),
    }
    expect(
      Object.entries(arms)
        .filter(([, hit]) => !hit)
        .map(([arm]) => arm),
    ).toEqual([])
  })
})

describe('route-detail#routeStopBoard', () => {
  interface BoardArgs {
    report?: EtaReport
    poleId: string
    routeId: string
    now: string
    locale: Locale
    policy?: ResolvedClientPolicy
  }
  type Board = ReturnType<typeof routeStopBoard>

  const call = (a: BoardArgs) =>
    routeStopBoard(a.report, {
      poleId: a.poleId,
      routeId: a.routeId,
      now: at(a.now),
      locale: a.locale,
      ...(a.policy === undefined ? {} : { policy: a.policy }),
    })

  for (const c of specCases<BoardArgs, Board>(corpus, 'routeStopBoard')) {
    it(c.name, () => {
      expect(call(c.args)).toEqual(c.expect)
    })
  }

  it('never answers with a reading for a different pole or a different route', () => {
    // A property over the whole group rather than a value, and the one that matters on a schematic: a
    // route's stops are *different rows*, so a time borrowed from the wrong kerb is not a small error —
    // it tells a rider a bus is coming to a stop it has already passed. The corpus pins the answers; this
    // pins that no answer can ever come from somewhere else.
    for (const c of specCases<BoardArgs, Board>(corpus, 'routeStopBoard')) {
      const got = call(c.args)
      if (got.arrivals.length === 0) continue
      const source = (c.args.report?.etas ?? []).filter((e) =>
        got.arrivals.every((a) => e.arrivals.includes(a.iso)),
      )
      expect(source.length, `${c.name}: the readings came from no single reading`).toBe(1)
      expect(source[0]?.routeId, `${c.name}: a reading for another route`).toBe(c.args.routeId)
    }
  })

  it('is incomplete only when this pole is the one that failed', () => {
    // ADR-077's rule, one level down and easy to get subtly wrong: `failed` is a *place-wide* list, so a
    // failure at a neighbouring kerb must not make this stop's silence look like an outage.
    for (const c of specCases<BoardArgs, Board>(corpus, 'routeStopBoard')) {
      const failedHere = (c.args.report?.failed ?? []).some((f) => f.stopId === c.args.poleId)
      expect(call(c.args).incomplete, c.name).toBe(failedHere)
    }
  })
})

describe('route-detail#routeFactSheet', () => {
  // The four sheets a static pill opens (WP6-6c). Every case's `expect` is the whole sheet, so a change to
  // any of the eight decisions it makes — where a fare stage starts, which concessions are explained, how an
  // unnamed day mask is named, which whole-route figures are estimates — is a corpus diff.
  const LABELS = {
    stopCount: (n: number) => `${n} stops`,
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    day: (kind: string) =>
      ({
        weekday: 'Mon – Fri',
        saturday: 'Saturday',
        sunday: 'Sunday & holidays',
        daily: 'Every day',
        other: 'Selected days',
      })[kind] ?? kind,
  }

  interface Args {
    kind: RouteFactSheetKind
    detail: RouteDetailPayload
    locale: Locale
    now: string
  }

  const rows = () => specCases<Args, RouteFactSheetView>(corpus, 'routeFactSheet')

  /** The sheet, derived through the **same view the screen has** — see the function's own note. */
  const sheetFor = (a: Args) =>
    routeFactSheet(
      a.kind,
      routeDetailView(a.detail, { locale: a.locale, now: at(a.now), labels: VIEW_LABELS }),
      a.detail.route.service,
      { locale: a.locale, labels: LABELS },
    )

  /** `routeDetailView`'s own label fixture, reused so the two groups cannot disagree about a stop's name. */
  const VIEW_LABELS = {
    stopCount: (n: number) => `${n} stops`,
    holiday: 'hol',
    circularVia: (place: string) => `Circular via ${place}`,
    busApproaching: (stop: string) => `Bus approaching ${stop}`,
    busAtStop: (stop: string) => `Bus at ${stop}`,
  }

  it('matches the corpus, case for case', () => {
    const cases = rows()
    expect(cases.length).toBeGreaterThanOrEqual(12)
    for (const c of cases) {
      expect(sheetFor(c.args), c.name).toEqual(c.expect)
    }
  })

  it('names every fare stage’s boarding stop with the schematic’s own words', () => {
    // The property behind handing the *view* in rather than the payload. A timeline that computed its own
    // display names would drift from the list above it the first time either grew a rule — which is exactly
    // what WP6-6a found in this file, as a second inlined spelling of `displayName` eleven lines from the
    // first. So: every stage's `boardingStop` is some row's `name.label`, never a string of its own.
    for (const c of rows()) {
      const view = routeDetailView(c.args.detail, {
        locale: c.args.locale,
        now: at(c.args.now),
        labels: VIEW_LABELS,
      })
      const names = new Set(view.stops.map((row) => row.name.label))
      const sheet = sheetFor(c.args)
      if (sheet.kind !== 'fare') continue
      for (const stage of sheet.stages) {
        expect(names.has(stage.boardingStop), `${c.name}: invented "${stage.boardingStop}"`).toBe(
          true,
        )
      }
    }
  })

  it('explains exactly the concession classes that appear, and never one that does not', () => {
    // The legend's honesty, as a property rather than a value: a class explained but never shown is a promise
    // the sheet did not keep, and a class shown but not explained is an unlabelled estimate — which ADR-044
    // forbids, because these are policy figures rather than route data.
    for (const c of rows()) {
      const sheet = sheetFor(c.args)
      if (sheet.kind !== 'fare') continue
      const shown = new Set(
        sheet.stages.flatMap((stage) => stage.concessions.map((figure) => figure.class)),
      )
      expect([...sheet.concessions].sort(), c.name).toEqual([...shown].sort())
      // Both or neither, per stage — the two come from one parse, so a stage with exactly one is impossible.
      for (const stage of sheet.stages) expect([0, 2], c.name).toContain(stage.concessions.length)
    }
  })

  it('prices no concession for a fare it cannot parse, rather than "$undefined"', () => {
    // The `~$undefined` guard. `fareStages` admits a stage wherever `Number(f)` is not NaN — which keeps a
    // whitespace-only cell (`Number(' ')` is 0) — while the concession estimators reject exactly those
    // (`parseFareOrUndefined` trims and demands `isFinite`). A per-stop `fare` is an unvalidated wire string
    // (ADR-052 decision 2), so the two must agree about "no figure" rather than format one from `undefined`.
    // No corpus case carries such a fare, so this is a constructed row: a boarding stop priced as whitespace.
    const base = rows().find((c) => c.args.kind === 'fare' && c.args.detail.stops.length > 1)
    if (base === undefined) throw new Error('no fare-timeline corpus case to base the guard on')
    const detail = structuredClone(base.args.detail)
    const first = detail.stops[0]
    if (first === undefined) throw new Error('unreachable: the case has stops')
    first.fare = ' '
    const view = routeDetailView(detail, {
      locale: base.args.locale,
      now: at(base.args.now),
      labels: VIEW_LABELS,
    })
    const sheet = routeFactSheet('fare', view, detail.route.service, {
      locale: base.args.locale,
      labels: LABELS,
    })
    expect(sheet.kind).toBe('fare')
    if (sheet.kind !== 'fare') return
    // The whitespace fare still opens a stage (that is why it reaches the estimators)…
    const whitespaceStage = sheet.stages.find((s) => s.fromSeq === 1)
    expect(whitespaceStage, 'a fare fareStages admits should still open a stage').toBeDefined()
    // …but it prices no concession, and a numeric stage further down still prices both — so the guard is
    // targeted at the unparseable fare, not global.
    expect(whitespaceStage?.concessions, 'an unparseable fare prices no concession').toEqual([])
    expect(
      sheet.stages.some((s) => s.concessions.length === 2),
      'numeric stages still priced',
    ).toBe(true)
    expect(JSON.stringify(sheet), 'no figure reads "$undefined"').not.toContain('$undefined')
  })

  it('marks an estimate as one, and never marks a count as one', () => {
    // ADR-008 on the overview sheet. The stop count is a fact; the distance is a straight line through the
    // stops and the journey time is upstream's own timing, and both are labelled. A port that dropped the
    // flag would present a guess as a measurement, which is the one thing this app does not do.
    for (const c of rows()) {
      const sheet = sheetFor(c.args)
      if (sheet.kind !== 'stops') continue
      for (const stat of sheet.stats) {
        expect(stat.estimate, `${c.name} / ${stat.stat}`).toBe(stat.stat !== 'stops')
      }
      // The count is always there: this sheet was opened from the pill that showed it.
      expect(
        sheet.stats.some((s) => s.stat === 'stops'),
        c.name,
      ).toBe(true)
    }
  })

  it('shows a coarse fallback only where there is no table to show instead', () => {
    // Never both, on either sheet. Both at once would state one fact twice at two fidelities and leave a
    // rider to work out which is authoritative — and the two sheets read *different* fields of the same
    // block, so a port that wired one fallback and forgot the other looks right on every route with patterns.
    for (const c of rows()) {
      const sheet = sheetFor(c.args)
      if (sheet.kind === 'freq') {
        expect(sheet.days.length > 0 && sheet.headway !== undefined, c.name).toBe(false)
      }
      if (sheet.kind === 'hours') {
        expect(sheet.days.length > 0 && sheet.span !== undefined, c.name).toBe(false)
      }
    }
  })

  it('exercises every arm its own declarations have', () => {
    // The coverage control, as on `routeDetailView` and for the same reason (WP6-3b): a case nothing drives
    // is a specification looking at nothing.
    const sheets = rows().map((c) => sheetFor(c.args))
    const arms: Record<string, boolean> = {
      'a fare timeline with stages': sheets.some((s) => s.kind === 'fare' && s.stages.length > 0),
      'a fare timeline with none': sheets.some((s) => s.kind === 'fare' && s.stages.length === 0),
      'a concession legend': sheets.some((s) => s.kind === 'fare' && s.concessions.length > 0),
      'no concession legend': sheets.some((s) => s.kind === 'fare' && s.concessions.length === 0),
      'a frequency table': sheets.some((s) => s.kind === 'freq' && s.days.length > 0),
      'a frequency fallback': sheets.some((s) => s.kind === 'freq' && s.headway !== undefined),
      'a frequency sheet with neither': sheets.some(
        (s) => s.kind === 'freq' && s.days.length === 0 && s.headway === undefined,
      ),
      'an hours table': sheets.some((s) => s.kind === 'hours' && s.days.length > 0),
      'an hours fallback': sheets.some((s) => s.kind === 'hours' && s.span !== undefined),
      'a multi-band day': sheets.some(
        (s) => s.kind === 'freq' && s.days.some((day) => day.bands.length > 1),
      ),
      'a day named from its mask': sheets.some(
        (s) =>
          (s.kind === 'freq' || s.kind === 'hours') && s.days.some((d) => d.day.includes(' · ')),
      ),
      'a mask that names nothing': sheets.some(
        (s) =>
          (s.kind === 'freq' || s.kind === 'hours') &&
          s.days.some((d) => d.day === 'Selected days'),
      ),
      'an overview with a journey time': sheets.some(
        (s) => s.kind === 'stops' && s.stats.some((r) => r.stat === 'journey'),
      ),
      'an overview without a journey time': sheets.some(
        (s) => s.kind === 'stops' && !s.stats.some((r) => r.stat === 'journey'),
      ),
      'an overview with a distance': sheets.some(
        (s) => s.kind === 'stops' && s.stats.some((r) => r.stat === 'distance'),
      ),
      'an overview without a distance': sheets.some(
        (s) => s.kind === 'stops' && !s.stats.some((r) => r.stat === 'distance'),
      ),
    }
    expect(
      Object.entries(arms)
        .filter(([, hit]) => !hit)
        .map(([arm]) => arm),
    ).toEqual([])
  })
})
