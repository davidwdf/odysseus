#!/usr/bin/env node
// The WP4-1 gate: **a renderer derives nothing.** Since WP6-3b it polices BOTH of them.
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
// WHAT CHANGED IN WP6-3b, AND WHY IT MOVED
// It used to live in `apps/web/scripts/` and police one renderer, with this note: *"`apps/mobile` is not
// policed here, and the reason is not that it deserves less scrutiny: its other screens still hold rules
// WP4-0 did not hoist… Extending this to `apps/mobile` is the natural finish once Place detail and Route
// detail have had their WP4-0."* Place detail has now had it (ADR-085, ADR-087), so the gate moves to the
// repo root — where `check-view-transport-free` and `check-no-raw-colours` already live — and polices the RN
// screen and the leaf components that draw a place's content. **The asymmetry ADR-069 recorded is closed for
// this screen and stays open for the others**, which is what a per-directory POLICED list is for: route
// detail, search and the workbench are absent from it and say so below.
//
// AND WHY IT NEEDED AN ALLOWLIST TO GET THERE
// The RN screen has genuine *presentational* arithmetic that the shape rules cannot tell from a domain rule:
// `Math.max` over viewport dimensions for the tail padding, a `.filter`/`.find` over a scroll-offset
// registry, `Math.floor` over tile coordinates. Every one is geometry, none is a decision about what a rider
// sees, and the honest way to say so is the same per-site `ALLOWLIST` `check-view-transport-free` uses —
// each entry naming the one rule it exempts and why, so a `fetch(` that happens to share a line is still
// caught. Rushing the gate without it would have meant either a switched-off gate or a screen contorted to
// please it.
//
// Run `node scripts/check-no-derivation.mjs --selftest` to watch it fail on each rule, including three
// controls so it cannot pass vacuously.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The policed paths, relative to the repo root. Directories and single files, because the two renderers
 * are at different stages and the list has to be able to say so.
 *
 * **`apps/web` is policed whole**, minus the seams. `src/adapters/` is exempt by the acceptance criterion
 * itself — an adapter's whole job is to reconcile a platform API with a port, which means branching on
 * `navigator.permissions` and mapping error codes. `src/hooks/`, `src/lib/` and `src/providers/` are exempt
 * for the same reason: those are ten-line shims over `createLocationController`, `useQuery`, `persist` and a
 * React context, and the *rules* they wire (`resolveLocale`, `resolveMode`, `resolveClientPolicy`) live
 * outside this app already. Everything that renders is policed.
 *
 * **`apps/mobile` used to be policed here too, per surface**, and its paths left with the app
 * (ADR-157). Its half of this list recorded which RN screens WP4-0 had hoisted — but the *rule* it
 * encoded outlives the app, so it is restated here rather than deleted along with the paths:
 *
 * **A path absent from this list is the `from` of no rule at all.** A whole renderer surface can be
 * silently unpoliced while the gate reports ✓, which is why each surface joins in the commit that
 * hoists it, and why a second renderer arriving one day must add itself here in the same breath as its
 * first screen. `check-no-raw-colours` states the same rule at length for the same reason.
 */
const POLICED = [
  'apps/web/src/components/',
  'apps/web/src/screens/',
  'apps/web/src/shell/',
  // Added with `useRailFlip` (ADR-110), and the reason is the standing rule above rather than that hook in
  // particular: a screen's logic that moves into a hook must not thereby leave the gate's sight, or
  // "hoist it into a hook" becomes the way past the check. It joined with **no new allowlist entries** —
  // none of the six shape rules fires on any of the seven files already here.
  'apps/web/src/hooks/',
]

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

/**
 * Every policed source file, via `git ls-files` so an untracked scratch file cannot hide a violation and a
 * `.gitignore`d one cannot silently shrink the count (the WP3-3 near-miss).
 *
 * `missing` is per **path**, because the whole-set guard in `main` only fires when *every* path has gone:
 * `git ls-files` warns on a path that no longer exists and still exits 0, so one renamed directory would
 * leave the check quietly narrower while the success line went on printing the same number of policed dirs.
 * That is the sixth instance of this repo's recurring failure and `check-view-transport-free` carries the
 * same two-level guard for the same reason.
 */
function files() {
  // `--others --exclude-standard` includes files that exist but are not committed yet, so a **brand-new
  // component cannot carry a derivation past the check until the moment it is staged** — which is exactly when
  // nobody looks again. Measured while writing this: without it, `apps/web/src/components/MiniMap.tsx` and
  // `screens/PlaceDetail.tsx` were invisible to the gate on the very run that was meant to police them, and
  // the only symptom was two allowlist entries reported as *stale*. `check-view-transport-free` has taken this
  // form since WP5-2 and this one had not.
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...POLICED],
    {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  const list = [...new Set(out.split('\0').filter(Boolean))].filter((f) => /\.tsx?$/.test(f))
  const missing = POLICED.filter((path) => !list.some((f) => f === path || f.startsWith(path)))
  return { list, missing }
}

/**
 * Strip comments and string/template literals: prose about `.sort()` must not be a violation, and this
 * file's own hints would otherwise trip every rule they describe.
 *
 * **A template literal keeps its `${…}` expressions**, and that is not a refinement — it was a hole. The
 * first version replaced the whole literal with an empty one, so every rule went blind inside an
 * interpolation: `` `${rows.filter(r => r.eta < 5).length} buses` `` was a `selecting` *and* a `threshold`
 * finding that this gate reported as clean. Found by writing one, in
 * `apps/web/src/components/RouteStopRow.tsx`, and noticing the count of allowed sites had not moved.
 *
 * It is the recurring failure this repo keeps meeting from a new direction — a check that quietly stops
 * seeing things and goes on printing a success line. `files()` carries the two-level guard for the same
 * reason, and this is the third gate-blindness bug in the same family (WP3-3, WP6-3b).
 *
 * The `[^{}]` in the interpolation pattern means a nested brace — `` `${ {a:1}.a }` `` — is not recovered.
 * That is a known and narrow gap, written down rather than papered over: it costs a false *negative* on a
 * shape no renderer here writes, where the alternative is a brace-matching parser in a 600-line gate.
 */
export function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, (literal) => {
      const code = [...literal.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]).join('; ')
      return code === '' ? '``' : `\`\${${code}}\``
    })
}

/**
 * Sites where a shape rule fires on something that is **not** a derivation. Each entry names the one rule it
 * exempts and why, so a `.filter()` over a domain list that happens to share a file is still caught.
 *
 * The same mechanism, with the same fields and the same `--selftest` cases, as
 * `scripts/check-view-transport-free.mjs`'s. It exists because WP6-3b extended this gate to the RN Place
 * screen, which has real presentational arithmetic: *"rushing a gate is worth less than not having it"*, and
 * the alternative was either no gate over the reference renderer or a screen contorted to please one.
 *
 * The distinction every entry has to earn: **geometry is presentation, a list is a decision.** `Math.floor`
 * over a tile coordinate, a scroll offset, a viewport dimension — none of those is an answer about what a
 * rider sees. A `.filter()` over rows, a `.slice()` over routes, a comparison against a minutes value: those
 * are the kernel's, always.
 */
const ALLOWLIST = [
  {
    file: 'apps/web/src/components/sheet/detents.ts',
    why:
      'A whole file of **gesture geometry with no NextBus vocabulary in it** — the arithmetic half of a ' +
      'draggable sheet, deliberately separated from the component so the component holds none of it. ' +
      'Every value is a fraction of a container or a speed in fractions per second; nothing here reads ' +
      'a stop, a route, an arrival or a fare, and the `.sort()` orders DETENTS by height rather than ' +
      'rows by a domain rule. It is the sort of thing that would move to a shared component library ' +
      'unchanged, which is the test for whether it belongs to this app at all — and it does not. ' +
      'Whole-file rather than per-rule because the file has exactly one subject: if anything in it ' +
      'ever reads a domain quantity, the entry is wrong and should be deleted rather than narrowed.',
  },
  {
    file: 'apps/web/src/components/routeChevronImage.ts',
    rule: 'arithmetic',
    why:
      'A canvas drawing, and every number in it is a coordinate on that canvas: the bitmap size at the ' +
      'device pixel ratio, and the two stroke paths. There is no domain quantity anywhere in the file — ' +
      "the only thing it is told is a colour, and the direction the mark points is the ENGINE's, from " +
      '`symbol-placement: line` over a line the edge already oriented in travel order (ADR-152). It is a ' +
      'sprite that happens to be drawn at runtime rather than shipped as a file, and a sprite is not a ' +
      'rule. Scoped to `arithmetic`: a `.filter()` or a comparison against a minutes value would still be ' +
      'a finding here, and either would mean this had stopped being a drawing.',
  },
  {
    file: 'apps/web/src/components/MiniMap.tsx',
    rule: 'arithmetic',
    why:
      'The DOM twin of the RN map’s exemption, and the same argument line for line: which tiles cover the ' +
      'viewport, where each dot lands, how thick its ring is. Every *rule* it could have held is already in ' +
      '`packages/core` — `fitZoom`, `clampZoom`, `lngToWorldX`, `latToWorldY`, `mergeCoincidentPins` — which ' +
      'is what made writing this component a rendering exercise rather than a second derivation.',
  },
  {
    file: 'apps/web/src/components/RouteStopRow.tsx',
    rule: 'arithmetic',
    snippet: 'animationDelay',
    why:
      'The direction-flip cascade’s per-row beat, capped so a 60-stop route does not take two seconds to ' +
      'rebuild — `Math.min(index, 10) * 26`, the same expression `apps/mobile/app/route/[id].tsx` is exempted ' +
      'for on the line above. A **delay in milliseconds**, read from a row’s position in a list the kernel ' +
      'ordered; it decides nothing about what that row says. One of the two sites the template-literal hole ' +
      'in `strip` was hiding, and it is here rather than in CSS deliberately: `calc(min(var(--i), 10) * 26ms)` ' +
      'would have passed the gate without ever being looked at, which is the wrong reason to move code.',
  },
  {
    file: 'apps/web/src/components/BottomSheet.tsx',
    rule: 'arithmetic',
    snippet: 'style.opacity',
    why:
      'How far the scrim has faded while a thumb drags the sheet down: the drag distance as a fraction of ' +
      'the panel’s own measured height, clamped at zero. A **gesture position**, and there is no other kind ' +
      'of number in this file — what the sheet *offers* is `RouteStopSheet`’s two actions and ' +
      '`routeFactSheet`’s content, neither of which this container reads. The other site the hole was ' +
      'hiding, and it had been invisible since the day the component was written.',
  },
  {
    file: 'apps/web/src/components/RouteKeypad.tsx',
    rule: 'capping',
    snippet: 'keypad.digits.slice(0, 5)',
    why:
      'Splitting the ten digits the view hands over into two rows of five — **layout, and the only decision ' +
      'left in this file**. Which characters exist and in what order is `SearchKeypad`’s, precisely so a ' +
      'renderer cannot adopt a phone’s 1-2-3 grid where the other uses a keyboard’s 1-5 / 6-0; how many fit ' +
      'on a line is the renderer’s. Nothing is dropped: `5 + 5` is every key, which the corpus asserts as ' +
      '`digits.length === 10` on every case.',
  },
  {
    file: 'apps/web/src/components/RouteKeypad.tsx',
    rule: 'capping',
    snippet: 'value.slice(0, -1)',
    why:
      'Backspace. It removes the last character a rider typed from the string they typed it into — a text ' +
      'edit, not a cap over a list. The rule exists for `rows.slice(0, maxRows)`, where slicing first makes ' +
      'the "+N more" count zero; there is no count here and no list. What the keypad could have derived — ' +
      'which keys are live and which letters continue a prefix — is `nextValidChars` and `validNextLetters` ' +
      'in `packages/core`, both corpus-pinned, and both are called rather than reimplemented.',
  },
  {
    file: 'apps/web/src/components/MiniMap.tsx',
    rule: 'string-composition',
    snippet: 'pin.ids.join(',
    why: 'A React key for a folded pin, as in the RN twin. Not a caption; it never reaches a screen.',
  },
]

/** Does this allowlist entry cover this finding? A named function so `--selftest` can exercise it. */
export function allows(entry, finding) {
  return (
    entry.file === finding.file &&
    // The rule, not just the line. An entry with no `rule` exempts every rule, which is the honest reading of
    // a whole-file exception; an entry that names a line must name a rule too. This is the clause an
    // adversarial review found missing from the *other* gate's allowlist, where it silently exempted a
    // `fetch(` that shared a line with a URL template.
    (entry.rule === undefined || entry.rule === finding.rule.id) &&
    (entry.snippet === undefined || finding.text.includes(entry.snippet))
  )
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
    name: 'a derivation hidden inside a template literal',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a fixture for the interpolation hole has to contain a literal one
    why: 'THE THIRD CONTROL, and it was a live hole rather than a hypothetical: `strip` replaced every template literal with an empty one, so the gate went blind inside `${…}` and reported a `.filter()` and a threshold as clean. Two rules on one line, because an interpolation is the shape that hides a whole expression.',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: as above — this string IS the source under test
    source: 'const label = `${rows.filter((r) => r.eta < 5).length} buses`',
    expect: ['selecting', 'threshold'],
  },
  {
    name: 'a template literal with nothing but text in it',
    why: 'The other half: keeping interpolations must not make ordinary prose visible again. `.sort()` inside a template string is still a sentence.',
    source: 'const hint = `never .sort() in a view`',
    expect: [],
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
  // The allowlist matcher, which no fixture above reaches: `findViolations` is called with no file, so every
  // one of them takes the "unallowed" branch. The middle row is the regression these exist for — it is the
  // defect an adversarial review found in `check-view-transport-free`'s allowlist, ported here before it
  // could be repeated.
  const entry = {
    file: 'apps/mobile/app/stop/[id].tsx',
    rule: 'arithmetic',
    snippet: 'paddingBottom',
  }
  const finding = (id, file, text) => ({ file, text, rule: { id } })
  const ALLOW_CASES = [
    {
      name: 'the rule it was granted for, on a line it names → allowed',
      got: allows(entry, finding('arithmetic', entry.file, 'paddingBottom: Math.max(24, windowH)')),
      want: true,
    },
    {
      name: 'a DIFFERENT rule on that same line → NOT allowed',
      got: allows(entry, finding('capping', entry.file, 'paddingBottom: rows.slice(0, 6).length')),
      want: false,
    },
    {
      name: 'the right rule in the wrong file → NOT allowed',
      got: allows(entry, finding('arithmetic', 'apps/web/src/screens/Nearby.tsx', 'paddingBottom')),
      want: false,
    },
    {
      name: 'a whole-file entry covers every rule, deliberately',
      got: allows(
        { file: 'apps/mobile/components/MiniMap.tsx' },
        finding('capping', 'apps/mobile/components/MiniMap.tsx', 'x.slice(0)'),
      ),
      want: true,
    },
  ]
  for (const c of ALLOW_CASES) {
    const ok = c.got === c.want
    if (!ok) failed += 1
    console.log(`  ${ok ? '✓' : '✗'} allowlist: ${c.name}`)
    if (!ok) console.log(`      expected ${c.want}, got ${c.got}`)
  }

  // The real tree is the last and best control: every finding in it must be one the allowlist covers, so
  // `--selftest` alone catches a violation that has landed — and a **stale** entry, which is the direction
  // people forget: an exemption that no longer matches anything is a claim nobody is checking.
  const live = report()
  if (live.unexpected.length > 0 || live.stale.length > 0 || live.missing.length > 0) failed += 1
  console.log(
    `  ${live.unexpected.length === 0 && live.stale.length === 0 ? '✓' : '✗'} the live tree → ` +
      `${live.files.length} file(s), ${live.findings.length} finding(s), ` +
      `${live.unexpected.length} unallowed, ${live.stale.length} stale entry(ies)`,
  )
  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(
    `  ✓ all ${FIXTURES.length} fixtures, ${ALLOW_CASES.length} allowlist cases and the live tree ` +
      'behaved as documented.',
  )
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

function report() {
  const { list, missing } = files()
  const findings = []
  for (const file of list) {
    let source
    try {
      source = readFileSync(join(REPO, file), 'utf8')
    } catch {
      continue // listed but absent (deleted and not yet staged) — nothing to check
    }
    findings.push(...findViolations(source, file))
  }
  const allowed = ALLOWLIST.map((entry) => ({ ...entry, hits: 0 }))
  const unexpected = []
  for (const finding of findings) {
    const match = allowed.find((entry) => allows(entry, finding))
    if (match) match.hits += 1
    else unexpected.push(finding)
  }
  return { files: list, missing, findings, unexpected, stale: allowed.filter((e) => e.hits === 0) }
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const { files: list, missing, findings, unexpected, stale } = report()
  if (unexpected.length > 0 || stale.length > 0) {
    console.error('✗ a renderer is deriving something (WP4-1, ADR-068; WP6-3b for apps/mobile)\n')
    for (const v of unexpected) {
      console.error(`  · ${v.file}:${v.line}  [${v.rule.id}]`)
      console.error(`      ${v.text}`)
      console.error(`      → ${v.rule.hint}`)
    }
    if (stale.length > 0) {
      console.error(`\n  ${stale.length} allowlist entry(ies) no longer match anything — delete:\n`)
      for (const e of stale) console.error(`  · ${e.file}${e.snippet ? `  "${e.snippet}"` : ''}`)
    }
    console.error(
      '\n  The rules live in packages/core and are pinned by packages/core/spec/*.spec.json.',
    )
    console.error(
      '  If it is genuinely presentation — geometry, a scroll offset, a viewport dimension — add it to\n' +
        '  ALLOWLIST in this script with the one rule it exempts and the reason. A `.filter()` over rows or\n' +
        '  a comparison against a domain number is not that.',
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
  if (missing.length > 0) {
    // Per-path, because the whole-set guard above only fires when *every* path has gone. `git ls-files` warns
    // on a path that no longer exists and exits 0, so one renamed directory would leave the check quietly
    // narrower while the success line printed the same count.
    console.error('✗ check-no-derivation is no longer looking at a path it claims to police\n')
    for (const path of missing) console.error(`  · ${path}  — renamed, moved or deleted?`)
    console.error(
      '\n  Update POLICED in this script in the same commit that moved it. A gate that silently stops\n' +
        '  reading a renderer is worse than no gate: it reports success.',
    )
    process.exit(1)
  }
  console.log(
    `✓ no renderer derives anything — ${RULES.length} rules over ${list.length} file(s) in ` +
      `${POLICED.length - missing.length} policed path(s), ${findings.length - unexpected.length} ` +
      `allowed site(s) (${relative(REPO, fileURLToPath(import.meta.url))}).`,
  )
}
