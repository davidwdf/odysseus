#!/usr/bin/env node
/**
 * Emit `packages/contract/ui/<component>.spec.json` from the declarations in `src/ui/` (WP6-1).
 *
 *   pnpm --filter @nextbus/contract ui:emit
 *
 * Same shape and the same reasons as `emit-openapi.mts`: the declaration is TypeScript, the artefact is
 * committed JSON, and `check-ui-specs-current.mjs` fails the build on a stale copy. The artefact is what
 * ships — a Swift or Kotlin suite reads the JSON, not the TypeScript — and `packages/contract/README.md`
 * is where that reader starts, which is why these live here rather than beside the components.
 *
 * **Every spec is validated before it is written**, by the same `parseComponentSpec` the conformance
 * walker calls at test time. That is the difference between a malformed spec being a build failure and it
 * being a surprise in Xcode six months from now (ADR-075 decision 3), and it catches the class of error a
 * type cannot: a `states.failed.enforcement.by` naming a slot that has since been renamed is well-typed
 * and wrong.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseComponentSpec } from '@nextbus/ui-spec'
import { UI_SPECS } from '../src/ui/index.ts'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(pkgRoot, 'ui')
mkdirSync(outDir, { recursive: true })

if (Object.keys(UI_SPECS).length === 0) {
  // A generator that emits nothing would leave the drift gate comparing an empty set for ever.
  throw new Error('UI_SPECS is empty — nothing to emit, which cannot be right')
}

for (const [stem, declared] of Object.entries(UI_SPECS)) {
  const spec = parseComponentSpec(declared)
  const path = join(outDir, `${stem}.spec.json`)
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`)
  const states = Object.values(spec.states)
  // Broken out by *how* each state is held to, because that is the number worth watching: a spec drifting
  // toward `unenforced` is a specification quietly becoming decoration, and it would be invisible in a
  // total.
  const by = (kind: string) => states.filter((state) => kind in state.enforcement).length
  console.log(
    `  wrote ui/${stem}.spec.json — ${countSlots(spec.slots)} slots, ` +
      `${states.length} states (${by('shows')} projected, ${by('by')} by a slot, ` +
      `${by('knownDefect')} known defect, ${by('unenforced')} unenforced), ` +
      `${spec.interactions.length} interactions, ${spec.idiom.length} idiom entries`,
  )
}

console.log(`✓ ${Object.keys(UI_SPECS).length} component spec(s) emitted and validated.`)

/** Slots including nested ones, so the figure means "declared text sites" rather than "top-level keys". */
function countSlots(nodes: readonly unknown[]): number {
  let total = 0
  for (const node of nodes as Array<Record<string, unknown>>) {
    total += 1
    if (Array.isArray(node.of)) total += countSlots(node.of)
    if (node.cases && typeof node.cases === 'object') {
      for (const branch of Object.values(node.cases as Record<string, unknown[]>)) {
        total += countSlots(branch)
      }
    }
  }
  return total
}
