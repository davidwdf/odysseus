import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { version } from './package.json'

// `vite` is pinned to the exact version already hoisted as vitest 4's peer (8.0.16). Golden rule 6 is
// the scar from two majors of one package fighting over a single hoisted binary under
// `node-linker=hoisted` — it killed `wrangler dev` over esbuild, and vite carries esbuild too.
export default defineConfig({
  plugins: [react()],
  server: { port: 8082 },
  // The build a rider can quote back, for the About screen (WP6-7) — the DOM answer to what
  // `Constants.expoConfig.version` is on native.
  //
  // A `define` over this package's own `version`, and NOT a `VITE_*` env var, which was the tempting
  // option and is a footgun by construction: an unset `.env` yields `undefined`, the screen prints
  // nothing, and the failure looks exactly like a rider on an old build. A missing `define` is instead a
  // `ReferenceError` on the first render and a typecheck failure before that, because `vite-env.d.ts`
  // declares the global. `vitest.config.ts` carries the same line for the same reason.
  define: { __APP_VERSION__: JSON.stringify(version) },
})
