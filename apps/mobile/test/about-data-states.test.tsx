// @vitest-environment jsdom
//
// The React Native "About the data" screen's conformance suite: **the same published spec the DOM screen
// drives** (WP6-7, ADR-096) — `packages/contract/ui/about-data.spec.json`, six states, three projected.
//
// THE INTERESTING STATE IS `loading`, AND IT IS A FULL PROJECTION
// The five canonical states were designed around a query and this screen has none, so the spec inverts the
// `slots`/`shows` split — the WHOLE screen is `slots` — and `loading` asserts that the first frame *is* the
// finished page. Kept honest structurally rather than by comment: this file mocks no `DataSource` and
// mounts the screen bare, so a fetch added to this screen breaks the driver.
//
// THE FIXTURES ARE THE CORPUS'S OWN `aboutView` CASES, one per locale — because the one real rule here is
// the portals' path slugs (`en`/`tc`/`sc`), and `en` is the case where the mapping is the identity and
// therefore proves nothing.

import aboutSpec from '@nextbus/contract/ui/about-data.spec.json'
import { ABOUT_SOURCES, aboutView, type Locale } from '@nextbus/core'
import corpus from '@nextbus/core/spec/settings.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const VERSION = '1.4.0'

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

const FIXTURE: Record<string, { case: string }> = {
  content: { case: 'english-links-to-the-english-terms' },
  loading: { case: 'traditional-chinese-links-to-the-tc-slug-not-zh-hant' },
  offline: { case: 'simplified-chinese-links-to-the-sc-slug' },
}

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

let activeLocale: Locale = 'en'
/** Every external hand-off this screen makes, recorded — see the URL block at the bottom. */
let opened: string[] = []

vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {}, back: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
vi.mock('expo-blur', async () => ({ BlurView: (await import('react-native')).View }))
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => activeLocale }))
// **The mock nothing in this repo had before**, and the one whose absence would have been silent: this is
// the only screen that reads `expo-constants`, and an unmocked `expo-modules-core` import dies at *import*
// — which vitest reports as a failed FILE rather than as failed tests, i.e. as nothing about the renderer.
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: VERSION } } }))
// The `LinkOpener`'s native side. Recorded rather than stubbed to nothing, because the URLs are the half of
// this screen a text projection cannot see and a credit whose link is wrong is a credit nobody can check.
vi.mock('../lib/openExternal', () => ({ openExternal: (url: string) => opened.push(url) }))

async function freshScreen(): Promise<ComponentType> {
  vi.resetModules()
  return (await import('../app/about-data')).default as ComponentType
}

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = '[role="button"], [role="link"], button, a[href]'

function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
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

async function mount(locale: Locale): Promise<RenderedTree> {
  activeLocale = locale
  const Screen = await freshScreen()
  root = createRoot(container)
  await act(async () => {
    root?.render(<Screen />)
  })
  return readTree(container)
}

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  const wanted = FIXTURE[state]
  if (wanted === undefined) return null
  const c = caseNamed(wanted.case)
  const tree = await mount(c.args.locale)
  return {
    view: aboutView(c.args.locale, {
      text: (key) => t(c.args.locale, key as never) as string,
      version: VERSION,
    }),
    tree,
  }
}

beforeEach(() => {
  activeLocale = 'en'
  opened = []
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to About the data’s published spec, state by state', () => {
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
    const covered = Object.values(FIXTURE).map((f) => caseNamed(f.case).args.locale)
    expect([...covered].sort()).toEqual(['en', 'zh-Hans', 'zh-Hant'])
  })

  for (const state of Object.keys(aboutSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
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

describe('the attribution is an obligation, so where each row goes is asserted too', () => {
  const press = (label: string) => {
    const row = [...container.querySelectorAll('[role="link"]')].find((el) =>
      (el.textContent ?? '').includes(label),
    )
    if (!row) throw new Error(`no link row containing \`${label}\``)
    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('hands off one external URL per source and per licence', async () => {
    await mount('en')
    // `role="link"` and not `role="button"`: the row *is* a link, which is what lets the DOM twin use a real
    // anchor. The count is asserted so a row that stopped being pressable is a failure rather than a silence.
    expect(container.querySelectorAll('[role="link"]')).toHaveLength(ABOUT_SOURCES.length + 2)
  })

  it('sends a Traditional Chinese reader to the tc terms, not to zh-hant', async () => {
    // The one rule on this screen a renderer could plausibly invent. A lower-cased locale lands on a 404,
    // in the one place the app sends a rider to read a licence, in the language most of them use.
    await mount('zh-Hant')
    press(t('zh-Hant', 'aboutTerms') as string)
    expect(opened).toEqual(['https://data.gov.hk/tc/terms-and-conditions'])
  })

  it('credits every operator the app ships', async () => {
    // The bug this row found, kept as a regression: `faqCoverageA` named green minibus and the Sources list
    // did not, so the app's own coverage answer contradicted its own attribution page.
    const text = (await mount('en')).text.join(' ')
    for (const key of ['aboutKmb', 'aboutCtb', 'aboutGmb', 'aboutLandsd', 'aboutHkbus'] as const) {
      expect(text, `${key} is not on the page`).toContain(t('en', key))
    }
  })
})
