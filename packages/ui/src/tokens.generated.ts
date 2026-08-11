// Generated from packages/ui/tokens.json by its scripts/generate-tokens.mjs — do not edit.
// Run `pnpm --filter @nextbus/ui tokens:emit`; `pnpm --filter @nextbus/ui test` fails on a stale
// copy, so drifting from the declaration is a red build, not a silent surprise.

/**
 * A platform-neutral shadow recipe. `blur` is a CSS blur radius (2σ), because that is what the
 * DTCG shadow type means; the iOS recipe halves it to get `shadowRadius`, which is σ.
 * `androidDp` is absent when the platform should draw the geometry rather than step a Material
 * elevation — see `elevationStyle`.
 */
export interface ShadowToken {
  color: string
  opacity: number
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  inset?: boolean
  androidDp?: number
}

/** The two modes of the single Ink theme (ADR-029). */
export type ThemeMode = 'light' | 'dark'

/**
 * Semantic tokens — the only colours a component may name (docs/09 §1–2). One Ink theme in two
 * modes (ADR-029 retired the livery axis): the accent is the *ink* on light (a dark mark on a
 * white page) and inverts to *paper* on dark. Every token declares both modes, and the
 * generator fails if one mode is missing a token the other has. `cssVar` is the variable the
 * value is published as; `tailwind` is the utility name it is reachable by. The emitted CSS
 * holds "R G B" triplets rather than hex so `rgb(var(--x) / <alpha-value>)` keeps Tailwind's
 * alpha modifiers working.
 */
export const SEMANTIC_TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--border',
  '--text',
  '--text-muted',
  '--text-subtle',
  '--accent',
  '--accent-contrast',
  '--focus',
  '--positive',
  '--warning',
  '--danger',
] as const

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number]

/**
 * The semantic token values per mode, as "R G B" triplets. Keyed loosely, on any CSS
 * custom-property name, so `themeColor()` can keep taking one; use `SemanticToken` where you
 * want the narrow set.
 */
export const THEME_VARS: Record<ThemeMode, Record<`--${string}`, string>> = {
  light: {
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
  },
  dark: {
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
  },
}

/**
 * Fixed, theme-independent brand values. Not semantic tokens — they do not invert with the
 * appearance.
 */
export const BRAND = {
  /**
   * The app-icon field colour (apps/mobile/assets/icon.svg), the PWA `theme-color`, and a
   * fixed dark glass tint (`bg-ink/55`). Promoted to a token so the icon, the splash, the
   * browser chrome and any brand chrome stay one family.
   */
  ink: '#111827',
} as const

/**
 * Operator brand accents — used sparingly (a route-number chip, a thin route line), never as a
 * background. Unaffected by the appearance so operator identity is constant (docs/09 §7).
 */
export const OPERATOR_ACCENT = {
  KMB: '#D7282F',
  LWB: '#E8A33D',
  CTB: '#F6C700',
  GMB: '#00845C',
} as const

export type OperatorAccent = keyof typeof OPERATOR_ACCENT

/**
 * The contrast-safe text colour to sit on each operator accent. The yellow CTB accent always
 * pairs with dark text, never white (docs/09 §2).
 */
export const OPERATOR_ACCENT_TEXT: Record<OperatorAccent, string> = {
  KMB: '#FFFFFF',
  LWB: '#FFFFFF',
  CTB: '#0F172A',
  GMB: '#FFFFFF',
}

/**
 * Basemap overlay colours. The map is not themed (the LandsD tiles are inverted by filter
 * instead — ADR-041/049), so these are fixed values chosen to read over both the light and the
 * inverted-dark tiles.
 */
export const MAP_COLOR = {
  /**
   * Last-resort pin fill for a stop with no known operator. A lone stop is coloured by its
   * operator and each pole of a multi-pole place by its own, so this rose is only the
   * fallback.
   */
  pin: '#E11D48',
  /** The ring that separates a pin from the tiles underneath it. */
  pinBorder: '#FFFFFF',
} as const

/** Corner radii (docs/09 §4). Cards `md`/`lg`; bottom sheets `sheet`; chips and pills `full`. */
export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
  /**
   * The floating tab bar's rounded-pill corner (ADR-027). Off the sm–xl scale on purpose: the
   * bar is a pill, and its radius tracks its 54px height, not the card scale.
   */
  pill: 24,
  /**
   * The bottom sheet's top corners. Slightly softer than `xl` because the sheet spans the full
   * width, where 20px reads tight.
   */
  sheet: 26,
} as const

/**
 * The 4px spacing scale (docs/09 §4). These are the same values Tailwind ships as its default
 * rem-based scale — declared here so the native platforms, which have no Tailwind, read them
 * from the same place. The emitted preset publishes them in rem so the web build keeps
 * honouring the browser's font size. Touch targets stay ≥ 44×44px and adjacent tappables ≥ 8px
 * apart, which is a rule, not a token.
 */
export const SPACING = {
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
} as const

/**
 * Animation durations (docs/09 §5). Micro-interactions stay in the 150–300ms band; all of them
 * collapse to an instant swap under reduced motion.
 */
export const MOTION = {
  fast: 120,
  base: 200,
  slow: 320,
} as const

export const OPACITY = {
  /**
   * RETIRED — do not apply this to anything. It was the staleness cue: an ETA reading whose
   * board had aged was faded to 45%. The cue is now a muted `~` before the figure, declared in
   * the component specs (`stop-row`, `place-row`, `route-detail`) and drawn by both renderers,
   * and NO renderer applies this token any more. It is kept rather than deleted because this
   * file's readers include a hand-written iOS/Android client (ADR-067/075) that will meet the
   * same design problem, and the answer to it is not obvious: a fade is *noticed* rather than
   * read — a rider with one reading on screen has nothing to compare it against — and it dims
   * the one number they are trying to read. Deleting the token would leave that decision
   * nowhere a porter looks, and the next 0.45 would be re-invented. Retiring it in place puts
   * the warning in the file they are reading, because this description is emitted verbatim
   * into `NextBusTokens.swift` and `.kt`. If you are implementing a third renderer: draw the
   * mark, not the fade. `check-tokens-current` counts tokens; it cannot see that one has no
   * consumer, so this sentence is the mechanism.
   */
  etaStale: 0.45,
} as const

/**
 * Inter is loaded as discrete weight cuts (apps/mobile/app/_layout.tsx). RN's `fontFamily` is
 * single-valued, so a weight maps to its exact registered family name rather than to a numeric
 * weight; CJK glyphs fall back to the OS face.
 */
export const FONT_FAMILY = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const

export type FontWeightName = keyof typeof FONT_FAMILY

/**
 * The stack appended after every cut on web, so CJK and the no-webfont case land on a sensible
 * face. Declared once: the generator composes each cut with it, which is why the tail is not
 * written out four times in the preset. On native `fontFamily` is single-valued and the OS
 * handles CJK fallback, so only the cut is used (ADR-019 — v1 bundles no CJK webfont).
 */
export const FONT_FALLBACK = [
  'Noto Sans HK',
  'Noto Sans SC',
  'PingFang HK',
  'system-ui',
  'sans-serif',
] as const

export interface TypeStyle {
  fontSize: number
  lineHeight: number
  weight: FontWeightName
}

/**
 * The named type scale (docs/09 §3), mobile-first on a 16px base. Components reference a role,
 * never a raw size, so type stays consistent across every screen; `<Text variant>` is the
 * canonical consumer.
 */
export const TYPE_SCALE = {
  /** The hero ETA numeral. */
  display: { fontSize: 40, lineHeight: 44, weight: 'bold' },
  /** Screen titles. */
  h1: { fontSize: 28, lineHeight: 34, weight: 'bold' },
  /** Section headers. */
  h2: { fontSize: 22, lineHeight: 28, weight: 'semibold' },
  /** Card titles and route numbers. */
  h3: { fontSize: 18, lineHeight: 24, weight: 'semibold' },
  /** The default, and the minimum size on mobile. */
  body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
  /** Secondary labels. */
  label: { fontSize: 14, lineHeight: 20, weight: 'medium' },
  /** Timestamps only — never essential information. */
  caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
} satisfies Record<string, TypeStyle>

export type TypeVariant = keyof typeof TYPE_SCALE

/**
 * Elevation recipes (docs/09 §4): `e0` none · `e1` cards · `e2` sticky headers · `e3`
 * sheet/FAB/floating tab bar. Platform-neutral at source — a shadow geometry plus, where the
 * platform wants one instead, Android's Material dp. `blur` carries CSS semantics (a 2σ blur
 * radius), because that is what the DTCG shadow type means; the iOS recipe halves it to get
 * `shadowRadius`, which is σ. Consumers never read a level directly: `elevationStyle(level,
 * Platform.OS)` picks the recipe. On dark, prefer `surface-2` + `border` over any of these — a
 * drop shadow has almost no contrast budget on a near-black field (ADR-035).
 */
export const ELEVATION = {
  /** Flat on the surface. Every platform recipe collapses to an empty style. */
  e0: { color: '#000000', opacity: 0, offsetX: 0, offsetY: 0, blur: 0, spread: 0, androidDp: 0 },
  /** A resting card. */
  e1: {
    color: '#0F172A',
    opacity: 0.06,
    offsetX: 0,
    offsetY: 2,
    blur: 12,
    spread: 0,
    androidDp: 1,
  },
  /** A sticky header. */
  e2: { color: '#0F172A', opacity: 0.1, offsetX: 0, offsetY: 4, blur: 24, spread: 0, androidDp: 3 },
  /** A sheet, a FAB, or the floating tab bar. */
  e3: {
    color: '#0F172A',
    opacity: 0.16,
    offsetX: 0,
    offsetY: 8,
    blur: 40,
    spread: 0,
    androidDp: 6,
  },
  /**
   * A map pin at rest, lifted off the tiles. Declares no `androidDp` on purpose: a pin is a
   * small overlay on a map, not a Material surface, so Android draws the same shadow geometry
   * as iOS rather than a dp step.
   */
  pin: { color: '#000000', opacity: 0.35, offsetX: 0, offsetY: 1, blur: 4, spread: 0 },
  /** The selected map pin — a little more lift so it reads above its neighbours. */
  pinActive: { color: '#000000', opacity: 0.45, offsetX: 0, offsetY: 2, blur: 6, spread: 0 },
} satisfies Record<string, ShadowToken>

/**
 * The cast shadow under floating glass — deliberately NOT an `elevation` level, because glass
 * is a separate elevation channel whose primary depth cue is the refracted backdrop (ADR-035,
 * docs/09 §Glass legibility rule 7). Two stops: a tight contact shadow plus a soft ambient
 * one. Light mode only; on dark a drop shadow is haze, not depth. Web only — native glass
 * lifts via its container's `e3`.
 */
export const GLASS_SHADOW = {
  contact: { color: '#0F172A', opacity: 0.1, offsetX: 0, offsetY: 1, blur: 3, spread: 0 },
  ambient: { color: '#0F172A', opacity: 0.13, offsetX: 0, offsetY: 8, blur: 22, spread: 0 },
} satisfies Record<'contact' | 'ambient', ShadowToken>

/**
 * The rim light on a glass pane: a thin, top-weighted inner highlight, because glass is lit
 * from above — not a uniform ring, which reads as a heavy border. Per-mode alphas encode the
 * ADR-035 contrast budget: the white top highlight quietens on dark (a white edge over-reads
 * against a dark surface) while the bottom inset shadow *strengthens*, because the dark-mode
 * tint has already lightened the body for it to work against. Inset, web only.
 */
export const GLASS_RIM = {
  top: {
    light: {
      color: '#FFFFFF',
      opacity: 0.42,
      offsetX: 0,
      offsetY: 1,
      blur: 0.5,
      spread: 0,
      inset: true,
    },
    dark: {
      color: '#FFFFFF',
      opacity: 0.12,
      offsetX: 0,
      offsetY: 1,
      blur: 0.5,
      spread: 0,
      inset: true,
    },
  },
  bottom: {
    light: {
      color: '#000000',
      opacity: 0.06,
      offsetX: 0,
      offsetY: -1,
      blur: 1,
      spread: 0,
      inset: true,
    },
    dark: {
      color: '#000000',
      opacity: 0.16,
      offsetX: 0,
      offsetY: -1,
      blur: 1,
      spread: 0,
      inset: true,
    },
  },
} satisfies Record<'top' | 'bottom', Record<ThemeMode, ShadowToken>>
