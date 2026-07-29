// @vitest-environment jsdom
import type { StopCardView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { t } from '@nextbus/i18n'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { StopRow } from '../components/StopRow'

// The half of WP4-1's acceptance that ADR-069 recorded as **missing**, now built.
//
// `apps/web/test/nearby-projection.test.tsx` proved the DOM renderer is a faithful projection of the
// kernel view. Nothing proved the same of the React Native card, and the asymmetry pointed the wrong
// way: `apps/mobile` is the app riders use. The hole was measured rather than assumed — deleting the
// `<Text>{view.caption}</Text>` line, so every card silently lost its compass direction and distance,
// passed `typecheck`, `lint` **and** all 686 tests.
//
// A cheaper gate was tried first and **did not work**: asserting that each field of `StopCardView` is
// *referenced* somewhere in the render path. It passed the deletion above, because the surviving guard
// `{view.caption ? (…)}` still references `caption`. "Referenced" is not "rendered", and the difference
// cannot be told textually — `label.kind` is only ever compared, `stale` is only ever a condition. So
// the only thing that closes this is rendering the tree and reading it back, which is what this does.
//
// **`react-native` is aliased to `react-native-web`** (see `../vitest.config.ts`): the renderer Expo
// already uses for the PWA, so this is a real ship target rather than a simulation. It does not cover
// iOS/Android *native* rendering — nor would `react-test-renderer` — and what it does cover is the
// failure that actually occurs, which is a component dropping or reordering a field.

const cases: Array<{ name: string; expect: StopCardView }> = corpus.groups.stopCardView.cases.map(
  (c) => ({ name: c.name, expect: fromCorpus(c.expect) }),
)

/**
 * The corpus states an absent optional as JSON `null` (the convention in
 * `packages/core/test/corpus.ts`); TypeScript's absent value is `undefined`. This is the inverse of the
 * `nulled` projection the corpus was written with, and it is a **conversion rather than a cast** on
 * purpose: casting compiled under TypeScript 5.9 and was rejected by 6.0, which is what surfaced the
 * looseness. A reviver returning `undefined` deletes the key, which is exactly what an optional wants.
 */
function fromCorpus(view: unknown): StopCardView {
  return JSON.parse(JSON.stringify(view), (_k, v) => (v === null ? undefined : v)) as StopCardView
}

/**
 * Every string the card should show, in reading order — **byte-for-byte the same projection
 * `apps/web`'s suite uses.** Deliberately duplicated rather than shared: it is the *specification* each
 * renderer is measured against, and a shared helper would let one edit silently relax both. If the two
 * copies ever disagree, that is the signal, not the bug.
 */
function expectedText(view: StopCardView): string[] {
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
  if (view.remaining > 0) out.push(t('en', 'moreRoutes', { n: view.remaining }))
  return out
}

/** Visible text in document order, trimmed at the ends only — interior whitespace preserved, because
 *  the caption's two separator widths are meaningful and a normalising comparison cannot see them. */
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

function render(view: StopCardView, opts: { onPress?: () => void } = {}) {
  const root = createRoot(container)
  act(() => {
    root.render(<StopRow view={view} locale="en" onPress={opts.onPress} />)
  })
  return renderedText(container)
}

describe('apps/mobile renders the kernel view and adds nothing', () => {
  it('has cases at all', () => {
    // The anti-vacuous control: a corpus path resolving to an empty group would make every assertion
    // below pass by never running.
    expect(cases.length).toBeGreaterThan(10)
  })

  for (const c of cases) {
    it(c.name, () => {
      expect(render(c.expect, { onPress: () => {} })).toEqual(expectedText(c.expect))
    })
  }

  it('states the "+N more" count even when there is nowhere to tap', () => {
    // The RN half of the second bug WP4-1 found. Both components guarded the count with
    // `remaining > 0 && onPress`; every caller in this app passes `onPress`, which is exactly why it
    // went unnoticed here for months.
    const view = cases.find((c) => c.expect.remaining > 0)?.expect
    if (!view) throw new Error('no corpus case has hidden routes — the fixture set moved')
    expect(render(view)).toContain(t('en', 'moreRoutes', { n: view.remaining }))
  })

  it('draws icons that contribute no text, which is what makes the lucide alias sound', () => {
    // `../vitest.config.ts` aliases `lucide-react-native` to `lucide-react` because the RN package
    // cannot be loaded outside Metro. That alias is only legitimate if icons carry no text — otherwise
    // this whole suite would be comparing against a different glyph set. So it is asserted rather than
    // assumed: a card whose *only* content is a caption (hence a compass needle) plus a chevron must
    // produce exactly one text node.
    const view: StopCardView = {
      stopId: 'P:X',
      name: { label: 'Somewhere' },
      caption: 'Northbound',
      bearingDeg: 0,
      rows: [],
      remaining: 0,
    }
    expect(render(view, { onPress: () => {} })).toEqual(['Somewhere', 'Northbound'])
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('renders a card with no rows and no caption without inventing either', () => {
    expect(
      render({
        stopId: 'KMB:X',
        name: { label: 'Somewhere' },
        caption: '',
        rows: [],
        remaining: 0,
      }),
    ).toEqual(['Somewhere'])
  })
})
