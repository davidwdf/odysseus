#!/usr/bin/env node
/**
 * `pnpm boundaries:selftest` — proves the enforcement engine can *fail*.
 *
 * A boundary checker that quietly matches nothing reports success forever, so the acceptance
 * criterion for WP1-4 is not "it passes" but "it fails on every injected violation, direct and
 * transitive". Each fixture under ./fixtures is a miniature repo laid out like this one; the
 * *real* generated rules are run against it with `baseDir` pointed at the fixture, so the
 * predicates under test are byte-for-byte the ones that police the repo.
 *
 * dependency-cruiser matches on resolved paths, so the fixtures import across packages relatively
 * (`../../contract/src/index`) rather than by specifier — a fixture has no node_modules of its own,
 * and `@nextbus/contract` would resolve out to the real package and escape the fixture's baseDir.
 * The Biome cases are the exception: Biome is textual, so those fixtures use real specifiers.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bannedSyntax, cruiseLayers, drift } from './check.mjs'
import { ROOT } from './generate.mjs'

const FIXTURES = path.join(import.meta.dirname, 'fixtures')

/** tool: which gate the fixture exercises · expect: what it must report (a superset is fine). */
const CASES = [
  {
    fixture: 'kernel-runtime-contract',
    tool: 'cruise',
    expect: ['layer-kernel-type-only-contract'],
    why: 'core may name contract types but must never import it at runtime (ADR-052)',
  },
  {
    fixture: 'kernel-type-only-contract',
    tool: 'cruise',
    expect: [],
    why: 'the control: the same edge written `import type` is legal, so the rule discriminates',
  },
  {
    fixture: 'contract-imports-kernel',
    tool: 'cruise',
    expect: ['layer-contract'],
    why: 'the direction is core → contract; contract imports nothing',
  },
  {
    fixture: 'kernel-imports-ports',
    tool: 'cruise',
    expect: ['layer-kernel'],
    why: 'ports is a platform seam: not in the kernel, and `import type` does not excuse it',
  },
  {
    fixture: 'kernel-imports-react-native',
    tool: 'cruise',
    expect: ['layer-kernel-npm'],
    why: 'the kernel has zero runtime dependencies, least of all a view framework',
  },
  {
    fixture: 'tokens-imports-view',
    tool: 'cruise',
    expect: ['layer-tokens'],
    why: 'packages/* must never reach into apps/*',
  },
  {
    fixture: 'view-imports-adapters',
    tool: 'cruise',
    expect: ['layer-view'],
    why: 'golden rule 2: screens reach upstream only through the DataSource seam',
  },
  {
    fixture: 'view-reaches-adapters-via-client',
    tool: 'cruise',
    expect: ['layer-client', 'layer-view-reach'],
    why: 'TRANSITIVE: view → client is legal, client → adapters is not; only the reach rule names view',
  },
  {
    fixture: 'kernel-reaches-view-via-contract',
    tool: 'cruise',
    expect: ['layer-contract', 'layer-kernel-reach'],
    why: 'TRANSITIVE through a legal type-only hop: core → contract → apps/mobile',
  },
  {
    fixture: 'circular',
    tool: 'cruise',
    expect: ['no-circular'],
    why: 'a cycle means the layers are not layers',
  },
  {
    fixture: 'kernel-nondeterminism',
    tool: 'syntax',
    expect: ['Date\\.now\\s*\\(', 'new Date\\s*\\(\\s*\\)', 'Math\\.random\\s*\\('],
    why: 'the kernel takes `now` as a parameter and is byte-reproducible',
  },
  {
    fixture: 'view-hardcoded-copy',
    tool: 'syntax',
    expect: [
      'accessibilityLabel\\s*[:=]\\s*[\'"]',
      'placeholder\\s*=\\s*[\'"]',
      '\\.replace\\(\\s*[\'"]\\{',
    ],
    why: 'the display boundary the LocalizedString brand cannot reach: RN props typed `string`, and `.replace` laundering the brand off a message. The fixture pairs each violation with the correct form, so the rules must discriminate rather than match everything',
  },
  {
    fixture: 'kernel-biome',
    tool: 'biome',
    expect: ['lint/style/noRestrictedGlobals', 'lint/style/noRestrictedImports'],
    why: 'Biome is the second net: platform globals need no import, so no path rule sees them',
  },
]

/** Biome resolves an override's `includes` relative to the config file, so the config must sit in
 *  the fixture. It is derived from the real biome.json at run time, which is what keeps it honest. */
function biomeCategories(dir) {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'biome.json'), 'utf8'))
  const configPath = path.join(dir, 'biome.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      ...config,
      vcs: { enabled: false },
      files: { includes: ['**'] },
      formatter: { enabled: false },
      linter: { enabled: true, rules: { recommended: false } },
    }),
  )
  try {
    execFileSync(path.join(ROOT, 'node_modules/.bin/biome'), ['lint', '--reporter=json', '.'], {
      cwd: dir,
      encoding: 'utf8',
    })
    return []
  } catch (err) {
    return JSON.parse(err.stdout).diagnostics.map((d) => d.category)
  } finally {
    rmSync(configPath, { force: true })
  }
}

const found = async ({ fixture, tool }) => {
  const dir = path.join(FIXTURES, fixture)
  if (tool === 'cruise') {
    const { violations, total } = await cruiseLayers(dir)
    // Guards the control case: "no violations" only means something if the fixture was read at all.
    if (total === 0)
      return ['(cruised zero modules — the fixture layout no longer matches a layer)']
    return violations.map((v) => v.rule.name)
  }
  if (tool === 'syntax') return bannedSyntax(dir).map((h) => h.pattern)
  return biomeCategories(dir)
}

let failed = 0
for (const c of CASES) {
  const observed = [...new Set(await found(c))].sort()
  const missing = c.expect.filter((e) => !observed.includes(e))
  const unexpected = c.expect.length === 0 ? observed : []
  const ok = missing.length === 0 && unexpected.length === 0
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${c.fixture} [${c.tool}] → ${observed.join(', ') || '(clean)'}`)
  console.log(`    ${c.why}`)
  if (missing.length > 0) console.log(`    MISSING: ${missing.join(', ')} — the gate did not fire`)
  if (unexpected.length > 0)
    console.log(`    UNEXPECTED: ${unexpected.join(', ')} — a legal edge was rejected`)
}

// The drift gate is a fixture too: tamper with the generated text in memory and it must notice.
const tampered = drift([{ file: 'biome.json', text: '{"overrides": []}\n' }])
const driftOk = tampered.length === 1
if (!driftOk) failed++
console.log(
  `${driftOk ? '✓' : '✗'} drift [gen] → ${driftOk ? 'tampered biome.json detected' : 'NOT DETECTED'}`,
)
console.log('    layers.json is the single declaration; a hand-edited config must fail the build')

console.log(
  failed === 0
    ? `\n✓ boundaries selftest: ${CASES.length + 1} injected violations, every gate fired`
    : `\n✗ boundaries selftest: ${failed} gate(s) did not fire — the engine is vacuous`,
)
process.exit(failed === 0 ? 0 : 1)
