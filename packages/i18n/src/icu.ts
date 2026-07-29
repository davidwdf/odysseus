import type { Locale } from '@nextbus/core'

/**
 * The ICU MessageFormat *subset* this repo authors in, and a runtime for it that costs nothing.
 *
 * Why ICU syntax at all, when 108 strings need exactly three placeholders between them: because the
 * messages are no longer only ours. `packages/i18n/generated/` carries `.strings`, `.stringsdict`
 * and `strings.xml` emitted from the same declaration, and ICU is the one authoring form that
 * Xcode's and Android's tooling both understand. Inventing a private `{n}`-only syntax would have
 * meant a translator learning it and a generator guessing at plural rules.
 *
 * Why not `intl-messageformat`: `packages/i18n/src` sits in the `tokens` layer, whose `npm`
 * allowlist in `layers.json` is `[]` — a closed world. Opening it for ~40 kB of parser that a PWA
 * ships on first paint, to format three placeholders, is the wrong trade. `Intl.PluralRules` is
 * built into every target runtime, weighs nothing, and is *permitted here*: `layers.json` denies
 * `Intl` in the **kernel** only, because a kernel rule must be byte-reproducible from a fixture.
 * Choosing a plural category is exactly the job we want the host's CLDR data to do.
 *
 * The subset, in full:
 *   - `{name}` — simple argument, substituted with `String(value)`.
 *   - `{name, plural, one{…} other{…}}` — CLDR categories; `#` inside a branch is the number.
 * That is all. No `select`, no number/date skeletons, no ICU apostrophe quoting (so an apostrophe
 * is always a literal apostrophe — "isn't" needs no escaping, which is why the `en` copy reads
 * naturally). `validateMessage` below rejects anything outside the subset, and `check-i18n.mts`
 * runs it over every message in every locale, so the parser here never meets input it cannot
 * describe. Keeping the subset small is what lets the native generators be dumb enough to trust.
 */

/** CLDR plural categories. zh-Hant/zh-Hans have only `other`; the formatter must never assume en. */
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
type Category = (typeof CATEGORIES)[number]

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'arg'; name: string }
  | { kind: 'plural'; name: string; branches: Partial<Record<Category, Part[]>> }

/** Parsed messages are cached by source string — the catalogue is fixed at build time, so this
 *  map is bounded by the key count and every render after the first is a walk over `Part[]`. */
const parsed = new Map<string, Part[]>()

/** The index of the `}` matching the `{` at `open`, or -1. */
function closingBrace(msg: string, open: number): number {
  let depth = 0
  for (let i = open; i < msg.length; i++) {
    if (msg[i] === '{') depth++
    else if (msg[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** Thrown only for a message that never passed `validateMessage` — i.e. a gate that was bypassed. */
class IcuError extends Error {}

function parseParts(msg: string): Part[] {
  const parts: Part[] = []
  let text = ''
  let i = 0
  while (i < msg.length) {
    const ch = msg.charAt(i)
    if (ch !== '{') {
      if (ch === '}') throw new IcuError(`unbalanced '}' in ${JSON.stringify(msg)}`)
      text += ch
      i++
      continue
    }
    if (text) {
      parts.push({ kind: 'text', text })
      text = ''
    }
    const end = closingBrace(msg, i)
    if (end === -1) throw new IcuError(`unclosed '{' in ${JSON.stringify(msg)}`)
    parts.push(parsePlaceholder(msg.slice(i + 1, end), msg))
    i = end + 1
  }
  if (text) parts.push({ kind: 'text', text })
  return parts
}

const IDENT = /^[A-Za-z][A-Za-z0-9]*$/

function parsePlaceholder(body: string, msg: string): Part {
  const comma = body.indexOf(',')
  if (comma === -1) {
    const name = body.trim()
    if (!IDENT.test(name)) throw new IcuError(`bad argument name ${JSON.stringify(name)} in ${msg}`)
    return { kind: 'arg', name }
  }
  const name = body.slice(0, comma).trim()
  if (!IDENT.test(name)) throw new IcuError(`bad argument name ${JSON.stringify(name)} in ${msg}`)
  const rest = body.slice(comma + 1).trim()
  if (!rest.startsWith('plural'))
    throw new IcuError(`only \`plural\` is supported, got ${JSON.stringify(rest)} in ${msg}`)
  const after = rest.slice('plural'.length).trim()
  if (!after.startsWith(','))
    throw new IcuError(`expected \`, \` after \`plural\` in ${JSON.stringify(msg)}`)
  return { kind: 'plural', name, branches: parseBranches(after.slice(1), msg) }
}

function parseBranches(src: string, msg: string): Partial<Record<Category, Part[]>> {
  const branches: Partial<Record<Category, Part[]>> = {}
  let i = 0
  while (i < src.length) {
    if (/\s/.test(src.charAt(i))) {
      i++
      continue
    }
    const open = src.indexOf('{', i)
    if (open === -1) throw new IcuError(`trailing ${JSON.stringify(src.slice(i))} in ${msg}`)
    const category = src.slice(i, open).trim()
    if (!(CATEGORIES as readonly string[]).includes(category))
      throw new IcuError(
        `${JSON.stringify(category)} is not a CLDR plural category in ${JSON.stringify(msg)}`,
      )
    const end = closingBrace(src, open)
    if (end === -1) throw new IcuError(`unclosed plural branch in ${JSON.stringify(msg)}`)
    branches[category as Category] = parseParts(src.slice(open + 1, end))
    i = end + 1
  }
  if (!branches.other)
    throw new IcuError(`every plural needs an \`other\` branch — ${JSON.stringify(msg)}`)
  return branches
}

/** `Intl.PluralRules` is cheap but not free to construct, and there are three locales, forever. */
const pluralRules = new Map<Locale, Intl.PluralRules>()
const rulesFor = (locale: Locale): Intl.PluralRules => {
  let r = pluralRules.get(locale)
  if (!r) {
    r = new Intl.PluralRules(locale)
    pluralRules.set(locale, r)
  }
  return r
}

export type MessageArgs = Record<string, string | number>

function render(parts: Part[], locale: Locale, args: MessageArgs, hash?: number): string {
  let out = ''
  for (const part of parts) {
    if (part.kind === 'text') {
      out += hash === undefined ? part.text : part.text.replaceAll('#', String(hash))
      continue
    }
    const value = args[part.name]
    if (value === undefined) throw new IcuError(`missing argument \`${part.name}\``)
    if (part.kind === 'arg') {
      out += String(value)
      continue
    }
    const n = typeof value === 'number' ? value : Number(value)
    // The host's CLDR data picks the category, then `other` absorbs everything the locale does not
    // distinguish — which for zh is every number, and is why this cannot be an English `n === 1`.
    const category = rulesFor(locale).select(n) as Category
    const branch = part.branches[category] ?? part.branches.other
    out += render(branch as Part[], locale, args, n)
  }
  return out
}

/** Format one ICU message. `message` must already have passed `validateMessage`. */
export function formatMessage(message: string, locale: Locale, args: MessageArgs = {}): string {
  let parts = parsed.get(message)
  if (!parts) {
    parts = parseParts(message)
    parsed.set(message, parts)
  }
  return render(parts, locale, args)
}

/**
 * The argument names a message expects, in source order, de-duplicated.
 * `check-i18n.mts` compares these across locales: a translator who drops `{place}` produces a
 * message that formats without error and silently loses the place name, which no compiler sees.
 */
export function argumentNames(message: string): string[] {
  const names: string[] = []
  const walk = (parts: Part[]) => {
    for (const p of parts) {
      if (p.kind === 'text') continue
      if (!names.includes(p.name)) names.push(p.name)
      if (p.kind === 'plural') for (const b of Object.values(p.branches)) walk(b as Part[])
    }
  }
  walk(parseParts(message))
  return names
}

/** True when the message uses a plural — the native generators need `.stringsdict`/`<plurals>`. */
export function pluralArgument(message: string): string | undefined {
  return parseParts(message).find((p) => p.kind === 'plural')?.name
}

/**
 * @returns the reasons `message` is outside the authored subset; `[]` when it is fine.
 *
 * Two of these rules exist to keep `ArgumentNames<S>` in `index.ts` honest rather than to help the
 * runtime, which is the price of extracting a message's parameters at the type level from a
 * template-literal type. A nested placeholder inside a plural branch, or a non-identifier argument
 * name, is something the type extractor cannot see — so it is banned outright instead of being
 * quietly missed at the call site.
 */
export function validateMessage(message: string): string[] {
  const problems: string[] = []
  let parts: Part[]
  try {
    parts = parseParts(message)
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)]
  }
  if (message.includes("'{") || message.includes("'}"))
    problems.push(
      "ICU apostrophe quoting (`'{`) is not in the subset — the native generators do not unquote it",
    )
  for (const part of parts) {
    if (part.kind !== 'plural') continue
    for (const [category, branch] of Object.entries(part.branches))
      for (const inner of branch as Part[])
        if (inner.kind !== 'text')
          problems.push(
            `plural branch \`${category}\` nests a \`{${inner.name}}\` placeholder, which the ` +
              'type-level argument extractor cannot see — keep plural branches to text and `#`',
          )
  }
  return problems
}
