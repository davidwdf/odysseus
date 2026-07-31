#!/usr/bin/env node
// Gate for WP3-4 / ADR-053: **the server owns content, order, grouping, counts and text; the client
// owns layout, colour, motion and interaction.** Nothing that crosses the wire may name or carry a
// styling value.
//
// WHY A MECHANICAL CHECK, WHEN NOBODY IS PROPOSING TO SEND A COLOUR
// Because the pressure to send one arrives disguised as helpfulness, one field at a time, and each
// instance is locally reasonable. The server already knows a remark is a "Scheduled" one and already
// knows which arrival is imminent; the next honest-looking step is `remarkColor: "#f59e0b"`, and it
// would work — on web. It brings down the whole point of the line: iOS renders that hex outside its
// own colour system, so it ignores Dark Mode, ignores Increase Contrast, and is wrong in a way no
// test on this side of the network can see. The gate exists because the *first* such field is the
// expensive one: once one ships, every phone decodes it, and ADR-052 §5 makes removal breaking.
//
// WHAT IS AND IS NOT A VIOLATION — the distinction the whole file turns on
// `apps/mobile/components/RemarkTag.tsx` maps a `RemarkKind` to a Tailwind class. That is **correct**
// and this gate must never flag it: the server said what *kind* of remark it is (content), the client
// decided that kind renders in `text-subtle` (colour). The rule polices the **wire**, not the app —
// so this reads the emitted OpenAPI document and nothing else. A client-side kind→class table is the
// shape we want; the same table living in a served payload is the one we do not.
//
// Accents are the case that proves the line is workable rather than merely restrictive: when the
// server needs to say "emphasise this", it sends a **semantic token** (`accent: AccentToken`), and
// each platform maps that name to its own colour system. Tokens are content; hex is styling.
//
// WHY THE EMITTED DOCUMENT AND NOT THE ZOD SOURCE
// Three reasons, in order of importance. (1) The document is what a native generator actually reads,
// so it is the surface the rule is *about* — a violation that never reached the document could not
// reach a phone. (2) Scanning TypeScript means regexing prose, and every `.describe()` in
// `packages/contract` is prose that legitimately discusses layout; a gate with that false-positive
// rate gets bypassed. (3) The document is structured, so a *field name* can be told apart from a
// *documentation string* — which is the difference between this gate and a grep.
//
// It does mean this gate composes with `check-openapi-current.mjs`: if `openapi.json` were stale, a
// violation could hide in the un-emitted source. That check runs in the same `pnpm test` and fails on
// a stale document, so the pair is sound — but neither is sufficient alone, and that is worth knowing
// before anyone "simplifies" one of them away.
//
// Run `node scripts/check-vm-no-styling.mjs --selftest` to watch it fail on each rule, including a
// clean control so it cannot pass vacuously.

import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every published wire document. **Hand-spelled, and a new one must be added here in the same commit
 * that creates it** — the same rule `check-no-raw-colours.mjs` states for a new renderer directory, and
 * for the same reason: a gate scoped to one of two documents passes while the other is unpoliced, which
 * is a gate looking at nothing. `asyncapi.json` (WP5-1) carries the same schema *declarations* as
 * `openapi.json` — one registry emit, one set of pointers — so most of its surface is checked twice; the
 * two are not byte-identical (that document drops `$id` and folds `$ref` siblings into `allOf`, which is
 * stated in its own `info.description`), but neither transformation can introduce a styling token. The
 * frames are its own, and they are the newest place a `fontWeight` could land.
 */
const DOC_PATHS = ['packages/contract/openapi.json', 'packages/contract/asyncapi.json']

/**
 * The banned shapes, as the plan states them: `/#[0-9a-f]{3,8}|px$|fontSize|fontWeight|margin/`.
 *
 * Split into one rule per shape rather than kept as the single alternation, so a failure names which
 * property of the line was broken and a fixture can exercise each independently. The `hint` is what a
 * reader needs in the moment they hit it — not "don't do this" but "here is the field that does the
 * job you were reaching for".
 */
const RULES = [
  {
    id: 'hex-colour',
    re: /#[0-9a-fA-F]{3,8}\b/,
    hint: 'send a semantic token (`accent: AccentToken`) and let each platform map it to its own colour system — ADR-053',
  },
  {
    id: 'css-length',
    // Case-insensitive, unlike the plan's literal `px$`. The selftest is why: the fixture field was
    // `insetPx`, which is how anyone would actually spell it in this codebase, and the case-sensitive
    // form the plan writes down reported it clean. A gate that only catches the spelling nobody uses
    // is the vacuous pass the plan's own risk table warns about.
    re: /px$/i,
    hint: 'the client owns layout; send the count or the kind, not the size it renders at',
  },
  {
    id: 'font-size',
    re: /fontSize/i,
    hint: 'typography is a platform concern (Dynamic Type, `sp` units) — the wire carries text, not its size',
  },
  {
    id: 'font-weight',
    re: /fontWeight/i,
    hint: 'send emphasis as meaning (a kind, a threshold), and let the client choose the weight',
  },
  {
    id: 'box-metric',
    re: /margin/i,
    hint: 'spacing is layout, and layout is the client half of the line — ADR-053',
  },
]

/**
 * Keys whose values are **prose for a human**, and are therefore exempt.
 *
 * This is the exemption that keeps the gate usable: a field's `description` has to be able to say
 * "the client decides the margin", and a rule that flagged its own documentation would be deleted
 * within a week. It is a narrow list of JSON Schema / OpenAPI documentation keys — not a general
 * "skip strings" escape — so a *value* the wire carries is never exempted by accident.
 */
const PROSE_KEYS = new Set(['description', 'summary', 'title'])

/**
 * Keys whose values are machine plumbing that restates a name we already police directly.
 *
 * `$id` and `$ref` both spell out a schema name; scanning them would report the same violation two or
 * three times and make the count meaningless. The names themselves are checked where they are
 * *declared* — see `NAME_CONTAINERS`.
 */
const OPAQUE_KEYS = new Set(['$id', '$ref', 'jsonSchemaDialect', 'openapi'])

/** Keys whose child *keys* are names that cross the wire: field names and schema names. */
const NAME_CONTAINERS = new Set(['properties', 'schemas', '$defs'])

/** Test one string against every rule; returns the findings it produced. */
function testString(value, pointer, kind, findings) {
  for (const rule of RULES) {
    if (rule.re.test(value)) findings.push({ pointer, kind, value, rule })
  }
}

/**
 * Every violation in a parsed OpenAPI document.
 *
 * Exported as a function over an already-parsed document rather than over a path, because that is what
 * lets `--selftest` feed it synthetic documents. A gate whose logic can only be reached by writing a
 * file to disk is a gate whose failure modes never get exercised.
 */
export function findViolations(doc) {
  const findings = []
  const walk = (node, pointer) => {
    if (typeof node === 'string') {
      testString(node, pointer, 'value', findings)
      return
    }
    if (Array.isArray(node)) {
      // A `for` loop rather than `forEach`: `walk` returns nothing, and an arrow body that forwards a
      // void return trips `useIterableCallbackReturn`.
      for (const [i, item] of node.entries()) walk(item, `${pointer}/${i}`)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      const child = `${pointer}/${key}`
      if (PROSE_KEYS.has(key)) continue
      if (NAME_CONTAINERS.has(key) && value && typeof value === 'object') {
        for (const name of Object.keys(value)) {
          testString(name, `${child}/${name}`, key === 'properties' ? 'field' : 'schema', findings)
        }
      }
      if (OPAQUE_KEYS.has(key)) continue
      walk(value, child)
    }
  }
  walk(doc, '')
  return findings
}

/**
 * Recorded exceptions. **Empty on purpose**, and the goal is that it stays that way — unlike the id
 * gate's list, this one has never had an entry to drain.
 *
 * To add one:
 *
 *   { pointer: '/components/schemas/Foo/properties/barPx', value: 'barPx', why: 'one line: why the
 *     line has to bend here, and what straightens it' }
 *
 * Keyed on the **pointer and the offending string, never a line number** — the same choice
 * `check-no-adhoc-id-parsing.mjs` documents at its own allowlist, and doubly right here: this is a
 * generated file, so every line number in it moves whenever an unrelated field is added. An entry
 * that stops matching fails the check too, so the list can shrink but cannot quietly rot.
 */
const ALLOWLIST = []

/** Compare findings against the allowlist. Returns `{unexpected, stale}`. */
function partition(findings) {
  const allowed = ALLOWLIST.map((entry) => ({ ...entry, hits: 0 }))
  const unexpected = []
  for (const finding of findings) {
    const match = allowed.find((a) => a.pointer === finding.pointer && a.value === finding.value)
    if (match) match.hits += 1
    else unexpected.push(finding)
  }
  return { unexpected, stale: allowed.filter((a) => a.hits === 0) }
}

function report(unexpected, stale) {
  console.error('✗ styling on the wire (WP3-4, ADR-053)\n')
  if (unexpected.length > 0) {
    console.error(
      `  ${unexpected.length} violation(s). The server owns content, order, grouping, counts and\n` +
        '  text; the client owns layout, colour, motion and interaction:\n',
    )
    for (const f of unexpected) {
      console.error(`  · ${f.pointer}  [${f.rule.id}] (${f.kind})`)
      console.error(`      ${JSON.stringify(f.value)}`)
      console.error(`      → ${f.rule.hint}`)
    }
  }
  if (stale.length > 0) {
    console.error(`\n  ${stale.length} allowlist entry(ies) no longer match anything — delete:\n`)
    for (const a of stale) console.error(`  · ${a.pointer}  ${JSON.stringify(a.value)}`)
  }
  console.error(`\n  The line: docs/08-decision-log.md → ADR-053`)
  console.error(
    '  Declared: packages/contract/src/wire/*.ts (re-emit with openapi:emit and asyncapi:emit)',
  )
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────
//
// One fixture per rule, plus the two controls that matter. A gate nobody has watched fail is not
// known to work, and the specific failure this guards against is a walk that silently stops
// descending: every rule would then report zero and the check would pass for ever.

const FIXTURES = [
  {
    name: 'a clean document',
    why: 'THE CONTROL. Without it, a walk that never recursed would pass every other fixture below by returning nothing at all.',
    doc: {
      components: {
        schemas: {
          Eta: {
            type: 'object',
            properties: {
              arrivals: { type: 'array', items: { type: 'string' } },
              remarkKind: { type: 'string', enum: ['scheduled', 'lastBus', 'info'] },
            },
          },
        },
      },
    },
    expect: [],
  },
  {
    name: 'a hex colour in an enum value',
    why: 'The field this gate exists for: the server deciding what colour a tag is.',
    doc: {
      components: {
        schemas: { Tag: { properties: { tone: { enum: ['#f59e0b', '#64748b'] } } } },
      },
    },
    expect: ['hex-colour', 'hex-colour'],
  },
  {
    name: 'a CSS length as a default value',
    doc: {
      components: { schemas: { Row: { properties: { gap: { default: '12px' } } } } },
    },
    expect: ['css-length'],
  },
  {
    name: 'a field name ending in px',
    why: 'The name alone is the violation — a native client has no pixels to put in it.',
    doc: {
      components: { schemas: { Row: { properties: { insetPx: { type: 'number' } } } } },
    },
    expect: ['css-length'],
  },
  {
    name: 'a fontSize field',
    doc: {
      components: { schemas: { Label: { properties: { fontSize: { type: 'number' } } } } },
    },
    expect: ['font-size'],
  },
  {
    name: 'a fontWeight carried as a value',
    doc: {
      components: { schemas: { Label: { properties: { style: { const: 'fontWeight:700' } } } } },
    },
    expect: ['font-weight'],
  },
  {
    name: 'a margin field',
    doc: {
      components: { schemas: { Card: { properties: { marginTop: { type: 'number' } } } } },
    },
    expect: ['box-metric'],
  },
  {
    name: 'a schema whose own name is a styling word',
    why: 'Names are policed where they are declared, not only where they are referenced — otherwise a `$ref` would be the only evidence and it is deliberately not scanned.',
    doc: { components: { schemas: { FontWeight: { type: 'string' } } } },
    expect: ['font-weight'],
  },
  {
    name: 'styling words in prose',
    why: 'THE SECOND CONTROL, and the reason the gate is usable at all: a description must be free to explain that the client owns the margin and must not send #f59e0b. Flagging its own documentation is how a check gets deleted.',
    doc: {
      components: {
        schemas: {
          Eta: {
            description:
              'The client picks the margin, the fontWeight and the colour (never #f59e0b).',
            properties: { remark: { type: 'string', description: 'Renders at 12px on web.' } },
          },
        },
      },
    },
    expect: [],
  },
  {
    name: 'a nested violation behind an array',
    why: 'The walk has to descend through `anyOf`/`oneOf` arrays; a version that only recursed into objects reported clean here.',
    doc: {
      components: {
        schemas: { Thing: { anyOf: [{ properties: { padPx: { type: 'number' } } }] } },
      },
    },
    expect: ['css-length'],
  },
]

function selftest() {
  console.log('check-vm-no-styling --selftest: watching the gate fail on purpose')
  let failed = 0
  for (const fixture of FIXTURES) {
    const found = findViolations(fixture.doc)
      .map((f) => f.rule.id)
      .sort()
    const expected = [...fixture.expect].sort()
    const ok = JSON.stringify(found) === JSON.stringify(expected)
    if (!ok) failed += 1
    const shown = found.length > 0 ? found.join(', ') : '(no problems)'
    console.log(`  ${ok ? '✓' : '✗'} ${fixture.name} → ${shown}`)
    if (!ok) console.log(`      expected → ${expected.join(', ') || '(no problems)'}`)
  }
  // The real documents are the last and best control: every committed contract must be clean, and
  // asserting it here as well means `--selftest` alone would catch a violation that had landed.
  for (const docPath of DOC_PATHS) {
    const live = findViolations(JSON.parse(readFileSync(join(repoRoot, docPath), 'utf8')))
    const liveOk = partition(live).unexpected.length === 0
    if (!liveOk) failed += 1
    console.log(
      `  ${liveOk ? '✓' : '✗'} the committed ${docPath} → ${liveOk ? 'clean' : 'VIOLATIONS'}`,
    )
  }
  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(`  ✓ all ${FIXTURES.length} scenarios plus the live document behaved as documented.`)
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  // Both documents are walked and their findings partitioned **once, together**. Partitioning per
  // document would report an allowlist entry that legitimately matches in one of them as stale in the
  // other, and a gate that fails on its own bookkeeping gets an entry added to silence it.
  const docs = DOC_PATHS.map((p) => ({
    path: p,
    doc: JSON.parse(readFileSync(join(repoRoot, p), 'utf8')),
  }))
  const { unexpected, stale } = partition(docs.flatMap(({ doc }) => findViolations(doc)))
  if (unexpected.length > 0 || stale.length > 0) {
    report(unexpected, stale)
    process.exit(1)
  }
  const counted = docs
    .map(({ path, doc }) => `${Object.keys(doc.components?.schemas ?? {}).length} in ${path}`)
    .join(', ')
  const remaining =
    ALLOWLIST.length === 0 ? 'allowlist is empty' : `${ALLOWLIST.length} allowed exception(s) left`
  console.log(
    `✓ no styling on the wire — ${RULES.length} rules over ${counted}, ` +
      `${remaining} (${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
  )
}
