// Writes `asyncapi.json` from the frame schemas. Run via `pnpm --filter @nextbus/contract asyncapi:emit`.
//
// The twin of `emit-openapi.mts`, and deliberately identical in shape: the output is committed, and
// `check-asyncapi-current.mjs` rebuilds it on every `pnpm test`, so the document can never quietly fall
// behind the schemas. A generated file that is committed has exactly one failure mode — someone edits
// the source and forgets to re-run the generator — and this pair turns that into a red build.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAsyncApiDocument } from '../src/asyncapi'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'asyncapi.json')
const doc = buildAsyncApiDocument()

// Trailing newline so the file is POSIX-clean and `git diff` doesn't report "\ No newline at end".
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`)

const components = doc.components as {
  messages: Record<string, unknown>
  schemas: Record<string, unknown>
}
const channels = Object.keys(doc.channels as Record<string, unknown>).length
console.log(
  `asyncapi.json — ${channels} channel, ${Object.keys(components.messages).length} messages, ` +
    `${Object.keys(components.schemas).length} component schemas`,
)
