#!/usr/bin/env node
// Fills the generated regions of `README.md` and the two conformance templates in place.
//
// `check-native-guide.mjs` is the other half and shares `native-guide.mjs`, so the command this
// prints is the command its failure message names.

import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { figures, REPO_ROOT, render } from './native-guide.mjs'

for (const { file, text } of render()) {
  writeFileSync(file, text)
  console.log(`  wrote ${relative(REPO_ROOT, file)}`)
}

const f = figures()
console.log(
  `✓ native guide emitted — ${f.paths} paths, ${f.schemas} schemas, ` +
    `${f.corpusFiles} corpora / ${f.corpusGroups} groups / ${f.corpusCases} cases.`,
)
