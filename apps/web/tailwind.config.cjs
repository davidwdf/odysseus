// `.cjs`, not `.js`: this package is `"type": "module"`, and `@nextbus/ui/preset` is a generated
// CommonJS file (Tailwind's own config format). Renaming beats converting to ESM + `createRequire`,
// which would add a shim purely to import a config the RN app requires directly.
const nextbusPreset = require('@nextbus/ui/preset')

/**
 * Plain Tailwind 3.4 with the SAME generated preset the React Native app uses — the mobile config
 * stacks `nativewind/preset` under it, this one does not, and that difference is the whole test.
 *
 * It was verified rather than assumed (WP4-1's own note): the preset is generated as ordinary Tailwind
 * config — `rgb(var(--bg) / <alpha-value>)` colours, `borderRadius`, `fontSize`, `fontFamily` — with no
 * NativeWind-specific keys, so plain Tailwind consumes it unchanged. If it had needed a fork, that
 * would have been a finding about the token pipeline rather than a config detail.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  presets: [nextbusPreset],
  darkMode: 'class',
  theme: { extend: {} },
}
