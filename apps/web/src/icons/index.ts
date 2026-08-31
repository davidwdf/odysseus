import { createLucideIcon } from 'lucide-react'

/**
 * **Icons we draw ourselves — built the way `lucide-react` builds its own.**
 *
 * ## The rule, in one line
 *
 * *Import from `lucide-react`. If the glyph does not exist there, define it **here** with
 * `createLucideIcon` — never inline an `<svg>` in a component.*
 *
 * ## Why `createLucideIcon` rather than a hand-written component
 *
 * Because it makes ours the *same kind of thing* as theirs, not merely a lookalike. The factory returns
 * a genuine `LucideIcon`, so a custom glyph:
 *
 * - takes the identical props — `size`, `strokeWidth`, `absoluteStrokeWidth`, `color`, `className`, and
 *   every `SVGProps` besides;
 * - inherits the house style automatically — the 24x24 grid, `fill="none"`, `stroke="currentColor"`,
 *   `stroke-width: 2`, round caps and joins — so it cannot drift from the ~19 lucide glyphs beside it;
 * - **satisfies the `LucideIcon` type**, which this codebase already uses as a prop across
 *   `shell/destinations.ts`, `components/BottomSheet.tsx` (`SheetAction`) and `RouteFactSheet`. A
 *   hand-rolled `({ size }) => <svg/>` would have to be widened into each of those signatures one at a
 *   time; this one just slots in.
 *
 * That last point is the whole argument. Before this file, `MapControls` drew two glyphs as inline
 * `<path>` children of its own `<svg>` wrapper, which is why the owner read one of them as *"the button
 * with the squiggle in the brackets"* — it was outside the system, so nothing kept it to the system's
 * shapes.
 *
 * ## What does NOT belong here
 *
 * **The map's own glyphs.** `routeMarkerElement.ts` and `riderMarkElement.ts` emit SVG **strings** into
 * DOM elements MapLibre owns, and they are not on the 24-grid: a stop marker's geometry is the same
 * answer `routeMarkers` gives the rail (ADR-158), and a rider mark's rotation is a bearing. They are
 * data drawn at a size, not icons. `BusGlyph` is the third of these — it is a token that moves along a
 * rail and morphs between three shapes, so it owns its `clip-path` and its viewBox.
 *
 * ## The native port
 *
 * `lucide-react-native` ships the same glyph set under the same names and exports the same
 * `createLucideIcon`, so this file crosses by changing one import — which is the test CLAUDE.md rule 4
 * applies to any component, and the reason the icons are declared as path data rather than as JSX.
 */

/**
 * **JoyYou Card** — the $2 Scheme concession (`fares#joyYouFare`).
 *
 * A payment card with a heart in it. Deliberately *not* lucide's `Accessibility`, which was the first
 * thing reached for: that glyph is a wheelchair, and it names the smaller half of who the scheme is for.
 * The beneficiaries are Hong Kong residents **aged 60 or above** plus eligible persons with disabilities
 * under 60 — so an icon that draws a wheelchair tells most of them the concession is not theirs.
 *
 * A card says the true common thing about all of them: they tap a card, and the card is the eligibility.
 * The heart is what separates it from lucide's plain `CreditCard` (which this screen uses for the fare
 * fact) and reads as *concession* rather than *payment*. It also matches the physical article — the
 * JoyYou Card is an on-loan personalised Octopus, and "the green card" is how a rider thinks of it.
 *
 * The stripe a credit card would have is left off on purpose: at 18 px it and the heart compete, and the
 * heart is the half of the glyph carrying the meaning.
 */
export const JoyYouCard = createLucideIcon('JoyYouCard', [
  ['rect', { width: '20', height: '14', x: '2', y: '5', rx: '2', key: 'card' }],
  // A symmetric heart on the card's centre: tip at (12, 14.6), lobes struck as two arcs, shoulders at
  // (8.5, 10.5) and (15.5, 10.5). Its visual centre is 12.05 against the card's 12, which is the half-
  // pixel low that stops a heart looking like it is floating.
  [
    'path',
    {
      d: 'M12 14.6c-1.9-1.4-3.5-2.6-3.5-4.1a1.9 1.9 0 0 1 3.5-1 1.9 1.9 0 0 1 3.5 1c0 1.5-1.6 2.7-3.5 4.1Z',
      key: 'heart',
    },
  ],
])
