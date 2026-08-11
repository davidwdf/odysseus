// **The staleness cue, measured** — the one property the conformance suites cannot see.
//
// WHAT THEY DO COVER, SO THIS FILE DOES NOT
// That a stale readout draws a `~` and a fresh one does not is `stop-row.spec.json`'s and
// `place-row.spec.json`'s, driven from both renderers by exact-equality projection. That is the *content*
// half and it is well held. This file is the *geometry* half, and the geometry is the whole design brief:
//
//   > "adding a `~` character before the times (but we may need to space the times just a little farther
//    apart because I don't want the symbol to shift them at all)"
//
// **The figure must not move by one pixel when the mark appears.** A number that jumps sideways as its
// board ages reads as a number that changed, which is the one thing ADR-008 forbids a stale readout from
// doing — and it is the thing nobody would file a bug about, because on any single screen you only ever see
// one of the two states.
//
// HOW YOU MEASURE THAT IN A RUNNER WITH NO LAYOUT ENGINE
// jsdom does not lay out: `getBoundingClientRect()` returns zeros, and `getComputedStyle` resolves nothing
// a Tailwind class would have set, because no stylesheet is compiled here. So a test asserting "the left
// edge is the same number" would be asserting `0 === 0` — the shape of vacuous pass this repo has shipped
// eight times.
//
// What *is* measurable is the arithmetic the layout is a consequence of, and it is measurable because the
// three numbers are **inline styles on the rendered nodes** rather than utility classes. That is why
// `EtaBadge` writes `style={{ paddingLeft }}` and `style={{ width, marginLeft }}` instead of
// `pl-3 / w-3 / -ml-3`: the identity `width + marginLeft === 0` is then a fact about the tree that came out
// of React, not a fact about a string in the source. Given that identity and an unconditional container
// padding, the figure's offset is `paddingLeft` in both states by CSS's own definition of a flex line — no
// browser needed to know it.
//
// Two things the arithmetic cannot see, and which are therefore asserted structurally beside it: that no
// `gap` is in play on the readout row (a gap applies *between* items, so it would reintroduce the shift the
// negative margin cancels — the trap `ArrivalSlot` fell into and why its `gap-1` became `ml-1` on the unit),
// and that the mark is **absent from the tree** when the reading is fresh rather than present-and-hidden.
// The second is the one that matters most: this repo's conformance walker reads text by presence, so an
// always-mounted `~` would have projected from every fresh readout in the app for ever and every state
// suite would still have passed, because they all mount settled. It has happened twice (the FAQ's collapsed
// `<details>`; `SlideNumber`'s invisible sizer copy, which made a mid-flight readout project "5112 min").
//
// AND ONE THING THAT IS NEITHER GEOMETRY NOR CONTENT
// The second-to-last `describe` is a **source** check, which is unusual here and earns its place: *which*
// readouts are marked is `etaCarriesStaleMark`, a corpus-pinned kernel rule, and it had been written out four
// times — two `marked()` helpers and two inline booleans across the two renderers' badges and rails. The
// projection suites cannot catch a copy that has gone stale, because each drives one renderer against the
// states that renderer's own spec declares: they would go red only for whichever copy was forgotten, in
// whichever suite happened to cover the arm. So the four call sites are asserted directly.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EtaLabelParts, RouteStopArrival, StopCardRow } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { ETA_STALE_GUTTER } from '@nextbus/ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { EtaBadge } from '../src/components/EtaBadge'
import { ArrivalSlot } from '../src/components/RouteStopRow'

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

function render(node: React.ReactNode): HTMLElement {
  root = createRoot(container)
  act(() => {
    root?.render(node)
  })
  return container
}

const MINS: EtaLabelParts = { kind: 'mins', value: 12, unit: 'min' }
const DUE: EtaLabelParts = { kind: 'due', label: 'Due' }
const DEPARTED: EtaLabelParts = { kind: 'departed' }

/** The mark, wherever it is in the tree. `role="img"` is how both renderers name a graphic. */
function mark(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="img"]')
}

/** Every text node, in order — the same reading the conformance suites take. */
function textOf(host: HTMLElement): string[] {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) out.push(value)
    node = walker.nextNode()
  }
  return out
}

/** The element the readout's own left padding sits on — the badge's or the slot's outer box. */
function readout(host: HTMLElement): HTMLElement {
  const el = host.firstElementChild
  if (!(el instanceof window.HTMLElement)) throw new Error('the readout did not render')
  return el
}

describe('the staleness mark does not move the figure', () => {
  for (const [name, label] of [
    ['a minutes readout', MINS],
    ['a "Due" readout', DUE],
  ] as const) {
    it(`reserves the same gutter fresh and stale — ${name}`, () => {
      const fresh = readout(render(<EtaBadge label={label} urgency="normal" stale={false} />))
      const freshPad = fresh.style.paddingLeft
      const stale = readout(render(<EtaBadge label={label} urgency="normal" stale />))

      // 1. The gutter exists at all, and it is the shared token rather than a number chosen here.
      expect(freshPad).toBe(`${ETA_STALE_GUTTER}px`)
      // 2. …and it is the *same* gutter in both states. This is the whole requirement: the figure's left
      //    edge is the container's border box plus this padding, in both renders.
      expect(stale.style.paddingLeft).toBe(freshPad)

      // 3. The mark contributes exactly nothing to the line, so nothing after it can be displaced. A flex
      //    item whose margin-left is the negative of its width occupies its box and advances the line by
      //    zero — the identity that makes (2) sufficient rather than merely necessary.
      const glyph = mark(stale)
      if (glyph === null) throw new Error('the stale render drew no mark')
      const width = Number.parseFloat(glyph.style.width)
      const marginLeft = Number.parseFloat(glyph.style.marginLeft)
      expect(width).toBe(ETA_STALE_GUTTER)
      expect(width + marginLeft, 'the mark advances the line, so the figure moves').toBe(0)

      // 4. No `gap` on the readout row. A gap applies *between* flex items and is not cancelled by a
      //    margin, so it would push the figure over by one gap the moment the mark mounted — invisible to
      //    (3), and exactly what `ArrivalSlot`'s `gap-1` used to do before the unit took an `ml-1` instead.
      expect(stale.className).not.toMatch(/(^|\s)gap(-[xy])?-/)
      expect(stale.style.gap).toBe('')
      expect(stale.style.columnGap).toBe('')

      // 5. Centred against the figure's line box, not sharing its baseline — a **cross-axis** choice, so it
      //    cannot move the figure, and the reason it is pinned here is that it came out of a real browser
      //    rather than a preference. A tilde is a mid-height glyph: baseline-aligned under a 22px figure it
      //    sits among the digits' feet and reads as a subscript. Reverting to the row's `items-baseline`
      //    would look almost right on the schematic's 12px slots and wrong on every card.
      expect(glyph.className).toContain('self-center')
    })
  }

  it('mounts the mark only when stale — never mounted and hidden', () => {
    // **The projection trap, asserted directly.** Reserving the gutter by rendering a `~` always and hiding
    // it when fresh would satisfy every geometric assertion above and would put the glyph into the text of
    // every fresh readout in the app, where the walker — which reads presence, not visibility — would find
    // it. No state suite would catch it: they all mount settled, so "fresh" is the state they compare.
    const fresh = render(<EtaBadge label={MINS} urgency="normal" stale={false} />)
    expect(mark(fresh)).toBeNull()
    expect(textOf(fresh)).toEqual(['12', 'min'])

    const stale = render(<EtaBadge label={MINS} urgency="normal" stale />)
    expect(textOf(stale)).toEqual(['~', '12', 'min'])
  })

  it('marks a figure and not a dash', () => {
    // `~ —` is a claim about nothing: the reading exists, it names a moment already past, and there is no
    // figure for "approximately" to qualify. Reachable rather than theoretical — `stop-detail.spec.json`
    // carries eight stale readings whose label is `departed`.
    const departed = render(<EtaBadge label={DEPARTED} urgency="none" stale />)
    expect(mark(departed)).toBeNull()
    expect(textOf(departed)).toEqual(['—'])
    // The gutter is still reserved, so a card's right-hand column does not step in and out row by row.
    expect(readout(departed).style.paddingLeft).toBe(`${ETA_STALE_GUTTER}px`)
  })

  it('is muted whatever the urgency colours the figure', () => {
    // The interaction worth checking by hand and worth pinning here: a "Due" figure is `text-positive`
    // (green), and a mark that inherited it would read as part of the figure rather than as an aside on it.
    // The mark says how old the reading is; the colour says how soon the bus is.
    const due = render(<EtaBadge label={DUE} urgency="due" stale />)
    const glyph = mark(due)
    expect(
      due.querySelector('.text-positive'),
      'the figure is not urgency-coloured here',
    ).not.toBeNull()
    expect(glyph?.className).toContain('text-muted')
    expect(glyph?.className).not.toContain('text-positive')
    // Never an opacity: the cue this replaced was `opacity-45` on the whole readout, and a fade that
    // survived alongside the mark would be the same unread cue with extra steps.
    expect(due.innerHTML).not.toContain('opacity-45')
  })

  it('names itself to a screen reader in the active locale', () => {
    // A bare `~` announces as "tilde" or as nothing. The treatment it replaces announced as nothing at all,
    // in every locale, so this is the first time the cue exists for a rider who cannot see it. The glyph is
    // a renderer literal (like the `→` before a destination) and its *name* is the catalogue's.
    const stale = render(<EtaBadge label={MINS} urgency="normal" stale />)
    expect(mark(stale)?.getAttribute('aria-label')).toBe(t('en', 'etaStaleMark'))
  })
})

describe('the schematic row carries the identical cue', () => {
  const arrival = (stale: boolean): RouteStopArrival => ({
    iso: '2026-08-11T10:00:00Z',
    label: { kind: 'mins', value: 7, unit: 'min' },
    urgency: 'normal',
    stale,
  })

  it('reserves the same gutter, from the same declaration', () => {
    // Two renderers of one cue in this app alone — the card's badge and the rail's slot — and they read the
    // gutter from `@nextbus/ui` rather than each writing 12. A second copy is how the RN row and the DOM row
    // came to disagree about the imminence band for months (ADR-053).
    const fresh = readout(render(<ArrivalSlot arrival={arrival(false)} first />))
    expect(fresh.style.paddingLeft).toBe(`${ETA_STALE_GUTTER}px`)
    expect(mark(fresh)).toBeNull()

    const stale = readout(render(<ArrivalSlot arrival={arrival(true)} first />))
    expect(stale.style.paddingLeft).toBe(`${ETA_STALE_GUTTER}px`)
    const glyph = mark(stale)
    if (glyph === null) throw new Error('the stale slot drew no mark')
    expect(
      Number.parseFloat(glyph.style.width) + Number.parseFloat(glyph.style.marginLeft),
      'the mark advances the line, so the time moves',
    ).toBe(0)
    // The gap that used to live here is the trap: `gap-1` between the figure and its unit would also apply
    // between the mark and the figure, and no margin cancels a gap.
    expect(stale.className).not.toMatch(/(^|\s)gap(-[xy])?-/)
  })

  it('reads "~ 7 min" and not "7 min" when the board has aged', () => {
    expect(textOf(render(<ArrivalSlot arrival={arrival(false)} first />))).toEqual(['7', 'min'])
    expect(textOf(render(<ArrivalSlot arrival={arrival(true)} first />))).toEqual(['~', '7', 'min'])
  })
})

/**
 * The repo root, found by walking up for `pnpm-workspace.yaml`.
 *
 * Neither obvious answer works, for the reasons `shell-parity.test.ts` records at length:
 * `import.meta.url` is an `http://localhost/…` URL under jsdom because vitest serves each module over
 * http, and a path relative to `process.cwd()` is right only when vitest is invoked from `apps/web`.
 */
function repoRoot(): string {
  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no pnpm-workspace.yaml above ${process.cwd()}`)
    dir = parent
  }
}

describe('one rule decides which readouts are marked, and all four renderers of it call it', () => {
  // **The guard for the defect this cue shipped with: the predicate was written out four times.** The
  // *geometry* was hoisted to `@nextbus/ui` at once, because the arithmetic identity was obviously one
  // number; the judgement was not, because each copy is a plausible-looking boolean over fields the
  // component legitimately has. `check-no-derivation` cannot see it for exactly that reason.
  //
  // Four sites, two apps, and the list is explicit rather than globbed: a glob that stopped matching is a
  // check looking at nothing, and this repo has shipped that shape eight times. When `apps/mobile` retires
  // (WP6-8) the two RN entries are deleted here in the same commit — a red build until someone does, which
  // is the correct amount of friction for removing a renderer.
  const SITES = [
    'apps/web/src/components/EtaBadge.tsx',
    'apps/web/src/components/RouteStopRow.tsx',
    'apps/mobile/components/EtaBadge.tsx',
    'apps/mobile/components/EtaTimes.tsx',
  ]

  const sources = SITES.map((path) => [path, readFileSync(join(repoRoot(), path), 'utf8')] as const)

  it('found all four sources', () => {
    // The anti-vacuous control: a moved or renamed component would otherwise make every assertion below
    // pass over a file that no longer draws a readout.
    expect(sources.length).toBe(4)
    for (const [path, source] of sources)
      expect(source.length, `${path} is empty`).toBeGreaterThan(0)
  })

  it('calls the kernel rule rather than re-deciding it', () => {
    for (const [path, source] of sources)
      expect(source, `${path} does not call etaCarriesStaleMark`).toContain('etaCarriesStaleMark(')
  })

  it('leaves the retired fade unapplied, and says so where a native porter reads', () => {
    // **The other half of "one cue".** `opacity.etaStale` (0.45) was the staleness treatment before the
    // mark, and it is still a token — emitted into `NextBusTokens.swift`/`.kt`, which is the contract a
    // hand-written iOS/Android client reads (ADR-067/075). `check-tokens-current` counts tokens; it cannot
    // see that one has no consumer. So a third renderer could read the token AND the spec's `~` and ship
    // both cues, or pick the one the owner rejected.
    //
    // Two assertions, because either alone is weak: that no renderer reads it (the fact), and that the
    // token's own description declares it retired (what carries the fact to the next reader, verbatim, in
    // the generated file they are looking at).
    //
    // The banned text is the token *reference*, `OPACITY.etaStale`, and not the string `opacity-45`: two of
    // these files name the retired class in prose, explaining why the mark replaced it, and a check that
    // cannot tell an explanation from an application would be answered by deleting the explanation. The
    // rendered half is asserted where it can be measured — see the `text-muted` case above, which reads the
    // emitted HTML.
    for (const [path, source] of sources)
      expect(source, `${path} reads the retired fade`).not.toContain('OPACITY.etaStale')
    const tokens = readFileSync(join(repoRoot(), 'packages/ui/tokens.json'), 'utf8')
    const described = JSON.parse(tokens).opacity?.etaStale?.$description
    expect(described, 'opacity.etaStale lost its description').toBeTypeOf('string')
    expect(described, 'the retired fade no longer declares itself retired').toContain('RETIRED')
  })

  it('spells the disjunction nowhere, so a fifth arm cannot be answered twice', () => {
    // The exact text each copy used: `stale && (label.kind === 'mins' || label.kind === 'due')`. Both arms
    // of that `||` are the rule, and a renderer that has them has an opinion the corpus cannot reach — so
    // what is banned is the *disjunction*, not a `kind === 'mins'` branch, which is every readout's honest
    // business (it decides what to draw, not whether it is old). Watched failing by restoring the boolean.
    for (const [path, source] of sources)
      expect(source, `${path} re-implements the rule`).not.toMatch(/kind === 'mins'\s*\|\|/)
  })
})

describe('the card row is the same component, so it cannot disagree', () => {
  // `StopCard` draws its readout through `EtaBadge`, and so does `PlaceRow`; the schematic draws its own
  // because a rail row is sized differently. Three call sites, two implementations, one gutter — and this is
  // the assertion that a row handed a stale kernel view actually reaches the marked path, rather than the
  // mark being something only a hand-built prop can produce.
  const row: StopCardRow = {
    routeId: 'KMB:6:outbound:1',
    operator: 'KMB',
    routeNo: '6',
    label: MINS,
    urgency: 'normal',
    stale: true,
  }

  it('draws the mark from the row the kernel built', () => {
    const host = render(<EtaBadge label={row.label} urgency={row.urgency} stale={row.stale} />)
    expect(textOf(host)).toEqual(['~', '12', 'min'])
  })
})
