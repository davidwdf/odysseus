// The DOM renderer's Settings conformance suite: it drives the published spec (WP6-7, ADR-096) —
// `packages/contract/ui/settings.spec.json`, seven states, three of them projected.
//
// WHAT IS DIFFERENT ABOUT THIS SCREEN, AND IT CHANGES WHAT THE SUITE IS FOR
// Nothing here fetches. The five canonical states were designed around a query — they are branches over an
// async status (ADR-084) — so the spec inverts the `slots`/`shows` split: the WHOLE screen is `slots`, and
// a state declaring `shows: []` is declaring *everything*. That is what makes `content` and `offline` real
// assertions rather than empty ones, and it means a renderer that drew a heading and filled its list in an
// effect diverges at index 0 rather than passing.
//
// THE PROJECTION CANNOT SEE THE SELECTION, WHICH IS THE WHOLE POINT OF THIS SCREEN
// "Chosen" is a filled pill here and a dot on native — no text at all. So a projection over the seven
// labels is *exactly equal in every selection state*: it cannot tell Auto from Dark. The spec says so and
// enforces what it can (the options exist, in order, with the right words); the last describe block below
// asserts `selected` directly against the kernel's own answer, which is the division `search.spec.json`
// already established for a keypad key's `enabled`.
//
// THE FIXTURES ARE THE CORPUS'S OWN `settingsView` CASES, so this suite's goldens and the RN suite's are
// the same bytes and the same kernel call.

import settingsSpec from '@nextbus/contract/ui/settings.spec.json'
import { type Locale, settingsView } from '@nextbus/core'
import corpus from '@nextbus/core/spec/settings.spec.json'
import { CATALOGUE, endonym, type MessageKey, SUPPORTED_LOCALES, t } from '@nextbus/i18n'
import { APPEARANCES, type Appearance } from '@nextbus/ui'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferences } from '../src/lib/preferences'
import { LocaleProvider } from '../src/providers/LocaleProvider'
import { Settings } from '../src/screens/Settings'

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

/**
 * The corpus case each projected state is driven from, and the locale it is read in.
 *
 * `localeOverridden` is the only state in this repo driven under a non-`en` locale, and it exists for one
 * rule: the section headings must follow the reader's language and the language *names* must not. A
 * renderer that sent both through the catalogue looks completely correct in English.
 */
const FIXTURE: Record<string, { case: string; offline?: boolean }> = {
  content: { case: 'following-the-device-selects-automatic-and-no-language' },
  localeOverridden: { case: 'auto-appearance-stays-selected-whatever-it-resolves-to' },
  offline: { case: 'a-chosen-language-and-a-chosen-appearance', offline: true },
}

/**
 * The locale a case actually renders in — its override, else the browser's, which jsdom reports as
 * English.
 *
 * **Derived rather than declared beside each fixture, because declaring it separately was this driver's
 * first bug**: `offline`'s case carries a `zh-Hans` override, the fixture table said `en`, and the suite
 * reported the screen rendering `设置` where the spec declared `Settings` — a divergence for the wrong
 * reason. Same class as the harness traps WP6-2 and WP6-3b each hit once, and the reason the three states
 * below now happen to cover all three locales.
 */
const localeOf = (c: CorpusCase): Locale => c.args.localeOverride ?? 'en'

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let container: HTMLElement
let root: Root | null = null

const INTERACTIVE = 'button, a[href], [role="button"]'

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
    const read = t as unknown as (
      locale: Locale,
      key: MessageKey,
      args?: Record<string, unknown>,
    ) => string
    return read(locale, key as MessageKey, args)
  }
}

/** The labels the screen itself composes with — so the expectation is the kernel's, not a second table. */
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

function mount(): RenderedTree {
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <LocaleProvider>
          <Settings />
        </LocaleProvider>
      </MemoryRouter>,
    )
  })
  return readTree(container)
}

/** How this renderer is put into each declared state, and the view each corresponds to. */
function fixture(state: string): { view: unknown; tree: RenderedTree } | null {
  const wanted = FIXTURE[state]
  // `null` for the four states declared without a projection — `conformStates` skips those itself, and
  // never silently: a projected state with no fixture is a finding.
  if (wanted === undefined) return null
  const c = caseNamed(wanted.case)
  if (wanted.offline) {
    // There is nothing to disconnect — this screen makes no request — so "offline" is asserted the only
    // way it can honestly be: the browser reports itself offline and the screen is byte-identical. A
    // future banner or disabled control would diverge here rather than shipping unnoticed.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
  }
  usePreferences.setState({
    appearance: c.args.appearance,
    localeOverride: c.args.localeOverride,
  })
  const view = settingsView<Appearance>(
    {
      locales: SUPPORTED_LOCALES,
      localeOverride: c.args.localeOverride,
      appearances: APPEARANCES,
      appearance: c.args.appearance,
    },
    labelsFor(localeOf(c)),
  )
  return { view, tree: mount() }
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
  usePreferences.setState({ appearance: 'auto', localeOverride: null })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/web conforms to Settings’ published spec, state by state', () => {
  it('has the states the spec declares, and a fixture for each projected one', () => {
    // The anti-vacuous control. A spec whose states were all `unenforced`, or a driver quietly missing
    // fixtures, would both make the run below assert nothing.
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

  // One `it` per state, so a failure names the state rather than the suite.
  for (const state of Object.keys(settingsSpec.states)) {
    it(`in ${state}`, () => {
      const rendered = fixture(state)
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
  // **The half of this screen a text walker is blind to**, asserted directly — the same division
  // `search.spec.json` makes for a keypad key's `enabled`. Without this block the suite above would pass
  // with every option unselected, or with all of them selected, because neither changes a single word.

  const pressedLabels = (): string[] =>
    [...container.querySelectorAll('[aria-pressed="true"]')].map((el) =>
      (el.textContent ?? '').trim(),
    )

  it('marks exactly one language and exactly one appearance, in every corpus case', () => {
    for (const c of CASES) {
      usePreferences.setState({
        appearance: c.args.appearance,
        localeOverride: c.args.localeOverride,
      })
      mount()
      // The labels must be read in the locale the screen is actually *rendering* in — the override if
      // there is one, else the browser's, which jsdom reports as English. Computing them in `en` while the
      // screen drew Chinese was this driver's first bug, and it is the same class as the harness traps
      // WP6-2 and WP6-3b each hit once: a harness that supplies the wrong input is indistinguishable from
      // a renderer that is wrong.
      const view = settingsView<Appearance>(
        {
          locales: SUPPORTED_LOCALES,
          localeOverride: c.args.localeOverride,
          appearances: APPEARANCES,
          appearance: c.args.appearance,
        },
        labelsFor(c.args.localeOverride ?? 'en'),
      )
      const expected = [
        ...view.languages.filter((o) => o.selected),
        ...view.appearances.filter((o) => o.selected),
      ].map((o) => o.label)
      expect(expected, `${c.name}: the kernel lit the wrong number`).toHaveLength(2)
      expect(pressedLabels().sort(), c.name).toEqual(expected.sort())
      act(() => root?.unmount())
      document.body.innerHTML = '<div id="host"></div>'
      const host = document.getElementById('host')
      if (!host) throw new Error('unreachable')
      container = host
    }
  })

  it('tells following the device apart from choosing that same language', () => {
    // The trap this screen exists to design out, measured on the rendered DOM rather than on the kernel:
    // a renderer that read `useLocale()` instead of `useLocaleOverride()` lights BOTH rows here, because
    // jsdom's browser language is English. Watched failing by swapping the hook in `Settings.tsx`.
    usePreferences.setState({ localeOverride: null })
    mount()
    expect(pressedLabels()).toContain(t('en', 'languageAuto'))
    expect(pressedLabels()).not.toContain(endonym('en'))
  })

  it('keeps Auto selected when the system is dark', () => {
    // The appearance trap's twin, and the one that is invisible on a light machine: `resolveMode('auto',
    // true)` is `'dark'`, so a renderer marking the RESOLVED mode shows Dark as chosen to a rider who
    // chose Auto. The document may well be dark here; the *control* must still say Auto.
    usePreferences.setState({ appearance: 'auto' })
    mount()
    expect(pressedLabels()).toContain(t('en', 'appearanceAuto'))
    expect(pressedLabels()).not.toContain(t('en', 'appearanceDark'))
  })
})

describe('the spec’s `stale` state: the preferences as they are on disk *now*', () => {
  // **The state that was a `knownDefect` until WP6-8a, asserted on the rendered DOM.** Its `mustNot` is
  // "a choice this tab made three minutes ago, written over a choice another tab made since", and until
  // the stores merged, a second tab of this app held a stale copy from the moment it loaded and reverted
  // the first tab's language with its next write.
  //
  // **The spec declares `stale` `unenforced`, and this block is one of the things it names** (ADR-130
  // decision 2). Pointing `enforcement.by` at `languageOptions` was tried and withdrawn: `conformStates`
  // does not project a `by` state, and that slot is already `empty`'s — so the claim would have been one
  // no harness evaluates, green on both renderers the day the `storage` listener was deleted. A `shows`
  // projection is worse still, and not for want of a fixture: `apps/mobile/lib/preferences.ts` gates the
  // merge *and* the listener on a web feature test, so **`stale` is a state the native surface cannot
  // enter by design** — and the walker treats a projected state a renderer cannot reach as a finding, so
  // the RN driver would have had to fake it. What holds the behaviour instead is named in the spec:
  // `favourites#mergePreferences` and `favourites#mergeSavedKeys` in `packages/core/spec`,
  // `test/preferences-sync.test.ts`, `apps/mobile/lib/preferences.sync.test.ts`, and this block — which
  // mounts the screen, delivers a real `storage` event and reads the new language back off the DOM, which
  // is as close to a projection as the state gets on the one renderer where it exists.
  //
  // Nothing about this screen changed to make it pass. That is the point of an ADR-090 producer fix: the
  // screen already drew whatever the store held, and the store is what learnt to listen.

  const pressedLabels = (): string[] =>
    [...container.querySelectorAll('[aria-pressed="true"]')].map((el) =>
      (el.textContent ?? '').trim(),
    )

  it('re-reads a language another tab chose, without a reload', () => {
    usePreferences.setState({ appearance: 'auto', localeOverride: null })
    mount()
    expect(container.textContent).toContain(t('en', 'settingsLanguage'))
    expect(pressedLabels()).toContain(t('en', 'languageAuto'))

    // The other tab writes the blob — the whole blob, which is what `partialize` writes — and the browser
    // delivers a `storage` event. `newValue` is deliberately not what the store trusts; it re-reads.
    act(() => {
      window.localStorage.setItem(
        'nextbus.preferences',
        JSON.stringify({
          state: {
            appearance: 'auto',
            localeOverride: 'zh-Hant',
            favoriteRoutes: [],
            recentRoutes: [],
            recentStops: [],
          },
          version: 1,
        }),
      )
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'nextbus.preferences',
          storageArea: window.localStorage,
        }),
      )
    })

    // The headings follow the reader, the language names do not, and exactly one row is lit — the same
    // three claims `localeOverridden` makes, arrived at from another tab rather than from a tap.
    expect(container.textContent).toContain(t('zh-Hant', 'settingsLanguage'))
    // Two lit controls, not three: one language and one appearance. `languageAuto` and `appearanceAuto`
    // are the same word in Chinese, so "Automatic is no longer chosen" has to be counted rather than
    // searched for — a `not.toContain('自動')` would fail on the appearance row, which is still Auto.
    expect(pressedLabels()).toContain(endonym('zh-Hant'))
    expect(pressedLabels()).toHaveLength(2)
    expect(pressedLabels()).toEqual(
      expect.arrayContaining([endonym('zh-Hant'), t('zh-Hant', 'appearanceAuto')]),
    )
  })

  it('does not revert that language when this tab then changes its appearance', () => {
    // `docs/07`'s reproduction, in the order a rider hits it — and **with no event delivered**, which is
    // the half a listener cannot cover and the half that destroyed data: this tab's next write went out
    // as the *whole* blob from its stale memory, taking the other tab's language with it.
    usePreferences.setState({ appearance: 'auto', localeOverride: null })
    mount()
    window.localStorage.setItem(
      'nextbus.preferences',
      JSON.stringify({
        state: {
          appearance: 'auto',
          localeOverride: 'zh-Hant',
          favoriteRoutes: [],
          recentRoutes: [],
          recentStops: [],
        },
        version: 1,
      }),
    )

    usePreferences.getState().setAppearance('dark')

    const blob = JSON.parse(window.localStorage.getItem('nextbus.preferences') as string)
    expect(blob.state.localeOverride, 'the other tab’s language was overwritten').toBe('zh-Hant')
    expect(blob.state.appearance).toBe('dark')
  })

  it('was watched failing: without the listener the screen stays in the old language', () => {
    // The control. If the merge were removed, the first case above would still *mount* correctly and only
    // the post-event assertions would go red — so this pins what "the state was entered" means: the store
    // is what changed, and the screen is only reporting it.
    usePreferences.setState({ localeOverride: null })
    mount()
    window.localStorage.setItem(
      'nextbus.preferences',
      JSON.stringify({
        state: {
          appearance: 'auto',
          localeOverride: 'zh-Hans',
          favoriteRoutes: [],
          recentRoutes: [],
          recentStops: [],
        },
        version: 1,
      }),
    )
    // No event dispatched: nothing tells this tab. It is still in English, which is honest — a listener
    // cannot hear what was never broadcast, and it is why the *write* path merges too.
    expect(usePreferences.getState().localeOverride).toBeNull()
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'nextbus.preferences',
          storageArea: window.localStorage,
        }),
      )
    })
    expect(usePreferences.getState().localeOverride).toBe('zh-Hans')
  })
})
