/**
 * Register the PWA service worker (WP6-0; the policy it enforces is ADR-058).
 *
 * A no-op outside a production build, for the reason the RN app's copy gives and which is *worse* here:
 * `dist/sw.js` only exists after `build:web`, and a stale worker intercepting Vite's dev-server module
 * requests is a genuinely nasty class of bug — the app serves yesterday's bundle and no amount of
 * reloading fixes it. `import.meta.env.PROD` is Vite's build-time constant, so the whole body is dropped
 * from a dev bundle rather than merely skipped.
 *
 * Registration is fire-and-forget: a failure means no offline support, never a broken app.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // Wait for load so the registration never competes with the first paint for bandwidth.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed', err)
    })
  })
}
