import { useEffect, useState } from 'react'

/**
 * Whether the browser believes it has a network — the platform half of `feedNotice` (ADR-133).
 *
 * **A hook rather than a read**, because the answer changes while a screen is mounted and the whole point of
 * the notice is that it appears when the feed stops. `online`/`offline` are the two events that carry it.
 *
 * ⚠️ **`navigator.onLine` is a claim about a link, not about reachability** — it is `true` behind a captive
 * portal, which is the ordinary Hong Kong MTR-station case. That is exactly why it is *not* used to decide
 * whether to fetch (ADR-124 set `networkMode: 'always'` for that reason) and only to choose a **sentence**:
 * `false` is reliable evidence of no network, `true` is merely the absence of evidence, and the
 * `unreachable` arm is what covers the portal.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    // Re-read on mount: an `offline` event fired before this screen existed is not replayed, so a screen
    // opened while already offline would otherwise start out claiming a network it does not have.
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
