#!/usr/bin/env node
// Gate for the ADR log: a generated index, a controlled `Status` vocabulary, and the two things
// nothing in this repo has ever been able to check — that an `ADR-NNN` reference names an ADR that
// exists, and that a supersede/amend claim is written down on *both* sides of the relation.
//
// WHY THIS EXISTS
// `docs/08-decision-log.md` is 122 decisions in one 8,000-line file with no table of contents, and it
// stays one file on purpose: **an ADR number is an address here, like a commit hash.** Over two
// thousand `ADR-NNN` references live *outside* the log — in `packages/contract/ui/*.spec.json`, in
// `packages/i18n/src/catalogue.ts`, in `packages/core/src/live.ts`, in `openapi.json`, in corpus
// fixtures and in code comments — and several hundred in-file anchor links point at
// `#adr-NNN--slug`. Renumbering, merging or splitting would invalidate all of it and nothing would
// notice. So the log is never consolidated; instead it gets an index that cannot rot and three rules.
//
// THE THREE RULES
//  1. `stale-index` / `missing-index` — the table at the top is *generated from the headings and the
//     Status lines*, by this script (`--write`), and a copy that no longer matches is a red build.
//     Same emit-and-gate shape as `openapi.json`, `asyncapi.json` and the component specs.
//  2. `dangling-reference` — an `ADR-NNN` token, in ANY tracked file, that names no heading. This is
//     the one that has never been checkable: a typo'd reference in a spec fixture or a comment reads
//     exactly like a real citation, and the number it points at may simply not exist. Its twin,
//     `broken-anchor`, is the link half: the number resolves but `#adr-NNN--slug` does not, so the
//     link silently lands at the top of an 8,000-line file. Eleven of those had accumulated — five
//     bare `#adr-052`-style targets and six whose ADR had been retitled after the link was written.
//  3. `one-sided-relation` — if ADR-B's body says it **supersedes / amends / reverses** ADR-A, then
//     ADR-A's own Status line has to say so too. This is the WP6-7b failure mode: *"it is in an ADR"*
//     was treated as settled law when the ADR had been amended out from under it four rows earlier.
//     A reader who lands on ADR-A must learn its fate from ADR-A, not from grepping forward.
//  Plus `missing-status` / `unknown-status` / `duplicate-number`, which are what make rule 1 and rule
//  3 mean anything: the index's third column and the reciprocity check both read the Status line.
//
// THE VOCABULARY IS THREE WORDS, AND IT IS ABOUT THE DECISION, NOT THE CODE
//   **Accepted**                — in force as written.
//   **Amended by ADR-NNN[, …]** — in force, but a later ADR changed part of it.
//   **Superseded by ADR-NNN[, …]** — no longer in force.
// Implementation state ("Decided and implemented 2026-08-03", "Built & verified on web", "not yet
// implemented") is deliberately NOT in the vocabulary: it is orthogonal, it is information-rich, and
// it already lives in the freeform remainder after the em dash. The token answers *"can I still rely
// on this?"*; the remainder answers everything else. Add a fourth word only when an ADR needs one —
// a word nothing uses is a word nobody agrees on.
//
// FALSE POSITIVES, HANDLED DELIBERATELY (rule 2)
//  · `ADR-NNN` as a literal placeholder — in the log's own header and in CLAUDE.md — is not matched:
//    the pattern is `\bADR-(\d+)\b`, so a non-numeric suffix is invisible to it. That is why the
//    placeholder is spelled with letters and must stay that way.
//  · A prose range ("ADR-001 … ADR-122") needs no special case: each endpoint is checked on its own
//    and both exist. A range whose endpoint does not exist SHOULD fail, and does.
//  · Anchor slugs (`#adr-042--…`) are lowercase, so they are not citations to the case-sensitive
//    `REFERENCE` pattern — they are checked separately, as anchors, by `broken-anchor`.
//  · Binary files are skipped by content (a NUL byte), not by extension.
//  · **This file is the one exemption**, and it is one file rather than the whole of `scripts/`: the
//    selftest below has to be free to spell a number that does not exist (`ADR-404`) or it cannot
//    prove the rule works, and every other gate in this repo makes the same trade for its own
//    fixtures. The cost is that a typo in *this file's* prose is not caught; the narrow scope is
//    itself covered by a scenario, so `scripts/` at large stays policed.
//
// FALSE POSITIVES, HANDLED DELIBERATELY (rule 3)
//  · Link *targets* are stripped before the prose is read. Without that, the anchor
//    `#adr-042--…-supersedes-adr-022s-pair-merge--invariant` makes every one of the eight documents
//    that link to ADR-042 look like it supersedes ADR-022.
//  · Only ACTIVE verbs count (`supersedes`, `superseding`, `amends`, `reverses`, …). `Superseded by`
//    and `Amended by` are how side A *acknowledges* the relation, so counting them would make every
//    correct pair look like a claim needing its own reciprocal.
//  · The claim's object must sit within `RELATION_WINDOW` characters of the verb and before the next
//    `.`, `;` or `:` — a clause, not a paragraph. ADR-059's *"amends the plan, which put the whole
//    thing in `contract`: … and ADR-052's type-only gate forbids …"* is the shape this excludes: the
//    ADR named after the colon is the reason, not the object.
//  · It OVER-catches a clause with two objects, and that is the deliberate side of the trade. ADR-071
//    says *"Amends ADR-042 (…) and closes ADR-062's orphaning hazard"* — one verb, two ADRs, and only
//    the first is the object of `amends`. Cutting the clause at ` and ` would fix it and would break
//    ADR-029's *"supersedes ADR-018's livery axis and the Ink-livery part of ADR-028"*, where the
//    second ADR is a real object. Both shapes are ambiguous in English, so the gate prefers the false
//    positive: it costs a human one judgement call and a Status line that is true anyway, where a
//    false negative silently loses the relation the reader needed.
//  · `replaces` is NOT a relation verb. It is used dozens of times about code, assertions and screens
//    ("the inverse of the assertion it replaces"), and every real ADR-to-ADR use of it also carries a
//    supersede or an amend.
//
// Run `node scripts/check-adr-index.mjs --selftest` to watch each rule fail on purpose, with five
// controls (a clean log; the placeholder/range/anchor trio; a reciprocated pair; the colon shape; and
// this file's own exemption, so it is one file rather than all of `scripts/`) plus the live tree, so
// it cannot pass vacuously.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The one file this gate is about. Everything else is only scanned for references. */
const LOG = 'docs/08-decision-log.md'

const BEGIN =
  '<!-- BEGIN ADR INDEX — generated by scripts/check-adr-index.mjs. Do not edit by hand: run `pnpm check:adr-index:write`. -->'
const END = '<!-- END ADR INDEX -->'

/** A Status token is one of these, and nothing else. See the header for why it is this short. */
const STATUS_TOKEN = /^(?:Accepted|(?:Amended|Superseded) by ADR-\d{3}(?:, ADR-\d{3})*)$/

/** Active claims only — `Superseded by` is the acknowledgement, not the claim. */
const RELATION_VERB = /\b(?:[Ss]upersed(?:es|ing)|[Aa]mend(?:s|ing)|[Rr]evers(?:es|ing))\b/g

/** How far past the verb the object may sit. A clause, not a paragraph. */
const RELATION_WINDOW = 90

/** Any citation, anywhere in the repo. Case-sensitive, so lowercase anchor slugs are not citations. */
const REFERENCE = /\bADR-(\d+)\b/g

// ── parsing ────────────────────────────────────────────────────────────────────────────────────

/**
 * GitHub's heading-anchor algorithm, as far as this file needs it: lowercase, drop everything that is
 * not a letter, a number, a space, a hyphen or an underscore, then spaces to hyphens. Validated
 * against the log's own links — 352 of the 363 `#adr-…` anchors in the repo resolve to a slug this
 * produces, and the 11 that do not are pre-existing typos in other docs (see the header).
 */
export function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} \-_]/gu, '')
    .replace(/ /g, '-')
}

/** Link targets out, emphasis out, whitespace collapsed — what the prose actually says. */
function plain(text) {
  return text
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[*`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseLog(source) {
  const lines = source.split('\n')
  const entries = []
  lines.forEach((line, i) => {
    const m = /^## ADR-(\d{3}) — (.+)$/.exec(line)
    if (m) entries.push({ number: m[1], title: m[2].trim(), heading: line.slice(3), start: i })
  })
  entries.forEach((entry, k) => {
    const end = k + 1 < entries.length ? entries[k + 1].start : lines.length
    entry.line = entry.start + 1
    entry.slug = slugify(entry.heading)
    entry.body = lines.slice(entry.start, end)
    const s = entry.body.findIndex((l) => /^- \*\*Status:\*\*/.test(l))
    if (s === -1) return
    // A Status block is its bullet plus every indented continuation line under it.
    let last = s
    while (
      last + 1 < entry.body.length &&
      /^\s+\S/.test(entry.body[last + 1]) &&
      !/^- /.test(entry.body[last + 1])
    ) {
      last += 1
    }
    entry.statusLineNumber = entry.start + s + 1
    entry.statusText = plain(entry.body.slice(s, last + 1).join(' '))
    const token = /^- \*\*Status:\*\*\s+\*\*([^*]+?)\*\*/.exec(entry.body[s])
    entry.status = token ? token[1].trim() : null
    entry.statusRaw = entry.body[s]
  })
  return entries
}

// ── the index ──────────────────────────────────────────────────────────────────────────────────

export function renderIndex(entries) {
  const rows = [...entries]
    .sort((a, b) => a.number.localeCompare(b.number))
    .map(
      (e) =>
        `| [${e.number}](#${e.slug}) | ${e.title.replace(/\|/g, '\\|')} | ${e.status ?? '—'} |`,
    )
  return [
    BEGIN,
    '',
    `> **Index** — all ${entries.length} decisions, in numeric order. The entries below are in the order`,
    '> they were written, which is *nearly* numeric: ADR-030 → 033 → 032 → 031 is a real out-of-order run.',
    '> **Status** is one of **Accepted** (in force as written), **Amended by ADR-NNN** (in force, but a later',
    "> ADR changed part of it) or **Superseded by ADR-NNN** (no longer in force) — the entry's own `Status`",
    '> line carries the detail, including whether it was ever built. An ADR number is a **permanent address**:',
    '> thousands of references to it live outside this file — component specs, corpus fixtures, code comments,',
    '> other docs — so nothing here is renumbered, merged, split or deleted.',
    '',
    '| # | Decision | Status |',
    '| --- | --- | --- |',
    ...rows,
    '',
    END,
  ].join('\n')
}

function locateIndex(lines) {
  const begin = lines.findIndex((l) => l.startsWith('<!-- BEGIN ADR INDEX'))
  const end = lines.findIndex((l) => l.startsWith(END))
  if (begin === -1 || end === -1 || end < begin) return null
  return { begin, end }
}

/** Rewrite the block in place, or bootstrap it after the intro's `---` rule. */
export function writeIndex(source, entries) {
  const lines = source.split('\n')
  const at = locateIndex(lines)
  const block = renderIndex(entries).split('\n')
  if (at) {
    lines.splice(at.begin, at.end - at.begin + 1, ...block)
    return lines.join('\n')
  }
  const rule = lines.findIndex((l) => l.trim() === '---')
  const first = entries.length > 0 ? entries[0].start : lines.length
  const anchor = rule !== -1 && rule < first ? rule + 1 : first
  lines.splice(anchor, 0, '', ...block)
  return lines.join('\n')
}

// ── the rules ──────────────────────────────────────────────────────────────────────────────────

function indexProblems(source, entries) {
  const lines = source.split('\n')
  const at = locateIndex(lines)
  if (!at) {
    return [
      {
        id: 'missing-index',
        where: LOG,
        detail: 'no generated index block — run `pnpm check:adr-index:write`',
      },
    ]
  }
  const found = lines.slice(at.begin, at.end + 1).join('\n')
  const want = renderIndex(entries)
  if (found === want) return []
  const a = found.split('\n')
  const b = want.split('\n')
  const i = a.findIndex((l, k) => l !== b[k])
  return [
    {
      id: 'stale-index',
      where: `${LOG}:${at.begin + 1 + Math.max(i, 0)}`,
      detail:
        `the index no longer matches the headings and Status lines below it\n` +
        `      in the file → ${a[i] ?? '(nothing — the index is short)'}\n` +
        `      generated   → ${b[i] ?? '(nothing — the index is long)'}`,
    },
  ]
}

function statusProblems(entries) {
  const problems = []
  const seen = new Map()
  for (const entry of entries) {
    const at = `${LOG}:${entry.line}`
    if (seen.has(entry.number)) {
      problems.push({
        id: 'duplicate-number',
        where: at,
        detail: `ADR-${entry.number} is already used at line ${seen.get(entry.number)}`,
      })
    }
    seen.set(entry.number, entry.line)
    if (!entry.statusText) {
      problems.push({
        id: 'missing-status',
        where: at,
        detail: `ADR-${entry.number} has no \`- **Status:**\` line`,
      })
      continue
    }
    if (!entry.status || !STATUS_TOKEN.test(entry.status)) {
      problems.push({
        id: 'unknown-status',
        where: `${LOG}:${entry.statusLineNumber}`,
        detail: `ADR-${entry.number}'s Status starts with ${
          entry.status ? `**${entry.status}**` : 'no bold token'
        }, which is not in the vocabulary`,
      })
    }
  }
  return problems
}

/** Every ADR-to-ADR claim ADR-B's prose makes, as `{ from, to, quote }`. */
export function claims(entries) {
  const out = []
  for (const entry of entries) {
    const prose = plain(entry.body.join(' '))
    RELATION_VERB.lastIndex = 0
    let m = RELATION_VERB.exec(prose)
    while (m) {
      const after = prose.slice(m.index + m[0].length, m.index + m[0].length + RELATION_WINDOW)
      const clause = after.split(/[.;:]/)[0]
      for (const hit of clause.matchAll(/\bADR-(\d{3})\b/g)) {
        if (hit[1] !== entry.number) {
          out.push({
            from: entry.number,
            to: hit[1],
            quote: `${m[0]}${clause}`.trim().slice(0, 96),
          })
        }
      }
      m = RELATION_VERB.exec(prose)
    }
  }
  return out
}

function relationProblems(entries) {
  const byNumber = new Map(entries.map((e) => [e.number, e]))
  const problems = []
  const seen = new Set()
  for (const claim of claims(entries)) {
    const key = `${claim.from}→${claim.to}`
    if (seen.has(key)) continue
    seen.add(key)
    const target = byNumber.get(claim.to)
    if (!target) continue // a dangling reference — rule 2's business, reported once there
    if (target.statusText?.includes(`ADR-${claim.from}`)) continue
    problems.push({
      id: 'one-sided-relation',
      where: `${LOG}:${target.line}`,
      detail:
        `ADR-${claim.from} says it changes ADR-${claim.to}, but ADR-${claim.to}'s Status never mentions it\n` +
        `      ADR-${claim.from} → "…${claim.quote}…"\n` +
        `      → give ADR-${claim.to} the token **Amended by ADR-${claim.from}** (or **Superseded by ADR-${claim.from}**)`,
    })
  }
  return problems
}

/** This gate's own source. See the header: its selftest must be able to spell a missing number. */
const FIXTURE_HOME = 'scripts/check-adr-index.mjs'

export function referenceProblems(files, entries) {
  const known = new Set(entries.map((e) => e.number))
  const slugs = new Map(entries.map((e) => [e.number, e.slug]))
  const problems = []
  for (const { file, text } of files) {
    if (file === FIXTURE_HOME) continue
    text.split('\n').forEach((line, i) => {
      REFERENCE.lastIndex = 0
      let m = REFERENCE.exec(line)
      while (m) {
        if (!known.has(m[1])) {
          problems.push({
            id: 'dangling-reference',
            where: `${file}:${i + 1}`,
            detail: `${m[0]} names no decision in ${LOG}\n      ${line.trim().slice(0, 120)}`,
          })
        }
        m = REFERENCE.exec(line)
      }
      // The link half of the same mistake: the number resolves, the anchor does not, so the link
      // lands at the top of an 8,000-line file. Eleven of these had accumulated — five bare
      // `#adr-051`-style targets with no slug at all, and six whose ADR had since been retitled.
      for (const link of line.matchAll(/\]\((#adr-(\d{3})[^)]*)\)/g)) {
        const want = slugs.get(link[2])
        if (want && link[1] !== `#${want}`) {
          problems.push({
            id: 'broken-anchor',
            where: `${file}:${i + 1}`,
            detail: `${link[1]} is not ADR-${link[2]}'s heading anchor\n      → #${want}`,
          })
        }
      }
    })
  }
  return problems
}

// ── the tree ───────────────────────────────────────────────────────────────────────────────────

/**
 * Every tracked (or newly added) file, as text. `git ls-files` rather than a directory walk so
 * `.gitignore` is respected for free — a stale `dist/` bundle must not report yesterday's citation.
 * Binaries are skipped by content, so no extension list can go stale.
 */
function trackedFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  const files = []
  for (const name of [...new Set(out.split('\0').filter(Boolean))]) {
    let text
    try {
      text = readFileSync(join(repoRoot, name), 'utf8')
    } catch {
      continue // listed but absent, or unreadable — nothing to check
    }
    if (text.includes('\0')) continue
    files.push({ file: name, text })
  }
  return files
}

export function audit({ source, files }) {
  const entries = parseLog(source)
  const problems = [
    ...statusProblems(entries),
    ...indexProblems(source, entries),
    ...relationProblems(entries),
    ...referenceProblems(files, entries),
  ]
  return { entries, problems }
}

function liveAudit() {
  const files = trackedFiles()
  const log = files.find((f) => f.file === LOG)
  if (!log) {
    console.error(`✗ check-adr-index cannot find ${LOG}. Is the path still right?`)
    process.exit(1)
  }
  return { ...audit({ source: log.text, files }), files, source: log.text }
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────

/** A minimal well-formed log, with its index already generated, that each scenario breaks once. */
function fixture(entries) {
  const body = entries
    .map(({ n, title, status, extra }) =>
      [`## ADR-${n} — ${title}`, status === null ? null : `- **Status:** ${status}`, extra]
        .filter((l) => l !== null && l !== undefined)
        .join('\n'),
    )
    .join('\n\n')
  const source = `# 08 — Decision Log (ADRs)\n\n---\n\n${body}\n`
  return writeIndex(source, parseLog(source))
}

const CLEAN = [
  { n: '001', title: 'A first decision', status: '**Accepted** — decided and shipped.' },
  { n: '002', title: 'A second decision', status: '**Accepted** — decided and shipped.' },
]

const SCENARIOS = [
  {
    name: 'a well-formed log with a freshly generated index',
    why: 'THE CONTROL. Without it, an `audit` that silently found nothing would pass every scenario below.',
    log: () => fixture(CLEAN),
    files: [],
    expect: [],
  },
  {
    name: 'a title edited without regenerating the index',
    log: () => fixture(CLEAN).replace('## ADR-002 — A second decision', '## ADR-002 — Renamed'),
    files: [],
    expect: ['stale-index'],
  },
  {
    name: 'a Status edited without regenerating the index',
    why: 'The third column is generated too, so a fate recorded in the entry cannot stay hidden from the table.',
    log: () =>
      fixture(CLEAN).replace(
        '## ADR-002 — A second decision\n- **Status:** **Accepted**',
        '## ADR-002 — A second decision\n- **Status:** **Superseded by ADR-001**',
      ),
    files: [],
    // Only the index. `Superseded by` is an acknowledgement, not a claim, so ADR-002 saying it about
    // ADR-001 asks nothing of ADR-001 — that direction is deliberately unpoliced (see the header).
    expect: ['stale-index'],
  },
  {
    name: 'no index block at all',
    log: () => `# 08\n\n---\n\n## ADR-001 — A first decision\n- **Status:** **Accepted**\n`,
    files: [],
    expect: ['missing-index'],
  },
  {
    name: 'an ADR with no Status line',
    log: () =>
      fixture([CLEAN[0], { n: '002', title: 'A second decision', status: null }]).replace(
        '| 002 |',
        '| 002 |',
      ),
    files: [],
    // The generated index renders `—` for it, so the block is consistent; only the Status is missing.
    expect: ['missing-status'],
  },
  {
    name: 'a Status outside the vocabulary',
    why: '`Implemented` is the shape 95 of the 122 lines used to have — a real word about the code, not about the decision.',
    log: () =>
      fixture([
        CLEAN[0],
        { n: '002', title: 'A second decision', status: '**Implemented** in three places.' },
      ]),
    files: [],
    expect: ['unknown-status'],
  },
  {
    name: 'a supersede claimed on one side only',
    why: 'THE WP6-7b FAILURE MODE: a reader lands on ADR-001, reads a rule, and never learns it was amended out from under them.',
    log: () =>
      fixture([
        CLEAN[0],
        {
          n: '002',
          title: 'A second decision',
          status: '**Accepted** — decided and shipped.',
          extra: '- **Decision:** Supersedes ADR-001, whose premise is gone.',
        },
      ]),
    files: [],
    expect: ['one-sided-relation'],
  },
  {
    name: 'the same supersede, acknowledged by both sides',
    why: 'THE SECOND CONTROL. A gate that flagged correct pairs would be switched off within a week.',
    log: () =>
      fixture([
        { n: '001', title: 'A first decision', status: '**Superseded by ADR-002** — see below.' },
        {
          n: '002',
          title: 'A second decision',
          status: '**Accepted** — decided and shipped.',
          extra: '- **Decision:** Supersedes ADR-001, whose premise is gone.',
        },
      ]),
    files: [],
    expect: [],
  },
  {
    name: 'an amend claim whose clause is cut by a colon',
    why: 'THE THIRD CONTROL, and a real line: ADR-059 *amends the plan* and mentions ADR-052 after a colon for a different reason. The ADR named is the reason, not the object.',
    log: () =>
      fixture([
        CLEAN[0],
        {
          n: '002',
          title: 'A second decision',
          status: '**Accepted** — decided and shipped.',
          extra:
            '- **Decision:** This amends the plan, which put the whole thing in one package: ADR-001 forbids that.',
        },
      ]),
    files: [],
    expect: [],
  },
  {
    name: 'a citation of an ADR that does not exist',
    why: 'The rule nothing could enforce before: 2,000+ citations live outside the log and any of them can name a number that was never written.',
    log: () => fixture(CLEAN),
    files: [
      { file: 'packages/contract/ui/stop-row.spec.json', text: '{ "why": "ADR-404 says so" }' },
      { file: 'scripts/check-no-derivation.mjs', text: '// the rule ADR-404 wrote' },
    ],
    expect: ['dangling-reference'],
  },
  {
    name: "the same citation inside this gate's own source",
    why: 'The exemption is ONE file, not `scripts/`: the scenario above proves a sibling gate is still policed, and this one proves the fixture home is not.',
    log: () => fixture(CLEAN),
    files: [{ file: 'scripts/check-adr-index.mjs', text: 'text: "ADR-404 says so"' }],
    expect: [],
  },
  {
    name: 'a link to an ADR that exists, at an anchor that does not',
    why: 'The number resolves, so nothing else notices; the link just lands at the top of an 8,000-line file.',
    log: () => fixture(CLEAN),
    files: [{ file: 'docs/11-status.md', text: 'as [ADR-002](#adr-002) already said' }],
    expect: ['broken-anchor'],
  },
  {
    name: 'the placeholder, a range and an anchor slug',
    why: 'THE FOURTH CONTROL. `ADR-NNN` is the documented placeholder (the log header and CLAUDE.md both use it), a range is two citations that each resolve, and a slug is lowercase.',
    log: () => fixture(CLEAN),
    files: [
      {
        file: 'CLAUDE.md',
        text: 'we mark them `Superseded by ADR-NNN`\nADR-001 … ADR-002 are all decisions\nsee [ADR-002](#adr-002--a-second-decision)',
      },
    ],
    expect: [],
  },
  {
    name: 'two ADRs claiming the same number',
    why: 'The index alone would not notice — it renders both rows happily — and the second one is unreachable by anchor.',
    log: () => fixture([CLEAN[0], { ...CLEAN[1], n: '001' }]),
    files: [],
    expect: ['duplicate-number'],
  },
]

function selftest() {
  console.log('check-adr-index --selftest: watching the gate fail on purpose')
  let failed = 0
  for (const scenario of SCENARIOS) {
    const got = [
      ...new Set(
        audit({ source: scenario.log(), files: scenario.files }).problems.map((p) => p.id),
      ),
    ].sort()
    const want = [...scenario.expect].sort()
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed += 1
    console.log(`  ${ok ? '✓' : '✗'} ${scenario.name} → ${got.join(', ') || '(no problems)'}`)
    if (!ok) console.log(`      expected → ${want.join(', ') || '(no problems)'}`)
  }
  // The live tree is the last and best control: it must be clean, so `--selftest` alone catches a
  // decision that landed without a Status, an index nobody regenerated, or a citation that rotted.
  const live = liveAudit()
  const ok = live.problems.length === 0
  if (!ok) failed += 1
  console.log(
    `  ${ok ? '✓' : '✗'} the live tree → ${live.entries.length} decision(s) over ${live.files.length} files, ` +
      `${live.problems.length} problem(s)`,
  )
  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest scenario(s) did not behave as documented.`)
    if (live.problems.length > 0) print(live.problems)
    process.exit(1)
  }
  console.log(`  ✓ all ${SCENARIOS.length} scenarios plus the live tree behaved as documented.`)
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

function print(problems) {
  const order = [
    'duplicate-number',
    'missing-status',
    'unknown-status',
    'one-sided-relation',
    'dangling-reference',
    'broken-anchor',
    'missing-index',
    'stale-index',
  ]
  for (const id of order) {
    const group = problems.filter((p) => p.id === id)
    if (group.length === 0) continue
    console.error(`\n  ${group.length} × ${id}:\n`)
    for (const p of group) console.error(`  · ${p.where}  ${p.detail}`)
  }
}

if (process.argv.includes('--selftest')) {
  selftest()
} else if (process.argv.includes('--write')) {
  const source = readFileSync(join(repoRoot, LOG), 'utf8')
  const next = writeIndex(source, parseLog(source))
  if (next === source) {
    console.log(`✓ the ADR index is already current (${LOG}).`)
  } else {
    writeFileSync(join(repoRoot, LOG), next)
    console.log(`✓ wrote the ADR index into ${LOG}.`)
  }
} else {
  const { entries, problems, files } = liveAudit()
  if (problems.length > 0) {
    console.error('✗ the ADR log does not hold together')
    print(problems)
    console.error(
      '\n  The index is generated: `pnpm check:adr-index:write` rewrites it from the headings and the\n' +
        '  Status lines. A Status line is `- **Status:** **<token>** — <prose>`, where <token> is\n' +
        '  **Accepted**, **Amended by ADR-NNN** or **Superseded by ADR-NNN** (comma-separated if more\n' +
        '  than one). An ADR number is a permanent address — never renumber, merge or delete one.',
    )
    process.exit(1)
  }
  if (entries.length === 0) {
    // A gate that matched no ADRs would pass for ever — the failure this repo hit four times in Wave 3.
    console.error(
      `✗ check-adr-index found NO decisions in ${LOG}. The heading format must have moved.`,
    )
    process.exit(1)
  }
  const relations = claims(entries).length
  console.log(
    `✓ the ADR log holds together — ${entries.length} decisions indexed, statuses in vocabulary, ` +
      `${relations} supersede/amend claim(s) reciprocated, every ADR-NNN citation and #adr- anchor ` +
      `in ${files.length} files resolves (${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
  )
}
