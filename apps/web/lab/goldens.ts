import type {
  EtaLabelParts,
  MapPin,
  PlaceDetailView,
  PlaceRouteRow,
  RailBus,
  RemarkView,
  RouteFactSheetView,
  RouteStopArrival,
  RouteStopRowView,
  RouteVehicle,
  SearchChip,
  SearchKeypad,
  StopCardName,
  StopCardView,
} from '@nextbus/core'
import etaCorpus from '@nextbus/core/spec/eta.spec.json'
import favouritesCorpus from '@nextbus/core/spec/favourites.spec.json'
import routeDetailCorpus from '@nextbus/core/spec/route-detail.spec.json'
import searchCorpus from '@nextbus/core/spec/search.spec.json'
import stopCardCorpus from '@nextbus/core/spec/stop-card.spec.json'
import stopDetailCorpus from '@nextbus/core/spec/stop-detail.spec.json'

/**
 * **Where every picture on the gallery comes from** — one accessor per corpus group, so a sample names a
 * *case* and never an object literal.
 *
 * This file used to be four helpers at the top of `samples.tsx`, and it moved out when the gallery grew
 * from three components to all of them (the owner's ask: *"find all the components … and render each one
 * in each state"*). The rule it enforces is the one ADR-150 states and is worth restating, because it is
 * what makes a gallery worth looking at:
 *
 * > A sample is only worth reviewing if it is the thing the app draws.
 *
 * So a state is either a **corpus golden** — the exact `expect` a conformance suite replays — or the
 * output of the **kernel call the screen makes**. Neither is a fixture written to make a component look
 * good. When a rule moves, these pictures move with it; when a case is renamed, `caseNamed` throws rather
 * than rendering something plausible, and `test/gallery-samples.test.tsx` turns that throw into a red build
 * the day it happens rather than the day somebody opens the page.
 *
 * ## The one thing that is *not* a golden, and why it is named
 *
 * A handful of samples sweep an axis a corpus does not enumerate — the eight compass octants, the operator
 * liveries, a glyph at three sizes. Those are **geometry and token tables**, not decisions: the octants are
 * `bearingOctantDeg`'s own quantisation and the liveries are `OPERATOR_ACCENT`'s own keys, so both are read
 * off the thing that owns them rather than typed out. Each such sample says so in its `how` line. What is
 * never done here is inventing an ETA, a stop name or a fare.
 *
 * ## The `null` → `undefined` boundary
 *
 * The corpus states an absent optional as JSON `null` because JSON has no `undefined`; TypeScript's absent
 * value is `undefined`. `fromCorpus` converts at the boundary exactly as `apps/web/test/corpus.ts` does —
 * one conversion, in one place, so a sample and the suite that measures the same component are reading the
 * same bytes the same way.
 */

export interface CorpusCase {
  name: string
  why?: string
  /** The call's arguments, where a sample needs an *input* as well as an answer (Search's query). */
  args?: unknown[]
  expect: unknown
}

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
export function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

/** Throws rather than rendering a plausible substitute: a renamed case must be loud. */
export function caseNamed(cases: readonly CorpusCase[], name: string): CorpusCase {
  const found = cases.find((c) => c.name === name)
  if (!found)
    throw new Error(`the corpus case \`${name}\` moved — the gallery sample points at nothing`)
  return found
}

/** A case's answer, at the TypeScript boundary. */
function expectOf<T>(cases: readonly CorpusCase[], name: string): T {
  return fromCorpus<T>(caseNamed(cases, name).expect)
}

// ── the groups, each named explicitly ───────────────────────────────────────────────────────────
//
// Property access rather than a `groups[name]` lookup, deliberately: a group that is renamed or removed is
// then a **typecheck** failure here rather than a runtime `undefined` that surfaces as a blank panel.

const STOP_CARD = stopCardCorpus.groups.stopCardView.cases as unknown as CorpusCase[]
const DISPLAY_NAME = stopCardCorpus.groups.displayName.cases as unknown as CorpusCase[]
const PLACE_DETAIL = stopDetailCorpus.groups.placeDetailView.cases as unknown as CorpusCase[]
const MERGE_PINS = stopDetailCorpus.groups.mergeCoincidentPins.cases as unknown as CorpusCase[]
const ROUTE_DETAIL = routeDetailCorpus.groups.routeDetailView.cases as unknown as CorpusCase[]
const ROUTE_FACT_SHEET = routeDetailCorpus.groups.routeFactSheet.cases as unknown as CorpusCase[]
const ROUTE_STOP_BOARD = routeDetailCorpus.groups.routeStopBoard.cases as unknown as CorpusCase[]
const ROUTE_VEHICLE = routeDetailCorpus.groups.routeVehicle.cases as unknown as CorpusCase[]
const ETA_READOUT = etaCorpus.groups.etaReadout.cases as unknown as CorpusCase[]
const ETA_LABEL_PARTS = etaCorpus.groups.etaLabelParts.cases as unknown as CorpusCase[]
const REMARK_VIEW = etaCorpus.groups.remarkView.cases as unknown as CorpusCase[]
const SEARCH_VIEW = searchCorpus.groups.searchView.cases as unknown as CorpusCase[]
const FAVOURITES_VIEW = favouritesCorpus.groups.favouritesView.cases as unknown as CorpusCase[]

// ── stop-card.spec.json ─────────────────────────────────────────────────────────────────────────

/** A whole `StopCardView` — the compact card Nearby and Favourites are lists of. */
export function card(name: string): StopCardView {
  return expectOf<StopCardView>(STOP_CARD, name)
}

/** One line off a card, for the leaf components a card is assembled from. */
export function cardRow(name: string, index = 0): StopCardView['rows'][number] {
  const row = card(name).rows[index]
  if (!row) throw new Error(`the corpus case \`${name}\` no longer has a row ${index} to draw`)
  return row
}

/**
 * The first line of a card at a given urgency band — found, never indexed.
 *
 * `stopCardView` caps its rows at the served `maxRows`, so an index into a card is an index into whatever
 * survived the cap: the first draft of the urgency sweep asked for row 8 of an 8-row card and threw. Asking
 * for the *band* is asking the question the panel is actually about, and it keeps working when the policy
 * that decides the cap moves.
 */
export function cardRowWhere(
  name: string,
  urgency: StopCardView['rows'][number]['urgency'],
): StopCardView['rows'][number] {
  const row = card(name).rows.find((r) => r.urgency === urgency)
  if (!row) throw new Error(`the corpus case \`${name}\` no longer reaches the \`${urgency}\` band`)
  return row
}

/** A split stop name — `displayName`'s answer, code and all (ADR-034). */
export function stopName(name: string): StopCardName {
  return expectOf<StopCardName>(DISPLAY_NAME, name)
}

// ── stop-detail.spec.json ───────────────────────────────────────────────────────────────────────

export function place(name: string): PlaceDetailView {
  return expectOf<PlaceDetailView>(PLACE_DETAIL, name)
}

/**
 * The first row of a place case, flat list or first kerb — the level a `PlaceRow` is drawn at.
 *
 * `placeDetailView` puts rows in exactly one of `rows` and `groups`, never both (a corpus property), so
 * looking in both is reading the shape rather than guessing at it.
 */
export function placeRow(name: string, index = 0): PlaceRouteRow {
  const view = place(name)
  const rows = view.rows.length > 0 ? view.rows : (view.groups[0]?.rows ?? [])
  const row = rows[index]
  if (!row) throw new Error(`the corpus case \`${name}\` no longer has a row ${index} to draw`)
  return row
}

/** A place's map pins, already folded by coordinate and labelled (ADR-087). */
export function placePins(name: string): MapPin[] {
  return place(name).pins
}

/** `mergeCoincidentPins`' own answers — the folding cases a place case does not reach. */
export function mergedPins(name: string): MapPin[] {
  return expectOf<MapPin[]>(MERGE_PINS, name)
}

// ── route-detail.spec.json ──────────────────────────────────────────────────────────────────────

/** One row of the route schematic. */
export function stopRow(name: string, index = 0): RouteStopRowView {
  const view = expectOf<{ stops: RouteStopRowView[] }>(ROUTE_DETAIL, name)
  const row = view.stops[index]
  if (!row) throw new Error(`the corpus case \`${name}\` no longer has a stop ${index} to draw`)
  return row
}

/**
 * The first row of a case that *has* an arrival, found rather than indexed.
 *
 * A case is pinned on one decision and the row that carries it moves as the fixture grows; a hard-coded
 * index would quietly start drawing an empty row while the case still passed its own suite.
 */
export function stopRowWithArrivals(name: string): RouteStopRowView {
  const view = expectOf<{ stops: RouteStopRowView[] }>(ROUTE_DETAIL, name)
  const row = view.stops.find((s) => s.arrivals.length > 0)
  if (!row) throw new Error(`the corpus case \`${name}\` no longer has a row with an arrival`)
  return row
}

/** The row a case pins a flag on — `here`, `saved`, `incomplete`. */
export function stopRowWhere(
  name: string,
  flag: 'here' | 'saved' | 'incomplete' | 'first' | 'last',
): RouteStopRowView {
  const view = expectOf<{ stops: RouteStopRowView[] }>(ROUTE_DETAIL, name)
  const row = view.stops.find((s) => s[flag] === true)
  if (!row) throw new Error(`the corpus case \`${name}\` no longer has a \`${flag}\` row`)
  return row
}

/** The buses a case puts on the rail. */
export function buses(name: string): RailBus[] {
  return expectOf<{ buses: RailBus[] }>(ROUTE_DETAIL, name).buses
}

/** A route's header — the two names `JourneyLines` draws and whether it loops. */
export function routeHeader(name: string): {
  origin: string
  destination: string
  circular: boolean
} {
  const header = expectOf<{
    header: { origin: string; destination: string; circular: boolean }
  }>(ROUTE_DETAIL, name).header
  return header
}

/** Which vehicle an operator runs — the kernel's word, never a component's guess. */
export function vehicle(name: string): RouteVehicle {
  return expectOf<RouteVehicle>(ROUTE_VEHICLE, name)
}

export function factSheet(name: string): RouteFactSheetView {
  return expectOf<RouteFactSheetView>(ROUTE_FACT_SHEET, name)
}

/** One pole's board for one route — what the action sheet shows (ADR-115). */
export function stopBoard(name: string): { arrivals: RouteStopArrival[]; incomplete: boolean } {
  return expectOf<{ arrivals: RouteStopArrival[]; incomplete: boolean }>(ROUTE_STOP_BOARD, name)
}

// ── eta.spec.json ───────────────────────────────────────────────────────────────────────────────

/** A reading as a renderer receives it: the figure, what it means, and how old the board is. */
export function readout(name: string): {
  label: EtaLabelParts
  urgency: RouteStopArrival['urgency']
  stale: boolean
} {
  return expectOf<{
    label: EtaLabelParts
    urgency: RouteStopArrival['urgency']
    stale: boolean
  }>(ETA_READOUT, name)
}

/** Just the figure and its unit — `etaLabelParts`' own answer. */
export function labelParts(name: string): EtaLabelParts {
  return expectOf<EtaLabelParts>(ETA_LABEL_PARTS, name)
}

/**
 * An operator remark, or `undefined` — **the absent arms are real states** and three of the six cases
 * reach them, which is why this returns the union rather than throwing on a null.
 */
export function remark(name: string): RemarkView | undefined {
  return expectOf<RemarkView | undefined>(REMARK_VIEW, name)
}

// ── search.spec.json ────────────────────────────────────────────────────────────────────────────

/** The filter chips a case yields — the set is the *index's*, never a hard-coded list (ADR-037). */
export function chips(name: string): SearchChip[] {
  return expectOf<{ chips: SearchChip[] }>(SEARCH_VIEW, name).chips
}

/** The keypad a case yields: which digits can lead anywhere, and which letters continue the prefix. */
export function keypad(name: string): SearchKeypad {
  return expectOf<{ keypad: SearchKeypad }>(SEARCH_VIEW, name).keypad
}

/**
 * The **query** a keypad case was computed against.
 *
 * A keypad without its prefix is half a state: the pad's dimming is a statement about what can follow
 * *this* query, so a panel showing one without the other would be showing an answer with its question
 * removed. Read off `args`, so the two cannot drift apart.
 */
export function query(name: string): string {
  const args = caseNamed(SEARCH_VIEW, name).args
  const input = (args?.[0] ?? {}) as { query?: string }
  return input.query ?? ''
}

// ── favourites.spec.json ────────────────────────────────────────────────────────────────────────

/** One saved card, from `favouritesView`. */
export function favouriteCard(name: string, index = 0): StopCardView {
  const cards = expectOf<StopCardView[]>(FAVOURITES_VIEW, name)
  const found = cards[index]
  if (!found) throw new Error(`the corpus case \`${name}\` no longer has a card ${index} to draw`)
  return found
}
