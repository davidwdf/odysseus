// @vitest-environment jsdom
//
// The React Native FAQ screen's conformance suite: **the same published spec the DOM screen drives**
// (WP6-7, ADR-096) — `packages/contract/ui/faq.spec.json`, eight states, five of them projected.
//
// THE STATE THIS SCREEN EXISTS TO PROVE IS `allCollapsed`
// A conformance projection reads text by *presence*, never by visibility: this driver's walker consults the
// DOM and never CSS, so a `hidden` node, a `display: none` node and a closed `<details>` are all fully
// visible to it. That is why a collapsed answer must be **absent from the tree** rather than merely off
// screen, why `faqView` models it as absent, and why the DOM twin cannot use `<details>`. This screen
// already rendered conditionally, so the RN side needed no change — but it is the side that proves the rule
// is satisfiable, which is what makes the DOM constraint a shared invariant rather than a web quirk.
//
// THE FIXTURES ARE THE CORPUS'S OWN `faqView` CASES, so this suite's goldens and the DOM suite's are the
// same bytes and the same kernel call.

import faqSpec from '@nextbus/contract/ui/faq.spec.json'
import { FAQ_ENTRIES, faqView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/settings.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const FIXTURE: Record<string, { case: string }> = {
  allCollapsed: { case: 'nothing-open-is-seven-questions-and-not-one-answer' },
  oneExpanded: { case: 'one-open-carries-its-own-answer-and-nobody-elses' },
  severalExpanded: {
    case: 'several-open-at-once-because-these-are-seven-questions-and-not-a-wizard',
  },
  // `loading` and `offline` share the collapsed case deliberately: on a screen with no request, what those
  // two states *claim* is that they are indistinguishable from the ordinary one.
  loading: { case: 'nothing-open-is-seven-questions-and-not-one-answer' },
  offline: { case: 'nothing-open-is-seven-questions-and-not-one-answer' },
}

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {}, back: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
vi.mock('expo-blur', async () => ({ BlurView: (await import('react-native')).View }))
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => LOCALE }))
// `LayoutAnimation` and `UIManager` come through `react-native-web` and are working no-ops there, so this
// screen needs neither the reanimated shim nor a mock for them — the only RN screen in the wave of which
// that is true.

async function freshScreen(): Promise<ComponentType> {
  vi.resetModules()
  return (await import('../app/faq')).default as ComponentType
}

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = '[role="button"], button, a[href]'

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

async function mount(): Promise<void> {
  const Screen = await freshScreen()
  root = createRoot(container)
  await act(async () => {
    root?.render(<Screen />)
  })
}

/** Open a question by pressing it, the way a rider does — the interaction is the only way in. */
function open(entryId: string): void {
  const entry = FAQ_ENTRIES.find((e) => e.id === entryId)
  if (!entry) throw new Error(`no FAQ entry \`${entryId}\``)
  const wanted = t(LOCALE, entry.questionKey as never) as string
  const row = [...container.querySelectorAll('[role="button"]')].find((el) =>
    (el.textContent ?? '').trim().startsWith(wanted),
  )
  if (!row) throw new Error(`no question row reading \`${wanted}\``)
  act(() => {
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  const wanted = FIXTURE[state]
  if (wanted === undefined) return null
  const c = caseNamed(wanted.case)
  await mount()
  // Reached by *pressing*, never by seeding state: a spec cannot hold an interaction, but the thing a rider
  // is left looking at afterwards is exactly what it can hold (ADR-092).
  for (const id of c.args.expanded) open(id)
  return {
    view: faqView(c.args.expanded, (key) => t(LOCALE, key as never) as string),
    tree: readTree(container),
  }
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to the FAQ’s published spec, state by state', () => {
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
    // the expectation together and both conformance suites stay green (ADR-084 divides it that way on
    // purpose, and WP6-4b measured that the gap is real). So the fixtures assert their own shape.
    const opened = (state: string) => caseNamed(FIXTURE[state]?.case ?? '').args.expanded.length
    expect(opened('allCollapsed')).toBe(0)
    expect(opened('oneExpanded')).toBe(1)
    expect(opened('severalExpanded')).toBeGreaterThan(1)
  })

  for (const state of Object.keys(faqSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
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

describe('a collapsed answer is not in the tree, and expandedness is announced', () => {
  it('renders no answer at all until one is opened', async () => {
    await mount()
    for (const entry of FAQ_ENTRIES) {
      expect(container.innerHTML, `${entry.id}: a collapsed answer is in the DOM`).not.toContain(
        t(LOCALE, entry.answerKey as never) as string,
      )
    }
  })

  it('reports expandedness to assistive technology, which the projection cannot see', async () => {
    // 🔴 **This assertion is a fix, not a check.** It was written against `accessibilityState={{ expanded }}`
    // and found nothing: `react-native-web@0.21` drops `accessibilityState` silently and forwards only the
    // modern `aria-*` props, so on the shipping Expo PWA a rider using a screen reader was told nothing
    // about whether a question was open. Six places in this app had the same shape; all are `aria-*` now.
    await mount()
    const expanded = () =>
      [...container.querySelectorAll('[aria-expanded]')].map((b) => b.getAttribute('aria-expanded'))
    expect(expanded()).toHaveLength(FAQ_ENTRIES.length)
    expect(expanded().every((v) => v === 'false')).toBe(true)
    open('merge')
    expect(expanded().filter((v) => v === 'true')).toHaveLength(1)
  })

  it('closes only the question that was pressed again', async () => {
    // Several-at-once is a decision, not an accident, and this is the assertion a single-open accordion
    // fails: opening two and closing one must leave the other open.
    await mount()
    open('freshness')
    open('offline')
    let text = readTree(container).text
    expect(text).toContain(t(LOCALE, 'faqFreshnessA') as string)
    expect(text).toContain(t(LOCALE, 'faqOfflineA') as string)
    open('freshness')
    text = readTree(container).text
    expect(text).not.toContain(t(LOCALE, 'faqFreshnessA') as string)
    expect(text).toContain(t(LOCALE, 'faqOfflineA') as string)
  })
})
