import { Platform } from 'react-native'

/**
 * Register the PWA service worker (WP0-3). No-op everywhere except a production web build:
 *
 *  - **native** has no service workers at all;
 *  - **dev** must not register one. `dist/sw.js` only exists after `build:web`, and a stale
 *    worker intercepting Metro's module requests is a genuinely nasty class of bug — the app
 *    serves yesterday's bundle and no amount of reloading fixes it.
 *
 * Registration is fire-and-forget: a failure means no offline support, never a broken app.
 */
export function registerServiceWorker(): void {
  if (Platform.OS !== 'web') return
  if (process.env.NODE_ENV !== 'production') return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // Wait for load so the registration never competes with the first paint for bandwidth.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed', err)
    })
  })
}
