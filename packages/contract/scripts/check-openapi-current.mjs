#!/usr/bin/env node
// Asserts the committed `openapi.json` still matches what the schemas emit.
//
// The document is committed because it is the artefact a native repo generates its models from
// (WP3-3), and a committed generated file has exactly one failure mode: someone edits the source and
// forgets to re-run the generator. Then the schemas say one thing, the published contract says
// another, and the iOS client is built from the stale one. This turns that into a red build.
//
// Deliberately compares the *parsed* documents rather than the file bytes, so a formatting-only
// difference doesn't fail the build with a diff nobody can read.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const committedPath = join(pkgRoot, 'openapi.json')

if (!existsSync(committedPath)) {
  console.error('✗ openapi.json is missing — run `pnpm --filter @nextbus/contract openapi:emit`.')
  process.exit(1)
}

// Build the document in a child process via tsx: this script is plain `.mjs` (so it needs no
// toolchain to run in CI) while the document builder is TypeScript.
let freshJson
try {
  freshJson = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      "import { buildOpenApiDocument } from './src/openapi.ts'; process.stdout.write(JSON.stringify(buildOpenApiDocument()))",
    ],
    { cwd: pkgRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (err) {
  console.error('✗ could not build the OpenAPI document:\n')
  console.error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message)
  process.exit(1)
}

const fresh = JSON.parse(freshJson)
const committed = JSON.parse(readFileSync(committedPath, 'utf8'))

if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
  console.error(
    '✗ openapi.json is stale — the wire schemas have changed since it was emitted.\n\n' +
      '  Run: pnpm --filter @nextbus/contract openapi:emit\n\n' +
      '  Then review the diff. If it removes or renames anything, that is a **breaking** change:\n' +
      '  it needs an ADR and a deprecation window, not just a re-emit (ADR-052 §5).',
  )
  process.exit(1)
}

const paths = Object.keys(fresh.paths).length
const schemas = Object.keys(fresh.components.schemas).length
console.log(`✓ openapi.json is current — ${paths} paths, ${schemas} component schemas.`)
