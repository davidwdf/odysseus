#!/usr/bin/env node
/**
 * Gate: `@nextbus/ports` must contain no runtime code.
 *
 * "Type-only" is easy to claim and easy to lose — one `export const DEFAULT_ZOOM = 11` and the
 * package has a runtime, meaning bundlers must include it, `core` could import a value from it,
 * and a Swift port has behaviour to replicate that nobody wrote down. Review does not reliably
 * catch that, so the compiler decides: emit the whole package to a temporary directory and
 * assert every produced `.js` file is an empty module.
 *
 * Emptiness is judged after stripping comments and the module scaffolding TypeScript adds to a
 * declaration-only file (`export {}`, `"use strict"`, the `__esModule` marker). Anything left is
 * runtime code and fails the check, naming the file and the offending residue.
 *
 * Two guards against a vacuous pass, which is the usual way a check like this rots:
 *  - the emit must produce at least one `.js` file (a broken `include` would otherwise "pass");
 *  - every `.ts` file under `src/` must have a corresponding emitted `.js` to inspect.
 *
 * Run: `pnpm --filter @nextbus/ports test`
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(pkgRoot, 'src')
const outDir = mkdtempSync(join(tmpdir(), 'nextbus-ports-emit-'))

/** Every file with `ext` below `dir`, as absolute paths. */
function walk(dir, ext) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, ext))
    else if (entry.name.endsWith(ext)) found.push(path)
  }
  return found
}

/**
 * What TypeScript legitimately emits for a file that declares only types. Comments go first so
 * that a `//`-commented-out statement is not mistaken for code.
 */
function residue(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^\s*(['"])use strict\1;?\s*$/gm, '')
    .replace(/^\s*Object\.defineProperty\(exports,\s*(['"])__esModule\1,.*$/gm, '')
    .replace(/^\s*exports\.\w+\s*=\s*void 0;?\s*$/gm, '')
    .replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, '')
    .trim()
}

let failures = 0
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  failures++
}

try {
  // `-p` supplies the package's own tsconfig (strictness, `types: []`); the flags override its
  // `noEmit` so we get JavaScript to inspect, without declarations or maps cluttering the tree.
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  execFileSync(
    process.execPath,
    [tsc, '-p', pkgRoot, '--outDir', outDir, '--noEmit', 'false', '--declaration', 'false'],
    { stdio: 'inherit' },
  )

  const emitted = walk(outDir, '.js')
  if (emitted.length === 0) {
    fail(
      'no .js was emitted at all — the tsconfig "include" is probably wrong, so this check ' +
        'would have passed without inspecting anything',
    )
  }

  const sources = walk(srcDir, '.ts').filter((p) => !p.endsWith('.d.ts'))
  for (const source of sources) {
    const expected = join(outDir, relative(srcDir, source).replace(/\.ts$/, '.js'))
    if (!emitted.includes(expected)) fail(`no emit found for src/${relative(srcDir, source)}`)
  }

  for (const file of emitted) {
    const code = residue(readFileSync(file, 'utf8'))
    if (code !== '') {
      fail(
        `${relative(outDir, file)} emitted runtime code — @nextbus/ports must be type-only:\n` +
          code
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n'),
      )
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(
    `\n${failures} problem(s). @nextbus/ports declares platform seams only: no const, no enum, ` +
      'no default implementation. Move the value into the platform adapter that needs it.',
  )
  process.exit(1)
}
console.log(
  `✓ @nextbus/ports is type-only (${walk(srcDir, '.ts').length} modules, no runtime emit)`,
)
