// Theme = a set of values for the semantic tokens (docs/09-theme.md, ADR-015, ADR-018).
// Values are "R G B" triplets so Tailwind's `rgb(var(--x) / <alpha-value>)` works.
// A theme is the cross-product of a LIVERY (colour identity) × a MODE (light/dark);
// every livery ships both. Apply on native with NativeWind's `vars(themes[livery][mode])`.

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

export type Mode = 'light' | 'dark'
/** User-facing appearance preference; `auto` follows the OS scheme. */
export type Appearance = 'auto' | 'light' | 'dark'
export type LiveryId = 'classic' | 'ink' | 'kmb' | 'ctb' | 'cmb' | 'dotMatrix' | 'splitFlap'

/** Build a livery from per-mode overrides on top of the neutral light/dark base.
 *  Liveries remap ONLY accent / surface-tint / (display) tokens — never status or
 *  contrast tokens — so legibility and ETA honesty stay constant across skins. */
function livery(overrides: {
  light?: Partial<ThemeVars>
  dark?: Partial<ThemeVars>
}): Record<Mode, ThemeVars> {
  // The base supplies every token, so the merge is always complete.
  return {
    light: { ...light, ...overrides.light } as ThemeVars,
    dark: { ...dark, ...overrides.dark } as ThemeVars,
  }
}

export const themes: Record<LiveryId, Record<Mode, ThemeVars>> = {
  classic: { light, dark },
  ink: livery({
    // Ink (BRAND.ink #111827). Light = ink-on-paper: ink *is* the accent on a white
    // page. Dark = a deep ink world (ink surfaces) with a cool indigo accent so it
    // pops against near-black. The glass tab bar tints toward these surfaces, so the
    // pill reads as frosted ink. Pairs with the liquid-glass material (ADR-028).
    light: {
      '--accent': '17 24 39',
      '--accent-contrast': '255 255 255',
      '--focus': '17 24 39',
    },
    dark: {
      '--bg': '8 11 20',
      '--surface': '17 24 39',
      '--surface-2': '30 41 59',
      '--border': '38 48 66',
      '--accent': '129 140 248',
      '--accent-contrast': '8 11 20',
      '--focus': '165 180 252',
    },
  }),
  kmb: livery({
    // KMB red + a faint red surface tint on light.
    light: {
      '--surface': '254 247 247',
      '--surface-2': '253 240 240',
      '--accent': '215 40 47',
      '--focus': '215 40 47',
    },
    dark: { '--accent': '229 57 64', '--focus': '248 113 113' },
  }),
  ctb: livery({
    // Citybus yellow — dark text on the accent; darker amber focus ring for visibility.
    light: { '--accent': '246 199 0', '--accent-contrast': '15 23 42', '--focus': '202 138 4' },
    dark: { '--accent': '246 199 0', '--accent-contrast': '15 23 42', '--focus': '250 204 21' },
  }),
  cmb: livery({
    // CMB Nostalgia — deep blue on cream (light) / warm night (dark).
    light: {
      '--bg': '255 253 247',
      '--surface': '250 246 236',
      '--surface-2': '244 238 222',
      '--border': '231 223 205',
      '--accent': '30 58 138',
      '--focus': '30 58 138',
    },
    dark: {
      '--bg': '23 20 15',
      '--surface': '38 33 25',
      '--surface-2': '51 44 33',
      '--border': '51 44 33',
      '--text': '245 240 230',
      '--text-muted': '180 170 150',
      '--accent': '125 154 226',
      '--focus': '147 178 240',
    },
  }),
  dotMatrix: livery({
    // LED orange. Dark is the canonical look; light is a daytime/printed variant.
    light: { '--accent': '234 88 12', '--focus': '234 88 12' },
    dark: {
      '--bg': '10 10 10',
      '--surface': '20 20 20',
      '--surface-2': '31 31 31',
      '--border': '38 38 38',
      '--accent': '255 140 0',
      '--accent-contrast': '10 10 10',
      '--focus': '255 140 0',
    },
  }),
  splitFlap: livery({
    // Solari board — warm white on charcoal (dark) / paper board (light).
    light: {
      '--bg': '250 249 246',
      '--surface': '243 241 235',
      '--surface-2': '234 231 223',
      '--border': '214 210 200',
      '--text': '38 36 32',
      '--accent': '60 56 50',
      '--accent-contrast': '250 249 246',
      '--focus': '120 110 95',
    },
    dark: {
      '--bg': '26 26 26',
      '--surface': '35 35 35',
      '--surface-2': '46 46 46',
      '--border': '60 60 60',
      '--text': '240 237 228',
      '--accent': '232 226 208',
      '--accent-contrast': '26 26 26',
      '--focus': '232 226 208',
    },
  }),
}

/** Liveries that swap the character-rendering treatment, not just colour (docs/09 §7). */
export const DISPLAY_LIVERIES: Partial<Record<LiveryId, 'dot-matrix' | 'split-flap'>> = {
  dotMatrix: 'dot-matrix',
  splitFlap: 'split-flap',
}

/** Picker metadata — ordered. `labelKey` is an i18n key; `swatch` is the light-mode
 *  accent as hex, for the selector chip (which needs a colour value, not a class). */
export interface LiveryMeta {
  id: LiveryId
  labelKey: string
  swatch: string
}

export const LIVERIES: readonly LiveryMeta[] = [
  { id: 'classic', labelKey: 'liveryClassic', swatch: '#2563EB' },
  { id: 'ink', labelKey: 'liveryInk', swatch: '#111827' },
  { id: 'kmb', labelKey: 'liveryKmb', swatch: '#D7282F' },
  { id: 'ctb', labelKey: 'liveryCtb', swatch: '#F6C700' },
  { id: 'cmb', labelKey: 'liveryCmb', swatch: '#1E3A8A' },
  { id: 'dotMatrix', labelKey: 'liveryDotMatrix', swatch: '#FF8C00' },
  { id: 'splitFlap', labelKey: 'liverySplitFlap', swatch: '#3C3832' },
]

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
