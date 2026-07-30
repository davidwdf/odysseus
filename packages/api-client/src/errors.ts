// The failure taxonomy, on this side of the wire (ADR-064).
//
// Extracted from `index.ts` in WP5-1 for a mechanical reason worth stating: the poll transport in
// `./live/poll.ts` has to turn a failed `getEtas` into a `status` frame carrying `code` and
// `retryable`, and `index.ts` imports `./live` to build `watch()`. Left where it was, the two modules
// would import each other — and an ESM cycle between a class declaration and its consumer does not
// fail loudly, it throws a TDZ `ReferenceError` on whichever side happens to evaluate first, from a
// stack that names neither the cycle nor the class. Same reasoning as `WireErrorSchema` living in
// `wire/responses.ts` rather than in `wire/live.ts` (see its comment). The dependency runs one way:
// everything reads this file, this file reads nothing of ours.

import type { ErrorCode, ErrorResponse, WireError } from '@nextbus/core'

/**
 * A failed edge request, carrying the server's own classification (ADR-064).
 *
 * `getJson` used to throw `new Error("/v1/stop/… → HTTP 502")`, which left every caller with a
 * string to regex. The field that matters is `retryable`: it is what lets a Favourites screen — or,
 * once there is one, an iOS Widget — drop a saved stop whose id no longer resolves instead of
 * re-requesting it on every refresh for as long as the rider keeps it.
 *
 * Nothing here validates: `@nextbus/core`'s types erase (ADR-052), so this reads the envelope as
 * data and falls back on the status line if the body is not ours.
 */
export class EdgeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    /** Whether the identical request may succeed later. `false` = stop asking. */
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'EdgeRequestError'
  }
}

/**
 * Read the taxonomy off a failed response.
 *
 * The Worker always sends the envelope, so the fallback covers only a response that did not come
 * from it — a Cloudflare error page, a captive portal, a proxy. There the status line is genuinely
 * all we have, and `retryable` for an unidentified failure has to be "yes": treating an unreadable
 * 404 from a captive portal as permanent would prune a rider's favourites over airport wifi.
 */
export async function classifyFailure(path: string, res: Response): Promise<EdgeRequestError> {
  const body = (await res.json().catch(() => null)) as Partial<ErrorResponse> | null
  if (body && typeof body.code === 'string' && typeof body.retryable === 'boolean') {
    return new EdgeRequestError(
      res.status,
      body.code,
      body.retryable,
      body.message ?? body.error ?? `${path} → HTTP ${res.status}`,
    )
  }
  return new EdgeRequestError(res.status, 'internal', true, `${path} → HTTP ${res.status}`)
}

/**
 * Anything that was thrown, as the `error` a `StatusFrame` carries.
 *
 * **No new classification.** An `EdgeRequestError` already holds the server's own `code` and
 * `retryable`, so this copies them across; anything else — a `TypeError` from a browser whose network
 * went away, an abort, a bug in this package — becomes `internal` with `retryable: true`, which is the
 * *same* fallback `classifyFailure` above already makes for a response body that is not ours. Inventing
 * a sixth code for "the fetch never reached a server" would put a value on the wire that
 * `ERROR_CODES` does not bind to a status, and a client compiled against the enum would meet a member
 * it has never heard of for a case that is not even remote.
 *
 * `retryable: true` for the unknown case is the deliberately generous half, for the reason
 * `classifyFailure` gives: the cost of retrying something permanent is one wasted request per round;
 * the cost of not retrying something transient is a rider's favourite silently pruned over hotel wifi.
 */
export function wireErrorOf(thrown: unknown): WireError {
  if (thrown instanceof EdgeRequestError) {
    return { code: thrown.code, message: thrown.message, retryable: thrown.retryable }
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown)
  return { code: 'internal', message, retryable: true }
}
