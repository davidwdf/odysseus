// Tailwind / NativeWind preset: semantic tokens mapped to CSS variables.
// Components only ever use these semantic classes (bg-bg, text-muted, text-accent…),
// so swapping a theme (incl. a livery) re-skins everything with zero component changes.
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
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px' },
      // Named type scale (docs/09 §3) → `text-display`, `text-h1`, … as [size, lineHeight].
      // The <Text> primitive is the canonical consumer; these classes keep the
      // scale available to any className-driven markup too.
      fontSize: {
        display: ['40px', '44px'],
        h1: ['28px', '34px'],
        h2: ['22px', '28px'],
        h3: ['18px', '24px'],
        body: ['16px', '24px'],
        label: ['14px', '20px'],
        caption: ['12px', '16px'],
      },
      // Inter is loaded as discrete cuts (apps/mobile/app/_layout.tsx). On web these
      // give a proper fallback stack incl. CJK; on native fontFamily is single-valued
      // and the OS handles CJK glyph fallback. The <Text> primitive sets the cut directly.
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
