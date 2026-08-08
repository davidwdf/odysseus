// The DOM renderer's "About the data" conformance suite: it drives the published spec (WP6-7, ADR-096) —
// `packages/contract/ui/about-data.spec.json`, six states, three of them projected.
//
// THE INTERESTING STATE IS `loading`, AND IT IS A FULL PROJECTION
// The five canonical states were designed around a query, and this screen has none. So the spec inverts
// the `slots`/`shows` split — the WHOLE screen is `slots` — and `loading` therefore asserts that the first
// frame *is* the finished page. The way that claim is kept honest is structural rather than textual:
// **this file imports no `QueryClientProvider` and no `dataSource`, and mounts the screen bare.** If this
// screen ever grows a fetch, the driver breaks rather than the assertion quietly weakening.
//
// THE FIXTURES ARE THE CORPUS'S OWN `aboutView` CASES, one per locale, so this suite's goldens and the RN
// suite's are the same bytes and the same kernel call — including the three portal slugs (`en`/`tc`/`sc`),
// which are the one real rule on this screen and the one a renderer could plausibly invent.

import aboutSpec from '@nextbus/contract/ui/about-data.spec.json'
import { ABOUT_SOURCES, aboutView, type Locale } from '@nextbus/core'
import corpus from '@nextbus/core/spec/settings.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferences } from '../src/lib/preferences'
import { LocaleProvider } from '../src/providers/LocaleProvider'
import { AboutData } from '../src/screens/AboutData'

interface CorpusCase {
  name: string
  args: { locale: Locale; version: string }
}

const CASES = corpus.groups.aboutView.cases as unknown as CorpusCase[]

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the aboutView corpus case \`${name}\` moved`)
  return found
}

/** The corpus case each projected state is driven from. Three states, three locales — deliberately. */
const FIXTURE: Record<string, { case: string; offline?: boolean }> = {
  content: { case: 'english-links-to-the-english-terms' },
  loading: { case: 'traditional-chinese-links-to-the-tc-slug-not-zh-hant' },
  offline: { case: 'simplified-chinese-links-to-the-sc-slug', offline: true },
}

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  // The back control's word is shell chrome rather than this screen's content, and every other screen
  // driver drops it the same way.
  const noise = new Set<string>([t('en', 'back'), t('zh-Hant', 'back'), t('zh-Hans', 'back')])
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

function translateIn(locale: Locale) {
  return (key: string, args?: Record<string, unknown>): string => {
    if (!(key in CATALOGUE)) {
      throw new Error(
        `the spec names message \`${key}\`, which is not in @nextbus/i18n's catalogue`,
      )
    }
    const read = t as unknown as (l: Locale, k: MessageKey, a?: Record<string, unknown>) => string
    return read(locale, key as MessageKey, args)
  }
}

/**
 * Mount the screen with **nothing around it but the router and the locale**.
 *
 * No `QueryClientProvider`. That is the assertion, not an omission: a screen that made a request would
 * throw here, so `loading` being a full projection is proved by construction rather than by a comment.
 */
function mount(): RenderedTree {
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <LocaleProvider>
          <AboutData />
        </LocaleProvider>
      </MemoryRouter>,
    )
  })
  return readTree(container)
}

function fixture(state: string): { view: unknown; tree: RenderedTree } | null {
  const wanted = FIXTURE[state]
  if (wanted === undefined) return null
  const c = caseNamed(wanted.case)
  if (wanted.offline) {
    // Nothing to disconnect — this screen makes no request — so "offline" is asserted the only way it
    // honestly can be: the browser reports itself offline and the page is byte-identical, links included.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  }
  usePreferences.setState({ localeOverride: c.args.locale })
  const view = aboutView(c.args.locale, {
    text: (key) => t(c.args.locale, key as never) as string,
    // The screen reads the build-time global; the expectation must read the same one, or this suite would
    // pin whatever the corpus happened to record and the two would agree only by luck.
    version: __APP_VERSION__,
  })
  return { view, tree: mount() }
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  usePreferences.setState({ localeOverride: null })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to About the data’s published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    expect(aboutSpec.component).toBe('AboutData')
    expect(Object.keys(aboutSpec.states).length).toBeGreaterThanOrEqual(6)
    const projected = Object.entries(aboutSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(3)
    for (const state of projected) {
      expect(FIXTURE[state], `${state} is projected and this driver cannot reach it`).toBeDefined()
    }
  })

  it('drives all three locales, so no slug is pinned by the one that is the identity', () => {
    // The coverage control WP6-3b's lesson demands: fixtures audited against branches, not merely written.
    // `en` maps to `en` in both portals' tables, so a driver that only rendered English would exercise the
    // mapping and prove nothing about it.
    const covered = Object.values(FIXTURE).map((f) => caseNamed(f.case).args.locale)
    expect([...covered].sort()).toEqual(['en', 'zh-Hans', 'zh-Hant'])
  })

  for (const state of Object.keys(aboutSpec.states)) {
    it(`in ${state}`, () => {
      const rendered = fixture(state)
      const named = FIXTURE[state]?.case
      const locale = named === undefined ? 'en' : caseNamed(named).args.locale
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate: translateIn(locale),
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(aboutSpec, harness).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }
})

describe('the attribution is an obligation, so the links themselves are asserted', () => {
  // The projection reads text and an `href` is an attribute, so none of the URLs below is visible to it —
  // and a credit whose link does not resolve is a credit a reader cannot check. Same division as Settings'
  // `selected`: the spec pins the words, the driver pins what the words point at.

  it('draws one real anchor per source and per licence, all external and safe', () => {
    usePreferences.setState({ localeOverride: 'en' })
    mount()
    const anchors = [...container.querySelectorAll('a[href^="https://"]')]
    expect(anchors).toHaveLength(ABOUT_SOURCES.length + 2)
    for (const a of anchors) {
      expect(a.getAttribute('target'), a.getAttribute('href') ?? '').toBe('_blank')
      // `packages/ports`' `LinkOpener` calls `noopener`/`noreferrer` non-negotiable — without it the
      // opened page can reach back through `window.opener`. An anchor is how this renderer satisfies it.
      expect(a.getAttribute('rel'), a.getAttribute('href') ?? '').toBe('noopener noreferrer')
    }
  })

  it('sends a Traditional Chinese reader to the tc terms, not to zh-hant', () => {
    // The one rule on this screen a renderer could plausibly invent, measured on the rendered DOM. A
    // lower-cased locale lands on a 404, in the one place the app sends a rider to read a licence, in the
    // language most of them use.
    usePreferences.setState({ localeOverride: 'zh-Hant' })
    mount()
    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('https://data.gov.hk/tc/terms-and-conditions')
    expect(hrefs.some((h) => h?.includes('zh-hant') || h?.includes('zh-Hant'))).toBe(false)
  })

  it('credits every operator the app ships', () => {
    // The bug this row found, kept as a regression: `faqCoverageA` named green minibus and the Sources
    // list did not, so the app's own coverage answer contradicted its own attribution page.
    usePreferences.setState({ localeOverride: 'en' })
    mount()
    const text = readTree(container).text.join(' ')
    for (const key of ['aboutKmb', 'aboutCtb', 'aboutGmb', 'aboutLandsd', 'aboutHkbus'] as const) {
      expect(text, `${key} is not on the page`).toContain(t('en', key))
    }
  })
})
