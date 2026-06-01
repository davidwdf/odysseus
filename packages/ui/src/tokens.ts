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

/** Opacity applied to stale ETA readings. */
export const ETA_STALE_OPACITY = 0.45
