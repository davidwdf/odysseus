#!/usr/bin/env node
/**
 * layers.json → .dependency-cruiser.json + the `overrides` block of biome.json (ADR-051).
 * `node scripts/boundaries/generate.mjs` writes both; check.mjs imports it to gate drift.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../..')
const NM = '(^|/)node_modules/'
const WHY = 'boundary declared in layers.json (ADR-051)'
export const spec = JSON.parse(readFileSync(path.join(ROOT, 'layers.json'), 'utf8'))
export const ids = Object.keys(spec.layers)
export const layerDirs = (id) => spec.layers[id].dirs
const rxOf = (id) => layerDirs(id).map((d) => `^${d}/`)
const globOf = (id) => layerDirs(id).map((d) => `${d}/**`)
const allowed = (id) => [...spec.layers[id].use, ...(spec.layers[id].useTypeOnly ?? [])]
const forbidden = (id) => ids.filter((o) => o !== id && !allowed(id).includes(o))
const nmRx = (m) => `${NM}${m.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}/`

/** dependency-cruiser: per layer a workspace rule, an npm rule, type-only rules and a reach rule. */
function cruiserRules() {
  const rules = []
  const rule = (name, comment, from, to) =>
    rules.push({ name, comment: `${comment} — ${WHY}`, severity: 'error', from, to })
  for (const id of ids) {
    const L = spec.layers[id]
    const from = { path: rxOf(id), pathNot: NM }
    const closed = Array.isArray(L.npm)
    rule(
      `layer-${id}`,
      `${id} may import only [${allowed(id).join(', ') || 'nothing'}]`,
      from,
      closed
        ? { pathNot: [...rxOf(id), ...allowed(id).flatMap(rxOf), NM, '^node:'] }
        : { path: forbidden(id).flatMap(rxOf) },
    )
    if (closed)
      rule(
        `layer-${id}-npm`,
        `${id}'s only npm packages are [${L.npm.join(', ') || 'none'}]`,
        from,
        { path: NM, pathNot: [...L.npm, ...(L.npmTypeOnly ?? [])].map(nmRx) },
      )
    else if (L.npm === 'non-view')
      rule(
        `layer-${id}-npm`,
        `${id} does not render, so the view-only packages are off limits`,
        from,
        { path: spec.viewOnly.map(nmRx) },
      )
    for (const [target, to] of [
      ...(L.useTypeOnly ?? []).map((t) => [t, rxOf(t)]),
      ...(L.npmTypeOnly ?? []).map((m) => [m, nmRx(m)]),
    ])
      rule(
        `layer-${id}-type-only-${target.replace(/[^a-z0-9]+/gi, '-')}`,
        `${id} → ${target} is a type-only edge: \`import type\` or nothing`,
        from,
        { path: to, dependencyTypesNot: ['type-only'] },
      )
    if (forbidden(id).length)
      rule(
        `layer-${id}-reach`,
        `${id} must not reach [${forbidden(id).join(', ')}], not even via an allowed hop`,
        from,
        { path: forbidden(id).flatMap(rxOf), reachable: true },
      )
  }
  rule(
    'no-circular',
    'a cycle means the layers are not layers',
    { pathNot: NM },
    { circular: true },
  )
  return rules
}

/** The manifest owning a policed dir. Stops short of the repo root, so an unlanded layer
 *  (`packages/ports` before WP1-3 merges) contributes no name rather than the root's. */
function nearestManifest(dir) {
  for (let d = path.join(ROOT, dir); d !== ROOT; d = path.dirname(d)) {
    const p = path.join(d, 'package.json')
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).name
  }
}

const pkgNames = (id) => layerDirs(id).map(nearestManifest).filter(Boolean)

/** Biome: a textual second net per layer (blind to two-hop reach and to `import type`). */
function biomeOverrides() {
  return ids.map((id) => {
    const L = spec.layers[id]
    const group = [...forbidden(id).flatMap(pkgNames), ...(L.npm === 'any' ? [] : spec.viewOnly)]
    const style = {
      noRestrictedImports: {
        level: 'error',
        options: { patterns: [{ group, message: `not importable from ${id} — ${WHY}` }] },
      },
    }
    if (L.deniedGlobals)
      style.noRestrictedGlobals = {
        level: 'error',
        options: {
          deniedGlobals: Object.fromEntries(
            L.deniedGlobals.map((g) => [g, `no ${g} in ${id} — ${WHY}`]),
          ),
        },
      }
    return { includes: globOf(id), linter: { rules: { style } } }
  })
}

const format = (text, file) =>
  execFileSync('node_modules/.bin/biome', ['format', `--stdin-file-path=${file}`], {
    cwd: ROOT,
    input: text,
    encoding: 'utf8',
  })

/** @returns {{file: string, text: string}[]} the generated artefacts, Biome-formatted. */
export function generate() {
  const biome = JSON.parse(readFileSync(path.join(ROOT, 'biome.json'), 'utf8'))
  biome.overrides = biomeOverrides()
  return [
    { file: '.dependency-cruiser.json', text: JSON.stringify(cruiser(), null, 2) },
    { file: 'biome.json', text: JSON.stringify(biome, null, 2) },
  ].map(({ file, text }) => ({ file, text: format(text, file) }))
}

const cruiser = () => ({
  forbidden: cruiserRules(),
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: NM },
    exclude: { path: 'scripts/boundaries/fixtures' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require'] },
  },
})

if (process.argv[1] === import.meta.filename)
  for (const { file, text } of generate()) {
    writeFileSync(path.join(ROOT, file), text)
    console.log(`boundaries: wrote ${file}`)
  }
