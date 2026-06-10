// On-device search index + pure search/keypad helpers (ADR-037). The edge ships a
// compact SearchIndex (every KMB/CTB route number + every stop/place); the app caches
// it and queries it locally, so the smart keypad gives instant valid-next-key feedback
// and route/stop search work offline. This is the first realization of the on-device
// index (ADR-007). Everything here is pure + platform-free so it's reusable + testable.

import type { Bound, I18nText, Locale, OperatorId } from './types'

/**
 * One searchable route, collapsed to a single record per (operator, route number,
 * direction) — riders search by number, not by the operator's service-type variants.
 * `id` is a representative canonical route id to navigate to.
 */
export interface RouteLite {
  id: string
  operator: OperatorId
  routeNo: string
  bound: Bound
  origin: I18nText
  destination: I18nText
}

/**
 * One searchable stop or same-kerb place. `id` is a canonical stop id
 * (`KMB:…`/`CTB:…`) or a merged place id (`P:…`) — both resolve in `/v1/stop/:id`.
 * Same-kerb pairs are pre-merged on the edge so they appear once.
 */
export interface StopLite {
  id: string
  name: I18nText
  lat: number
  lng: number
}

/** The compact static index shipped to the client for on-device search. */
export interface SearchIndex {
  /** Coarse content tag; the client redownloads when it changes. */
  version: string
  routes: RouteLite[]
  stops: StopLite[]
}

// ── Route classification (for the filter chips) ─────────────────────────────
// Derived purely from the route number — the categories HK riders actually filter
// by. A route can belong to several (e.g. `NA` is night + airport). Extensible:
// add a category here and a chip in the UI; operator chips are data-driven from the
// index (so GMB/MTR light up the moment those adapters land — ADR-037).

export type RouteCategory = 'night' | 'airport' | 'express'

/** Which categories a route number belongs to (possibly none). */
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

export function routeMatchesFilter(r: RouteLite, f: RouteFilter): boolean {
  if (f.operators.length && !f.operators.includes(r.operator)) return false
  if (f.categories.length) {
    const cats = routeCategories(r.routeNo)
    if (!f.categories.some((c) => cats.includes(c))) return false
  }
  return true
}

/** Operator code prefix of a stop/place id (`KMB:123` → `KMB`, `P:KMB:1+CTB:2` →
 *  the operators present). Used to apply the operator filter to stop results. */
export function stopMatchesOperators(stopId: string, operators: OperatorId[]): boolean {
  if (!operators.length) return true
  return operators.some((op) => stopId.includes(`${op}:`) || stopId.startsWith(`${op}:`))
}

// ── Smart keypad: a prefix trie over every route number ─────────────────────

export interface RouteTrieNode {
  children: Map<string, RouteTrieNode>
  /** True when the path to here is itself a complete route number. */
  terminal: boolean
}

function newNode(): RouteTrieNode {
  return { children: new Map(), terminal: false }
}

/** Build a prefix trie from route numbers (upper-cased). Drives `nextValidChars`. */
export function buildRouteTrie(routeNos: Iterable<string>): RouteTrieNode {
  const root = newNode()
  for (const raw of routeNos) {
    const no = raw.toUpperCase()
    let node = root
    for (const ch of no) {
      let next = node.children.get(ch)
      if (!next) {
        next = newNode()
        node.children.set(ch, next)
      }
      node = next
    }
    node.terminal = true
  }
  return root
}

function descend(root: RouteTrieNode, prefix: string): RouteTrieNode | null {
  let node = root
  for (const ch of prefix.toUpperCase()) {
    const next = node.children.get(ch)
    if (!next) return null
    node = next
  }
  return node
}

/** The set of characters that, appended to `prefix`, still lead to a real route. */
export function nextValidChars(root: RouteTrieNode, prefix: string): Set<string> {
  const node = descend(root, prefix)
  return new Set(node ? node.children.keys() : [])
}

/** Whether `prefix` is itself a complete route number (so submit is meaningful). */
export function isCompleteRoute(root: RouteTrieNode, prefix: string): boolean {
  return descend(root, prefix)?.terminal ?? false
}

/** The digits and letters that appear anywhere in the route numbers, so the keypad
 *  can render a stable layout of only the keys this dataset ever uses. */
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

/** Natural comparison of route numbers so "2" < "10" < "10A" < "10B" < "N10". */
export function compareRouteNo(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

/** Normalize a typed route query (keypad or text): trim + upper-case. */
export function normalizeRouteQuery(q: string): string {
  return q.trim().toUpperCase()
}

/**
 * Routes whose number begins with the (normalized) query and pass the filter,
 * naturally sorted by number then operator. The keypad guarantees the query is a
 * live prefix; the text path tolerates anything (empty → no results).
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
  out.sort((a, b) => compareRouteNo(a.routeNo, b.routeNo) || a.operator.localeCompare(b.operator))
  return out.slice(0, limit)
}

const fold = (s: string) => s.trim().toLowerCase()

/**
 * Stops/places whose name contains the query in any locale (so English or Chinese
 * input both work). Prefix matches rank above mid-string matches; ties keep index
 * order. Operator filter (if any) applies via the id.
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
