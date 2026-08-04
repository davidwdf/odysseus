import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

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
})
