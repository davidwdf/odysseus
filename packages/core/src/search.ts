// On-device search index + pure search/keypad helpers (ADR-037). The edge ships a
// compact SearchIndex (every KMB/CTB route number + every stop/place); the app caches
// it and queries it locally, so the smart keypad gives instant valid-next-key feedback
// and route/stop search work offline. This is the first realization of the on-device
// index (ADR-007). Everything here is pure + platform-free so it's reusable + testable.

// The three wire shapes below are `z.infer` of the schemas in `@nextbus/contract` — the single
// declaration, imported type-only so nothing reaches the runtime graph (ADR-052). See `types.ts`.
import type { RouteLiteSchema, SearchIndexSchema, StopLiteSchema } from '@nextbus/contract'
import type { z } from 'zod'
// `searchView` (at the foot of this file) composes the two name rules every other surface uses. Imported
// under local aliases because this module's own exports are the *search* rules, and a reader looking for
// `displayName` should be sent to the module that declares it.
import { displayName as displayNameOf } from './stop-card'
import { titleCaseName as titleCaseNameOf } from './stop-name'
import type { Locale, OperatorId } from './types'

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the
// one kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to
// Swift and Kotlin and the corpus is the only thing keeping the ports equal. Change a rule and you
// edit the corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

/**
 * One searchable route, collapsed to a single record per (operator, route number,
 * direction) — riders search by number, not by the operator's service-type variants.
 * `id` is a representative canonical route id to navigate to.
 */
export type RouteLite = z.infer<typeof RouteLiteSchema>

/**
 * One searchable stop or same-kerb place. `id` is a canonical stop id
 * (`KMB:…`/`CTB:…`) or a merged place id (`P:…`) — both resolve in `/v1/stop/:id`.
 * Same-kerb pairs are pre-merged on the edge so they appear once.
 */
export type StopLite = z.infer<typeof StopLiteSchema>

/** The compact static index shipped to the client for on-device search. */
export type SearchIndex = z.infer<typeof SearchIndexSchema>

// ── Route classification (for the filter chips) ─────────────────────────────
// Derived purely from the route number — the categories HK riders actually filter
// by. A route can belong to several (e.g. `NA` is night + airport). Extensible:
// add a category here and a chip in the UI; operator chips are data-driven from the
// index (so GMB/MTR light up the moment those adapters land — ADR-037).

export type RouteCategory = 'night' | 'airport' | 'express'

/**
 * Which categories a route number belongs to (possibly none).
 *
 * @spec search#routeCategories
 */
export function routeCategories(routeNo: string): RouteCategory[] {
  const n = routeNo.toUpperCase()
  const out: RouteCategory[] = []
  // Night services lead with N (N121, N691, NA…). Airport/Lantau buses are the
  // A/E/NA/S families. Express variants carry an X (269X, 270X, X1).
  if (/^N/.test(n)) out.push('night')
  if (/^(A|NA|E|S)\d/.test(n)) out.push('airport')
  if (n.includes('X')) out.push('express')
  return out
}

/** Active search filter. Empty arrays = no restriction on that axis. The two axes
 *  AND together; selections within an axis OR together. */
export interface RouteFilter {
  operators: OperatorId[]
  categories: RouteCategory[]
}

export const EMPTY_FILTER: RouteFilter = { operators: [], categories: [] }

/**
 * @spec search#routeMatchesFilter
 */
export function routeMatchesFilter(r: RouteLite, f: RouteFilter): boolean {
  if (f.operators.length && !f.operators.includes(r.operator)) return false
  if (f.categories.length) {
    const cats = routeCategories(r.routeNo)
    if (!f.categories.some((c) => cats.includes(c))) return false
  }
  return true
}

/** Operator code prefix of a stop/place id (`KMB:123` → `KMB`, `P:KMB:1+CTB:2` →
 *  the operators present). Used to apply the operator filter to stop results.
 *
 * @spec search#stopMatchesOperators
 */
export function stopMatchesOperators(stopId: string, operators: OperatorId[]): boolean {
  if (!operators.length) return true
  return operators.some((op) => stopId.includes(`${op}:`) || stopId.startsWith(`${op}:`))
}

// ── Smart keypad: range scans over a sorted array of route numbers ──────────
//
// This was a prefix trie until ADR-063. A trie is the textbook answer and it was not wrong, but
// it is a *structure* — three platforms each build their own, and nothing compares them. A sorted
// array of the same strings holds the identical information as **data**: every route number
// sharing a prefix is contiguous, so "which keys can still be pressed" is a range, and a range is
// found with a binary search over a byte comparison. That is a rule two people can port without
// agreeing on a data structure first.

/**
 * Every route number the keypad can reach: upper-cased, de-duplicated and **byte-sorted**.
 *
 * `.sort()` with no comparator is UTF-16 code-unit order, which for the `[0-9A-Z]` alphabet route
 * numbers actually use is the same order Swift's `<` and Kotlin's `compareTo` produce. That
 * agreement is the whole reason the array can replace the trie — see `routeSortKey` for the same
 * argument applied to *display* order, where it is much less obvious.
 *
 * @spec search#routeKeys
 */
export function routeKeys(routeNos: Iterable<string>): string[] {
  const keys = new Set<string>()
  for (const raw of routeNos) {
    const no = raw.toUpperCase()
    // A blank route number used to walk no characters and so marked the trie's ROOT terminal,
    // which made `isCompleteRoute(root, '')` true and told the keypad that submitting an empty
    // query was meaningful. The array form cannot reproduce that exact defect, but a blank still
    // has no business in the key space: it is a prefix of everything, so it would make the whole
    // index the answer to a query nobody typed. The edge emits none today and nothing rejects one.
    if (no === '') continue
    keys.add(no)
  }
  return [...keys].sort()
}

/** First index whose key is ≥ `target` — the range scan's only primitive. */
function lowerBound(keys: readonly string[], target: string): number {
  let lo = 0
  let hi = keys.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((keys[mid] as string) < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The set of characters that, appended to `prefix`, still lead to a real route.
 *
 * The scan is linear over the matching range rather than binary-searching each child, because the
 * widest range is the whole index (~3,700 numbers) at the empty prefix, it runs once per
 * keystroke, and the caller memoizes it. Cleverness here would buy microseconds and cost a reader.
 *
 * @spec search#nextValidChars
 */
export function nextValidChars(keys: readonly string[], prefix: string): Set<string> {
  const p = prefix.toUpperCase()
  const out = new Set<string>()
  for (let i = lowerBound(keys, p); i < keys.length; i++) {
    const key = keys[i] as string
    // Sorted order is what makes stopping sound: once a key has lost the prefix, no later one
    // can carry it. This is the fact the trie encoded as pointers.
    if (!key.startsWith(p)) break
    if (key.length > p.length) out.add(key[p.length] as string)
  }
  return out
}

/**
 * Whether `prefix` is itself a complete route number (so submit is meaningful).
 *
 * The empty prefix answers false without a special case, because `routeKeys` keeps blanks out of
 * the array — the guard lives in one place rather than two.
 *
 * @spec search#isCompleteRoute
 */
export function isCompleteRoute(keys: readonly string[], prefix: string): boolean {
  const p = prefix.toUpperCase()
  return keys[lowerBound(keys, p)] === p
}

/** The digits and letters that appear anywhere in the route numbers, so the keypad
 *  can render a stable layout of only the keys this dataset ever uses.
 *
 * @spec search#indexAlphabet
 */
export function indexAlphabet(routeNos: Iterable<string>): { digits: string[]; letters: string[] } {
  const digits = new Set<string>()
  const letters = new Set<string>()
  for (const no of routeNos) {
    for (const ch of no.toUpperCase()) {
      if (ch >= '0' && ch <= '9') digits.add(ch)
      else if (ch >= 'A' && ch <= 'Z') letters.add(ch)
    }
  }
  return {
    digits: [...digits].sort(),
    letters: [...letters].sort(),
  }
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Digits per numeric run in a `sortKey`. Four is ten times the widest run any Hong Kong route
 * number carries (`901`, `1272`), so in practice every key is the human-readable form the plan
 * asks for: `10A` → `0010A`. Longer runs stay *correct* rather than merely tolerated — see
 * `routeSortKey`.
 */
const SORT_KEY_DIGITS = 4

/** Byte comparison — the one ordering every language already agrees on. */
function byBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * A byte-comparable sort key for a route number: `10A` → `0010A`, so `9` < `10A` < `11`.
 *
 * This exists because `localeCompare(numeric: true)` — the obvious way to get 2 before 10 — has no
 * faithful Swift or Kotlin equivalent. `compare(options: .numeric)` and a hand-rolled Kotlin
 * natural comparator each have their own opinion about mixed digit/letter runs, so the same index
 * would render in three different orders on three platforms and nothing would catch it. Zero-pad
 * every digit run instead and the order stops being a *computation* and becomes a *property of the
 * string*, decided once here and checked by the corpus.
 *
 * Upper-casing replaces the old `sensitivity: 'base'`, so `10a` and `10A` still key identically.
 * Leading zeros vanish into the padding, so an upstream `007` cannot become a second identity.
 *
 * **Overflow.** A digit run longer than `SORT_KEY_DIGITS` is prefixed with one `~` per extra
 * digit instead of being padded. `~` (U+007E) sorts after every digit and every upper-case letter,
 * so a longer run always sorts after a shorter one and equal-length runs compare lexically — which
 * for equal lengths *is* numeric order. The key stops being pretty at five digits; it does not
 * stop being right, which matters because the input is upstream data we do not control.
 *
 * @spec search#routeSortKey
 */
export function routeSortKey(routeNo: string): string {
  const n = routeNo.toUpperCase()
  let out = ''
  let i = 0
  while (i < n.length) {
    const ch = n[i] as string
    if (ch < '0' || ch > '9') {
      out += ch
      i++
      continue
    }
    let j = i
    while (j < n.length && (n[j] as string) >= '0' && (n[j] as string) <= '9') j++
    const run = n.slice(i, j)
    out +=
      run.length > SORT_KEY_DIGITS
        ? '~'.repeat(run.length - SORT_KEY_DIGITS) + run
        : run.padStart(SORT_KEY_DIGITS, '0')
    i = j
  }
  return out
}

/**
 * Natural comparison of route numbers so "2" < "10" < "10A" < "10B" < "N10".
 *
 * Now a byte comparison of two sort keys rather than a collator call. Prefer the precomputed
 * `RouteLite.sortKey` where you have one — this is for the cases that only have a number.
 *
 * @spec search#compareRouteNo
 */
export function compareRouteNo(a: string, b: string): number {
  return byBytes(routeSortKey(a), routeSortKey(b))
}

/** The edge's precomputed key, or the identical value derived here (ADR-063). */
function sortKeyOf(r: RouteLite): string {
  return r.sortKey ?? routeSortKey(r.routeNo)
}

/**
 * Normalize a typed route query (keypad or text): trim + upper-case.
 *
 * @spec search#normalizeRouteQuery
 */
export function normalizeRouteQuery(q: string): string {
  return q.trim().toUpperCase()
}

/**
 * Routes whose number begins with the (normalized) query and pass the filter,
 * naturally sorted by number then operator. The keypad guarantees the query is a
 * live prefix; the text path tolerates anything (empty → no results).
 *
 * The order comes from `RouteLite.sortKey` when the edge sent one, which is what lets the
 * displayed order be changed by a dataset publish rather than by three client releases (ADR-063).
 *
 * @spec search#searchRoutes
 */
export function searchRoutes(
  routes: readonly RouteLite[],
  query: string,
  filter: RouteFilter = EMPTY_FILTER,
  limit = 60,
): RouteLite[] {
  const q = normalizeRouteQuery(query)
  const out = routes.filter(
    (r) =>
      (q === '' ? false : r.routeNo.toUpperCase().startsWith(q)) && routeMatchesFilter(r, filter),
  )
  // Two byte comparisons, no collator on either axis: the operator tiebreak was a `localeCompare`
  // too, and it had exactly the same problem in a smaller font.
  out.sort((a, b) => byBytes(sortKeyOf(a), sortKeyOf(b)) || byBytes(a.operator, b.operator))
  return out.slice(0, limit)
}

const fold = (s: string) => s.trim().toLowerCase()

/**
 * Stops/places whose name contains the query in any locale (so English or Chinese
 * input both work). Prefix matches rank above mid-string matches; ties keep index
 * order. Operator filter (if any) applies via the id.
 *
 * @spec search#searchStops
 */
export function searchStops(
  stops: readonly StopLite[],
  query: string,
  locale: Locale,
  operators: OperatorId[] = [],
  limit = 60,
): StopLite[] {
  const q = fold(query)
  if (q === '') return []
  const scored: Array<{ s: StopLite; rank: number }> = []
  for (const s of stops) {
    if (!stopMatchesOperators(s.id, operators)) continue
    // Match against the active locale first, then the others, so a Chinese rider
    // and an English rider both find the stop regardless of UI language.
    const candidates = [s.name[locale], s.name.en, s.name['zh-Hant'], s.name['zh-Hans']]
    let rank = -1
    for (const name of candidates) {
      if (!name) continue
      const folded = fold(name)
      const at = folded.indexOf(q)
      if (at === 0) {
        rank = 2 // prefix match — best
        break
      }
      if (at > 0) rank = Math.max(rank, 1) // contains
    }
    if (rank >= 0) scored.push({ s, rank })
  }
  scored.sort((a, b) => b.rank - a.rank)
  return scored.slice(0, limit).map((x) => x.s)
}

// ── The whole Search screen, in one call (WP6-5) ───────────────────────────────────────────────
//
// Everything above is a *rule*; `searchView` is the **composition** of those rules into the thing a
// renderer draws, and it exists for the reason WP4-0 built `stopCardView` and WP6-3a built
// `placeDetailView`: until now the composition lived in `apps/mobile/app/search.tsx`, reachable only by
// rendering a React tree, so a second renderer could only re-implement it. Concretely, that screen was
// deciding: which operator chips exist at all (from the index, so a fifth operator lights up the day its
// adapter lands — ADR-037), which chips a mode shows, which of them are on, which route numbers the keypad
// keeps live under the active filter, which letters its letter row offers, what a saved *recent* resolves
// to now that the index has been rebuilt, and whether the list is showing a search or a history. Seven
// decisions, none of them presentation.
//
// **Words are injected, never imported** (ADR-054: core owns the rule, the catalogue owns the word). A chip
// carries its own label because the label is what a renderer draws and the *set* is what the kernel decides;
// splitting them would put the two halves of one chip in two places.

/** One filter chip: what it filters on, what it is called, and whether it is on. */
export interface SearchChip {
  /**
   * Stable identity — `operator:KMB`, `category:night`. Opaque by construction and **never taken apart**:
   * the screen used to key its toggles on a string it then `split(':')`, which read exactly like ad-hoc id
   * parsing and was flagged by the gate that bans it. A key that is never split cannot be split wrongly.
   */
  key: string
  label: string
  active: boolean
}

/** One route in the result list: the chip, and where it runs, both ends title-cased. */
export interface SearchRouteRow {
  /** The canonical route id to open. */
  id: string
  operator: OperatorId
  routeNo: string
  /** "Tin Shui Wai Town Centre", title-cased — the renderer supplies the arrow between them. */
  origin: string
  destination: string
}

/** One stop in the result list, with its printed code split off (ADR-034). */
export interface SearchStopRow {
  id: string
  name: { label: string; code?: string }
}

/** Which list a mode shows, and therefore which row shape a renderer draws. */
export type SearchList =
  | { kind: 'routes'; routes: SearchRouteRow[] }
  | { kind: 'stops'; stops: SearchStopRow[] }

/** Where the rows came from — a search, the rider's history, or nothing at all. */
export type SearchSource = 'results' | 'recents' | 'none'

export interface SearchViewInput {
  index: SearchIndex
  mode: 'routes' | 'stops'
  /** The query for the active mode. Empty means "show me what I looked at before". */
  query: string
  filter: RouteFilter
  /** Saved ids, most-recent first — the store's lists, verbatim. */
  recentRouteIds: readonly string[]
  recentStopIds: readonly string[]
}

/** The words this view composes with, supplied by the caller's catalogue. */
export interface SearchLabels {
  operator: (operator: OperatorId) => string
  category: (category: RouteCategory) => string
}

export interface SearchViewOptions {
  locale: Locale
  labels: SearchLabels
}

/** What a renderer needs to draw the Search screen, with nothing left to decide. */
export interface SearchView {
  /** The chips to draw, in order: every operator in the index, then the categories a mode filters by. */
  chips: SearchChip[]
  /** The keypad's live keys and its letter row, both narrowed by the active filter. */
  keypad: { keys: string[]; letters: string[] }
  list: SearchList
  source: SearchSource
}

/**
 * The Search screen's content, derived once.
 *
 * @spec search#searchView
 */
export function searchView(input: SearchViewInput, opts: SearchViewOptions): SearchView {
  const { index, mode, query, filter } = input
  const { locale, labels } = opts

  // **Which operator chips exist is the index's answer, not a hard-coded list** (ADR-037): a fifth operator
  // lights up the day its adapter lands, with no UI change. Sorted so the row does not reorder itself as
  // the dataset is rebuilt.
  const operators = [...new Set(index.routes.map((route) => route.operator))].sort()
  const operatorChips: SearchChip[] = operators.map((operator) => ({
    key: `operator:${operator}`,
    label: labels.operator(operator),
    active: filter.operators.includes(operator),
  }))
  const categoryChips: SearchChip[] = ROUTE_CATEGORIES.map((category) => ({
    key: `category:${category}`,
    label: labels.category(category),
    active: filter.categories.includes(category),
  }))
  // Stops have no route number, so a *category* cannot narrow them — only an operator can. Showing a
  // dimmed-but-present night-bus chip over a stop list would offer a filter that does nothing.
  const chips = mode === 'routes' ? [...operatorChips, ...categoryChips] : operatorChips

  // **The keypad and the result list are narrowed by the same filter**, so a dimmed key and an absent row
  // always agree about what is findable. Two lists over one filtered set rather than two filtered sets.
  const findable = index.routes
    .filter((route) => routeMatchesFilter(route, filter))
    .map((route) => route.routeNo)
  const keypad = { keys: routeKeys(findable), letters: indexAlphabet(findable).letters }

  const searching = query !== ''
  const list: SearchList =
    mode === 'routes'
      ? {
          kind: 'routes',
          routes: (searching
            ? searchRoutes(index.routes, query, filter)
            : // **A recent is resolved against the index, and one the index no longer has is dropped.** The
              // dataset is rebuilt daily and a route can leave it, so a saved id is a *reference* rather
              // than a record — keeping the id and rendering a blank row is the failure this avoids, and
              // silently dropping it is right because the rider's next search will simply not offer it.
              resolve(input.recentRouteIds, index.routes)
          ).map((route) => routeRow(route, locale)),
        }
      : {
          kind: 'stops',
          stops: (searching
            ? searchStops(index.stops, query, locale, filter.operators)
            : resolve(input.recentStopIds, index.stops)
          ).map((stop) => ({ id: stop.id, name: displayNameOf(stop.name[locale]) })),
        }

  const rows = list.kind === 'routes' ? list.routes.length : list.stops.length
  return {
    chips,
    keypad,
    list,
    // Three states, not two: a query that matched nothing is **not** the same screen as no query at all,
    // and the copy differs (`searchNoResults` versus the recents heading). Collapsing them would tell a
    // rider who mistyped that they have no history.
    source: rows === 0 ? (searching ? 'none' : 'recents') : searching ? 'results' : 'recents',
  }
}

/** The categories a route list can be filtered by, in chip order. */
const ROUTE_CATEGORIES: readonly RouteCategory[] = ['night', 'airport', 'express']

/** Saved ids → the records the index still has for them, in save order. */
function resolve<T extends { id: string }>(ids: readonly string[], records: readonly T[]): T[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  return ids.flatMap((id) => {
    const found = byId.get(id)
    return found === undefined ? [] : [found]
  })
}

function routeRow(route: RouteLite, locale: Locale): SearchRouteRow {
  return {
    id: route.id,
    operator: route.operator,
    routeNo: route.routeNo,
    // Title-cased here rather than in the row, because the feeds shout and they do not agree with each
    // other about it (ADR-034) — and because the arrow between these two is the renderer's literal, so
    // handing it two finished strings is what stops two renderers composing the pair differently.
    origin: titleCaseNameOf(route.origin[locale]),
    destination: titleCaseNameOf(route.destination[locale]),
  }
}
