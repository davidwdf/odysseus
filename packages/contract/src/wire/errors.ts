// The failure taxonomy, and the one shape built on top of it — in their own module so that everything
// which needs to describe a failure can reach it without an import cycle.
//
// WHY THIS IS NOT IN `./responses.ts`, WHERE IT LIVED UNTIL ADR-077
// It was there for a real reason, and that reason still holds: `WireError` needs `ErrorCodeSchema`,
// which is declared beside the one `ERROR_CODES` table binding a code to its status, so putting the
// error body in `./live.ts` would have made `responses.ts` and `live.ts` import each other. The fix was
// to keep both in `responses.ts`.
//
// WP5-13 broke that arrangement, mechanically rather than by preference: `EtaFailure` is now a field on
// `NearbyStop` and `StopDetail`, which live in `./detail.ts` — and `responses.ts` **imports**
// `./detail.ts` for `WIRE_ENDPOINTS`. So `detail.ts → responses.ts` closes a cycle, and an ESM cycle
// between two modules of top-level `const`s does not fail loudly: it evaluates one of them to
// `undefined`, which surfaces as a schema silently missing a field. Exactly the failure the original
// note warned about, arriving from the other direction.
//
// So the taxonomy moves down to a module that imports **nothing of ours**, and `./responses.ts`
// re-exports every name it used to declare — no caller anywhere changes. The dependency now runs one
// way from here: `responses.ts`, `live.ts` and `detail.ts` all read this file, and it reads none of them.

import { z } from 'zod'

/**
 * The error taxonomy (ADR-064).
 *
 * **`x-unknown-tolerant` matters more here than anywhere else in the contract.** This vocabulary
 * will grow — `rate_limited` is the obvious next member — and an error response is precisely the
 * payload a client is least able to recover from by throwing. That is also why `retryable` rides
 * on the wire as its own boolean instead of being a table a client compiles in: a client that has
 * never heard of a code still knows what to do with it.
 */
export const ErrorCodeSchema = z
  .enum(['bad_request', 'not_found', 'internal', 'upstream_unavailable', 'upstream_timeout'])
  .meta({ id: 'ErrorCode', 'x-unknown-tolerant': true })

/**
 * The status code and the retry advice that belong to each member — **one table, not three**.
 *
 * The defect this replaces was not "the envelope lacks a code". It was that the status code and
 * the meaning were chosen separately at each `fail()` call site, so a malformed id left the Worker
 * as `502` — which reads as *retryable* to every HTTP client and cache in the path. An iOS Widget
 * holding a favourite whose id no longer parses would retry it forever, and no amount of adding
 * `code` to the body fixes that, because the Widget's URLSession sees the status line first.
 * Binding the two together here is what makes them one decision: `apps/edge/src/errors.ts` takes a
 * code and reads the status off this table, so a new error path physically cannot pick a status
 * that disagrees with its meaning.
 *
 * `retryable` is "may the same request succeed later?", which is the question a Widget is actually
 * asking — *prune this favourite permanently, or try again next refresh?* So `internal` is
 * retryable: a fault on our side is not evidence that the rider's saved stop is gone, and pruning
 * their favourites over our own bug is the worse failure.
 *
 * `satisfies Record<z.infer<typeof ErrorCodeSchema>, …>` is the drift gate — adding a member to
 * the enum without a status is a typecheck error, and so is a table entry with no enum member.
 */
export const ERROR_CODES = {
  bad_request: { status: 400, retryable: false },
  not_found: { status: 404, retryable: false },
  internal: { status: 500, retryable: true },
  upstream_unavailable: { status: 502, retryable: true },
  upstream_timeout: { status: 504, retryable: true },
} as const satisfies Record<z.infer<typeof ErrorCodeSchema>, { status: number; retryable: boolean }>

/**
 * A failure, as a body — the three fields that say what went wrong and what to do about it.
 *
 * **Why this is not simply `ErrorResponse`.** Since WP5-1 the same taxonomy has to travel two ways:
 * as an HTTP response body, and as `StatusFrame.error` on the `/v1/live` socket. Two hand-written
 * declarations of "a failure" would fork the moment one of them gained a field — and they would fork
 * *quietly*, because each side has its own tests and neither would notice the other had moved. So the
 * failure body is declared once here, beside the `ERROR_CODES` table it is classified by, and
 * `ErrorResponse` is defined below as *exactly this plus the deprecated duplicate*. Saying that in the
 * type is better than saying it in a comment.
 *
 * It lives in this file rather than in `wire/live.ts` for a mechanical reason worth stating: the
 * socket module needs `WireError`, and `WireError` needs `ErrorCodeSchema`, which is here with the one
 * table that binds a code to its status. Declaring it there instead would make `responses.ts` and
 * `live.ts` import each other, and an ESM cycle between two modules of top-level `const`s does not
 * fail loudly — it evaluates one of them to `undefined`, which surfaces as a schema silently missing a
 * field. The dependency runs one way: `live.ts` reads this file.
 */
export const WireErrorSchema = z
  .object({
    code: ErrorCodeSchema,
    message: z.string().meta({
      description:
        'Human-readable, English, and **not** a stable identifier — it names the offending value and its wording changes freely. Do not match on it.',
    }),
    retryable: z.boolean().meta({
      description:
        'Whether the identical request may succeed later. `false` means the request is permanently wrong (a malformed or deleted id) and a background client — an iOS Widget, a watch complication — should prune it rather than retry.',
    }),
  })
  .meta({ id: 'WireError' })

/**
 * The error envelope every non-2xx JSON response carries: a `WireError`, plus one field kept alive
 * for older clients.
 *
 * `error` is **deprecated and still served**: ADR-052 §5 makes additive free and removal breaking,
 * so `code`/`message`/`retryable` land alongside it and it is retired in a later, gated change
 * (ADR-064 says which one). It is a duplicate of `message` for as long as it exists — do not read
 * both, and do not parse either. `code` is the field to branch on.
 *
 * `.extend()` emits a flat object rather than an `allOf` of the two, so the published component is
 * unchanged in content — a generator sees the same four properties it always did. What changed is that
 * `code`, `message` and `retryable` now have one declaration instead of two, and the socket's
 * `StatusFrame.error` reads that one.
 */
export const ErrorResponseSchema = WireErrorSchema.extend({
  error: z.string().meta({
    deprecated: true,
    description: 'Duplicate of `message`, kept for pre-ADR-064 clients. Branch on `code`.',
  }),
}).meta({ id: 'ErrorResponse' })

/**
 * One boarding point whose upstream board we could not read this round, and why (ADR-073).
 *
 * The unit is the **pole**, not the place and not the route, because the pole is what an upstream call
 * is *for*: a KMB or GMB board is one call per pole, and Citybus is one per (pole, route) — so a
 * Citybus place with one refusing route reports that pole once, and the routes that did answer are in
 * `etas` as usual. Aggregating to the place would say "we could not ask about this stop" when we asked
 * about three of its four kerbs and got answers; splitting to the route would report the same outage
 * a dozen times.
 *
 * `stopId` is the same canonical pole id an `Eta` carries — the one `atPole` stamps and the one
 * `formatFavoriteRouteKey` encodes — so a client can match a failure against the readings it already
 * holds without a second id vocabulary. `error` is the taxonomy (ADR-064) rather than a bare string,
 * because `retryable` is what a background client needs and a message is not something to branch on.
 */
export const EtaFailureSchema = z
  .object({
    stopId: z
      .string()
      .describe(
        'Canonical id of the POLE whose upstream board did not answer — the same spelling `Eta.stopId` carries, so a client can pair a failure with the readings it already holds.',
      ),
    error: WireErrorSchema,
  })
  .meta({ id: 'EtaFailure' })
