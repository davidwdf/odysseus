// The DOM renderer's conformance suite: **it drives `StopRow`'s published spec** (WP6-1, ADR-083).
//
// WHAT CHANGED, AND WHAT DID NOT
// This file used to carry a hand-written `expectedText(view)` — 20 lines listing which fields a card shows
// and in what order — deliberately duplicated in `apps/mobile/test/stoprow-projection.test.tsx`, with
// ADR-069 decision 7's reasoning that a shared helper would let one edit silently relax both renderers.
// That reasoning was right about **helpers**, and ADR-075 changes what is shared: the declaration is now
// `packages/contract/ui/stop-row.spec.json`, emitted from a typed source, validated by a schema and
// drift-gated. What each renderer still owns is everything below `harness` — how it builds a tree and
// reads text and roles back out of it — because that is where a renderer-specific mistake actually lives.
//
// WHY THE SPEC CANNOT QUIETLY BE WRONG
// The check is **exact equality**, so the spec is pinned from both sides: drop a slot and the renderers
// show text the projection does not; invent one and the projection expects text no renderer draws. Either
// way this suite and the RN one go red together. The residual blind spot is stated rather than hidden — a
// rule that *neither* renderer implements and the spec does not mention is invisible to all of this, and
// an independent third renderer (WP6-9) is the only thing that closes it.
//
// THE COMPONENT DID NOT CHANGE. WP6-1's acceptance is that the spec is retrofitted to the renderers as
// they already are; `src/components/StopCard.tsx` is untouched.

import spec from '@nextbus/contract/ui/stop-row.spec.json'
import type { Locale, StopCardView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { type ConformanceHarness, conform, type RenderedTree } from '@nextbus/ui-spec'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { StopCard } from '../src/components/StopCard'

const LOCALE: Locale = 'en'

/**
 * The corpus is imported statically — vite resolves JSON at build time — and the spec's own pointer at it
 * is then *asserted* rather than followed. A dynamic import driven by `spec.viewModel.corpus` would look
 * more principled and would break the moment the path moved, silently, in a suite that then had no cases.
 */
const cases: Array<{ name: string; expect: StopCardView }> = corpus.groups.stopCardView.cases.map(
  (c) => ({ name: c.name, expect: fromCorpus(c.expect) }),
)

/**
 * The corpus states an absent optional as JSON `null` (the convention in `packages/core/test/corpus.ts`);
 * TypeScript's absent value is `undefined`. A **conversion rather than a cast** on purpose: casting
 * compiled under TypeScript 5.9 and was rejected by 6.0, which is what surfaced the looseness. A reviver
 * returning `undefined` deletes the key, which is exactly what an optional wants.
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

/** Anything the DOM treats as a tap target. The RN suite's selector is different, which is the point. */
const INTERACTIVE = 'button, a[href], [role="button"]'

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
    // `closest` includes the element itself, so the walk up starts at the parent.
    nestedInteractive: interactive.filter((el) => el.parentElement?.closest(INTERACTIVE)).length,
  }
}

/**
 * The one cast in this file, and what replaces the type safety it gives up.
 *
 * A spec is data, so its message keys are strings — `t`'s by-name argument checking cannot reach them.
 * What stands in for it is stricter than it looks: the key's *existence* is asserted here (a clear failure
 * rather than the word "undefined" turning up in a diff), the arguments are declared in the spec and
 * validated at emit time, and the resulting text still has to match what the renderer drew.
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
      // The whole difference between the two renders: with handlers, and without. A card with nowhere to
      // navigate is not hypothetical — Nearby on this app is exactly that caller until WP6-2 wires the
      // taps, which is how ADR-069's overflow bug was found in the first place.
      root.render(
        <StopCard
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

describe('apps/web conforms to StopRow’s published spec', () => {
  it('has cases at all, and they are the ones the spec points at', () => {
    // The anti-vacuous control, in both directions: a corpus path resolving to an empty group would make
    // every assertion below pass by never running, and a spec pointing at a *different* corpus would mean
    // this suite proves nothing about the component the spec describes.
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

  it('renders a card with no rows and no caption without inventing either', () => {
    // Favourites' shape, and the state the spec declares as a `knownDefect`: a name with nothing under it
    // is what both renderers do today, and `states.empty.mustNot` says it should not be. Pinned here as
    // the *current* behaviour, so closing it (WP6-4) is a deliberate, visible change to both renderers.
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

  it('does not let the DOM collapse the caption’s deliberate double separator', () => {
    // The divergence this file found at WP4-1, and the one property the shared projection *cannot* check:
    // `textContent` reads the same either way, because collapsing is a layout behaviour. So the assertion
    // is on the class that prevents it — renderer-specific, which is why it lives here rather than in the
    // spec. The spec carries the *reason*, as `slots.caption.invariant`; this is its local enforcement.
    const view = cases.find((c) => c.expect.caption.includes('  ·  '))?.expect
    if (!view) throw new Error('no corpus case carries a two-part caption — the fixture set moved')
    harness.render(view, { interactive: true })
    const caption = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === view.caption,
    )
    expect(caption?.className).toContain('whitespace-pre-wrap')
  })

  it('is deterministic across renders', () => {
    // Cheap, and it catches the class of bug where a component reads a clock or a random value while
    // claiming to render a view — which would break byte-identity in a way no single render reveals.
    const view = cases[0]?.expect
    if (!view) throw new Error('unreachable: guarded by the control above')
    expect(harness.render(view, { interactive: true }).text).toEqual(
      harness.render(view, { interactive: true }).text,
    )
  })
})

// ── what this suite does and does not prove ────────────────────────────────────────────────────
//
// **Proved here:** the text is exactly the spec's projection, in order; it does not change when every
// handler is withheld; and no tap target is nested inside another. All three run over every corpus case,
// and the same three run against the React Native card in `apps/mobile/test/stoprow-projection.test.tsx`
// from the same spec file — so the two renderers are measured against one declaration rather than against
// two copies of one.
//
// **Not proved here, and each with an owner.** The `loading`, `stale` and `offline` states are declared
// `unenforced` in the spec because a card cannot show them alone — they belong to the screen, so WP6-2
// owns them. `empty` is a declared `knownDefect`: the sentence is the target and neither renderer meets it
// (WP6-4). And no suite in this repo renders the *native* iOS or Android tree; `react-native-web` is a real
// ship target but not that one, which is what WP6-9 is for.
