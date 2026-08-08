// @vitest-environment jsdom
//
// The React Native Settings screen's conformance suite: **the same published spec the DOM screen drives**
// (WP6-7, ADR-096) — `packages/contract/ui/settings.spec.json`, seven states, three of them projected.
//
// WHAT IS DIFFERENT ABOUT THIS SCREEN
// Nothing on it fetches, so the five canonical states are not branches over an async status. The spec
// inverts the usual `slots`/`shows` split — the WHOLE screen is `slots` — which is what makes `content`
// and `offline` real assertions and what makes a renderer that filled a section in an effect diverge at
// index 0 rather than pass.
//
// THE PROJECTION CANNOT SEE THE SELECTION, WHICH IS THE WHOLE POINT OF THIS SCREEN
// "Chosen" is a dot here and a filled pill on the web — no text either way. So the last block asserts the
// announced state directly against the kernel's own answer, exactly as `search.spec.json` says the suites
// must for a keypad key's `enabled`. Without it the run above would pass with nothing selected.
//
// 🔴 AND WRITING THAT BLOCK FOUND A LIVE DEFECT ON THE SHIPPING PWA. It was written against
// `accessibilityState={{ selected }}`, which is what this screen (and five other places in this app) used,
// and it found nothing at all: **`react-native-web@0.21` forwards the modern `aria-*` props and drops
// `accessibilityState` silently**, with no warning and no fallback. So on the Expo PWA the language and
// appearance pickers announced no state to a screen reader — the selection was a dot and a font weight —
// and so did the search chips, the search segment and the save star. Measured, not reasoned: a probe
// rendered a `Pressable` with each prop and read the emitted attributes back. All six are `aria-*` now,
// which maps to `accessibilityState` on native and is what the DOM twins already write.
//
// THE SEAMS ARE MOCKED; THE SCREEN AND THE KERNEL CALL ARE REAL. The locale provider is replaced because
// it reaches `expo-localization`, and the preferences store is *not* — what a rider chose is this screen's
// input, so a mock of it would be a mock of the thing under test.

import settingsSpec from '@nextbus/contract/ui/settings.spec.json'
import { type Locale, settingsView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/settings.spec.json'
import { CATALOGUE, endonym, type MessageKey, SUPPORTED_LOCALES, t } from '@nextbus/i18n'
import { APPEARANCES, type Appearance } from '@nextbus/ui'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface CorpusCase {
  name: string
  args: {
    locales: Locale[]
    localeOverride: Locale | null
    appearances: Appearance[]
    appearance: Appearance
  }
}

const CASES = corpus.groups.settingsView.cases as unknown as CorpusCase[]

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the settingsView corpus case \`${name}\` moved`)
  return found
}

/** The corpus case each projected state is driven from — three states, and they cover all three locales. */
const FIXTURE: Record<string, { case: string }> = {
  content: { case: 'following-the-device-selects-automatic-and-no-language' },
  localeOverridden: { case: 'auto-appearance-stays-selected-whatever-it-resolves-to' },
  offline: { case: 'a-chosen-language-and-a-chosen-appearance' },
}

/** The locale a case renders in: its override, else the device's, which this suite pins to English. */
const localeOf = (c: CorpusCase): Locale => c.args.localeOverride ?? 'en'

// ── the seams ──────────────────────────────────────────────────────────────────────────────────

// Mutable so a state can be driven under a different locale — the same shape the other RN drivers use for
// their one seam. `localeOverridden` is the only state in the repo read in a language other than English,
// and it exists because the section headings must follow the reader and the language *names* must not.
let activeOverride: Locale | null = null

vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {}, back: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// See `test/place-detail-states.test.tsx` for why `nativewind` cannot be imported at all.
vi.mock('nativewind', () => ({ cssInterop: () => {}, vars: (v: unknown) => v }))
vi.mock('expo-blur', async () => ({ BlurView: (await import('react-native')).View }))
// All three hooks, not just `useLocale`: this is the first screen to read the *override* as well, and it
// is the only way to drive "which language is selected" at all.
vi.mock('../providers/LocaleProvider', () => ({
  useLocale: () => activeOverride ?? 'en',
  useLocaleOverride: () => activeOverride,
  useSetLocale: () => () => {},
}))
// zustand's `persist` backs onto AsyncStorage, which has no jsdom implementation.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve() },
}))

type Screens = {
  Settings: ComponentType
  usePreferences: typeof import('../lib/preferences')['usePreferences']
}

/** Imported per test, so the preference store is a fresh module rather than one an earlier state set. */
async function freshModules(): Promise<Screens> {
  vi.resetModules()
  const [screen, store] = await Promise.all([
    import('../app/(tabs)/settings'),
    import('../lib/preferences'),
  ])
  return { Settings: screen.default as ComponentType, usePreferences: store.usePreferences }
}

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

/** `react-native-web` renders a `Pressable` as `div[role="button"]`, where the DOM app writes `<button>`. */
const INTERACTIVE = '[role="button"], button, a[href]'

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

/** The labels the screen composes with — so the expectation is the kernel's, not a second table. */
const labelsFor = (locale: Locale) => ({
  languageAuto: t(locale, 'languageAuto') as string,
  endonym: (l: Locale) => endonym(l) as string,
  appearance: (value: string) =>
    t(
      locale,
      ({ auto: 'appearanceAuto', light: 'appearanceLight', dark: 'appearanceDark' } as const)[
        value as Appearance
      ],
    ) as string,
  aboutRow: (id: string) =>
    t(
      locale,
      ({ 'about-data': 'aboutData', faq: 'settingsFaq' } as const)[id as 'about-data' | 'faq'],
    ) as string,
})

async function mount(c: CorpusCase): Promise<RenderedTree> {
  activeOverride = c.args.localeOverride
  const { Settings, usePreferences } = await freshModules()
  usePreferences.setState({ appearance: c.args.appearance })
  root = createRoot(container)
  await act(async () => {
    root?.render(<Settings />)
  })
  return readTree(container)
}

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  const wanted = FIXTURE[state]
  // `null` for the four states declared without a projection — `conformStates` skips those itself, and
  // never silently: a projected state with no fixture is a finding.
  if (wanted === undefined) return null
  const c = caseNamed(wanted.case)
  const tree = await mount(c)
  return {
    view: settingsView<Appearance>(
      {
        locales: SUPPORTED_LOCALES,
        localeOverride: c.args.localeOverride,
        appearances: APPEARANCES,
        appearance: c.args.appearance,
      },
      labelsFor(localeOf(c)),
    ),
    tree,
  }
}

beforeEach(() => {
  activeOverride = null
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to Settings’ published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    // The anti-vacuous control, and the same one the DOM driver carries.
    expect(settingsSpec.component).toBe('Settings')
    expect(Object.keys(settingsSpec.states).length).toBeGreaterThanOrEqual(7)
    const projected = Object.entries(settingsSpec.states)
      .filter(([, declared]) => 'shows' in declared.enforcement)
      .map(([state]) => state)
    expect(projected.length).toBeGreaterThanOrEqual(3)
    for (const state of projected) {
      expect(FIXTURE[state], `${state} is projected and this driver cannot reach it`).toBeDefined()
    }
  })

  for (const state of Object.keys(settingsSpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const named = FIXTURE[state]?.case
      const locale = named === undefined ? 'en' : localeOf(caseNamed(named))
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate: translateIn(locale),
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(settingsSpec, harness).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }
})

describe('what the projection cannot see: which option is the rider’s', () => {
  // The half a text walker is blind to, asserted directly. Writing this block is what found the defect the
  // for a keypad key's `enabled`. `react-native-web` renders `accessibilityState={{selected}}` as
  // `aria-selected`, where the DOM screen writes `aria-pressed`: two honest readings of one model field,
  // which is exactly why the *reading* is per renderer and the declaration is not (ADR-069 decision 7).

  const selectedLabels = (): string[] =>
    [...container.querySelectorAll('[aria-pressed="true"]')].map((el) =>
      (el.textContent ?? '').trim(),
    )

  it('marks exactly one language and exactly one appearance, in every corpus case', async () => {
    for (const c of CASES) {
      document.body.innerHTML = '<div id="host"></div>'
      const host = document.getElementById('host')
      if (!host) throw new Error('unreachable')
      container = host
      await mount(c)
      const view = settingsView<Appearance>(
        {
          locales: SUPPORTED_LOCALES,
          localeOverride: c.args.localeOverride,
          appearances: APPEARANCES,
          appearance: c.args.appearance,
        },
        labelsFor(localeOf(c)),
      )
      const expected = [
        ...view.languages.filter((o) => o.selected),
        ...view.appearances.filter((o) => o.selected),
      ].map((o) => o.label)
      expect(expected, `${c.name}: the kernel lit the wrong number`).toHaveLength(2)
      expect(selectedLabels().sort(), c.name).toEqual(expected.sort())
    }
  })

  it('tells following the device apart from choosing that same language', async () => {
    // The trap, measured on the rendered tree rather than on the kernel: a screen that read `useLocale()`
    // instead of `useLocaleOverride()` lights BOTH rows here, because the device locale is English.
    await mount(caseNamed('following-the-device-selects-automatic-and-no-language'))
    expect(selectedLabels()).toContain(t('en', 'languageAuto'))
    expect(selectedLabels()).not.toContain(endonym('en'))
  })

  it('keeps Auto selected whatever it resolves to', async () => {
    // The appearance trap's twin, invisible on a light machine: a screen marking the RESOLVED mode shows
    // Dark as chosen to a rider who chose Auto.
    await mount(caseNamed('auto-appearance-stays-selected-whatever-it-resolves-to'))
    expect(selectedLabels()).toContain(t('zh-Hant', 'appearanceAuto'))
    expect(selectedLabels()).not.toContain(t('zh-Hant', 'appearanceDark'))
  })
})
