import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { version } from './package.json'

// A separate file from `vite.config.ts` because vite 8's `UserConfig` has no `test` key — vitest owns
// that schema, and merging them typechecks only by casting, which would hide a real mistake.
export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom, because the one claim worth asserting here cannot be checked without rendering: that the
    // renderer adds no logic. See test/nearby-projection.test.tsx.
    environment: 'jsdom',
    // `.mjs` is here for exactly one file, `test/pwa-policy.test.mjs`, whose subject is a `.mjs` build
    // input with no type declaration — see its header for why a test in the same language beat writing
    // and maintaining a `.d.mts` beside the config. `tsconfig.json` does not include it, so it is
    // deliberately outside `typecheck`.
    include: ['test/**/*.test.{ts,tsx,mjs}'],
  },
  // The same `define` `vite.config.ts` carries, because the About screen reads the global at render time
  // and a suite without it dies with a `ReferenceError` rather than an assertion. Two configs is the cost
  // of vite 8 and vitest owning separate schemas (see above); one declaration of the *value* — this
  // package's `version` — is what stops that cost becoming a drift.
  define: { __APP_VERSION__: JSON.stringify(version) },
})
