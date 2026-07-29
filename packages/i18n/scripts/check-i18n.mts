/**
 * `pnpm --filter @nextbus/i18n test` — the gates that make `catalogue.ts` the one declaration.
 *
 * Before Wave 3 this package had no test script at all, so it was in no turbo target and nothing
 * about it was ever checked. What "parity" meant was `const en: Messages` — a type annotation, which
 * catches a **missing** key and nothing else. It cannot see a placeholder a translator dropped, a
 * plural branch a locale does not have, or a Chinese value that is still English. Those are the four
 * ways this catalogue actually breaks, and they are all silent at both compile time and run time:
 * the string formats fine, it is just wrong on screen. So:
 *
 *   1. **key parity** — every locale has every key, non-empty;
 *   2. **placeholder parity** — the same argument names in every locale, so `{place}` cannot be
 *      dropped from the Chinese copy and silently take the place name with it;
 *   3. **plural correctness per locale** — the declared branches must be exactly the CLDR categories
 *      the locale *has*. This fails an `en` message missing `one` (the `"1 stops"` defect, now
 *      structurally impossible) and equally fails a `zh` message that declares a pointless `one`
 *      branch that `Intl.PluralRules` will never select;
 *   4. **untranslated copy** — a non-`en` value byte-identical to `en`, unless the entry declares
 *      `untranslated` and says why. Some genuinely are identical (`DATA.GOV.HK`), which is why this
 *      is an allowlist with a reason rather than a blanket rule — and why a *stale* exemption, one
 *      whose values now differ, is also a failure;
 *   5. **drift** — `generated/` matches a fresh generation.
 *
 * `--selftest` watches every one of them fail against synthetic catalogues. The gate is wired into
 * `test` rather than CI on purpose: there is no PR/push workflow in this repo (`.github/workflows/`
 * has only `dataset.yml`), so `turbo run test` is the only thing that actually runs. Following
 * `packages/contract`, whose `test` *is* its OpenAPI drift gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locale } from '@nextbus/core'
import { CATALOGUE, type CatalogueEntry } from '../src/catalogue'
import { argumentNames, pluralArgument, validateMessage } from '../src/icu'
import { generate } from './native-strings.mts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = ['en', 'zh-Hant', 'zh-Hans'] as const satisfies readonly Locale[]
const NON_EN = ['zh-Hant', 'zh-Hans'] as const satisfies readonly Locale[]

type Catalogue = Record<string, CatalogueEntry>
type Problem = { code: string; message: string }

/** The plural categories a locale actually distinguishes, per the host's CLDR data. */
const categoriesOf = (locale: Locale): string[] =>
  [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort()

/** The plural branch names declared in a message, or undefined when it is not a plural. */
function declaredBranches(text: string): string[] | undefined {
  if (pluralArgument(text) === undefined) return undefined
  const body = text.slice(text.indexOf('plural,') + 'plural,'.length, text.lastIndexOf('}'))
  return [...body.matchAll(/(\w+)\s*\{[^{}]*\}/g)].map((m) => m[1] as string).sort()
}

/** Every check except drift — pure, so `--selftest` can run it over a synthetic catalogue. */
export function analyse(catalogue: Catalogue): {
  problems: Problem[]
  stats: Record<string, number>
} {
  const problems: Problem[] = []
  const fail = (code: string, message: string) => problems.push({ code, message })
  let plurals = 0
  let parameterised = 0
  let exemptions = 0

  for (const [key, entry] of Object.entries(catalogue)) {
    // 1 — key parity, and that every message is inside the authored ICU subset. A message that
    // does not parse is reported once and then skipped: every check below reads its placeholders,
    // so carrying on would bury the one actionable problem under derived noise.
    let usable = true
    for (const locale of LOCALES) {
      const text = entry[locale]
      if (typeof text !== 'string' || text.length === 0) {
        fail('LOCALE_MISSING', `${key} [${locale}]: no message`)
        usable = false
        continue
      }
      for (const why of validateMessage(text)) {
        fail('MESSAGE_INVALID', `${key} [${locale}]: ${why}`)
        usable = false
      }
    }
    if (!usable) continue

    const en = entry.en
    const enArgs = argumentNames(en)
    if (enArgs.length > 0) parameterised++
    const enBranches = declaredBranches(en)
    if (enBranches) plurals++

    for (const locale of LOCALES) {
      const text = entry[locale]
      // 2 — placeholder parity. Compared as sets: a translator may reorder, never drop or invent.
      const args = argumentNames(text)
      const missing = enArgs.filter((a) => !args.includes(a))
      const extra = args.filter((a) => !enArgs.includes(a))
      if (missing.length > 0 || extra.length > 0)
        fail(
          'PLACEHOLDER_MISMATCH',
          `${key} [${locale}]: en takes {${enArgs.join(', ')}} but this takes {${args.join(', ')}}` +
            `${missing.length ? ` — dropped ${missing.map((a) => `{${a}}`).join(', ')}` : ''}` +
            `${extra.length ? ` — invented ${extra.map((a) => `{${a}}`).join(', ')}` : ''}`,
        )

      // 3 — plural shape, then plural categories.
      const declared = declaredBranches(text)
      if (!!enBranches !== !!declared) {
        fail(
          'PLURAL_SHAPE',
          `${key} [${locale}]: ${declared ? 'is' : 'is not'} a plural but en ${enBranches ? 'is' : 'is not'} — ` +
            'a plural in one locale and a bare argument in another loses the count agreement',
        )
        continue
      }
      if (!declared) continue
      const expected = categoriesOf(locale)
      const missingCat = expected.filter((c) => !declared.includes(c))
      const uselessCat = declared.filter((c) => !expected.includes(c))
      if (missingCat.length > 0 || uselessCat.length > 0)
        fail(
          'PLURAL_CATEGORIES',
          `${key} [${locale}]: declares {${declared.join(', ')}} but ${locale} has ` +
            `{${expected.join(', ')}}` +
            `${missingCat.length ? ` — missing ${missingCat.join(', ')}, so that count renders the wrong branch` : ''}` +
            `${uselessCat.length ? ` — ${uselessCat.join(', ')} is never selected in ${locale}` : ''}`,
        )
    }

    // 4 — untranslated copy, and stale exemptions.
    const identical = NON_EN.filter((l) => entry[l] === en)
    if (entry.untranslated === undefined) {
      if (identical.length > 0)
        fail(
          'UNTRANSLATED',
          `${key}: ${identical.join(' and ')} ${identical.length > 1 ? 'are' : 'is'} byte-identical to en ` +
            `(${JSON.stringify(en)}) — translate it, or add \`untranslated: '<why it must not be>'\``,
        )
    } else {
      exemptions++
      if (identical.length !== NON_EN.length)
        fail(
          'STALE_EXEMPTION',
          `${key}: declares \`untranslated\` but ${NON_EN.filter((l) => entry[l] !== en).join(' and ')} ` +
            'now differs from en — the exemption outlived the reason for it, so delete it',
        )
      if (entry.untranslated.length < 20)
        fail('EXEMPTION_UNEXPLAINED', `${key}: \`untranslated\` needs a reason, not a placeholder`)
    }
  }

  return {
    problems,
    stats: {
      keys: Object.keys(catalogue).length,
      locales: LOCALES.length,
      parameterised,
      plurals,
      exemptions,
    },
  }
}

/** @returns the generated artefacts whose committed text no longer matches a fresh generation. */
export function drift(files = generate()): string[] {
  return files
    .filter(({ file, text }) => {
      try {
        return readFileSync(join(ROOT, file), 'utf8') !== text
      } catch {
        return true // absent counts as drifted
      }
    })
    .map(({ file }) => file)
}

// ── Selftest ────────────────────────────────────────────────────────────────

/** A well-formed entry each scenario then breaks in exactly one way. */
const good = (): Catalogue => ({
  plain: { en: 'Nearby', 'zh-Hant': '附近', 'zh-Hans': '附近' },
  withArg: {
    en: 'Circular via {place}',
    'zh-Hant': '經{place}循環線',
    'zh-Hans': '经{place}循环线',
  },
  withPlural: {
    en: '{n, plural, one{# stop} other{# stops}}',
    'zh-Hant': '{n, plural, other{# 個站}}',
    'zh-Hans': '{n, plural, other{# 个站}}',
  },
  brandName: {
    en: 'DATA.GOV.HK',
    'zh-Hant': 'DATA.GOV.HK',
    'zh-Hans': 'DATA.GOV.HK',
    untranslated: 'a proper noun that is Latin script in every language',
  },
})

const SCENARIOS: { name: string; break: (c: Catalogue) => void; expect: string[] }[] = [
  { name: 'the well-formed catalogue passes', break: () => {}, expect: [] },
  {
    name: 'a locale is missing a key',
    break: (c) => {
      const { 'zh-Hans': _dropped, ...rest } = c.plain as CatalogueEntry
      c.plain = rest as unknown as CatalogueEntry
    },
    expect: ['LOCALE_MISSING'],
  },
  {
    name: 'a translator dropped a placeholder',
    break: (c) => {
      c.withArg = { ...c.withArg, 'zh-Hant': '循環線' } as CatalogueEntry
    },
    expect: ['PLACEHOLDER_MISMATCH'],
  },
  {
    name: 'a translator invented a placeholder',
    break: (c) => {
      c.withArg = { ...c.withArg, 'zh-Hans': '经{spot}循环线' } as CatalogueEntry
    },
    expect: ['PLACEHOLDER_MISMATCH'],
  },
  {
    name: 'the en plural has no `one` branch — this is the "1 stops" defect',
    break: (c) => {
      c.withPlural = { ...c.withPlural, en: '{n, plural, other{# stops}}' } as CatalogueEntry
    },
    expect: ['PLURAL_CATEGORIES'],
  },
  {
    name: 'a zh plural declares a branch zh never selects',
    break: (c) => {
      c.withPlural = {
        ...c.withPlural,
        'zh-Hant': '{n, plural, one{# 個站} other{# 個站}}',
      } as CatalogueEntry
    },
    expect: ['PLURAL_CATEGORIES'],
  },
  {
    name: 'plural in en, bare argument in zh',
    break: (c) => {
      c.withPlural = { ...c.withPlural, 'zh-Hant': '{n} 個站' } as CatalogueEntry
    },
    expect: ['PLURAL_SHAPE'],
  },
  {
    name: 'a Chinese value is still English',
    break: (c) => {
      c.plain = { ...c.plain, 'zh-Hant': 'Nearby' } as CatalogueEntry
    },
    expect: ['UNTRANSLATED'],
  },
  {
    name: 'an exemption that has outlived its reason',
    break: (c) => {
      c.brandName = { ...c.brandName, 'zh-Hant': '資料一線通' } as CatalogueEntry
    },
    expect: ['STALE_EXEMPTION'],
  },
  {
    name: 'an exemption with no reason given',
    break: (c) => {
      c.brandName = { ...c.brandName, untranslated: 'brand' } as CatalogueEntry
    },
    expect: ['EXEMPTION_UNEXPLAINED'],
  },
  {
    name: 'a message outside the ICU subset (unclosed brace)',
    break: (c) => {
      c.plain = { ...c.plain, en: 'Nearby {oops' } as CatalogueEntry
    },
    expect: ['MESSAGE_INVALID'],
  },
  {
    name: 'a placeholder nested in a plural branch, which the type extractor cannot see',
    break: (c) => {
      c.withPlural = {
        ...c.withPlural,
        en: '{n, plural, one{# stop on {route}} other{# stops on {route}}}',
      } as CatalogueEntry
    },
    expect: ['MESSAGE_INVALID'],
  },
]

function selftest(): number {
  let failures = 0
  console.log('check-i18n --selftest: watching each gate fail on purpose')
  for (const s of SCENARIOS) {
    const catalogue = good()
    s.break(catalogue)
    const { problems } = analyse(catalogue)
    const got = [...new Set(problems.map((p) => p.code))].sort()
    const want = [...new Set(s.expect)].sort()
    const ok = got.join(',') === want.join(',')
    if (!ok) failures++
    console.log(`  ${ok ? '✓' : '✗'} ${s.name} → ${got.join(', ') || '(no problems)'}`)
    if (!ok) {
      console.log(`      expected: ${want.join(', ') || '(no problems)'}`)
      for (const p of problems) console.log(`      · ${p.code}: ${p.message}`)
    }
  }
  // Drift is a scenario too: hand the checker text that cannot match disk.
  const tampered = drift([
    { file: 'generated/ios/en.lproj/Localizable.strings', text: 'tampered\n' },
  ])
  const driftOk = tampered.length === 1
  if (!driftOk) failures++
  console.log(
    `  ${driftOk ? '✓' : '✗'} a hand-edited generated file → ${driftOk ? 'detected' : 'NOT DETECTED'}`,
  )
  if (failures > 0)
    console.error(`✗ selftest: ${failures} gate(s) did not fire — the gate is vacuous`)
  else console.log(`  ✓ all ${SCENARIOS.length + 1} injected faults were caught`)
  return failures
}

// ── Entry point ─────────────────────────────────────────────────────────────

if (process.argv.includes('--selftest')) {
  process.exit(selftest() === 0 ? 0 : 1)
}

let failed = false
const { problems, stats } = analyse(CATALOGUE as unknown as Catalogue)
if (problems.length > 0) {
  console.error('✗ the message catalogue is not consistent across locales:\n')
  for (const p of problems) console.error(`  · ${p.code}: ${p.message}`)
  console.error(
    '\nEdit packages/i18n/src/catalogue.ts — it is the only declaration of these strings.',
  )
  failed = true
} else {
  console.log(
    `✓ ${stats.keys} keys × ${stats.locales} locales agree — ${stats.parameterised} parameterised ` +
      `(${stats.plurals} plural), ${stats.exemptions} documented untranslated exemption(s).`,
  )
}

const drifted = drift()
if (drifted.length > 0) {
  console.error(
    `✗ ${drifted.length} generated artefact(s) no longer match the catalogue:\n` +
      drifted.map((f) => `  · ${f}`).join('\n') +
      '\nrun `pnpm --filter @nextbus/i18n strings:emit` and commit the result.',
  )
  failed = true
} else {
  console.log(`✓ ${generate().length} native artefact(s) in generated/ match the catalogue`)
}

const selftestFailures = selftest()
if (selftestFailures > 0) failed = true

process.exit(failed ? 1 : 0)
