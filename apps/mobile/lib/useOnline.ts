import { useEffect, useState } from 'react'

/**
 * Whether the platform believes it has a network — the platform half of `feedNotice` (ADR-133), wired on
 * this renderer by ADR-150.
 *
 * ## What each platform actually answers, stated rather than assumed
 *
 * `navigator.onLine` and the `online`/`offline` events are **web** APIs. Under `react-native-web` — the
 * Expo PWA, and the environment both conformance suites run in — they are the browser's own and this hook is
 * the DOM one. On iOS and Android React Native defines a `navigator` shim that has **no `onLine` property at
 * all**, so the read is `undefined`, and the type guard below is what keeps that from being reported as
 * *offline for ever*: an absent API is not evidence of a missing network.
 *
 * **`true` is therefore the honest default, not a stub.** It is exactly the value ADR-133 gives the field:
 * `false` is reliable evidence of no network, `true` is merely the absence of evidence — which is why
 * `navigator.onLine` is trusted for choosing a *sentence* and refused as a reason not to fetch (ADR-124 set
 * `networkMode: 'always'` for that). A native build therefore never says *"You're offline"*; when its network
 * is gone the requests fail and the `unreachable` arm says so, which is the same arm that covers a captive
 * portal on the web. Giving native a real signal needs `expo-network` or NetInfo and is a `docs/07` row.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(read)
  useEffect(() => {
    // No `addEventListener` on a native `window` either, so the subscription is guarded the same way. There
    // is nothing to fall back to: without the events the value is whatever it was at mount, which on native
    // is the constant `true` this hook documents.
    const target = typeof window === 'undefined' ? undefined : window
    if (typeof target?.addEventListener !== 'function') return
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    target.addEventListener('online', up)
    target.addEventListener('offline', down)
    // Re-read on mount: an `offline` event fired before this screen existed is not replayed, so a screen
    // opened while already offline would otherwise start out claiming a network it does not have.
    setOnline(read())
    return () => {
      target.removeEventListener('online', up)
      target.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** `undefined` — the native case — reads as `true`: an absent API is not evidence of a missing network. */
function read(): boolean {
  if (typeof navigator === 'undefined') return true
  const value: unknown = (navigator as { onLine?: unknown }).onLine
  return typeof value === 'boolean' ? value : true
}
