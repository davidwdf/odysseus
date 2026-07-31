import { createEdgeClient, DEFAULT_API_URL } from '@nextbus/api-client'

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

export const dataSource = createEdgeClient({ baseUrl: API_URL })
