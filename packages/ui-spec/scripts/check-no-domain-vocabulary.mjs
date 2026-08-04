#!/usr/bin/env node
/**
 * Gate: **`@nextbus/ui-spec` must not know what a bus is.**
 *
 * ## Why this is a gate and not a convention
 *
 * ADR-075 decision 7 makes a promise about this package — it is the portable half of the system, the
 * first thing a second app over HK open data would copy — and then names its own early warning:
 * *"a `ui-spec` that has grown a `stopId` is the early warning"* that a framework is being built for
 * exactly one consumer. That is a warning nobody sees. The pressure arrives one plausible line at a time:
 * a `StopCardView` in a JSDoc example, an `etaUrgency` in a test fixture, a `routeId` in an error
 * message — each locally reasonable, and each one making the package a little less liftable.
 *
 * `layers.json` already stops this package *importing* the contract or the kernel (`use: []`), and that
 * is the structural half. It cannot see the other half: a type **named** after a bus imports nothing, in
 * exactly the way a URL literal in a screen imports nothing — the hole `check-view-transport-free.mjs`
 * was written for one wave earlier.
 *
 * ## What is scanned, and why the emitted declarations too
 *
 * The source, and then `tsc --declaration --emitDeclarationOnly` output in a temp directory. The second
 * pass is what WP6-1's acceptance asks for (*"`tsc --outDir /tmp` proves `ui-spec` names nothing
 * bus-shaped"*), and it earns its keep: an *inferred* return type can carry a name the source never
 * writes. If this package ever imported a domain type and re-exported something shaped by it, the source
 * scan would miss it and the `.d.ts` would not.
 *
 * **Comments are stripped; identifiers and string literals are not.** The first draft scanned comments
 * too, on the reasoning that a JSDoc example written in this app's terms is how vocabulary establishes
 * itself — and the selftest immediately showed the cost: a portable package cannot explain *why* it
 * exists without citing the app it was extracted from, and every ADR reference in it would have been a
 * violation. `check-no-derivation.mjs` made the same call for the same reason ("a comment must be free to
 * explain that `.sort()` belongs in the kernel"). String literals stay in scope, because that is where a
 * word stops being prose and starts being something a reader is shown — and the first run of this gate
 * found one of those in its own package's error messages.
 *
 * Matching is by **token**, not by regex over prose: identifiers are split on camelCase and
 * non-alphanumerics, lowercased, and de-pluralised. So `StopCardView`, `routeId` and `Operators` are
 * caught while `nonstop`, `stopped` and — the ones that matter for a spec format — `slot`, `state` and
 * `interaction` are not. The first draft used `\\bword(?![a-z])` with the `i` flag, which is wrong in a
 * way worth recording: `/i` applies to the character class too, so the lookahead rejected *every*
 * following letter and the pattern silently matched nothing but bare words.
 *
 * Two anti-vacuous guards, because a scanner that matched nothing would pass for ever — the failure this
 * repo has now hit five times: at least one source file must be scanned, and the declaration emit must
 * produce at least one `.d.ts`.
 *
 * Run `node scripts/check-no-domain-vocabulary.mjs --selftest` to watch it fail on purpose.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The banned vocabulary. Each entry is a word this repo's *domain* owns, with the reason it would be a
 * mistake here rather than merely off-topic.
 *
 * Word-boundary matched and case-insensitive, so `stopId`, `StopCardView` and `stop_id` all match while
 * ordinary English survives: `nonstop` does not contain the word `stop`, and — the one that matters for a
 * spec format — **`slot`, `state` and `interaction` are not near-misses**. The list is deliberately short
 * and specific; a list long enough to catch every possible leak would catch `text`.
 */
const BANNED = [
  { word: 'stop', why: 'a boarding point is this app; a spec format has slots and states' },
  { word: 'route', why: "same — and a router path is the shell's business, not the format's" },
  { word: 'eta', why: 'the arrival domain. A spec knows "a field", not "an arrival"' },
  { word: 'arrival', why: 'as above' },
  { word: 'bus', why: 'the whole point' },
  { word: 'kerb', why: 'ADR-071/072 vocabulary' },
  { word: 'pole', why: 'ADR-071/072 vocabulary' },
  { word: 'operator', why: 'KMB/CTB/GMB is a NextBus concept' },
  { word: 'fare', why: 'a domain rule with its own corpus' },
  { word: 'nearby', why: 'a screen name' },
  { word: 'favourite', why: 'a screen name' },
  { word: 'favorite', why: 'a screen name, either spelling' },
]

/** Every file with `ext` below `dir`, as absolute paths. */
function walk(dir, ext) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, ext))
    else if (entry.name.endsWith(ext)) found.push(path)
  }
  return found
}

const BY_WORD = new Map(BANNED.map((entry) => [entry.word, entry]))

/** Strip comments, keeping line numbering intact so a finding can be pointed at. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * The identifier-ish words on one line, lowercased — camelCase and PascalCase split first, so
 * `StopCardView` yields `stop card view`.
 */
export function tokens(line) {
  return line
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

/**
 * A token and its plausible singulars — **added to, never substituted for, the token itself.**
 *
 * The first draft *replaced* each token with its de-pluralised form, and the real package then passed
 * while containing the word `routes` in an error message: stripping `es` turned it into `rout`, and
 * `onPress` into `pres`. Destroying a stem to find a plural is how a vocabulary check goes quiet. So the
 * raw token stays a candidate and the two strips are extra guesses, which costs nothing and cannot lose a
 * match.
 */
function candidates(token) {
  const out = [token]
  if (token.length > 3 && token.endsWith('s')) out.push(token.slice(0, -1))
  if (token.length > 4 && token.endsWith('es')) out.push(token.slice(0, -2))
  return out
}

/** Every banned word in `source` — identifiers and string literals, never comments. */
export function findDomainWords(source, file = '') {
  const found = []
  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      const seen = new Set()
      for (const token of tokens(line)) {
        for (const candidate of candidates(token)) {
          const entry = BY_WORD.get(candidate)
          if (entry && !seen.has(candidate)) {
            seen.add(candidate)
            found.push({ file, line: index + 1, ...entry, text: line.trim() })
          }
        }
      }
    })
  return found
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: 'a format that talks about slots and states',
    why: 'THE CONTROL. Without it, a broken matcher would pass every fixture below by finding nothing.',
    source: `export interface SlotNode { name: string; when?: string }
      export const STATES = ['loading', 'empty', 'failed', 'stale', 'offline']
      export function walk(nodes) { return nodes.flatMap(project) }`,
    expect: [],
  },
  {
    name: 'a domain type in a signature',
    source: 'export function project(view: StopCardView): string[] { return [] }',
    expect: ['stop'],
  },
  {
    name: 'domain vocabulary in field names',
    source: 'const spec = { routeId: "x", poleId: "y" }',
    expect: ['pole', 'route'],
  },
  {
    name: 'a screen name in a string literal',
    why: 'A message is not prose — it is something a reader is shown, so it stays in scope. The very first run of this gate found one of these in its own package.',
    source: 'throw new Error(`the Nearby list is empty`)',
    expect: ['nearby'],
  },
  {
    name: 'a plural, and a compound',
    why: 'A vocabulary check that missed `Operators` because of the `s` would be trivially evadable.',
    source: 'type Operators = string; const buses = 2',
    expect: ['bus', 'operator'],
  },
  {
    name: 'a comment citing this app, which is exempt on purpose',
    why: 'THE SECOND CONTROL, and the reason the gate is usable at all: a portable package cannot explain WHY it exists without naming the app it was extracted from. Scanning comments made every ADR citation a violation — `check-no-derivation` made the same call for the same reason.',
    source: `// ADR-069's finding: a stop card guarded its route count with an onPress, so the ETA rows
      // showed 6 of 26 and said nothing. Hence the content-not-affordance check below.
      /** The next arrival at a pole is a field; this format only knows "a field". */
      export const CHECKS = ['slots', 'content-not-affordance', 'sibling-not-nested']`,
    expect: [],
  },
  {
    name: 'ordinary English that merely looks like it',
    why: 'THE THIRD CONTROL: a format has to be able to say `slot`, `state`, `stopped` and `nonstop` without being accused of knowing about buses. Flagging its own vocabulary is how a check gets deleted.',
    source: `export function stopped(walker) { return walker.nonstop === false }
      const states = ['stale']; const interaction = { target: 'headline' }`,
    expect: [],
  },
]

function selftest() {
  console.log('check-no-domain-vocabulary --selftest: watching the gate fail on purpose')
  let failed = 0
  for (const fixture of FIXTURES) {
    const got = [...new Set(findDomainWords(fixture.source).map((f) => f.word))].sort()
    const want = [...fixture.expect].sort()
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed += 1
    console.log(`  ${ok ? '✓' : '✗'} ${fixture.name} → ${got.join(', ') || '(clean)'}`)
    if (!ok) console.log(`      expected → ${want.join(', ') || '(clean)'}`)
  }
  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(`  ✓ all ${FIXTURES.length} scenarios behaved as documented.`)
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

function main() {
  // `test/` is scanned as well as `src/`, and that is deliberate: a fixture written in terms of one app's
  // screens is how the vocabulary arrives, and a format whose own tests can only be written about that app
  // is not the portable thing this package claims to be. The fixtures are a title, some items and a badge.
  const sources = [...walk(join(pkgRoot, 'src'), '.ts'), ...walk(join(pkgRoot, 'test'), '.ts')]
  if (sources.length === 0) {
    console.error('✗ scanned NO source files. `src/` moved, or the walk is broken.')
    process.exit(1)
  }

  const outDir = mkdtempSync(join(tmpdir(), 'nextbus-ui-spec-dts-'))
  let declarations = []
  try {
    // The emitted `.d.ts`, which is where an *inferred* type carrying a domain name would show up.
    execFileSync(
      process.execPath,
      [
        join(pkgRoot, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
        '--project',
        join(pkgRoot, 'tsconfig.json'),
        '--noEmit',
        'false',
        '--declaration',
        '--emitDeclarationOnly',
        '--outDir',
        outDir,
      ],
      { cwd: pkgRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    declarations = walk(outDir, '.d.ts')
    if (declarations.length === 0) {
      console.error('✗ the declaration emit produced no .d.ts — the second scan would be vacuous.')
      process.exit(1)
    }
    const findings = [
      ...sources.flatMap((file) =>
        findDomainWords(readFileSync(file, 'utf8'), relative(pkgRoot, file)),
      ),
      ...declarations.flatMap((file) =>
        findDomainWords(readFileSync(file, 'utf8'), `(emitted) ${relative(outDir, file)}`),
      ),
    ]
    if (findings.length > 0) {
      console.error('✗ @nextbus/ui-spec has grown domain vocabulary (ADR-075 decision 7)\n')
      for (const finding of findings) {
        console.error(`  · ${finding.file}:${finding.line}  [${finding.word}]`)
        console.error(`      ${finding.text}`)
        console.error(`      → ${finding.why}`)
      }
      console.error(
        "\n  The format describes slots, states and interactions. NextBus's own specs are data,\n" +
          '  in packages/contract/ui/ — that is where a bus belongs.',
      )
      process.exit(1)
    }
    console.log(
      `✓ no domain vocabulary — ${BANNED.length} words over ${sources.length} source file(s) ` +
        `and ${declarations.length} emitted declaration(s).`,
    )
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

// Only when run as a script: the matchers above are exported so they can be exercised directly, and an
// import that ran the whole check as a side effect would make that impossible to do quietly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) selftest()
  else main()
}
