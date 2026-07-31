// The id grammar — one parser and one formatter for every id string in the system.
//
// Every id in NextBus HK is a delimited string, and until this module existed each of the twelve
// places that needed a field out of one wrote its own `split(':')`. That is cheap to write and
// expensive to be wrong about, in a specific way: a `split` never fails. `stop.id.split(':')[0]`
// on a merged place id happily returns `"P"`, gets cast to `OperatorId`, and paints a pin in the
// fallback colour — no error, no test failure, just a wrong pixel nobody can trace back. So the
// point of this module is not tidiness; it is that a malformed id becomes **`null` at one place**
// instead of a plausible-looking wrong answer everywhere.
//
// Where the pieces live, and why they are not all in one package:
//   · The grammar itself is `packages/contract/src/ids/id-grammar.abnf` — ABNF, because the
//     artefact an iOS/Android port reads must not be TypeScript.
//   · The corpus is `packages/core/spec/ids.spec.json` — language-neutral rows. This
//     parser is hand-written and a Swift port will be hand-written too, so the corpus (not the
//     grammar file, and certainly not this file) is the mechanism that proves the two agree.
//     That is exactly ADR-052 decision (2)'s division: generated shapes get equivalence by
//     construction, hand-ported *rules* get it from a shared fixture corpus.
//   · The parser is here, in `core`, and not in `contract`, because `packages/core/src/eta.ts`
//     parses a route id — and `core` may not acquire a runtime dependency on `contract` (that is
//     gated by `scripts/check-type-only-contract.mjs`). `core` is the portable kernel; pure
//     string logic with no dependencies is precisely what belongs in it.
//
// House rules this module keeps:
//   · **Total functions.** Nothing here throws. Ids reach us from persisted rider state and from
//     URLs, so "unparseable" is ordinary input, not an exception.
//   · **Strict about delimiters, permissive inside a field.** `:`, `+` and `|` are structural and
//     can never appear inside a field; everything else printable can. Being stricter than that
//     would mean rejecting a real HK stop or route number we have not seen yet — the operators
//     mint those, not us — and the failure mode of over-strictness is a rider's saved favourite
//     going 404 on the strength of a grammar we wrote afterwards.
//   · **Shape, not vocabulary, for the operator.** See `OPERATOR_RE` below.

import type { Bound, OperatorId } from './types'

// ── The alphabet ────────────────────────────────────────────────────────────────────────────

/** Field separator inside a stop id (`KMB:123`) and a route id (`KMB:6:outbound:1`). */
const FIELD_SEP = ':'
/** Member separator inside a place id (`P:<a>+<b>`). */
const MEMBER_SEP = '+'
/** The two halves of a favourite key (`<stopId>|<routeId>`). */
const FAVORITE_SEP = '|'
/** Reserved prefix marking a merged same-kerb place. `P` is one character, and an operator code
 *  is at least two, so a place id can never be mistaken for a stop id (see `OPERATOR_RE`). */
const PLACE_PREFIX = `P${FIELD_SEP}`

/**
 * One field of an id: printable ASCII except space and the three structural characters
 * (`+` = %x2B, `:` = %x3A, `|` = %x7C). Mirrors `idchar` in the ABNF.
 *
 * Real values are much narrower than this — upper-case alphanumerics (`18492910339E23AA`,
 * `002403`, `680X`) — and the ABNF says so in a comment. The check stays wide on purpose: see the
 * permissiveness note in the header.
 */
const ID_CHAR_RE = /^[\x21-\x2a\x2c-\x39\x3b-\x7b\x7d-\x7e]+$/

/**
 * An operator code: an upper-case letter then 1–7 more upper-case letters or digits.
 *
 * This validates **shape, not vocabulary** — deliberately not `KMB|LWB|CTB|GMB`. ADR-052 decision
 * (4) requires that the day a fifth operator ships, a client that has never heard of it degrades
 * instead of breaking; a closed list here would turn every one of that operator's ids into `null`
 * and blank out its stops. A closed list would also be a *second* declaration of `OperatorId`,
 * whose one true home is the contract's zod enum.
 *
 * The consequence is stated plainly because it is a real cost: `parseStopId('XYZ:1').operator` is
 * typed `OperatorId` but may hold a code the union does not list. That cast lives here, once, with
 * this comment — rather than as `as OperatorId` at five call sites, which is what it replaced.
 */
const OPERATOR_RE = /^[A-Z][A-Z0-9]{1,7}$/

/**
 * The two directions. Unlike the operator code this vocabulary is **ours**: `toBound()` in
 * `@nextbus/data-normalize` mints it from the upstream `I`/`O`, so there is no third value an
 * operator can spring on us, and validating it is what lets `parseRouteId` return a typed `Bound`
 * instead of a string that hopefully is one.
 */
const BOUNDS = ['inbound', 'outbound'] as const satisfies readonly Bound[]

/**
 * Compile-time proof that `BOUNDS` lists **every** member of `Bound`.
 *
 * `satisfies` above catches a *wrong* entry; this catches a *missing* one, which is the failure
 * that would matter: add `'circular'` to the contract's `BoundSchema` and, without this,
 * `parseRouteId` would silently start returning `null` for every circular route. Purely
 * type-level, so it erases — `core` keeps its empty runtime dependency list.
 */
type Assert<T extends true> = T
type _BoundsAreExhaustive = Assert<
  [Exclude<Bound, (typeof BOUNDS)[number]>] extends [never] ? true : false
>

function isBound(value: string): value is Bound {
  return (BOUNDS as readonly string[]).includes(value)
}

// ── Parsed shapes ───────────────────────────────────────────────────────────────────────────

/** A single physical pole, e.g. `KMB:18492910339E23AA`. */
export interface StopIdParts {
  kind: 'stop'
  /** The id verbatim, so a caller can pass it straight on without re-formatting. */
  id: string
  /** See `OPERATOR_RE`: typed as the union, but tolerant of an operator we do not know yet. */
  operator: OperatorId
  /** The operator's own stop id — what the live ETA endpoints take. */
  rawId: string
}

/** A merged same-kerb place, e.g. `P:CTB:002403+KMB:18492910339E23AA`. N members, not two. */
export interface PlaceIdParts {
  kind: 'place'
  id: string
  /** Member poles **in the order the id lists them** — significant; see `formatPlaceId`. */
  members: StopIdParts[]
}

/** Either shape that `/v1/stop/:id` accepts. */
export type StopOrPlaceIdParts = StopIdParts | PlaceIdParts

/** A route direction, e.g. `KMB:6:outbound:1`. */
export interface RouteIdParts {
  operator: OperatorId
  routeNo: string
  bound: Bound
  /**
   * KMB/CTB: the operator's service type (`"1"`, `"2"` — numeric-looking, but a string; it is an
   * opaque label and arithmetic on it would be meaningless). GMB: the globally unique GTFS
   * `route_id`, folded into this slot because GMB numbers repeat across regions (ADR-047).
   */
  serviceType: string
}

/** A favourited route-at-stop pair (ADR-032), e.g. `KMB:18492910339E23AA|KMB:6:outbound:1`. */
export interface FavoriteRouteKeyParts {
  /**
   * The saved side. `kind: 'place'` means a key written under the **old** scheme: place ids are
   * derived from their members and churn whenever clustering does, which is why `SaveStar` now
   * saves the member pole. WP2-5's migration needs to *recognise* those, so this parses them
   * rather than rejecting them — and the discriminant is how it tells them apart.
   */
  stop: StopOrPlaceIdParts
  route: RouteIdParts
  /** The stop half verbatim — what a `Set.has()` lookup against persisted state needs. */
  stopId: string
  /** The route half verbatim. */
  routeId: string
}

// ── Parsers ─────────────────────────────────────────────────────────────────────────────────

/**
 * A canonical stop (pole) id: `<operator>:<rawId>`. `null` if it is anything else — including a
 * place id, which has more fields and a one-character prefix that cannot be an operator code.
 *
 * The **exactly two fields** rule is what makes stop ids and route ids tell each other apart by
 * shape alone, so `parseStopId('KMB:6:outbound:1')` is `null` rather than a stop at KMB pole `6`.
 *
 * @spec ids#parseStopId
 */
export function parseStopId(id: string): StopIdParts | null {
  const fields = id.split(FIELD_SEP)
  if (fields.length !== 2) return null
  // The length check above makes both elements present; the assertion is what stops
  // `noUncheckedIndexedAccess` demanding `?? ''` fallbacks that can never run. Dead branches matter
  // here beyond coverage: this module is hand-ported, and a porter would faithfully reproduce a
  // case that cannot happen.
  const [operator, rawId] = fields as [string, string]
  if (!OPERATOR_RE.test(operator) || !ID_CHAR_RE.test(rawId)) return null
  return { kind: 'stop', id, operator: operator as OperatorId, rawId }
}

/**
 * A merged place id: `P:` then one or more member stop ids joined by `+`.
 *
 * **One bad member invalidates the whole id.** The code this replaced did
 * `.slice(2).split('+').filter(Boolean)`, which quietly dropped empty members — and a place id
 * with a member dropped denotes a *different place*, so tolerating it means resolving a rider's
 * saved id to somewhere they did not save. A place of one is accepted although the dataset never
 * mints one (`buildPlaces` requires two): it is unambiguous, and a grammar that rejected it would
 * be making a claim about the clustering rules, which are not this module's business.
 *
 * @spec ids#parsePlaceId
 */
export function parsePlaceId(id: string): PlaceIdParts | null {
  if (!id.startsWith(PLACE_PREFIX)) return null
  const body = id.slice(PLACE_PREFIX.length)
  if (body === '') return null
  const members: StopIdParts[] = []
  for (const part of body.split(MEMBER_SEP)) {
    const member = parseStopId(part)
    if (!member) return null
    members.push(member)
  }
  return { kind: 'place', id, members }
}

/** Either id shape `/v1/stop/:id` accepts, discriminated by `kind`.  *
 * @spec ids#parseStopOrPlaceId
 */
export function parseStopOrPlaceId(id: string): StopOrPlaceIdParts | null {
  return parsePlaceId(id) ?? parseStopId(id)
}

/**
 * A canonical route id: `<operator>:<routeNo>:<bound>:<serviceType>`, e.g. `KMB:6:outbound:1` or
 * GMB's `GMB:19M:outbound:2003497`. Exactly four fields, and `bound` must be one of the two real
 * directions — a route id whose direction we cannot read is not usable for anything we do with it.
 *
 * @spec ids#parseRouteId
 */
export function parseRouteId(id: string): RouteIdParts | null {
  const fields = id.split(FIELD_SEP)
  if (fields.length !== 4) return null
  // See parseStopId: the length check makes the assertion sound and removes four dead branches.
  const [operator, routeNo, bound, serviceType] = fields as [string, string, string, string]
  if (!OPERATOR_RE.test(operator)) return null
  if (!ID_CHAR_RE.test(routeNo) || !ID_CHAR_RE.test(serviceType)) return null
  if (!isBound(bound)) return null
  return { operator: operator as OperatorId, routeNo, bound, serviceType }
}

/**
 * A favourite key: `<stopId>|<routeId>`.
 *
 * **The grammar encodes the route-at-stop tuple, which is more general than the name suggests** (D3).
 * The same pair is the identity of a *live reading*: `EtaRef` on the wire, and the key
 * `packages/core/src/live.ts` indexes readings by. That is a feature rather than a coincidence to be
 * tidied away — a Widget watching a saved favourite maps 1:1 onto a live target, so the two must not
 * drift into two spellings. The name stays `favorite` because ADR-062's stored-preferences migration
 * keys on it; renaming to a concept-level name would be a data migration wearing a refactor's clothes.
 *
 * **Exactly one `|`.** This is the one id form where the naive split is not merely untidy but
 * wrong: `key.split('|')` destructured into `[stopId, routeId]` on a key carrying two pipes
 * yields a perfectly plausible pair and silently discards the rest — a corrupt entry then reads
 * as a *valid* favourite for a route the rider never saved. Neither half may contain a `|`, so
 * two pipes means corruption, and the honest answer is `null`. (The same reasoning rules out
 * "split on the first `|`", which is what `favoriteRouteKey`'s doc comment used to suggest.)
 *
 * @spec ids#parseFavoriteRouteKey
 */
export function parseFavoriteRouteKey(key: string): FavoriteRouteKeyParts | null {
  const halves = key.split(FAVORITE_SEP)
  if (halves.length !== 2) return null
  // See parseStopId.
  const [stopId, routeId] = halves as [string, string]
  const stop = parseStopOrPlaceId(stopId)
  const route = parseRouteId(routeId)
  if (!stop || !route) return null
  return { stop, route, stopId, routeId }
}

/**
 * The member pole ids an id denotes: a place id's members, or the id itself for a lone pole.
 * The shape every "which poles do I fetch/compare?" call site actually wanted.
 *
 * The two edge cases are deliberate, and they preserve what the call sites did before:
 *   · A `P:`-prefixed string we cannot parse yields `[]` — it denotes no pole at all, and looking
 *     it up as a literal key would be looking up a string we know is not a pole id.
 *   · Anything else is passed through as one opaque id, *without* being validated. The lookup that
 *     follows decides whether it exists. Rejecting it here would let a grammar written today
 *     invalidate an id a rider saved yesterday that the dataset still resolves.
 *
 * @spec ids#memberStopIds
 */
export function memberStopIds(id: string): string[] {
  const place = parsePlaceId(id)
  if (place) return place.members.map((m) => m.id)
  if (id.startsWith(PLACE_PREFIX)) return []
  return [id]
}

// ── Formatters ──────────────────────────────────────────────────────────────────────────────
// The minting side of the same grammar. These are the only places an id string is built, so the
// grammar has one implementation per direction rather than one per call site. They trust their
// arguments (canonical fields from the dataset builder); the corpus round-trips them through the
// parsers, which is what proves the two directions agree.

/** `KMB` + `18492910339E23AA` → `KMB:18492910339E23AA`.  *
 * @spec ids#formatStopId
 */
export function formatStopId(operator: OperatorId, rawId: string): string {
  return `${operator}${FIELD_SEP}${rawId}`
}

/** `KMB`, `6`, `outbound`, `1` → `KMB:6:outbound:1`. Was `canonicalRouteId` in
 *  `@nextbus/data-normalize`, which now re-exports this so there is one template, not two.  *
 * @spec ids#formatRouteId
 */
export function formatRouteId(
  operator: OperatorId,
  routeNo: string,
  bound: Bound,
  serviceType: string,
): string {
  return `${operator}${FIELD_SEP}${routeNo}${FIELD_SEP}${bound}${FIELD_SEP}${serviceType}`
}

/**
 * Member ids → `P:<a>+<b>[+…]`.
 *
 * Member order is **taken as given, not sorted here.** The dataset builder sorts members by
 * `id.localeCompare(id)` before minting a place id, and that ordering is baked into every
 * already-published dataset and every id a rider has saved; re-sorting with a different
 * comparator here (a portable code-point sort, say) would mint a *different string* for the same
 * place and silently orphan those favourites. Changing the collation is therefore a migration,
 * not a formatting choice — noted for WP2-5, which already owns the id-scheme migration.
 *
 * @spec ids#formatPlaceId
 */
export function formatPlaceId(memberIds: readonly string[]): string {
  return `${PLACE_PREFIX}${memberIds.join(MEMBER_SEP)}`
}

/** A route-at-stop favourite key (ADR-032). `stopId` should be the **member pole** id, never the
 *  churning `P:` place id — see `FavoriteRouteKeyParts.stop`.
 *
 *  Also the identity of a live ETA reading: `packages/core/src/live.ts` keys readings with this, and
 *  `EtaRef` is the same tuple on the wire. One grammar for the pair, not two — see
 *  `parseFavoriteRouteKey`, and note the `|` is structural, which is what makes the key unambiguous
 *  where a `:`-joined one would collide with a route id's own fields.  *
 * @spec ids#formatFavoriteRouteKey
 */
export function formatFavoriteRouteKey(stopId: string, routeId: string): string {
  return `${stopId}${FAVORITE_SEP}${routeId}`
}
