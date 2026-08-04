import { describe, expect, it } from 'vitest'
import {
  type ComponentSpec,
  type ConformanceHarness,
  conform,
  parseComponentSpec,
  project,
  read,
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
    spec.states.failed.enforcement = { by: 'moved' }
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
    spec.states.failed.enforcement = { by: 'moved' }
    expect(() =>
      conform(spec, VIEW, harnessOf({ interactive: { text: [] }, inert: { text: [] } })),
    ).toThrow()
  })
})
