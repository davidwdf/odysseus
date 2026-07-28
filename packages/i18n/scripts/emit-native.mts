// Writes `packages/i18n/generated/` from the catalogue. Run via
// `pnpm --filter @nextbus/i18n strings:emit`.
//
// The output is committed, and this package's `test` script re-runs the same generator and compares,
// so forgetting to re-emit is a red build rather than a native client built from last month's copy.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from './native-strings.mts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const files = generate()
for (const { file, text } of files) {
  const out = join(root, file)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
}
console.log(`i18n: wrote ${files.length} native artefact(s)`)
for (const { file } of files) console.log(`  · ${file}`)
