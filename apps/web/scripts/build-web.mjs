#!/usr/bin/env node
/**
 * Build the PWA: `vite build`, then generate the service worker over the output (WP6-0). One command,
 * because the two halves must not drift — a precache manifest generated against a different build is
 * worse than no service worker at all.
 *
 *   pnpm --filter @nextbus/web build:web
 *
 * `VITE_API_URL` must be the deployed Worker in a real build; it is baked into the bundle *and*
 * determines which origin the runtime-caching routes match.
 *
 * The twin of `apps/mobile/scripts/build-web.mjs`, and the twin is almost the whole file: what differs is
 * the exporter (`vite build` rather than `expo export -p web`) and the env-var spelling, which is the same
 * one difference `src/adapters/datasource.ts` has. Everything that is a *decision* — what is precached,
 * what is network-first, what the emitted worker must prove about itself — is in `scripts/pwa/` and shared.
 *
 * Run through `tsx` (see `package.json`) for one reason: the default below is `DEFAULT_API_URL` from
 * `@nextbus/api-client`, whose entry point is TypeScript source — internal packages are source-only in
 * this repo, with no build step (golden rule 1). The value it picks is serialised into `dist/sw.js` as the
 * origin the runtime-caching routes match, so a build that fell back to a *different* default than the
 * bundle did would produce a service worker that caches nothing, with no error anywhere.
 */
import { execFileSync } from 'node:child_process'
import { rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_API_URL } from '@nextbus/api-client'
import { generateSW } from 'workbox-build'
import { assertServiceWorker, workboxConfig } from '../../../scripts/pwa/workbox.config.mjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(appDir, 'dist')
const apiUrl = process.env.VITE_API_URL ?? DEFAULT_API_URL

console.log(`▸ vite build   (API: ${apiUrl})`)
rmSync(distDir, { recursive: true, force: true })
execFileSync('npx', ['vite', 'build'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: apiUrl },
})

// Fail loudly rather than shipping a service worker whose precache manifest is empty.
statSync(join(distDir, 'index.html'))

console.log('▸ workbox generateSW')
const { count, size, warnings } = await generateSW(
  workboxConfig({ distDir, apiOrigin: new URL(apiUrl).origin }),
)
for (const w of warnings) console.warn(`  ! ${w}`)
if (count === 0) throw new Error('precache manifest is empty — the build produced nothing')

const kb = (n) => `${(n / 1024).toFixed(0)} kB`
console.log(
  `✓ precached ${count} files (${kb(size)}) → dist/sw.js ${kb(statSync(join(distDir, 'sw.js')).size)}`,
)

// `registerServiceWorker()` asks for `/sw.js`, and a worker that registers but precaches the wrong thing
// fails silently — the app just never works offline. Its "app shell precached" check is doubly
// load-bearing for this build: Vite emits exactly ONE html file, so the same `index.html` is both the
// precached shell and the `navigateFallback` that makes a cold offline load of `/settings` open the app
// rather than the browser's error page. The fallback being *configured* is asserted in
// `test/pwa-policy.test.ts`, where it can be checked against the declaration instead of against minified
// output.
assertServiceWorker(join(distDir, 'sw.js'), { apiUrl })
