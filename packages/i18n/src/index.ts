import type { I18nText, Locale } from '@nextbus/core'
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
