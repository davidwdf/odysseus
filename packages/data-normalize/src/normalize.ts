import type { Bound, I18nText, OperatorId } from '@nextbus/core'

/** Upstream uses "I"/"O" (and occasionally "inbound"/"outbound"). */
export function toBound(dir: string): Bound {
  return dir.trim().toUpperCase().startsWith('I') ? 'inbound' : 'outbound'
}

/** Stable, app-internal route id, e.g. `KMB:6:outbound:1`. */
export function canonicalRouteId(
  operator: OperatorId,
  routeNo: string,
  bound: Bound,
  serviceType: string,
): string {
  return `${operator}:${routeNo}:${bound}:${serviceType}`
}

export function i18nText(en: string, tc: string, sc: string): I18nText {
  return { en, 'zh-Hant': tc, 'zh-Hans': sc }
}

/** A remark only if at least one language is non-empty. */
export function optionalRemark(en: string, tc: string, sc: string): I18nText | undefined {
  return en || tc || sc ? i18nText(en, tc, sc) : undefined
}

/** Sort ISO-8601 arrival strings ascending and drop nulls. */
export function cleanArrivals(arrivals: Array<string | null>): string[] {
  return arrivals.filter((a): a is string => Boolean(a)).sort()
}
