import { type Bound, formatRouteId, type I18nText } from '@nextbus/core'

/**
 * How long one upstream ETA call may take before it is abandoned.
 *
 * Ten seconds, against feeds whose healthy answer is a few hundred milliseconds — this is not a
 * latency budget but a hang detector. Measured 2026-08-12 23:10 HKT (off-peak), 8 samples per feed
 * from a residential connection: KMB stop-eta 238–357 ms, KMB route-eta 304–364 ms, CTB eta
 * 154–621 ms, GMB stop-eta 155–612 ms — the two ~0.6 s outliers were first-touch CDN misses. All
 * three feeds sit behind CDNs, so client-observed latency tracks cache state rather than passenger
 * volume; rush hour grows the *payload* (more arrivals per board), not the wait, and the Worker
 * fetches from Cloudflare's edge, which is closer to those CDNs than the machine that took these
 * numbers. Ten seconds is therefore ~16–60× the observed worst case: anything that trips it is a
 * wedged connection, not a slow answer. Without it a single wedged connection holds everything built
 * on top: the `EtaHub` round `Promise.all`s every target and cannot send anyone a frame (or schedule
 * its next alarm) until the slowest board resolves; the coalescer shares the hung promise with every
 * concurrent HTTP caller for its whole TTL; and a hung call occupies one of the runtime's six
 * simultaneous outgoing connections, which is the number every fan-out cap's arithmetic is written
 * in terms of. The edge's classifier has been ready for this since ADR-064 — workerd raises
 * `TimeoutError` for `signal: AbortSignal.timeout()`, which `codeFor` maps to `upstream_timeout`
 * (`retryable: true`) — but until this constant existed nothing ever produced one, so that taxonomy
 * member was unreachable in practice.
 */
export const UPSTREAM_TIMEOUT_MS = 10_000

/**
 * `fetchImpl` with the timeout attached — the one way an adapter calls upstream.
 *
 * A helper rather than a `signal:` at each call site so the constant cannot be forgotten by the next
 * adapter. `AbortSignal.timeout` exists everywhere these adapters run: workerd (verified by the
 * `TimeoutError` note above), and Node ≥ 17.3 for the dataset build. Test stubs typed `typeof fetch`
 * are free to ignore the init, and most do.
 */
export function fetchUpstream(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
}

/** Upstream uses "I"/"O" (and occasionally "inbound"/"outbound"). */
export function toBound(dir: string): Bound {
  return dir.trim().toUpperCase().startsWith('I') ? 'inbound' : 'outbound'
}

/**
 * Stable, app-internal route id, e.g. `KMB:6:outbound:1`.
 *
 * The template moved to the id grammar in `@nextbus/core` (WP1-2), where the *parser* lives too —
 * a format and a parse that can drift apart is how a grammar stops being one. Kept under this name
 * because two dozen call sites in the adapters read better as `canonicalRouteId`, and renaming them
 * would bury the actual change in noise.
 */
export const canonicalRouteId = formatRouteId

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
