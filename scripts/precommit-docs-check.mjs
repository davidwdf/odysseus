#!/usr/bin/env node
// Gate for WP5-8 (CLAUDE.md rule 7): **a commit that changes code changes the docs, or says why not.**
//
// WHY THIS FILE GREW A SECOND MODE
// Rule 7 is the only golden rule in this repo that nothing enforced. CLAUDE.md said so in as many words
// — *"Know what enforces this today: nothing"* — and `.github/workflows/ci.yml` explained at length why
// it could not simply add a step: this script was a Claude Code `PreToolUse(Bash)` hook and nothing else.
// It reads a JSON tool-call payload on stdin, pulls the `git commit` command line out of it, and diffs
// the **index**. In CI stdin is empty and nothing is staged, so both of its early exits fire and it
// returns 0 having examined nothing — a step that passes for ever while checking nothing, which is this
// repo's own recurring failure and worse than having no step at all, because a green tick is a claim.
//
// So the rule is now **one declaration** (`docsVerdict`) with two callers that differ only in where they
// get their inputs:
//
//   · **hook mode** (no arguments, a payload on stdin) — the files are the *index*, and the bypass comes
//     from the **command line**, because at `PreToolUse` time the message exists only as a `-m` argument.
//   · **`--range <base>..<head>`** — the files are each commit's own diff, and the bypass comes from each
//     commit's **message body**. This is the mode CI runs, per commit, over a pull request's range.
//
// Same predicate, two sets of inputs. That split is the whole design: the previous shape had the rule
// tangled into stdin parsing, so the only way to apply it to a commit that already existed was to write
// it a second time — and a second copy of a rule is how the copies come to disagree (the failure ADR-073
// is about, one layer down).
//
// THE FOUR PROPERTIES THIS REPO'S GATES SHARE, AND WHERE THEY ARE HERE
// (`docs/05-monorepo-and-tooling.md`, "Writing a test or a gate here: what the harnesses require".)
//   · a `--selftest` that runs every rule against a synthetic fixture **plus controls that must produce
//     no findings** — `SCENARIOS`, of which four are controls;
//   · a guard that fails when the check matched **nothing at all** — `--range` over an empty range is a
//     FAILURE, not a pass. That is the eighth-plus instance of *a gate that passes because it is looking
//     at nothing*, arriving in the one shape a commit-range check can take;
//   · the live tree as the last control — the selftest runs the rule over this repository's own recent
//     history, which is why `--selftest` alone catches a rule that has drifted from what the tree does;
//   · no allowlist. There is deliberately none: the escape hatch is `[docs-ok]` in the commit message,
//     which is per commit, visible in `git log` for ever, and needs no second file to rot.
//
// Exit codes: 0 = allow. **2** in hook mode, because that is the code a `PreToolUse` hook must use for
// its stderr to reach the agent. **1** in `--range`/`--selftest` mode, the ordinary failure code every
// other gate in `pnpm boundaries` uses. Two codes for two callers, stated because it looks like a slip.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── The rule, declared once ────────────────────────────────────────────────────────────────────

/**
 * A path under one of the three source trees, or anything with a code extension anywhere.
 *
 * Two patterns rather than one because they catch different things and both are wanted: the first says
 * *"this is source, whatever it is spelled"* (a `.json` fixture under `packages/core/spec/`, a
 * `wrangler.toml`, a `.strings` artefact), the second says *"this is code, wherever it lives"* (a
 * `vitest.config.ts` at a package root, `turbo.json`'s siblings, a root-level `.mjs`).
 */
const CODE_RE = /^(apps|packages|scripts)\//
const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
/**
 * What counts as documentation. Anything under `docs/`, any Markdown anywhere, and a bare `README`.
 *
 * Deliberately generous. The rule's purpose is to make somebody *think* about the docs, and a package
 * README or `packages/contract/README.md` (the native porter's entry point, ADR-067) is documentation by
 * any honest reading. A narrower pattern would push people towards `[docs-ok]`, which is the outcome to
 * avoid: the bypass is meant to be rare enough that reading one in a log is informative.
 */
const DOCS_RE = /(^docs\/|\.md$|^README)/i

/** `[docs-ok]`, the one bypass. Case-insensitive, anywhere in the text it is handed. */
const DOCS_OK_RE = /\[docs-ok\]/i

/**
 * Should this change have touched the docs?
 *
 * **The one declaration of rule 7.** Both modes call this and nothing else decides. `files` is a list of
 * repository-relative paths — the index in hook mode, one commit's own diff in `--range` mode — and
 * `bypass` is computed by the caller, because the two modes read it from genuinely different places (see
 * the header). Passing it in rather than sniffing for it here is what keeps this function pure and
 * testable without a git repository or a stdin payload.
 *
 * An empty `files` is `ok`. That is not laziness about the empty commit: in hook mode it means nothing is
 * staged, so there is no change to have documented, and blocking there would fire on `git commit --amend
 * --no-edit` and on every `git commit` typed before `git add`.
 */
export function docsVerdict({ files, bypass }) {
  const code = files.filter((f) => CODE_RE.test(f) || CODE_EXT_RE.test(f))
  const docs = files.filter((f) => DOCS_RE.test(f))
  const needsDocs = code.length > 0 && docs.length === 0
  return { code, docs, needsDocs, bypass: Boolean(bypass), ok: Boolean(bypass) || !needsDocs }
}

/**
 * The bypass, as a `git commit` **command line** offers it (hook mode).
 *
 * `--no-verify` and `-n` are honoured here and **nowhere else**, and the asymmetry is the honest one:
 * they mean "skip the hooks for this invocation", which is a statement about a hook and not about the
 * documentation. A commit that already exists has no invocation to skip, so in `--range` mode the only
 * bypass is the one recorded in the message, where a reviewer can see it.
 */
export function bypassFromCommand(cmd) {
  return DOCS_OK_RE.test(cmd) || /--no-verify|(^|\s)-n(\s|$)/.test(cmd)
}

/** The bypass, as a commit **message** records it (`--range` mode). `[docs-ok]` only — see above. */
export function bypassFromMessage(message) {
  return DOCS_OK_RE.test(message)
}

// ── git, for `--range` ─────────────────────────────────────────────────────────────────────────

/**
 * git, with its stderr **captured rather than inherited**.
 *
 * The default `stdio` lets a child's stderr straight through to ours, so an unresolvable range printed
 * git's four-line "ambiguous argument" hint *before* the explanation of what to do about it — and the
 * hint is the misleading half (it suggests a `--` path separator, when the real cause is a shallow
 * clone). Captured, it becomes the one line quoted inside the message that knows why.
 */
const git = (args, cwd = repoRoot) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const lines = (out) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * The commits a range names, oldest first, **merges excluded**.
 *
 * `--no-merges` for two reasons and one accepted limitation. A merge commit's `diff-tree` output against
 * its first parent is empty (verified: the repo's two merges both yield nothing), so a merge would always
 * read as "no files" and pass vacuously. And on `pull_request` GitHub checks out a *synthetic* merge of
 * the head into the base, so without this flag every run would additionally examine a commit that exists
 * nowhere and contains the whole PR squashed — passing whenever any commit in the PR touched a doc, which
 * would defeat the per-commit granularity this mode exists for.
 *
 * **The limitation, stated rather than discovered:** content that exists *only* in a merge commit — an
 * "evil merge", a conflict resolved by editing code — is not examined. Checking it would mean diffing a
 * merge against each parent and deciding which difference is the merge's own, which is a real problem and
 * not one worth solving for a repository whose merges are all fast-forward-shaped PR merges.
 */
export function commitsIn(range, cwd = repoRoot) {
  return lines(git(['rev-list', '--no-merges', '--reverse', range], cwd))
}

/**
 * One commit's own file list.
 *
 * `--root` is required and is easy to miss: without it `diff-tree` prints **nothing** for a commit with
 * no parent, so the initial commit of any repository — and every commit in the selftest's synthetic one,
 * if it had only one — would pass while being unexamined. Measured against this repo's own root commit,
 * which reports 1 file with the flag and 0 without.
 */
export function commitFiles(sha, cwd = repoRoot) {
  return lines(git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha], cwd))
}

/** One commit's full message, subject and body, exactly as `git log` shows it. */
export function commitMessage(sha, cwd = repoRoot) {
  return git(['log', '-1', '--format=%B', sha], cwd)
}

/** One line of `git log --oneline` for a commit, for a finding a reader can act on. */
const commitSubject = (sha, cwd = repoRoot) => git(['log', '-1', '--format=%h %s', sha], cwd).trim()

/**
 * Apply the rule to a list of commits, oldest first. Returns one entry per commit, verdict included, so
 * a caller can report the offenders **and** say how many it looked at — which is the number that stops
 * this being a gate that passes because it read nothing.
 */
export function checkCommits(shas, cwd = repoRoot) {
  return shas.map((sha) => ({
    sha,
    subject: commitSubject(sha, cwd),
    ...docsVerdict({
      files: commitFiles(sha, cwd),
      bypass: bypassFromMessage(commitMessage(sha, cwd)),
    }),
  }))
}

// ── --selftest ─────────────────────────────────────────────────────────────────────────────────

/**
 * Scenarios for the pure rule. Four of the eight are **controls that must produce no findings** — the
 * property `docs/05` names as load-bearing, because a `docsVerdict` that returned `ok` unconditionally
 * would otherwise satisfy every scenario that expects a pass and none of them would notice.
 */
const SCENARIOS = [
  {
    name: 'code with no docs',
    files: ['packages/core/src/live.ts', 'packages/core/test/live.test.ts'],
    bypass: false,
    wantOk: false,
  },
  {
    name: 'code with docs',
    why: 'THE CONTROL for the docs pattern. Without it, a `DOCS_RE` that matched nothing would fail every commit and every scenario above would still pass.',
    files: ['packages/core/src/live.ts', 'docs/08-decision-log.md'],
    bypass: false,
    wantOk: true,
  },
  {
    name: 'code with no docs, bypassed',
    files: ['apps/edge/src/index.ts'],
    bypass: true,
    wantOk: true,
  },
  {
    name: 'docs only',
    why: 'THE SECOND CONTROL. A rule keyed on "did anything change" rather than on "did code change" would fail this, and a docs-only commit is the most ordinary commit in this repo.',
    files: ['docs/11-status.md'],
    bypass: false,
    wantOk: true,
  },
  {
    name: 'nothing at all',
    why: 'THE THIRD CONTROL: an empty index in hook mode, and an empty commit in range mode. Neither is a change that could have been documented.',
    files: [],
    bypass: false,
    wantOk: true,
  },
  {
    name: 'a generated artefact with no docs',
    why: 'A committed generated file is source by CODE_RE even though `.json` is not a code extension — `openapi.json` moving is a wire change and the loudest possible reason to look at the docs.',
    files: ['packages/contract/openapi.json'],
    bypass: false,
    wantOk: false,
  },
  {
    name: 'a package README counts as documentation',
    why: "THE FOURTH CONTROL, and a deliberate one: `packages/contract/README.md` is the native porter's entry point (ADR-067), so it is documentation by any honest reading.",
    files: ['packages/contract/src/wire/eta.ts', 'packages/contract/README.md'],
    bypass: false,
    wantOk: true,
  },
  {
    name: 'a lockfile and a config file with no docs',
    why: 'Not under apps/packages/scripts and not a code extension — so this is *not* a violation, which is worth pinning: widening the rule to every path would make `pnpm-lock.yaml` churn demand an ADR.',
    files: ['pnpm-lock.yaml', 'biome.json'],
    bypass: false,
    wantOk: true,
  },
]

/** Bypass-parsing scenarios. The two modes read it from different places, so both are exercised. */
const BYPASS_CASES = [
  {
    name: 'command: [docs-ok] in the message argument',
    got: () => bypassFromCommand('git commit -m "x [docs-ok]"'),
    want: true,
  },
  {
    name: 'command: --no-verify',
    got: () => bypassFromCommand('git commit --no-verify -m x'),
    want: true,
  },
  {
    name: 'command: -n as its own word',
    got: () => bypassFromCommand('git commit -n -m x'),
    want: true,
  },
  {
    name: 'command: an ordinary commit is not a bypass',
    why: 'THE CONTROL. A `-n` matcher without the word boundaries matches the `-n` inside `--no-edit`, `-name` or a filename, and every commit would then be exempt.',
    got: () => bypassFromCommand('git commit --amend --no-edit -m "docs: note"'),
    want: false,
  },
  {
    name: 'message: [DOCS-OK] is case-insensitive',
    got: () => bypassFromMessage('subject\n\n[DOCS-OK] reason'),
    want: true,
  },
  {
    name: 'message: --no-verify in a message is NOT a bypass',
    why: 'The asymmetry stated in `bypassFromCommand`: a commit that exists has no invocation to skip, so only the recorded `[docs-ok]` counts. Without this the string could be smuggled into a body.',
    got: () => bypassFromMessage('fix: stop passing --no-verify in scripts'),
    want: false,
  },
]

/**
 * A throwaway repository under the OS temp directory, and **never this one**.
 *
 * Every git call below passes an explicit `cwd`, which is not fussiness: this workspace shares its
 * checkout and its branch with other live sessions, so a mutating git command that inherited the process
 * cwd would be reaching into somebody else's working tree. `-c` for the identity rather than a written
 * config, so the selftest needs no global git setup — which is exactly the CI runner's situation.
 */
function withTempRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nextbus-docs-check-'))
  const g = (...args) =>
    git(
      [
        '-c',
        'user.email=selftest@example.invalid',
        '-c',
        'user.name=selftest',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      dir,
    )
  try {
    g('init', '--initial-branch=main', '--quiet')
    /** Write files, stage everything and commit with this message. Returns the sha. */
    const commit = (files, message) => {
      for (const [path, body] of Object.entries(files)) {
        const full = join(dir, path)
        // Every fixture path below is a flat filename, so no directory has to be created. Asserted
        // rather than assumed: a nested path would fail at `writeFileSync` and read as a git problem.
        if (path.includes('/')) throw new Error(`selftest fixture paths must be flat: ${path}`)
        writeFileSync(full, body)
      }
      g('add', '-A')
      g('commit', '-q', '-m', message)
      return g('rev-parse', 'HEAD').trim()
    }
    return fn({ dir, commit, g })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * The range half of the selftest: real commits, a real range, and one commit that must be named.
 *
 * A synthetic repository rather than this one because the interesting cases do not exist here — the
 * measurement that matters (all 51 non-merge commits in this repo's history already pass) is exactly why
 * a live-tree control cannot demonstrate a failure.
 */
function rangeSelftest(log) {
  return withTempRepo(({ dir, commit, g }) => {
    let failed = 0
    const check = (name, got, want, why) => {
      const ok = JSON.stringify(got) === JSON.stringify(want)
      if (!ok) failed += 1
      log(`  ${ok ? '✓' : '✗'} range: ${name}`)
      if (why && !ok) log(`      why: ${why}`)
      if (!ok) log(`      expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
    }

    // The root commit — checked at all only because `commitFiles` passes `--root`.
    const root = commit({ 'seed.md': 'seed\n' }, 'docs: seed')
    check(
      'the root commit is examined and passes',
      checkCommits([root], dir).map((c) => c.ok),
      [true],
    )

    const bad = commit({ 'thing.ts': 'export const a = 1\n' }, 'feat: a thing')
    const good = commit({ 'other.ts': 'export const b = 2\n', 'note.md': 'why\n' }, 'feat: another')
    const bypassed = commit({ 'third.ts': 'export const c = 3\n' }, 'chore: third [docs-ok]')

    const all = checkCommits(commitsIn(`${root}..${bypassed}`, dir), dir)
    check(
      'three commits, exactly one offender, and it is the right one',
      all.filter((c) => !c.ok).map((c) => c.sha),
      [bad],
      'a rule that blamed the whole range, or the wrong commit, is useless to whoever has to fix it',
    )
    check(
      'the range is examined oldest-first',
      all.map((c) => c.sha),
      [bad, good, bypassed],
    )

    // A merge that carries nothing of its own is skipped rather than passed. Built on a side branch so
    // the merge is a real one with two parents.
    g('checkout', '-q', '-b', 'side', good)
    const side = commit({ 'side.ts': 'export const d = 4\n', 'side.md': 'why\n' }, 'feat: side')
    g('checkout', '-q', 'main')
    g('merge', '-q', '--no-ff', '-m', 'merge side', side)
    const merged = g('rev-parse', 'HEAD').trim()
    check(
      'a merge commit is not in the range',
      commitsIn(`${root}..${merged}`, dir).includes(merged),
      false,
      'a merge diffs empty against its first parent, so including it would be a commit that always passes',
    )
    check(
      'the merged branch’s own commits ARE examined',
      commitsIn(`${root}..${merged}`, dir).includes(side),
      true,
    )

    // An empty commit: legal, and not a change anyone could have documented.
    g('commit', '-q', '--allow-empty', '-m', 'chore: empty')
    const empty = g('rev-parse', 'HEAD').trim()
    check(
      'an empty commit passes',
      checkCommits([empty], dir).map((c) => c.ok),
      [true],
    )

    // THE VACUOUS-PASS GUARD, in the one shape a commit-range check can take.
    check(
      'a range with no commits resolves to nothing',
      commitsIn(`${merged}..${merged}`, dir),
      [],
      'and `main` below must therefore FAIL rather than report success — that is the guard',
    )
    return failed
  })
}

function selftest() {
  const log = (...a) => console.log(...a)
  log('precommit-docs-check --selftest: watching the rule fail on purpose')
  let failed = 0

  for (const s of SCENARIOS) {
    const got = docsVerdict({ files: s.files, bypass: s.bypass }).ok
    const ok = got === s.wantOk
    if (!ok) failed += 1
    log(`  ${ok ? '✓' : '✗'} rule: ${s.name} → ${got ? 'ok' : 'needs docs'}`)
    if (!ok) log(`      expected ${s.wantOk ? 'ok' : 'needs docs'}`)
  }
  for (const c of BYPASS_CASES) {
    const got = c.got()
    const ok = got === c.want
    if (!ok) failed += 1
    log(`  ${ok ? '✓' : '✗'} bypass: ${c.name}`)
    if (!ok) log(`      expected ${c.want}, got ${got}`)
  }

  failed += rangeSelftest(log)

  // The live tree, last and best: the rule over this repository's own recent history. Every commit here
  // must pass, and that is a measurement rather than a hope — all 51 non-merge commits in the history at
  // the time this was written already satisfy rule 7, which is what makes it safe to turn on in CI with
  // no grandfathering.
  //
  // **A shallow clone fails rather than narrowing quietly**, and that is the point of the check below.
  // `actions/checkout@v4` fetches one commit by default, so without `fetch-depth: 0` this control would
  // examine exactly the head commit, report "1 commit examined", and pass — a control reading 1/20th of
  // what it claims is the same defect as one reading nothing, and it would arrive in CI silently.
  const LIVE_DEPTH = 20
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true'
  const recent = shallow
    ? []
    : lines(git(['rev-list', '--no-merges', '--reverse', `-${LIVE_DEPTH}`, 'HEAD']))
  const liveBad = recent.length === 0 ? [] : checkCommits(recent).filter((c) => !c.ok)
  const liveOk = recent.length > 0 && liveBad.length === 0
  if (!liveOk) failed += 1
  log(
    `  ${liveOk ? '✓' : '✗'} the live tree → ${recent.length} commit(s) examined, ` +
      `${liveBad.length} would be blocked`,
  )
  for (const c of liveBad) log(`      · ${c.subject}`)
  if (shallow) {
    log(
      '      this clone is SHALLOW, so the control could not read history — CI needs `fetch-depth: 0`',
    )
  } else if (recent.length === 0) {
    log('      the control read NO commits — an empty history?')
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed} selftest case(s) did not behave as documented.`)
    process.exit(1)
  }
  log(
    `  ✓ all ${SCENARIOS.length} rule scenarios, ${BYPASS_CASES.length} bypass cases, the synthetic ` +
      `range and ${recent.length} live commits behaved as documented.`,
  )
}

// ── --range ────────────────────────────────────────────────────────────────────────────────────

function rangeMode(range) {
  let shas
  try {
    shas = commitsIn(range)
  } catch (err) {
    console.error(`✗ precommit-docs-check --range ${range}: git could not resolve that range\n`)
    // The first line only. git follows "ambiguous argument" with a three-line hint about `--` path
    // separators, which is the wrong diagnosis here and would bury the right one below it.
    const why = (err.stderr ?? err.message ?? String(err)).toString().trim().split('\n')[0]
    console.error(`  ${why}`)
    console.error(
      '\n  On `pull_request`, `actions/checkout` fetches a single commit by default — the base sha is\n' +
        '  not in the clone. `fetch-depth: 0` is what makes `<base>..HEAD` resolvable.',
    )
    process.exit(1)
  }

  if (shas.length === 0) {
    // The vacuous-pass guard. A range that names no commits has told us nothing about the tree, and a
    // gate that answers "fine" to that is the failure mode this repo has hit eight times. It is a
    // *failure* and not a warning because CI would show the warning as green.
    console.error(`✗ precommit-docs-check --range ${range} matched NO commits.\n`)
    console.error(
      '  Nothing was examined, so this run is not evidence of anything. Check the range: on\n' +
        '  `pull_request` it is `<base sha>..HEAD` and `fetch-depth: 0` is required; on `push` the\n' +
        '  zero sha means "new ref" and needs resolving before it gets here.',
    )
    process.exit(1)
  }

  const results = checkCommits(shas)
  const bad = results.filter((c) => !c.ok)
  if (bad.length > 0) {
    console.error(
      `✗ ${bad.length} commit(s) change code without changing docs (CLAUDE.md rule 7)\n`,
    )
    for (const c of bad) {
      console.error(`  · ${c.subject}`)
      for (const f of c.code.slice(0, 6)) console.error(`      ${f}`)
      if (c.code.length > 6) console.error(`      … and ${c.code.length - 6} more`)
    }
    console.error(
      '\n  Each of these must either update the relevant doc — architecture, frontend, data sources,\n' +
        '  the decision log, the roadmap — and add an ADR in `docs/08` for any new cross-cutting\n' +
        '  decision, or say `[docs-ok]` in its message with the reason. Rewrite the message with\n' +
        '  `git rebase -i` if the docs really are current; the bypass is per commit and permanent, so a\n' +
        '  reader of `git log` can see which commits claimed it.',
    )
    console.error('\n  The rule:  CLAUDE.md rule 7  ·  The helper:  the `check-docs` skill')
    process.exit(1)
  }
  const bypassed = results.filter((c) => c.bypass).length
  console.log(
    `✓ docs freshness — ${results.length} commit(s) in ${range}, ` +
      `${results.filter((c) => c.code.length > 0).length} touching code, ` +
      `${bypassed} claiming [docs-ok].`,
  )
}

// ── hook mode ──────────────────────────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) return resolve('')
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    // Safety: don't hang forever if no stdin arrives.
    setTimeout(() => resolve(data), 1000)
  })
}

const isGitCommit = (cmd) => /\bgit\b[^\n]*\bcommit\b/.test(cmd)

async function hookMode() {
  const input = await readStdin()
  let cmd = ''
  try {
    const payload = JSON.parse(input || '{}')
    cmd = payload?.tool_input?.command ?? ''
  } catch {
    // Not JSON / not a hook payload — nothing to check.
    process.exit(0)
  }

  if (!cmd || !isGitCommit(cmd) || bypassFromCommand(cmd)) process.exit(0)

  let staged
  try {
    staged = lines(git(['diff', '--cached', '--name-only']))
  } catch {
    // Not a git repo / git unavailable — don't get in the way.
    process.exit(0)
  }

  // `bypass` is already known false — the early exit above returned for it — so this call is asking the
  // one question left. Written out anyway rather than inlining `needsDocs`, so the hook and the range
  // mode visibly go through the same door.
  if (docsVerdict({ files: staged, bypass: false }).ok) process.exit(0)

  process.stderr.write(
    [
      '📝 Documentation check: this commit stages code changes but no docs/ updates.',
      '',
      'Run the `check-docs` skill to review whether docs/ need updating',
      '(architecture, frontend, data sources, decision log, roadmap…).',
      '',
      'If docs are already current, add [docs-ok] to the commit message to proceed,',
      'or use `git commit --no-verify` to skip this check.',
      '', // trailing entry, so join() supplies the final newline without concatenation
    ].join('\n'),
  )
  process.exit(2) // block
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const rangeAt = argv.indexOf('--range')

if (argv.includes('--selftest')) {
  selftest()
} else if (rangeAt !== -1) {
  const range = argv[rangeAt + 1]
  if (!range) {
    console.error('usage: precommit-docs-check.mjs --range <base>..<head>')
    process.exit(1)
  }
  rangeMode(range)
} else {
  await hookMode()
}
