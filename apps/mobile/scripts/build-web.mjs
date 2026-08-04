#!/usr/bin/env node
/**
 * Build the PWA: `expo export -p web`, then generate the service worker over the output
 * (WP0-3). One command, because the two halves must not drift — a precache manifest generated
 * against a different build is worse than no service worker at all.
 *
 *   pnpm --filter @nextbus/mobile build:web
 *
 * `EXPO_PUBLIC_API_URL` must be the deployed Worker in a real build; it's baked into the
 * bundle *and* determines which origin the runtime-caching routes match.
 *
 * Run through `tsx` (see `package.json`) for one reason: the default below is
 * `DEFAULT_API_URL` from `@nextbus/api-client`, whose entry point is TypeScript source — internal
 * packages are source-only in this repo, with no build step (golden rule 1). This was the fourth
 * copy of `http://localhost:8787`, and the most dangerous of the four: the value it picks is
 * serialised into `dist/sw.js` as the origin the runtime-caching routes match, so a build that
 * fell back to a *different* default than the bundle did would produce a service worker that
 * caches nothing and no error anywhere. `packages/contract` and `packages/i18n` already run their
 * scripts this way.
 *
 * The Workbox config and the assertions over the emitted worker moved to `scripts/pwa/` in WP6-0,
 * when `apps/web` grew a service worker too: the caching policy is ADR-058 and one wave with two
 * copies of it is one wave in which they can disagree. Everything app-specific — which exporter runs,
 * which env var names the API — stays here.
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
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL

console.log(`▸ expo export -p web   (API: ${apiUrl})`)
rmSync(distDir, { recursive: true, force: true })
execFileSync('npx', ['expo', 'export', '-p', 'web', '--output-dir', 'dist'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
})

// Fail loudly rather than shipping a service worker whose precache manifest is empty.
statSync(join(distDir, 'index.html'))

console.log('▸ workbox generateSW')
const { count, size, warnings } = await generateSW(
  workboxConfig({ distDir, apiOrigin: new URL(apiUrl).origin }),
)
for (const w of warnings) console.warn(`  ! ${w}`)
if (count === 0) throw new Error('precache manifest is empty — the export produced nothing')

const kb = (n) => `${(n / 1024).toFixed(0)} kB`
console.log(
  `✓ precached ${count} files (${kb(size)}) → dist/sw.js ${kb(statSync(join(distDir, 'sw.js')).size)}`,
)

// `registerServiceWorker()` asks for `/sw.js`, and a worker that registers but precaches the wrong
// thing fails silently — the app just never works offline. So the emitted bundle is asserted on rather
// than `generateSW`'s return value trusted; the five checks are in `scripts/pwa/` beside the config
// that makes the claims.
assertServiceWorker(join(distDir, 'sw.js'), { apiUrl })
