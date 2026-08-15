// Which semantic token a *string* may be drawn in — the rule behind the three-token change in
// `src/screens/Search.tsx` (the recents heading, the clear-recents control, the inactive segment label).
//
// WHY THIS IS A TEST AND NOT A COMMENT
// The port dropped those three from `--text-muted` to `--text-subtle`, which the RN screen has never used
// for them. Nothing caught it: `conformStates` reads *words*, and a colour is not a word — the same blind
// spot ADR-098 names for interaction destinations and ADR-106 for the scroll-spy's geometry. A contrast
// ratio, unlike a screenshot, is arithmetic over values this repo already publishes, so it can be asserted.
//
// WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
// It asserts the **classification** of each text token — which surfaces it may carry body prose on — from
// `@nextbus/ui`'s emitted values, in both modes. It does not assert a token's value: the numbers are the
// owner's decision (docs/09), and this file is what tells them what a change to one would cost.
//
// The measured table today, WCAG 2.2 contrast against the three surfaces:
//
//                  light: --bg   --surface  --surface-2      dark: --bg   --surface  --surface-2
//   --text               17.74     16.96       16.19              17.42     15.87       13.94
//   --text-muted          7.58      7.24        6.92               7.63      6.95        6.10
//   --text-subtle         4.76      4.55        4.34 ✗             3.90 ✗     3.55 ✗      3.12 ✗
//
// So `--text-subtle` is a **large-text and non-text token**, not a body one — it clears 3:1 everywhere and
// 4.5:1 almost nowhere. Search's three strings are 14 px (`text-label`), so they owe 4.5:1 and now get it.
// That conclusion is wider than this screen: `--text-subtle` carries 14 px prose on Place detail, Settings,
// About the data and Route detail too, and each of those is in `docs/07` rather than fixed here, because a
// screen at a time is how the RN original is checked for what it actually uses.

// IT ALSO MEASURES THE OPERATOR CHIPS, for the same reason one layer over.
// `RouteChip` is the one sanctioned use of an operator accent as a *background* (docs/09 §2), so its two
// colours are a **pair** and only their ratio matters. That pairing lived as prose in `tokens.json` — "the
// yellow CTB accent always pairs with dark text" — and LWB's gold was left on white anyway, at **2.16:1**,
// on every KMB-adjacent Long Win row in the app since Wave 1. Nobody caught it because a chip is a colour
// and, again, a colour is not a word. Reported by the owner looking at the lab's livery sweep, which is the
// first thing in this repo to draw all four side by side.

import type { OperatorAccent, ThemeMode } from '@nextbus/ui'
import { OPERATOR_ACCENT, OPERATOR_ACCENT_TEXT, SEMANTIC_TOKENS, THEME_VARS } from '@nextbus/ui'
import { describe, expect, it } from 'vitest'

const MODES: ThemeMode[] = ['light', 'dark']
/** Every surface a string is drawn on in this app. `--border` is a line, never a background for text. */
const SURFACES = ['--bg', '--surface', '--surface-2'] as const

/**
 * The two thresholds, from WCAG 2.2 §1.4.3 and §1.4.11. 4.5:1 is body text; 3:1 is text at 24 px, or at
 * 18.66 px bold, and any meaningful non-text mark (an icon, a chevron, a rule).
 */
const AA_BODY = 4.5
const AA_LARGE = 3

/** Prose tokens that may carry any size of text, and the one that may not. Every `--text*` token is in
 *  exactly one list — the control below is what makes a new token a failing test rather than an omission. */
const BODY_SAFE = ['--text', '--text-muted'] as const
const LARGE_OR_NON_TEXT_ONLY = ['--text-subtle'] as const

function rgb(mode: ThemeMode, token: string): [number, number, number] {
  const value = THEME_VARS[mode][token as `--${string}`]
  if (value === undefined) throw new Error(`@nextbus/ui publishes no \`${token}\` in ${mode} mode`)
  const parts = value.split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`\`${token}\` is \`${value}\`, which is not the "R G B" triplet this reads`)
  }
  return parts as [number, number, number]
}

/** WCAG 2.2's relative luminance — the sRGB transfer function, then the luma weights. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (raw: number) => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(mode: ThemeMode, fg: string, bg: string): number {
  const a = luminance(rgb(mode, fg))
  const b = luminance(rgb(mode, bg))
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const at = (mode: ThemeMode, fg: string, bg: string) =>
  `${fg} on ${bg} in ${mode} mode is ${contrast(mode, fg, bg).toFixed(2)}:1`

describe('the tokens a string may be drawn in', () => {
  it('classifies every text token, so a new one cannot arrive unmeasured', () => {
    // The anti-vacuous control. Without it, adding `--text-faint` and using it for a heading would leave
    // every assertion below green while saying nothing about the new token.
    const declared = SEMANTIC_TOKENS.filter((token) => token.startsWith('--text')).sort()
    const classified = [...BODY_SAFE, ...LARGE_OR_NON_TEXT_ONLY].sort()
    expect(declared, 'a text token is in neither list — measure it and classify it').toEqual(
      classified,
    )
  })

  it('clears AA body contrast on every surface, in both modes, for every body-safe token', () => {
    // This is the claim `src/screens/Search.tsx` leans on: `text-muted` is safe for a 14 px string
    // wherever it is put. If it ever stops being true the three strings there need a different answer,
    // not a quieter one.
    for (const mode of MODES) {
      for (const token of BODY_SAFE) {
        for (const surface of SURFACES) {
          expect(contrast(mode, token, surface), at(mode, token, surface)).toBeGreaterThanOrEqual(
            AA_BODY,
          )
        }
      }
    }
  })

  it('keeps `--text-subtle` off body prose, because it fails AA at body size', () => {
    // **A tripwire, deliberately.** It asserts the *reason* the ban exists, so raising the token's value
    // turns this red rather than leaving a rule nobody can justify: if that happens, the owner has made a
    // design decision this file should record by moving `--text-subtle` into `BODY_SAFE`, and Search,
    // Place detail, Settings, About the data and Route detail can stop worrying about it.
    const failures = MODES.flatMap((mode) =>
      SURFACES.filter((surface) => contrast(mode, '--text-subtle', surface) < AA_BODY).map(
        (surface) => at(mode, '--text-subtle', surface),
      ),
    )
    expect(
      failures.length,
      '`--text-subtle` now clears 4.5:1 everywhere — retire this rule rather than working around it',
    ).toBeGreaterThan(0)
    // The dark mode readings are the ones docs/07 quotes, and the reason this was worth fixing: a rider
    // in the dark loses these strings entirely, on the screen they arrive at to type.
    expect(contrast('dark', '--text-subtle', '--bg')).toBeLessThan(AA_BODY)
    expect(contrast('dark', '--text-subtle', '--surface-2')).toBeLessThan(AA_BODY)
  })

  it('leaves `--text-subtle` usable for the icons and large text it is for', () => {
    // The other half of the classification, and the reason this is not a demand to delete the token: the
    // field glyphs, the chevrons and the `→` on a Search result row are non-text marks owing 3:1, and it
    // clears that everywhere. A rule that banned it outright would be wrong and would be ignored.
    for (const mode of MODES) {
      for (const surface of SURFACES) {
        expect(
          contrast(mode, '--text-subtle', surface),
          at(mode, '--text-subtle', surface),
        ).toBeGreaterThanOrEqual(AA_LARGE)
      }
    }
  })
})

/** `#RRGGBB` — the form the operator tables publish, where the theme vars are `"R G B"` triplets. */
function hex(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  if (!match) throw new Error(`\`${value}\` is not the #RRGGBB this reads`)
  return [
    Number.parseInt(match[1] as string, 16),
    Number.parseInt(match[2] as string, 16),
    Number.parseInt(match[3] as string, 16),
  ]
}

function pairContrast(operator: OperatorAccent): number {
  const a = luminance(hex(OPERATOR_ACCENT_TEXT[operator]))
  const b = luminance(hex(OPERATOR_ACCENT[operator]))
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the operator chip’s two colours are a pair', () => {
  const operators = Object.keys(OPERATOR_ACCENT) as OperatorAccent[]

  it('measures every operator, so a fifth cannot arrive unmeasured', () => {
    // The anti-vacuous control, and it is not hypothetical: `searchView` derives its operator chips from
    // the dataset index precisely so that a new operator lights up the day its adapter lands (ADR-037).
    // The colours are the one part of that which is NOT automatic, and this is what will say so.
    expect(operators.length, 'no operator liveries published').toBeGreaterThan(1)
    for (const operator of operators) {
      expect(
        OPERATOR_ACCENT_TEXT[operator],
        `${operator} has an accent and no text colour`,
      ).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('clears AA body contrast for every livery', () => {
    // **`AA_BODY`, not `AA_LARGE`.** A route number is `text-label` — 14 px — and bold, which is two
    // points short of the 18.66 px that would buy the 3:1 threshold. It is also the single most
    // information-dense string in the app: a rider scanning a column of chips for "969C" is reading, not
    // glancing.
    //
    // The readings this passes on today:
    //   KMB #D7282F on white 4.96 · LWB #E8A33D on ink 8.28 · CTB #F6C700 on ink 11.13 · GMB #00845C on white 4.71
    //
    // GMB is the tight one at 4.71:1 and KMB is next at 4.96:1 — both within a nudge of failing, which is
    // worth knowing before anyone lightens that red or that green.
    for (const operator of operators) {
      expect(
        pairContrast(operator),
        `${operator}: ${OPERATOR_ACCENT_TEXT[operator]} on ${OPERATOR_ACCENT[operator]} is ${pairContrast(operator).toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_BODY)
    }
  })

  it('would have failed on the white LWB text it shipped with', () => {
    // The control that proves the assertion above can fail — an injected defect, kept rather than run once
    // and deleted, because "every livery passes" is only reassuring if the check can tell.
    const white = luminance([255, 255, 255])
    const gold = luminance(hex(OPERATOR_ACCENT.LWB))
    expect((white + 0.05) / (gold + 0.05)).toBeLessThan(AA_BODY)
  })
})
