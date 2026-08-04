// WP6-0's parity harness: **the shell's identity, bound to the reference implementation while it exists.**
//
// WHY A TEST THAT READS ANOTHER APP'S SOURCE
// ADR-075 redefines "no drift" from *the UIs match* to *every renderer satisfies the same spec*, and it
// puts three things on the identity side that WP6-0 implements twice: the **destination set**, ADR-058's
// **persisted-cache policy**, and — implicitly, because a rider's data depends on it — **which storage
// key each store owns**. None of them is expressible as a component spec (they are not components), and
// none has a corpus (they are not domain rules), so the honest binding available today is to read
// `apps/mobile`'s declaration and fail when the two disagree.
//
// This file is therefore **deliberately temporary**. It dies with `apps/mobile` at WP6-8, and that is the
// correct lifetime: it exists to keep two renderers' shells identical *while both ship*. What survives is
// `src/shell/destinations.ts` — the declaration — which is the thing a third renderer would read.
//
// ADR-069 decision 7's rule ("the two projections are duplicated on purpose, not shared") is not in
// tension with this. That rule is about production helpers, where sharing lets one edit relax every
// renderer at once. A test that compares two independent declarations is the opposite move.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PREFERENCES_STORAGE_KEY } from '../src/lib/preferences'
import { PERSISTED_CACHE } from '../src/providers/QueryProvider'
import { DESTINATIONS } from '../src/shell/destinations'

/**
 * `apps/mobile`, found by walking up from the working directory.
 *
 * Neither obvious answer works. `import.meta.url` is an `http://localhost/…` URL under the jsdom
 * environment, because vitest serves each module over http — `fileURLToPath` rejects it outright. And a
 * fixed `../mobile` relative to `process.cwd()` is right only when vitest is invoked from `apps/web`; run
 * it from the repo root and the path resolves *outside the repo*, `readFileSync` throws at import time,
 * and the whole suite is reported as a failed **file** rather than as failed **tests** — which is how the
 * first draft of this file appeared to pass while asserting nothing. Walking up until `apps/mobile/app`
 * exists is invariant to both.
 */
function findMobileApp(): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'apps', 'mobile')
    if (existsSync(join(candidate, 'app'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no apps/mobile above ${process.cwd()}`)
    dir = parent
  }
}

const MOBILE = findMobileApp()
const read = (relative: string) => readFileSync(join(MOBILE, relative), 'utf8')
/** This app's own source, addressed the same cwd-independent way. */
const readWeb = (relative: string) => readFileSync(join(dirname(MOBILE), 'web', relative), 'utf8')

/**
 * Destinations `apps/mobile` serves that are deliberately **not** in the web shell's set. Each needs a
 * reason, because an unexplained entry here is how a missing screen hides: the exclusion list is the one
 * part of this comparison a careless edit can widen until the assertion means nothing.
 */
const NOT_A_RIDER_DESTINATION: Record<string, string> = {
  '/workbench': [
    'The component gallery. `proposals/04` puts it with the token layer rather than with a screen, and',
    'it is developer chrome either way — a rider has no route to it and the tab bar never names it.',
  ].join(' '),
}

/**
 * The routes expo-router derives from `apps/mobile/app/**`, in react-router's spelling.
 *
 * The mapping is expo-router's file convention, which is worth stating because every line of it is a
 * chance to be wrong: `_`-prefixed files are layouts, `+`-prefixed ones are its own conventions
 * (`+html`), a `(group)` segment is organisational and contributes nothing to the URL, `index` is the
 * segment's own path, and `[id]` is a parameter — spelled `:id` by react-router.
 */
function expoRouterPaths(dir = 'app', prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(MOBILE, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`
      out.push(...expoRouterPaths(join(dir, entry.name), segment))
      continue
    }
    if (!entry.name.endsWith('.tsx')) continue
    if (entry.name.startsWith('_') || entry.name.startsWith('+')) continue
    const stem = entry.name.replace(/\.tsx$/, '').replace(/^\[(.+)\]$/, ':$1')
    out.push(stem === 'index' ? prefix || '/' : `${prefix}/${stem}`)
  }
  return out
}

describe('the destination set is identity, and both renderers declare the same one', () => {
  it('found expo-router routes at all', () => {
    // The anti-vacuous control. A moved directory would make `expoRouterPaths()` return `[]`, and every
    // assertion below would pass by comparing nothing — the exact shape of the four gates Wave 3 found
    // looking at nothing.
    expect(expoRouterPaths().length).toBeGreaterThanOrEqual(8)
  })

  it('serves every rider destination the RN app serves', () => {
    const expected = expoRouterPaths()
      .filter((path) => !(path in NOT_A_RIDER_DESTINATION))
      .sort()
    const declared = DESTINATIONS.map((d) => d.path).sort()
    expect(declared).toEqual(expected)
  })

  it('names every excluded route, so the exclusion list cannot quietly grow', () => {
    // An entry that no longer corresponds to a real route is rot in the other direction: it would let a
    // future destination be dropped by name without anyone noticing the reason had expired.
    const actual = expoRouterPaths()
    for (const path of Object.keys(NOT_A_RIDER_DESTINATION)) expect(actual).toContain(path)
  })

  it('gives every unported destination an owning work package', () => {
    // A route that renders a placeholder nobody has agreed to replace is a promise, not a plan. So the list
    // of owner-less destinations is exactly the list of **ported** ones, and it grows one row at a time:
    // Nearby at WP6-0, Place detail at WP6-3b. Asserted as an equality rather than a count, so a
    // destination that quietly loses its owner without gaining a screen goes red.
    const unowned = DESTINATIONS.filter((d) => !d.owner).map((d) => d.path)
    expect(unowned).toEqual(['/', '/stop/:id'])
    for (const d of DESTINATIONS) {
      if (d.owner) expect(d.owner).toMatch(/^WP6-\d+$/)
    }
  })
})

/**
 * Evaluate a plain numeric literal expression — `24 * 60 * 60 * 1000`, `15_000`.
 *
 * Multiplication and digits only, asserted before anything is computed. The alternative was `new
 * Function`, which would evaluate whatever the other file happens to contain; this cannot do anything
 * but arithmetic, and it fails loudly rather than silently returning `NaN` if the expression's shape
 * changes.
 */
function evalNumber(expr: string): number {
  const text = expr.trim()
  if (!/^[\d_]+(?:\s*\*\s*[\d_]+)*$/.test(text))
    throw new Error(`not a numeric expression: ${text}`)
  return text.split('*').reduce((acc, part) => acc * Number(part.trim().replace(/_/g, '')), 1)
}

function capture(source: string, re: RegExp, what: string): string {
  const found = source.match(re)?.[1]
  if (found === undefined)
    throw new Error(`could not find ${what} — the RN provider was restructured`)
  return found
}

describe("ADR-058's persisted cache is one policy, declared in two shells", () => {
  const rn = read('providers/QueryProvider.tsx')

  it('agrees on the persister key, the buster, the max age and the stale time', () => {
    expect(capture(rn, /const PERSIST_KEY = '([^']+)'/, 'PERSIST_KEY')).toBe(PERSISTED_CACHE.key)
    expect(capture(rn, /const CACHE_BUSTER = '([^']+)'/, 'CACHE_BUSTER')).toBe(
      PERSISTED_CACHE.buster,
    )
    expect(evalNumber(capture(rn, /const MAX_AGE_MS = (.+)$/m, 'MAX_AGE_MS'))).toBe(
      PERSISTED_CACHE.maxAgeMs,
    )
    expect(evalNumber(capture(rn, /staleTime: ([^,\n]+)/, 'staleTime'))).toBe(
      PERSISTED_CACHE.staleTimeMs,
    )
  })

  it('persists successes only, in both', () => {
    // The reason is in both files: a persisted error replays a stale failure on the next cold start, which
    // reads as "the app is broken" rather than "we're offline". Asserted here because it is a decision
    // about what a rider sees offline, which is the whole of ADR-058.
    expect(rn).toContain("q.state.status === 'success'")
    expect(readWeb('src/providers/QueryProvider.tsx')).toContain("q.state.status === 'success'")
  })
})

describe('the two preference stores own different keys, so neither can erase the other', () => {
  const rnStore = read('lib/preferences.ts')

  it('the RN store really does hold favourites under its key', () => {
    // The control that makes the assertion below mean something. If the RN store stopped persisting
    // favourites, the hazard this guards would be gone and the guard would be cargo.
    expect(rnStore).toContain('favoriteRoutes')
    expect(rnStore).toMatch(/partialize:[\s\S]{0,200}favoriteRoutes/)
  })

  it('does not write the blob the favourites live in', () => {
    // zustand's `persist` writes `partialize`'s output as the WHOLE blob, so a store that models fewer
    // fields does not preserve the rest — it erases them. Sharing this key would delete every favourite a
    // rider had, silently, the first time `apps/web` was served from the origin the Expo PWA was
    // installed from (WP6-8). See `src/lib/preferences.ts`.
    const rnKey = capture(rnStore, /name: '([^']+)'/, "the RN store's storage key")
    expect(rnKey).toBe('nextbus.preferences')
    expect(PREFERENCES_STORAGE_KEY).not.toBe(rnKey)
  })
})
