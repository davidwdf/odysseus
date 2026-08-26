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
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_API_URL } from '@nextbus/api-client'
import { generateSW } from 'workbox-build'
import { assertServiceWorker, workboxConfig } from '../../../scripts/pwa/workbox.config.mjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(appDir, 'dist')
const apiUrl = process.env.VITE_API_URL ?? DEFAULT_API_URL
/** Directories under `apps/web/` that are dev-only pages — the same list `test/dev-pages.test.mjs` holds. */
const DEV_DIRS = ['lab']

console.log(`▸ vite build   (API: ${apiUrl})`)
rmSync(distDir, { recursive: true, force: true })
execFileSync('npx', ['vite', 'build'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: apiUrl },
})

// Fail loudly rather than shipping a service worker whose precache manifest is empty.
statSync(join(distDir, 'index.html'))

/*
  And fail loudly if a **dev page** made it into the output (ADR-112). `apps/web/lab/` is a real page in
  this app — it drives the rail components from a timer, which is the only way to see whether their motion
  fires on the right occasions — and `vite build` leaves it out only because its single entry is the root
  `index.html`. That is a default, not a promise: one `rollupOptions.input` and the lab would be bundled,
  precached by the very next line, and served to riders offline.

  `test/dev-pages.test.mjs` asserts the same claim from the other side, over the source, and that is the one
  CI runs. This is the one that reads the artefact.
*/
const shipped = readdirSync(distDir, { recursive: true }).map(String)
const leaked = shipped.filter((f) => DEV_DIRS.some((dev) => f.split(/[\\/]/).includes(dev)))
if (leaked.length > 0) {
  console.error(`✗ a dev page reached the production build:\n    ${leaked.join('\n    ')}\n`)
  console.error(
    '  Dev pages are served by `vite dev` and must never be a build input — see ADR-112.',
  )
  process.exit(1)
}

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

/**
 * **MapLibre's worker must be emitted, and must be self-contained** (ADR-155).
 *
 * This is here rather than in a vitest file because it is a claim about the *build output* and it cannot
 * be made anywhere else: jsdom has no WebGL, so no unit test ever starts a map, and the failure it guards
 * has no symptom a person would look for. `new Worker()` on a URL that 404s **still constructs** — it
 * fails asynchronously on the worker's own `error` event, which MapLibre does not surface — so the map
 * looks perfectly healthy while every source that needs geometry is silently dead. Raster tiles decode on
 * the main thread and keep working, which is what makes it so convincing.
 *
 * Two distinct ways it has already broken, both caught here:
 *
 * 1. **No worker asset at all.** MapLibre derives its worker's path from `import.meta.url`, assuming the
 *    file is its sibling — true in `node_modules`, false once Vite rolls the module into
 *    `assets/index-<hash>.js`.
 * 2. **An asset that imports a sibling nobody emitted.** The first fix used `?url`, which copies one file
 *    and knows nothing about its imports. The `/* → /index.html` SPA fallback then turned that missing
 *    sibling into **200 with HTML in it**, so the worker parsed a web page as JavaScript — a 404 that
 *    cannot even be seen as a 404.
 *
 * Hence both halves: the file exists, and nothing inside it reaches for a neighbour.
 */
const assets = readdirSync(join(distDir, 'assets'))
const workerAsset = assets.find((f) => /maplibre-gl-worker.*\.(m?js)$/.test(f))
if (!workerAsset) {
  throw new Error(
    'no maplibre worker asset in dist/assets — MapLibre will request one that is not there, and every ' +
      'GeoJSON/vector source will hang for ever with no error. See `setWorkerUrl` in MapView.tsx.',
  )
}
const workerSource = readFileSync(join(distDir, 'assets', workerAsset), 'utf8')
const siblingImport = workerSource.match(/(?:import|from)\s*["'](\.[^"']+)["']/)
if (siblingImport) {
  throw new Error(
    `${workerAsset} imports ${siblingImport[1]}, which the build did not emit beside it. Under the SPA ` +
      'fallback that resolves to index.html, so the worker parses HTML and dies silently. Import it ' +
      'with `?worker&url` so Vite bundles the graph.',
  )
}
console.log(`✓ maplibre worker self-contained → dist/assets/${workerAsset}`)
