// Turning a platform-neutral shadow token into the style a platform actually understands.
//
// `ELEVATION` used to be shaped `{ ios: {shadowColor, shadowOpacity, …}, android: {elevation} }`,
// which put React Native's vocabulary in the token layer and left web out entirely — so every
// web consumer hand-wrote its own `boxShadow` string with its own literal colour (MiniMap did
// exactly that). The token is now geometry plus an optional Material step, and the *mapping* to
// a platform lives here, in one function, for all three targets. packages/ui stays RN-free: this
// returns plain objects, it does not import react-native.

import { ELEVATION, type ShadowToken } from './tokens.generated'

/** Every elevation recipe there is, including the ones off the e-scale. */
export type ElevationName = keyof typeof ELEVATION

/**
 * The depth scale a surface may sit on — `e0`…`e3`. Derived from the token names rather than
 * listed again, so `Card level=` can't accept `pin` and a new `e4` needs no edit here.
 */
export type ElevationLevel = Extract<ElevationName, `e${number}`>

/** Which recipe to build. Anything that isn't web or Android gets the iOS `shadow*` quartet. */
export type ElevationTarget = 'ios' | 'android' | 'web'

/**
 * A shadow as a style object. Every field is optional because the three targets share no key:
 * one interface (rather than a union) keeps it directly assignable to an RN `ViewStyle`, which
 * is where all three of them end up.
 */
export interface ElevationStyle {
  shadowColor?: string
  shadowOpacity?: number
  shadowRadius?: number
  shadowOffset?: { width: number; height: number }
  elevation?: number
  boxShadow?: string
}

/** `Platform.OS` → the recipe to build. Windows and macOS take the iOS shadow, as RN does. */
export const elevationTarget = (os: string): ElevationTarget =>
  os === 'web' ? 'web' : os === 'android' ? 'android' : 'ios'

const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** One shadow token as a CSS `box-shadow` value — the web recipe, and what `GlassView` composes. */
export const cssShadow = (s: ShadowToken): string =>
  `${s.inset ? 'inset ' : ''}${s.offsetX}px ${s.offsetY}px ${s.blur}px${
    s.spread ? ` ${s.spread}px` : ''
  } ${rgba(s.color, s.opacity)}`

/** Several stops, comma-joined — CSS paints the first on top, which is the order declared. */
export const webBoxShadow = (stops: readonly ShadowToken[]): string =>
  stops.map(cssShadow).join(', ')

/**
 * The style for an elevation token on one platform.
 *
 * A shadow with no opacity is no shadow, so `e0` collapses to an empty object on every target
 * rather than to a `shadowOpacity: 0` that has to be carried around. Android prefers its
 * Material `elevation` step where the token declares one; where it doesn't (a map pin is an
 * overlay, not a surface) it draws the same geometry as iOS. `shadowRadius` is the token's CSS
 * blur halved: CSS blur is 2σ and RN's radius is σ, which is why the two numbers were never
 * the same in the hand-written version either.
 */
export function elevationStyle(name: ElevationName, os: string): ElevationStyle {
  const token: ShadowToken = ELEVATION[name]
  if (token.opacity === 0) return {}
  const target = elevationTarget(os)
  if (target === 'web') return { boxShadow: cssShadow(token) }
  if (target === 'android' && token.androidDp !== undefined) return { elevation: token.androidDp }
  return {
    shadowColor: token.color,
    shadowOpacity: token.opacity,
    shadowRadius: token.blur / 2,
    shadowOffset: { width: token.offsetX, height: token.offsetY },
  }
}
