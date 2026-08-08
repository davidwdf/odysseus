// Theme = a set of values for the semantic tokens (docs/09-theme.md, ADR-015, ADR-029).
// The values themselves live in tokens.json and arrive here through `tokens.generated.ts`;
// this module is only the *rules* — how a preference resolves to a mode, and how a token
// resolves to a colour for the few surfaces that cannot take a className.
//
// One **Ink** identity, in light + dark (ADR-029 retired the multi-livery axis). It's a
// monochrome "ink & paper" system: the accent is the *ink* on light (a dark mark on a white
// page) and inverts to *paper* on dark. Operator colours (RouteChip) and status colours stay
// separate, so data meaning is unaffected. Apply on native with NativeWind's `vars(themes[mode])`.

import { THEME_VARS, type ThemeMode } from './tokens.generated'

export type ThemeVars = Record<`--${string}`, string>

export type Mode = ThemeMode
/** User-facing appearance preference; `auto` follows the OS scheme. */
export type Appearance = 'auto' | 'light' | 'dark'

/**
 * Every appearance a rider may pick, in the order the picker offers them — one declaration (WP6-7).
 *
 * It lives here, beside the type and beside `resolveMode`, rather than in `packages/core`: the kernel may
 * not import this package (`layers.json` gives it `use: []`), so a copy there would have restated the
 * union and *added* a declaration to remove two. There were three before this — the RN Settings screen,
 * the web shell's scaffolding, and the workbench gallery — and the order is a content decision that a
 * second renderer could quietly reverse. `settingsView` takes this as an argument and decides only which
 * of them is lit, which is the part that is a rule.
 */
export const APPEARANCES: readonly Appearance[] = ['auto', 'light', 'dark']

export const themes: Record<Mode, ThemeVars> = THEME_VARS

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
