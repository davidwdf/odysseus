---
name: check-docs
description: Check whether staged code changes require documentation updates in docs/, and update the affected docs. Use before committing, when the pre-commit hook reports that code changed without docs, or whenever the user asks to verify/refresh project documentation. Keeps docs/ (the source of truth) in sync with the code.
---

# check-docs — keep `docs/` in sync with the code

The project's `docs/` folder is the source of truth (see `docs/README.md`). This skill reviews
the current changes and updates any documentation they invalidate, **then** lets the commit proceed.

## When this runs
- Automatically prompted by the pre-commit hook (`scripts/precommit-docs-check.mjs`) when a
  `git commit` has staged **code** changes but no `docs/` changes.
- On demand: `/check-docs`, or when the user asks to refresh/verify docs.

## Steps

1. **Get the change set.**
   - Staged: `git diff --cached --name-only` and `git diff --cached`.
   - If nothing is staged, fall back to `git diff HEAD`.

2. **Map changes → docs.** For each changed area, decide which doc(s) could be affected:
   | Changed area | Likely doc to review |
   |---|---|
   | `packages/data-normalize/`, new operator adapter, upstream API usage | `docs/02-data-sources.md`, `docs/07-backlog.md` (tick off operators) |
   | `apps/edge/`, Workers, Durable Objects, caching, `DataSource` impl | `docs/03-architecture.md` |
   | `apps/mobile/`, `packages/ui/`, animations, design tokens, ETA display | `docs/04-frontend-and-design.md` |
   | repo layout, packages, tooling, CI | `docs/05-monorepo-and-tooling.md` |
   | scope / features shipped or cut | `docs/01-vision-and-scope.md`, `docs/06-roadmap.md` |
   | **any new cross-cutting decision** (library, infra, pattern, trade-off) | **`docs/08-decision-log.md` — add/update an ADR** |

3. **Decide and act.**
   - If a doc is now inaccurate or incomplete, **edit it** to match reality. Keep the doc's
     existing voice and structure. For decisions, add a new ADR (next number) rather than rewriting
     history; mark superseded ones `Superseded by ADR-NNN`.
   - If the change is purely internal (refactor, formatting, tests) and no doc is affected,
     that's a valid outcome — **no edit needed**.

4. **Report & unblock.**
   - If you updated docs: stage them (`git add docs/ ...`) and proceed with the commit.
   - If no docs needed updating: tell the user briefly why, and proceed by adding **`[docs-ok]`**
     to the commit message (the hook treats this as "docs reviewed, no change needed"), or use
     `git commit --no-verify`.

## Principles
- Be honest: don't invent doc changes to satisfy the hook, and don't skip real ones to avoid work.
- Prefer small, precise edits over rewrites.
- A new library/infra/pattern/trade-off almost always deserves an ADR in `docs/08-decision-log.md`.
