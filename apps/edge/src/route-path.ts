import type { RoutePathSchema } from '@nextbus/contract'
import {
  type PathPoint,
  type ResolvedRoutePath,
  type RoutePathCandidate,
  resolveRoutePath,
} from '@nextbus/core'
import type { RouteDoc } from '@nextbus/data-normalize'
import { UPSTREAM_TIMEOUT_MS } from '@nextbus/data-normalize'
import type { z } from 'zod'

// `GET /v1/route/:id/path` — the road-following line for one route (WP-M2 of docs/proposals/06,
// ADR-152/153).
//
// The Transport Department publishes route lines on the **CSDI portal**, keyed on `ROUTE_ID`, which
// is the consolidated dataset's `gtfsId`. This module fetches the candidates and hands them to
// `resolveRoutePath` in `@nextbus/core`, which owns every decision: which candidate, which way
// round, and where to cut. Nothing here decides anything a renderer could observe — that split is
// ADR-068/069's, and it is what stops two renderers drawing different lines.
//
// **Why the edge and not the client.** Rule 2: a view may not know a URL, and
// `check-view-transport-free` scans for the literal because an import graph cannot see one. The
// caching and the licence attribution both already live here for tiles (ADR-049), and the same
// applies to geometry: this is Government data under the DATA.GOV.HK terms, which require
// attribution and permit caching, and the Worker is where we honour both once.

/** CSDI dataset ids. Green minibus routes are a separate dataset from franchised buses. */
const CSDI_BUS = 'td_rcd_1638844988873_41214'
const CSDI_GMB = 'td_rcd_1697082463580_57453'

/**
 * How long a resolved path may be cached. The upstream datasets move on the order of a fortnight,
 * and a route's alignment is the most static thing we serve — far more so than a fare. A day is
 * conservative against that and still keeps the CSDI round trip off the hot path.
 */
export const ROUTE_PATH_TTL_SEC = 86_400

/** Precision we keep, in decimal places. 5 dp ≈ 1 m — below the survey's own accuracy. */
const COORD_DP = 5

interface CsdiFeature {
  properties?: Record<string, unknown> | null
  geometry?: { type?: string; coordinates?: unknown } | null
}

/**
 * Flatten a CSDI geometry into one vertex run.
 *
 * The bus dataset publishes `MultiLineString` — a route split into per-road-segment parts that join
 * end to end — and the GMB dataset publishes `LineString`. Both become one array here, because the
 * resolver's job is "which road does this route run along", and a part boundary carries no meaning
 * a rider could see. Anything that is not a run of `[lng, lat]` pairs is dropped rather than
 * guessed at.
 */
export function flattenGeometry(geometry: CsdiFeature['geometry']): PathPoint[] {
  const coords = geometry?.coordinates
  if (!Array.isArray(coords)) return []
  const out: PathPoint[] = []
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      out.push([node[0], node[1]])
      return
    }
    for (const child of node) visit(child)
  }
  visit(coords)
  return out
}

function round(value: number): number {
  const f = 10 ** COORD_DP
  return Math.round(value * f) / f
}

/** Which CSDI dataset holds this operator's lines. */
function datasetFor(operator: string): string {
  return operator === 'GMB' ? CSDI_GMB : CSDI_BUS
}

function queryUrl(dataset: string, where: string): string {
  const params = new URLSearchParams({
    where,
    outFields: 'ROUTE_ID,ROUTE_SEQ',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  })
  return `https://portal.csdi.gov.hk/server/rest/services/common/${dataset}/FeatureServer/0/query?${params}`
}

async function fetchCandidates(
  url: string,
  matchedBy: 'gtfsId' | 'routeNumber',
): Promise<RoutePathCandidate[]> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cf: { cacheTtl: ROUTE_PATH_TTL_SEC, cacheEverything: true },
  } as RequestInit)
  if (!response.ok) throw new Error(`csdi ${response.status}`)
  const body = (await response.json()) as { features?: CsdiFeature[] }
  const features = Array.isArray(body.features) ? body.features : []
  const out: RoutePathCandidate[] = []
  for (const feature of features) {
    const line = flattenGeometry(feature.geometry)
    if (line.length < 2) continue
    const id = feature.properties?.ROUTE_ID
    const seq = feature.properties?.ROUTE_SEQ
    out.push({
      id: id == null ? 'unknown' : String(id),
      seq: typeof seq === 'number' ? seq : undefined,
      matchedBy,
      line,
    })
  }
  return out
}

/**
 * The wire shape is `RoutePathSchema` in `@nextbus/contract` — the ONE declaration (ADR-052). This
 * alias exists so a drift between the two is a typecheck failure rather than something a reader has
 * to notice.
 *
 * It was NOT declared when this endpoint shipped in M2: the contract's own gate only checks endpoints
 * that appear in `WIRE_ENDPOINTS`, so an undeclared one passed silently. Recorded because the gap was
 * invisible by construction, which is the kind that lasts.
 */
export type RoutePathResponse = z.infer<typeof RoutePathSchema>

/**
 * Resolve one route's line.
 *
 * **A route with no line is a 200, not a 404.** About 7% of bus and minibus route-directions have
 * none, overwhelmingly the racecourse, school and peak-hour variants the TD does not separately
 * register — that is an ordinary property of the data, and a screen has to render *something* for
 * it either way (docs/proposals/06 §5). A 404 would make "no geometry" indistinguishable from "no
 * such route", which is a different thing and already answered by `/v1/route/:id`.
 */
export async function routePath(doc: RouteDoc, routeId: string): Promise<RoutePathResponse> {
  const empty: RoutePathResponse = {
    routeId,
    path: [],
    available: false,
    source: 'csdi',
    attribution:
      'Route alignment © Transport Department (CSDI), under the DATA.GOV.HK Terms of Use',
  }

  const stops = doc.stops.map((s) => ({ lat: s.lat, lng: s.lng }))
  if (stops.length < 2) return empty

  const dataset = datasetFor(doc.route.operator)
  let candidates: RoutePathCandidate[] = []
  if (doc.gtfsId) {
    candidates = await fetchCandidates(
      queryUrl(dataset, `ROUTE_ID=${encodeURIComponent(doc.gtfsId)}`),
      'gtfsId',
    )
  }
  // Fallback: match on the route number. Lifts coverage from ~93% to ~96%, and is ambiguous by
  // construction — NLB route 1 matches five ROUTE_IDs — which is exactly what the resolver's
  // reject threshold is calibrated to guard (ADR-153).
  if (candidates.length === 0) {
    const field = doc.route.operator === 'GMB' ? 'ROUTE_NAME' : 'ROUTE_NAMEE'
    const escaped = doc.route.routeNo.replace(/'/g, "''")
    candidates = await fetchCandidates(
      queryUrl(dataset, `${field}='${encodeURIComponent(escaped)}'`),
      'routeNumber',
    )
  }
  if (candidates.length === 0) return empty

  const resolved: ResolvedRoutePath | null = resolveRoutePath(stops, candidates)
  if (!resolved) return empty

  return {
    ...empty,
    // The wire type is a mutable `number[][]`; the kernel's `PathPoint` is a readonly tuple.
    path: resolved.path.map((p) => [round(p[0]), round(p[1])]),
    available: true,
    fitMetres: Math.round(resolved.fitMetres * 10) / 10,
    matchedBy: resolved.matchedBy,
    reversed: resolved.reversed,
  }
}
