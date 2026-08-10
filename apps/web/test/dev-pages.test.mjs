// The gate that keeps `apps/web/lab/` out of the app a rider gets (ADR-112).
//
// WHY THIS FILE EXISTS
// The motion lab is a real page in this app: it imports `RouteStopRow`, `RailBusToken` and `useRailFlip`
// unchanged and drives them from a timer, which is the only way anyone has found to see whether the rail's
// motion fires on the right *occasions* — it has caught two defects that eleven tests and four rounds of
// browser measurement all missed. Keeping it in the repo is what stops it being rebuilt from scratch every
// time a question about motion comes up.
//
// The owner's condition was that it must not reach production code, and the two ways it could are worth
// naming separately:
//
//  1. **It gets bundled.** Vite's only entry is the root `index.html`, so `lab/index.html` is not in the
//     production graph at all — it is served in `vite dev` because a dev server serves files, and that is
//     the whole trick. What would break it is somebody adding `rollupOptions.input`.
//  2. **Production code starts importing it.** The more likely one by far: a helper written for the lab
//     looks useful, a screen imports it, and now a dev page is a dependency of the app. The lab importing
//     *from* `src/` is the point and must stay open; the reverse must not exist.
//
// The direction of that rule is the whole content of the gate. `build:web` also asserts the emitted `dist/`
// contains nothing from the lab — but only when somebody runs a build, and CI does not. This runs on
// `pnpm test`.
//
// `.mjs` for the reason `pwa-policy.test.mjs` is: it reads source as text and asserts over paths, so there
// is nothing here for the typechecker to hold and `tsconfig.json` does not include it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/** This app's root, found by walking up — the same approach `bus-token.test.tsx` documents at length. */
function appDir() {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'apps', 'web')
    try {
      statSync(join(candidate, 'index.html'))
      return candidate
    } catch {
      const parent = dirname(dir)
      if (parent === dir) throw new Error(`no apps/web above ${process.cwd()}`)
      dir = parent
    }
  }
}

const APP = appDir()

/** Every source file under `dir`, recursively. */
function sourcesIn(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourcesIn(path))
    else if (/\.(ts|tsx|mjs|css)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** The dev pages, as directory names — one today, and the rule is meant to hold for the next one. */
const DEV_DIRS = ['lab']

describe('a dev page cannot reach the app a rider gets', () => {
  it('is not imported by anything the app ships', () => {
    // The one that actually happens: a helper written for a dev page looks generally useful. The lab may
    // import the app — that is what makes it worth having — and the app may never import the lab.
    const offenders = []
    for (const file of sourcesIn(join(APP, 'src'))) {
      const source = readFileSync(file, 'utf8')
      for (const dev of DEV_DIRS) {
        // Any specifier that walks into the dev directory, however it is spelled.
        if (new RegExp(`from\\s+['"][^'"]*\\b${dev}/`).test(source)) {
          offenders.push(`${relative(APP, file)} imports from ${dev}/`)
        }
      }
    }
    expect(
      offenders,
      `a dev page is a dependency of the app:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('is not an entry point of the production build', () => {
    // `vite build`'s default input is the root `index.html` and nothing else, which is why a second HTML
    // file can sit in this app and be served in dev without ever being built. Declaring `rollupOptions`
    // would make every HTML file a candidate, so the absence of that key **is** the guarantee — and this
    // is the assertion that notices the day somebody adds it for an unrelated reason.
    const config = readFileSync(join(APP, 'vite.config.ts'), 'utf8')
    expect(
      config,
      'vite.config.ts declares build inputs — check the dev pages are not among them',
    ).not.toMatch(/rollupOptions/)
    // …and the shipped shell must not link to one either, which no build step would catch.
    const shell = readFileSync(join(APP, 'index.html'), 'utf8')
    for (const dev of DEV_DIRS) expect(shell).not.toContain(`${dev}/`)
  })

  it('is a page, so it has an entry of its own to be served by', () => {
    // The reverse failure, and the reason it is worth an assertion: a dev page nobody can open rots
    // silently, and the first sign is somebody deleting it as dead code. If this fails, the page moved.
    for (const dev of DEV_DIRS) {
      const html = readFileSync(join(APP, dev, 'index.html'), 'utf8')
      expect(html, `${dev}/index.html loads no script`).toMatch(/<script[^>]+src=/)
    }
  })
})
