// Display helpers for bus-stop names. Upstream KMB names are ALL-CAPS English with a
// trailing operator stop code, e.g. "CITY ONE STATION (ST311)". We present them in title
// case with the code split out (rendered smaller/muted). CJK names are returned unchanged.

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

/** Does a route destination name carry the circular-route marker? */
export function isCircular(name: string): boolean {
  return /circular|循環|循环/i.test(name)
}

/** Drop a trailing "(CIRCULAR)" / "(循環線)" marker: "Tai Kok Tsui (Circular)" → "Tai Kok Tsui". */
export function stripCircular(name: string): string {
  return name.replace(CIRCULAR_SUFFIX, '').trim()
}

/** Split a trailing parenthesised stop code: "Foo Bar (ST311)" → { label: "Foo Bar", code: "ST311" }. */
export function splitStopCode(name: string): { label: string; code?: string } {
  const m = name.match(/^(.*\S)\s*\(([^()]+)\)\s*$/)
  if (m?.[1]) return { label: m[1], code: m[2] }
  return { label: name }
}

/**
 * Title-case an ALL-CAPS English name for display; leave anything that already has
 * lower-case, or has no Latin letters (CJK), unchanged. Known acronyms stay upper.
 * Heuristic — good enough for stop names, not a general-purpose title-caser.
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
