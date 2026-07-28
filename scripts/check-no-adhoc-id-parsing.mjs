#!/usr/bin/env node
// Gate for WP1-2: ids are read through the grammar in `packages/core/src/ids.ts`, never taken apart
// inline.
//
// WHY A MECHANICAL CHECK, WHEN THE SITES ARE ALREADY FIXED
// Because the fix does not stay fixed on its own. `id.split(':')[0]` is three seconds of typing, it
// reads as obviously correct, and it *is* correct until the id is a merged place id — at which point
// it returns `"P"`, gets cast to `OperatorId`, and paints a pin in the fallback colour. Nothing
// throws, no test fails, and the only symptom is a wrong pixel nobody can trace back to a cause. A
// review habit does not catch that reliably; twelve sites accumulated while everyone was reviewing
// carefully. So the property is enforced instead of hoped for.
//
// The allowlist below is **empty, and that is the whole point** — the twelve sites the plan
// enumerated are drained. It stays here, with its format documented, because a temporary exception
// must be possible to record explicitly; the check fails on any finding that is not listed, and also
// on any listed entry that no longer matches, so the list can shrink but never quietly rot.
//
// KEYED ON A CODE SNIPPET, NOT A LINE NUMBER, deliberately: the plan's own list of these sites drifted
// by two lines between being written and being worked on, because someone added a comment above one
// of them. A gate whose allowlist goes stale every time an unrelated line is inserted teaches people
// to regenerate it without reading it, which is worse than having no gate.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The shapes of ad-hoc id parsing that have actually appeared in this repository. Each is a way of
 * reading a *structural delimiter* of the id grammar — `:` between fields, `+` between place
 * members, `|` between the halves of a favourite key — without going through the parser.
 *
 * Not covered, and worth knowing about rather than assuming away: id *introspection* that never
 * splits, e.g. `stopId.includes(`${op}:`)` in `packages/core/src/search.ts`. It is a genuine
 * instance of the same problem (a raw stop id of `CTB99999` under KMB would false-match Citybus),
 * but a pattern general enough to catch it flags plenty of innocent string work, and a gate with a
 * high false-positive rate gets bypassed. Recorded in the WP1-2 report instead of half-caught here.
 */
const PATTERNS = [
  {
    id: 'split-colon',
    re: /\.split\((['"]):\1\)/,
    hint: 'use parseStopId / parseRouteId from @nextbus/core',
  },
  {
    id: 'split-plus',
    re: /\.split\((['"])\+\1\)/,
    hint: 'use parsePlaceId / memberStopIds from @nextbus/core',
  },
  {
    id: 'split-pipe',
    re: /\.split\((['"])\|\1\)/,
    hint: 'use parseFavoriteRouteKey from @nextbus/core',
  },
  {
    id: 'place-prefix-test',
    re: /\.startsWith\((['"])P:\1\)/,
    hint: 'use memberStopIds / parseStopOrPlaceId from @nextbus/core',
  },
]

/**
 * Files that are allowed to contain the grammar, because they *are* the grammar. Not exceptions:
 * excluding the parser from a check that bans parsing elsewhere is the check's definition, not a
 * hole in it.
 */
const GRAMMAR_FILES = new Set([
  'packages/core/src/ids.ts', // the parser and formatter
  'scripts/check-no-adhoc-id-parsing.mjs', // this file — the patterns are literals in it
  // `apps/mobile/test/id-grammar.test.ts` was listed here for the same reason — its suite performed
  // the naive `key.split('|')` on a corrupt favourite key to show the parser returns null where the
  // split returns a plausible wrong pair, and a gate whose test may not write the thing being banned
  // cannot prove why it is banned. WP1-5 moved that suite into `packages/core`, where the corpus
  // states the same case as data rather than as code, so the entry had nothing left to exempt.
  // Removed in Wave 2 rather than left pointing at a deleted path: this set is the check's own
  // definition, and a definition that names files which do not exist stops being read.
])

/**
 * Recorded exceptions. **Empty on purpose.** To add one:
 *
 *   { file: 'apps/foo/bar.ts', snippet: "const x = id.split(':')", why: 'one line: why it cannot
 *     use the parser yet, and what removes it' }
 *
 * `snippet` is matched against the offending line with whitespace collapsed, so re-indenting or
 * moving the line does not invalidate it, but editing the code does — which is when the exception
 * should be re-justified anyway. CI fails if this list grows without that justification being read
 * by a human, and fails just as loudly if an entry stops matching, so a stale entry cannot sit here
 * pretending to protect something.
 */
const ALLOWLIST = []

/** Whitespace-insensitive form of a source line, for stable snippet matching. */
const normalize = (line) => line.trim().replace(/\s+/g, ' ')

/**
 * Every source file in the working tree. `git ls-files` rather than a directory walk: it respects
 * `.gitignore` for free, so the check never reads `node_modules`, a build artefact or a `.dataset`
 * snapshot. `--others --exclude-standard` includes files that exist but are not committed yet —
 * without it a brand-new file could carry an ad-hoc parse past the check until the moment it was
 * staged, which is precisely when nobody looks again.
 */
function sourceFiles() {
  const out = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      '*.ts',
      '*.tsx',
      '*.mts',
      '*.mjs',
      '*.cjs',
      '*.js',
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  return [...new Set(out.split('\0').filter(Boolean))]
}

const files = sourceFiles()
const findings = []
for (const file of files) {
  const posix = file.split(sep).join('/')
  if (GRAMMAR_FILES.has(posix)) continue
  let src
  try {
    src = readFileSync(join(repoRoot, file), 'utf8')
  } catch {
    continue // listed but absent (a deleted-but-unstaged file) — nothing to check
  }
  if (!src.includes('.split(') && !src.includes('.startsWith(')) continue
  src.split('\n').forEach((line, i) => {
    // Whole-line comments are prose, and prose about the grammar is what we *want* people writing.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
        findings.push({ file: posix, line: i + 1, code: normalize(line), pattern })
      }
    }
  })
}

const allowed = ALLOWLIST.map((entry) => ({ ...entry, snippet: normalize(entry.snippet), hits: 0 }))
const unexpected = []
for (const finding of findings) {
  const match = allowed.find((a) => a.file === finding.file && finding.code.includes(a.snippet))
  if (match) match.hits += 1
  else unexpected.push(finding)
}
const stale = allowed.filter((a) => a.hits === 0)

if (unexpected.length > 0 || stale.length > 0) {
  console.error('✗ ad-hoc id parsing (WP1-2)\n')
  if (unexpected.length > 0) {
    console.error(
      `  ${unexpected.length} unallowed site(s). Ids are parsed once, in packages/core/src/ids.ts:\n`,
    )
    for (const f of unexpected) {
      console.error(`  · ${f.file}:${f.line}  [${f.pattern.id}]`)
      console.error(`      ${f.code}`)
      console.error(`      → ${f.pattern.hint}`)
    }
    console.error(
      '\n  If a site genuinely cannot use the parser yet, add it to ALLOWLIST in this script with a\n' +
        '  reason. The allowlist is currently empty and the goal is that it stays that way.',
    )
  }
  if (stale.length > 0) {
    console.error(`\n  ${stale.length} allowlist entry(ies) no longer match anything — delete:\n`)
    for (const a of stale) console.error(`  · ${a.file}  "${a.snippet}"`)
  }
  console.error(`\n  Grammar: packages/contract/src/ids/id-grammar.abnf`)
  console.error(`  Corpus:  packages/core/spec/ids.spec.json`)
  process.exit(1)
}

// The allowlist size is reported rather than asserted to be zero: the number is the thing worth
// watching, and a gate that lied about it ("allowlist is empty") while holding entries would be
// exactly the kind of trusted-but-wrong signal this whole work package is about.
const remaining =
  ALLOWLIST.length === 0 ? 'allowlist is empty' : `${ALLOWLIST.length} allowed exception(s) left`
console.log(
  `✓ no ad-hoc id parsing — ${PATTERNS.length} patterns over ${files.length} source files, ` +
    `${remaining} (${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
)
