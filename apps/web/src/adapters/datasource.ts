import { createEdgeClient } from '@nextbus/api-client'

// The one DataSource seam (ADR-004), identical in shape to `apps/mobile/lib/datasource.ts` — only the
// env-var spelling differs, because Vite exposes `import.meta.env.VITE_*` where Expo uses
// `process.env.EXPO_PUBLIC_*`. That is the entire difference between the two apps' data layers, which
// is the claim Wave 4 is testing.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

export const dataSource = createEdgeClient({ baseUrl: API_URL })
