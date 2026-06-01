import { createEdgeClient } from '@nextbus/api-client'

// Point at the local edge worker in dev (`pnpm --filter @nextbus/edge dev` → :8787),
// or set EXPO_PUBLIC_API_URL to the deployed Worker. The Nearby screen currently
// renders mock data; swap to `dataSource.getNearby(...)` once the edge is running.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'

export const dataSource = createEdgeClient({ baseUrl: API_URL })
