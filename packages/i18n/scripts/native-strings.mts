/**
 * `packages/i18n/src/catalogue.ts` → the artefacts iOS and Android read.
 *
 * Wave 3's shape: one declaration, a generator that writes **committed** output, and a drift gate
 * that fails when the two disagree (`check-i18n.mts`, wired into this package's `test` script). The
 * output is committed so a reviewer sees it in the diff and so a native developer with no Node
 * toolchain can read the file — the same reason `packages/contract/openapi.json` is committed.
 *
 * **Nothing here is verified by a compiler in this repo.** There is no Xcode and no Gradle on this
 * machine, so `.strings`, `.stringsdict` and `strings.xml` are checked for *drift against the
 * catalogue* and for the escaping rules below, and nothing more. The mitigation is to keep the
 * output boring: no name mangling, one construct per file, and a generator that **throws** rather
 * than guesses when a string contains something it cannot escape confidently. The first native repo
 * to consume these should expect to fix something; see `docs/04-frontend-and-design.md` for the
 * handover notes.
 *
 * Two deliberate choices a native developer needs to know about:
 *
 * 1. **Resource names are the catalogue keys verbatim** — `stopCount`, not `stop_count`. Android
 *    convention is snake_case, but a name transformation is a second place for the two sides to
 *    disagree, and `R.string.stopCount` is legal. One name across TypeScript, Swift and Kotlin is
 *    worth more here than house style in a file nobody hand-edits.
 * 2. **ICU named arguments become positional** — `{place}` is `%1$@` on iOS and `%1$s` on Android,
 *    numbered by first appearance in the `en` message. The mapping is emitted as a comment above
 *    every parameterised entry, because a positional format string is unreadable without it and
 *    getting the order wrong is silent at every layer.
 */

import type { Locale } from '@nextbus/core'
import { argumentNames, CATALOGUE, type MessageKey, pluralArgument } from '../src/index'

const EMIT = '`pnpm --filter @nextbus/i18n strings:emit`'
const LOCALES = ['en', 'zh-Hant', 'zh-Hans'] as const

/** iOS `.lproj` and Android resource-qualifier directory names for each locale. */
const IOS_DIR: Record<Locale, string> = {
  en: 'en.lproj',
  'zh-Hant': 'zh-Hant.lproj',
  'zh-Hans': 'zh-Hans.lproj',
}
// The BCP-47 qualifier form (API 21+). `values-zh-rHK` would pick a *region*, but the distinction
// we actually ship is script — a Traditional reader in Macau must not fall through to Simplified.
const ANDROID_DIR: Record<Locale, string> = {
  en: 'values',
  'zh-Hant': 'values-b+zh+Hant',
  'zh-Hans': 'values-b+zh+Hans',
}

const keys = Object.keys(CATALOGUE) as MessageKey[]
const message = (key: MessageKey, locale: Locale): string => CATALOGUE[key][locale]

/**
 * Refuse to emit a string we cannot escape with confidence.
 *
 * `%` is the live hazard: it is a format specifier on both platforms and a literal in TypeScript, so
 * a stray `%` in a message would be silently reinterpreted as an argument. `@` and `?` are Android
 * resource references when they lead a value. None of the 108 messages contains any of these today,
 * which is exactly why this is a hard failure rather than a best-effort escape — the first message
 * that needs one should be a conversation, not a guess in a generated file.
 */
function assertEmittable(key: MessageKey, locale: Locale, text: string): void {
  if (text.includes('%'))
    throw new Error(
      `${key} [${locale}] contains a literal '%', which is a format specifier on both platforms. ` +
        'Teach native-strings.mts how you want it escaped (iOS %%, Android %%) before shipping it.',
    )
  if (/^[@?]/.test(text))
    throw new Error(
      `${key} [${locale}] starts with '${text[0]}', which Android reads as a resource reference.`,
    )
}

/** Named ICU arguments → 1-based positions, ordered by first appearance in the `en` message. */
function positions(key: MessageKey): Map<string, number> {
  return new Map(argumentNames(message(key, 'en')).map((name, i) => [name, i + 1]))
}

/** `{place}` → `%1$@` / `%1$s`, and a plural branch's `#` → the number specifier. */
function toPositional(text: string, at: Map<string, number>, spec: '@' | 's', numberSpec: string) {
  let out = text.replaceAll('#', numberSpec)
  for (const [name, i] of at) out = out.replaceAll(`{${name}}`, `%${i}$${spec}`)
  return out
}

/** The `{n} → %1$@` breadcrumb that makes a positional format string readable. */
function argComment(key: MessageKey, spec: '@' | 's'): string | undefined {
  const at = positions(key)
  if (at.size === 0) return undefined
  return [...at].map(([name, i]) => `{${name}} → %${i}$${spec}`).join(', ')
}

const isPlural = (key: MessageKey) => pluralArgument(message(key, 'en')) !== undefined

/** The plural branches of a message, as `category → text`. Parsed, not regexed, so the subset rules
 *  in `icu.ts` are the single description of what a branch may contain. */
function branches(key: MessageKey, locale: Locale): [string, string][] {
  const text = message(key, locale)
  const out: [string, string][] = []
  const inner = /(\w+)\s*\{([^{}]*)\}/g
  const body = text.slice(text.indexOf('plural,') + 'plural,'.length, text.lastIndexOf('}'))
  for (const m of body.matchAll(inner)) out.push([m[1] as string, m[2] as string])
  return out
}

// ── iOS ─────────────────────────────────────────────────────────────────────

/** `.strings` escaping: backslash and double quote only. Newlines do not occur in the catalogue. */
const iosEscape = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

function iosStrings(locale: Locale): string {
  const lines = [
    `/* Generated from packages/i18n/src/catalogue.ts — do not edit. Re-run ${EMIT}.`,
    ` * Locale: ${locale}. Plural messages live in Localizable.stringsdict, not here.`,
    ' * Simple arguments are %@ — pass them as strings, even a count. Only a plural rule variable is',
    ' * numeric (%d in the stringsdict), because ICU `{n}` carries no type and this subset adds none. */',
    '',
  ]
  for (const key of keys) {
    const text = message(key, locale)
    assertEmittable(key, locale, text)
    if (isPlural(key)) {
      lines.push(`/* ${key}: plural — see Localizable.stringsdict */`)
      continue
    }
    const comment = argComment(key, '@')
    if (comment) lines.push(`/* ${comment} */`)
    lines.push(`"${key}" = "${iosEscape(toPositional(text, positions(key), '@', '%d'))}";`)
  }
  return `${lines.join('\n')}\n`
}

const xmlEscape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function iosStringsdict(locale: Locale): string {
  const plurals = keys.filter(isPlural)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    `<!-- Generated from packages/i18n/src/catalogue.ts — do not edit. Re-run ${EMIT}. Locale: ${locale}. -->`,
    '<plist version="1.0">',
    '<dict>',
  ]
  for (const key of plurals) {
    const arg = pluralArgument(message(key, 'en')) as string
    lines.push(
      `\t<key>${key}</key>`,
      '\t<dict>',
      '\t\t<key>NSStringLocalizedFormatKey</key>',
      `\t\t<string>%#@${arg}@</string>`,
      `\t\t<key>${arg}</key>`,
      '\t\t<dict>',
      '\t\t\t<key>NSStringFormatSpecTypeKey</key>',
      '\t\t\t<string>NSStringPluralRuleType</string>',
      '\t\t\t<key>NSStringFormatValueTypeKey</key>',
      '\t\t\t<string>d</string>',
    )
    for (const [category, text] of branches(key, locale)) {
      assertEmittable(key, locale, text)
      lines.push(
        `\t\t\t<key>${category}</key>`,
        `\t\t\t<string>${xmlEscape(iosEscape(text.replaceAll('#', '%d')))}</string>`,
      )
    }
    lines.push('\t\t</dict>', '\t</dict>')
  }
  lines.push('</dict>', '</plist>')
  return `${lines.join('\n')}\n`
}

// ── Android ─────────────────────────────────────────────────────────────────

/** XML entities, then Android's own backslash escapes for the quote characters. */
const androidEscape = (s: string) =>
  xmlEscape(s).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('"', '\\"')

function androidStrings(locale: Locale): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<!-- Generated from packages/i18n/src/catalogue.ts — do not edit. Re-run ${EMIT}. Locale: ${locale}.`,
    '     Simple arguments are %s — pass them as strings, even a count. Only a <plurals> quantity is',
    '     numeric (%1$d), because ICU `{n}` carries no type and this subset adds none. -->',
    '<resources>',
  ]
  for (const key of keys) {
    const text = message(key, locale)
    assertEmittable(key, locale, text)
    if (isPlural(key)) {
      lines.push(`\t<plurals name="${key}">`)
      for (const [category, branch] of branches(key, locale))
        lines.push(
          `\t\t<item quantity="${category}">${androidEscape(branch.replaceAll('#', '%1$d'))}</item>`,
        )
      lines.push('\t</plurals>')
      continue
    }
    const comment = argComment(key, 's')
    if (comment) lines.push(`\t<!-- ${comment} -->`)
    lines.push(
      `\t<string name="${key}">${androidEscape(toPositional(text, positions(key), 's', '%1$d'))}</string>`,
    )
  }
  lines.push('</resources>')
  return `${lines.join('\n')}\n`
}

// ── The artefact list ───────────────────────────────────────────────────────

/**
 * @returns every generated file as `{file, text}`, paths relative to `packages/i18n/`.
 * `check-i18n.mts` compares this against disk; `emit-native.mts` writes it. Both read the same
 * function, so there is no third description of what the output should be.
 */
export function generate(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  const anyPlural = keys.some(isPlural)
  for (const locale of LOCALES) {
    out.push({
      file: `generated/ios/${IOS_DIR[locale]}/Localizable.strings`,
      text: iosStrings(locale),
    })
    if (anyPlural)
      out.push({
        file: `generated/ios/${IOS_DIR[locale]}/Localizable.stringsdict`,
        text: iosStringsdict(locale),
      })
    out.push({
      file: `generated/android/${ANDROID_DIR[locale]}/strings.xml`,
      text: androidStrings(locale),
    })
  }
  return out
}
