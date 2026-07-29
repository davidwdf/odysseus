#!/usr/bin/env node
// The anti-rot gate on the native-consumer guide. Runs as part of `pnpm --filter @nextbus/contract
// test`, which is what `turbo run test` invokes — there is no PR CI workflow in this repo, so a gate
// that is not in a `test` script is a gate that never runs.
//
// Two failure modes, because the guide can rot in two different ways:
//
//  1. **A generated region is stale.** Someone added a corpus, or an endpoint, and the README still
//     quotes the old count. This is not hypothetical: ADR-060 shipped the figure "36 groups, 274
//     cases" and was still saying it after two waves had taken the corpus to 65 groups and 510 cases.
//     The README is a *native* repo's map of this tree, so the same rot there costs a porter a suite
//     they believe is complete.
//  2. **A path the guide names no longer exists.** The more insidious one, because it survives every
//     other gate in the repo. WP3-1 deleted `packages/ui/src/tokens.ts` and `src/typography.ts`;
//     ADR-060's convergence moved the id corpus out of this package. A README pointing at any of
//     those reads as authoritative and sends a porter looking for a file nobody will ever restore.
//
// What this deliberately does NOT check: whether any Swift or Kotlin in `native/` compiles. There is
// no toolchain in this repo to check it with, the templates say so in their own banners, and a gate
// that implied otherwise would be worse than none.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { figures, REPO_ROOT, render } from './native-guide.mjs'

let failed = false

const die = (msg) => {
  console.error(msg)
  failed = true
}

// ── 1. every generated region matches a fresh generation ──────────────────────────────────────────
for (const { file, text } of render()) {
  const committed = readFileSync(file, 'utf8')
  if (committed !== text) {
    die(
      `✗ ${relative(REPO_ROOT, file)} has a stale generated region — its figures or its corpus list\n` +
        '  no longer match this tree.\n\n' +
        '  Run: pnpm --filter @nextbus/contract native:emit\n',
    )
  }
}

// ── 2. every repo path the guide names exists ──────────────────────────────────────────────────────
//
// Scoped to backticked tokens under a real top-level directory, so ordinary prose and wire paths
// (`/v1/policy`) cannot be mistaken for files. Globs are skipped: `packages/core/spec/*.spec.json`
// is a set, and its members are already enumerated by the generated corpus table above.
const TOP_LEVEL = /^(packages|apps|docs|scripts)\//
const guide = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const cited = new Set(
  [...guide.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1])
    .filter((t) => TOP_LEVEL.test(t) && !t.includes('*') && !t.includes(' ')),
)

for (const path of [...cited].sort()) {
  // A trailing slash means "this directory", which is how the guide cites the two i18n bundles.
  if (!existsSync(new URL(`../../../${path}`, import.meta.url))) {
    die(`✗ README.md cites \`${path}\`, which does not exist in this tree.`)
  }
}

// ── 3. …and is actually committable ────────────────────────────────────────────────────────────────
//
// `existsSync` is not enough, and this was very nearly shipped broken: `.gitignore` excludes `ios/` and
// `android/` for Expo's prebuild output, which silently swallowed
// `packages/contract/native/{ios,android}` — the two templates the README's whole §6 points at. Every
// check above passed, because the files were right there on this disk. A clean checkout would have had
// a guide citing two files that do not exist, which is the precise rot this gate exists to prevent,
// reintroduced one level down. `packages/i18n/generated/{ios,android}` hit the identical trap first.
try {
  const ignored = execFileSync('git', ['check-ignore', '--stdin'], {
    cwd: REPO_ROOT,
    input: [...cited].join('\n'),
    encoding: 'utf8',
    // Exit 1 means "nothing matched", which is the good case; only a real error should throw.
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  for (const path of ignored.split('\n').filter(Boolean)) {
    die(
      `✗ README.md cites \`${path}\`, which exists here but is **gitignored** — it would be absent\n` +
        '  from a clean checkout. Add a negation to .gitignore (see the i18n `generated/` entries).',
    )
  }
} catch (err) {
  // `check-ignore` exits 1 with no output when nothing is ignored: that is success, not a failure.
  if (err.status !== 1) {
    console.error(`  (skipped the gitignore check: ${err.message.split('\n')[0]})`)
  }
}

if (failed) process.exit(1)

const f = figures()
console.log(
  `✓ native guide is current — ${f.paths} paths, ${f.schemas} schemas, ` +
    `${f.corpusFiles} corpora / ${f.corpusGroups} groups / ${f.corpusCases} cases / ` +
    `${f.corpusDefects} knownDefect; ${cited.size} cited paths all exist.`,
)
