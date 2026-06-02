import { createEdgeClient } from '@nextbus/api-client'

// Point at the local edge worker in dev (`pnpm dev:edge` → :8787), or set
// EXPO_PUBLIC_API_URL to the deployed Worker. All screens (Nearby, Stop, Route,
// Favorites) go through this single DataSource — see ADR-004.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'

export const dataSource = createEdgeClient({ baseUrl: API_URL })
