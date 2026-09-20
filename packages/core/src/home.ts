import { savedRows } from './favourites'
import { haversineMeters, walkMinutes } from './geo'
import { parseRouteId } from './ids'
import {
  displayName,
  type StopCardName,
  type StopCardOptions,
  type StopCardRow,
  type StopCardView,
  stopCardCaption,
} from './stop-card'
import type { BoardPlace, LatLng, OperatorId, StopDetail } from './types'

/**
 * **Home's board** — the merge of Nearby and Favourites into one screen
 * (`docs/proposals/07`).
 *
 * ## Why this is a merge and not a bigger list
 *
 * Put the two published specs side by side and **five of their seventeen states are an apology the other
 * screen could have answered**: Nearby's `undetermined`, `denied`, `locationError` and `loading` are a
 * permission prompt and grey bars while every saved place sits live on the next tab, and Favourites'
 * `empty` is an onboarding sentence while the six stops the rider is standing next to sit on the previous
 * one. Four of those five are the first thing a new rider ever sees. A merged board is the only shape in
 * which *"I do not know where you are"* and *"you have not saved anything"* are both non-events — with no
 * fix, {@link HomeSections.saved} is the whole screen; with nothing saved, {@link HomeSections.nearby} is.
 *
 * ## One card shape, and the owner's suggestion is what made it one
 *
 * A {@link HomeCard} is: a place, then **the routes the rider saved here with their readings**, then
 * **everything else at this place as chips with no readings at all**. A discovery card is that same card
 * with nothing saved yet.
 *
 * The draft had two shapes — saved places carried times, nearby places carried none — and the open worry
 * was whether the seam would read as two lists stapled together. Putting the chip strip on saved places
 * too dissolves it: the halves stop being different objects. It also says something true that neither old
 * shape did — *these are the routes you chose, and this is everything else that stops here.*
 *
 * **Why the discovery half carries no times.** Not tidiness: we do not know which of a stop's twenty-six
 * routes a rider wants, so choosing three and hiding twenty-three behind a "+N more" is a guess wearing an
 * answer's clothes. A chip strip claims nothing and hides nothing — which is also why the cap that the
 * old Nearby card needed disappears from this half entirely.
 *
 * ## The ranking, in one line
 *
 * > **Saved outranks near. Due-soon outranks far.**
 *
 * A saved place is **never** demoted for being distant, and that is the owner's second occasion made
 * structural: *"check when the next bus is coming before leaving the office"* is a question about a place
 * the rider is deliberately **not** at, so the distance is the reason they are asking rather than a reason
 * to fold the row away. Within the saved section the next departure decides the order; distance stays in
 * the caption, where it already was.
 *
 * ## Three sections, exclusive
 *
 * A place appears **once**. {@link HomeSections.catch} is the saved places with something the rider can
 * still make (see {@link CatchBand}); {@link HomeSections.saved} is the rest of their list; and
 * {@link HomeSections.nearby} is everything around them that is not already above. Exclusivity is what
 * keeps the board scannable — a card in two sections is a rider reading the same place twice and
 * wondering what the difference is.
 */

/** A route at a place drawn as a badge with **no reading** — the chip strip's unit. */
export interface HomeChip {
  routeId: string
  operator: OperatorId
  /** The number on the chip; the whole id when it cannot be parsed, as `stopCardView` does. */
  routeNo: string
}

/**
 * One place on Home — **a `StopCardView`, plus the strip**.
 *
 * Extending rather than restating is what lets one component draw it: `StopCard` already renders a
 * heading, a caption and a list of rows against `stop-row.spec.json`, and `home.spec.json` declares each
 * of its cards to *be* a `StopRow`. A parallel card type would have made that claim a comment.
 *
 * `rows` is the rider's saved routes here, soonest first — empty on a place they have saved nothing at —
 * and `remaining` is therefore always **0**: nothing is hidden among the rows, because the rows are the
 * rider's own choices and Home does not cap those. What is not a saved row is in `chips`.
 */
export interface HomeCard extends StopCardView {
  rows: StopCardRow[]
  /**
   * Where the place is — so the board and the map draw the same set.
   *
   * `StopCardView` has never carried it because no screen that renders one needed it; Home does, and
   * building the pins from the *cards* rather than from the raw payloads is what stops the map and the
   * list disagreeing about which places exist. The route screen makes the same argument about its
   * markers: a hexagon on the map and a circle in the list are two claims about one stop.
   */
  location: LatLng
  /**
   * The other routes at this place that the card **draws**, in the wire's order, with no readings —
   * capped at {@link HOME_CHIPS_COLLAPSED}.
   *
   * Capped here rather than in the view, and for `stopCardView`'s reason: *"show the first N and count
   * the rest"* is arithmetic over rows, and a renderer that did it would be a second declaration of the
   * number. It also makes the published spec exact — a slot can say *these chips* and be checked,
   * where "the first six of these" is not something the conformance format can express.
   */
  chips: HomeChip[]
  /** The rest of them, for the strip's expansion. Empty when nothing is hidden. */
  moreChips: HomeChip[]
  /**
   * Routes at this place beyond `chips` — the honest remainder, never a silent filter.
   *
   * **Zero on every card served by `/v1/board`** (ADR-179), which sends each place's complete line-up —
   * so the strip is whole and the "+N" badge has nothing to hide. It is non-zero only against
   * `/v1/nearby`, which publishes a place's readings and a `routeCount` but not its route list: there
   * the chips are the lines among the readings and this is everything else. Both are honest; one is
   * complete. The field stays because the rule has to hold for either input, and because a total should
   * have one name on this wire rather than sometimes being a length.
   */
  chipsMore: number
}

/** The three sections, in board order. Each may be empty; all three empty is a screen with no data. */
export interface HomeSections {
  /**
   * **What the board is anchored on** — the name of the nearest place, for the chrome to say where the
   * rider is.
   *
   * A field rather than something a renderer reads off `nearby[0]`, and the difference is the rule: *the
   * nearest* is an ordering decision, `homeView` is what made it, and a view indexing into a sorted list
   * to recover it would be selecting a row — which `check-no-derivation` bans and which would quietly
   * disagree the day the order changed.
   *
   * Absent without a position, and absent with a position but nothing around it. Both are honest: a card
   * that named a place we had not measured to would be claiming a fix we do not have.
   *
   * 🟡 **A stop name, not a locality.** *"Near Pak Hoi Street"* is the most this can say today, because
   * nothing in the app reverse-geocodes. LandsD publishes a gazetteer and the honest upgrade is to use
   * it — *"Yau Ma Tei"* is what a rider would say — which is filed rather than guessed at here.
   */
  anchor?: StopCardName
  /** Saved, and still catchable. Empty without a position — see {@link CatchBand}. */
  catch: HomeCard[]
  /** The rest of the rider's list, at any distance, soonest first. */
  saved: HomeCard[]
  /** What is around them, nearest first, minus anything already above. */
  nearby: HomeCard[]
}

export interface HomeInput {
  /** The saved `${poleId}|${routeId}` keys — the store's list, verbatim. */
  saved: readonly string[]
  /** The resolved places for those poles. One that has not resolved is simply absent. */
  places: readonly StopDetail[]
  /**
   * The places around the rider, in whatever order they arrived.
   *
   * `/v1/board`'s answer (ADR-179), whose places carry their complete line-up — but typed so
   * `/v1/nearby`'s do too, because a `NearbyStop` **is** a `BoardPlace` with `lines` absent. That is
   * what makes the endpoint swap boring: it changes which arm of `nearbyCard` runs and nothing else.
   */
  nearby: readonly BoardPlace[]
  /**
   * Where the rider is, when we know.
   *
   * **Home measures a saved place and Favourites does not**, and the difference is real rather than an
   * inconsistency: `favouritesView` drops the distance half of its caption because a list opened from
   * anywhere has nothing to measure from, and Home — which is anchored on a fix — does. Absent, every
   * saved card loses its distance and `catch` is empty.
   */
  at?: LatLng
}

/**
 * How many chips a card shows before its "+N" badge.
 *
 * **The kernel's number, not the view's.** "Show the first N and count the rest" is arithmetic over rows,
 * which `check-no-derivation` bans in a renderer and which `stopCardView` already owns for its own
 * overflow. *Expanding* the strip is a rider's tap — interaction, not a domain rule — so that half is
 * legitimately the view's, and the view needs no arithmetic to do it: it shows all of `chips`.
 *
 * Six is two lines on a phone, which shows most of an ordinary stop without a tap and leaves a real
 * interchange with a badge. A served knob if it ever needs to differ by client; a constant until then.
 */
export const HOME_CHIPS_COLLAPSED = 6

/** Minutes of slack at or above which a catchable bus is `comfortable` rather than `tight`. */
export const CATCH_TIGHT_UNDER_MIN = 3

/**
 * The whole of Home, in one call.
 *
 * @spec home#homeView
 */
export function homeView(input: HomeInput, opts: StopCardOptions): HomeSections {
  const savedKeys = new Set(input.saved)

  // Saved places, de-duplicated and in save order — `getStop` promotes a member pole to its place, so
  // grouping by the resolved place id is the wire's answer rather than this function's guess. Two poles
  // of one interchange are one card, which is `favouritesView`'s rule and the reason it groups by place.
  const seen = new Set<string>()
  const savedCards: HomeCard[] = []
  for (const detail of input.places) {
    const placeId = detail.stop.id
    if (seen.has(placeId)) continue
    seen.add(placeId)
    savedCards.push(savedCard(detail, savedKeys, input.at, opts))
  }

  // Nearest first, which is `nearbyView`'s rule: the wire promises no sequence, so iterating the response
  // as received produces a different list — and only sometimes, which is the failure a byte-identity
  // check exists for. Sorted on a copy; the response belongs to the query cache.
  const nearbyCards = [...input.nearby]
    .sort((a, b) => a.distanceM - b.distanceM)
    .filter((n) => !seen.has(n.stop.id))
    .map((n) => nearbyCard(n, opts))

  // **Exclusive, and the split is by the card rather than by the row.** A place with one catchable route
  // and two that have already gone is still a place worth walking to, so the whole card moves up and each
  // row says for itself whether it can be made.
  const catchCards = savedCards.filter((c) => c.rows.some((r) => r.catch !== undefined))
  const rest = savedCards.filter((c) => !c.rows.some((r) => r.catch !== undefined))

  return {
    // The nearest place, read off the list this function has just ordered — so the chrome and the board
    // cannot disagree about which one it is.
    ...(nearbyCards[0] === undefined ? {} : { anchor: nearbyCards[0].name }),
    catch: [...catchCards].sort(compareBySoonest),
    saved: [...rest].sort(compareBySoonest),
    nearby: nearbyCards,
  }
}

/** A saved place: the rider's routes here with readings, then the rest of the place as chips. */
function savedCard(
  detail: StopDetail,
  savedKeys: ReadonlySet<string>,
  at: LatLng | undefined,
  opts: StopCardOptions,
): HomeCard {
  const rows = savedRows(detail.routes, savedKeys, opts)
  const savedIds = new Set(rows.map((r) => r.routeId))
  // Straight-line from the rider to the place, which is the same measure `/v1/nearby` reports and the
  // same one `walkMinutes` is calibrated against — so a saved place that is also nearby reads the same
  // distance from either source rather than two numbers a metre apart.
  const distanceM = at === undefined ? undefined : haversineMeters(at, detail.stop.location)
  const walk = distanceM === undefined ? undefined : walkMinutes(distanceM)

  return {
    stopId: detail.stop.id,
    location: detail.stop.location,
    name: displayName(detail.stop.name[opts.locale]),
    caption: stopCardCaption(distanceM, detail.stop.bearingDeg, opts.locale),
    ...(detail.stop.bearingDeg === undefined ? {} : { bearingDeg: detail.stop.bearingDeg }),
    rows: rows.map((row) => withCatch(row, walk)),
    // Always zero: the rows are the rider's own choices at this place and Home does not cap those.
    // Everything that is not a saved row is a chip, and `chipsMore` is that half's honest remainder.
    remaining: 0,
    // Everything at the place that is not already a row above it. De-duplicated by route id, because a
    // line boarding at two kerbs is two entries in `routes` and one badge in a strip that carries no
    // kerb — the same collapse `stopCardView` makes for a card with no per-kerb heading.
    ...split(
      chipsOf(
        detail.routes.map((r) => ({ routeId: r.route.id, operator: r.route.operator })),
        savedIds,
      ),
      // The strip is complete here: `StopDetail.routes` is every line at every kerb.
      0,
    ),
    incomplete: (detail.failed ?? []).length > 0,
  }
}

/**
 * A place the rider is near and has saved nothing at: no rows, and the best strip the wire supports.
 *
 * **Two arms, and which one runs is the endpoint's answer rather than a decision here.** `/v1/board`
 * sends `lines` — every route at the place — so the strip is complete and `chipsMore` falls out at
 * zero. `/v1/nearby` sends only a count, so the strip is the lines among the readings and `chipsMore`
 * is the honest remainder. The rule is one sentence either way — *chips are the lines we know of;
 * `chipsMore` is everything else* — which is why moving Home onto the new endpoint needed no change
 * to it, and why a client still on the old one degrades rather than breaks.
 */
function nearbyCard(n: BoardPlace, opts: StopCardOptions): HomeCard {
  const all = chipsOf(n.lines ?? n.etas, NOTHING_EXCLUDED)
  return {
    stopId: n.stop.id,
    location: n.stop.location,
    name: displayName(n.stop.name[opts.locale]),
    caption: stopCardCaption(n.distanceM, n.stop.bearingDeg, opts.locale),
    ...(n.stop.bearingDeg === undefined ? {} : { bearingDeg: n.stop.bearingDeg }),
    rows: [],
    remaining: 0,
    ...split(all, Math.max(0, n.routeCount - all.length)),
    incomplete: (n.failed ?? []).length > 0,
  }
}

/**
 * Split a place's line-up into what the card draws and what its badge stands for.
 *
 * `unknown` is what the **wire** could not give — `/v1/nearby` sends a count and not a list, so its
 * remainder is real and a tap on the place is the only way to see it. It is added to what the cap hid,
 * because a rider cannot act on the difference and two badges reading "+6" and "+20" beside each other
 * is arithmetic asked of the wrong person.
 *
 * Both sides of that sum are **rider lines**, which is the trap `stopCardView`'s own note records:
 * `routeCount` counts `operator|route|bound` once however many kerbs a line boards at, so counting
 * per-pole readings against it would understate what is hidden. Floored at zero rather than trusted — a
 * stale static index can publish a count below what the live board answers with, and a negative
 * remainder would render as a badge promising routes that do not exist.
 */
function split(all: HomeChip[], unknown: number) {
  const chips = all.slice(0, HOME_CHIPS_COLLAPSED)
  const moreChips = all.slice(HOME_CHIPS_COLLAPSED)
  return { chips, moreChips, chipsMore: moreChips.length + Math.max(0, unknown) }
}

/** A discovery card excludes nothing: it has no rows for a chip to duplicate. */
const NOTHING_EXCLUDED: ReadonlySet<string> = new Set()

/**
 * **The chip strip: one badge per rider line, in the order it was given, minus anything already a row.**
 *
 * One function for both halves of the board, taking the *lines* rather than the shape they arrived in —
 * a saved card passes `StopDetail.routes` and a discovery card passes the place's readings. They were two
 * loops for a while and the duplication showed itself the way it always does: the same
 * `parseRouteId(...) ?? id` fallback written twice, one of which no case reached.
 *
 * **The de-duplication is the rule, not a tidy-up.** Since WP5-9 the wire publishes one reading per line
 * *per boarding pole*, and `StopDetail.routes` lists a line once per kerb too — so a line at two kerbs
 * arrives twice. A strip carries no kerb, so two identical badges would ask a rider to choose between
 * them and give them nothing to choose with, which is the same collapse `stopCardView` makes for a card
 * with no per-kerb heading. It is also what keeps `chipsMore` honest: `routeCount` counts lines, so the
 * subtraction needs lines on the other side of it.
 */
function chipsOf(
  lines: readonly { routeId: string; operator: OperatorId }[],
  exclude: ReadonlySet<string>,
): HomeChip[] {
  const chips: HomeChip[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const id = line.routeId
    if (exclude.has(id) || seen.has(id)) continue
    seen.add(id)
    chips.push({
      routeId: id,
      operator: line.operator,
      // The whole id when the grammar cannot read it — `stopCardView`'s own fallback, so an unreadable
      // id still shows a rider something rather than an empty badge.
      routeNo: parseRouteId(id)?.routeNo ?? id,
    })
  }
  return chips
}

/**
 * The band, or no band.
 *
 * The arithmetic is `arrival − walk`, and it happens exactly once, here. Only a row carrying a **figure**
 * can be banded: `due` means the bus is at the kerb and a walk cannot be started, a headway is a timetable
 * rather than a sighting, and a dash is nothing at all.
 */
function withCatch(row: StopCardRow, walk: number | undefined): StopCardRow {
  if (walk === undefined || row.label.kind !== 'mins') return row
  const slack = row.label.value - walk
  if (slack < 0) return row
  return { ...row, catch: slack < CATCH_TIGHT_UNDER_MIN ? 'tight' : 'comfortable' }
}

/**
 * Cards by their soonest saved row.
 *
 * Read off the row rather than off a hidden sort key, because `savedRows` has already put the soonest
 * first — so `saved[0]` *is* the card's answer, and a second ordering here could only disagree with it.
 * A card whose rows are all dashes sorts last; a card with no rows at all sorts after that, which cannot
 * happen on a saved card and is defined anyway so the comparator is total.
 */
function compareBySoonest(a: HomeCard, b: HomeCard): number {
  return soonestMinutes(a) - soonestMinutes(b)
}

function soonestMinutes(card: HomeCard): number {
  const row = card.rows[0]
  if (row === undefined) return Number.MAX_SAFE_INTEGER
  if (row.label.kind === 'due') return 0
  if (row.label.kind === 'mins') return row.label.value
  // A timetable outranks a dash, and both outrank an empty card — the same three tiers `savedRows`
  // sorts rows into, applied one level up so a card cannot claim a place its rows do not support.
  return row.label.kind === 'headway' ? Number.MAX_SAFE_INTEGER - 2 : Number.MAX_SAFE_INTEGER - 1
}
