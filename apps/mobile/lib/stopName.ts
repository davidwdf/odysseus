// Display helpers for bus-stop names. Upstream KMB names are ALL-CAPS English with a
// trailing operator stop code, e.g. "CITY ONE STATION (ST311)". We present them in title
// case with the code split out (rendered smaller/muted). CJK names are returned unchanged.

/** HK transit acronyms to keep upper-cased through title-casing. */
const KEEP_UPPER = new Set(['MTR', 'KMB', 'CTB', 'LWB', 'NLB', 'GMB', 'BBI', 'HK', 'PTI', 'LRT'])

/** Minor words kept lower-case when *inside* a title (never the first word). */
const SMALL_WORDS = new Set(['of', 'the', 'and', 'to', 'at', 'in', 'on', 'for', 'by'])

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
