// Typography tokens — the named type scale from docs/09 §3, as data so the
// platform `<Text>` primitive can apply size + line-height + the correct font
// cut. Components reference roles (`display`, `h1`, `body`…), never raw sizes,
// so type stays consistent across every screen.

/** Inter is loaded as discrete weight cuts (see apps/mobile/app/_layout.tsx).
 *  RN `fontFamily` is single-valued, so we map a weight to its exact registered
 *  family name; CJK glyphs fall back to the OS face (PingFang/Noto). */
export type FontWeightName = 'regular' | 'medium' | 'semibold' | 'bold'

export const FONT_FAMILY: Record<FontWeightName, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
}

/** The font cuts that must be loaded for the scale above to render. */
export const FONT_ASSETS = Object.values(FONT_FAMILY)

export type TypeVariant = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'label' | 'caption'

export interface TypeStyle {
  fontSize: number
  lineHeight: number
  weight: FontWeightName
}

/** docs/09 §3 — mobile-first, 16px base. `display` is the hero ETA numeral. */
export const TYPE_SCALE: Record<TypeVariant, TypeStyle> = {
  display: { fontSize: 40, lineHeight: 44, weight: 'bold' },
  h1: { fontSize: 28, lineHeight: 34, weight: 'bold' },
  h2: { fontSize: 22, lineHeight: 28, weight: 'semibold' },
  h3: { fontSize: 18, lineHeight: 24, weight: 'semibold' },
  body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
  label: { fontSize: 14, lineHeight: 20, weight: 'medium' },
  caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
}
