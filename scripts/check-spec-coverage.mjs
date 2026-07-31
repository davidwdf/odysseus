#!/usr/bin/env node
// The fixture-harness gate (WP1-5 of docs/proposals/03).
//
// ADR-052 separates three kinds of change, and only the first is a schema problem. Wire *shapes* are
// generated from one Zod declaration, so cross-platform equivalence is by construction. **Domain
// rules** — `dedupeEtas`, the honest-ETA thresholds, bearing labels, fare formatting — cannot be
// generated. They get hand-transcribed into Swift and Kotlin, and hand-transcription is exactly
// where platforms silently diverge. Their only equivalence mechanism is a language-neutral corpus
// that all three test suites read: `packages/core/spec/*.spec.json`.
//
// A corpus is only worth anything if it stays honest, and the plan's risk table names the two ways
// it rots. This script is the mitigation for both, so it enforces the relationship in **both**
// directions:
//
//   1. Every `@spec`-tagged export has a corpus group, and that group is **non-empty**. Otherwise a
//      rule claims to be specified and isn't — the worst state, because the tag is trusted.
//   2. Every corpus file, and every group inside it, is **referenced by a tag**. An orphan corpus is
//      rot: rows that no longer correspond to any rule, quietly passing forever. This is the
//      direction people forget, and it is the one that catches a deleted or renamed export.
//
// It additionally pins the **named boundary rows** the plan demands (`REQUIRED_ROWS` below). A
// corpus can satisfy both directions above while covering nothing interesting; these rows are the
// specific, agreed-interesting cases, so deleting one is a red build rather than a silent thinning.
//
// The tag convention is `@spec <module>#<export>` in the JSDoc of an exported function, where
// `<module>` is the source file's stem and `<export>` is the function's own name. Both halves are
// checked, so a tag cannot drift onto the wrong corpus or survive a rename.
//
// Run `--selftest` to watch it fail on purpose, in every direction, against synthetic fixtures. A
// gate nobody has seen fail is not known to work, so `packages/core`'s `test` script runs the
// selftest before the real check.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_DIR = join(repoRoot, 'packages', 'core', 'src')
const SPEC_DIR = join(repoRoot, 'packages', 'core', 'spec')

/**
 * The boundary rows WP1-5 is required to carry, as `module#group:caseId`. Each one is a bug waiting
 * to happen rather than a decorative example — see the `why` on each case for what it catches. Do
 * not remove an entry to make a build green: removing the row and removing the entry is the same
 * act, and it needs the same conversation as any other coverage regression.
 */
const REQUIRED_ROWS = [
  // The minute-rounding boundary, on both the value and the marker that reads it. ADR-008 forbids
  // fake precision, and floor-versus-round is precisely where a port fabricates a minute.
  'eta#etaView:minute-boundary-119s',
  'eta#etaView:minute-boundary-120s',
  'eta#etaView:minute-boundary-121s',
  'eta#formatRelative:minute-boundary-119s-en',
  'route-position#inferBusMarkers:minute-boundary-119s-at-index-0',
  'route-position#inferBusMarkers:minute-boundary-120s-at-index-0',
  'route-position#inferBusMarkers:minute-boundary-121s-at-index-0',
  // A 4-member place — clustering has been N-member since ADR-042, so a pair proves nothing.
  'search#stopMatchesOperators:four-member-place-any-member-operator',
  'search#searchStops:four-member-place-appears-once',
  'geo#formatWalkRange:four-member-place-spans-two-walk-times',
  // An id containing a literal `|`. The favourites key is `${memberStopId}|${routeId}` and the
  // member id itself contains `:`, so nothing but convention keeps a pipe out of a field.
  'eta#dedupeEtas:literal-pipe-in-route-id-collides',
  // One rider line boarding at TWO poles of one place, with two service-type variants at one of them
  // (WP5-9). Both halves of the rule are in that one row: a place is N poles (ADR-042), so two poles
  // are two arrivals, while two variants at one pole are still one. Delete it and the model can
  // silently go back to publishing one reading per line per place, which reads as "no buses" at the
  // sibling kerb.
  'eta#dedupeEtas:one-line-at-two-poles-keeps-a-reading-for-each',
  // Empty `en` on a circular route. Upstream really does this; the blank sits in the field the
  // code reads first, so it is a live failure mode, not a hypothetical one.
  'search#searchStops:circular-route-blank-en-found-by-chinese-name',
  'search#searchRoutes:circular-route-blank-en-found-by-number',
  'eta#classifyRemark:blank-en-circular-route-last-bus',
  // Hong Kong wall-clock time must not depend on the device's zone. The `Z` row is the one that
  // fails on a CI runner outside HK if anyone reaches for a locale formatter again.
  'eta#formatClock:utc-input-renders-as-hong-kong-time',
  'eta#formatClock:crosses-midnight-into-the-next-hong-kong-day',
  'eta#formatClock:sub-minute-precision-is-truncated-not-rounded',
  'eta#formatClock:an-unparseable-string-has-no-clock-time',
]

// ── Collection ──────────────────────────────────────────────────────────────

/** Every `@spec` tag in `srcDir`, with the export it sits on. */
function collectTags(srcDir) {
  const tags = []
  const files = existsSync(srcDir) ? readdirSync(srcDir).filter((f) => f.endsWith('.ts')) : []
  for (const file of files.sort()) {
    const module = basename(file, '.ts')
    const lines = readFileSync(join(srcDir, file), 'utf8').split('\n')
    for (const [i, line] of lines.entries()) {
      const m = /^\s*\*\s*@spec\s+(\S*)\s*$/.exec(line)
      if (!m) continue
      // The tagged export is the next `export function`/`export const` after the doc block.
      let exportName = null
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const e = /^export (?:function|const) (\w+)/.exec(lines[j])
        if (e) {
          exportName = e[1]
          break
        }
      }
      tags.push({ raw: m[1], file, module, line: i + 1, exportName })
    }
  }
  return tags
}

/** Every `*.spec.json` in `specDir`, parsed. */
function collectCorpora(specDir) {
  const corpora = []
  const files = existsSync(specDir) ? readdirSync(specDir).filter((f) => f.endsWith('.json')) : []
  for (const file of files.sort()) {
    const path = join(specDir, file)
    const entry = { file, module: basename(file, '.spec.json'), data: null, parseError: null }
    if (!file.endsWith('.spec.json')) entry.parseError = 'not named <module>.spec.json'
    else {
      try {
        entry.data = JSON.parse(readFileSync(path, 'utf8'))
      } catch (err) {
        entry.parseError = err.message
      }
    }
    corpora.push(entry)
  }
  return corpora
}

// ── Analysis ────────────────────────────────────────────────────────────────

/**
 * Both directions plus the required rows. Returns problems (each with a stable `code`, so the
 * selftest can assert *which* failure fired rather than merely that something did) and stats.
 */
function analyse({ srcDir, specDir, required = [] }) {
  const problems = []
  const fail = (code, message) => problems.push({ code, message })

  const tags = collectTags(srcDir)
  const corpora = collectCorpora(specDir)
  const byModule = new Map(corpora.map((c) => [c.module, c]))

  for (const c of corpora) {
    if (c.parseError) fail('CORPUS_UNPARSABLE', `${c.file}: ${c.parseError}`)
    else if (c.data === null || typeof c.data !== 'object' || Array.isArray(c.data))
      fail('CORPUS_UNPARSABLE', `${c.file}: top level must be a JSON object`)
    else {
      if (c.data.module !== c.module)
        fail(
          'CORPUS_MODULE_MISMATCH',
          `${c.file}: "module" is "${c.data.module}", expected "${c.module}"`,
        )
      if (c.data.version !== 1)
        fail('CORPUS_MODULE_MISMATCH', `${c.file}: "version" must be 1 (the corpus format version)`)
      if (typeof c.data.doc !== 'string' || c.data.doc.length < 40)
        fail('CORPUS_UNDOCUMENTED', `${c.file}: needs a "doc" explaining the file to a porter`)
      if (typeof c.data.source !== 'string')
        fail('CORPUS_UNDOCUMENTED', `${c.file}: needs a "source" naming the file it specifies`)
      if (!c.data.groups || typeof c.data.groups !== 'object' || Array.isArray(c.data.groups))
        fail('CORPUS_UNPARSABLE', `${c.file}: "groups" must be an object of group name → group`)
    }
  }

  // Direction 1: every tag resolves to a non-empty, well-formed group.
  const referenced = new Set()
  const seenTags = new Set()
  let caseCount = 0
  let defectCount = 0
  for (const tag of tags) {
    const where = `${tag.file}:${tag.line}`
    if (!/^[a-z0-9-]+#[A-Za-z0-9_]+$/.test(tag.raw)) {
      fail('TAG_MALFORMED', `${where}: "@spec ${tag.raw}" is not "<module>#<export>"`)
      continue
    }
    const [module, group] = tag.raw.split('#')
    if (!tag.exportName) {
      fail('TAG_NOT_ON_EXPORT', `${where}: "@spec ${tag.raw}" has no exported function under it`)
      continue
    }
    if (module !== tag.module)
      fail(
        'TAG_MODULE_MISMATCH',
        `${where}: tag says module "${module}" but the file is "${tag.module}"`,
      )
    if (group !== tag.exportName)
      fail(
        'TAG_NAME_MISMATCH',
        `${where}: tag says group "${group}" but the export is "${tag.exportName}"`,
      )
    if (seenTags.has(tag.raw))
      fail('TAG_DUPLICATE', `${where}: "${tag.raw}" is tagged more than once`)
    seenTags.add(tag.raw)
    referenced.add(tag.raw)

    const corpus = byModule.get(module)
    if (!corpus?.data) {
      fail(
        'CORPUS_FILE_MISSING',
        `${where}: "@spec ${tag.raw}" has no corpus at spec/${module}.spec.json`,
      )
      continue
    }
    const g = corpus.data.groups?.[group]
    if (!g) {
      fail('CORPUS_GROUP_MISSING', `${where}: spec/${module}.spec.json has no group "${group}"`)
      continue
    }
    if (typeof g.doc !== 'string' || g.doc.length < 20)
      fail('CORPUS_UNDOCUMENTED', `${module}#${group}: needs a "doc" stating the rule in prose`)
    if (!Array.isArray(g.cases) || g.cases.length === 0) {
      fail(
        'CORPUS_GROUP_EMPTY',
        `${where}: "@spec ${tag.raw}" resolves to a corpus group with no cases`,
      )
      continue
    }
    const ids = new Set()
    for (const [i, c] of g.cases.entries()) {
      const at = `${module}#${group}[${i}]`
      // `name` / `why` rather than `id` / `note`: WP1-2's id corpus
      // (`packages/core/spec/ids.spec.json`) uses those names too, and one corpus format
      // across the repo is the difference between a native scaffold having one reader and two.
      if (typeof c.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.name)) {
        fail(
          'CASE_INVALID',
          `${at}: "name" must be a lower-kebab-case string, got ${JSON.stringify(c.name)}`,
        )
        continue
      }
      if (ids.has(c.name))
        fail('CASE_INVALID', `${module}#${group}: duplicate case name "${c.name}"`)
      ids.add(c.name)
      if (!c.args || typeof c.args !== 'object' || Array.isArray(c.args))
        fail(
          'CASE_INVALID',
          `${module}#${group}:${c.name}: "args" must be an object of named arguments`,
        )
      if (!('expect' in c))
        fail(
          'CASE_INVALID',
          `${module}#${group}:${c.name}: needs an "expect" (use null for absent)`,
        )
      if (c.knownDefect === true) {
        defectCount++
        if (typeof c.why !== 'string' || c.why.length < 40)
          fail(
            'CASE_INVALID',
            `${module}#${group}:${c.name}: a knownDefect row must carry a "why" saying what is wrong and what the row becomes once it is fixed`,
          )
      }
      caseCount++
    }
  }

  // Direction 2: nothing in the corpus is unreferenced. An orphan is rot.
  for (const c of corpora) {
    if (!c.data?.groups) continue
    const groups = Object.keys(c.data.groups)
    const hits = groups.filter((g) => referenced.has(`${c.module}#${g}`))
    if (hits.length === 0) {
      fail(
        'ORPHAN_CORPUS_FILE',
        `spec/${c.file}: no @spec tag anywhere in packages/core/src references it — either tag the export it specifies, or delete the file`,
      )
      continue
    }
    for (const g of groups) {
      if (!referenced.has(`${c.module}#${g}`))
        fail(
          'ORPHAN_CORPUS_GROUP',
          `spec/${c.file}: group "${g}" is referenced by no @spec tag — the export was renamed or removed, so these rows now specify nothing`,
        )
    }
  }

  // The named boundary rows. Matched with one regex rather than `split(':')` for two reasons: it
  // validates the reference's shape instead of silently accepting a typo as a missing row, and it
  // keeps this file clear of WP1-2's `check-no-adhoc-id-parsing.mjs` gate, which reasonably reads a
  // bare `split(':')` as somebody parsing a canonical id by hand. This is a corpus-row reference —
  // `<module>#<group>:<case>` — not an id, so it belongs in neither the parser nor that allowlist.
  const ROW_REF = /^([a-z0-9-]+)#(\w+):([a-z0-9-]+)$/
  for (const row of required) {
    const ref = ROW_REF.exec(row)
    if (!ref) {
      fail('REQUIRED_ROW_MISSING', `"${row}" is not a "<module>#<group>:<case>" reference`)
      continue
    }
    const [, module, group, caseName] = ref
    const cases = byModule.get(module)?.data?.groups?.[group]?.cases
    if (!Array.isArray(cases) || !cases.some((c) => c.name === caseName))
      fail(
        'REQUIRED_ROW_MISSING',
        `${row} is a named boundary row required by docs/proposals/03 (WP1-5) and is not in the corpus`,
      )
  }

  return {
    problems,
    stats: {
      modules: corpora.length,
      tags: tags.length,
      groups: corpora.reduce((n, c) => n + Object.keys(c.data?.groups ?? {}).length, 0),
      cases: caseCount,
      defects: defectCount,
      required: required.length,
    },
  }
}

// ── Selftest ────────────────────────────────────────────────────────────────

/** A minimal well-formed pair, which each scenario then breaks in exactly one way. */
function scaffold(
  dir,
  { tag = true, group = true, cases = 1, extraGroup = false, extraFile = false },
) {
  const src = join(dir, 'src')
  const spec = join(dir, 'spec')
  writeFileSync(
    join(src, 'demo.ts'),
    [
      '/**',
      ' * Doubles a number.',
      ...(tag ? [' *', ' * @spec demo#twice'] : []),
      ' */',
      'export function twice(n: number): number {',
      '  return n * 2',
      '}',
      '',
    ].join('\n'),
  )
  const groups = {}
  if (group) {
    groups.twice = {
      doc: 'Doubles its argument. Exists only to give the selftest something well-formed to break.',
      cases: Array.from({ length: cases }, (_, i) => ({
        name: `doubles-${i + 1}`,
        args: { n: i + 1 },
        expect: (i + 1) * 2,
      })),
    }
  }
  if (extraGroup)
    groups.thrice = {
      doc: 'A group no tag references — this is what rot looks like.',
      cases: [{ name: 'x', args: { n: 1 }, expect: 3 }],
    }
  const file = {
    module: 'demo',
    source: 'src/demo.ts',
    version: 1,
    doc: 'A synthetic corpus used only by check-spec-coverage.mjs --selftest, so the gate can be watched failing.',
    groups,
  }
  writeFileSync(join(spec, 'demo.spec.json'), `${JSON.stringify(file, null, 2)}\n`)
  if (extraFile)
    writeFileSync(
      join(spec, 'ghost.spec.json'),
      `${JSON.stringify({ ...file, module: 'ghost', source: 'src/ghost.ts', groups: { gone: { doc: 'The export this specified was deleted or renamed.', cases: [{ name: 'x', args: {}, expect: null }] } } }, null, 2)}\n`,
    )
}

const SCENARIOS = [
  {
    name: 'a well-formed tag + corpus pair passes',
    build: (d) => scaffold(d, {}),
    required: ['demo#twice:doubles-1'],
    expect: [],
  },
  {
    name: 'direction 1 — a tagged export whose corpus group is EMPTY',
    build: (d) => scaffold(d, { cases: 0 }),
    expect: ['CORPUS_GROUP_EMPTY'],
  },
  {
    name: 'direction 1 — a tagged export whose corpus group is MISSING',
    build: (d) => scaffold(d, { group: false }),
    expect: ['CORPUS_GROUP_MISSING', 'ORPHAN_CORPUS_FILE'],
  },
  {
    name: 'direction 2 — a corpus GROUP no tag references',
    build: (d) => scaffold(d, { extraGroup: true }),
    expect: ['ORPHAN_CORPUS_GROUP'],
  },
  {
    name: 'direction 2 — a corpus FILE no tag references',
    build: (d) => scaffold(d, { extraFile: true }),
    expect: ['ORPHAN_CORPUS_FILE'],
  },
  {
    name: 'a named boundary row that has been deleted',
    build: (d) => scaffold(d, {}),
    required: ['demo#twice:the-row-someone-deleted'],
    expect: ['REQUIRED_ROW_MISSING'],
  },
  {
    // A rename caught from three sides at once, which is the point of checking both directions: the
    // tag no longer matches its export, it resolves to nothing, and the rows it used to reference
    // are now orphaned. Reported as an orphan FILE rather than GROUP because this fixture's corpus
    // has only the one group, so nothing in the file is referenced any more.
    name: 'a tag pointing at the wrong export name',
    build: (d) => {
      scaffold(d, {})
      const p = join(d, 'src', 'demo.ts')
      writeFileSync(p, readFileSync(p, 'utf8').replace('@spec demo#twice', '@spec demo#double'))
    },
    expect: ['TAG_NAME_MISMATCH', 'CORPUS_GROUP_MISSING', 'ORPHAN_CORPUS_FILE'],
  },
  {
    name: 'a knownDefect row with no explanation',
    build: (d) => {
      scaffold(d, {})
      const p = join(d, 'spec', 'demo.spec.json')
      const data = JSON.parse(readFileSync(p, 'utf8'))
      data.groups.twice.cases[0].knownDefect = true
      writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`)
    },
    expect: ['CASE_INVALID'],
  },
]

function selftest({ verbose }) {
  let failures = 0
  console.log('check-spec-coverage --selftest: watching the gate fail on purpose')
  for (const s of SCENARIOS) {
    const dir = mkdtempSync(join(tmpdir(), 'nextbus-spec-selftest-'))
    try {
      mkdirSync(join(dir, 'src'))
      mkdirSync(join(dir, 'spec'))
      s.build(dir)
      const { problems } = analyse({
        srcDir: join(dir, 'src'),
        specDir: join(dir, 'spec'),
        required: s.required ?? [],
      })
      const got = [...new Set(problems.map((p) => p.code))].sort()
      const want = [...new Set(s.expect)].sort()
      const ok = got.join(',') === want.join(',')
      if (!ok) failures++
      console.log(
        `  ${ok ? '✓' : '✗'} ${s.name} → ${got.length ? got.join(', ') : '(no problems)'}`,
      )
      if (!ok || verbose) {
        console.log(`      expected: ${want.length ? want.join(', ') : '(no problems)'}`)
        for (const p of problems) console.log(`      · ${p.code}: ${p.message}`)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  if (failures > 0) {
    console.error(`✗ selftest: ${failures} scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(
    `  ✓ all ${SCENARIOS.length} scenarios behaved as documented (--verbose for details).`,
  )
}

// ── Entry point ─────────────────────────────────────────────────────────────

if (process.argv.includes('--selftest')) {
  selftest({ verbose: process.argv.includes('--verbose') })
} else {
  const { problems, stats } = analyse({
    srcDir: SRC_DIR,
    specDir: SPEC_DIR,
    required: REQUIRED_ROWS,
  })
  if (problems.length > 0) {
    console.error('✗ the @spec corpus and the code have fallen out of step:\n')
    for (const p of problems) console.error(`  · ${p.code}: ${p.message}`)
    console.error(
      [
        '',
        'Every `@spec`-tagged export needs a non-empty corpus group, and every corpus group needs a',
        'tag. See the header of scripts/check-spec-coverage.mjs, and `--selftest` to watch this fail.',
      ].join('\n'),
    )
    process.exit(1)
  }
  console.log(
    [
      `✓ @spec corpus coverage holds — ${stats.tags} tagged export(s) across ${stats.modules} corpus`,
      `file(s), ${stats.groups} group(s), ${stats.cases} case(s), no orphans, all`,
      `${stats.required} named boundary rows present (${stats.defects} row(s) flagged knownDefect).`,
    ].join(' '),
  )
}
