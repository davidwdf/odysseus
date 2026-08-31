#!/usr/bin/env node
// Gate for ADR-056 decision 8 (and ADR-061 decision 3): **where the API is, is declared once.**
// One `DEFAULT_API_URL`, one place, and every environment read falls back to *it* rather than to a
// literal of its own.
//
// WHY THIS EXISTS, AND WHY IT IS A GATE RATHER THAN A CONVENTION
// Before Wave 5 the base URL was written out **four times** — `apps/mobile/lib/datasource.ts`,
// `apps/mobile/lib/tileSource.ts`, `apps/mobile/scripts/build-web.mjs`, `apps/web/src/adapters/datasource.ts`
// — across three build systems and two variable names (`EXPO_PUBLIC_API_URL`, `VITE_API_URL`), with no
// single declaration and nothing checking. Everything else in this repo that has one declaration also has
// a drift gate; the one value that has to change on the day we get a real domain did not. Wave 5 would
// have made it five copies, because a socket needs the same host, and Wave 4 had already shipped the
// second variable name without a row in docs/10's inventory or an `.env.example` beside it.
//
// The failure this prevents is not cosmetic and it is this project's stated top risk: **two live values
// for one endpoint.** A build whose bundle points at one host while `build-web.mjs` bakes another into the
// service worker's runtime-caching routes produces a PWA that caches nothing, with no error anywhere
// (`apps/mobile/scripts/build-web.mjs` says so at its own import). A hostname left in a second file is how
// one platform silently keeps talking to the old origin after a domain move.
//
// TWO RULES, AND THE SECOND IS THE ONE THAT WILL EARN ITS KEEP
//  1. `endpoint-literal` — the default endpoint spelled anywhere but its declaration. Catches a copy.
//  2. `env-literal-fallback` — a read of `*_API_URL` on a line that does not name `DEFAULT_API_URL`.
//     Catches the *next* shape of the same mistake: `import.meta.env.VITE_API_URL ?? 'https://api.…'`,
//     a second production hostname that rule 1 cannot see because it is not the localhost default.
//
// WHAT IS DELIBERATELY NOT POLICED
// Root `scripts/` — every file in it is a gate, and a gate's fixtures must be free to spell the value
// they are testing (this file spells it a dozen times). The one script that legitimately *reads* the API
// URL, `apps/mobile/scripts/build-web.mjs`, lives under `apps/` and is policed. Test files are excluded
// for the same reason plus a stronger one: `packages/api-client/test/endpoint.test.ts` asserts
// `DEFAULT_API_URL === 'http://localhost:8787'`, which is the *pin* — a gate that flagged the pin would
// be arguing with the thing it protects. A test's fixture base URL is an input, not a declaration.
//
// Run `node scripts/check-one-endpoint-declaration.mjs --selftest` to watch it fail on each rule,
// including two controls so it cannot pass vacuously.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Where a second declaration could do damage: the two app shells and every shared package.
 *
 * Whole trees rather than hand-picked source dirs — unlike `check-view-transport-free.mjs`, which polices
 * *view* directories and must therefore skip an app's build scripts. This rule has the opposite shape: a
 * build script is precisely where the fourth copy lived, so `apps/mobile/scripts/` must be in scope.
 */
const POLICED = ['apps/', 'packages/']

/** `path/to/x.test.ts`, `test/`, `__tests__/` — see the header for why. */
const EXCLUDED = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/

const PATTERNS = [
  {
    id: 'endpoint-literal',
    // The dev Worker's host:port, in any scheme and with or without one — `localhost:8787` is the value,
    // `http://` is just how it is usually written.
    re: /localhost:8787/,
    hint:
      'the default endpoint is `DEFAULT_API_URL` in `packages/api-client/src/endpoint.ts` — import it. ' +
      'A second copy is a second answer to "where is the API", and the two diverge on the day the real ' +
      'domain lands (ADR-056 decision 8)',
  },
  {
    id: 'env-literal-fallback',
    re: /(?:process\.env|import\.meta\.env)\.[A-Z0-9_]*API_URL/,
    // The line must reach the one declaration. Anything else — a literal, a second constant, nothing at
    // all — is a second declaration of the default, however it is spelled.
    unless: /DEFAULT_API_URL/,
    hint:
      'an env read of the API base URL must fall back to `DEFAULT_API_URL`, not to a literal: ' +
      '`process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL`. The read itself is per-renderer by ' +
      'necessity (two bundlers inline two spellings); the *answer when it is unset* is not',
  },
]

/**
 * Recorded exceptions. An entry without a `snippet` exempts the whole file; with one, only lines
 * containing it (whitespace-collapsed, so re-indenting does not invalidate the entry). **A stale entry
 * fails the check as loudly as a violation**, so the list can shrink but never quietly rot.
 *
 * Discovered by running the check, not predicted. Three entries, and the middle one is a real finding
 * rather than a formality.
 */
const ALLOWLIST = [
  {
    file: 'packages/api-client/src/endpoint.ts',
    snippet: 'export const DEFAULT_API_URL',
    why: 'The declaration itself. Everything else in this list is measured against this line.',
  },
  {
    file: 'packages/contract/src/asyncapi.ts',
    snippet: "host: 'localhost:8787'",
    why:
      "The AsyncAPI document's `servers.dev` entry, and it is a second spelling of the value that " +
      '**cannot** be collapsed into the first: `packages/contract` sits *below* `packages/api-client` in ' +
      'the layer graph (ADR-051), so importing `DEFAULT_API_URL` here would invert the dependency and ' +
      '`pnpm boundaries` would refuse it. The two are held equal by review alone — recorded here rather ' +
      'than hidden, because that is the honest status. If a third consumer ever needs the value, the fix ' +
      'is to move the declaration down into `packages/contract` and let `api-client` re-export it.',
  },
  {
    file: 'packages/contract/scripts/check-asyncapi-current.mjs',
    snippet: 'servers: { dev:',
    why:
      "A synthetic document inside that gate's own selftest, where each scenario breaks a well-formed " +
      'fixture in exactly one way. The fixture must be able to spell a host; it configures nothing.',
  },
]

/** Whitespace-insensitive form of a source line, for stable snippet matching. */
const normalize = (line) => line.trim().replace(/\s+/g, ' ')

/**
 * Strip comments, so prose about the endpoint stays legal.
 *
 * Every gate in this repo carries this exemption and the same argument for it: a check that flagged its
 * own documentation would be deleted within a week — and this one would flag `endpoint.ts`'s own header,
 * whose entire subject is the four copies that used to exist. (The `bannedSyntax` half of
 * `pnpm boundaries` still lacks this and made Brief 1 reword a comment; recorded in `docs/11`.) String
 * literals are **not** blanked: a literal is the violation here, so blanking them would leave nothing to
 * find.
 *
 * **It skips over quoted spans, and that is not tidiness — it is the difference between this gate working
 * and not.** The first version was `check-view-transport-free.mjs`'s lexer verbatim, which looks for `/*`
 * without knowing whether it is inside a string. `packages/contract/src/asyncapi.ts:259` contains the
 * prose `'/components/schemas/*'` inside a *string*, whose `s/*` opened a block comment that never
 * closed — so every line after it, including the `host: 'localhost:8787'` this rule exists to find, was
 * read as comment. The allowlist entry for it came back **stale**, which is the only reason the blindness
 * was visible at all: a gate whose allowlist can go stale reports its own false negatives. Skipping
 * quotes trades that silent failure for a loud one — an unterminated quote (a multi-line template) leaves
 * the remainder of the line as *code*, so the worst case is a false positive somebody has to read.
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
      // `://` spares a URL inside a string, which in this file is the common case.
      const slash = rest.search(/(?<!:)\/\//)
      const quote = rest.search(/['"`]/)
      // A quote that opens before either comment marker: copy the whole literal through unexamined, so
      // its contents can neither start a comment nor hide one. Both markers are still live *after* it.
      if (quote !== -1 && (block === -1 || quote < block) && (slash === -1 || quote < slash)) {
        const closer = rest.indexOf(rest[quote], quote + 1)
        if (closer === -1) {
          line += rest // unterminated on this line — treat the remainder as code, not as comment
          break
        }
        line += rest.slice(0, closer + 1)
        rest = rest.slice(closer + 1)
        continue
      }
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

export function findViolations(source, file = '') {
  const found = []
  codeLines(source).forEach((line, i) => {
    for (const pattern of PATTERNS) {
      const hit = pattern.re.exec(line)
      if (hit && !pattern.unless?.test(line)) {
        found.push({ file, line: i + 1, code: normalize(line), value: hit[0], pattern })
      }
    }
  })
  return found
}

/**
 * Every policed source file in the working tree. `git ls-files` rather than a directory walk: it respects
 * `.gitignore` for free, so a stale `dist/` bundle cannot report yesterday's source (WP3-2 learned that
 * the hard way). `--others --exclude-standard` includes files that exist but are not committed yet.
 */
function policedFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...POLICED],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  return [...new Set(out.split('\0').filter(Boolean))]
    .map((f) => f.split(sep).join('/'))
    .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !EXCLUDED.test(f))
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'an app shell reading its own variable and falling back to the one declaration',
    why: 'THE CONTROL. Without it, a `codeLines` that ate the whole file would pass every scenario below by finding nothing.',
    source: `import { createEdgeClient, DEFAULT_API_URL } from '@nextbus/api-client'
      const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL
      export const dataSource = createEdgeClient({ baseUrl: API_URL })`,
    expect: [],
  },
  {
    name: 'a second copy of the default endpoint',
    source: "const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'",
    // Both rules fire on that one line, and that is right: it is a copy of the literal *and* a fallback
    // that does not reach the declaration. Two mistakes with one cause.
    expect: ['endpoint-literal', 'env-literal-fallback'],
  },
  {
    name: 'a fallback to a second production hostname — the shape rule 1 cannot see',
    why: 'This is the one that matters after the domain lands: no localhost anywhere, and still two answers.',
    source: "const base = import.meta.env.VITE_API_URL ?? 'https://api.example.test'",
    expect: ['env-literal-fallback'],
  },
  {
    name: 'a new renderer inventing a third variable name',
    why: '`[A-Z0-9_]*API_URL` is the point of the pattern: the rule follows the concept, not the spelling.',
    source: 'const base = process.env.NEXT_PUBLIC_API_URL',
    expect: ['env-literal-fallback'],
  },
  {
    name: 'the endpoint hiding in a test double, a header or a doc URL',
    source: "const worker = { url: 'ws://localhost:8787/v1/live' }",
    expect: ['endpoint-literal'],
  },
  {
    name: 'prose and near-misses that must not be violations',
    why: "THE SECOND CONTROL, and the reason the gate is usable: `endpoint.ts`'s own header is a paragraph about the four copies of `http://localhost:8787` that used to exist, and `build-web.mjs`'s is another. A gate that flagged them would be switched off.",
    source: `// There were four copies of http://localhost:8787 before this module existed.
      /* And a block comment naming localhost:8787 and process.env.EXPO_PUBLIC_API_URL too. */
      const port = 8787
      const label = 'localhost'
      export const OTHER = process.env.EXPO_PUBLIC_LIVE_TRANSPORT`,
    expect: [],
  },
]

function selftest() {
  console.log('check-one-endpoint-declaration --selftest: watching the gate fail on purpose')
  let failed = 0
  for (const scenario of SCENARIOS) {
    const got = findViolations(scenario.source)
      .map((v) => v.pattern.id)
      .sort()
    const want = [...scenario.expect].sort()
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed += 1
    console.log(`  ${ok ? '✓' : '✗'} ${scenario.name} → ${got.join(', ') || '(no problems)'}`)
    if (!ok) console.log(`      expected → ${want.join(', ') || '(no problems)'}`)
  }
  // The live tree is the last and best control: every finding in it must be one the allowlist covers, so
  // `--selftest` alone catches a second declaration that has landed.
  const live = report()
  if (live.unexpected.length > 0 || live.stale.length > 0) failed += 1
  console.log(
    `  ${live.unexpected.length === 0 && live.stale.length === 0 ? '✓' : '✗'} the live tree → ` +
      `${live.files.length} file(s), ${live.findings.length} finding(s), ` +
      `${live.unexpected.length} unallowed, ${live.stale.length} stale entry(ies)`,
  )
  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(`  ✓ all ${SCENARIOS.length} scenarios plus the live tree behaved as documented.`)
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

function report() {
  const files = policedFiles()
  const findings = []
  for (const file of files) {
    let src
    try {
      src = readFileSync(join(repoRoot, file), 'utf8')
    } catch {
      continue // listed but absent (deleted and not yet staged) — nothing to check
    }
    findings.push(...findViolations(src, file))
  }
  const allowed = ALLOWLIST.map((e) => ({
    ...e,
    snippet: e.snippet ? normalize(e.snippet) : undefined,
    hits: 0,
  }))
  const unexpected = []
  for (const finding of findings) {
    const match = allowed.find(
      (a) =>
        a.file === finding.file && (a.snippet === undefined || finding.code.includes(a.snippet)),
    )
    if (match) match.hits += 1
    else unexpected.push(finding)
  }
  return { files, findings, unexpected, stale: allowed.filter((a) => a.hits === 0) }
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const { files, unexpected, stale } = report()
  if (unexpected.length > 0 || stale.length > 0) {
    console.error('✗ a second declaration of where the API is (ADR-056, ADR-061)\n')
    if (unexpected.length > 0) {
      console.error(`  ${unexpected.length} site(s):\n`)
      for (const f of unexpected) {
        console.error(`  · ${f.file}:${f.line}  [${f.pattern.id}] ${f.value}`)
        console.error(`      ${f.code}`)
        console.error(`      → ${f.pattern.hint}`)
      }
      console.error(
        '\n  One declaration: `DEFAULT_API_URL` (packages/api-client/src/endpoint.ts), with the socket\n' +
          '  URL derived from it by `resolveEndpoints` → `liveSocketUrl`. If a site genuinely cannot\n' +
          '  import it — the layer graph forbids it, or it is a gate fixture — add it to ALLOWLIST in\n' +
          '  this script with the reason.',
      )
    }
    if (stale.length > 0) {
      console.error(`\n  ${stale.length} allowlist entry(ies) no longer match anything — delete:\n`)
      for (const a of stale) console.error(`  · ${a.file}${a.snippet ? `  "${a.snippet}"` : ''}`)
    }
    console.error('\n  Inventory: .env.example (repo root) · docs/10 "Configuration & secrets"')
    process.exit(1)
  }
  if (files.length === 0) {
    // A gate that matched no files would pass for ever — the failure this repo hit four times in Wave 3.
    console.error(
      '✗ check-one-endpoint-declaration matched NO files. POLICED is stale, or git ls-files is empty.',
    )
    process.exit(1)
  }
  console.log(
    `✓ one declaration of the API endpoint — ${PATTERNS.length} rules over ${files.length} files in ` +
      `${POLICED.length} trees, ${ALLOWLIST.length} allowed site(s) ` +
      `(${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
  )
}
