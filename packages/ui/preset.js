// Generated from packages/ui/tokens.json by its scripts/generate-tokens.mjs — do not edit.
// Run `pnpm --filter @nextbus/ui tokens:emit`; `pnpm --filter @nextbus/ui test` fails on a stale
// copy, so drifting from the declaration is a red build, not a silent surprise.
//
// Semantic tokens mapped to CSS variables. Components only ever use these semantic
// classes (bg-bg, text-muted, text-accent…), so swapping the mode re-skins everything
// with zero component changes. The mapping is generated too: declaring a semantic token
// in tokens.json is all it takes for its utility class to exist.
// Use alongside nativewind/preset:
//   presets: [require('nativewind/preset'), require('@nextbus/ui/preset')]

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--text-muted) / <alpha-value>)',
        subtle: 'rgb(var(--text-subtle) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-contrast': 'rgb(var(--accent-contrast) / <alpha-value>)',
        focus: 'rgb(var(--focus) / <alpha-value>)',
        positive: 'rgb(var(--positive) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // Fixed brand ink — NOT a semantic token, so it does not invert with the
        // appearance. Use sparingly, e.g. a fixed dark glass tint (`bg-ink/55`).
        ink: 'rgb(17 24 39 / <alpha-value>)',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
        full: '9999px',
        pill: '24px',
        sheet: '26px',
      },
      // In rem, so the web build keeps honouring the browser font size: the px scale in
      // tokens.json over the 16px base, which is exactly Tailwind's own default scale —
      // restated here only so tokens.json is its declaration for the native platforms.
      spacing: {
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.25rem',
        6: '1.5rem',
        8: '2rem',
        10: '2.5rem',
        12: '3rem',
      },
      // The named type scale → `text-display`, `text-h1`, … as [size, lineHeight]. The
      // <Text> primitive is the canonical consumer; these keep the scale available to
      // any className-driven markup too.
      fontSize: {
        display: ['40px', '44px'],
        h1: ['28px', '34px'],
        h2: ['22px', '28px'],
        h3: ['18px', '24px'],
        body: ['16px', '24px'],
        label: ['14px', '20px'],
        caption: ['12px', '16px'],
      },
      // Every Inter cut plus the shared fallback tail. On web that gives a real stack
      // incl. CJK; on native fontFamily is single-valued and the OS handles CJK glyph
      // fallback, and the <Text> primitive sets the cut directly.
      fontFamily: {
        sans: [
          'Inter_400Regular',
          'Noto Sans HK',
          'Noto Sans SC',
          'PingFang HK',
          'system-ui',
          'sans-serif',
        ],
        medium: [
          'Inter_500Medium',
          'Noto Sans HK',
          'Noto Sans SC',
          'PingFang HK',
          'system-ui',
          'sans-serif',
        ],
        semibold: [
          'Inter_600SemiBold',
          'Noto Sans HK',
          'Noto Sans SC',
          'PingFang HK',
          'system-ui',
          'sans-serif',
        ],
        bold: [
          'Inter_700Bold',
          'Noto Sans HK',
          'Noto Sans SC',
          'PingFang HK',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
}
