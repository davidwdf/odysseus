import { type ResolvedClientPolicy, resolveClientPolicy } from '@nextbus/core'
import { useQuery } from '@tanstack/react-query'
import { dataSource } from '../adapters/datasource'

// The served `ClientPolicy` (ADR-053). Deliberately the same shape as `apps/mobile/lib/useClientPolicy.ts`:
// six numbers, never null, never suspending — a screen asking "how many rows?" must get a number on its
// first render or it has to invent one, and an invented number is the drift this wave removes.
//
// Not shared with the RN app, and that is the right call rather than a shortcut: what would be shared
// is `useQuery` wiring, not a rule. The rule — what the numbers mean when the document is absent or
// partial — is `resolveClientPolicy` in `@nextbus/core`, and both apps call it.
const POLICY_STALE_MS = 6 * 60 * 60 * 1000

export function useClientPolicy(): { policy: ResolvedClientPolicy; source: 'served' | 'defaults' } {
  const query = useQuery({
    queryKey: ['clientPolicy'],
    queryFn: () => dataSource.getClientPolicy(),
    staleTime: POLICY_STALE_MS,
    retry: 1,
  })
  return { policy: resolveClientPolicy(query.data), source: query.data ? 'served' : 'defaults' }
}
