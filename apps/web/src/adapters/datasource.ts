import { createEdgeClient, DEFAULT_API_URL, liveTransportFromEnv } from '@nextbus/api-client'

// The one DataSource seam (ADR-004), identical in shape to `apps/mobile/lib/datasource.ts` — only the
// env-var spelling differs, because Vite exposes `import.meta.env.VITE_*` where Expo uses
// `process.env.EXPO_PUBLIC_*`. That is the entire difference between the two apps' data layers, which
// is the claim Wave 4 is testing — and it is now *only* the spelling: the default was a second copy of
// the same literal until WP5-1 gave it one declaration (`DEFAULT_API_URL`), and the engine selection
// below is one shared rule rather than a second `=== 'socket'` (WP5-6, ADR-076).
const API_URL = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL

// `poll` (the shipped default) | `socket`. See `apps/mobile/lib/datasource.ts` for why the read stays
// per-renderer while the decision does not, and `live/select.ts` for why there is no `auto`.
//
// **Since WP5-7 this is no longer inert.** It used to be real configuration that changed nothing a rider
// of this app could see, because no screen here called `DataSource.watch()` — Nearby fetched `getNearby`
// on an interval. `Nearby` now holds a subscription (`src/hooks/useLiveNearby.ts`), so this variable
// decides which engine feeds its arrivals, exactly as it does in `apps/mobile`. The plumbing was kept
// symmetrical before it was needed on purpose, because the asymmetry that costs is the one nobody notices
// until the second renderer needs it.
const LIVE_TRANSPORT = import.meta.env.VITE_LIVE_TRANSPORT
// A socket tier on a different host; unset means derived from `API_URL` (ADR-056 decision 8).
const LIVE_URL = import.meta.env.VITE_LIVE_URL

export const dataSource = createEdgeClient({
  baseUrl: API_URL,
  liveUrl: LIVE_URL,
  transport: liveTransportFromEnv(LIVE_TRANSPORT),
})
