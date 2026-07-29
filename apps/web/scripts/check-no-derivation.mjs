#!/usr/bin/env node
// The WP4-1 gate: **the second renderer derives nothing.**
//
// WHY A MECHANICAL CHECK
// WP4-1's acceptance is *"lines of new logic outside `.tsx` and adapters: zero"*, and that is not a
// claim a reviewer can keep true. The pressure to break it arrives one plausible line at a time — a
// `.sort()` because the list "looked wrong once", a `.slice(0, 3)` to tidy a long card, a `> 5` to make
// something amber — and every instance is locally reasonable. The cost is not local: each one is a
// second declaration of a rule `packages/core` already owns, the two renderers agree only until
// somebody edits one of them, and **the byte-identity claim keeps passing while becoming false**. That
// is the specific failure Wave 4 exists to detect, so it cannot be left to discipline.
//
// WHAT IS AND IS NOT A VIOLATION — the distinction this file turns on
// Calling a kernel function is *correct* and this gate must never flag it: `nearbyView(...)`,
// `t(locale, 'moreRoutes', { n })`, `bearingOctantDeg(deg)` are the renderer doing its job. What is
// banned is the renderer computing an answer **itself**: ordering, capping, counting, joining strings,
// or comparing a number against a threshold. So the rules below are shapes, not names.
//
// WHY ONLY `apps/web`, and the honest limit that creates
// `apps/mobile` is not policed here, and the reason is not that it deserves less scrutiny: its other
// screens (route detail, search, the workbench) still hold rules WP4-0 did not hoist, so the same rules
// would fire on legitimate un-migrated code and the gate would be switched off within a week. The
// asymmetry is therefore deliberate and bounded — the *new* renderer is the one whose thinness is the
// claim under test, and it starts clean. Extending this to `apps/mobile` is the natural finish once
// Place detail and Route detail have had their WP4-0.
//
// Run `node scripts/check-no-derivation.mjs --selftest` to watch it fail on each rule, including two
// controls so it cannot pass vacuously.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(APP, '..', '..')

/**
 * The policed directories, relative to `apps/web`.
 *
 * `src/adapters/` is **exempt by the acceptance criterion itself** — an adapter's whole job is to
 * reconcile a platform API with a port, which means branching on `navigator.permissions` and mapping
 * error codes. `src/hooks/` is exempt for the same reason: those are ten-line shims over
 * `createLocationController` and `useQuery`. Everything that renders is policed.
 */
const POLICED = ['src/components/', 'src/screens/']

const RULES = [
  {
    id: 'ordering',
    re: /\.(sort|reverse)\s*\(/,
    hint: 'the order is a rule — `nearbyView` sorts, and the wire promises no sequence at all',
  },
  {
    id: 'capping',
    re: /\.slice\s*\(/,
    hint: 'the row cap is served policy (`maxRows`) and `stopCardView` applies it together with the "+N more" count — a caller that slices first makes that count zero, which is a bug this repo has already shipped once',
  },
  {
    id: 'selecting',
    re: /\.(filter|find|reduce)\s*\(/,
    hint: 'which rows a rider sees is a domain rule; hand the whole view over and render it',
  },
  {
    id: 'string-composition',
    re: /\.join\s*\(/,
    hint: 'the caption is composed by `stopCardCaption`, separators and all — two renderers joining their own get a plausible caption with the wrong rhythm and nothing fails',
  },
  {
    id: 'arithmetic',
    re: /Math\.(max|min|round|floor|ceil|abs)\s*\(/,
    hint: 'a number the renderer computes is a number the other renderer computes differently — put it in `packages/core` with a corpus row',
  },
  {
    id: 'threshold',
    // A comparison against a numeric literal. `>= 0`/`> 0`/`.length` guards are excluded below,
    // because "is there anything to draw" is presentation, not a threshold.
    re: /[<>]=?\s*\d/,
    hint: 'a threshold belongs to the served `ClientPolicy` or to a kernel rule (`etaUrgency`) — this is exactly the literal `parts.value <= 5` that disagreed with `warnUnderSec` for months',
  },
]

/** Shapes that match a rule's regex but are not derivations. Each needs a reason, not a name. */
const EXEMPT = [
  {
    re: /\.length\s*[<>]=?\s*0|[<>]=?\s*0\b/,
    why: 'a zero comparison is an emptiness guard ("is there anything to draw"), which is presentation',
  },
  {
    re: /remaining\s*>\s*0/,
    why: 'the same guard, spelled with the kernel-supplied count',
  },
  {
    re: /outline-2|gap-2|py-1\.5|min-h-\[60dvh\]|w-2\/3/,
    why: 'Tailwind class names contain digits after a comparison-like character; they are styling, and the rule is about JS operators',
  },
]

/** Every policed source file, via `git ls-files` so an untracked scratch file cannot hide a violation
 *  and a `.gitignore`d one cannot silently shrink the count (the WP3-3 near-miss). */
function files() {
  const out = execFileSync('git', ['ls-files', ...POLICED], { cwd: APP, encoding: 'utf8' })
  return out.split('\n').filter((f) => /\.tsx?$/.test(f))
}

/** Strip comments and string/template literals: prose about `.sort()` must not be a violation, and
 *  this file's own hints would otherwise trip every rule they describe. */
export function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

export function findViolations(source, file = '') {
  const found = []
  const lines = strip(source).split('\n')
  lines.forEach((line, i) => {
    if (EXEMPT.some((e) => e.re.test(line))) return
    for (const rule of RULES) {
      if (rule.re.test(line)) found.push({ file, line: i + 1, rule, text: line.trim() })
    }
  })
  return found
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: 'a renderer that only calls the kernel',
    why: 'THE CONTROL. Without it, a `strip` that ate the whole file would pass every fixture below by finding nothing.',
    source: `const cards = nearbyView(data, { locale, now, policy })
      return cards.map((c) => <StopCard view={c} locale={locale} />)`,
    expect: [],
  },
  {
    name: 'sorting in the view',
    source: 'const cards = [...data].sort((a, b) => a.distanceM - b.distanceM)',
    expect: ['ordering'],
  },
  {
    name: 'capping in the view',
    source: 'const shown = view.rows.slice(0, 6)',
    expect: ['capping'],
  },
  {
    name: 'selecting rows in the view',
    source: 'const live = view.rows.filter((r) => r.urgency !== "none")',
    expect: ['selecting'],
  },
  {
    name: 'composing a caption in the view',
    source: 'const caption = [dir, dist].join("  ·  ")',
    expect: ['string-composition'],
  },
  {
    name: 'arithmetic in the view',
    source: 'const remaining = Math.max(0, total - shown.length)',
    expect: ['arithmetic'],
  },
  {
    name: 'an imminence threshold in the view',
    why: 'The literal this whole wave was written around: `EtaBadge` carried `parts.value <= 5` while the served warnUnderSec said 180.',
    source: 'const tone = row.label.value <= 5 ? "text-warning" : "text-text"',
    expect: ['threshold'],
  },
  {
    name: 'prose and class names that look like violations',
    why: 'THE SECOND CONTROL, and the reason the gate is usable: a comment must be free to explain that `.sort()` belongs in the kernel, and `outline-2` must not read as a threshold. Flagging its own documentation is how a check gets deleted.',
    source: `// The order is a rule: never .sort() here, and never .slice(0, 6).
      const cls = "gap-2 outline-2 w-2/3"
      return <div className={cls}>{view.remaining > 0 ? "more" : null}</div>`,
    expect: [],
  },
]

function selftest() {
  console.log('check-no-derivation --selftest: watching the gate fail on purpose')
  let failed = 0
  for (const f of FIXTURES) {
    const got = findViolations(f.source)
      .map((v) => v.rule.id)
      .sort()
    const want = [...f.expect].sort()
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) failed += 1
    console.log(`  ${ok ? '✓' : '✗'} ${f.name} → ${got.join(', ') || '(no problems)'}`)
    if (!ok) console.log(`      expected → ${want.join(', ') || '(no problems)'}`)
  }
  // The real tree is the last and best control: the app must be clean, so `--selftest` alone catches a
  // violation that has landed.
  const live = files().flatMap((f) => findViolations(readFileSync(join(APP, f), 'utf8'), f))
  if (live.length > 0) failed += 1
  console.log(
    `  ${live.length === 0 ? '✓' : '✗'} the live apps/web tree → ${live.length} violation(s)`,
  )
  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(`  ✓ all ${FIXTURES.length} scenarios plus the live tree behaved as documented.`)
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const list = files()
  const found = list.flatMap((f) => findViolations(readFileSync(join(APP, f), 'utf8'), f))
  if (found.length > 0) {
    console.error('✗ the second renderer is deriving something (WP4-1, ADR-068)\n')
    for (const v of found) {
      console.error(`  · apps/web/${v.file}:${v.line}  [${v.rule.id}]`)
      console.error(`      ${v.text}`)
      console.error(`      → ${v.rule.hint}`)
    }
    console.error(
      '\n  The rules live in packages/core and are pinned by packages/core/spec/*.spec.json.',
    )
    console.error(
      '  If this really is presentation, add it to EXEMPT in this script with a reason.',
    )
    process.exit(1)
  }
  if (list.length === 0) {
    // A gate that matched no files would pass for ever — the failure this repo hit four times in Wave 3.
    console.error(
      '✗ check-no-derivation matched NO files. POLICED is stale, or git ls-files is empty.',
    )
    process.exit(1)
  }
  console.log(
    `✓ the renderer derives nothing — ${RULES.length} rules over ${list.length} file(s) in ` +
      `${POLICED.length} policed dir(s) (${relative(REPO, fileURLToPath(import.meta.url))}).`,
  )
}
