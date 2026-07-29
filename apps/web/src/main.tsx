import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { detectedLocale } from './adapters/locale'
import './index.css'
import './tokens.css'
import { Nearby } from './screens/Nearby'

// `tokens.css` is generated from packages/ui/tokens.json — the same 26 custom properties, byte for
// byte, that apps/mobile/global.css carries (`pnpm --filter @nextbus/ui test` fails if either drifts).
// `index.css` is the hand-written half: the `@tailwind` directives and the font stack.

/**
 * Appearance follows the OS, with no override UI yet. The class goes on `<html>` rather than on the app
 * root so the very first paint already carries it — a `.dark` applied after hydration is a visible
 * flash of the wrong theme. `apps/mobile` reaches the same place through NativeWind's `vars()` at its
 * root; the *values* are shared, the mechanism is each platform's own.
 */
const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyAppearance = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark)
}
applyAppearance(media.matches)
media.addEventListener('change', (e) => applyAppearance(e.matches))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A single knob, and the same one the RN provider sets: it governs a remount refetch, and 15 s
      // is coherent against a 30 s served cadence. Not policy-derived in either app — see `docs/11`.
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The locale is resolved once, by the same `resolveLocale` the RN app uses, from the browser's
          own ordered language list. No manual override yet — that is a settings screen, and this app
          has one screen on purpose. */}
      <Nearby locale={detectedLocale()} />
    </QueryClientProvider>
  </StrictMode>,
)
