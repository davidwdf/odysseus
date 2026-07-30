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
 * This list was *discovered by running the check*, not predicted. It found exactly one site.
 */
const ALLOWLIST = [
  {
    file: 'apps/mobile/lib/tileSource.ts',
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
 * Strip comments, so prose about a transport stays legal.
 *
 * Every gate in this repo carries this exemption and the same argument for it: a check that flagged its own
 * documentation would be deleted within a week — and this one would flag a *lot*, because the interesting
 * comments in `apps/mobile/lib/` are precisely the ones explaining which endpoint a seam reaches and why.
 * String literals are **not** blanked, unlike `apps/web/scripts/check-no-derivation.mjs`: a path literal
 * inside a string is the violation, so blanking strings would make the `api-path` rule find nothing.
 * Deliberately lexical rather than a real parse — a `//` inside a string over-strips that one line, which
 * can only produce a false negative there, and the alternative is a JS parser in a 120-line check.
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
  return [...new Set(out.split('\0').filter(Boolean))]
    .map((f) => f.split(sep).join('/'))
    .filter((f) => /\.(m?[jt]sx?)$/.test(f))
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
  // The allowlist size is reported rather than asserted away: the number is the thing worth watching, and a
  // gate that claimed to police sites it was skipping would be exactly the trusted-but-wrong signal this
  // check exists to prevent.
  console.log(
    `✓ no transport in the view — ${PATTERNS.length} patterns over ${files.length} files in ` +
      `${POLICED.length} policed dirs, ${ALLOWLIST.length} allowed site(s) ` +
      `(${relative(repoRoot, fileURLToPath(import.meta.url))}).`,
  )
}
