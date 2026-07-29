import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `vite` is pinned to the exact version already hoisted as vitest 4's peer (8.0.16). Golden rule 6 is
// the scar from two majors of one package fighting over a single hoisted binary under
// `node-linker=hoisted` — it killed `wrangler dev` over esbuild, and vite carries esbuild too.
export default defineConfig({
  plugins: [react()],
  server: { port: 8082 },
})
