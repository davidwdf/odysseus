/**
 * Front-view double-decker bus — the DOM twin of `apps/mobile/components/BusGlyph.tsx`, rect for rect.
 *
 * A custom Lucide-style line glyph on a 24 px grid with round caps and joins and a 2 px stroke, because
 * **Lucide has no double-decker** and this app is about Hong Kong buses. It echoes the app icon's decker
 * DNA head-on: two glazed window bands whose *gap* is the deck split (there is no divider line), spaced in
 * an even vertical rhythm — roof, between, base. The tyres are solid pills peeking below the body; at a
 * 2 px stroke their interior is too small to be worth outlining (`docs/09`, ADR-030).
 *
 * `apps/web` drew Lucide's stock `BusFront` here until the owner's review, and that was never a decision —
 * `docs/09-theme.md` has said the schematic uses this glyph since Wave 1. The RN version is
 * `react-native-svg`; this is the same markup in the DOM's own `<svg>`, which is why it is a port rather
 * than a redraw.
 */
export function BusGlyph({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  // `currentColor` throughout, so the caller sets the colour with a text utility and light/dark follow the
  // token — where the RN twin has to resolve `--accent-contrast` through `useTheme()` by hand.
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
      // The token that wraps this carries `role="img"` and the kernel's own accessible name
      // (`RailBus.label`), so the glyph itself must be silent — a second name here would have a screen
      // reader announce the bus twice. `aria-hidden="true"` rather than bare, which is what Biome's
      // `noSvgWithoutTitle` accepts as the deliberate form.
      aria-hidden="true"
      focusable="false"
    >
      {/* body — tall, like a decker seen head-on */}
      <rect x="5" y="3" width="14" height="15.5" rx="2.5" {...s} />
      {/* upper-deck window band */}
      <rect x="8" y="6.3" width="8" height="2.8" rx="1" {...s} />
      {/* lower-deck window band (the gap between the bands is the deck split) */}
      <rect x="8" y="12.4" width="8" height="2.8" rx="1" {...s} />
      {/* front-view tyres — solid pills peeking below the body */}
      <rect x="6.4" y="18.5" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="18.5" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </svg>
  )
}
