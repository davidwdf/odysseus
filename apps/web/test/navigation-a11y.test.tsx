// **The navigation moment, and the document's language** — the three shell-level defects `docs/07` filed
// against `apps/web` (two of them against both renderers): `<html lang>` welded to `"en"`, a pushed screen
// that inherits the previous screen's scroll offset, and nothing at all telling a screen-reader rider that
// the page changed.
//
// WHAT THIS FILE DRIVES, AND WHY IT IS NOT `<App/>`
// It mounts the shell's **real route table** (`routes`, exported from `src/shell/App.tsx`) under a memory
// router rather than the browser one `App` builds. That is not a convenience: the two most interesting
// destinations — a place and a route — are unreachable from a networkless shell, because every control that
// leads to one is drawn from data. A memory router over the real table can push to them, through the real
// `Root`, the real providers and the real screens; nothing about `useNavigationMoment` sees the difference
// (it reads `useLocation().key` and `useNavigationType()`, which mean the same thing under either history).
// Where a *control* is the subject — Search's autofocused field, a tab link that survives the navigation —
// the test clicks the real control rather than calling `navigate`.
//
// WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED
// jsdom has no `IntersectionObserver`, so `shell/CollapsingHeader.tsx` never observes anything here and **no
// suite in this repo can watch a header collapse**. The claim that a layout-effect reset cannot make either
// collapsing header flicker is therefore reasoned from where the reset lands in the frame (before the
// browser's rendering steps, so the observer only ever sees the final offset) and not measured. jsdom also
// implements no scrolling at all — `window.scrollTo` is a stub — so what is asserted below is *that the
// document was told to go to the top, and when*, which is the whole of the fix.

import { t } from '@nextbus/i18n'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, type DataRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferences } from '../src/lib/preferences'
import { routes } from '../src/shell/App'

let container: HTMLElement
let root: Root | null = null
let router: DataRouter
let scrollTo: ReturnType<typeof vi.fn>

/** Mount the real route table at `path`, under a memory history. */
function mount(path: string): void {
  router = createMemoryRouter(routes, { initialEntries: [path] })
  root = createRoot(container)
  act(() => {
    root?.render(<RouterProvider router={router} />)
  })
}

/** A router navigation, settled. */
function navigate(to: string | number, options?: { replace: boolean }): void {
  act(() => {
    // `void`: the promise resolves when the navigation completes, and every route here is element-only.
    void (typeof to === 'number' ? router.navigate(to) : router.navigate(to, options))
  })
}

/**
 * Activate a control the way a keyboard rider does — focus it, then fire the click.
 *
 * `cancelable`, which the shell suite's own helper does not need and this one does: react-router's `Link`
 * navigates by calling `preventDefault()` on the click and taking over, and `preventDefault` on an
 * uncancelable event is a no-op — so jsdom went on to attempt a real document navigation, which is a full
 * page load rather than the client-side one under test.
 */
function press(el: HTMLElement): void {
  el.focus()
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
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

/** What the polite live region is currently saying. */
function announcement(): string {
  const region = container.querySelector('[role="status"]')
  if (!region) throw new Error('the shell renders no live region at all')
  return region.textContent ?? ''
}

/** The current screen's root element — every one of the eight is a `<main>`. */
function screen(): HTMLElement {
  const main = container.querySelector('main')
  if (!main) throw new Error('the screen rendered no <main>')
  return main
}

beforeEach(() => {
  // No screen in this file is about its data: a rejecting fetch is the documented cold-start path and puts
  // every one of them in a state it can draw (see `shell.test.tsx`, which stubs it the same way).
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network in this suite'))),
  )
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // jsdom's own `window.scrollTo` is a not-implemented stub that logs to the virtual console. Replacing it
  // with a spy is both quieter and the only way to see *when* the document was told to move.
  scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
  window.localStorage.clear()
  // Search draws its field only once it has an index, and `useSearchIndex` reads its cache **synchronously**
  // before the first render — so a seeded (empty) index is what gives this suite a real, autofocusing field
  // with no network at all. Which routes are in it is beside the point here; that is `search-states`' subject.
  window.localStorage.setItem(
    'nextbus.searchIndex.v1',
    JSON.stringify({ version: 'navigation-a11y', routes: [], stops: [] }),
  )
  usePreferences.setState({ appearance: 'auto', localeOverride: null })
  document.documentElement.lang = ''
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  vi.unstubAllGlobals()
})

describe('`<html lang>` follows the active locale', () => {
  it('states the detected locale rather than leaving index.html`s default standing', () => {
    mount('/')
    // jsdom reports `en-US`, so the detection resolves to `en` — the same value index.html carries. What is
    // under test is that the attribute is now *written by the app*: `beforeEach` clears it, so a shell that
    // never touches it leaves the empty string this asserts against.
    expect(document.documentElement.lang).toBe('en')
  })

  it('follows a manual override, in both scripts, and back again', () => {
    mount('/settings')
    // The picker is labelled with each language's endonym, which is deliberately untranslated.
    press(button('繁體中文'))
    expect(document.documentElement.lang).toBe('zh-Hant')
    press(button('简体中文'))
    // The subtag distinction is the whole point: a synthesizer reads `zh-Hant` and `zh-Hans` differently,
    // and so does the browser's font matching. A single `zh` would be a regression dressed as a fix.
    expect(document.documentElement.lang).toBe('zh-Hans')
    press(button(t('zh-Hans', 'languageAuto')))
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('a push starts at the top; a pop and a replace leave the scroll alone', () => {
  it('does not touch the scroll on a page load', () => {
    mount('/settings')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('resets the document scroll when a screen is pushed', () => {
    mount('/settings')
    press(button(t('en', 'aboutData')))
    expect(router.state.location.pathname).toBe('/about-data')
    // `instant` explicitly, so a future global `scroll-behavior: smooth` cannot turn the reset into an
    // animation that the collapsing headers' observers would watch travel.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' })
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('leaves a pop to the browser, which already restores it correctly', () => {
    // The defect is one-directional and so is the fix. `<ScrollRestoration>` would have taken this
    // direction over too — `history.scrollRestoration = 'manual'` plus a single `scrollTo(0, y)` on the
    // first commit — and that commit is a skeleton on every screen here. See `useScrollToTop.ts`.
    mount('/settings')
    press(button(t('en', 'aboutData')))
    scrollTo.mockClear()
    navigate(-1)
    expect(router.state.location.pathname).toBe('/settings')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('ignores the replace Search performs on every keystroke', () => {
    mount('/search')
    const field = container.querySelector('input')
    if (!field) throw new Error('Search rendered no field')
    type('8', field)
    expect(router.state.location.search).toContain('q=8')
    expect(scrollTo).not.toHaveBeenCalled()
    // **The clause this pins is the announcement, not the scroll**, and finding that out is the useful part:
    // a replace is never a `PUSH`, so the scroll assertion above holds even with the `REPLACE` test deleted.
    // What does not hold is silence — without it the live region says "Search" at the rider while they type,
    // once per character, and focus is a candidate to be taken off the field on any keystroke that removes
    // the keypad key under it. Watched failing on exactly that deletion.
    expect(announcement()).toBe('')
    expect(document.activeElement).toBe(field)
  })
})

describe('a navigation is announced, and focus goes with it', () => {
  it('says nothing on a page load', () => {
    mount('/')
    expect(announcement()).toBe('')
  })

  it('names the destination it arrived at, in the active locale', () => {
    mount('/settings')
    press(button(t('en', 'aboutData')))
    expect(announcement()).toBe(t('en', 'aboutData'))
  })

  it('names it in the rider`s language, not in English', () => {
    mount('/settings')
    press(button('繁體中文'))
    press(button(t('zh-Hant', 'settingsFaq')))
    expect(announcement()).toBe(t('zh-Hant', 'settingsFaq'))
  })

  it('moves focus to the new screen when the navigation orphaned it', () => {
    mount('/settings')
    press(button(t('en', 'aboutData')))
    // The button that was pressed has been unmounted, so focus had fallen to `<body>` — a screen reader's
    // cursor with it. It is on the new screen now, as a programmatic target rather than as a tab stop.
    expect(document.activeElement).toBe(screen())
    expect(screen().getAttribute('tabindex')).toBe('-1')
  })

  it('leaves focus on a tab, because a tab row is supposed to keep it', () => {
    mount('/')
    const tab = container.querySelector<HTMLAnchorElement>('nav a[href="/favorites"]')
    if (!tab) throw new Error('no favourites tab')
    press(tab)
    expect(router.state.location.pathname).toBe('/favorites')
    expect(document.activeElement).toBe(tab)
    // …and the rider is still told where they are, which is what the live region is for.
    expect(announcement()).toBe(t('en', 'tabFavorites'))
  })

  it('lets Search keep the keyboard it autofocuses', () => {
    // **The pin on the one condition that makes the focus move safe**, and the reason it is a condition
    // rather than a declaration order. The first version of this test claimed the order was what saved the
    // field; swapping `<NavigationMoment/>` across `<Outlet/>` left it green, and deleting the "something
    // already holds focus" test in `focusScreen` turned it and the tab case red together. So the guard is
    // the mechanism, and this is what would warn anyone before a rider tapped the lens and got no keyboard.
    mount('/')
    const lens = container.querySelector<HTMLAnchorElement>('nav a[href="/search"]')
    if (!lens) throw new Error('no search launcher')
    press(lens)
    expect(router.state.location.pathname).toBe('/search')
    expect(document.activeElement?.tagName).toBe('INPUT')
  })

  it('announces a back navigation too, and takes the orphaned cursor with it', () => {
    // **The branch that had no coverage, and the one the hook's own header used to describe backwards.** Only
    // the *scroll* reset is gated on `PUSH`; focus and the announcement fire on a `POP` as well, and that is
    // the decision rather than an oversight: a back navigation changes the page and nothing else says so — a
    // screen reader announces a document load, not a client-side history entry — while react-router restores
    // no focus either, so the cursor sits on `<body>` wherever the rider came from.
    //
    // The pop is a real one: pushed by pressing the real control, then `navigate(-1)`, which is what the
    // browser's Back button does to a memory history as much as to a browser one.
    mount('/settings')
    press(button(t('en', 'aboutData')))
    expect(announcement()).toBe(t('en', 'aboutData'))
    navigate(-1)
    expect(router.state.location.pathname).toBe('/settings')
    // Announced as Settings — not left saying "About the data", which would be worse than silence: it names
    // the screen the rider has just left.
    expect(announcement()).toBe(t('en', 'tabSettings'))
    // …and the cursor is on the restored screen rather than back at the top of the document. The scroll is
    // untouched, which the sibling `describe` asserts and `preventScroll` is what buys.
    expect(document.activeElement).toBe(screen())
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('clears the region for a screen whose name is bus data, rather than inventing a word', () => {
    // A place and a route are titled by `I18nText` from the model, which is in no catalogue (CLAUDE.md
    // rule 5) — `destinations.ts` gives neither a `titleKey`. The arm that matters is that this is a
    // *clear* and not a crash or a stale name: `t(locale, undefined)` would throw on the single most
    // common navigation in the app, a rider tapping a card.
    mount('/settings')
    press(button(t('en', 'aboutData')))
    expect(announcement()).toBe(t('en', 'aboutData'))
    navigate(`/stop/${encodeURIComponent('P:KMB:AA+CTB:AB')}`)
    expect(announcement()).toBe('')
    // …and the half a missing string does not excuse: focus still lands on the screen.
    expect(document.activeElement).toBe(screen())
  })
})

/** Type into a controlled field the way React sees it — the native setter, then an `input` event. */
function type(value: string, field: HTMLInputElement): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
