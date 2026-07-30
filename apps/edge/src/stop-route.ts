import {
  type Bound,
  classifyRemark,
  dedupeEtas,
  type Eta,
  parseRouteId,
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
import { badRequest, notFound } from './errors'
import { coalesce } from './eta-cache'

// Per-place CTB fan-out budget (ADR-042). KMB poles cost ONE call each (`stop-eta` returns
// every route), so only CTB — which has no per-stop endpoint — needs bounding; this guards a
// pathological interchange. Routes beyond it are still counted (static) and shown on the
// Place page. The default is generous (≈ "all" in practice); Nearby passes a smaller one.
const DEFAULT_CTB_BUDGET = 24

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

/** Distinct CTB route numbers at one member pole, in document order. */
function ctbRoutesAt(place: PlaceDoc, memberId: string): string[] {
  const seen = new Set<string>()
  for (const r of place.routes) {
    if (r.stopId === memberId) seen.add(r.route.routeNo)
  }
  return [...seen]
}

/**
 * Raw (call-deduped, not yet rider-deduped) ETAs across every member pole of a place
 * (ADR-042). Each KMB or GMB pole is ONE stop-board call (all its routes); CTB is per-route,
 * bounded by a per-place budget. Members and CTB routes are fetched concurrently.
 *
 * Every upstream call goes through `coalesce` (WP0-4), so a pole is fetched **once per 30 s
 * per isolate** no matter how many places, requests or concurrent callers want it: the
 * distinct call keys below are exactly the upstream calls this function can issue.
 * The GMB *raw* board is what's cached — the mapping to canonical ids uses the place's own
 * resolution table, so a cached board can't outlive the build that resolved it.
 */
async function memberEtaLists(place: PlaceDoc, ctbBudget = DEFAULT_CTB_BUDGET): Promise<Eta[]> {
  const tasks: Array<Promise<Eta[]>> = []
  let ctbRemaining = ctbBudget
  // A pole can appear twice in one member list (an overlapping caller, a malformed doc);
  // dedupe here so the budget isn't spent on a repeat we'd only coalesce away.
  const polesSeen = new Set<string>()
  for (const m of place.members) {
    if (polesSeen.has(m.id)) continue
    polesSeen.add(m.id)
    if (m.operator === 'CTB') {
      for (const routeNo of ctbRoutesAt(place, m.id)) {
        if (ctbRemaining <= 0) break
        ctbRemaining--
        // CTB has no per-stop board (ADR-021), so the call key is per (pole, route).
        const key = `CTB-eta|${m.stopId}|${routeNo}|1`
        tasks.push(
          atPole(
            m.id,
            coalesce(key, () => fetchEta('CTB', m.stopId, routeNo, '1'), []),
          ),
        )
      }
    } else if (m.operator === 'GMB') {
      // GMB: one stop-board call returns every route at this pole (like KMB); the edge
      // resolves its raw route_id/seq to our canonical ids (ADR-047).
      const gmbLive = place.gmbLive ?? {}
      const raw = coalesce<GmbEtaEntry[]>(
        `gmb-board|${m.stopId}`,
        () => fetchGmbStopEta(m.stopId),
        [],
      )
      tasks.push(
        atPole(
          m.id,
          raw.then((entries) => gmbEtasFrom(entries, gmbLive)),
        ),
      )
    } else {
      // KMB/LWB: one call returns every route at this pole. Both operators read the same
      // KMB `stop-eta` board, so the pole id alone is the call key.
      tasks.push(
        atPole(
          m.id,
          coalesce<Eta[]>(`kmb-board|${m.stopId}`, () => fetchKmbStopEta(m.stopId), []),
        ),
      )
    }
  }
  const lists = await Promise.all(tasks)
  return lists.flat().filter((e) => e.arrivals.length > 0)
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
 */
function atPole(poleId: string, etas: Promise<Eta[]>): Promise<Eta[]> {
  return etas.then((list) => list.map((e) => ({ ...e, stopId: poleId })))
}

/** The rider-facing line an `Eta` belongs to. `dedupeEtas` collapses on exactly this, so it is
 *  the key that still matches when a live reading's service-type variant isn't the one the static
 *  data lists at this pole. */
const lineKey = (operator: string, routeId: string): string => {
  // Must agree with `dedupeEtas` exactly — including on an id it cannot parse, where both fall
  // back to keying on the whole id so an odd reading dedupes only against its own twin.
  const line = parseRouteId(routeId)
  return line ? `${operator}|${line.routeNo}|${line.bound}` : `${operator}|${routeId}`
}

/**
 * `${routeId}|${rawStopId}` → the boarding fare there, plus route → destination. Both are
 * precomputed into the place document, so stamping costs no extra lookup.
 *
 * Destinations are indexed by **route id and by rider line**. The exact id can miss: a KMB
 * stop-board returns every service-type variant at the pole, `dedupeEtas` keeps whichever is
 * soonest, and that variant may not be the one the static data lists here. Falling back to
 * operator+number+direction — the same key `dedupeEtas` collapses on — keeps "→ destination" on
 * the card instead of dropping it for exactly the readings a rider is most likely to see.
 */
function stampTables(place: PlaceDoc) {
  // Keyed on the **canonical** pole id, which is what `place.routes[].stopId` already carries and what a
  // reading now carries too (see `atPole`). This map used to convert each row's canonical id back to the
  // operator's own, via a `memberById` lookup, purely because readings arrived spelled that way — one
  // conversion deleted rather than a second one added.
  const fareByRouteAndPole = new Map<string, string>()
  const destinationByRoute = new Map<string, PlaceDoc['name']>()
  const destinationByLine = new Map<string, PlaceDoc['name']>()
  for (const r of place.routes) {
    destinationByRoute.set(r.route.id, r.route.destination)
    const line = lineKey(r.route.operator, r.route.id)
    if (!destinationByLine.has(line)) destinationByLine.set(line, r.route.destination)
    if (r.fare) fareByRouteAndPole.set(`${r.route.id}|${r.stopId}`, r.fare)
  }
  return { fareByRouteAndPole, destinationByRoute, destinationByLine }
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
 * (`dedupeEtas`), soonest first. The single source every `Eta[]`-returning endpoint
 * (`/v1/nearby`, `/v1/etas`) flows through — so the API is consistently de-duplicated
 * and the frontend never re-dedupes. (`/v1/stop` returns the full route *list* with
 * per-route ETAs; its list-level collapse is the client's `dedupeRoutes`.)
 */
export async function stopArrivals(
  place: PlaceDoc,
  ctbBudget = DEFAULT_CTB_BUDGET,
): Promise<Eta[]> {
  const all = dedupeEtas(await memberEtaLists(place, ctbBudget))
  const { fareByRouteAndPole, destinationByRoute, destinationByLine } = stampTables(place)
  // Stamp each reading with its route's destination + boarding fare so flat ETA lists can show
  // "→ dest · $6.7" without the full Route object (ADR-036). Readings arrive carrying their canonical
  // pole id (`atPole`), which is the id both tables above are keyed on.
  return all
    .map((e) => {
      const destination =
        destinationByRoute.get(e.routeId) ?? destinationByLine.get(lineKey(e.operator, e.routeId))
      const fare = fareByRouteAndPole.get(`${e.routeId}|${e.stopId}`)
      const stamped = withRemarkKind(e)
      if (!destination && !fare) return stamped
      return { ...stamped, ...(destination ? { destination } : {}), ...(fare ? { fare } : {}) }
    })
    .sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))
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

  const etaByRouteId = new Map<string, Eta>()
  for (const e of await memberEtaLists(place)) etaByRouteId.set(e.routeId, withRemarkKind(e))

  return {
    stop: toMergedStop(place),
    // `stopId` records which member pole each route departs from, so the Place screen can
    // group routes under their pole (ADR-042).
    routes: place.routes.map((r) => ({
      route: toRouteSummary(r.route),
      eta: etaByRouteId.get(r.route.id) ?? null,
      fare: r.fare,
      stopId: r.stopId,
    })),
    members: place.members.map((m) => ({
      id: m.id,
      name: m.name,
      location: { lat: m.lat, lng: m.lng },
    })),
  }
}

/** GET /v1/etas/:id — flat ETA list for a stop or merged place (optionally route-filtered). */
export async function stopEtas(ds: DatasetSource, id: string, routeIds?: string[]): Promise<Eta[]> {
  const place = await requirePlace(ds, id)

  const all = await stopArrivals(place)
  if (!routeIds?.length) return all
  const wanted = new Set(routeIds)
  return all.filter((e) => wanted.has(e.routeId))
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
  // screens for one number costs one call. A failure degrades to a static-only route view —
  // `coalesce` resolves to `[]` and doesn't cache the failure — rather than erroring the screen.
  const etaBySeq = new Map<number, Eta>()
  if (route.operator === 'KMB' || route.operator === 'LWB') {
    const entries = await coalesce(
      `kmb-route-eta|${route.routeNo}|${route.serviceType}`,
      () => fetchKmbRouteEta(route.routeNo, route.serviceType),
      [],
    )
    for (const entry of entries) {
      if (entry.eta.routeId === id && entry.eta.arrivals.length > 0) {
        etaBySeq.set(entry.seq, entry.eta)
      }
    }
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
    ...(doc.reverse ? { reverse: doc.reverse } : {}),
  }
}
