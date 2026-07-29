import type { Locale, StopCardView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { t } from '@nextbus/i18n'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { StopCard } from '../src/components/StopCard'

// WP4-1's acceptance, as close as this repo can honestly get to it — and the gap is stated at the
// bottom rather than papered over.
//
// THE CLAIM, IN THREE PARTS
//   1. Both renderers consume the identical `StopCardView`. Guaranteed by the type, and by
//      `scripts/check-no-derivation.mjs` — neither may compute one of its own.
//   2. The view is produced by one corpus-pinned kernel function
//      (`packages/core/spec/stop-card.spec.json`), so the *content* is byte-identical by construction:
//      there is one declaration, not two that agree.
//   3. **This file proves the third part: that the web renderer is a faithful projection of that view
//      — it adds no text of its own and drops none.** That is the half a type cannot check, and the
//      half where a renderer actually goes wrong.
//
// WHY THE CORPUS IS THE GOLDEN
// Every `expect` in the `stopCardView` group is a real view, derived from the real dataset build, and
// it is the *same* file a Swift or Kotlin conformance suite reads. Using it here rather than a fixture
// invented for this test means the golden cannot drift from what the kernel actually produces, and a
// rule change lands in one place and goes red in every suite at once.

const cases = corpus.groups.stopCardView.cases as Array<{ name: string; expect: StopCardView }>

/**
 * Every string the card is expected to show, in reading order.
 *
 * This is the one **presentational** declaration in the file: which fields are displayed and in what
 * order. It deliberately restates no *rule* — it never decides how many rows there are, what the
 * caption says, or which arrival is urgent; it only reads fields the kernel already filled in. So a
 * renderer that invents a string, drops one, or reorders them fails, while a rule change cannot make
 * this file wrong.
 */
function expectedText(view: StopCardView, locale: Locale): string[] {
  const out: string[] = [view.name.label]
  if (view.name.code) out.push(view.name.code)
  if (view.caption) out.push(view.caption)
  for (const row of view.rows) {
    out.push(row.routeNo)
    if (row.headline) out.push('→', row.headline)
    if (row.remark) out.push(row.remark.text)
    if (row.label.kind === 'mins') out.push(String(row.label.value), row.label.unit)
    else if (row.label.kind === 'due') out.push(row.label.label)
    else out.push('—')
  }
  // The count is the kernel's; the phrase and its plural rule are the ICU catalogue's (ADR-054).
  if (view.remaining > 0) out.push(t(locale, 'moreRoutes', { n: view.remaining }))
  return out
}

/**
 * The visible text of a rendered tree, in document order, with empty nodes dropped.
 *
 * **Trimmed at the ends only — interior whitespace is preserved verbatim.** The first cut collapsed
 * `\s+` to a single space, which quietly hid the one real divergence this file has found: the caption's
 * two separator widths are meaningful, and a normalising comparison cannot see the difference between
 * a renderer that keeps them and one that does not. A test that launders the thing it is checking is
 * worse than no test.
 */
function renderedText(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const text = (node.textContent ?? '').trim()
    if (text) out.push(text)
    node = walker.nextNode()
  }
  return out
}

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
})

function render(view: StopCardView, locale: Locale) {
  const root = createRoot(container)
  act(() => {
    root.render(<StopCard view={view} locale={locale} onPress={() => {}} />)
  })
  return renderedText(container)
}

describe('apps/web renders the kernel view and adds nothing', () => {
  it('has cases at all', () => {
    // The anti-vacuous control. A corpus path that resolved to an empty group would make every
    // assertion below pass by never running — the exact shape of the four gates Wave 3 found looking
    // at nothing.
    expect(cases.length).toBeGreaterThan(10)
  })

  for (const c of cases) {
    it(c.name, () => {
      // `en` for every row: the corpus states each view in the locale its own `args` used, and the
      // strings inside it are already localised by the kernel. The only locale-sensitive thing left is
      // the "+N more" phrase, and `moreRoutes` is asserted across locales in `@nextbus/i18n`'s suite.
      expect(render(c.expect, 'en')).toEqual(expectedText(c.expect, 'en'))
    })
  }

  it('renders a card with no rows and no caption without inventing either', () => {
    // Favourites' shape, and the one most likely to grow a stray element: an empty rows array plus an
    // empty caption should produce the name alone, not an empty caption line or a "+0 more".
    const view: StopCardView = {
      stopId: 'KMB:X',
      name: { label: 'Somewhere' },
      caption: '',
      rows: [],
      remaining: 0,
    }
    expect(render(view, 'en')).toEqual(['Somewhere'])
  })

  it('does not let the DOM collapse the caption’s deliberate double separator', () => {
    // The regression test for the divergence this file found. `stopCardCaption` uses `' · '` to bind a
    // distance to its walk time and a WIDER `'  ·  '` to separate that pair from the compass direction —
    // a rhythm, not a typo. HTML collapses consecutive whitespace by default, so the web card read
    // "Southwest-bound · 0m · 1 min walk" against React Native's "Southwest-bound  ·  0m · 1 min walk".
    // `textContent` cannot see the collapse (it is a layout behaviour), so the property is asserted
    // where it actually lives: the class on the element that holds the caption.
    const view = cases.find((c) => c.expect.caption.includes('  ·  '))?.expect
    if (!view) throw new Error('no corpus case carries a two-part caption — the fixture set moved')
    render(view, 'en')
    const caption = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === view.caption,
    )
    expect(caption?.className).toContain('whitespace-pre-wrap')
  })

  it('states the "+N more" count even when there is nowhere to tap', () => {
    // THE SECOND DIVERGENCE THIS FILE FOUND, and it needed a *second renderer* to surface rather than a
    // second test: both components guarded the count with `remaining > 0 && onPress`, so a caller with
    // no navigation target showed 6 of 26 routes and said nothing. Every caller in `apps/mobile` passes
    // `onPress`, which is why it went unnoticed; this app's single screen does not. Hiding an honest
    // total because the affordance is unavailable is the silent filter ADR-008 forbids.
    //
    // Note the assertion renders WITHOUT `onPress` — the tests above all pass one, so they cannot see
    // this path at all. A test that only exercises the configured case is how the bug survived.
    const view = cases.find((c) => c.expect.remaining > 0)?.expect
    if (!view) throw new Error('no corpus case has hidden routes — the fixture set moved')
    const root = createRoot(container)
    act(() => {
      root.render(<StopCard view={view} locale="en" />)
    })
    expect(renderedText(container)).toContain(t('en', 'moreRoutes', { n: view.remaining }))
  })

  it('is deterministic across renders', () => {
    // Cheap, and it catches the class of bug where a component reads a clock or a random value while
    // claiming to render a view — which would break byte-identity in a way no single render reveals.
    const view = cases[0]?.expect
    if (!view) throw new Error('unreachable: guarded by the control above')
    expect(render(view, 'en')).toEqual(render(view, 'en'))
  })
})

// ── the honest gap ─────────────────────────────────────────────────────────────────────────────
//
// **The React Native half of this comparison is not machine-checked, and nothing here should be read
// as claiming otherwise.** `apps/mobile` has vitest but no React renderer: asserting the same property
// there needs `react-test-renderer` (or @testing-library/react-native) plus a jsdom-free setup for
// Reanimated, NativeWind and `react-native-svg` — a real piece of work with its own failure modes, and
// it would have doubled this package.
//
// So the current guarantee is: **one declaration of the content (the kernel + its corpus), a gate that
// stops either renderer deriving its own, and a projection test on one of the two.** What is missing is
// the symmetric projection test on the RN side. Until it exists, an RN-only rendering mistake — a
// dropped field, a duplicated remark — would be caught by review and by the eye, not by CI. That is a
// narrower gap than it sounds (the content cannot differ; only its presentation can) but it is the
// difference between "byte-identical" as measured and as argued, and WP4-1's row says measured.
