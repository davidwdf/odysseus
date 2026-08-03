import { createEdgeClient, DEFAULT_API_URL, liveTransportFromEnv } from '@nextbus/api-client'

// Point at the local edge worker in dev (`pnpm dev:edge` → :8787), or set
// EXPO_PUBLIC_API_URL to the deployed Worker. All screens (Nearby, Stop, Route,
// Favourites) go through this single DataSource — see ADR-004.
//
// The **read** is here and the **default** is not: `process.env.EXPO_PUBLIC_*` is inlined by Expo at
// build time, so this line cannot be hoisted into a shared module without the bundler seeing a dynamic
// property access and baking in nothing. The fallback used to be a fourth copy of the same literal
// (`lib/tileSource.ts`, `scripts/build-web.mjs` and `apps/web` had the others), which is the one value in
// this repo that has to change on the day we get a real domain and the one that had no single
// declaration. `DEFAULT_API_URL` is it now.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL

// Which live engine `watch()` runs, from the environment (WP5-6, ADR-076). Before this the two
// documented variables were read by **nothing**, so `/v1/live` shipped unreachable from a real build and
// selecting the socket meant editing this file.
//
// Three things about these two lines are deliberate:
//
//  · **The default is still the poll emulator.** `liveTransportFromEnv` returns `undefined` for it, so
//    an unset variable leaves `EdgeClient` holding the answer rather than this file restating it — and
//    no rider's behaviour changes until somebody sets the value on purpose. That matters more than it
//    looks: five of the thirteen findings Wave 5's own review confirmed were in `eta-hub.ts` and were
//    latent *because* nothing could reach the Durable Object.
//  · **Both reads are literal `process.env.X` member expressions**, because babel-preset-expo's inliner
//    visits only those. A destructure or a helper taking the variable's *name* would compile, run in
//    dev, and bake in `undefined` in a production bundle — silently selecting the default for ever.
//  · **The decision is not here.** `poll` | `socket`, no `auto`, and what an unrecognised spelling does,
//    are one declaration in `@nextbus/api-client`'s `live/select.ts`; `apps/web` reads the same rule
//    through the same function with the other bundler's spelling. This file's only job is the read.
const LIVE_TRANSPORT = process.env.EXPO_PUBLIC_LIVE_TRANSPORT
// The escape hatch for the one case deriving the socket URL from the API URL cannot cover: a socket tier
// on a different host (ADR-056 decision 8). Unset — the normal case — means `wss://<same host>/v1/live`,
// derived by the corpus-pinned `liveSocketUrl`.
const LIVE_URL = process.env.EXPO_PUBLIC_LIVE_URL

export const dataSource = createEdgeClient({
  baseUrl: API_URL,
  liveUrl: LIVE_URL,
  transport: liveTransportFromEnv(LIVE_TRANSPORT),
})
