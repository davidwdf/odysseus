import type { RoutePath } from '@nextbus/core'
import { useQuery } from '@tanstack/react-query'
import { dataSource } from '../adapters/datasource'

/**
 * The route's road-following line (ADR-152).
 *
 * **A separate query from the route payload on purpose.** The geometry is cached for a day at the
 * edge where the arrivals change every round, so sharing an entry would tie a day-cacheable body to
 * a 30-second one. It also means the stop list renders immediately and the line arrives when it
 * arrives — a route screen is useful long before its geography is.
 *
 * `staleTime: Infinity` because a route's alignment does not change while a rider is looking at it;
 * the upstream republishes on the order of a fortnight. `retry: false` because the failure that
 * matters here is not transient: ~7% of route-directions genuinely have no line, and the edge says
 * so with `available: false` and a **200**. A real error just means no line this time, which is the
 * same thing the screen already has to draw.
 */
export function useRoutePath(routeId: string | undefined) {
  return useQuery<RoutePath>({
    queryKey: ['route-path', routeId],
    enabled: !!routeId,
    queryFn: () => dataSource.getRoutePath(routeId as string),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}
