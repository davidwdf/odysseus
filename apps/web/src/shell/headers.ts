import {
  ABOUT_PATH,
  type Destination,
  FAQ_PATH,
  NEARBY_PATH,
  PLACE_PATH,
  ROUTE_PATH,
  SEARCH,
  SETTINGS_PATH,
} from './destinations'

/**
 * **Which header a screen gets, written down once** — the taxonomy `docs/07` had been owing since
 * 2026-08-12 (*"Header rules, written down and testable — and yes, this belongs in the design system"*)
 * and [ADR-169](../../../../docs/08-decision-log.md) settles.
 *
 * Until now the rules were scattered across [ADR-033](../../../../docs/08-decision-log.md) (the title
 * morphs into a pill beside the back lens), `CollapsingHeader` and its wrappers, ADR-039 (the back control
 * is a floating lens fixed to the top) and ADR-156 (the route screen's context card), and **there was no
 * statement anywhere of which kind of screen gets which**. Eight screens had four different answers and
 * nothing said whether that was design or drift.
 *
 * It is design. This file is that statement, as data rather than as prose, so the parts of it a suite can
 * see are checked rather than described — see `test/header-taxonomy.test.tsx`.
 *
 * ## The taxonomy falls out of two questions, which is why there are four kinds and not three
 *
 * The first draft of this (proposals/07 §7a) proposed three, by lumping the pushed screens together. The
 * code disagreed, and the code was right: *"a static page"* is one thing when it is a tab root that owes
 * the rider no way back, and a different thing when it is pushed and must offer one at any scroll offset.
 * So:
 *
 * |               | title sits in flow | title collapses | title floats over a map |
 * |---------------|--------------------|-----------------|-------------------------|
 * | **no back**   | `root`             | —               | —                       |
 * | **back**      | `pushed`           | `collapsing`    | `map`                   |
 *
 * The three empty cells are not gaps to be filled. A root screen with a collapsing title is a screen whose
 * chrome moves and offers nothing to move *for* — the collapse exists to keep a back control reachable
 * while the title gets out of the way. A root screen over a map is the one cell worth revisiting, and
 * `proposals/07`'s Home is exactly the proposal to fill it (rung 3): Home is a tab root **and** map-backed,
 * which is why it will need a fifth kind or a widened `map`. Recorded here so that arrives as a deliberate
 * edit to a declared set rather than as a fifth undeclared answer.
 *
 * ## What is enforced and what is not — stated, because the honest half is short
 *
 * ⚠️ **No suite in this repo can watch a header collapse.** jsdom has no `IntersectionObserver`, which
 * `test/navigation-a11y.test.tsx` already says at length. So `collapse` below is `unenforced` and says so
 * in the same vocabulary the published component specs use for a state nothing checks — a rule nobody can
 * fail is prose, and prose that calls itself a rule is worse than prose.
 *
 * What a suite *can* see, and therefore what is checked: whether a back control is present, who owns the
 * vertical scroll, and that every declared destination appears here at all. The last is the one that
 * matters most in practice — it is what makes a ninth screen a decision rather than an eighth guess.
 *
 * ## Writing this down found something, which is the usual outcome and the reason to do it
 *
 * The first draft made **scroll ownership a property of the header kind** — `pushed` screens scroll the
 * page, `map` screens hand the gesture to a sheet. Search disproves it: it is a `pushed` screen and it is
 * `flex h-dvh overflow-hidden` with an inner scroller, because the field must not scroll away under a
 * typing thumb and because ADR-109 restores that inner offset against the history key. So the two are
 * independent axes and {@link SCROLL_OWNER} is its own declaration. A taxonomy that had been written as
 * prose would have said "pushed screens scroll the page", and been wrong about a shipping screen.
 */
export type HeaderKind = 'root' | 'collapsing' | 'pushed' | 'map'

/** What a rider must be able to do on a screen of this kind, and what actually checks it. */
export interface HeaderRule {
  /** A back control, reachable at **any** scroll offset (ADR-039 makes it `fixed`, so "any" is free). */
  readonly back: boolean
  /**
   * What the screen's own title does.
   *
   * `inFlow` — an `<h1>` that scrolls away with the content, because on a root screen the title is
   * content rather than chrome and there is nothing underneath it to keep reachable.
   * `collapses` — `CollapsingHeader`'s morph into a pill beside the back lens (ADR-033).
   * `floats` — a pane over a map, collapsing by width into a pill (ADR-156).
   */
  readonly title: 'inFlow' | 'collapses' | 'floats'
  /** May the header carry actions other than back? Settled as **no** — see ADR-169 decision 4. */
  readonly actions: false
  /** What checks the parts of this that a suite can see. */
  readonly enforcement: string
}

export const HEADER_RULES: Record<HeaderKind, HeaderRule> = {
  /** Nearby, Favourites, Settings — switched to, never pushed. The title is the first thing in flow. */
  root: {
    back: false,
    title: 'inFlow',
    actions: false,
    enforcement: 'test/header-taxonomy.test.tsx — no back control, and an <h1> in flow',
  },
  /** Place detail. The title is bus data, long, bilingual, and worth the morph (ADR-033). */
  collapsing: {
    back: true,
    title: 'collapses',
    actions: false,
    enforcement:
      'test/header-taxonomy.test.tsx — a back control. The COLLAPSE ITSELF IS UNENFORCED: jsdom has no IntersectionObserver.',
  },
  /** Search, About the data, the FAQ. Pushed, but with a title short enough that a morph would be motion
   *  for its own sake — and, on Search, a field that must not move under a typing thumb. */
  pushed: {
    back: true,
    title: 'inFlow',
    actions: false,
    enforcement: 'test/header-taxonomy.test.tsx — a back control, and an <h1> in flow',
  },
  /** Route detail, and Home from rung 3 (proposals/07). The map is the screen; everything floats. */
  map: {
    back: true,
    title: 'floats',
    actions: false,
    enforcement:
      'test/header-taxonomy.test.tsx — a back control, and `fixed inset-0` rather than a scrolling page. The collapse itself is unenforced.',
  },
}

/**
 * Every destination's kind. **Exhaustive over `DESTINATIONS`**, and `test/header-taxonomy.test.tsx`
 * fails in both directions — a destination with no kind, and a kind for a destination that does not
 * exist. `screenFor`'s switch already makes a destination with no screen a typecheck failure; this is
 * the same rule for its chrome, and for the same reason: the set is small, and the moment it is not
 * declared it becomes eight independent decisions.
 */
export const HEADER_KIND = {
  // Home. `root` still, and it stays `root` until it gets a map (`proposals/07` rung 3) — which is the
  // one empty cell of the table above worth revisiting, and a deliberate edit when it comes.
  [NEARBY_PATH]: 'root',
  // Settings stopped being a tab when the bar retired (ADR-181) and is pushed from a lens now, so it
  // owes the rider a way back. The taxonomy caught this the moment the destination moved: a screen that
  // changes how it is reached changes what it owes, and nothing else in the codebase says so.
  [SETTINGS_PATH]: 'pushed',
  [SEARCH.path]: 'pushed',
  [ABOUT_PATH]: 'pushed',
  [FAQ_PATH]: 'pushed',
  [PLACE_PATH]: 'collapsing',
  [ROUTE_PATH]: 'map',
} satisfies Record<string, HeaderKind>

/**
 * **Who owns the vertical scroll on each screen** — a second axis, not a consequence of the first.
 *
 * `page` — the document scrolls; the screen is `min-h-dvh` and the browser does the work.
 * `inner` — the screen is viewport-height with `overflow-hidden`, and a child scrolls. Search is this,
 * and it is a considered choice rather than a layout accident: the query field stays put while results
 * move under it, and the inner offset is what ADR-109 restores against the history key.
 * `sheet` — the document does not scroll at all; the screen is `fixed inset-0` and a `DraggableSheet`
 * owns the gesture. **Two scrollers on one screen is what makes a draggable sheet fight the document**,
 * and ADR-156 removed the page scroll precisely to stop that.
 *
 * The distinction between `inner` and `sheet` is the gesture, not the DOM: both hand scrolling to a
 * child, and only one of them also lets the rider drag the child itself between detents.
 */
export const SCROLL_OWNER = {
  [NEARBY_PATH]: 'page',
  [SETTINGS_PATH]: 'page',
  [SEARCH.path]: 'inner',
  [ABOUT_PATH]: 'page',
  [FAQ_PATH]: 'page',
  [PLACE_PATH]: 'page',
  [ROUTE_PATH]: 'sheet',
} satisfies Record<string, ScrollOwner>

export type ScrollOwner = 'page' | 'inner' | 'sheet'

/** Who scrolls on `destination`, or `undefined` if it has not declared it. */
export function scrollOwnerFor(destination: Destination): ScrollOwner | undefined {
  return (SCROLL_OWNER as Record<string, ScrollOwner | undefined>)[destination.path]
}

/** The kind `destination` is chromed with, or `undefined` if it has not declared one. */
export function headerKindFor(destination: Destination): HeaderKind | undefined {
  return (HEADER_KIND as Record<string, HeaderKind | undefined>)[destination.path]
}
