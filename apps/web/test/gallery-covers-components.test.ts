// The gate that keeps the gallery's **live samples** covering every component this renderer has.
//
// WHY IT EXISTS. `gallery-covers-specs.test.ts` already stops a published *spec* from going unlisted, but a
// spec is a screen-or-row contract and most of what `src/components/` holds has none: `BusGlyph`, `MiniMap`,
// `SlideNumber` and `BottomSheet` are all real components with real states and no `.spec.json` of their own.
// The owner's ask was the whole set — "find all the components, both primitive and multi-part … render each
// one in each state" — and a set that is complete today and hand-maintained is a set that is incomplete by
// the third new component. So the *directory* is the subject here, exactly as the `ui/` directory is the
// subject there.
//
// WHAT IT ASSERTS, IN BOTH DIRECTIONS.
//
//   · every exported component in `src/components/` has a sample group, so adding one without a group is a
//     red build rather than a silent gap in the gallery;
//   · every group names a component that exists, so deleting one cannot leave a phantom row behind.
//
// WHAT COUNTS AS A COMPONENT. An `export function` whose name is PascalCase. That is the whole convention in
// this directory and it is worth stating why it is enough rather than parsing: an exported `const` here is a
// geometry constant (`RAIL_WIDTH`, `NODE_CENTRE`) or a tone table, never a component, and a component
// written as an arrow const would be the first — at which point this test fails loudly on the file that
// introduced it, which is the correct moment to have the conversation.
//
// `.ts` rather than `.tsx`: it reads file names and source text and renders nothing.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SAMPLES } from '../lab/samples'

/** This app's `src/components`, found by walking up — the approach `dev-pages.test.mjs` documents. */
function componentDir(): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'apps', 'web', 'src', 'components')
    try {
      readdirSync(candidate)
      return candidate
    } catch {
      const parent = dirname(dir)
      if (parent === dir) throw new Error('apps/web/src/components not found from ' + process.cwd())
      dir = parent
    }
  }
}

const dir = componentDir()
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.tsx'))
  .sort()

/** Every exported component, as `Name` → the file that declares it. */
const declared = new Map<string, string>()
for (const file of files) {
  const source = readFileSync(join(dir, file), 'utf8')
  for (const match of source.matchAll(/^export function ([A-Z]\w*)\s*\(/gm)) {
    const name = match[1]
    if (name) declared.set(name, file)
  }
}

/**
 * The components a group covers.
 *
 * A group may name more than one — `BottomSheet · SheetAction` is one review, because the action row is
 * only ever seen inside the container and reviewing them apart would be reviewing neither. The separator is
 * the app's own `·`, so the group title stays a sentence rather than becoming a machine-readable list.
 */
const covered = new Set(
  SAMPLES.flatMap((group) => group.component.split('·').map((part) => part.trim())),
)

describe('the gallery samples cover every component in this renderer', () => {
  it('finds the components at all', () => {
    // The anti-vacuous control: a regex that stopped matching would otherwise make every assertion below
    // pass over an empty set, and the page would look complete while covering nothing.
    expect(files.length, 'no component files found').toBeGreaterThan(10)
    expect(
      declared.size,
      'no exported components found — did the export style change?',
    ).toBeGreaterThan(15)
  })

  it('gives every exported component a sample group', () => {
    const missing = [...declared]
      .filter(([name]) => !covered.has(name))
      .map(([name, file]) => `${name} (${file})`)
    expect(missing, 'these components have no panel in lab/samples.tsx').toEqual([])
  })

  it('names no component that does not exist', () => {
    const phantom = [...covered].filter((name) => !declared.has(name))
    expect(phantom, 'these sample groups name a component that is gone').toEqual([])
  })

  it('puts every group in a tier the page renders', () => {
    // The page filters by `tier`; a group with a tier no section asks for would vanish from the gallery
    // while every other gate here still passed.
    for (const group of SAMPLES) {
      expect(['leaf', 'composed', 'overlay'], group.component).toContain(group.tier)
    }
  })
})
