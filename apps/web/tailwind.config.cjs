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
/**
 * **`lab/` is scanned in dev and only in dev**, which is the one place ADR-112's rule needs stating in a
 * config rather than in a gate.
 *
 * The lab is a real page served by `vite dev`, and it was silently half-styled: Tailwind emits only the
 * classes it finds in `content`, so every utility the lab used and the app did not — `h-[420px]`,
 * `-mt-3`, `border-route-soft` — resolved to nothing. `MapLab`'s own height was among them. Adding the
 * glob unconditionally would put those utilities in the CSS a rider downloads, which is the leak
 * `test/dev-pages.test.mjs` exists to prevent one layer up (it polices imports and build inputs, and a
 * stylesheet is neither). `NODE_ENV` is `development` under `vite dev` and `production` under
 * `vite build`, so the dev page is styled where it is served and absent where it is not — and if the
 * variable is ever unset, the fallback is the *safe* one: no lab classes.
 */
const lab = process.env.NODE_ENV === 'development' ? ['./lab/**/*.{ts,tsx}'] : []

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}', ...lab],
  presets: [nextbusPreset],
  darkMode: 'class',
  theme: { extend: {} },
}
