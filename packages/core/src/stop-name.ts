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

import type { I18nText, Locale } from './types'

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
 * The characters a rider cannot see a difference in, for comparing two pole names.
 *
 * An **explicit list rather than `normalize('NFKC')`**, and that is a portability decision: NFKC would
 * make the hand-port depend on a whole Unicode table agreeing across three languages, while this list is
 * inspectable and corpus-pinnable. It covers the ASCII/CJK pairs the feed actually mixes — the
 * ideographic space `　`, full-width and CJK punctuation beside their ASCII twins, and the three
 * dashes upstream uses interchangeably.
 */
const INVISIBLE_IN_A_NAME = /[\s　,，、.。'’\-‐–—/／()（）]/g

/**
 * A pole name folded to what a rider could actually see a difference in. **Compared, never displayed.**
 *
 * This exists because the difference between two names is the honest way to tell two identically-headed
 * poles apart (WP5-12), and a **byte** comparison would ship a lie: measured over build
 * `ceb33eed99461e04`, 16 colliding groups in `en` and 6 in `zh-Hant` differ *only* by case, punctuation
 * width or an ideographic space — `Ching Tin Estate` / `CHING TIN ESTATE`,
 * `Bonham Road, near Hospital Road` / `Bonham Road near Hospital Road`,
 * `昭信路, 近煜明苑煒明閣` / `昭信路，近煜明苑煒明閣`. A rule keyed on bytes would call those distinct,
 * print the same words twice, and claim the ambiguity had been resolved — precisely what
 * `poleSideOctants` refuses to do with a compass word it cannot support.
 *
 * `toLowerCase` and not `toLocaleLowerCase`: the locale-aware form is banned in this package (the host's
 * locale would decide the answer, so it could not be pinned by a fixture — ADR-063 learned this for the
 * search index) and no name in this dataset contains a character whose case folding is locale-dependent.
 *
 * @spec stop-name#poleNameKey
 */
export function poleNameKey(label: string): string {
  return label.toLowerCase().replace(INVISIBLE_IN_A_NAME, '')
}

/**
 * What a printed operator flag code looks like: Latin letters then digits, and nothing else.
 *
 * Two letters minimum and two digits minimum, which is the shape every real one has (`MK356`, `ED522`,
 * `YT956`). The gate is what makes borrowing one from another locale safe, and it was measured rather
 * than guessed: of the 63 poles in build `ceb33eed99461e04` whose `en` name carries no parenthetical
 * while a Chinese one does, **51 are this shape and 12 are not** — the 12 being translated place
 * phrases, and 167 poles carry trailing parentheticals that *disagree* across locales for exactly that
 * reason (`CTB:001027` is `(Macao Ferry)` in English and `(港澳碼頭)` in Chinese). One letter is
 * excluded deliberately: `TAI LAM TUNNEL BBI (A5)` names an interchange, not a pole.
 */
const FLAG_CODE = /^[A-Za-z]{2,4}\d{2,5}$/

/** Every locale, in the order a borrow tries them. Fixed, so three platforms agree on the answer. */
const LOCALE_ORDER: readonly Locale[] = ['en', 'zh-Hant', 'zh-Hans']

/**
 * The operator's own flag code for this pole, in the locale a heading is printed in — **borrowing one
 * from another locale when this one has none and the other's is flag-shaped.**
 *
 * The borrow is WP5-12's answer to the lead its own row named: at Prince Edward Station two KMB poles
 * sit at the *same* coordinate and read `PRINCE EDWARD STATION, MONG KOK POLICE STATION` in English
 * while the Chinese reads `…（MK356）` and `…（MK357）`. So the code that tells them apart exists, on the
 * wire, and only the English label lacks it. A code is Latin letters and digits, which makes it
 * locale-neutral **by construction** — it is what is printed on the physical flag — so showing the
 * Chinese one to an English reader is not a translation, it is the same string.
 *
 * The active locale's own parenthetical is used **verbatim whatever its shape**, which is today's
 * behaviour preserved: a rider reading `(Macao Ferry)` is reading what upstream wrote for them. Only the
 * *borrow* is gated on `FLAG_CODE`, because a borrowed translated phrase would be a Chinese place name
 * appearing in an English heading.
 *
 * Measured before shipping: the borrow creates **zero** new colliding heading groups in any locale, no
 * group that gets a compass side loses one, and 12 groups in `en` stop colliding entirely. Two of those
 * lose a compass suffix they had — a strict improvement (a code on the flag beats a compass word) that
 * will read as a regression to anyone diffing screenshots without this paragraph.
 *
 * @spec stop-name#poleFlagCode
 */
export function poleFlagCode(name: I18nText, locale: Locale): string | undefined {
  const own = splitStopCode(name[locale]).code
  if (own !== undefined) return own
  for (const other of LOCALE_ORDER) {
    if (other === locale) continue
    const code = splitStopCode(name[other]).code
    if (code !== undefined && FLAG_CODE.test(code)) return code
  }
  return undefined
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
