/**
 * The bottom bar's geometry, in one place — the web counterpart of `apps/mobile/lib/tabBarLayout.ts`,
 * and it exists for the same reason: the bar is taken out of layout flow, so the bar and every screen
 * that must not hide content behind it have to agree.
 *
 * **These are `apps/mobile`'s numbers, deliberately, and that is a change.** This file used to carry two
 * numbers with a note saying the web bar "is not the floating glass pill" because material, elevation and
 * shape are idiom under ADR-075. The owner's answer is that the app's *signature* material and motion are
 * identity and only platform-conventional detail is idiom — so the pill, its inset, its radius and the
 * lens beside it are the same on both renderers, and each value below is the RN one it is named after.
 */

/** Bar height in px — `TAB_BAR_HEIGHT` in `apps/mobile/lib/tabBarLayout.ts`.
 *
 *  54 is sized snug around the 28 px icon wrapper plus the 16 px label line plus the item's 5 px of
 *  padding top and bottom, so the stack centres with no slack. It still clears the ≥44 px touch target
 *  that ADR-075 puts on the identity side — which is worth saying because the old comment claimed 56 was
 *  what guaranteed it, and the guarantee is the *minimum*, not the number. */
export const TAB_BAR_HEIGHT = 54

/** The gap around the floating bar — `TAB_BAR_GAP`. Used four ways: the inset from each side edge, the
 *  gap between the pill and the search lens, and the floor under the bottom safe-area inset. */
export const TAB_BAR_GAP = 12

/** The pill's corner radius. `rounded-pill` in the generated preset is exactly this, so the class and
 *  this constant cannot drift — it is `RADIUS.pill`, which `apps/mobile` reads as `TAB_BAR_RADIUS`. */
export const TAB_BAR_RADIUS = 24

/** The circular search lens — the same size as the bar is tall, so the two read as one row. */
export const LENS_SIZE = TAB_BAR_HEIGHT

/**
 * What a screen must leave clear at the bottom.
 *
 * The literal translation of `useTabBarLayout().contentInset`, which is
 * `max(insets.bottom, GAP) + HEIGHT + GAP`. The `max()` is the load-bearing part: on an installed iOS PWA
 * the home indicator eats ~34 px and `index.html` already asks for `viewport-fit=cover`, so the inset is
 * non-zero there; everywhere else it is `0px` and the 12 px floor is what keeps the bar floating rather
 * than sitting on the screen edge.
 *
 * A `calc()` string rather than a Tailwind class because `env()` cannot be resolved at build time, which
 * is what an arbitrary-value class would try to do.
 */
export const BAR_BOTTOM = `max(env(safe-area-inset-bottom, 0px), ${TAB_BAR_GAP}px)`
export const CONTENT_INSET = `calc(${BAR_BOTTOM} + ${TAB_BAR_HEIGHT}px + ${TAB_BAR_GAP}px)`

/**
 * What a screen must leave clear at the **top** — new, and it closes an amber the parity audit raised
 * before the owner's feedback turned it into a blocker.
 *
 * `index.html` opts into `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style=black-translucent`,
 * and until now **nothing on the web side read the top inset at all** — so on an installed iOS PWA every
 * heading and the back control drew under the status bar. `apps/mobile` gets this free from
 * `useSafeAreaInsets().top`; the DOM has to ask.
 */
export const CONTENT_INSET_TOP = 'env(safe-area-inset-top, 0px)'

/**
 * The height of the **collapsed** header bar, safe area included — what a sticky element must clear to
 * pin below the chrome rather than under it.
 *
 * The 60 is `.collapsing-header[data-collapsed="true"]`'s own height in `index.css`, and the two are
 * two spellings of one number: a sticky map offset by less pins *behind* the bar, which is not a subtle
 * failure — it hides the top of whatever is stuck there. Declared here rather than inlined at the one
 * call site because the next thing that sticks under this header will need it too, and because the pair
 * being in two files is exactly the kind of thing that drifts silently.
 */
export const COLLAPSED_HEADER_TOP = `calc(${CONTENT_INSET_TOP} + 60px)`
