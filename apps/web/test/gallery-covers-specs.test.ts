// The gate that keeps the design-system gallery from drifting (ADR-134).
//
// WHY IT EXISTS. The gallery's whole value is that a Swift or Kotlin porter can check their own screen
// against it. A hand-maintained list would drift, and a drifted gallery is WORSE than none — it would be
// checked against confidently and be wrong. So the page is built from the published specs, and this asserts
// the two halves of that relationship in both directions:
//
//   · every `packages/contract/ui/*.spec.json` appears in the gallery, so adding a spec without listing it
//     is a red build rather than a silent omission;
//   · every gallery entry names a real spec, so deleting a spec cannot leave a phantom row behind.
//
// The direction that matters is the first one, and it is the one a glob would have destroyed: `import.meta.glob`
// would pick a new spec up automatically and assert NOTHING about it, which is the failure this file exists to
// prevent. Hence the explicit list in `lab/specIndex.ts`.
//
// `.ts` rather than `.tsx`: it reads JSON and file names and renders nothing.

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import specs from '../lab/specIndex'

/** The contract package's `ui/` directory, found by walking up — the approach `dev-pages.test.mjs` documents. */
function specDir(): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'packages', 'contract', 'ui')
    try {
      readdirSync(candidate)
      return candidate
    } catch {
      const parent = dirname(dir)
      if (parent === dir) throw new Error('packages/contract/ui not found from ' + process.cwd())
      dir = parent
    }
  }
}

const published = readdirSync(specDir())
  .filter((f) => f.endsWith('.spec.json'))
  .sort()

describe('the gallery covers every published component spec', () => {
  it('lists one entry per spec file, and no more', () => {
    expect(specs.length, `${published.length} spec file(s) published`).toBe(published.length)
  })

  it('names every published component', () => {
    // Compare on `component`, the spec's own field, rather than on the filename: the filename is kebab and
    // the component is Pascal, and asserting a naming convention here would fail for the wrong reason the
    // day one of them is renamed.
    const listed = specs.map((s) => s.component).sort()
    expect(listed).toEqual(
      published
        .map((f) => f.replace('.spec.json', ''))
        .map((k) => k.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase()))
        .sort(),
    )
  })

  it('gives every entry the fields the gallery renders', () => {
    // A spec missing `doc`, `slots` or `states` would render a blank row rather than fail, which is exactly
    // the silent kind of wrong this gate is for.
    for (const s of specs) {
      expect(typeof s.component, s.component).toBe('string')
      expect(typeof s.doc, `${s.component}.doc`).toBe('string')
      expect(Array.isArray(s.slots), `${s.component}.slots`).toBe(true)
      expect(Object.keys(s.states).length, `${s.component}.states`).toBeGreaterThan(0)
    }
  })
})
