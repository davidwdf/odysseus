#!/usr/bin/env node
// Asserts the committed `ui/*.spec.json` still match what `src/ui/` declares (WP6-1).
//
// The documents are committed because they are the artefact a renderer's conformance suite reads — this
// repo's two today, a Swift one at WP6-9 — and a committed generated file has exactly one failure mode:
// someone edits the declaration and forgets to re-run the generator. Then the source says one thing, the
// published spec says another, and **the suites keep passing against the stale one**. That is worse here
// than for `openapi.json`: a stale wire document produces a decode error eventually, while a stale
// component spec produces a *green* conformance run pinning a rule that has moved. Same failure the corpus
// vendoring problem has, one layer up (ADR-067).
//
// Three things are checked, not one:
//   1. every committed file matches its declaration (the drift gate proper);
//   2. every declaration has a committed file (a new spec that was never emitted);
//   3. every committed file has a declaration (a spec that was deleted or renamed, leaving an orphan that
//      no suite would ever notice — the direction people forget, and the one `check-spec-coverage.mjs`
//      exists to catch for the corpus).
//
// Compares the *parsed* documents rather than the bytes, so a formatting-only difference does not fail the
// build with a diff nobody can read.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const uiDir = join(pkgRoot, 'ui')
const rerun = 'Run: pnpm --filter @nextbus/contract ui:emit'

// Build the specs in a child process via tsx: this script is plain `.mjs` (so it needs no toolchain to run
// in CI) while the declarations are TypeScript.
let freshJson
try {
  freshJson = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      "import { UI_SPECS } from './src/ui/index.ts';" +
        "import { parseComponentSpec } from '@nextbus/ui-spec';" +
        'const out = {};' +
        'for (const [stem, spec] of Object.entries(UI_SPECS)) out[stem] = parseComponentSpec(spec);' +
        'process.stdout.write(JSON.stringify(out))',
    ],
    { cwd: pkgRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (err) {
  // A schema violation lands here, and it is the useful failure: the message names the component, the
  // field and the reason, because `parseComponentSpec` resolves the cross-references a type cannot.
  console.error('✗ could not build the component specs — a declaration is invalid:\n')
  console.error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message)
  process.exit(1)
}

const fresh = JSON.parse(freshJson)
const declared = Object.keys(fresh)
if (declared.length === 0) {
  console.error('✗ no component specs are declared, so this check would pass by comparing nothing.')
  process.exit(1)
}

const committed = existsSync(uiDir)
  ? readdirSync(uiDir)
      .filter((file) => file.endsWith('.spec.json'))
      .map((file) => file.replace(/\.spec\.json$/, ''))
  : []

let failed = 0
for (const stem of declared) {
  if (!committed.includes(stem)) {
    console.error(
      `✗ ui/${stem}.spec.json is missing — it is declared but was never emitted.\n  ${rerun}`,
    )
    failed += 1
    continue
  }
  const onDisk = JSON.parse(readFileSync(join(uiDir, `${stem}.spec.json`), 'utf8'))
  if (JSON.stringify(onDisk) !== JSON.stringify(fresh[stem])) {
    console.error(
      `✗ ui/${stem}.spec.json is stale — src/ui/ has changed since it was emitted.\n\n` +
        `  ${rerun}\n\n` +
        '  Then review the diff. Removing a slot, or relaxing a `mustNot`, changes what every renderer\n' +
        '  is held to — that needs the conversation an ADR is for, not just a re-emit.',
    )
    failed += 1
  }
}
for (const stem of committed) {
  if (!declared.includes(stem)) {
    console.error(
      `✗ ui/${stem}.spec.json is an orphan — no declaration in src/ui/ produces it.\n` +
        '  A spec no suite is measured against passes for ever. Delete the file, or restore its\n' +
        '  entry in src/ui/index.ts.',
    )
    failed += 1
  }
}

if (failed > 0) process.exit(1)

const slots = declared.reduce((total, stem) => total + fresh[stem].slots.length, 0)
console.log(
  `✓ ui/*.spec.json are current — ${declared.length} component spec(s), ` +
    `${slots} top-level slot(s), validated against the schema.`,
)
