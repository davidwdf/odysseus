// The DOM renderer's FAQ conformance suite: it drives the published spec (WP6-7, ADR-096) —
// `packages/contract/ui/faq.spec.json`, eight states, five of them projected.
//
// THE STATE THIS SCREEN EXISTS TO PROVE IS `allCollapsed`
// Every driver in this repo reads text with `createTreeWalker(host, NodeFilter.SHOW_TEXT)`, which consults
// the DOM and never CSS. So a collapsed `<details>`, a `hidden` node and a `display: none` node are all
// fully visible to it — which means **a disclosure that keeps its content mounted is indistinguishable,
// to every check in this repo, from one that shows everything.** `allCollapsed` is where that bites, and
// the `no answer is in the tree` block at the bottom asserts it as an element rather than as text, because
// "no answer" is precisely what a correct collapsed state and a broken projection have in common.
//
// It is ADR-093's finding from the opposite side: there the walker could not see a graphic a rider acts
// on; here it sees text a rider cannot.
//
// THE FIXTURES ARE THE CORPUS'S OWN `faqView` CASES, so this suite's goldens and the RN suite's are the
// same bytes — and the `text` fixture in the corpus is the identity, so a mis-paired question and answer
// is a diff there before it is a divergence here.

import faqSpec from '@nextbus/contract/ui/faq.spec.json'
import { FAQ_ENTRIES, faqView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/settings.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../src/providers/LocaleProvider'
import { Faq } from '../src/screens/Faq'

const LOCALE = 'en' as const

interface CorpusCase {
  name: string
  args: { expanded: string[] }
}

const CASES = corpus.groups.faqView.cases as unknown as CorpusCase[]

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the faqView corpus case \`${name}\` moved`)
  return found
}

/**
 * The corpus case each projected state is driven from.
 *
 * `loading` and `offline` share `allCollapsed`'s case deliberately: on a screen with no request, what
 * those two states *claim* is that they are indistinguishable from the ordinary one — the first frame is
 * already complete, and no network is involved. Sharing the fixture is the honest way to say so; what
 * differs is how the driver enters the state.
 */
const FIXTURE: Record<string, { case: string; offline?: boolean }> = {
  allCollapsed: { case: 'nothing-open-is-seven-questions-and-not-one-answer' },
  oneExpanded: { case: 'one-open-carries-its-own-answer-and-nobody-elses' },
  severalExpanded: {
    case: 'several-open-at-once-because-these-are-seven-questions-and-not-a-wizard',
  },
  loading: { case: 'nothing-open-is-seven-questions-and-not-one-answer' },
  offline: { case: 'nothing-open-is-seven-questions-and-not-one-answer', offline: true },
}

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const noise = new Set<string>([t(LOCALE, 'back')])
  const text: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value && !noise.has(value)) text.push(value)
    node = walker.nextNode()
  }
  const interactive = [...host.querySelectorAll(INTERACTIVE)]
  return {
    text,
    interactive: interactive.length,
    nestedInteractive: interactive.filter((el) => el.parentElement?.closest(INTERACTIVE)).length,
  }
}

function translate(key: string, args?: Record<string, unknown>): string {
  if (!(key in CATALOGUE)) {
    throw new Error(`the spec names message \`${key}\`, which is not in @nextbus/i18n's catalogue`)
  }
  const read = t as unknown as (
    l: typeof LOCALE,
    k: MessageKey,
    a?: Record<string, unknown>,
  ) => string
  return read(LOCALE, key as MessageKey, args)
}

/** Mount bare — no query client and no `DataSource`, which is what makes `loading` a real claim. */
function mount(): void {
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <LocaleProvider>
          <Faq />
        </LocaleProvider>
      </MemoryRouter>,
    )
  })
}

/** Open a question by pressing it, the way a rider does — the interaction is the only way in. */
function open(entryId: string): void {
  const entry = FAQ_ENTRIES.find((e) => e.id === entryId)
  if (!entry) throw new Error(`no FAQ entry \`${entryId}\``)
  const wanted = t(LOCALE, entry.questionKey as never) as string
  const button = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === wanted,
  )
  if (!button) throw new Error(`no question button reading \`${wanted}\``)
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function fixture(state: string): { view: unknown; tree: RenderedTree } | null {
  const wanted = FIXTURE[state]
  if (wanted === undefined) return null
  const c = caseNamed(wanted.case)
  if (wanted.offline) {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  }
  mount()
  // The expanded set is reached by *pressing*, never by seeding state: a spec cannot hold an interaction,
  // but the thing a rider is left looking at afterwards is exactly what it can hold (ADR-092).
  for (const id of c.args.expanded) open(id)
  return {
    view: faqView(c.args.expanded, (key) => t(LOCALE, key as never) as string),
    tree: readTree(container),
  }
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to the FAQ’s published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    expect(faqSpec.component).toBe('Faq')
    expect(Object.keys(faqSpec.states).length).toBeGreaterThanOrEqual(8)
    const projected = Object.entries(faqSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(5)
    for (const state of projected) {
      expect(FIXTURE[state], `${state} is projected and this driver cannot reach it`).toBeDefined()
    }
  })

  it('drives fixtures that are not degenerate — the control for a kernel regression', () => {
    // Both drivers compute their expectation by calling `faqView`, so a broken kernel moves the render and
    // the expectation *together* and both conformance suites stay green (ADR-084 divides it that way on
    // purpose, and WP6-4b measured that the gap is real). So the fixtures assert their own shape: the
    // three expansion states must actually differ in how many answers they carry, or `severalExpanded` is
    // decoration and the single-open accordion this spec exists to reject would pass.
    const opened = (state: string) => caseNamed(FIXTURE[state]?.case ?? '').args.expanded.length
    expect(opened('allCollapsed')).toBe(0)
    expect(opened('oneExpanded')).toBe(1)
    expect(opened('severalExpanded')).toBeGreaterThan(1)
  })

  for (const state of Object.keys(faqSpec.states)) {
    it(`in ${state}`, () => {
      const rendered = fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(faqSpec, harness).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }
})

describe('a collapsed answer is not in the tree, which no projection can assert for itself', () => {
  // **The load-bearing property, and the reason it needs its own block.** If a renderer mounted every
  // answer and hid it with CSS, the projection above would go red — but only because the *extra* text
  // appears, which is a symptom rather than the rule. These assert the rule as elements, so a future
  // renderer that adds a `hidden` attribute or an `sr-only` class fails here with the right message.

  it('renders no answer element at all until one is opened', () => {
    mount()
    expect(container.querySelectorAll('p').length).toBe(0)
    for (const entry of FAQ_ENTRIES) {
      expect(container.innerHTML, `${entry.id}: a collapsed answer is in the DOM`).not.toContain(
        t(LOCALE, entry.answerKey as never) as string,
      )
    }
  })

  it('uses buttons rather than <details>, so the tap targets are countable', () => {
    // The second, independent reason `<details>` is ruled out: `<summary>` matches none of the drivers'
    // interactive selectors, so the whole page would report zero tap targets and the sibling-not-nested
    // check would be looking at nothing.
    mount()
    expect(container.querySelectorAll('details').length).toBe(0)
    expect(readTree(container).interactive).toBeGreaterThanOrEqual(FAQ_ENTRIES.length)
    expect(readTree(container).nestedInteractive).toBe(0)
  })

  it('reports expandedness to assistive technology, which the projection also cannot see', () => {
    mount()
    const expanded = () =>
      [...container.querySelectorAll('button[aria-expanded]')].map((b) =>
        b.getAttribute('aria-expanded'),
      )
    expect(expanded().every((v) => v === 'false')).toBe(true)
    open('merge')
    expect(expanded().filter((v) => v === 'true')).toHaveLength(1)
  })

  it('closes only the question that was pressed again', () => {
    // Several-at-once is a decision, not an accident, and this is the assertion a single-open accordion
    // fails: opening two and closing one must leave the other open.
    mount()
    open('freshness')
    open('offline')
    expect(container.querySelectorAll('p')).toHaveLength(2)
    open('freshness')
    const remaining = [...container.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
    expect(remaining).toEqual([t(LOCALE, 'faqOfflineA') as string])
  })
})
