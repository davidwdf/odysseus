// Non-color design tokens shared across the app (docs/09-theme.md §4–5).

/** Animation durations in ms (micro-interactions stay 150–300ms). */
export const MOTION = { fast: 120, base: 200, slow: 320 } as const

/** Corner radii in px. */
export const RADIUS = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 } as const

/** Operator brand accents — used sparingly (chips, route lines), never backgrounds. */
export const OPERATOR_ACCENT = {
  KMB: '#D7282F',
  LWB: '#E8A33D',
  CTB: '#F6C700',
} as const

/** Contrast-safe text colour to sit on each operator accent (docs/09 §2: the
 *  yellow CTB accent always pairs with dark text, never white). */
export const OPERATOR_ACCENT_TEXT: Record<keyof typeof OPERATOR_ACCENT, string> = {
  KMB: '#FFFFFF',
  LWB: '#FFFFFF',
  CTB: '#0F172A',
}

/** Opacity applied to stale ETA readings. */
export const ETA_STALE_OPACITY = 0.45

// Elevation (docs/09 §4): e0 none · e1 cards · e2 sticky headers · e3 sheet/FAB.
// RN needs both an iOS shadow recipe and an Android `elevation`; kept as plain
// data so packages/ui stays RN-free. On dark, prefer surface-2 + border over
// shadows (they read poorly) — the consumer (Card) applies that branch.
export type ElevationLevel = 'e0' | 'e1' | 'e2' | 'e3'

export interface ElevationStyle {
  ios: {
    shadowColor: string
    shadowOpacity: number
    shadowRadius: number
    shadowOffset: { width: number; height: number }
  }
  android: { elevation: number }
}

const noShadow: ElevationStyle = {
  ios: {
    shadowColor: '#000000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  },
  android: { elevation: 0 },
}

export const ELEVATION: Record<ElevationLevel, ElevationStyle> = {
  e0: noShadow,
  e1: {
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 1 },
  },
  e2: {
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
  },
  e3: {
    ios: {
      shadowColor: '#0F172A',
      shadowOpacity: 0.16,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 6 },
  },
}
