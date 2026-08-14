// The gate on the gallery's **live samples** (ADR-150, paying ADR-134's *"still owed"*).
//
// WHY A SAMPLE NEEDS A GATE AT ALL. The listing half of the gallery cannot go stale — it is printed from the
// published specs. The samples can, in a way that is silent in exactly the wrong place: they name corpus
// cases, and a renamed case throws only when somebody happens to open the page. Nobody opens a lab page on a
// Tuesday to check it still renders. So every sample is rendered here, in the same jsdom the conformance
// suites use, and a case that moved is a red build the day it moves.
//
// WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT. It asserts that each sample draws *something*, that the
// four `feedNotice` arms draw the four catalogue sentences (and that the silent one draws nothing at all),
// and that the state names are unique inside a group so two panels cannot claim the same label. It does NOT
// re-assert the components' text against their specs — `conformStates` and the projection suites already do
// that against the same corpus, and a second golden here would be a second specification.

import type { Locale } from '@nextbus/core'
import { CATALOGUE, t } from '@nextbus/i18n'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { SAMPLES } from '../lab/samples'

const LOCALE: Locale = 'en'

let container: HTMLElement
let root: Root | null = null

function text(): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) out.push(value)
    node = walker.nextNode()
  }
  return out
}

function draw(node: React.ReactNode): string[] {
  root = createRoot(container)
  act(() => {
    root?.render(node)
  })
  return text()
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('the gallery’s live samples', () => {
  it('names groups and states that a reviewer can refer to unambiguously', () => {
    // The anti-vacuous control: an empty `SAMPLES`, or a group whose panels shared a label, would make the
    // loop below assert nothing useful while the page still looked full.
    expect(SAMPLES.length).toBeGreaterThanOrEqual(3)
    for (const group of SAMPLES) {
      expect(group.samples.length, `${group.component} has nothing to compare`).toBeGreaterThan(1)
      const names = group.samples.map((s) => s.state)
      expect(new Set(names).size, `${group.component} labels two panels the same`).toBe(
        names.length,
      )
      for (const sample of group.samples) {
        expect(
          sample.how.length,
          `${group.component}/${sample.state} says nothing about how`,
        ).toBeGreaterThan(20)
      }
    }
  })

  // One `it` per sample, so a corpus case that moved names the panel it broke rather than the file.
  for (const group of SAMPLES) {
    for (const sample of group.samples) {
      it(`renders ${group.component} · ${sample.state}`, () => {
        const shown = draw(sample.render())
        // `none` is the one sample whose correct output is nothing — asserted as such rather than skipped,
        // because "renders nothing" and "failed to render" look identical on the page and a silent notice is
        // the state the app is in almost all of the time.
        if (sample.state.startsWith('none')) expect(shown).toEqual([])
        else expect(shown.length, 'the panel drew nothing at all').toBeGreaterThan(0)
      })
    }
  }

  it('covers every arm of the feed notice, with the catalogue’s own words', () => {
    const group = SAMPLES.find((g) => g.component === 'FeedNotice')
    if (!group) throw new Error('the FeedNotice sample group is gone')
    const drawn = group.samples.map((sample) => ({
      state: sample.state,
      text: draw(sample.render()),
    }))
    // The sentences come from `@nextbus/i18n`, each drawn by exactly one panel — a sample that hard-coded
    // the English would keep passing while the catalogue moved, which is the drift this page exists to
    // prevent, and two panels sharing a sentence would mean the precedence had collapsed.
    for (const [key, sentence] of [
      ['feedOffline', t(LOCALE, 'feedOffline')],
      ['feedUnreachable', t(LOCALE, 'feedUnreachable')],
    ] as const) {
      expect(key in CATALOGUE).toBe(true)
      const matches = drawn.filter((d) => d.text.includes(sentence))
      expect(matches.length, `${key} is drawn by ${matches.length} panel(s), not 1`).toBe(1)
    }
    const lastUpdated = drawn.find((d) => d.state === 'lastUpdated')
    expect(lastUpdated?.text[0]).toMatch(/^Last updated \d\d:\d\d$/)
    // And the silent arm, which is the one a reviewer most needs to see is deliberate.
    expect(drawn.find((d) => d.state.startsWith('none'))?.text).toEqual([])
  })
})
