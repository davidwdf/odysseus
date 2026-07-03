import { Navigation2 } from 'lucide-react-native'
import { Platform, View, type ViewStyle } from 'react-native'
import { Icon, type IconTone } from './Icon'

// The bearing glyph, and how far its own default orientation sits from North (up), clockwise.
// `Navigation2` is a symmetric cone that points straight **up (north)** by default, so no offset is
// needed. Swap these two lines to trial another glyph (e.g. `ArrowDownToDot` with a 180° offset,
// which points down to its dot by default).
const GLYPH = Navigation2
const GLYPH_NORTH_OFFSET = 0

// Inline fine-tuning (web): a small vertical nudge (px, +down) so the glyph sits optically on the
// text rather than on the taller line-box centre, and a right-margin trim so the label tucks closer.
const INLINE_NUDGE = -1.5
const INLINE_GAP_TRIM = -2

/**
 * A compass cue rotated to a place's travel bearing (0° = North = up, increasing clockwise), so it
 * points the physical way buses leave the stop. The rotation is **snapped to the nearest of the 8
 * compass points** so it agrees with the octant label from `formatBearing` ("Westbound") — a
 * slightly-off raw angle reads as wrong (ADR-042).
 *
 * Pass `circle` to wrap it in a small dial (a bordered ring with a fixed north tick). Pass `inline`
 * to sit it *within* a line of text (it rides the first line and the text wraps beneath it) rather
 * than as a flex sibling that centres against the whole block. `size` is the dial diameter when
 * `circle`, else the glyph size.
 *
 * The rotation lives on a wrapping `View`, not the SVG itself: an SVG `transform` rotates about the
 * (0,0) origin and spins the glyph out of its own box (clipped / blank), whereas a View rotates
 * about its centre.
 */
export function BearingArrow({
  bearingDeg,
  size = 14,
  tone = 'subtle',
  circle = false,
  inline = false,
}: {
  bearingDeg: number
  size?: number
  tone?: IconTone
  circle?: boolean
  inline?: boolean
}) {
  const snapped = Math.round(bearingDeg / 45) * 45 // nearest of the 8 compass points
  const rotate = snapped + GLYPH_NORTH_OFFSET
  // When inline, flow with the surrounding text (web: an inline-block box that rides the text
  // baseline, so wrapped lines run underneath rather than indenting past a flex sibling). `middle`
  // centres on the *line box*, which sits above the text's optical (x-height) centre — so a centred
  // glyph reads as high; INLINE_NUDGE lands it on the text.
  const inlineWeb = inline && Platform.OS === 'web'
  const inlineStyle = inlineWeb
    ? ({
        display: 'inline-block',
        verticalAlign: 'middle',
        marginRight: INLINE_GAP_TRIM,
      } as unknown as ViewStyle)
    : null
  const transform = inlineWeb
    ? [{ translateY: INLINE_NUDGE }, { rotate: `${rotate}deg` }]
    : [{ rotate: `${rotate}deg` }]
  const needle = (
    <View style={[{ transform }, inlineStyle]}>
      <Icon icon={GLYPH} tone={tone} size={circle ? Math.round(size * 0.6) : size} />
    </View>
  )
  if (!circle) return needle
  return (
    <View
      className="items-center justify-center rounded-full border border-border bg-surface-2"
      style={{ width: size, height: size }}
    >
      {/* Fixed north reference tick at the top of the dial. */}
      <View className="absolute inset-x-0 items-center" style={{ top: 1.5 }}>
        <View className="rounded-full bg-subtle" style={{ width: 2, height: 4 }} />
      </View>
      {needle}
    </View>
  )
}
