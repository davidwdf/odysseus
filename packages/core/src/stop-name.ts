// Display rules for bus-stop and route-endpoint names. Upstream KMB names are ALL-CAPS English with
// a trailing operator stop code, e.g. "CITY ONE STATION (ST311)". We present them in title case with
// the code split out (rendered smaller/muted). CJK names are returned unchanged.
//
// These are presentation rules, not id rules: everything here reads a *name* a human will see, never
// a canonical id. Anything that takes `stopId`/`routeId` apart belongs in `./ids.ts` (ADR-059), and
// `scripts/check-no-adhoc-id-parsing.mjs` will say so.
//
// They live in `core` rather than the Expo app because they are the same rules on iOS and Android,
// and a title-caser hand-ported three times is three title-casers. `@spec stop-name#<export>` below
// means the corpus at `../spec/stop-name.spec.json` pins the rule for all three.

/**
 * HK transit acronyms / venue codes to keep upper-cased through title-casing. This is an
 * allowlist on purpose: in an ALL-CAPS source there's no safe way to tell an initialism
 * ("EKCC") from a real word that also appears parenthesised ("(CIRCULAR)"), so codes are
 * added explicitly as they surface rather than guessed.
 */
const KEEP_UPPER = new Set([
  'MTR',
  'KMB',
  'CTB',
  'LWB',
  'NLB',
  'GMB',
  'BBI',
  'HK',
  'PTI',
  'LRT',
  'EKCC',
])

/**
 * Minor words kept lower-case when *inside* a title (never the first word).
 * NB: "on" is deliberately absent — in HK stop names it's almost always the
 * romanised syllable 安 (On Tai, Tsz On, Hing On, Lok On Pai…), not the English
 * preposition, so it should title-case like any other place-name word.
 */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'to', 'at', 'in', 'for', 'by'])

// HK circular routes carry the loop marker in the destination name itself, e.g.
// "TAI KOK TSUI (CIRCULAR)" / "大角咀(循環線)" (ADR-046). We detect that and strip it so the
// UI can present a proper "Circular via …" treatment instead of a raw suffix.
const CIRCULAR_SUFFIX = /\s*[（(][^（()]*(?:circular|循環|循环)[^）)]*[)）]\s*$/i

/** Does a route destination name carry the circular-route marker?
 *
 * @spec stop-name#isCircular
 */
export function isCircular(name: string): boolean {
  return /circular|循環|循环/i.test(name)
}

/** Drop a trailing "(CIRCULAR)" / "(循環線)" marker: "Tai Kok Tsui (Circular)" → "Tai Kok Tsui".
 *
 * @spec stop-name#stripCircular
 */
export function stripCircular(name: string): string {
  return name.replace(CIRCULAR_SUFFIX, '').trim()
}

/** Split a trailing parenthesised stop code: "Foo Bar (ST311)" → { label: "Foo Bar", code: "ST311" }.
 *
 * @spec stop-name#splitStopCode
 */
export function splitStopCode(name: string): { label: string; code?: string } {
  const m = name.match(/^(.*\S)\s*\(([^()]+)\)\s*$/)
  if (m?.[1]) return { label: m[1], code: m[2] }
  return { label: name }
}

/**
 * Title-case an ALL-CAPS English name for display; leave anything that already has
 * lower-case, or has no Latin letters (CJK), unchanged. Known acronyms stay upper.
 * Heuristic — good enough for stop names, not a general-purpose title-caser.
 *
 * @spec stop-name#titleCaseName
 */
export function titleCaseName(name: string): string {
  if (!/[A-Z]/.test(name) || /[a-z]/.test(name)) return name
  let first = true
  return name.replace(/[A-Za-z][A-Za-z'’.]*/g, (w) => {
    const wasFirst = first
    first = false
    if (KEEP_UPPER.has(w.toUpperCase())) return w.toUpperCase()
    const lower = w.toLowerCase()
    // Minor words stay lower-case unless they lead the title.
    if (!wasFirst && SMALL_WORDS.has(lower)) return lower
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  })
}
