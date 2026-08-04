import { describe, expect, it } from 'vitest'
import {
  type ComponentSpec,
  type ConformanceHarness,
  conform,
  conformStates,
  parseComponentSpec,
  project,
  projectState,
  read,
  type StatefulHarness,
} from '../src/index'

// The format's own suite. It exists because of an asymmetry ADR-075 accepts out loud: *"a shared spec is a
// shared bug"*. Two renderers now derive what they must show from one projection, so a defect in `project`
// or `conform` relaxes both at once — the exact failure mode duplicating a helper used to prevent. The
// answer is not to duplicate it again; it is to test the thing that is now load-bearing.
//
// Every fixture here is **abstract on purpose** — a title, some items, a badge. This package must not know
// what any particular app renders, and `scripts/check-no-domain-vocabulary.mjs` scans this directory too,
// so a fixture written in terms of one app's screens would fail the build rather than merely age badly.

const harnessOf = (
  trees: Record<'interactive' | 'inert', { text: string[]; interactive?: number; nested?: number }>,
): ConformanceHarness => ({
  render: (_view, opts) => {
    const tree = opts.interactive ? trees.interactive : trees.inert
    return {
      text: tree.text,
      interactive: tree.interactive ?? 1,
      nestedInteractive: tree.nested ?? 0,
    }
  },
  translate: (key, args) => (args ? `${key}(${JSON.stringify(args)})` : key),
})

/** A minimal, valid spec: one required slot, one conditional, one repeated, one alternation. */
function baseSpec(overrides: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    component: 'Panel',
    version: 1,
    doc: 'A titled panel with a list under it.',
    viewModel: {
      module: 'panel',
      type: 'PanelView',
      corpus: 'panel.spec.json',
      group: 'panelView',
    },
    slots: [
      { name: 'title', text: { field: 'title' } },
      {
        name: 'note',
        text: { field: 'note' },
        when: 'note',
        why: 'Absent when nothing qualifies it.',
      },
      {
        name: 'items',
        each: 'items',
        of: [
          { name: 'label', text: { field: 'label' } },
          {
            name: 'badge',
            oneOf: 'badge.kind',
            cases: {
              count: [
                { name: 'badgeValue', text: { field: 'badge.value' } },
                { name: 'badgeUnit', text: { field: 'badge.unit' } },
              ],
              word: [{ name: 'badgeWord', text: { field: 'badge.word' } }],
              none: [{ name: 'badgeDash', text: { literal: '—', why: 'Nothing to state.' } }],
            },
          },
        ],
      },
      {
        name: 'overflow',
        text: { message: 'more', args: { n: 'hidden' } },
        when: 'hidden',
        why: 'Zero hidden entries means there is no affordance to draw.',
      },
    ],
    states: {
      loading: {
        must: 'A skeleton.',
        mustNot: 'A blank box.',
        enforcement: { unenforced: 'Screen-level.' },
      },
      empty: {
        must: 'An explicit line.',
        mustNot: 'A title alone.',
        enforcement: { knownDefect: 'Owner: later.' },
      },
      failed: { must: 'A cue.', mustNot: 'Reading as empty.', enforcement: { by: 'note' } },
      stale: {
        must: 'A dimmed value and an age.',
        mustNot: 'Colour alone.',
        enforcement: { unenforced: 'Opacity.' },
      },
      offline: {
        must: 'The last values, aged.',
        mustNot: 'A blank box.',
        enforcement: { unenforced: 'Screen-level.' },
      },
    },
    interactions: [{ target: 'title', goes: 'detail' }],
    a11y: { role: 'group', name: { fromSlot: 'title' }, reducedMotion: 'No entrance animation.' },
    idiom: ['material', 'shape'],
    ...overrides,
  }
}

const VIEW = {
  title: 'Panel',
  note: '',
  items: [
    { label: 'first', badge: { kind: 'count', value: 4, unit: 'min' } },
    { label: 'second', badge: { kind: 'word', word: 'Due' } },
    { label: 'third', badge: { kind: 'none' } },
  ],
  hidden: 2,
}

/** Point the `failed` state at a slot that does not exist — the rot the parser must catch. */
function breakFailedEnforcement(spec: ComponentSpec): void {
  const failed = spec.states.failed
  if (!failed) throw new Error('unreachable: baseSpec declares `failed`')
  failed.enforcement = { by: 'moved' }
}

const EXPECTED = ['Panel', 'first', '4', 'min', 'second', 'Due', 'third', '—', 'more({"n":2})']

describe('the projection', () => {
  it('reads fields, repeats, alternates and resolves messages, in declared order', () => {
    expect(
      project(
        baseSpec(),
        VIEW,
        harnessOf({ interactive: { text: [] }, inert: { text: [] } }).translate,
      ),
    ).toEqual(EXPECTED)
  })

  it('treats an empty string, a zero and a missing path as absent', () => {
    // One rule, four shapes. `when` is a path tested for truthiness precisely so that an empty caption, an
    // absent code, a zero count and a false flag do not each need their own predicate — and so that no
    // expression language is needed in data.
    const projected = project(
      baseSpec(),
      { ...VIEW, note: '', hidden: 0 },
      harnessOf({ interactive: { text: [] }, inert: { text: [] } }).translate,
    )
    expect(projected).not.toContain('more({"n":0})')
    expect(project(baseSpec(), { title: 'T', items: [] }, (k) => k)).toEqual(['T'])
  })

  it('includes a conditional slot once its gate is truthy', () => {
    expect(project(baseSpec(), { ...VIEW, note: 'qualified' }, (k) => k)).toContain('qualified')
  })

  it('fails loudly when the view model grows a variant the spec has never heard of', () => {
    // The alternative — skipping the unknown case — would let a whole readout vanish from the projection
    // while every suite stayed green, which is the failure this format exists to prevent.
    const view = { ...VIEW, items: [{ label: 'x', badge: { kind: 'sparkline' } }] }
    expect(() => project(baseSpec(), view, (k) => k)).toThrow(
      /no case for `badge.kind` = "sparkline"/,
    )
  })

  it('rejects a slot pointed at an object rather than at text', () => {
    const spec = baseSpec({ slots: [{ name: 'title', text: { field: 'items' } }] })
    expect(() => project(spec, VIEW, (k) => k)).toThrow(/is an object, not text/)
  })

  it('rejects a repeat over something that is not a list', () => {
    expect(() => project(baseSpec(), { ...VIEW, items: 'nope' }, (k) => k)).toThrow(/not an array/)
  })

  it('reads a dot path, and returns undefined rather than throwing on a dead one', () => {
    expect(read({ a: { b: 1 } }, 'a.b')).toBe(1)
    expect(read({ a: null }, 'a.b')).toBeUndefined()
    expect(read(undefined, 'a')).toBeUndefined()
  })
})

describe('the schema resolves the references a type cannot', () => {
  it('accepts a well-formed spec', () => {
    expect(parseComponentSpec(baseSpec()).component).toBe('Panel')
  })

  it('rejects a state enforced by a slot that does not exist', () => {
    // The rot this format is most exposed to: a slot is renamed, and the claim that something enforces a
    // state survives as a true-looking string.
    const spec = baseSpec()
    breakFailedEnforcement(spec)
    expect(() => parseComponentSpec(spec)).toThrow(/enforced by slot `moved`, which does not exist/)
  })

  it('rejects an interaction target that is not a slot', () => {
    const spec = baseSpec({ interactions: [{ target: 'ghost', goes: 'detail' }] })
    expect(() => parseComponentSpec(spec)).toThrow(/interaction target `ghost` is not a slot/)
  })

  it('rejects a conditional slot with no reason for being absent', () => {
    const spec = baseSpec({ slots: [{ name: 'title', text: { field: 'title' }, when: 'title' }] })
    expect(() => parseComponentSpec(spec)).toThrow(/is conditional .* but has no `why`/)
  })

  it('rejects an accessible name taken from a slot that does not exist', () => {
    const spec = baseSpec({
      a11y: { role: 'group', name: { fromSlot: 'ghost' }, reducedMotion: 'None.' },
    })
    expect(() => parseComponentSpec(spec)).toThrow(/a11y name comes from slot `ghost`/)
  })

  it('requires all five states, so one cannot be quietly skipped', () => {
    const spec = baseSpec()
    // The key genuinely absent, not set to undefined: `strictObject` treats those differently and the
    // shape a hand-written spec would have is the absent one.
    const states: Record<string, unknown> = { ...spec.states }
    delete states.offline
    expect(() => parseComponentSpec({ ...spec, states })).toThrow()
  })

  it('rejects a field it has never heard of, rather than ignoring it', () => {
    // `strictObject` throughout: a typo'd key is a silently unenforced clause otherwise.
    expect(() => parseComponentSpec({ ...baseSpec(), slotz: [] })).toThrow()
  })
})

describe('the conformance checks', () => {
  it('passes a renderer that draws exactly the projection', () => {
    expect(
      conform(
        baseSpec(),
        VIEW,
        harnessOf({ interactive: { text: EXPECTED }, inert: { text: EXPECTED } }),
      ),
    ).toEqual([])
  })

  it('names the first divergence, with whitespace visible', () => {
    const collapsed = EXPECTED.map((s) => (s === 'first' ? 'first ' : s))
    const findings = conform(
      baseSpec(),
      VIEW,
      harnessOf({ interactive: { text: collapsed }, inert: { text: collapsed } }),
    )
    expect(findings[0]?.check).toBe('slots')
    // Quoted, because a difference that is only whitespace is otherwise invisible in a failure message —
    // and the caption's two separator widths are exactly that kind of difference.
    expect(findings[0]?.message).toContain('"first "')
  })

  it('reports text the spec does not declare, and text it declares but nobody drew', () => {
    const extra = [...EXPECTED, 'invented']
    expect(
      conform(
        baseSpec(),
        VIEW,
        harnessOf({ interactive: { text: extra }, inert: { text: extra } }),
      )[0]?.message,
    ).toMatch(/rendered at index 9 what the spec does not declare/)
    const short = EXPECTED.slice(0, -1)
    expect(
      conform(
        baseSpec(),
        VIEW,
        harnessOf({ interactive: { text: short }, inert: { text: short } }),
      )[0]?.message,
    ).toMatch(/did not render at index 8 what the spec declares/)
  })

  it('catches a renderer whose text depends on whether it can be tapped', () => {
    // ADR-069's second finding as a universal law. Both card renderers guarded a count with
    // `&& onPress`, so a caller with nowhere to navigate was shown a truncated list and told nothing.
    const findings = conform(
      baseSpec(),
      VIEW,
      harnessOf({ interactive: { text: EXPECTED }, inert: { text: EXPECTED.slice(0, -1) } }),
    )
    expect(findings.map((f) => f.check)).toEqual(['content-not-affordance'])
  })

  it('catches a tap target nested inside another', () => {
    const findings = conform(
      baseSpec(),
      VIEW,
      harnessOf({ interactive: { text: EXPECTED, nested: 1 }, inert: { text: EXPECTED } }),
    )
    expect(findings.map((f) => f.check)).toEqual(['sibling-not-nested'])
  })

  it('reports a nesting check that had nothing to look at', () => {
    // The anti-vacuous control. A spec declaring interaction targets whose render produces no interactive
    // element means either the harness cannot see them or the renderer does not draw them — and a silent
    // pass would be indistinguishable from a component with correctly flat tap targets.
    const findings = conform(
      baseSpec(),
      VIEW,
      harnessOf({ interactive: { text: EXPECTED, interactive: 0 }, inert: { text: EXPECTED } }),
    )
    expect(findings[0]?.message).toMatch(/looked at nothing/)
  })

  it('re-validates the spec on every run', () => {
    // A driver reads committed JSON, so the cross-references are resolved here too rather than trusted
    // from emit time — a spec file edited by hand is exactly the case that needs it.
    const spec = baseSpec()
    breakFailedEnforcement(spec)
    expect(() =>
      conform(spec, VIEW, harnessOf({ interactive: { text: [] }, inert: { text: [] } })),
    ).toThrow()
  })
})

// ── the two extensions a SCREEN needed (WP6-2) ──────────────────────────────────────────────────
//
// A component's states are fields of one view model; a screen's are branches over an async status no view
// model carries. So a state may declare its own projection and the driver is asked to enter it — and a
// screen that lists a component must be able to *reference* that component's spec rather than restate it.

/** A screen: chrome that survives every branch, plus states that each add their own text. */
function screenSpec(overrides: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    ...baseSpec(),
    component: 'Board',
    doc: 'A titled board that lists panels.',
    slots: [{ name: 'heading', text: { message: 'boardTitle' } }],
    states: {
      loading: {
        must: 'A placeholder in the shape of the list.',
        mustNot: 'A blank area.',
        enforcement: { shows: [{ name: 'progress', text: { message: 'working' } }] },
      },
      empty: {
        must: 'An explicit line saying there is nothing.',
        mustNot: 'A heading alone.',
        enforcement: { shows: [{ name: 'none', text: { message: 'nothingHere' } }] },
      },
      failed: {
        must: 'The reason, verbatim.',
        mustNot: 'Reading as empty.',
        enforcement: { shows: [{ name: 'reason', text: { field: 'reason' } }] },
      },
      stale: {
        must: 'The entries, marked old.',
        mustNot: 'A fresh-looking value.',
        enforcement: {
          shows: [
            { name: 'agedNote', text: { message: 'olderThanItLooks' } },
            { name: 'entries', each: 'items', of: [{ name: 'entry', component: 'Chip' }] },
          ],
        },
      },
      offline: {
        must: 'The entries, marked old.',
        mustNot: 'A blank area.',
        enforcement: { unenforced: 'Indistinguishable from stale at this level.' },
      },
    },
    interactions: [{ target: 'heading', goes: 'detail' }],
    a11y: { role: 'region', name: { fromSlot: 'heading' }, reducedMotion: 'No cascade.' },
    ...overrides,
  }
}

/**
 * The thing a screen lists. Deliberately smaller than `Panel`: this fixture exists to test *composition*,
 * and a referenced spec with its own mandatory repeat would make the failures about that instead — which
 * is how the first draft of these two cases failed, on `Panel`'s `each: 'items'` finding no list on an
 * entry. A referenced spec is projected over the item as its whole scope, so the item must satisfy it.
 */
function chipSpec(): ComponentSpec {
  return {
    ...baseSpec(),
    component: 'Chip',
    doc: 'One labelled chip.',
    slots: [
      { name: 'chipLabel', text: { field: 'label' } },
      {
        name: 'chipNote',
        text: { field: 'note' },
        when: 'note',
        why: 'Most chips have nothing to add.',
      },
    ],
    interactions: [{ target: 'chipLabel', goes: 'detail' }],
    a11y: { role: 'button', name: { fromSlot: 'chipLabel' }, reducedMotion: 'None.' },
  }
}

const REGISTRY = { Chip: chipSpec() }
const translate = (key: string, args?: Record<string, unknown>) =>
  args ? `${key}(${JSON.stringify(args)})` : key

function statefulHarness(
  byState: Record<string, { view: unknown; text: string[]; nested?: number } | null>,
): StatefulHarness {
  return {
    render: () => ({ text: [], interactive: 1, nestedInteractive: 0 }),
    translate,
    renderState: (state) => {
      const fixture = byState[state]
      if (!fixture) return null
      return {
        view: fixture.view,
        tree: { text: fixture.text, interactive: 1, nestedInteractive: fixture.nested ?? 0 },
      }
    },
  }
}

describe('a state may declare its own projection', () => {
  it('expects the always-present chrome plus what the state adds, in that order', () => {
    expect(projectState(screenSpec(), 'empty', {}, translate)).toEqual([
      'boardTitle',
      'nothingHere',
    ])
  })

  it('returns null for a state whose enforcement is not a projection', () => {
    // `unenforced`, `knownDefect` and `by` are checked — or explicitly not — by the mechanism they name.
    expect(projectState(screenSpec(), 'offline', {}, translate)).toBeNull()
  })

  it('throws on a state nobody declared, rather than projecting nothing', () => {
    expect(() => projectState(screenSpec(), 'ghost', {}, translate)).toThrow(/no state `ghost`/)
  })

  it('holds a renderer to every projected state', () => {
    const harness = statefulHarness({
      loading: { view: {}, text: ['boardTitle', 'working'] },
      empty: { view: {}, text: ['boardTitle', 'nothingHere'] },
      failed: { view: { reason: 'upstream refused' }, text: ['boardTitle', 'upstream refused'] },
      stale: { view: { items: [] }, text: ['boardTitle', 'olderThanItLooks'] },
      offline: null,
    })
    expect(conformStates(screenSpec(), harness, REGISTRY)).toEqual([])
  })

  it('reports a state whose text diverges, naming the state', () => {
    const harness = statefulHarness({
      loading: { view: {}, text: ['boardTitle'] },
      empty: { view: {}, text: ['boardTitle', 'nothingHere'] },
      failed: { view: { reason: 'x' }, text: ['boardTitle', 'x'] },
      stale: { view: { items: [] }, text: ['boardTitle', 'olderThanItLooks'] },
    })
    const findings = conformStates(screenSpec(), harness, REGISTRY)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toMatch(/in `loading`: did not render at index 1/)
  })

  it('reports a projected state the renderer cannot be put into', () => {
    // A finding, not a skip. A declared projection nothing can render is the same vacuous pass as a gate
    // that matches no files — and the driver silently lacking a fixture is the likeliest cause.
    const harness = statefulHarness({
      loading: null,
      empty: { view: {}, text: ['boardTitle', 'nothingHere'] },
      failed: { view: { reason: 'x' }, text: ['boardTitle', 'x'] },
      stale: { view: { items: [] }, text: ['boardTitle', 'olderThanItLooks'] },
    })
    expect(conformStates(screenSpec(), harness, REGISTRY)[0]?.message).toMatch(
      /cannot be put into it/,
    )
  })

  it('reports a spec whose every state is unenforced, because it asserted nothing', () => {
    // The anti-vacuous control for this whole check.
    const findings = conformStates(baseSpec(), statefulHarness({}), REGISTRY)
    expect(findings[0]?.message).toMatch(/looked at nothing/)
  })
})

describe('composition: a screen references a component rather than restating it', () => {
  it('projects the referenced spec over each item, including its own conditionals', () => {
    const items = [{ label: 'first', note: 'and more' }, { label: 'second' }]
    // `Chip`'s own slots, once per item — and its conditional `chipNote` obeys its own `when`. A slot added
    // to Chip turns up here with no edit to the screen's spec, which is the whole point.
    expect(projectState(screenSpec(), 'stale', { items }, translate, REGISTRY)).toEqual([
      'boardTitle',
      'olderThanItLooks',
      'first',
      'and more',
      'second',
    ])
  })

  it('fails loudly when the referenced component is not in the registry', () => {
    expect(() =>
      projectState(screenSpec(), 'stale', { items: [{ label: 'x' }] }, translate, {}),
    ).toThrow(/references component `Chip`, which is not in the registry/)
  })
})
