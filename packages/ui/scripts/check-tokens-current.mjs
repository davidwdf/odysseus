#!/usr/bin/env node
/**
 * `@nextbus/ui`'s `test` — asserts every committed design-token artefact still matches
 * `packages/ui/tokens.json`.
 *
 * A committed generated file has exactly one failure mode: someone edits the source and forgets
 * to re-run the generator, or edits the *output* and never touches the source. Then the CSS
 * variables say one thing, the Tailwind preset says another, and a theme is subtly wrong in a way
 * no type-check or unit test can see — a wrong colour is invisible to every other gate and
 * obvious to an eyeball, which is the worst combination to leave unguarded.
 *
 * This is the package's `test` script rather than a CI step because there is no PR/push workflow
 * in this repo — `.github/workflows/` holds only `dataset.yml`, so the plan's "`git diff
 * --exit-code` in CI" describes something that does not exist yet. `turbo run test` picks this up,
 * and so does `pnpm test` at the root, which is where the enforcement actually lives.
 *
 * It regenerates in memory and compares text, the idiom `scripts/boundaries/check.mjs` uses.
 * Text rather than parsed values, because for these artefacts the bytes *are* the contract: a
 * reordered CSS block or a differently-quoted Tailwind key is a real diff a reviewer should see.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Dynamic, because the generator validates the declaration as it loads — an unresolvable alias or
// a semantic token missing a mode throws there, and that has to surface as this gate failing
// rather than as an unhandled import error.
let tokens
try {
  tokens = await import('./generate-tokens.mjs')
} catch (err) {
  console.error('✗ packages/ui/tokens.json is not a valid token declaration:\n')
  console.error(`  ${err.message.split('\n').join('\n  ')}\n`)
  process.exit(1)
}
const { EMIT_CMD, generate, ROOT, SOURCE } = tokens

const missing = []
const stale = []
const artefacts = generate()
for (const { file, text } of artefacts) {
  const abs = path.join(ROOT, file)
  if (!existsSync(abs)) missing.push(file)
  else if (readFileSync(abs, 'utf8') !== text) stale.push(file)
}

if (missing.length || stale.length) {
  console.error(`✗ design-token artefacts no longer match ${SOURCE}:\n`)
  for (const file of missing) console.error(`    missing  ${file}`)
  for (const file of stale) console.error(`    stale    ${file}`)
  console.error(`\n  Run: ${EMIT_CMD}`)
  console.error('\n  If the resulting diff surprises you, you edited a generated file. Revert it')
  console.error(`  and make the change in ${SOURCE} — that is the only file a human edits.`)
  process.exit(1)
}

const resolved = JSON.parse(
  readFileSync(path.join(ROOT, 'packages/ui/generated/tokens.json'), 'utf8'),
)

/**
 * Values that must equal a token but live in files no `import` can reach. Expo's static config is
 * read by the native build and the PWA manifest by the browser, so neither is in our bundle —
 * generating them would mean turning `app.json` into an `app.config.js` and templating the
 * manifest, both build changes this work package cannot verify without a device. So the coupling
 * is asserted instead: the two files may still be edited, but they can no longer drift from the
 * brand ink in silence, which is the only property that actually mattered.
 */
const PINNED = [
  {
    file: 'apps/mobile/app.json',
    token: 'color.brand.ink',
    paths: ['expo.splash.backgroundColor', 'expo.android.adaptiveIcon.backgroundColor'],
  },
  {
    file: 'apps/mobile/public/manifest.webmanifest',
    token: 'color.brand.ink',
    paths: ['background_color', 'theme_color'],
  },
]

const wrong = []
for (const { file, token, paths } of PINNED) {
  const json = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
  const want = resolved[token]
  if (want === undefined) throw new Error(`PINNED names a token that no longer exists: ${token}`)
  for (const dotted of paths) {
    const got = dotted.split('.').reduce((n, k) => n?.[k], json)
    if (typeof got !== 'string' || got.toUpperCase() !== want.toUpperCase())
      wrong.push({ file, dotted, token, want, got })
  }
}

if (wrong.length) {
  console.error('✗ static config has drifted from the token it pins:\n')
  for (const w of wrong)
    console.error(`  · ${w.file} → ${w.dotted}\n      is ${w.got}, ${w.token} is ${w.want}`)
  console.error(`\n  Set it to the token's value, or change the token in ${SOURCE} and both.`)
  process.exit(1)
}

const count = Object.keys(resolved).filter((k) => !k.startsWith('$')).length
const pins = PINNED.reduce((n, p) => n + p.paths.length, 0)
console.log(
  `✓ design tokens are current — ${count} tokens, ${artefacts.length} artefacts, ` +
    `${pins} pinned config values.`,
)
