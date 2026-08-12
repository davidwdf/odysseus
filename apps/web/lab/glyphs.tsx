/**
 * The bus glyphs' "before" — one drawing, kept for comparison (ADR-112).
 *
 * **The candidates are gone, and that is deliberate.** Seven rounds of proposals lived here — headlight
 * dots, a bumper line, Lucide stroke wheels, radius sweeps, window-height sweeps, fill-only tyres — and all
 * of them are now either shipped or rejected. A lab full of rejected drawings rots: the next reader cannot
 * tell a live option from a dead one, and the *reasoning* is what has value, not the geometry.
 *
 * So the reasoning lives in three places that cannot drift from the code: **ADR-132** (the decisions, and
 * what each rejected option cost), **`docs/09` §8** (the radius and pill rules, which had never been written
 * down at all), and the shipped `apps/web/src/components/BusGlyph.tsx` docblock (why each number is what it
 * is).
 *
 * What stays is `DeckerD0` — the glyph that shipped from Wave 1 until ADR-132 — because *"is the new one
 * better?"* is a question somebody will ask again, and answering it needs the old one on screen rather than
 * described.
 */

interface GlyphProps {
  size?: number
  strokeWidth?: number
}

/**
 * **D0 — what shipped from Wave 1 to ADR-132.** Body 14 × 15.5 from y=3, two 2.8 bands, body `rx` 2.5, tyre
 * pills painted 4.4 × 4.6.
 *
 * Three of its numbers were never decisions, which is most of why it changed: the body radius (Lucide uses
 * 2 for an outer shape), the tyre size (a hand-picked value whose *painted* width nobody had computed), and
 * the band height, which left the squash animation compressing an already-short bus.
 */
export function DeckerD0({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = {
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="5" y="3" width="14" height="15.5" rx="2.5" {...s} />
      <rect x="8" y="6.3" width="8" height="2.8" rx="1" {...s} />
      <rect x="8" y="12.4" width="8" height="2.8" rx="1" {...s} />
      <rect x="6.4" y="18.5" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="18.5" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </svg>
  )
}
