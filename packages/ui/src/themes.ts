// Theme = a set of values for the semantic tokens (docs/09-theme.md, ADR-015, ADR-029).
// Values are "R G B" triplets so Tailwind's `rgb(var(--x) / <alpha-value>)` works.
//
// One **Ink** identity, in light + dark (ADR-029 retired the multi-livery axis). It's a
// monochrome "ink & paper" system: the accent is the *ink* on light (dark mark on a white
// page) and inverts to *paper* on dark (light mark on an ink field). Operator colours
// (RouteChip) and status colours stay separate, so data meaning is unaffected. Apply on
// native with NativeWind's `vars(themes[mode])`.

export type ThemeVars = Record<`--${string}`, string>

export type Mode = 'light' | 'dark'
/** User-facing appearance preference; `auto` follows the OS scheme. */
export type Appearance = 'auto' | 'light' | 'dark'

// Light — ink on paper. The accent IS the ink (#111827): a near-black mark on white.
const light: ThemeVars = {
  '--bg': '255 255 255',
  '--surface': '248 250 252',
  '--surface-2': '241 245 249',
  '--border': '226 232 240',
  '--text': '17 24 39',
  '--text-muted': '71 85 105',
  '--text-subtle': '100 116 139',
  '--accent': '17 24 39',
  '--accent-contrast': '255 255 255',
  '--focus': '17 24 39',
  '--positive': '22 163 74',
  '--warning': '217 119 6',
  '--danger': '220 38 38',
}

// Dark — paper on ink. The same idea inverted: deep ink surfaces, paper-white text, and
// the accent becomes the *paper* (a soft off-white mark on the ink field) — monochrome,
// no coloured accent. Status colours keep their dark variants.
const dark: ThemeVars = {
  '--bg': '13 17 28',
  '--surface': '22 27 41',
  '--surface-2': '32 38 54',
  '--border': '44 51 67',
  '--text': '244 246 250',
  '--text-muted': '158 165 180',
  '--text-subtle': '107 114 128',
  '--accent': '226 232 240',
  '--accent-contrast': '13 17 28',
  '--focus': '226 232 240',
  '--positive': '34 197 94',
  '--warning': '245 158 11',
  '--danger': '239 68 68',
}

export const themes: Record<Mode, ThemeVars> = { light, dark }

/** Resolve the appearance preference + OS scheme to a concrete mode. */
export function resolveMode(appearance: Appearance, systemIsDark: boolean): Mode {
  if (appearance === 'auto') return systemIsDark ? 'dark' : 'light'
  return appearance
}

/**
 * Resolve a semantic token to a concrete `rgb()` string for the rare cases that
 * can't use a className — e.g. React Navigation's tab-bar / header options,
 * which take colour values, not Tailwind classes. Components still use classes.
 */
export function themeColor(theme: ThemeVars, token: `--${string}`): string {
  const triplet = theme[token]
  if (!triplet) throw new Error(`Unknown theme token: ${token}`)
  return `rgb(${triplet})`
}
