// Theme = a set of values for the semantic tokens (docs/09-theme.md, ADR-015).
// Values are "R G B" triplets so Tailwind's `rgb(var(--x) / <alpha-value>)` works.
// Apply on native with NativeWind's `vars(themes[name])` at the app root.

export type ThemeVars = Record<`--${string}`, string>

const light: ThemeVars = {
  '--bg': '255 255 255',
  '--surface': '248 250 252',
  '--surface-2': '241 245 249',
  '--border': '226 232 240',
  '--text': '15 23 42',
  '--text-muted': '71 85 105',
  '--text-subtle': '100 116 139',
  '--accent': '37 99 235',
  '--accent-contrast': '255 255 255',
  '--focus': '37 99 235',
  '--positive': '22 163 74',
  '--warning': '217 119 6',
  '--danger': '220 38 38',
}

const dark: ThemeVars = {
  '--bg': '2 6 23',
  '--surface': '15 23 42',
  '--surface-2': '30 41 59',
  '--border': '30 41 59',
  '--text': '248 250 252',
  '--text-muted': '148 163 184',
  '--text-subtle': '100 116 139',
  '--accent': '59 130 246',
  '--accent-contrast': '255 255 255',
  '--focus': '96 165 250',
  '--positive': '34 197 94',
  '--warning': '245 158 11',
  '--danger': '239 68 68',
}

export type ThemeName =
  | 'light'
  | 'dark'
  | 'kmbLight'
  | 'kmbDark'
  | 'ctbLight'
  | 'ctbDark'
  | 'cmbNostalgia'
  | 'dotMatrix'
  | 'splitFlap'

// Liveries remap ONLY accent / surface-tint / (display) tokens — never status or
// contrast tokens — so legibility and ETA honesty stay constant across skins.
export const themes: Record<ThemeName, ThemeVars> = {
  light,
  dark,
  kmbLight: { ...light, '--accent': '215 40 47', '--accent-contrast': '255 255 255', '--focus': '215 40 47' },
  kmbDark: { ...dark, '--accent': '215 40 47', '--accent-contrast': '255 255 255', '--focus': '215 40 47' },
  ctbLight: { ...light, '--accent': '246 199 0', '--accent-contrast': '15 23 42', '--focus': '202 138 4' },
  ctbDark: { ...dark, '--accent': '246 199 0', '--accent-contrast': '15 23 42', '--focus': '202 138 4' },
  cmbNostalgia: {
    ...light,
    '--bg': '255 253 247',
    '--surface': '250 246 236',
    '--surface-2': '244 238 222',
    '--accent': '30 58 138',
    '--accent-contrast': '255 255 255',
    '--focus': '30 58 138',
  },
  dotMatrix: {
    ...dark,
    '--bg': '10 10 10',
    '--surface': '20 20 20',
    '--surface-2': '31 31 31',
    '--accent': '255 140 0',
    '--accent-contrast': '10 10 10',
    '--focus': '255 140 0',
  },
  splitFlap: {
    ...dark,
    '--bg': '26 26 26',
    '--surface': '35 35 35',
    '--surface-2': '46 46 46',
    '--text': '240 237 228',
    '--accent': '232 226 208',
    '--accent-contrast': '26 26 26',
  },
}

/** Liveries that swap the character-rendering treatment, not just color. */
export const DISPLAY_LIVERIES: Partial<Record<ThemeName, 'dot-matrix' | 'split-flap'>> = {
  dotMatrix: 'dot-matrix',
  splitFlap: 'split-flap',
}
