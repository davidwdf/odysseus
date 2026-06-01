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
      fontFamily: {
        sans: ['Inter', 'Noto Sans HK', 'Noto Sans SC', 'PingFang HK', 'system-ui', 'sans-serif'],
      },
    },
  },
}
