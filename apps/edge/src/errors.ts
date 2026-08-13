// Every way this Worker can fail, in one vocabulary (ADR-064).
//
// The rule this module exists to make unavoidable: **the status code and the meaning are one
// decision.** Before it, `fail()` took a number, and each call site picked one — which is how a
// malformed stop id came to leave the Worker as `502`. That is not a cosmetic mislabel. `5xx`
// reads as *retryable* to every HTTP client, cache and background scheduler in the path, so an
// iOS Widget holding a favourite whose id no longer parses retries it forever, on the rider's
// battery, and never learns to prune it. Adding a `code` field to the body would not have fixed
// that on its own: URLSession sees the status line first.
//
// So there is no way to construct a failure here without naming its code, and the status is read
// off `ERROR_CODES` in the contract rather than passed in. A new error path gets the right status
// by construction, or it does not compile.
//
// Two shapes, because failures arise in two places:
//   · `fail(code, message)` — the router knows exactly what is wrong and answers immediately.
//   · `throw new WireError(code, message)` — a handler deep in `stop-route.ts` knows *why* but not
//     how to reply; `errorResponse()` at the boundary turns it into the same envelope.
// Anything else that reaches a boundary is classified by `codeFor`, which is the only place in the
// system that guesses.

import { ERROR_CODES } from '@nextbus/contract'
// The wire shape of a failure, aliased because the *class* below already owns the name `WireError`
// in this module. Same taxonomy, two carriers: an HTTP body (`errorBody`) and `StatusFrame.error` on
// the `/v1/live` socket (`wireErrorOf`).
import type { ErrorCode, WireError as WireErrorPayload } from '@nextbus/core'

/** A failure that already knows its taxonomy member. Thrown by handlers, caught at the boundary. */
export class WireError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WireError'
  }
}

/** The id does not parse, or a required parameter is missing/unreadable. Permanent — the caller
 *  must change the request, and a background client should prune it. */
export const badRequest = (message: string): WireError => new WireError('bad_request', message)

/** The request is well-formed and names nothing we have. Permanent for the same reason: a stop that
 *  left the dataset does not come back because a Widget asked twice. */
export const notFound = (message: string): WireError => new WireError('not_found', message)

/**
 * Classify a throw we did not raise ourselves.
 *
 * Defaults to `upstream_unavailable`, not `internal`, and the reason is specific to where this is
 * called from: the producers at both boundaries are dataset reads (KV, R2, `data.hkbus.app`) and
 * live ETA calls, so an unclassified throw there is I/O far more often than a bug — and it keeps
 * today's `502` for every path that was not the id defect. `internal` is reached from the
 * top-level handler in `index.ts`, where a throw genuinely is our own.
 *
 * Timeouts are separated because they are the one upstream failure a client should back off from
 * differently: workerd raises `TimeoutError` for `signal: AbortSignal.timeout()` and `AbortError`
 * for an explicit abort, and neither is distinguishable from a refused connection by status alone.
 */
export function codeFor(err: unknown, fallback: ErrorCode = 'upstream_unavailable'): ErrorCode {
  if (err instanceof WireError) return err.code
  const name = (err as { name?: string } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'upstream_timeout'
  return fallback
}

/**
 * The taxonomy as a value — the three fields `WireError` declares, with `retryable` read off the
 * table rather than passed in.
 *
 * This exists because since WP5-3 the same failure travels two ways: as an HTTP response body, and
 * as `StatusFrame.error` on the `/v1/live` socket. The contract already made that one declaration
 * (`WireErrorSchema`, and `ErrorResponseSchema` is *that plus* the deprecated `error`), so the code
 * that builds it is one function too. Building the frame's error by hand at the shard would be the
 * defect this module was written to end, one layer up: a `retryable` chosen at a call site rather
 * than derived from the code, on the field a Widget uses to decide whether to prune a favourite.
 *
 * `packages/api-client` has a namesake for the client side of the same wire. They cannot share code —
 * `layers.json` forbids `server → client` — so they share the contract instead: both produce a value
 * of `WireError`, and both read `ERROR_CODES` for `retryable`.
 */
export function wireErrorFor(code: ErrorCode, message: string): WireErrorPayload {
  return { code, message, retryable: ERROR_CODES[code].retryable }
}

/**
 * The most of a thrown message that is allowed onto the wire.
 *
 * Two hundred characters, because a message here is a diagnostic and not a payload — and the throw
 * is not always ours to size. A `ZodError`'s `message` is its serialized issue list, which for an
 * upstream that changed shape runs to kilobytes and embeds the upstream's own field paths. Unbounded,
 * that lands in three places that must stay small: every `status` frame, every `EtaFailure` in a
 * frame's `failed` list, and — before WP6-8b slimmed it — the `EtaHub` socket attachment, whose hard
 * platform cap is 16,384 bytes for a session that also carries up to 64 route-watch targets.
 * `sameFailures` never compares the message, so nothing behavioural can notice the cut.
 */
const MAX_WIRE_MESSAGE_CHARS = 200

/** `message`, bounded — see `MAX_WIRE_MESSAGE_CHARS`. The ellipsis marks the cut for a human reader. */
export function boundedMessage(message: string): string {
  return message.length <= MAX_WIRE_MESSAGE_CHARS
    ? message
    : `${message.slice(0, MAX_WIRE_MESSAGE_CHARS - 1)}…`
}

/** A caught throw as a `WireError`, classified exactly as `errorResponse` classifies it. */
export function wireErrorOf(err: unknown, fallback?: ErrorCode): WireErrorPayload {
  const code = codeFor(err, fallback ?? 'upstream_unavailable')
  return wireErrorFor(code, boundedMessage((err as Error)?.message ?? String(err)))
}

/** The envelope, once. `error` duplicates `message` until ADR-064's deprecation window closes. */
export function errorBody(code: ErrorCode, message: string): Record<string, unknown> {
  return { error: message, ...wireErrorFor(code, message) }
}

/**
 * The only way to build a failure response. `headers` carries CORS in from the router — an error a
 * browser cannot read is an error the rider sees as a hang.
 *
 * Never cached: `ERROR_CODES` says nothing about `cache-control`, but a cached `404` outlives the
 * dataset republish that would have fixed it.
 */
export function fail(
  code: ErrorCode,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(errorBody(code, message)), {
    status: ERROR_CODES[code].status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

/**
 * A caught throw as a response: its own code if it declared one, otherwise `codeFor`'s guess.
 *
 * `context` prefixes the message ("stop error: …") for the unclassified case only — a `WireError`
 * already says what it is, and stacking a router-level prefix on it would bury that.
 */
export function errorResponse(
  err: unknown,
  headers: Record<string, string> = {},
  opts: { fallback?: ErrorCode; context?: string } = {},
): Response {
  const code = codeFor(err, opts.fallback ?? 'upstream_unavailable')
  const message = (err as Error)?.message ?? String(err)
  const prefix = err instanceof WireError || !opts.context ? '' : `${opts.context}: `
  return fail(code, `${prefix}${message}`, headers)
}
