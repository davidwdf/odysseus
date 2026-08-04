/**
 * The bottom bar's geometry, in one place — the web counterpart of
 * `apps/mobile/lib/tabBarLayout.ts`, and it exists for the same reason: the bar is taken out of
 * layout flow, so the bar and every screen that must not hide content behind it have to agree.
 *
 * Only two numbers, because the web bar is not the floating glass pill. Material, elevation and shape
 * are **idiom** under ADR-075; what is identity is that a tab is at least 44×44 px, which
 * `TAB_BAR_HEIGHT` is what guarantees here.
 */

/** Bar height in px. 56 leaves the glyph-over-label stack a ≥44 px target with room to breathe. */
export const TAB_BAR_HEIGHT = 56

/**
 * What a screen must leave clear at the bottom.
 *
 * `env(safe-area-inset-bottom)` rather than a fixed pad: on an installed iOS PWA the home indicator
 * eats the last ~34 px, and `index.html` already asks for `viewport-fit=cover` so the value is
 * non-zero there and exactly `0px` everywhere else. It is a `calc()` string rather than a Tailwind
 * class because `env()` cannot be resolved at build time, which is what an arbitrary-value class does.
 */
export const CONTENT_INSET = `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`
