#!/usr/bin/env node
// Gate for WP3-1: a colour is named once, in `packages/ui/tokens.json`, and reaches a component
// as a semantic class or a token — never as a literal.
//
// WHY A MECHANICAL CHECK, WHEN THE RULE IS ALREADY WRITTEN DOWN
// Because "no raw hex in components" has been in CLAUDE.md and docs/09 since the design system
// landed, and there were still six literals in the tree when this was written: a rose pin fill in
// no token file at all, two shadow colours, a pin border, a slate that shadowed `ELEVATION`'s own
// shadow ink, and the PWA `theme-color`. None of them were carelessness — each one was in a place
// where a className genuinely cannot reach (a `boxShadow` string, an RN `shadowColor`, a `<meta>`
// attribute), so the author reached for the value. That is exactly the escape hatch that makes the
// token layer drift, and the fix is not more discipline: it is a token for the case, plus a check
// that notices the next one.
//
// A wrong colour is the one class of bug that no other gate in this repo can see. It type-checks,
// it passes every unit test, and it is instantly obvious to an eyeball nobody points at it. So it
// gets its own gate.
//
// SCOPE is product source — the directories where the rule applies. Build scripts are out: they
// generate assets outside the token system (`scripts/gen-icons.mjs` emits SVG masks where black
// and white are *channel encodings*), and policing them would only teach people to allowlist.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The directories where a colour must arrive as a token. */
const POLICED = [
  'apps/mobile/app/',
  'apps/mobile/components/',
  'apps/mobile/lib/',
  'apps/mobile/providers/',
  'packages/ui/src/',
]

const PATTERNS = [
  {
    id: 'hex',
    re: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/,
    hint: 'use a semantic class (bg-surface, text-muted) or a token from @nextbus/ui',
  },
  {
    id: 'rgb-fn',
    re: /\b(?:rgba?|hsla?)\(\s*[\d.]/,
    hint: 'use a token; for a boxShadow string compose it with cssShadow()/webBoxShadow()',
  },
]

/**
 * Files that are allowed to contain colour values because they *are* the colour values. Not an
 * exception: excluding the token module from a check that bans literals elsewhere is the check's
 * definition, not a hole in it.
 */
const TOKEN_FILES = new Set([
  'packages/ui/src/tokens.generated.ts', // generated from tokens.json — the values themselves
  'scripts/check-no-raw-colours.mjs', // this file; the patterns are literals in it
])

/**
 * Recorded exceptions. An entry without a `snippet` exempts the whole file; with one, only lines
 * containing it (whitespace-collapsed, so re-indenting does not invalidate the entry). An entry
 * that stops matching anything fails the check just as loudly as an unallowed finding, so the
 * list can shrink but never quietly rot into a lie about what is protected.
 */
const ALLOWLIST = [
  {
    file: 'apps/mobile/lib/liquidGlass.ts',
    why:
      'Not colours. This module builds an SVG displacement map for the liquid-glass refraction ' +
      '(ADR-028): #808080 means "zero displacement", the red/green ramps encode the X and Y ' +
      'channels, and #000080 is a base for the blue channel. Tokenising them would make the ' +
      'filter unreadable and couple an optical encoding to the palette. Documented at its :1-10.',
  },
]

/** Whitespace-insensitive form of a source line, for stable snippet matching. */
const normalize = (line) => line.trim().replace(/\s+/g, ' ')

/**
 * Strip comments, so prose about a colour stays legal — the token descriptions and the ADR-035
 * notes both quote hex values, and a gate that banned *talking* about #0F172A would be worse
 * than no gate. Deliberately lexical rather than a real parse: a `//` inside a string literal
 * would over-strip that line, which can only ever produce a false negative on the same line, and
 * the alternative is a JS parser in a 100-line check.
 */
function codeLines(src) {
  const out = []
  let inBlock = false
  for (const raw of src.split('\n')) {
    let line = ''
    let rest = raw
    while (rest.length > 0) {
      if (inBlock) {
        const end = rest.indexOf('*/')
        if (end === -1) break
        rest = rest.slice(end + 2)
        inBlock = false
        continue
      }
      const block = rest.indexOf('/*')
      // `://` spares a URL inside a string; nothing else in this tree needs the exemption.
      const slash = rest.search(/(?<!:)\/\//)
      if (block !== -1 && (slash === -1 || block < slash)) {
        line += rest.slice(0, block)
        rest = rest.slice(block + 2)
        inBlock = true
        continue
      }
      if (slash !== -1) {
        line += rest.slice(0, slash)
        break
      }
      line += rest
      break
    }
    out.push(line)
  }
  return out
}

/**
 * Every policed source file in the working tree. `git ls-files` rather than a directory walk: it
 * respects `.gitignore` for free. `--others --exclude-standard` includes files that exist but are
 * not committed yet, so a brand-new component cannot carry a literal past the check until the
 * moment it is staged — which is exactly when nobody looks again.
 */
function policedFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...POLICED],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  return [...new Set(out.split('\0').filter(Boolean))]
    .map((f) => f.split(sep).join('/'))
    .filter((f) => /\.(m?[jt]sx?|css)$/.test(f) && !TOKEN_FILES.has(f))
}

const files = policedFiles()
const findings = []
for (const file of files) {
  let src
  try {
    src = readFileSync(join(repoRoot, file), 'utf8')
  } catch {
    continue // listed but absent (deleted and not yet staged) — nothing to check
  }
  if (!/#|rgba?\(|hsla?\(/.test(src)) continue
  codeLines(src).forEach((line, i) => {
    for (const pattern of PATTERNS) {
      const hit = pattern.re.exec(line)
      if (hit) findings.push({ file, line: i + 1, code: normalize(line), value: hit[0], pattern })
    }
  })
}

const allowed = ALLOWLIST.map((e) => ({
  ...e,
  snippet: e.snippet ? normalize(e.snippet) : undefined,
  hits: 0,
}))
const unexpected = []
for (const finding of findings) {
  const match = allowed.find(
    (a) => a.file === finding.file && (a.snippet === undefined || finding.code.includes(a.snippet)),
  )
  if (match) match.hits += 1
  else unexpected.push(finding)
}
const stale = allowed.filter((a) => a.hits === 0)

if (unexpected.length > 0 || stale.length > 0) {
  console.error('✗ raw colour literals (WP3-1)\n')
  if (unexpected.length > 0) {
    console.error(
      `  ${unexpected.length} literal(s) outside the token system. Colours are declared once, in\n` +
        '  packages/ui/tokens.json:\n',
    )
    for (const f of unexpected) {
      console.error(`  · ${f.file}:${f.line}  [${f.pattern.id}] ${f.value}`)
      console.error(`      ${f.code}`)
      console.error(`      → ${f.pattern.hint}`)
    }
    console.error(
      '\n  If the value is genuinely not a colour — a mask channel, a filter encoding — add the\n' +
        '  file to ALLOWLIST in this script with the reason. If it *is* a colour, it needs a token.',
    )
  }
  if (stale.length > 0) {
    console.error(`\n  ${stale.length} allowlist entry(ies) no longer match anything — delete:\n`)
    for (const a of stale) console.error(`  · ${a.file}${a.snippet ? `  "${a.snippet}"` : ''}`)
  }
  console.error('\n  Declaration: packages/ui/tokens.json')
  console.error('  Guide:       docs/09-theme.md §1')
  process.exit(1)
}

// The allowlist size is reported rather than asserted away: the number is the thing worth
// watching, and a gate that claimed to police files it was skipping would be exactly the kind of
// trusted-but-wrong signal this check exists to prevent.
console.log(
  `✓ no raw colour literals — ${PATTERNS.length} patterns over ${files.length} files in ` +
    `${POLICED.length} policed dirs, ${ALLOWLIST.length} allowed file(s) ` +
    `(${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
)
