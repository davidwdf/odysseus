import type { I18nText, Locale, OperatorId } from '@nextbus/core'
import { CATALOGUE, type MessageKey, SUPPORTED_LOCALES } from './catalogue'
import { formatMessage, type MessageArgs } from './icu'

export { CATALOGUE, DEFAULT_LOCALE, type MessageKey, SUPPORTED_LOCALES } from './catalogue'
export { argumentNames, pluralArgument, validateMessage } from './icu'

/**
 * A string that has been through the localization layer.
 *
 * The brand exists because `string` is the type of both "Routes" and `t(locale, 'routesAtStop')`,
 * and only one of those is correct in a Chinese UI. Before this, the only thing standing between a
 * hard-coded English literal and a shipped screen was review: `OPERATOR_LABEL` in
 * `app/stop/[id].tsx` put "Citybus" into an otherwise Chinese sentence for a year, and
 * `GlassIconButton`'s `accessibilityLabel = 'Back'` default leaked English to a screen reader every
 * time a caller omitted it. Neither was a type error. Both are now.
 *
 * Nothing constructs a `LocalizedString` except this module, so it cannot be forged by a cast that
 * a reviewer would wave through — `t()` is the only ordinary way in, and the two documented escape
 * hatches below (`endonym`, `localeRecord`) are named for what they are.
 *
 * It stays assignable **to** `string`, which is what keeps the change small: every existing
 * `t(locale, key)` call site still type-checks, and a branded value can still be passed to a React
 * Native prop typed `string`. The asymmetry is the whole mechanism — `LocalizedString` goes
 * anywhere `string` does, and a bare literal goes nowhere a `LocalizedString` is required.
 */
declare const localized: unique symbol
export type LocalizedString = string & { readonly [localized]: 'i18n' }

/** Trim, at the type level, so `{n, plural, …}`'s argument name survives the comma split. */
type Trim<S extends string> = S extends ` ${infer R}`
  ? Trim<R>
  : S extends `${infer R} `
    ? Trim<R>
    : S

/**
 * Reject anything that is not a bare identifier. Scanning a template-literal type for `{…}` also
 * turns up the *insides* of plural branches (`one{# stop`), so this filter is what separates an
 * argument name from a fragment of sub-message. `validateMessage` in ./icu.ts bans the one shape
 * this cannot see through — a placeholder nested inside a plural branch — so the two agree.
 */
type Identifier<S extends string> = S extends '' | `${string}${' ' | '#' | '{' | '}'}${string}`
  ? never
  : S

/** The argument names appearing in an ICU message, extracted from the literal type itself. */
type ArgumentNames<S extends string> = S extends `${string}{${infer Body}}${infer Rest}`
  ?
      | (Body extends `${infer Name},${string}` ? Identifier<Trim<Name>> : Identifier<Trim<Body>>)
      | ArgumentNames<Rest>
  : never

type ArgsOf<K extends MessageKey> = ArgumentNames<(typeof CATALOGUE)[K]['en']>

/**
 * Keys that take no arguments — the type to use for a key held in a variable or a lookup table
 * (`ComingSoon`'s `titleKey`, `search.tsx`'s `CATEGORY_LABELS`, `faq.tsx`'s `ITEMS`).
 *
 * A plain `MessageKey` in those positions would be unusable: the union's arguments are the union of
 * every message's arguments, so `t()` would demand `{n, place, s}` for a key that is in fact
 * `'tabNearby'`. Naming the argument-free subset keeps the indirection those screens rely on and
 * makes it a compile error to route a parameterised message through a table that cannot supply
 * arguments.
 */
export type PlainMessageKey = {
  [K in MessageKey]: [ArgsOf<K>] extends [never] ? K : never
}[MessageKey]

/** `t()`'s third parameter: required exactly when the message has placeholders, and typed by name. */
type ArgsParam<K extends MessageKey> = [ArgsOf<K>] extends [never]
  ? []
  : [args: Record<ArgsOf<K>, string | number>]

/**
 * Read a message. The only ordinary source of a `LocalizedString`.
 *
 * Arguments are checked by name against the ICU text, so the two hand-rolled
 * `t(locale, key).replace('{n}', …)` call sites this replaced cannot come back: `.replace()` on a
 * `LocalizedString` returns a plain `string`, which no longer satisfies a branded prop.
 */
export function t<K extends MessageKey>(
  locale: Locale,
  key: K,
  ...args: ArgsParam<K>
): LocalizedString {
  const message = CATALOGUE[key][locale]
  return formatMessage(message, locale, (args[0] ?? {}) as MessageArgs) as LocalizedString
}

/**
 * One message in all three locales, in the `Record<Locale, string>` shape the `TileSource` port
 * wants for its attribution (`packages/ports`). The escape hatch is the shape, not the provenance —
 * the strings still come from the catalogue, which is the point: this replaced two locale tables
 * hand-maintained inside `apps/mobile/lib/tileSource.ts`.
 */
export function localeRecord(key: PlainMessageKey): Record<Locale, LocalizedString> {
  return Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, t(l, key)])) as Record<
    Locale,
    LocalizedString
  >
}

/**
 * A language's name **in that language** — "English", "繁體中文", "简体中文".
 *
 * The deliberate exception to everything above, and the reason it is a named function rather than a
 * lint suppression: an endonym must *not* follow the active locale. A reader who has the app in
 * Chinese and wants English needs to find the word "English", not "英文". So these three strings are
 * correct precisely because they are untranslated, and putting them in the catalogue would invite a
 * future translator to "fix" them. They are still `LocalizedString`, because they are right in
 * every locale.
 */
export function endonym(locale: Locale): LocalizedString {
  return ENDONYMS[locale]
}

const ENDONYMS: Record<Locale, LocalizedString> = {
  en: 'English' as LocalizedString,
  'zh-Hant': '繁體中文' as LocalizedString,
  'zh-Hans': '简体中文' as LocalizedString,
}

/**
 * The eight pole-side words, indexed by the octant `poleSideOctants` (`@nextbus/core`) returns —
 * 0 = North, clockwise.
 *
 * It lives here rather than in the screen because there is more than one screen. `apps/mobile` needs
 * it today and `apps/web` needs it the moment it grows a Place view; two lookup tables is how the
 * `OPERATOR_LABEL` map and the tile-source locale table came to disagree with the catalogue in the
 * first place (ADR-054). The kernel returns the number, this turns it into the word, and neither
 * knows about the other's half.
 */
const POLE_SIDE_KEYS = [
  'poleSideNorth',
  'poleSideNortheast',
  'poleSideEast',
  'poleSideSoutheast',
  'poleSideSouth',
  'poleSideSouthwest',
  'poleSideWest',
  'poleSideNorthwest',
] as const satisfies readonly PlainMessageKey[]

/**
 * The word for a pole's compass side — "East side" / "東面" — from the octant the kernel returned.
 *
 * The octant comes from `poleSideOctants`, which only produces one where a place has two poles whose
 * headings would otherwise be identical, so this is never asked for decoratively. An octant outside
 * 0–7 cannot arise from that rule, and `?? ''` is what it costs to say so without a throw on a label
 * path: a missing suffix leaves today's ambiguous-but-true heading, where a crash would take the
 * whole screen.
 */
export function poleSideLabel(octant: number, locale: Locale): LocalizedString {
  const key = POLE_SIDE_KEYS[octant]
  return key ? t(locale, key) : ('' as LocalizedString)
}

const OPERATOR_KEY: Record<OperatorId, PlainMessageKey> = {
  KMB: 'operatorKmb',
  LWB: 'operatorLwb',
  CTB: 'operatorCtb',
  GMB: 'operatorGmb',
}

/**
 * A bus operator's name, in the reader's language.
 *
 * **It lives here rather than in an app**, and the reason is the reason `poleSideLabel` above does: the
 * mapping from an `OperatorId` to a catalogue key is *which word names this operator*, which is one answer
 * for every renderer. It was `apps/mobile/lib/operatorName.ts` until WP6-3b, when the DOM Place screen
 * needed the same three strings — `placeDetailView` takes them as injected `labels` (ADR-054), so a second
 * app would have had to restate the table, and two tables disagree the moment the catalogue gains an
 * operator. This is its third home: before the mobile lib it was an `OPERATOR_LABEL` map inside
 * `app/stop/[id].tsx` and a second, English-only copy in the search screen's filter chips.
 *
 * Falls back to the raw code for an operator we have no copy for. ADR-052 treats `operator` as an open
 * vocabulary, so a code like `NLB` will reach a screen before its name does — and showing `NLB` beats
 * showing nothing. That fallback is the one place a raw upstream string is branded as a
 * `LocalizedString`, which is why the cast is here, once, with this comment on it rather than scattered
 * across call sites.
 *
 * **Known asymmetry, and it is content rather than code:** `operatorGmb` reads `專線小巴` / `专线小巴` in
 * Chinese — a phrase a rider recognises — and plain `GMB` in English, an acronym they have to know.
 * `docs/07` carries it; the corpus's own `placeDetailView` fixture labels it *"Minibus"*, which is the
 * word the English catalogue arguably wants, and a driver assertion pins that this is the **only** place
 * the catalogue and that fixture disagree.
 */
export function operatorName(operator: OperatorId, locale: Locale): LocalizedString {
  const key = OPERATOR_KEY[operator]
  return key ? t(locale, key) : (operator as LocalizedString)
}

/**
 * A name from the canonical bus-data model, for a display slot that requires a `LocalizedString`.
 *
 * Bus data is localized *upstream* — `I18nText` already carries all three renderings (CLAUDE.md
 * rule 5), so picking one is a read, not a translation. Taking `I18nText` rather than `string` is
 * what stops this being a universal laundry: there is no way to pass a bare English literal through
 * it, so it grants the brand without weakening it.
 */
export function dataText(text: I18nText, locale: Locale): LocalizedString {
  return (text[locale] || text.en) as LocalizedString
}

/**
 * Pick the best supported locale from an ordered list of BCP-47 tags (e.g. from the device).
 * English and unsupported languages → 'en'; bare/region `zh` → the HK-default Traditional. Pure
 * (no platform deps) so it's reusable + testable.
 */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const raw of preferred) {
    const tag = raw.toLowerCase()
    if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en'
    if (tag.startsWith('zh')) {
      if (tag.includes('hans') || tag.includes('cn') || tag.includes('sg')) return 'zh-Hans'
      if (tag.includes('hant') || tag.includes('hk') || tag.includes('tw') || tag.includes('mo')) {
        return 'zh-Hant'
      }
      return 'zh-Hant' // bare "zh" → Traditional (HK default)
    }
  }
  return 'en'
}
