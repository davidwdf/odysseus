#!/usr/bin/env node
/**
 * `pnpm boundaries` — the three gates that make layers.json true (ADR-051):
 *   1. drift: the generated configs still match what layers.json says they should be;
 *   2. dependency-cruiser: no forbidden edge, direct or transitive;
 *   3. determinism: no banned syntax in a layer that declares some (the kernel's clock/randomness).
 * Every gate reports what it *looked at*, not just its verdict — a boundary check that silently
 * matches nothing is the failure mode this whole work package exists to avoid.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { cruise } from 'dependency-cruiser'
import { generate, ids, layerDirs, ROOT, spec } from './generate.mjs'

const SOURCE = /\.(m?[jt]sx?|cjs|cts)$/
const rel = (base, p) => path.relative(base, p).split(path.sep).join('/')

/** @returns the generated files whose on-disk text no longer matches layers.json. */
export const drift = (files = generate()) =>
  files.filter(({ file, text }) => readFileSync(path.join(ROOT, file), 'utf8') !== text)

/** Layer dirs that exist under `baseDir` — `packages/ports` may not have landed yet. */
export const presentDirs = (baseDir) =>
  ids.flatMap(layerDirs).filter((d) => existsSync(path.join(baseDir, d)))

/** Every source file under `dir`, vendored and generated code excluded — a layer's rules police what
 *  we wrote, in the form we wrote it.
 *
 *  This mattered the moment `bannedSyntax` grew a `view` entry: the kernel's dir is
 *  `packages/core/src`, which has no `node_modules` beneath it, but `view`'s is all of `apps/mobile`,
 *  which does. Without this the gate would report hits inside React Native's own `.d.ts` files.
 *
 *  `dist` and the tool caches are skipped for a sharper reason, found at Wave 3 integration: a
 *  bundled `apps/mobile/dist/**` is a *snapshot of yesterday's source*. Three `view` rules fired on
 *  a stale `build:web` output — flagging pre-ICU `.replace('{n}')` calls that no longer exist in any
 *  file a human edits. A gate that goes red because of a build artefact is a gate people learn to
 *  ignore, and it is red only for whoever happens to have built recently, which is worse than always.
 *  Mirrors `biome.json`'s `files.includes` exclusions and cruiser's `doNotFollow`. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.expo', '.wrangler', '.dataset'])
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    SKIP_DIRS.has(e.name)
      ? []
      : e.isDirectory()
        ? walk(path.join(dir, e.name))
        : [path.join(dir, e.name)],
  )

/** @returns {{file: string, line: number, pattern: string, why: string, layer: string}[]} */
export function bannedSyntax(baseDir) {
  const hits = []
  for (const id of ids)
    for (const dir of layerDirs(id).filter((d) => existsSync(path.join(baseDir, d))))
      for (const file of walk(path.join(baseDir, dir)).filter((f) => SOURCE.test(f)))
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((text, i) => {
            for (const { pattern, why } of spec.layers[id].bannedSyntax ?? [])
              if (new RegExp(pattern).test(text))
                hits.push({ layer: id, file: rel(baseDir, file), line: i + 1, pattern, why })
          })
  return hits
}

/** @returns {{violations: object[], modulesPerLayer: Record<string, number>}} */
export async function cruiseLayers(baseDir) {
  const ruleSet = JSON.parse(readFileSync(path.join(ROOT, '.dependency-cruiser.json'), 'utf8'))
  const dirs = presentDirs(baseDir)
  const { output } = await cruise(dirs, { ...ruleSet.options, ruleSet, baseDir, validate: true })
  const result = typeof output === 'string' ? JSON.parse(output) : output
  const modulesPerLayer = Object.fromEntries(
    ids
      .filter((id) => layerDirs(id).some((d) => dirs.includes(d)))
      .map((id) => [
        id,
        result.modules.filter((m) => layerDirs(id).some((d) => m.source.startsWith(`${d}/`)))
          .length,
      ]),
  )
  return {
    violations: result.summary.violations,
    modulesPerLayer,
    total: result.summary.totalCruised,
  }
}

if (process.argv[1] === import.meta.filename) {
  const fail = (msg) => {
    console.error(`✗ ${msg}`)
    process.exitCode = 1
  }

  const drifted = drift()
  if (drifted.length > 0)
    fail(
      `${drifted.map((d) => d.file).join(' and ')} no longer match layers.json — ` +
        'run `pnpm boundaries:gen` and commit the result.',
    )
  else console.log('✓ .dependency-cruiser.json and biome.json match layers.json')

  const { violations, modulesPerLayer, total } = await cruiseLayers(ROOT)
  for (const v of violations)
    console.error(
      `  · ${v.rule.name}: ${v.from} → ${v.to}${v.cycle ? ` (${v.cycle.length}-cycle)` : ''}`,
    )
  const empty = Object.entries(modulesPerLayer).filter(([, n]) => n === 0)
  if (violations.length > 0) fail(`${violations.length} boundary violation(s)`)
  else if (empty.length > 0)
    fail(
      `these layers matched zero modules, so their rules prove nothing: ${empty
        .map(([id]) => id)
        .join(', ')} — did a directory move without a layers.json edit?`,
    )
  else
    console.log(
      `✓ no forbidden edge in ${total} modules — ` +
        Object.entries(modulesPerLayer)
          .map(([id, n]) => `${id} ${n}`)
          .join(', '),
    )

  const hits = bannedSyntax(ROOT)
  for (const h of hits) console.error(`  · ${h.file}:${h.line} matches /${h.pattern}/ — ${h.why}`)
  if (hits.length > 0) fail(`${hits.length} banned-syntax hit(s)`)
  else console.log('✓ no banned syntax in the layers that declare some')
}
