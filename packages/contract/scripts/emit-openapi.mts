// Writes `openapi.json` from the wire schemas. Run via `pnpm --filter @nextbus/contract openapi:emit`.
//
// The output is committed and CI re-runs this with `git diff --exit-code`, so the document can never
// quietly fall behind the schemas: forgetting to re-emit is a red build, not a native client
// generated from last month's contract.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOpenApiDocument } from '../src/openapi'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json')
const doc = buildOpenApiDocument()

// Trailing newline so the file is POSIX-clean and `git diff` doesn't report "\ No newline at end".
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`)

const schemaCount = Object.keys(
  (doc.components as { schemas: Record<string, unknown> }).schemas,
).length
const pathCount = Object.keys(doc.paths as Record<string, unknown>).length
console.log(`openapi.json — ${pathCount} paths, ${schemaCount} component schemas`)
