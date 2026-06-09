import Svg, { Rect } from 'react-native-svg'

/**
 * Front-view double-decker bus — a custom Lucide-style line glyph (24px grid, round
 * caps/joins, 2px stroke to match the Lucide set) since Lucide has no double-decker.
 * Echoes the app icon's decker DNA, reworked head-on: two glazed window bands whose gap
 * *is* the deck split (no divider line), spaced in an even vertical rhythm (roof = between
 * = base). Front-view tyres are solid pills at the corners — at a 2px stroke their interior
 * is too small to bother outlining (docs/09, ADR-030). Reads best as a token travelling
 * *down* the vertical schematic.
 */
export function BusGlyph({
  size = 18,
  color = 'currentColor',
  strokeWidth = 2,
}: {
  size?: number
  color?: string
  strokeWidth?: number
}) {
  const s = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* body — tall, like a decker seen head-on */}
      <Rect x="5" y="3" width="14" height="15.5" rx="2.5" {...s} />
      {/* upper-deck window band */}
      <Rect x="8" y="6.3" width="8" height="2.8" rx="1" {...s} />
      {/* lower-deck window band (the gap between the bands is the deck split) */}
      <Rect x="8" y="12.4" width="8" height="2.8" rx="1" {...s} />
      {/* front-view tyres — solid pills peeking below the body */}
      <Rect x="6.4" y="18.5" width="2.4" height="2.6" rx="1" fill={color} {...s} />
      <Rect x="15.2" y="18.5" width="2.4" height="2.6" rx="1" fill={color} {...s} />
    </Svg>
  )
}
