#!/usr/bin/env node
// Gate for ADR-052 decision (2): `@nextbus/core` derives its types from `@nextbus/contract`, but
// must depend on it — and on zod — **at type level only**.
//
// Why this needs a mechanical check rather than a code-review habit: the failure is invisible. Swap
// one `import type` for a plain `import` and everything still typechecks, still passes every test
// and still runs correctly in dev. The only symptom is that zod is now bundled into the app that
// every screen imports, and that `packages/core` — the layer we intend to hand-port to Swift and
// Kotlin — has acquired a runtime dependency on a TypeScript-only validation library. Nobody
// notices that in review; a bundle just quietly gets bigger and a boundary quietly stops being true.
//
// Method: emit the package with tsc and read what actually came out. This asserts the property we
// care about (nothing survives into the JavaScript) rather than a proxy for it (the source says
// `import type`), so it also catches the cases a grep would miss — a re-export chain, a decorator
// metadata emit, a default import used only in a type position by accident.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'nextbus-core-emit-'))

/**
 * `.npmrc` sets `node-linker=hoisted`, so the `tsc` shim lives at the workspace root rather than in
 * this package. Walk up rather than hard-coding either location, so the check survives a linker
 * change instead of failing with a bare ENOENT that looks like a broken script.
 */
function resolveTsc() {
  for (let dir = pkgRoot; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', '.bin', 'tsc')
    if (existsSync(candidate)) return candidate
    if (dirname(dir) === dir)
      throw new Error('could not find a tsc binary in any parent node_modules')
  }
}

/** Every path under `dir`, recursively. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

try {
  // `--removeComments` matters: without it this check fails on its own documentation. The header of
  // `src/types.ts` explains at length why the imports are type-only, and therefore contains the
  // strings "@nextbus/contract" and "zod" — which a substring search over the emit reads as a
  // runtime reference. We care about emitted *code*, so strip the prose before looking.
  try {
    execFileSync(
      resolveTsc(),
      ['--noEmit', 'false', '--outDir', outDir, '--declaration', 'false', '--removeComments'],
      { cwd: pkgRoot, stdio: 'pipe' },
    )
  } catch (err) {
    // tsc reports diagnostics on stdout. Surface them: "the compile failed" is a completely
    // different problem from "the boundary leaked", and a stack trace here reads as a broken script.
    const diagnostics = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    console.error('✗ tsc failed, so the boundary could not be checked:\n')
    console.error(diagnostics || err.message)
    process.exit(1)
  }

  const emitted = walk(outDir).filter((f) => f.endsWith('.js'))
  if (emitted.length === 0) {
    console.error('✗ nothing was emitted — the check cannot prove anything. Did tsc config change?')
    process.exit(1)
  }

  const failures = []

  // 1. No emitted JavaScript may reference the contract package or zod.
  for (const file of emitted) {
    const src = readFileSync(file, 'utf8')
    for (const forbidden of ['@nextbus/contract', 'zod']) {
      if (src.includes(forbidden)) {
        failures.push(
          `${file.slice(outDir.length + 1)} references "${forbidden}" at runtime — ` +
            'change the import to `import type`.',
        )
      }
    }
  }

  // 2. `types.ts` is pure type declarations, so it must emit an empty module. If this file ever
  //    emits real code, a value crept into the canonical model.
  const typesJs = emitted.find((f) => f.endsWith('types.js'))
  if (!typesJs) {
    failures.push('types.js was not emitted — expected an empty module, got nothing.')
  } else {
    const body = readFileSync(typesJs, 'utf8')
      .replace(/^export\s*\{\s*\}\s*;?\s*$/gm, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim()
    if (body !== '') {
      failures.push(`types.js is not an empty module — it emitted:\n${body}`)
    }
  }

  if (failures.length > 0) {
    console.error('✗ @nextbus/core has leaked a runtime dependency (ADR-052):\n')
    for (const f of failures) console.error(`  · ${f}`)
    console.error('\nSee packages/core/src/types.ts for why this matters.')
    process.exit(1)
  }

  const files = emitted.length
  console.log(
    `✓ type-only contract boundary holds — ${files} emitted file(s), none reference zod or ` +
      '@nextbus/contract; types.js is an empty module.',
  )
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
