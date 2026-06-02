import { FONT_FAMILY, type FontWeightName, TYPE_SCALE, type TypeVariant } from '@nextbus/ui'
import { Text as RNText, type TextProps as RNTextProps } from 'react-native'

type TextProps = RNTextProps & {
  /** Type role from the scale (docs/09 §3). Carries size, line-height and a default weight. */
  variant?: TypeVariant
  /** Override the variant's default weight. */
  weight?: FontWeightName
  /** Tabular figures — fixed-width digits so numbers don't jiggle when they update (ETAs, route nos). */
  tabular?: boolean
}

/**
 * The single typography primitive. Encodes the named type scale + the correct
 * Inter cut per weight so type is consistent everywhere; colour and layout stay
 * as semantic-token classNames (`text-text`, `text-muted`, `text-accent`…).
 */
export function Text({ variant = 'body', weight, tabular, style, ...rest }: TextProps) {
  const scale = TYPE_SCALE[variant]
  const fontFamily = FONT_FAMILY[weight ?? scale.weight]
  return (
    <RNText
      {...rest}
      style={[
        { fontSize: scale.fontSize, lineHeight: scale.lineHeight, fontFamily },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  )
}
