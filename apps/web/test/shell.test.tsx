// WP6-0's acceptance, as much of it as a test can hold: **the shell opens every declared destination,
// switches locale, and remembers both across a cold start.**
//
// WHAT THIS FILE DOES AND DOES NOT PROVE
// The other half of the acceptance — *"opens offline … measured the way ADR-058 was (kill the static
// server AND the Worker, cold-load)"* — is not here and cannot be: jsdom has no service worker, so an
// offline claim asserted in this file would be a claim about a mock. That half was measured in a browser
// against a real `dist/`, and the measurement is written down in `docs/11` where a reader meets it.
// What this file covers is the part a browser pass is *bad* at: every destination, every locale, both
// appearance transitions, and the remount that stands in for a cold start.
//
// The remount matters more than it looks. Three of the four things WP6-0 adds are only observable across
// one — a persisted preference that is written but never read back is indistinguishable from one that
// works, until a rider reopens the app.

import { endonym, t } from '@nextbus/i18n'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCES_STORAGE_KEY, usePreferences } from '../src/lib/preferences'
import { App } from '../src/shell/App'
import { DESTINATIONS, PUSHED, TABS } from '../src/shell/destinations'

/** Every text node in the tree, trimmed, empties dropped — the same projection the WP4-1 suite uses. */
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
let root: Root | null = null

/** A document with nothing in it and no theme applied — what a browser hands a cold start. */
function freshDocument(): void {
  document.documentElement.className = ''
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
}

/** Mount the whole shell at `path`. */
function mount(path: string): HTMLElement {
  window.history.pushState({}, '', path)
  root = createRoot(container)
  act(() => {
    root?.render(<App />)
  })
  return container
}

/**
 * Unmount, throw the document away, forget everything that was not written down, and mount again — a cold
 * start, minus what jsdom does not have.
 *
 * **The store reset is the whole point, and the first version of this helper did not have it.** The
 * preference store is *module* state: remounting React leaves it holding whatever the last click put
 * there, so every assertion below passed with `localeOverride` removed from `partialize` — the value was
 * still in memory, and the test was measuring React, not persistence. Watched failing after the fix, on
 * exactly that injection.
 *
 * The blob is captured before the reset because `setState` makes the middleware write: resetting to
 * defaults would otherwise overwrite the bytes we are about to read back.
 */
function remount(path: string): HTMLElement {
  act(() => {
    root?.unmount()
  })
  root = null
  freshDocument()
  const stored = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
  usePreferences.setState({ appearance: 'auto', localeOverride: null })
  if (stored === null) window.localStorage.removeItem(PREFERENCES_STORAGE_KEY)
  else window.localStorage.setItem(PREFERENCES_STORAGE_KEY, stored)
  void usePreferences.persist.rehydrate()
  return mount(path)
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** The control whose visible label is exactly `label`. */
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found
}

/**
 * A controllable OS colour scheme.
 *
 * **jsdom has no `matchMedia` at all**, and `lib/appearance.ts` guards its absence by resolving light —
 * which means that without this stub every appearance assertion below would be exercising the fallback
 * rather than the media query, and `auto` would look correct for the wrong reason. So the query is stubbed
 * with a real (if minimal) implementation, and one case flips it to dark to prove `auto` follows it.
 */
function stubColorScheme(osIsDark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? osIsDark : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => {
  // Nearby's `useClientPolicy` fetches on mount, and this suite has no business reaching a network. A
  // rejecting stub is closer to the truth than a fixture: `resolveClientPolicy(undefined)` is the
  // documented cold-start path, so the screen renders exactly as it would on a first launch offline.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network in this suite'))),
  )
  stubColorScheme(false)
  window.localStorage.clear()
  // The store is module state, so a preference set by one test would otherwise still be in memory for
  // the next one — clearing localStorage alone does not reset it, and a leak here would make the
  // remount assertions pass for the wrong reason.
  usePreferences.setState({ appearance: 'auto', localeOverride: null })
  freshDocument()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  vi.unstubAllGlobals()
})

describe('every declared destination opens, and none of them is blank', () => {
  it('has destinations at all', () => {
    // The anti-vacuous control: an empty table would make the loop below assert nothing.
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(8)
  })

  for (const destination of DESTINATIONS) {
    // A parameterised path needs a concrete one to visit. The id is percent-encoded because a canonical
    // place id contains `+`, which a URL decodes as a space — ADR-079's own trap, one layer up.
    const path = destination.path.replace(':id', encodeURIComponent('P:KMB:AA+CTB:AB'))
    it(`renders something at ${path}`, () => {
      expect(renderedText(mount(path)).length).toBeGreaterThan(0)
    })
  }

  it('shows an unported destination its name and says it is coming, not an empty page', () => {
    // `/faq` rather than `/favorites`, which WP6-4b ported. A placeholder assertion has to die when its
    // placeholder does, or it becomes a test asserting that a shipped screen is still missing — the same
    // churn WP6-3b's `/stop/:id` assertion went through, and the right kind.
    const text = renderedText(mount('/faq'))
    expect(text).toContain(t('en', 'settingsFaq'))
    expect(text).toContain(t('en', 'comingSoon'))
  })

  it('has no id-parameterised placeholder left, which is why this assertion is now the absence of one', () => {
    // This test used to mount `/route/KMB:AA` and assert the id appeared where a heading would, because a
    // route's name is `I18nText` from the model and never a UI string (CLAUDE.md rule 5) — so the id was the
    // honest substitute while the screen was a placeholder. It was `/stop/:id` before WP6-3b ported that one
    // and `/route/:id` after, and **WP6-6b ported the last of them**.
    //
    // A placeholder assertion has to die when its placeholder does, or it becomes a test asserting that a
    // shipped screen is still missing. What survives is the rule it was protecting: a destination with no
    // `titleKey` must have a ported screen, because the placeholder has no words for it.
    const untitled = DESTINATIONS.filter((d) => d.titleKey === undefined)
    expect(untitled.map((d) => d.path)).toEqual(['/stop/:id', '/route/:id'])
    for (const d of untitled)
      expect(d.owner, `${d.path} has no title and no screen`).toBeUndefined()
  })

  it('sends an unknown path to Nearby rather than to a page it has no words for', () => {
    mount('/no-such-screen')
    expect(window.location.pathname).toBe('/')
  })
})

describe('the tab bar is on the tabs and nowhere else (ADR-037)', () => {
  it('names all three tabs, and marks the current one', () => {
    mount('/settings')
    const nav = container.querySelector('nav')
    expect(nav).not.toBeNull()
    for (const tab of TABS) expect(nav?.textContent).toContain(t('en', tab.titleKey))
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toContain(
      t('en', 'tabSettings'),
    )
  })

  it('offers search as a launcher rather than as a fourth tab', () => {
    mount('/')
    const nav = container.querySelector('nav')
    expect(nav?.querySelector('a[href="/search"]')?.getAttribute('aria-label')).toBe(
      t('en', 'tabSearch'),
    )
    // The three tabs print their names; the launcher does not, so a fourth *label* would mean a fourth tab.
    expect(nav?.textContent).not.toContain(t('en', 'tabSearch'))
  })

  it('has no tab bar on a pushed destination, and gives it a way back instead', () => {
    for (const destination of PUSHED) {
      remount(destination.path.replace(':id', 'KMB%3AAA'))
      expect(container.querySelector('nav')).toBeNull()
      expect(renderedText(container)).toContain(t('en', 'back'))
    }
  })
})

describe('the locale override switches the UI and survives a cold start', () => {
  const TRADITIONAL = endonym('zh-Hant')

  it('re-renders every visible string in the chosen language', () => {
    mount('/settings')
    // Chosen by its endonym: the picker deliberately does not translate language names, so a reader whose
    // UI is in the wrong language can still find their own.
    click(button(TRADITIONAL))
    const text = renderedText(container)
    expect(text).toContain(t('zh-Hant', 'tabSettings'))
    expect(text).toContain(t('zh-Hant', 'comingSoon'))
    expect(text).not.toContain(t('en', 'comingSoon'))
  })

  it('is still in force after a remount', () => {
    mount('/settings')
    click(button(TRADITIONAL))
    expect(renderedText(remount('/settings'))).toContain(t('zh-Hant', 'tabSettings'))
  })

  it('goes back to following the browser when the override is cleared', () => {
    mount('/settings')
    click(button(TRADITIONAL))
    click(button(t('zh-Hant', 'languageAuto')))
    // jsdom reports `en-US`, so following the browser means English again. What is under test is that
    // *clearing* the override is a distinct state from choosing English, which is why both this picker and
    // the RN screen's keep `null` rather than defaulting to `en`.
    expect(renderedText(container)).toContain(t('en', 'tabSettings'))
  })
})

describe('appearance resolves, applies to the document, and survives a cold start', () => {
  it('follows the OS by default', () => {
    mount('/settings')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(button(t('en', 'appearanceAuto')).getAttribute('aria-pressed')).toBe('true')
  })

  it('follows the OS into dark, with no preference set', () => {
    // The other half of `auto`, and the half that would silently not work if `resolveMode` were ever
    // reimplemented here instead of imported from `@nextbus/ui`: with nothing stored, a dark OS must yield
    // a dark document and the *Auto* option must stay the selected one.
    stubColorScheme(true)
    mount('/settings')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(button(t('en', 'appearanceAuto')).getAttribute('aria-pressed')).toBe('true')
  })

  it('lets an explicit choice override a dark OS', () => {
    stubColorScheme(true)
    mount('/settings')
    click(button(t('en', 'appearanceLight')))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applies dark to <html>, not to the app root', () => {
    // On `<html>` because `index.css` paints `body` from `bg-bg`: a class on the app root would leave an
    // over-scroll revealing white in dark mode, which is the bug `apps/mobile` fixed by painting
    // html/body directly.
    mount('/settings')
    click(button(t('en', 'appearanceDark')))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    click(button(t('en', 'appearanceLight')))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('keeps the browser chrome on the same token as the page', () => {
    // `theme-color` is created by `applyMode` rather than declared in index.html, so it tracks the mode
    // instead of being pinned to one. Both readings are asserted: that it exists, and that it moved.
    mount('/settings')
    const light = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
    click(button(t('en', 'appearanceDark')))
    const dark = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
    expect(light).toMatch(/^rgb\(/)
    expect(dark).not.toBe(light)
  })

  it('is still dark after a remount into a clean document', () => {
    mount('/settings')
    click(button(t('en', 'appearanceDark')))
    // `remount` strips the class first, so this cannot pass by finding the one the click left behind.
    expect(remount('/settings').ownerDocument.documentElement.classList.contains('dark')).toBe(true)
  })

  it('knows the mode synchronously on a cold module graph — the whole no-flash claim', () => {
    // `main.tsx` calls `applyMode(currentMode())` BEFORE `createRoot().render`, which is only honest if
    // the persisted preference has already been read by then. That depends on the storage being
    // synchronous (`safeLocalStorage`, not the async `KeyValueStore` port) — the one substantive
    // difference from `apps/mobile`, which holds its splash screen instead.
    //
    // Asserted on a re-imported module graph, so the read really is from localStorage rather than from
    // the store instance the click above mutated.
    mount('/settings')
    click(button(t('en', 'appearanceDark')))
    vi.resetModules()
    return import('../src/lib/appearance').then(({ currentMode }) => {
      expect(currentMode()).toBe('dark')
    })
  })
})
