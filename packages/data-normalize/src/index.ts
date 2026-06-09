export { fetchCitybusEta } from './citybus'
export * from './dataset'
export { fetchKmbEta, fetchKmbRouteEta, type RouteEtaEntry } from './kmb'
export * from './kmb-static'
export * from './normalize'

import type { Eta } from '@nextbus/core'
import { fetchCitybusEta } from './citybus'
import { fetchKmbEta } from './kmb'

/** Operator-agnostic ETA fetch used by the edge worker's `/eta` endpoint. */
export async function fetchEta(
  operator: 'KMB' | 'LWB' | 'CTB',
  stopId: string,
  route: string,
  serviceType = '1',
  fetchImpl: typeof fetch = fetch,
): Promise<Eta[]> {
  if (operator === 'CTB') return fetchCitybusEta(stopId, route, fetchImpl)
  return fetchKmbEta(stopId, route, serviceType, fetchImpl)
}
