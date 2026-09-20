// **The header taxonomy, enforced as far as a suite can see it** (ADR-169, `src/shell/headers.ts`).
//
// `docs/07` asked for header rules that were "written down and testable" and attached a warning to the
// request: ⚠️ **no suite in this repo can see a collapse** — jsdom has no `IntersectionObserver`, so
// `CollapsingHeader` never observes anything here and `RouteContextCard`'s width morph is a CSS transition
// nothing measures. That warning is honoured rather than worked around. What this file drives is the part
// of the taxonomy that survives into the DOM:
//
//   1. **Every declared destination declares a kind and a scroll owner**, and nothing declares one for a
//      destination that does not exist. This is the assertion that actually does the work — it is what
//      makes a ninth screen's chrome a decision somebody had to write down.
//   2. **A back control is present exactly where the kind says it is.** ADR-039 made it `fixed`, so
//      "reachable at any scroll offset" needs no scrolling to check: if it is in the document it is
//      reachable. Read by accessible name, because the control is icon-only (see `BackButton`'s note).
//   3. **The screen's root element matches its declared scroll owner.** A class-name assertion, which is
//      unusual here and is deliberate: jsdom loads no stylesheet, so `getComputedStyle` would report
//      nothing for a Tailwind utility. The class *is* the declaration on this renderer, and asserting it
//      catches the thing worth catching — a screen that quietly grows a second scroller.
//
// The route table is the real one, mounted under a memory router, for the reason
// `navigation-a11y.test.tsx` gives at length: a place and a route are unreachable from a networkless
// shell, because every control that leads to one is drawn from data.

import { t } from '@nextbus/i18n'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routes } from '../src/shell/App'
import { DESTINATIONS } from '../src/shell/destinations'
import {
  HEADER_KIND,
  HEADER_RULES,
  headerKindFor,
  SCROLL_OWNER,
  scrollOwnerFor,
} from '../src/shell/headers'

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

/** A concrete URL for a destination, since two of them are parameterised. */
function url(path: string): string {
  return path.replace(':id', encodeURIComponent('KMB:1:O:1'))
}

function mount(path: string): void {
  const router = createMemoryRouter(routes, { initialEntries: [url(path)] })
  root = createRoot(container)
  act(() => {
    root?.render(<RouterProvider router={router} />)
  })
}

/** The screen's own root element. Every screen renders exactly one. */
function main(): HTMLElement {
  const found = container.querySelector('main')
  if (!found) throw new Error('the screen rendered no <main>')
  return found as HTMLElement
}

describe('the declared set and the taxonomy agree', () => {
  it('gives every destination a header kind and a scroll owner', () => {
    const missing = DESTINATIONS.filter(
      (d) => headerKindFor(d) === undefined || scrollOwnerFor(d) === undefined,
    )
    expect(missing.map((d) => d.path)).toEqual([])
  })

  it('declares nothing for a destination that does not exist', () => {
    const paths = new Set(DESTINATIONS.map((d) => d.path))
    expect(Object.keys(HEADER_KIND).filter((p) => !paths.has(p))).toEqual([])
    expect(Object.keys(SCROLL_OWNER).filter((p) => !paths.has(p))).toEqual([])
  })

  // Not a tautology: it is what stops a kind being added to the type, used on a screen, and never given
  // the rule that says what it owes a rider.
  it('gives every kind in use a rule', () => {
    for (const d of DESTINATIONS) {
      const kind = headerKindFor(d)
      expect(kind && HEADER_RULES[kind], `no rule for \`${kind}\` (${d.path})`).toBeTruthy()
    }
  })
})

describe('what each screen actually renders', () => {
  for (const destination of DESTINATIONS) {
    const kind = headerKindFor(destination)
    const owner = scrollOwnerFor(destination)
    if (!kind || !owner) continue
    const rule = HEADER_RULES[kind]

    describe(`${destination.path} (${kind}, ${owner} scroll)`, () => {
      it(
        rule.back ? 'offers a way back' : 'offers no way back — it is switched to, not pushed',
        () => {
          mount(destination.path)
          const back = [...container.querySelectorAll('button')].filter(
            (b) => b.getAttribute('aria-label') === t('en', 'back'),
          )
          expect(back.length).toBe(rule.back ? 1 : 0)
        },
      )

      it(`hands the scroll to the ${owner}`, () => {
        mount(destination.path)
        const cls = main().className
        if (owner === 'page') {
          // The document is the scroller: the screen grows past the viewport and never caps itself.
          expect(cls, cls).toContain('min-h-dvh')
          expect(cls, cls).not.toContain('overflow-hidden')
        } else {
          // Viewport-height and clipped — whatever scrolls is a child.
          expect(cls, cls).toContain('overflow-hidden')
          expect(cls, cls).not.toContain('min-h-dvh')
        }
      })
    })
  }
})

// The honest half, asserted so it cannot rot into a claim: the taxonomy says in its own data which of its
// rules nothing checks, and `collapses` / `floats` are those rules. If someone later teaches a suite to see
// a collapse, this test fails and the wording has to be updated with it — which is the point.
describe('what is NOT enforced says so', () => {
  it('marks the two moving titles as unenforced', () => {
    for (const kind of ['collapsing', 'map'] as const) {
      expect(HEADER_RULES[kind].enforcement.toLowerCase()).toContain('unenforced')
    }
  })

  it('claims no enforcement it does not have for the static titles', () => {
    for (const kind of ['root', 'pushed'] as const) {
      expect(HEADER_RULES[kind].enforcement).toContain('header-taxonomy.test.tsx')
      expect(HEADER_RULES[kind].enforcement.toLowerCase()).not.toContain('unenforced')
    }
  })
})
