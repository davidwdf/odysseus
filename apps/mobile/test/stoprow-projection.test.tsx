// @vitest-environment jsdom
//
// The React Native card's conformance suite: **it drives the same published spec the DOM renderer does**
// (WP6-1, ADR-083) — `packages/contract/ui/stop-row.spec.json`, one file, two renderers.
//
// WHY THIS FILE EXISTS AT ALL
// It was built because ADR-069 recorded its absence as the wave's honest gap: `apps/web` had a projection
// suite and nothing proved the same of the React Native card, and the asymmetry pointed the wrong way —
// `apps/mobile` is the app riders use today. The hole was measured rather than assumed: deleting the
// `<Text>{view.caption}</Text>` line, so every card silently lost its compass direction and distance,
// passed `typecheck`, `lint` **and** all 686 tests.
//
// WHAT WP6-1 CHANGED HERE
// The 20-line `expectedText(view)` this file used to carry — a specification, written twice, once here and
// once in `apps/web` — is gone. The declaration is the spec; what stays local is `harness`: how a React
// Native tree is built and how text and tap targets are read back out of it. That split is ADR-069
// decision 7 applied where it belongs, and it is why the two selectors below differ from the DOM suite's —
// `react-native-web` renders a `Pressable` as a `div[role="button"]`, not a `<button>`.
//
// A cheaper gate was tried first and **did not work**: asserting that each field of `StopCardView` is
// *referenced* somewhere in the render path. It passed the deletion above, because the surviving guard
// `{view.caption ? (…)}` still references `caption`. "Referenced" is not "rendered", and the difference
// cannot be told textually. Only rendering the tree and reading it back closes it, which is what this does.
//
// **`react-native` is aliased to `react-native-web`** (see `../vitest.config.ts`): the renderer Expo
// already uses for the PWA, so this is a real ship target rather than a simulation. It does not cover
// iOS/Android *native* rendering — nor would `react-test-renderer` — and what it does cover is the failure
// that actually occurs, which is a component dropping or reordering a field.

import spec from '@nextbus/contract/ui/stop-row.spec.json'
import type { Locale, StopCardView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { type ConformanceHarness, conform, type RenderedTree } from '@nextbus/ui-spec'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { StopRow } from '../components/StopRow'

const LOCALE: Locale = 'en'

const cases: Array<{ name: string; expect: StopCardView }> = corpus.groups.stopCardView.cases.map(
  (c) => ({ name: c.name, expect: fromCorpus(c.expect) }),
)

/**
 * The corpus states an absent optional as JSON `null` (the convention in `packages/core/test/corpus.ts`);
 * TypeScript's absent value is `undefined`. A **conversion rather than a cast** on purpose: casting
 * compiled under TypeScript 5.9 and was rejected by 6.0, which is what surfaced the looseness.
 */
function fromCorpus(view: unknown): StopCardView {
  return JSON.parse(JSON.stringify(view), (_k, v) => (v === null ? undefined : v)) as StopCardView
}

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
})

/**
 * What React Native's renderer produces for a tap target.
 *
 * Deliberately **not** the DOM suite's selector: `Pressable accessibilityRole="button"` becomes a
 * `div[role="button"]` under `react-native-web`, where `apps/web` writes a real `<button>`. The two
 * renderers reach the same accessible role by different means, which is exactly the platform half of
 * ADR-075's line — and if this selector were ever wrong, the walker's own anti-vacuous control catches it:
 * a spec declaring interaction targets whose render produces no interactive element is a finding.
 */
const INTERACTIVE = '[role="button"], button, a[href]'

/** Visible text in document order, trimmed at the ends only — interior whitespace preserved, because the
 *  caption's two separator widths are meaningful and a normalising comparison cannot see them. */
function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const text: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) text.push(value)
    node = walker.nextNode()
  }
  const interactive = [...host.querySelectorAll(INTERACTIVE)]
  return {
    text,
    interactive: interactive.length,
    nestedInteractive: interactive.filter((el) => el.parentElement?.closest(INTERACTIVE)).length,
  }
}

/**
 * A spec is data, so its message keys are strings and `t`'s by-name argument checking cannot reach them.
 * The key's existence is asserted instead, so a spec naming a message the catalogue has never heard of
 * fails by name rather than by the word "undefined" appearing in a diff.
 */
function translate(key: string, args?: Record<string, unknown>): string {
  if (!(key in CATALOGUE)) {
    throw new Error(`the spec names message \`${key}\`, which is not in @nextbus/i18n's catalogue`)
  }
  const read = t as unknown as (
    locale: Locale,
    key: MessageKey,
    args?: Record<string, unknown>,
  ) => string
  return read(LOCALE, key as MessageKey, args)
}

const harness: ConformanceHarness = {
  render(view, { interactive }) {
    const root = createRoot(container)
    act(() => {
      root.render(
        <StopRow
          view={view as StopCardView}
          locale={LOCALE}
          onPress={interactive ? () => {} : undefined}
          onRoutePress={interactive ? () => {} : undefined}
        />,
      )
    })
    return readTree(container)
  },
  translate,
}

describe('apps/mobile conforms to StopRow’s published spec', () => {
  it('has cases at all, and they are the ones the spec points at', () => {
    // The anti-vacuous control, in both directions — a corpus group resolving to nothing, or a spec
    // pointing at a different corpus, would both make every assertion below pass by proving nothing.
    expect(cases.length).toBeGreaterThan(10)
    expect(spec.component).toBe('StopRow')
    expect(spec.viewModel.corpus).toBe('stop-card.spec.json')
    expect(spec.viewModel.group).toBe('stopCardView')
  })

  for (const c of cases) {
    it(c.name, () => {
      expect(conform(spec, c.expect, harness)).toEqual([])
    })
  }

  it('draws icons that contribute no text, which is what makes the lucide alias sound', () => {
    // `../vitest.config.ts` aliases `lucide-react-native` to `lucide-react` because the RN package cannot
    // be loaded outside Metro. That alias is only legitimate if icons carry no text — otherwise this whole
    // suite would be comparing against a different glyph set. So it is asserted rather than assumed, and it
    // is asserted *here* rather than in the spec: the spec says which concept each glyph denotes, and
    // "the icon set" is one of its declared `idiom` entries.
    const view: StopCardView = {
      stopId: 'P:X',
      name: { label: 'Somewhere' },
      caption: 'Northbound',
      bearingDeg: 0,
      rows: [],
      remaining: 0,
      incomplete: false,
    }
    expect(conform(spec, view, harness)).toEqual([])
    expect(readTree(container).text).toEqual(['Somewhere', 'Northbound'])
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('renders a card with no rows and no caption without inventing either', () => {
    // The `states.empty` `knownDefect`, pinned as current behaviour on this renderer too: a name with
    // nothing under it is what both draw today, and the spec says it should not be. Closing it (WP6-4) has
    // to change both, and this is what makes that visible rather than accidental.
    const view: StopCardView = {
      stopId: 'KMB:X',
      name: { label: 'Somewhere' },
      caption: '',
      rows: [],
      remaining: 0,
      incomplete: false,
    }
    expect(conform(spec, view, harness)).toEqual([])
    expect(readTree(container).text).toEqual(['Somewhere'])
  })
})
