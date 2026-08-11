import { t } from '@nextbus/i18n'
import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useMatches, useNavigationType } from 'react-router'
import { useLocale } from '../providers/LocaleProvider'
import type { Destination } from '../shell/destinations'

/**
 * **The navigation moment** — the three things the shell owes a rider the instant the screen changes:
 * the document scrolls back to the top, focus leaves the control that has just been removed from under
 * it, and a screen reader is told where it landed.
 *
 * ## Why one hook rather than three
 *
 * The file is named for what it was opened to fix — `docs/07`'s *"`apps/web` carries the document scroll
 * position into a pushed screen"* — and it holds all of it, because **the three share one definition of
 * "a navigation happened" and a second copy of that definition is the bug**. The definition is narrower
 * than it looks:
 *
 *  · **A changed `useLocation().key`**, not a changed pathname. A key is minted per history entry, so
 *    `/stop/A` → `/stop/B` counts and a re-render does not.
 *  · **Not the first commit.** react-router reports the initial load as a `POP`, and a page that has just
 *    loaded neither needs its scroll reset nor wants its focus moved — the browser has already put both
 *    where they belong. The guard is a ref written only in the effect, which is also what makes it
 *    survive `<StrictMode>`'s mount/unmount/mount.
 *  · **Not a `REPLACE`.** This is the clause that would not have survived being written twice. Search
 *    rewrites its URL with `replace: true` on **every keystroke** (ADR-102) and each replace mints a new key,
 *    so without it a rider typing a route number is read the word "Search" once per character, and any
 *    keystroke that removes the keypad key under their finger — which is `nextValidChars`' whole job — leaves
 *    focus orphaned for the rule below to move. It is one rule about one instant; it lives here once.
 *
 * ## Why not `<ScrollRestoration>`, now that the shell is a data router (ADR-101)
 *
 * `docs/07` filed the scroll defect as *"genuinely `<ScrollRestoration>`'s job"* — and unlike ADR-109's
 * item, the quantity really is `window.scrollY`, so that reasoning is sound as far as it goes. It is still
 * the wrong component, and reading react-router's implementation is what settles it:
 *
 *  1. **It takes over the direction that already works.** It sets `history.scrollRestoration = 'manual'`
 *     and replaces the browser's own back-restore with a single `window.scrollTo(0, y)` in a layout effect
 *     on the first commit of the `POP`. Every screen here fills in asynchronously, so that one shot lands
 *     against a document that is still a skeleton and clamps short — the exact failure `useScrollRestoration`
 *     was written to avoid, and it has a pending-until-scrollable loop precisely because one shot is not
 *     enough. `docs/07` records that **back restores correctly today**; trading a working direction for a
 *     broken one to fix the other is not a fix.
 *  2. **It resets on `REPLACE` too**, for the reason above — harmless on Search, whose document offset is
 *     permanently 0, but a behaviour change on the one screen whose scroll story was hard won.
 *  3. **It answers only one of the three.** Focus and the announcement would still need this hook, and
 *     then the definition of an arrival would exist twice: once in react-router's internals and once here.
 *
 * So: **the scroll reset is push-only.** That defect is one-directional and so is that part of the fix.
 *
 * ## A `POP` is not a scroll problem, and it *is* an arrival
 *
 * The push gate is on the scroll and on nothing else, deliberately. The other two fire on a back
 * navigation exactly as they do on a forward one, because a back navigation changes the page and **nothing
 * else tells anyone so**: a screen reader announces a document load, not a client-side history entry, so
 * without the live region a rider who presses Back — the browser's button, a swipe, or a header control —
 * gets silence and is left to work out where they are from whatever their cursor happens to be near. Which
 * is `<body>`, because react-router restores no focus either. Same instant, same three obligations; only
 * the *scroll* is already answered, by the browser's own restore.
 *
 * The two do not fight the restore. The focus call passes `preventScroll` (see below), so it moves a cursor
 * and not a viewport, which is the whole reason that argument is there. And the guard on the focus move
 * means a back control that survives its own navigation keeps focus, exactly as a tab does.
 *
 * ## What the layout effect buys, against the two interactions that could have broken
 *
 *  · **The collapsing headers' sentinels** (`shell/CollapsingHeader.tsx`, on Route detail and Place
 *    detail). The header collapses when an `IntersectionObserver` stops seeing a marker `COLLAPSE` px down
 *    the page. A reset that ran *after* paint would let the observer see the new screen at the previous
 *    screen's offset, collapse the header, then expand it a frame later — a visible flicker on exactly the
 *    two screens whose header is their identity. A `useLayoutEffect` completes before the browser's
 *    rendering steps, so the observer only ever sees the final offset. **Reasoned, not measured:** jsdom
 *    has no `IntersectionObserver` at all, which is why that component guards for it and why no suite in
 *    this repo can see a collapse either way.
 *  · **Route detail's reveal** of the boarding stop (`screens/RouteDetail.tsx`), which is a *passive*
 *    effect that fires once, on the commit where the row exists. Passive effects run after every layout
 *    effect in the same commit, and in later commits this hook is not running at all, so the reveal always
 *    has the last word. On a `POP` back into Route detail this hook moves focus and announces but does not
 *    scroll, and the focus move carries `preventScroll` — so the reveal is untouched in that direction too.
 *
 * ## The focus move is conditional, and the condition is the interesting part
 *
 * Focus moves **only when the navigation orphaned it** — when the element that was focused has gone and
 * the document has fallen back to `<body>`. That single test gets three cases right at once:
 *
 *  · A rider taps a card: the card is unmounted, focus is on `<body>`, and it moves to the new screen's
 *    `<main>` so a screen reader's cursor starts on the new page instead of at the top of the document.
 *  · A rider switches **tabs**: the tab link is still there and still focused, which is what a tab row is
 *    supposed to do. Focus is left alone and the live region does the telling.
 *  · **Search autofocuses its field.** React runs a host node's `autoFocus` during the same commit phase as
 *    layout effects and in tree order, so by the time this runs — the announcer is declared *after*
 *    `<Outlet/>` in `App.tsx` — the field already holds focus and the test above declines to take it. The
 *    rider gets the keyboard, as they do today. **Both halves were measured rather than reasoned:** with the
 *    guard removed this steals the keyboard and the tab's focus, and `test/navigation-a11y.test.tsx` was
 *    watched failing on exactly that injection. The declaration order is *not* what saves it — the announcer
 *    works from either side of the outlet — but declaring it after is the honest expression of the rule: the
 *    shell is the fallback, and it asks only once the new screen has had its own commit to claim focus.
 *
 * `preventScroll` on the focus call, because focus and scroll are the same instant here: the default
 * behaviour of `.focus()` is to scroll the element into view, which on a `POP` would undo the browser's
 * restore. It is what makes running the focus move on a back navigation free — and it is load-bearing
 * rather than cautious, since a `POP` is precisely when the document is *not* meant to be at the top.
 *
 * ## What it announces, and the one gap
 *
 * The destination's own name, from the catalogue, in the active locale — the label the tab bar already
 * draws, read off the matched route's `handle` rather than looked up, so this adds no second table (the
 * route table in `App.tsx` puts the `Destination` there). Two of the eight have no name: a place and a
 * route are titled by **bus data**, which is `I18nText` from the model and is in no catalogue (CLAUDE.md
 * rule 5). Those clear the region rather than inventing a word for it, and still get the focus move —
 * naming them needs a new i18n key, which is a decision for `packages/i18n` rather than for the shell.
 */
export function useNavigationMoment(): string {
  const { key } = useLocation()
  const navigationType = useNavigationType()
  const matches = useMatches()
  const locale = useLocale()
  /** What the live region is saying — empty until the first navigation, so a page load announces nothing. */
  const [announcement, setAnnouncement] = useState('')
  /** The entry we last acted on. `null` until the first commit has been seen. */
  const previousKey = useRef<string | null>(null)

  // The leaf route's `handle` is the `Destination` it was declared from. Indexing the last match is
  // react-router's own idiom for "the route that actually matched"; the parent routes here carry no handle.
  const leaf = matches[matches.length - 1]
  const titleKey = destinationOf(leaf?.handle)?.titleKey

  useLayoutEffect(() => {
    const previous = previousKey.current
    previousKey.current = key
    // The first commit (and `<StrictMode>`'s replay of it) is a page load, not a navigation.
    if (previous === null || previous === key) return
    // Search rewrites its URL per keystroke — see the header. A replace is not an arrival.
    if (navigationType === 'REPLACE') return
    // A push is the one direction that inherits an offset; a pop is the browser's to restore.
    //
    // `behavior: 'instant'` rather than the two-argument form, so that a future `scroll-behavior: smooth`
    // in `index.css` cannot turn this into an animation the collapsing headers' observers would watch
    // travel. An unknown `behavior` is a `TypeError` rather than a fallback, so it is worth naming the
    // floor: Safari has taken the keyword since 15.4, which is also the release that shipped `dvh` — a unit
    // this app's every screen is laid out in, so the value adds no requirement it did not already have.
    if (navigationType === 'PUSH') window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    // **These two are not gated, and that is the decision** — a `POP` is an arrival even though it is not a
    // scroll problem. Nothing else tells a screen-reader rider that Back changed the page, and react-router
    // restores no focus, so the cursor would be left on `<body>`. See the header.
    focusScreen()
    setAnnouncement(titleKey === undefined ? '' : t(locale, titleKey))
  }, [key, navigationType, titleKey, locale])

  return announcement
}

/**
 * Hand the new screen's `<main>` the focus the navigation dropped.
 *
 * `tabIndex` is assigned rather than rendered because the shell does not own any screen's markup, and every
 * one of the eight has exactly one `<main>` as its root element. A container focused this way is not a tab
 * stop — it takes focus once, programmatically, and the next Tab continues from inside the new screen,
 * which is the whole point.
 */
function focusScreen(): void {
  const active = document.activeElement
  // Something still holds focus deliberately — a tab link that survived the navigation, or a control a
  // screen has claimed. Moving it would be the shell overruling them.
  if (active !== null && active !== document.body) return
  const main = document.querySelector('main')
  if (main === null) return
  main.tabIndex = -1
  main.focus({ preventScroll: true })
}

/** The `Destination` a route was declared from, as react-router hands it back (`handle` is `unknown`). */
function destinationOf(handle: unknown): Destination | undefined {
  return typeof handle === 'object' && handle !== null && 'path' in handle
    ? (handle as Destination)
    : undefined
}
