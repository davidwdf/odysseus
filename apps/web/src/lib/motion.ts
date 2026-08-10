/**
 * Whether the rider has asked for less motion.
 *
 * Lifted out of `components/JourneyLines.tsx`, where it was private, because `useRailFlip` needs the same
 * answer — and a second copy of a media query is how two pieces of one screen come to disagree about a
 * setting. It is the **JavaScript** reading of it, which some motion on this screen has no choice but to
 * take: a `@media (prefers-reduced-motion)` block reaches CSS animations and transitions, and reaches
 * neither a Web Animations call nor a decision about how many elements to put in the tree at once
 * (ADR-104).
 *
 * Guarded like `lib/appearance.ts`'s dark-mode query, and for the same two reasons: `matchMedia` is absent
 * in some embedded WebViews and in jsdom, where every conformance suite runs — and there, *not* animating
 * is the safe answer.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia(REDUCE_QUERY).matches
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'
