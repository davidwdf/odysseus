import {
  applyLiveEtasToStopDetail,
  type Bound,
  classifyRemark,
  dedupeEtas,
  type Eta,
  type EtaBatch,
  type EtaBatchEntry,
  type EtaFailure,
  type EtaReport,
  etaBoardingKey,
  narrowEtasToRoutes,
  parseRouteId,
  parseStopId,
  parseStopOrPlaceId,
  type RouteDetail,
  type Stop,
  type StopDetail,
} from '@nextbus/core'
import {
  fetchEta,
  fetchGmbStopEta,
  fetchKmbRouteEta,
  fetchKmbStopEta,
  type GmbEtaEntry,
  type MemberDoc,
  type PlaceDoc,
  toRouteSummary,
} from '@nextbus/data-normalize'
import type { DatasetSource } from './dataset'
import { badRequest, notFound, wireErrorOf } from './errors'
import { coalesce } from './eta-cache'

// Per-place CTB fan-out budget (ADR-042). KMB poles cost ONE call each (`stop-eta` returns
// every route), so only CTB — which has no per-stop endpoint — needs bounding; this guards a
// pathological interchange. Routes beyond it are still counted (static) and shown on the
// Place page. The default is generous (≈ "all" in practice); Nearby passes a smaller one.
const DEFAULT_CTB_BUDGET = 24

/**
 * The CTB fan-out budget for an endpoint that answers about **several places at once**.
 *
 * Half the default, and the reason is arithmetic rather than caution. `DEFAULT_CTB_BUDGET` is generous
 * because a single-place request happens once; a multi-place one multiplies it. Over build
 * `d598893de6add2e4` the heaviest real place costs 32 upstream calls at budget 24 and **20 at budget
 * 12** (measured for `EtaHub`'s own cap — see `LIVE_CTB_BUDGET` there), so twelve places at 12 is
 * ≤240 calls ≈ 40 batches at the runtime's 6 simultaneous outgoing connections, well inside the
 * subrequest limit and well inside a client's own network timeout. At 24 the same request is ≤384.
 *
 * **One declaration for every multi-place reader**, which is why it is here and not in `nearby.ts`: it
 * was `NEARBY_CTB_BUDGET`, module-private, and the batch endpoint (WP5-7) would have been the second
 * copy of `12`. The shard keeps its own (`LIVE_CTB_BUDGET`) deliberately — a round that repeats every
 * 45 s for as long as a socket is open has a different reason for the same number, and ADR-073 records
 * what happened the last time this parameter was dropped silently on the live path.
 */
export const LIST_CTB_BUDGET = 12

/** A place's members as a canonical `Stop` — one id carrying every member operator's source id.
 *  `name`/`location` are the place's chosen name + anchor, picked once by the build so every
 *  screen reads the same (ADR-042 "name once"). */
export function toMergedStop(place: {
  id: string
  name: PlaceDoc['name']
  lat: number
  lng: number
  bearingDeg?: number
  members: MemberDoc[]
}): Stop {
  return {
    id: place.id,
    name: place.name,
    location: { lat: place.lat, lng: place.lng },
    sources: place.members.map((m) => ({ operator: m.operator, operatorStopId: m.stopId })),
    ...(place.bearingDeg === undefined ? {} : { bearingDeg: place.bearingDeg }),
  }
}

/** Map a GMB stop-board's raw (route_id, route_seq) entries to canonical `Eta`s (ADR-047).
 *  `route_seq` 1 → outbound, 2 → inbound; entries whose route isn't in this place's resolution
 *  table (or with no arrivals) are dropped. */
function gmbEtasFrom(entries: GmbEtaEntry[], gmbLive: Record<string, string>): Eta[] {
  const out: Eta[] = []
  for (const en of entries) {
    if (en.arrivals.length === 0) continue
    const bound: Bound = en.routeSeq === 2 ? 'inbound' : 'outbound'
    const routeId = gmbLive[`${en.routeId}:${bound}`]
    if (!routeId) continue
    out.push({
      routeId,
      stopId: en.stopId,
      operator: 'GMB',
      arrivals: en.arrivals,
      dataTimestamp: en.dataTimestamp,
      observedAt: en.observedAt,
      ...(en.remark ? { remark: en.remark } : {}),
    })
  }
  return out
}

/** Distinct CTB route numbers at one pole, in document order. */
function ctbRoutesAt(place: PlaceDoc, poleId: string): string[] {
  const seen = new Set<string>()
  for (const r of place.routes) {
    if (r.stopId === poleId) seen.add(r.route.routeNo)
  }
  return [...seen]
}

/** One upstream ETA board to call: the canonical pole whose board it is — the id every reading off
 *  it is stamped with — and the raw id the operator's API takes. */
interface BoardCall {
  poleId: string
  rawStopId: string
  operator: MemberDoc['operator']
}

/**
 * Every upstream board a place needs called — one per member, **plus one per alias**.
 *
 * An alias is a second upstream id for the same physical pole (WP5-11), and it has its own board
 * with its own routes: in build `1ccad7436a8df480`, 0 of the 324 route rows sitting on a folded pole
 * also appear on the member it was folded onto. Calling only the member would therefore leave those
 * rows permanently blank while looking entirely healthy. The raw id an alias's API takes is the
 * second field of its canonical id (`parseStopId` — ADR-059's grammar, not a `split(':')` here), and
 * an alias that does not parse is skipped rather than guessed at.
 *
 * Each call keeps the pole's **own** canonical id, which is the id its readings are stamped with —
 * *not* the boarding point it is displayed under. See `atPole` for why that is not a detail.
 */
function boardCalls(place: PlaceDoc): BoardCall[] {
  const calls: BoardCall[] = []
  const seen = new Set<string>()
  for (const m of place.members) {
    const push = (poleId: string, rawStopId: string) => {
      if (seen.has(poleId)) return
      seen.add(poleId)
      calls.push({ poleId, rawStopId, operator: m.operator })
    }
    push(m.id, m.stopId)
    for (const aliasId of m.aliasIds ?? []) {
      const raw = parseStopId(aliasId)?.rawId
      if (raw) push(aliasId, raw)
    }
  }
  return calls
}

/** One board call's answer: the pole's readings, or the failure that came instead. */
type BoardResult = { poleId: string; etas: Eta[] } | { poleId: string; error: EtaFailure['error'] }

/**
 * Raw (call-deduped, not yet rider-deduped) ETAs across every upstream pole of a place
 * (ADR-042, WP5-11), **and the poles that would not answer** (ADR-073). Each KMB or GMB pole is ONE
 * stop-board call (all its routes); CTB is per-route, bounded by a per-place budget. Poles and CTB
 * routes are fetched concurrently.
 *
 * Every upstream call goes through `coalesce` (WP0-4), so a pole is fetched **once per 30 s
 * per isolate** no matter how many places, requests or concurrent callers want it: the
 * distinct call keys below are exactly the upstream calls this function can issue.
 * The GMB *raw* board is what's cached — the mapping to canonical ids uses the place's own
 * resolution table, so a cached board can't outlive the build that resolved it.
 *
 * ## Why the failures come back rather than being swallowed here
 *
 * `coalesce` used to take a `fallback` and every one of these call sites passed `[]`, so this
 * function could not tell a refused board from an empty one and neither could anything above it.
 * The consequence was not a missing diagnostic, it was a wrong answer: `/v1/etas/:id` served
 * `200 []` during an outage and both live engines reported every reading `gone`. See `eta-cache.ts`.
 *
 * **The unit of failure is the pole, and the aggregation is deliberate.** CTB has no stop board
 * (ADR-021), so one pole is N calls; if any of them refuses, the pole is named once — the routes that
 * *did* answer are in `etas` as usual, and the kernel's `retainFailedPoles` keeps only the previous
 * readings this round did not replace. Reporting per (pole, route) would emit a dozen `status` frames
 * for one outage; reporting per place would claim we could not ask about kerbs we did ask about.
 *
 * **A `catch` per task, never one around `Promise.all`.** One refusing pole must not take the place's
 * other poles with it — that is the same isolation the poll emulator gives one target among several,
 * one level down.
 */
async function memberEtaLists(
  place: PlaceDoc,
  ctbBudget = DEFAULT_CTB_BUDGET,
): Promise<{ etas: Eta[]; failed: EtaFailure[] }> {
  const tasks: Array<Promise<BoardResult>> = []
  let ctbRemaining = ctbBudget
  /** Every board call's answer, tagged with the pole, so a rejection cannot look like an empty board. */
  const board = (poleId: string, etas: Promise<Eta[]>): Promise<BoardResult> =>
    atPole(poleId, etas).then(
      (list): BoardResult => ({ poleId, etas: list }),
      // `wireErrorOf` is the edge's own classifier (ADR-064): a `TimeoutError`/`AbortError` becomes
      // `upstream_timeout`, everything else here defaults to `upstream_unavailable`. Both are
      // `retryable: true`, which is what the readers below rely on — a board that refused says nothing
      // about whether the stop exists, so a pole failure never drops a target from a subscription.
      (err): BoardResult => ({ poleId, error: wireErrorOf(err) }),
    )

  // `boardCalls` already drops a pole named twice (an overlapping caller, a malformed doc), so the
  // CTB budget isn't spent on a repeat we'd only coalesce away.
  for (const call of boardCalls(place)) {
    if (call.operator === 'CTB') {
      for (const routeNo of ctbRoutesAt(place, call.poleId)) {
        if (ctbRemaining <= 0) break
        ctbRemaining--
        // CTB has no per-stop board (ADR-021), so the call key is per (pole, route).
        const key = `CTB-eta|${call.rawStopId}|${routeNo}|1`
        tasks.push(
          board(
            call.poleId,
            coalesce(key, () => fetchEta('CTB', call.rawStopId, routeNo, '1')),
          ),
        )
      }
    } else if (call.operator === 'GMB') {
      // GMB: one stop-board call returns every route at this pole (like KMB); the edge
      // resolves its raw route_id/seq to our canonical ids (ADR-047).
      const gmbLive = place.gmbLive ?? {}
      const raw = coalesce<GmbEtaEntry[]>(`gmb-board|${call.rawStopId}`, () =>
        fetchGmbStopEta(call.rawStopId),
      )
      tasks.push(
        board(
          call.poleId,
          raw.then((entries) => gmbEtasFrom(entries, gmbLive)),
        ),
      )
    } else {
      // KMB/LWB: one call returns every route at this pole. Both operators read the same
      // KMB `stop-eta` board, so the pole id alone is the call key.
      tasks.push(
        board(
          call.poleId,
          coalesce<Eta[]>(`kmb-board|${call.rawStopId}`, () => fetchKmbStopEta(call.rawStopId)),
        ),
      )
    }
  }

  const results = await Promise.all(tasks)
  const etas: Eta[] = []
  /** First failure per pole wins; `Promise.all` preserves task order, so "first" is deterministic. */
  const failedByPole = new Map<string, EtaFailure['error']>()
  for (const result of results) {
    if ('etas' in result) {
      for (const e of result.etas) if (e.arrivals.length > 0) etas.push(e)
    } else if (!failedByPole.has(result.poleId)) {
      failedByPole.set(result.poleId, result.error)
    }
  }
  // Sorted by pole id, because both engines turn each entry into one `status` frame and D1's canonical
  // order is what keeps their frame sequences byte-identical for identical upstream behaviour.
  const failed = [...failedByPole.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([stopId, error]): EtaFailure => ({ stopId, error }))
  return { etas, failed }
}

/**
 * Stamp every reading from one pole's call with that pole's **canonical** id.
 *
 * The normalizers stamp `Eta.stopId` with the *operator's* own stop id (`6AB438AD3AE100DD`), because
 * they never see the dataset and canonical ids are minted from it — `packages/data-normalize/src/kmb.ts`
 * says so at its `stopId` parameter. But the contract declares this field's identity **canonical**:
 * `EtaRefSchema` — the `(stopId, routeId)` pair a `delta` uses to say *gone* — states that it is "the same
 * pair `formatFavoriteRouteKey` encodes", and that grammar's stop half is a canonical pole id (it is what
 * `SaveStar` saves). Everything that *reads* the pair therefore compares it against a canonical id:
 * `applyLiveEtasToStopDetail` matches a row by `(row.stopId, row.route.id)` and `applyLiveEtasToNearby`
 * maps a reading to a place through `memberStopIds`. Against the raw spelling, **both matched nothing.**
 *
 * It had no symptom for four waves because nothing had ever compared the two: `stopDetail` attaches
 * `routes[].eta` by `routeId` alone, and `/v1/nearby` hands a place its own readings by construction. The
 * first consumer of the pair was WP5-0's live merge, and the symptom was a Place screen whose every
 * arrival blanked to "—" one second after it painted. Found by opening it in a browser (Mong Kok,
 * MK513/514/515 — 8 of 21 rows had a reading and none survived the merge), not by a test: every fixture in
 * the repo, including the kernel corpus, had written the canonical spelling the contract asks for.
 *
 * Stamped here — at the one place that knows both spellings for certain, since the call *is* per pole —
 * rather than in the kernel, because this is the side that was wrong. Doing it here fixes all four
 * consumers at once (`/v1/etas`, `/v1/stop`'s embedded readings, `/v1/nearby`, and the `EtaHub` frames,
 * which will be built from these same lists). No wire *shape* changes: the field is the same field, now
 * carrying the value its own contract describes.
 *
 * A **new object** per reading, never a mutation: these lists come out of `coalesce`, which hands the same
 * array to every concurrent caller for 30 s, so mutating one would rewrite another place's readings.
 *
 * **The id is the pole whose board was called, even when the fold displays that pole as another
 * (WP5-11) — and that is the one decision this function makes.** A place with an alias has two
 * spellings for one pole; a route that boards only at the folded one has a row naming the folded id,
 * so a reading stamped with the boarding point instead matches no row and every arrival on it blanks.
 * That is the bug above, arriving from the other direction, and it was measured that way rather than
 * reasoned about: `pole-merge.test.ts` runs the kernel merge over these responses and failed on
 * exactly those rows. The wire therefore speaks raw pole ids throughout — every id upstream publishes
 * stays a valid `Eta.stopId` and a valid favourite key — and the fold is a *display* collapse the
 * client applies with `boardingPoleId`, on the far side of the wire from anything persisted.
 */
function atPole(poleId: string, etas: Promise<Eta[]>): Promise<Eta[]> {
  return etas.then((list) => list.map((e) => ({ ...e, stopId: poleId })))
}

/**
 * `${routeId}|${rawStopId}` → the boarding fare there, plus route → destination. Both are
 * precomputed into the place document, so stamping costs no extra lookup.
 *
 * Destinations are indexed by **route id and by rider line at one pole**. The exact id can miss: a KMB
 * stop-board returns every service-type variant at the pole, `dedupeEtas` keeps whichever is soonest,
 * and that variant may not be the one the static data lists here — so falling back to the rider line
 * keeps "→ destination" on the card instead of dropping it for exactly the readings a rider is most
 * likely to see.
 *
 * **The fallback is per pole, and that is WP5-9.** Keyed by line alone it returned the first row of
 * that line anywhere in the place, which is a different service rather than a different timetable
 * wherever one number is run by two: at Tai On Street `GMB:20` boards for Chai Wan (Fung Yip Street)
 * at one kerb and for Chai Wan Industrial City at the other, so a pole-blind fallback printed the
 * wrong terminus on a real arrival. `etaLineKey` is the kernel's own line key (`@nextbus/core`), which
 * this function used to keep a copy of under a comment saying it "must agree with `dedupeEtas`
 * exactly" — a comment is not a mechanism.
 */
function stampTables(place: PlaceDoc) {
  // Keyed on the **canonical** pole id, which is what `place.routes[].stopId` already carries and what a
  // reading now carries too (see `atPole`). This map used to convert each row's canonical id back to the
  // operator's own, via a `memberById` lookup, purely because readings arrived spelled that way — one
  // conversion deleted rather than a second one added. It is the *raw* pole and not the boarding point
  // for the same reason: a folded pole's rows keep their own id on the wire (WP5-11), and its fares are
  // its own — the two poles of one physical pole can list different fares for different routes.
  const fareByRouteAndPole = new Map<string, string>()
  const destinationByRoute = new Map<string, PlaceDoc['name']>()
  const destinationByBoardingLine = new Map<string, PlaceDoc['name']>()
  for (const r of place.routes) {
    destinationByRoute.set(r.route.id, r.route.destination)
    const boarding = etaBoardingKey({
      operator: r.route.operator,
      routeId: r.route.id,
      stopId: r.stopId,
    })
    if (!destinationByBoardingLine.has(boarding))
      destinationByBoardingLine.set(boarding, r.route.destination)
    if (r.fare) fareByRouteAndPole.set(`${r.route.id}|${r.stopId}`, r.fare)
  }
  return { fareByRouteAndPole, destinationByRoute, destinationByBoardingLine }
}

/**
 * Stamp a reading with its remark's class (ADR-053).
 *
 * The rule is **not reimplemented here** — this calls `classifyRemark`, the same corpus-pinned kernel
 * function the client used to call on its own (`@nextbus/core`, `@spec eta#classifyRemark`). That is
 * the whole shape of "move it to the edge": the edge is the `server` layer and may import the kernel
 * (ADR-051), so the rule stays declared once, the wire field is optional, and a client that does not
 * receive it — an old build, or one replaying an offline cache — derives the same answer from the same
 * code. Serving it means iOS and Android never hand-port the match, which is the point; deleting the
 * client's fallback would trade one duplicate for offline support (ADR-058).
 *
 * No remark means no class: the field is absent rather than `info`, because "the operator said
 * nothing" and "the operator said something uncategorized" are different facts.
 */
function withRemarkKind(eta: Eta): Eta {
  if (!eta.remark) return eta
  return { ...eta, remarkKind: classifyRemark(eta.remark) }
}

/**
 * THE canonical live arrivals for a stop or merged place: upstream calls deduped by
 * (route, serviceType), then collapsed to **one rider line per route+direction**
 * (`dedupeEtas`), soonest first — **plus the boarding points that would not answer** (ADR-073).
 * The single source every reading-bearing endpoint (`/v1/nearby`, `/v1/etas`) flows through — so the
 * API is consistently de-duplicated and the frontend never re-dedupes. (`/v1/stop` returns the full
 * route *list* with per-route ETAs; its list-level collapse is the client's `dedupeRoutes`.)
 *
 * `failed` rides alongside `etas` rather than being folded into it because the two answer different
 * questions and a rider needs both: `etas` is what is coming, `failed` is which kerbs we could not ask
 * about — and *"nothing is coming"* and *"we could not ask"* are the two states that used to be one.
 */
export async function stopArrivals(
  place: PlaceDoc,
  ctbBudget = DEFAULT_CTB_BUDGET,
): Promise<EtaReport> {
  const { etas: raw, failed } = await memberEtaLists(place, ctbBudget)
  const all = dedupeEtas(raw)
  const { fareByRouteAndPole, destinationByRoute, destinationByBoardingLine } = stampTables(place)
  // Stamp each reading with its route's destination + boarding fare so flat ETA lists can show
  // "→ dest · $6.7" without the full Route object (ADR-036). Readings arrive carrying their canonical
  // pole id (`atPole`), which is the id both tables above are keyed on.
  const etas = all
    .map((e) => {
      const destination =
        destinationByRoute.get(e.routeId) ?? destinationByBoardingLine.get(etaBoardingKey(e))
      const fare = fareByRouteAndPole.get(`${e.routeId}|${e.stopId}`)
      const stamped = withRemarkKind(e)
      if (!destination && !fare) return stamped
      return { ...stamped, ...(destination ? { destination } : {}), ...(fare ? { fare } : {}) }
    })
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))
  // Absent, not `[]`, when every board answered — see `EtaReportSchema`. The common case is then
  // byte-identical to what it always was, which matters for the payload the poll emulator fetches
  // once per target per cadence.
  return failed.length === 0 ? { etas } : { etas, failed }
}

/**
 * The place an id denotes, or the reason there is no such thing — and *which* reason (ADR-064).
 *
 * Telling the two apart is where WP2-8 actually bites. An id that does not parse is a
 * `bad_request`: the caller has to change it, and no amount of asking again will help. An id that
 * parses and resolves to nothing is `not_found` — a pole that left the dataset — and is equally
 * permanent. Both were `throw new Error(...)`, which the router converted into a retryable `502`,
 * so a rider's stale favourite looked to a background client exactly like a Cloudflare hiccup.
 *
 * Parse before reading, so a junk id costs no KV lookups: `ds.place()` on `"<script>"` would
 * otherwise walk the alias table looking for it.
 */
async function requirePlace(ds: DatasetSource, id: string): Promise<PlaceDoc> {
  if (!parseStopOrPlaceId(id)) throw badRequest(`not a stop or place id: ${id}`)
  const place = await ds.place(id)
  if (!place) throw notFound(`unknown stop: ${id}`)
  return place
}

/** GET /v1/stop/:id — a stop (or merged same-kerb place) and every route serving it,
 *  each with its next ETA. A `P:`-prefixed id spans both operators at one kerb.
 *
 *  Routes go out at the **summary** service tier (`RouteSummary`, no frequency profiles —
 *  ADR-065). The shard build already drops `patterns` for size, but a KV document is untyped
 *  JSON that may predate this code, so the endpoint enforces its own tier rather than
 *  inheriting whatever is in the namespace. */
export async function stopDetail(ds: DatasetSource, id: string): Promise<StopDetail> {
  const place = await requirePlace(ds, id)
  // `failed` is served here since WP5-13 (ADR-077), and the mechanism that makes it safe is the one
  // ADR-073 said it was waiting for: `applyLiveEtasToStopDetail` now *replaces* the field from its own
  // argument rather than spreading the document's copy, so this list cannot outlive the round it
  // describes. Pass it to that call below — omitting it there would clear it, which is exactly the
  // fail-safe direction the kernel chose.
  const { etas: raw, failed } = await memberEtaLists(place)
  const readings = raw.map(withRemarkKind)

  const detail: StopDetail = {
    stop: toMergedStop(place),
    // `stopId` records which pole each route departs from, so the Place screen can group routes under
    // their pole (ADR-042). It is the pole the route's own stop list names — which may be a folded one
    // rather than a member (WP5-11) — because it is also the key `SaveStar` persists, and the reading
    // attached beside it carries the same spelling (`atPole`).
    routes: place.routes.map((r) => ({
      route: toRouteSummary(r.route),
      eta: null,
      fare: r.fare,
      stopId: r.stopId,
    })),
    // One entry per **boarding point**; `aliasIds` names the other ids upstream published for the
    // same physical pole, which is how the client groups a route row under the right heading and
    // collapses two ids of one pole to one row (`boardingPoleId`, `dedupeRoutes` — WP5-11).
    members: place.members.map((m) => ({
      id: m.id,
      name: m.name,
      location: { lat: m.lat, lng: m.lng },
      ...(m.aliasIds?.length ? { aliasIds: m.aliasIds } : {}),
    })),
  }

  // **Which reading belongs to which row is the kernel's rule, not this file's** (WP5-9). It used to
  // be a local `Map` keyed on the route id alone, and a route id does not name a kerb: where two poles
  // of one place run the same line — 43 rider lines across 37 places in build `1ccad7436a8df480`, and
  // the norm for GMB — a reading off one pole was handed to the row that departs from the other.
  // Measured live on 2026-07-31 at Hiram's Highway, opposite Marina Cove: the row for
  // `GMB:1A:outbound:2002355` at `GMB:20001114` carried a reading stamped `GMB:20009421`, so the app
  // showed a bus at a kerb it was not coming to *and* said nothing at the kerb it was.
  //
  // `applyLiveEtasToStopDetail` is the same function the live subscription applies to this payload one
  // cadence later (`useLiveEtas` → `setQueryData`), which is the point of calling it here: two
  // implementations of "this reading belongs to that row" is how the screen came to disagree with
  // itself, and the previous one crossed poles where the kernel's does not. The `server` layer may
  // import the kernel (ADR-051), and `classifyRemark` above is the same move.
  return applyLiveEtasToStopDetail(detail, readings, failed)
}

/**
 * GET /v1/etas/:id — the arrivals for a stop or merged place, and the kerbs we could not ask about
 * (optionally route-filtered).
 *
 * `ctbBudget` is threaded rather than left to `stopArrivals`' default for the same reason `/v1/nearby`
 * passes its own: the default is generous because one HTTP request happens once, and the `EtaHub` round
 * that also reads through here happens every 45 s for as long as a socket is open. Dropping the parameter
 * silently — which this function did — meant the live fan-out was double what the shard's own cap
 * documented, and the number the cap published was wrong by an order of magnitude.
 *
 * **`routes=` filters the readings and never the failures**, and the asymmetry is the honest one. A
 * caller narrowing to three routes is saying which arrivals it wants, not which outages it is willing
 * to hear about — and a KMB board is one call for every route at the pole, so "did this pole answer"
 * has no per-route truth to filter by in the first place. Filtering `failed` too would mean a screen
 * watching one route at a refusing pole received an empty list with nothing to explain it, which is
 * precisely the state this endpoint's shape exists to make impossible.
 */
export async function stopEtas(
  ds: DatasetSource,
  id: string,
  routeIds?: string[],
  ctbBudget?: number,
): Promise<EtaReport> {
  const place = await requirePlace(ds, id)

  const report = await stopArrivals(place, ctbBudget)
  if (!routeIds?.length) return report
  // **The kernel's rule, not a `Set` and a `.filter` here** (WP5-7). It used to be three lines in this
  // function, which was fine while the edge was the only narrower. The batch endpoint carries no
  // per-id `routes=` — there is no safe delimiter for a nested list, since `,` is a legal `idchar` —
  // so the poll emulator narrows a target's readings *after* the batch answers, while the `EtaHub`
  // shard goes on narrowing here by passing `routeIds` through. Two narrowings, one declaration:
  // written twice they would eventually disagree, and the two engines' listener output is exactly
  // what ADR-074's corpus asserts is identical.
  return { ...report, etas: narrowEtasToRoutes(report.etas, routeIds) }
}

/**
 * GET /v1/etas?ids=… — `stopEtas` for each id, concurrently, over one dataset handle and one
 * coalescer (WP5-7).
 *
 * **This is not a second read path, and it must never become one.** Every id goes through the same
 * `stopEtas` a single-id request goes through, so an entry is byte-identical to `/v1/etas/<that id>`
 * — asserted, not assumed — and `coalesce` (ADR-057) turns a pole shared by two ids into one upstream
 * call rather than two. That sharing is the reason a batch is cheaper than the fan-out it replaces,
 * rather than merely fewer HTTP requests: the six places `/v1/nearby` serves overlap constantly at an
 * interchange.
 *
 * **A per-id failure is an entry, never a status.** `requirePlace` throws for a malformed id and for a
 * pole that has left the dataset, and `Promise.all` propagates the first rejection — so without a
 * `catch` per task one rider's stale favourite would take the other five ids' readings down with it.
 * That is the identical lesson `memberEtaLists` learned one level down ("a `catch` per task, never one
 * around `Promise.all`") and the identical lesson `coalesce` learned about deciding failure semantics
 * on a caller's behalf. The batch's own request is well formed, so the honest answer is a `200` whose
 * entry names the code — `wireErrorOf` is the same classifier the shard uses, so a malformed id is
 * `bad_request` with `retryable: false`, which is the signal the poll emulator already reads to stop
 * asking about a target.
 *
 * `ids` arrives deduplicated and sorted from the router and this function preserves that order, because
 * two engines producing one round must serialize it identically (D1).
 */
export async function stopEtasBatch(
  ds: DatasetSource,
  ids: readonly string[],
  ctbBudget?: number,
): Promise<EtaBatch> {
  const reports = await Promise.all(
    ids.map(async (id): Promise<EtaBatchEntry> => {
      try {
        // No `routes=`: the batch answers every route at every id, and a caller that wants fewer
        // applies `narrowEtasToRoutes` itself — see `stopEtas` above for why that is one rule.
        return { id, ...(await stopEtas(ds, id, undefined, ctbBudget)) }
      } catch (err) {
        // `etas: []` rather than an omitted field, because `EtaReport.etas` is required and making it
        // optional would be a change to `/v1/etas/{id}`'s own shape. The empty list carries no meaning
        // when `error` is set, and the schema says so at the field.
        return { id, etas: [], error: wireErrorOf(err) }
      }
    }),
  )
  return { reports }
}

/** GET /v1/route/:id — a route and its ordered stop list, each stop carrying the route's
 *  own next arrival there (ADR-030). KMB/LWB pull every stop's ETA in ONE upstream call
 *  (`route-eta`); CTB has no bulk route-eta endpoint (ADR-021) so it stays static-only. */
export async function routeDetail(ds: DatasetSource, id: string): Promise<RouteDetail> {
  // Same split as `requirePlace`: unparseable is the caller's fault, absent is nobody's, and
  // neither is worth retrying. `KMB:6:sideways:1` is a 400; `KMB:999X:outbound:1` is a 404.
  if (!parseRouteId(id)) throw badRequest(`not a route id: ${id}`)
  const doc = await ds.route(id)
  if (!doc) throw notFound(`unknown route: ${id}`)
  const { route } = doc

  // Live arrivals along the whole route, keyed by sequence (the route-eta feed identifies
  // stops only by `seq`). Coalesced like the stop boards (WP0-4): every direction and
  // service-type variant of a number reads the same upstream feed, so opening two route
  // screens for one number costs one call.
  //
  // **The degrade-to-static decision is at this call site now, not inside the cache** (ADR-073).
  // `coalesce` rejects; this one caller catches, because a route view without live times is still a
  // route view — the stop list, the geometry and the fares are all static — whereas erroring the
  // screen would lose them. That is a genuinely different answer from `/v1/etas`', which is why the
  // cache is no longer the one deciding it for both. The failure is still not cached, so the next
  // request retries.
  //
  // **And the catch now reports itself** (ADR-114). It used to swallow the failure completely, which
  // made an upstream outage indistinguishable from a quiet route — on KMB, where every rider is. The
  // comment that stood here said route detail had no failure field of its own, that WP5-13 owed it one,
  // and that "it should come from here". WP5-13 shipped without it; this is it, and it does come from
  // here — but not as the `EtaFailure[]` the other endpoints carry. A route is **one** upstream call, so
  // there is no per-pole granularity to report and inventing one would be a lie about the fetch.
  const etaBySeq = new Map<number, Eta>()
  let liveArrivals: RouteDetail['liveArrivals']
  if (route.operator === 'KMB' || route.operator === 'LWB') {
    const entries = await coalesce(`kmb-route-eta|${route.routeNo}|${route.serviceType}`, () =>
      fetchKmbRouteEta(route.routeNo, route.serviceType),
    ).catch(() => {
      liveArrivals = 'unavailable'
      return []
    })
    for (const entry of entries) {
      if (entry.eta.routeId === id && entry.eta.arrivals.length > 0) {
        etaBySeq.set(entry.seq, entry.eta)
      }
    }
  } else {
    // No bulk route-eta endpoint exists for this operator — Citybus publishes none (ADR-021) and GMB is
    // not wired — so this is not a failure and never will be one: it is a permanent property of the feed.
    // Their per-pole boards *do* answer, which is why the field names where the times are rather than
    // merely saying they are missing. Fanning out one call per pole to fetch them here was considered and
    // is a separate decision: a 34-stop route is 34 subrequests, every 30 s, per rider.
    liveArrivals = 'perStopOnly'
  }

  return {
    route,
    stops: doc.stops.map((s) => {
      const eta = etaBySeq.get(s.seq)
      return {
        seq: s.seq,
        stop: {
          id: s.id,
          name: s.name,
          location: { lat: s.lat, lng: s.lng },
          sources: [{ operator: s.operator, operatorStopId: s.stopId }],
        },
        // route-eta carries no stop id, so stamp the operator stop id we already know
        // (matching the raw-id convention the other ETA endpoints use).
        eta: eta ? withRemarkKind({ ...eta, stopId: s.stopId }) : null,
        fare: s.fare,
      }
    }),
    // Omitted when the round answered, which is the convention `failed` set: "every board answered" and
    // "we have nothing to say" must not be the same bytes on the wire.
    ...(liveArrivals === undefined ? {} : { liveArrivals }),
    ...(doc.reverse ? { reverse: doc.reverse } : {}),
  }
}
