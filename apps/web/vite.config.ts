import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'
import { version } from './package.json'

// `vite` is pinned to the exact version already hoisted as vitest 4's peer (8.0.16). Golden rule 6 is
// the scar from two majors of one package fighting over a single hoisted binary under
// `node-linker=hoisted` — it killed `wrangler dev` over esbuild, and vite carries esbuild too.
/**
 * `/lab` → `/lab/`, in dev only.
 *
 * Without it the missing slash is the worst kind of failure: Vite finds no file, the SPA fallback serves
 * `index.html`, and react-router renders the **app** at an unknown path — so `/lab` answers HTTP 200 with
 * Nearby and no error anywhere. It looks like the lab does not exist. (Found the honest way: the owner
 * could not find a page I had just told them the URL of.)
 *
 * A redirect rather than a rewrite, so the address bar ends up somewhere that will still work when it is
 * pasted or bookmarked. Dev-only by construction — `apply: 'serve'` — which keeps ADR-112's rule intact:
 * the lab is never in the production graph, and this adds nothing to it.
 */
const labSlash = (): PluginOption => ({
  name: 'nextbus-lab-trailing-slash',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/lab' || req.url?.startsWith('/lab?')) {
        res.writeHead(301, { Location: req.url.replace('/lab', '/lab/') })
        res.end()
        return
      }
      next()
    })
  },
})

export default defineConfig({
  plugins: [react(), labSlash()],
  server: { port: 8082 },
  // MapLibre's worker is imported as `?worker&url` (see `MapView.tsx`) and is an ES module that imports
  // a sibling chunk. Vite's default worker format is `iife`, which cannot express that; `es` keeps the
  // import graph intact so the bundle Vite emits is the one the worker actually needs.
  worker: { format: 'es' },
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
