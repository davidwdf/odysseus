import { project, projectState, type SpecRegistry } from './project'
import { type ComponentSpec, parseComponentSpec } from './schema'

/**
 * **The conformance walker**: the checks every renderer of a spec'd component must pass, and the
 * narrow thing each renderer has to supply to be checked.
 *
 * ## The line this file draws
 *
 * The **declaration is shared and the reading is not.** `project()` derives the expected text from the
 * spec, so there is one statement of what a component shows. Building a tree and reading text back out
 * of it stays per renderer — a `<button>` here, a `Pressable` with `accessibilityRole` there, an
 * `XCUIElement` in the Swift suite — and that is exactly where a renderer-specific mistake lives, so
 * ADR-069 decision 7's rule against sharing survives where it applies. What retires is the hand-written
 * `expectedText` each suite carried, which was a *specification* written twice.
 *
 * ## Three checks, and why these three
 *
 * 1. **`slots`** — the visible text is *exactly* the projection, in order. Exact rather than
 *    "contains", because containment cannot see an invented string, a duplicated remark or a reordering,
 *    and because equality is what pins the spec itself from both sides.
 * 2. **`content-not-affordance`** — the same text with **every handler withheld**. This is ADR-069's
 *    second finding turned into a universal law: both card renderers guarded the "+N more" count with
 *    `remaining > 0 && onPress`, so a caller with nowhere to navigate saw 6 of 26 routes and *was told
 *    nothing*. It took a second renderer to notice, because every caller in the first app passed a
 *    handler. Stated generally: **the visible text is a function of the view model alone.** Hiding an
 *    honest total because the affordance is unavailable is the silent filter ADR-008 forbids.
 * 3. **`sibling-not-nested`** — no interactive element inside another. Invalid HTML on web (ADR-024's
 *    reason), and an ambiguous tap target on every platform. Carries its own anti-vacuous control: a
 *    spec that declares interaction targets must produce interactive elements at all, or the check is
 *    looking at nothing.
 *
 * States, a11y and the interaction *destinations* are declared but not asserted here — see `schema.ts`'s
 * `enforcement`, which makes every state say so out loud rather than letting a `mustNot` sentence read as
 * if something checked it.
 */

/** What a renderer must hand back for one render. Deliberately three facts, not a tree. */
export interface RenderedTree {
  /**
   * Visible text in document order, empties dropped, **trimmed at the ends only**. Interior whitespace
   * must survive: a caption may use two separator widths meaningfully, and a normalising comparison
   * cannot tell a renderer that keeps them from one that collapses them — which is a divergence
   * `apps/web` shipped and its projection suite caught.
   */
  text: string[]
  /** How many interactive elements this tree contains. The control for the count below. */
  interactive: number
  /** How many interactive elements contain another interactive element. Must be zero. */
  nestedInteractive: number
}

export interface ConformanceHarness {
  /** Render the component for one view model. `interactive: false` withholds every handler. */
  render(view: unknown, opts: { interactive: boolean }): RenderedTree
  /** Resolve a `message` slot. Injected so this package knows no particular string catalogue. */
  translate(key: string, args?: Record<string, unknown>): string
}

/**
 * A harness that can also put its surface into a **named state** — what `conformStates` needs.
 *
 * The asymmetry with `render` is the interesting part. A component's states are fields of one view model,
 * so one render covers them. A *screen's* states are branches over an async status — no fix yet,
 * permission refused, first fetch in flight, upstream failed — which no view model carries, and which
 * only the renderer's own wiring can produce. So the driver owns *getting there*, and returns both the
 * tree **and** the view it corresponds to, because a state like "the fetch failed" has content (an error
 * message) that is not in any view model either.
 *
 * `null` means this renderer cannot reach that state. That is a finding rather than a skip: a state
 * declared with a projection that nothing can render is the same vacuous pass as a gate matching no
 * files.
 */
export interface StatefulHarness extends ConformanceHarness {
  renderState(state: string): { view: unknown; tree: RenderedTree } | null
}

export interface Finding {
  check: 'slots' | 'content-not-affordance' | 'sibling-not-nested' | 'states'
  message: string
}

/**
 * Run every check for one view model. Returns findings rather than throwing, so one failing case reports
 * all of its problems instead of only the first.
 *
 * The spec is re-parsed on every call rather than trusted, and that is not paranoia: a driver reads
 * committed JSON, and `parseComponentSpec` is what resolves the cross-references a Zod schema cannot —
 * a state claiming to be enforced by a slot that has since been renamed would otherwise survive as a
 * true-looking string.
 */
export function conform(
  spec: ComponentSpec | unknown,
  view: unknown,
  harness: ConformanceHarness,
  registry: SpecRegistry = {},
): Finding[] {
  const parsed = parseComponentSpec(spec)
  const expected = project(parsed, view, harness.translate, registry)
  const findings: Finding[] = []

  const interactive = harness.render(view, { interactive: true })
  const divergence = firstDivergence(interactive.text, expected)
  if (divergence !== null) {
    findings.push({
      check: 'slots',
      message: `${parsed.component}: ${divergence}`,
    })
  }

  const inert = harness.render(view, { interactive: false })
  const affordanceDivergence = firstDivergence(inert.text, expected)
  if (affordanceDivergence !== null) {
    findings.push({
      check: 'content-not-affordance',
      message:
        `${parsed.component}: the text changed when the handlers were withheld — ` +
        `${affordanceDivergence}. The visible text must be a function of the view model alone ` +
        // Deliberately no domain noun here: `check-no-domain-vocabulary.mjs` scans string literals, and
        // its first working run caught this very line naming what ADR-069's finding was about.
        '(ADR-069: a count guarded by `&& onPress` showed 6 of 26 rows and said nothing).',
    })
  }

  if (interactive.nestedInteractive > 0) {
    findings.push({
      check: 'sibling-not-nested',
      message:
        `${parsed.component}: ${interactive.nestedInteractive} interactive element(s) are nested ` +
        'inside another. Tap targets are siblings, never nested — invalid HTML on web, ambiguous ' +
        'everywhere (ADR-024).',
    })
  } else if (parsed.interactions.length > 0 && interactive.interactive === 0) {
    findings.push({
      check: 'sibling-not-nested',
      message:
        `${parsed.component}: the spec declares ${parsed.interactions.length} interaction target(s) ` +
        'but the interactive render produced no interactive element, so the nesting check looked at ' +
        'nothing. Either the harness cannot see them or the renderer does not draw them.',
    })
  }

  return findings
}

/**
 * Hold a renderer to **every state that declares a projection**.
 *
 * This is the check a screen needs and a component does not, and it is where the five declared states stop
 * being sentences. Each state with `enforcement.shows` is rendered by the driver and compared, exactly, to
 * the always-present `slots` plus that state's own additions.
 *
 * Two findings a reader should expect and one they should not:
 *  · a state whose text diverges — the ordinary failure;
 *  · a state the renderer **cannot reach** (`renderState` returns `null`), which is a finding rather than a
 *    skip: a declared projection nothing can render is the same vacuous pass as a gate that matches no
 *    files, and this repo has hit that eight times;
 *  · a state with no projection (`by` / `knownDefect` / `unenforced`) is silently not checked **here** —
 *    it is checked, or explicitly not, by the mechanism its `enforcement` names. That is the whole reason
 *    `enforcement` is mandatory.
 *
 * The **anti-vacuous control is that at least one state must be projected at all.** A spec whose every
 * state was `unenforced` would pass this function while asserting nothing, which is exactly how a
 * specification quietly becomes decoration.
 */
export function conformStates(
  spec: ComponentSpec | unknown,
  harness: StatefulHarness,
  registry: SpecRegistry = {},
): Finding[] {
  const parsed = parseComponentSpec(spec)
  const findings: Finding[] = []
  let projected = 0

  for (const state of Object.keys(parsed.states)) {
    const rendered = harness.renderState(state)
    const declared = parsed.states[state]
    const hasProjection = declared !== undefined && 'shows' in declared.enforcement
    if (!hasProjection) continue
    projected += 1
    if (rendered === null) {
      findings.push({
        check: 'states',
        message:
          `${parsed.component}: state \`${state}\` declares what it must show, and this renderer ` +
          'cannot be put into it. Either the driver is missing a fixture or the surface has no such state.',
      })
      continue
    }
    const expected = projectState(parsed, state, rendered.view, harness.translate, registry)
    if (expected === null) continue
    const divergence = firstDivergence(rendered.tree.text, expected)
    if (divergence !== null) {
      findings.push({
        check: 'states',
        message: `${parsed.component} in \`${state}\`: ${divergence}`,
      })
    }
    if (rendered.tree.nestedInteractive > 0) {
      findings.push({
        check: 'sibling-not-nested',
        message: `${parsed.component} in \`${state}\`: ${rendered.tree.nestedInteractive} nested tap target(s).`,
      })
    }
  }

  if (projected === 0) {
    findings.push({
      check: 'states',
      message:
        `${parsed.component}: no state declares what it must show, so this check looked at nothing. ` +
        'At least one state must be projected, or the states are decoration.',
    })
  }
  return findings
}

/** A message naming the first place two text runs differ, or `null` when they are identical. */
function firstDivergence(got: readonly string[], expected: readonly string[]): string | null {
  const length = Math.max(got.length, expected.length)
  for (let i = 0; i < length; i += 1) {
    if (got[i] === expected[i]) continue
    const where = `at index ${i}`
    if (i >= expected.length)
      return `rendered ${where} what the spec does not declare: ${show(got[i])}`
    if (i >= got.length)
      return `did not render ${where} what the spec declares: ${show(expected[i])}`
    return `rendered ${show(got[i])} ${where} where the spec declares ${show(expected[i])}`
  }
  return null
}

/** JSON-quoted, so a difference that is only whitespace is visible in the failure message. */
function show(value: string | undefined): string {
  return value === undefined ? '(nothing)' : JSON.stringify(value)
}
