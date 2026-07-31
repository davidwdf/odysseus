#!/usr/bin/env node
// Gate for WP5-2 (ADR-004, golden rule 2): **a view holds no transport.** No socket, no `fetch`, no
// endpoint URL. Everything a screen knows about the network it learns through the `DataSource` seam.
//
// WHY A MECHANICAL CHECK, WHEN THE RULE IS GOLDEN RULE 2
// Because the rule has never actually been enforced, and the repo has said so in writing. Wave 1 recorded
// the hole exactly: *"a raw upstream URL literal in a screen is invisible to both tools — golden rule 2 is
// only enforced as `view ✗→ adapters`"*. `pnpm boundaries` checks the *import graph*: a screen may not
// import `@nextbus/data-normalize`. It cannot see `fetch('https://data.etabus.gov.hk/…')`, because that
// imports nothing at all. Nobody owned that gap for four waves.
//
// And WP5-2 is the wave that makes it load-bearing. Its acceptance was *"substitute a `FakeSocketDataSource`
// and `git diff --stat` shows zero lines changed under `apps/mobile/app/**`"* — which is zero by
// construction, since nobody edits a screen while running a test. The property the diff was standing in for
// is that a screen *cannot* reach a transport, and the only way to state that is to look at the source.
// `apps/mobile/test/seam-substitution.test.tsx` proves the two engines render the same thing; this proves
// there is no third path around them.
//
// WHAT IS AND IS NOT A VIOLATION — the distinction this file turns on
// Calling the seam is correct and must never be flagged: `dataSource.getStop(id)`, `useQuery({ queryFn })`,
// `source.watch(targets, onUpdate)`, `query.refetch()` are screens doing their job. What is banned is a
// screen holding the *mechanism*: constructing a socket, calling `fetch`, or knowing an endpoint path. The
// third is the subtle one and the reason a URL pattern exists at all — a path literal is how a screen starts
// talking to the edge without importing anything, so no import-graph rule can ever see it.
//
// `apps/mobile/lib/` IS policed, and that is a deliberate widening of "view". It is this app's adapter
// directory — the twin of `apps/web/src/adapters/` — and adapters are where a *platform* API legitimately
// lives (geolocation, storage, a tile template), not where HTTP does. Policing it is what makes the two
// renderers symmetrical; the one legitimate exception it produces is in ALLOWLIST below, with its reason.
//
// WHAT IT DELIBERATELY DOES NOT CHECK
// Build scripts and config (`apps/mobile/scripts/`, `workbox.config.mjs`, `apps/web/vite.config.ts`): a
// service-worker manifest genuinely is a list of URL patterns, and policing generators only teaches people
// to allowlist. Nor does it check `packages/api-client`, which is *supposed* to hold the transport.
//
// Run `node scripts/check-view-transport-free.mjs --selftest` to watch it fail on each rule, including two
// controls so it cannot pass vacuously.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The directories where a transport must not appear.
 *
 * Hand-spelled rather than derived from `layers.json`'s `view` layer, for the reason
 * `check-no-raw-colours.mjs` argues at length: the layer's dirs are whole apps, while these are the
 * *source* subdirectories — an app also holds config and build scripts, which this rule should not read. The
 * cost is that a new renderer is unpoliced until someone remembers this file, so **add a renderer's source
 * dirs here in the same commit that creates them**, and the count printed on every successful run is the
 * cheap check that it happened.
 */
const POLICED = [
  'apps/mobile/app/',
  'apps/mobile/components/',
  'apps/mobile/lib/',
  'apps/mobile/providers/',
  'apps/web/src/',
]

const PATTERNS = [
  {
    id: 'socket-construct',
    re: /\bnew\s+WebSocket\s*\(/,
    hint: 'the socket lives in `createSocketTransport` (@nextbus/api-client); a screen subscribes through `DataSource.watch()` and never learns which engine answered',
  },
  {
    id: 'socket-call',
    // `new WebSocket(` is the rule above; this is the factory/cast spelling, which is how a socket
    // usually arrives in a file that already knows it should not construct one.
    re: /(?<!new\s)\bWebSocket\s*\(/,
    hint: 'same — inject a `LiveSocketFactory` into `createSocketTransport` instead, so the reconnect policy is not written a second time',
  },
  {
    id: 'socket-url',
    re: /\bwss?:\/\//,
    hint: 'the socket URL is derived once from the API base by `resolveEndpoints` (`liveSocketUrl`, corpus-pinned) — a hand-written `ws://` is the `https:`→`wss:` mistake waiting to happen',
  },
  {
    id: 'raw-fetch',
    re: /\bfetch\s*\(/,
    hint: 'all data goes through the `DataSource` seam (golden rule 2, ADR-004) — `dataSource.getStop`/`getNearby`/`watch`; the HTTP is `EdgeClient`’s',
  },
  {
    id: 'api-path',
    re: /\/v1\//,
    hint: 'an endpoint path in a view is a second declaration of the API surface: the paths live in `EdgeClient`, and the base URL in `DEFAULT_API_URL`/`resolveEndpoints`',
  },
]

/**
 * Recorded exceptions. An entry without a `snippet` exempts the whole file; with one, only lines containing
 * it (whitespace-collapsed, so re-indenting does not invalidate the entry). **A stale entry fails the check
 * as loudly as a violation**, so the list can shrink but never quietly rot into a lie about what is
 * protected.
 *
 * `pattern` names the **one rule** an entry exempts, and it is required for the reason an adversarial review
 * measured: without it the match compared file and snippet only, so an entry exempted the *line* rather than
 * the finding. A `fetch(` — or even a `new WebSocket(` — sharing a line with `/v1/tiles/` in the file below
 * was silently allowed by an exception whose entire argument is about a URL template. Both patterns fire on
 * one-line arrows returning a template literal there, which is the ordinary shape in that file rather than a
 * contrived one, and the next natural edit to it (a tile prefetch, for ADR-058's offline work) would have
 * walked straight through.
 *
 * This list was *discovered by running the check*, not predicted. It found exactly one site.
 */
const ALLOWLIST = [
  {
    file: 'apps/mobile/lib/tileSource.ts',
    pattern: 'api-path',
    snippet: '/v1/tiles/',
    why:
      'The `TileSource` port is a URL template by definition — its whole contract is `basemap(z, x, y) => string`, ' +
      'and the view (`MiniMap`) consumes the port, never the path. These two lines compose a path on **our own ' +
      'Worker** (`apps/edge/src/tiles.ts` proxies LandsD, ADR-049) from the same `DEFAULT_API_URL` the DataSource ' +
      'uses, which is the opposite of the failure this gate is for: there is no upstream host here and no second ' +
      'base URL. Removing the exception would mean either a `TileSource` implementation that cannot name its ' +
      'tiles, or moving the LandsD template into `packages/api-client`, where a `require()`d logo asset and an ' +
      'Expo env read cannot follow it (see the note in `packages/ports/src/tile-source.ts`).',
  },
]

/** Whitespace-insensitive form of a source line, for stable snippet matching. */
const normalize = (line) => line.trim().replace(/\s+/g, ' ')

/**
 * Does this allowlist entry cover this finding?
 *
 * A named function rather than an inline predicate so `--selftest` can exercise it, which is the gap an
 * adversarial review found: every scenario below calls `findViolations` with no file, so the allowlist
 * match had **never been executed by the selftest at all** — and the live-tree control passes happily when
 * an entry over-matches, since over-matching produces no `unexpected` and no `stale`. Sixteen green
 * fixtures and a green live document, over a matcher nothing had run.
 *
 * `entry.snippet` is expected pre-normalized (see `report`).
 */
function allows(entry, finding) {
  return (
    entry.file === finding.file &&
    // The rule, not just the line. An entry with no `pattern` exempts every rule, which is the honest
    // reading of a whole-file exception; an entry that names a line must name a rule too.
    (entry.pattern === undefined || entry.pattern === finding.pattern.id) &&
    (entry.snippet === undefined || finding.code.includes(entry.snippet))
  )
}

/**
 * Strip comments, so prose about a transport stays legal.
 *
 * Every gate in this repo carries this exemption and the same argument for it: a check that flagged its own
 * documentation would be deleted within a week — and this one would flag a *lot*, because the interesting
 * comments in `apps/mobile/lib/` are precisely the ones explaining which endpoint a seam reaches and why.
 * String literals are **not** blanked, unlike `apps/web/scripts/check-no-derivation.mjs`: a path literal
 * inside a string is the violation, so blanking strings would make the `api-path` rule find nothing.
 * Deliberately lexical rather than a real parse — the alternative is a JS parser in a 120-line check.
 *
 * It does, however, **skip over quoted spans**, and that was added after the fact:
 * `scripts/check-one-endpoint-declaration.mjs` was written with this function verbatim and went blind on
 * `packages/contract/src/asyncapi.ts`, where the prose `'/components/schemas/*'` *inside a string* opened
 * a block comment that never closed — every line after it read as comment. Measured here before copying
 * the fix across: none of the 74 files this gate polices currently contains that shape, so it was a
 * latent blind spot rather than a live one, and the two gates now share the sharper lexer instead of
 * differing by an accident of which files they happen to read.
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
      const quote = rest.search(/['"`]/)
      // A quote opening before either marker: copy the literal through unexamined, so its contents can
      // neither start a comment nor hide one. Unterminated on this line ⇒ the remainder is code, which
      // errs towards a false positive somebody reads rather than a silent false negative.
      if (quote !== -1 && (block === -1 || quote < block) && (slash === -1 || quote < slash)) {
        const closer = rest.indexOf(rest[quote], quote + 1)
        if (closer === -1) {
          line += rest
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
      if (hit) {
        found.push({ file, line: i + 1, code: normalize(line), value: hit[0], pattern })
      }
    }
  })
  return found
}

/**
 * Every policed source file in the working tree. `git ls-files` rather than a directory walk: it respects
 * `.gitignore` for free. `--others --exclude-standard` includes files that exist but are not committed yet,
 * so a brand-new screen cannot carry a `fetch` past the check until the moment it is staged — which is
 * exactly when nobody looks again.
 */
function policedFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...POLICED],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const files = [...new Set(out.split('\0').filter(Boolean))]
    .map((f) => f.split(sep).join('/'))
    .filter((f) => /\.(m?[jt]sx?)$/.test(f))
  // **Which of the five dirs actually contributed.** One `git ls-files` over all of them warns on stderr for
  // a path that no longer exists and still exits 0, so a renamed directory dropped out of the check in
  // silence: measured, moving `apps/web/src/` took the file count 74 → 60 with `unexpected` and `stale` both
  // empty, and the success line went on printing "5 policed dirs" — `POLICED.length` is dirs *listed*, not
  // dirs policed. That is the sixth instance of this repo's recurring failure, *a gate that passes because it
  // is looking at nothing*, and the comment on POLICED claimed the printed count was the guard against
  // exactly it. The whole source of the second renderer is 14 of those files.
  const missing = POLICED.filter((dir) => !files.some((f) => f.startsWith(dir)))
  return { files, missing }
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'a screen that only calls the seam',
    why: 'THE CONTROL. Without it, a `codeLines` that ate the whole file would pass every scenario below by finding nothing.',
    source: `const query = useQuery({ queryKey: ['stop', id], queryFn: () => dataSource.getStop(id) })
      useLiveEtas(id, { enabled: query.isSuccess })
      const onPull = () => void query.refetch()`,
    expect: [],
  },
  {
    name: 'a screen constructing a socket',
    source: "const socket = new WebSocket('wss://api.nextbus.hk/v1/live')",
    // All three rules fire on that one line, and that is right: it is three separate mistakes.
    expect: ['api-path', 'socket-construct', 'socket-url'],
  },
  {
    name: 'a socket arriving as a factory call',
    source: 'const socket = globalThis.WebSocket(url)',
    expect: ['socket-call'],
  },
  {
    name: 'a hand-written socket URL',
    // A template literal is exactly how a URL gets built in a screen, so the fixture contains one.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this string *is* source under test
    source: 'const live = `ws://${host}/live`',
    expect: ['socket-url'],
  },
  {
    name: 'a screen calling fetch',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source under test, as above
    source: 'const res = await fetch(`${API_URL}/stop/${id}`)',
    expect: ['raw-fetch'],
  },
  {
    name: 'an endpoint path in a view',
    why: 'The gap Wave 1 recorded: this line imports nothing, so `pnpm boundaries` sees a clean file.',
    // This is the shape the one real allowlist entry has, so the fixture must match it.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source under test, as above
    source: 'const url = `${API_URL}/v1/etas/${id}`',
    expect: ['api-path'],
  },
  {
    name: 'prose and near-misses that must not be violations',
    why: 'THE SECOND CONTROL, and the reason the gate is usable: a comment must be free to explain that the socket lives in api-client, `refetch()` is the seam being used correctly, and a `v1` that is not a path is not a path.',
    source: `// The socket (new WebSocket) lives in createSocketTransport; this screen hits /v1/stop via the seam.
      /* A block comment about wss://api.example.test/v1/live and fetch( too. */
      void query.refetch()
      const bucket = 'nextbus.query.v1'
      const label = 'v1/live'`,
    expect: [],
  },
]

function selftest() {
  console.log('check-view-transport-free --selftest: watching the gate fail on purpose')
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
  // The allowlist matcher, which no scenario above reaches: `findViolations` is called with no file, so
  // every one of them takes the "unallowed" branch. The middle row is the regression these exist for.
  const entry = {
    file: 'apps/mobile/lib/tileSource.ts',
    pattern: 'api-path',
    snippet: '/v1/tiles/',
  }
  const finding = (id, file, code) => ({ file, code, pattern: { id } })
  const ALLOW_CASES = [
    {
      name: 'the rule it was granted for, on a line it names → allowed',
      got: allows(
        entry,
        finding('api-path', entry.file, 'return `${API_URL}/v1/tiles/basemap/...`'),
      ),
      want: true,
    },
    {
      name: 'a DIFFERENT rule on that same line → NOT allowed',
      why: 'The measured defect: the entry argues only about a URL template, and without the `pattern` clause it silently exempted a `fetch(` — or a `new WebSocket(` — that happened to share the line. Both rules fire on one-line arrows returning a template literal, which is the ordinary shape in that file.',
      got: allows(
        entry,
        finding('raw-fetch', entry.file, 'const warm = (z) => fetch(`${API_URL}/v1/tiles/${z}`)'),
      ),
      want: false,
    },
    {
      name: 'the right rule in the wrong file → NOT allowed',
      got: allows(
        entry,
        finding('api-path', 'apps/mobile/app/stop/[id].tsx', "get('/v1/tiles/x')"),
      ),
      want: false,
    },
    {
      name: 'a whole-file entry covers every rule, deliberately',
      got: allows(
        { file: 'apps/web/src/sw.ts' },
        finding('raw-fetch', 'apps/web/src/sw.ts', 'fetch(req)'),
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

  // The live tree is the last and best control: every finding in it must be one the allowlist covers, so
  // `--selftest` alone catches a violation that has landed.
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
  console.log(
    `  ✓ all ${SCENARIOS.length} pattern scenarios, ${ALLOW_CASES.length} allowlist cases and the live ` +
      'tree behaved as documented.',
  )
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

function report() {
  const { files, missing } = policedFiles()
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
    const match = allowed.find((a) => allows(a, finding))
    if (match) match.hits += 1
    else unexpected.push(finding)
  }
  return { files, missing, findings, unexpected, stale: allowed.filter((a) => a.hits === 0) }
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const { files, missing, unexpected, stale } = report()
  if (unexpected.length > 0 || stale.length > 0) {
    console.error('✗ a transport in the view layer (WP5-2, ADR-004, golden rule 2)\n')
    if (unexpected.length > 0) {
      console.error(
        `  ${unexpected.length} site(s) reaching the network without the seam. All data goes through\n` +
          '  `DataSource` (@nextbus/core → @nextbus/api-client):\n',
      )
      for (const f of unexpected) {
        console.error(`  · ${f.file}:${f.line}  [${f.pattern.id}] ${f.value}`)
        console.error(`      ${f.code}`)
        console.error(`      → ${f.pattern.hint}`)
      }
      console.error(
        '\n  If this really is a platform concern rather than a transport — a service-worker\n' +
          '  registration, a tile template on our own Worker — add it to ALLOWLIST in this script with\n' +
          '  the reason. If it is a request, it belongs behind the seam.',
      )
    }
    if (stale.length > 0) {
      console.error(`\n  ${stale.length} allowlist entry(ies) no longer match anything — delete:\n`)
      for (const a of stale) console.error(`  · ${a.file}${a.snippet ? `  "${a.snippet}"` : ''}`)
    }
    console.error(
      '\n  Seam:     packages/core/src/datasource.ts  ·  packages/api-client/src/index.ts',
    )
    console.error('  Proof:    apps/mobile/test/seam-substitution.test.tsx')
    process.exit(1)
  }
  if (files.length === 0) {
    // A gate that matched no files would pass for ever — the failure this repo hit four times in Wave 3.
    console.error(
      '✗ check-view-transport-free matched NO files. POLICED is stale, or git ls-files is empty.',
    )
    process.exit(1)
  }
  if (missing.length > 0) {
    // Per-directory, because the whole-set guard above only fires when *every* dir has gone. `git ls-files`
    // warns on a path that no longer exists and exits 0, so one renamed directory left the check quietly
    // narrower: measured, moving `apps/web/src/` took the count 74 → 60 with nothing reported, and the
    // success line still said "5 policed dirs". The second renderer's entire source is those 14 files, and
    // its whole purpose is proving the kernel renderer-agnostic (ADR-068/069).
    console.error(
      '✗ check-view-transport-free is no longer looking at a directory it claims to police\n',
    )
    for (const dir of missing)
      console.error(`  · ${dir}  — no tracked files; renamed, moved or deleted?`)
    console.error(
      '\n  Update POLICED in this script in the same commit that moved the directory. A gate that\n' +
        '  silently stops reading a renderer is worse than no gate: it reports success.',
    )
    process.exit(1)
  }
  // The allowlist size is reported rather than asserted away: the number is the thing worth watching, and a
  // gate that claimed to police sites it was skipping would be exactly the trusted-but-wrong signal this
  // check exists to prevent.
  console.log(
    `✓ no transport in the view — ${PATTERNS.length} patterns over ${files.length} files in ` +
      // Dirs that *contributed*, not dirs listed. `POLICED.length` was the number here, which is what let a
      // vanished directory keep printing "5 policed dirs" while four were read.
      `${POLICED.length - missing.length} policed dirs, ${ALLOWLIST.length} allowed site(s) ` +
      `(${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
  )
}
