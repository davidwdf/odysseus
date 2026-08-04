import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './tokens.css'
import { applyMode, currentMode } from './lib/appearance'
import { registerServiceWorker } from './lib/serviceWorker'
import { App } from './shell/App'

// `tokens.css` is generated from packages/ui/tokens.json — the same 26 custom properties, byte for byte,
// that apps/mobile/global.css carries (`pnpm --filter @nextbus/ui test` fails if either drifts).
// `index.css` is the hand-written half: the `@tailwind` directives and the font stack.

// PWA offline support (WP6-0; the caching policy is ADR-058, declared once in `scripts/pwa/`). At module
// scope, not in an effect: this must run once per document, not once per mount, and it no-ops off a
// production build.
registerServiceWorker()

/**
 * Appearance, applied **before** the first render.
 *
 * The persisted preference is read through a synchronous storage (see `lib/preferences.ts`), so by the
 * time this line runs zustand has already rehydrated and `currentMode()` is the rider's actual choice —
 * not the default that a `.dark` added after hydration would visibly correct.
 *
 * **The residual, stated rather than papered over:** the document still paints `bg-bg`'s light value for
 * as long as it takes this module to parse, because that CSS is in the stylesheet and this class is not.
 * The usual fix is an inline `<script>` in `index.html` that reads localStorage itself — which would be a
 * second declaration of both the storage key and the meaning of `auto`, in a file no gate reads. Once the
 * service worker is installed the bundle is served from cache and the window is a frame or two; before
 * then it is the network. That trade is deliberate. `useAppearance()` inside the app takes over from here.
 */
applyMode(currentMode())

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
