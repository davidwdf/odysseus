#!/usr/bin/env node
/**
 * Pre-commit documentation-freshness check.
 *
 * Wired as a Claude Code PreToolUse(Bash) hook (see .claude/settings.json).
 * Receives the tool-call payload as JSON on stdin. It only acts on `git commit`
 * commands. If a commit stages CODE changes but no docs/ changes, it blocks the
 * commit (exit 2) and reminds the agent to run the `check-docs` skill.
 *
 * Bypass: include `[docs-ok]` in the commit message (the check-docs skill adds
 * this when it determines no doc update is needed), or use `git commit --no-verify`.
 *
 * Exit codes: 0 = allow, 2 = block (stderr is surfaced to the agent).
 */
import { execSync } from 'node:child_process'

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

const CODE_RE = /^(apps|packages|scripts)\//
const CODE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const DOCS_RE = /(^docs\/|\.md$|^README)/i

function isGitCommit(cmd) {
  return /\bgit\b[^\n]*\bcommit\b/.test(cmd)
}

function hasBypass(cmd) {
  return /\[docs-ok\]/i.test(cmd) || /--no-verify|(^|\s)-n(\s|$)/.test(cmd)
}

const input = await readStdin()
let cmd = ''
try {
  const payload = JSON.parse(input || '{}')
  cmd = payload?.tool_input?.command ?? ''
} catch {
  // Not JSON / not a hook payload — nothing to check.
  process.exit(0)
}

if (!cmd || !isGitCommit(cmd) || hasBypass(cmd)) process.exit(0)

let stagedRaw = ''
try {
  stagedRaw = execSync('git diff --cached --name-only', { encoding: 'utf8' })
} catch {
  // Not a git repo / git unavailable — don't get in the way.
  process.exit(0)
}

const files = stagedRaw
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
if (files.length === 0) process.exit(0)

const codeChanged = files.some((f) => CODE_RE.test(f) || CODE_EXT_RE.test(f))
const docsChanged = files.some((f) => DOCS_RE.test(f))

if (codeChanged && !docsChanged) {
  process.stderr.write(
    [
      '📝 Documentation check: this commit stages code changes but no docs/ updates.',
      '',
      'Run the `check-docs` skill to review whether docs/ need updating',
      '(architecture, frontend, data sources, decision log, roadmap…).',
      '',
      'If docs are already current, add [docs-ok] to the commit message to proceed,',
      'or use `git commit --no-verify` to skip this check.',
    ].join('\n') + '\n',
  )
  process.exit(2) // block
}

process.exit(0)
