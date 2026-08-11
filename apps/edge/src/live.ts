// `GET /v1/live` — the WebSocket upgrade, and the one place a shard is chosen.
//
// **The Worker picks the shard; the client never does (D4).** A client connects to
// `/v1/live?targets=…` and this module hashes the URL's targets with the kernel's `liveShardFor`.
// That deletes an agreement surface rather than moving one: if the client computed the shard, a build
// compiled against a stale `LIVE_SHARD_COUNT` would land on a *different* object — silently, with no
// error anywhere, sharing no upstream poll with the clients watching the same stops. The shard count
// is therefore a server-side constant that can change in one deploy, and the AsyncAPI channel says so
// at the `targets` parameter.
//
// **What is checked here rather than in the Durable Object, and why.** Cloudflare's own guidance:
// *"Both Workers and Durable Objects are billed based on the number of requests. Validate requests in
// your Worker to avoid billing for invalid requests against a Durable Object."* So everything that can
// be decided from the request alone — the method, the upgrade, the origin, whether the target list
// parses to anything at all — is decided before a stub exists. Only the two facts that need the
// shard's own state (how many sockets it holds, how many targets they watch between them) are checked
// inside `EtaHub`. Deriving and validating the shard key first also matters for a reason that is not
// about billing: an unvalidated key would let one request mint an unbounded number of Durable Objects.
//
// **This path is never edge-cached, and it does not touch `cached()`.** It is routed before every
// `caches.default` lookup in `index.ts`, and Cloudflare states the rule independently: *"WebSocket
// upgrade requests bypass the cache. A `GET` request carrying `Upgrade: websocket` always invokes your
// Worker."* Nothing here reads or writes the colo cache, so `buildScopedKey`'s invariants are
// untouched.

import { LIVE_PATH } from '@nextbus/contract'
import { acceptTargets, liveShardFor, routeWatchName, type WatchTarget } from '@nextbus/core'
import { getDataset } from './dataset'
import type { Env } from './env'
import { fail as failWith } from './errors'

/** The path, read from its one declaration in the contract rather than restated in the router. */
export { LIVE_PATH }

/**
 * The Durable Object name for a shard index.
 *
 * `getByName` is deterministic — the same string is the same object from anywhere on earth, with no
 * external id map to keep — and it is what makes `ctx.id.name` readable inside the object, including
 * inside `alarm()`. The prefix exists so a shard name can never be mistaken for anything else in the
 * namespace if this Worker ever addresses a second kind of object.
 */
export const liveShardName = (shard: number): string => `live-${shard}`

/**
 * The comma-separated `?targets=` list, as `WatchTarget`s.
 *
 * **Percent-encoding is the caller's job and the failure is silent, so it is stated twice** — here and
 * in the channel's own parameter description. `URLSearchParams` decodes `+` as a space, and a canonical
 * place id is `P:<member>+<member>`, so a hand-written `?targets=P:KMB:A+KMB:B` arrives as
 * `P:KMB:A KMB:B` and is rejected as malformed. `encodeURIComponent` is what the client transport uses
 * (`createSocketTransport.connectUrl`) and what `/v1/stop/{id}`'s parameter description already
 * demands for the same reason.
 *
 * No route narrowing: this parameter cannot express it, deliberately — the `subscribe` frame
 * re-declares the same set *with* per-stop `routeIds`, and the URL exists to pick a shard. Nothing is
 * validated here either; `acceptTargets` is the one rule that decides which targets are legal, and it
 * runs on both transports so a malformed favourite is dropped identically on each.
 */
export function parseLiveTargets(raw: string): WatchTarget[] {
  return raw
    .split(',')
    .filter((id) => id.length > 0)
    .map((stopId) => ({ stopId }))
}

/**
 * Is this an upgrade request?
 *
 * **Case-insensitive and whitespace-trimmed, but a single token only — and the runtime, not this
 * function, is what decides that.** Measured against the installed workerd (1.20260722.1) by handing
 * the same handler five header values and recording what came back:
 *
 * | `Upgrade:` | result |
 * |---|---|
 * | `websocket` | 101 |
 * | `WebSocket` | 101 |
 * | `WEBSOCKET` | 101 |
 * | `` ` websocket ` `` | 101 |
 * | `websocket, h2c` | **500** — *"Worker tried to return a WebSocket in a response to a request which did not contain the header `Upgrade: websocket`"* |
 *
 * So the first draft of this function — a lenient RFC 6455 token match, on the reasoning that a
 * multi-token field is legal and Cloudflare's own strict example would refuse a conformant client — was
 * *worse than the strict one*: it turned a clear 400 into an unhandled `TypeError` and a 500, because the
 * runtime refuses to attach a `webSocket` to the response and there is nothing this Worker can do about
 * it. The scout left this open ("if you want robustness use a case-insensitive check — but note their
 * published example is strict"); this is the answer, established by experiment. The case and whitespace
 * tolerance is real and free; the token tolerance is not ours to grant.
 */
function isUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.trim().toLowerCase() === 'websocket'
}

/**
 * The `Origin` policy — **advisory, browser-only, and not authorisation.** Read this before changing it.
 *
 * Three facts decide the shape, all of them from RFC 6455 rather than from CORS:
 *
 *  1. **A WebSocket handshake is not a CORS request.** There is no preflight, and
 *     `Access-Control-Allow-Origin` is *ignored* by the browser for an upgrade — so the `*` this Worker
 *     sends on every `/v1/*` response neither grants nor restricts anything here. Reading the `Origin`
 *     header and refusing the handshake is the only mechanism that exists (§10.2).
 *  2. **A missing `Origin` must be allowed.** §4.1 requires the header only "if the request is coming
 *     from a browser client"; for every other client it "MAY" be present. React Native's `WebSocket`
 *     takes `options.headers.origin` and omits it by default, and `curl`/`wscat` send whatever they are
 *     told. Rejecting an absent `Origin` would break exactly the iOS and Android clients this whole
 *     design exists for, and would protect nothing.
 *  3. **Therefore it is never authorisation.** Any non-browser client can send any `Origin` it likes.
 *     What this check does is stop a *page* on some other site from opening a socket with the rider's
 *     browser doing the connecting (CSWSH); what it does not do is stop anybody at all from connecting.
 *
 * So: unset `LIVE_ALLOWED_ORIGINS` means **no filtering**, which is today's configuration and is stated
 * plainly rather than dressed up — there is no production origin to allowlist because WP0-5 has not
 * happened, and inventing one would be claiming a deployment that does not exist. Setting it to a
 * comma-separated list turns the advisory filter on for browsers, in one deploy, with no code change.
 *
 * What actually protects this endpoint is elsewhere and mostly absent: the caps inside `EtaHub`
 * (present), Cloudflare rate limiting at the zone (needs the custom domain — WP0-5), and no auth at
 * all, which is correct for keyless public data and is the reason a missing `Origin` costs us nothing.
 */
function originAllowed(origin: string | null, allowlist: string | undefined): boolean {
  if (origin === null) return true
  const allowed = (allowlist ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (allowed.length === 0) return true
  return allowed.includes(origin)
}

/**
 * Route one `/v1/live` request: validate it, pick the shard, hand the upgrade to that Durable Object.
 *
 * `headers` carries the router's CORS map in, for the same reason `fail()` takes it: a **non-upgrade**
 * `GET /v1/live` is an ordinary cross-origin request a browser may well make (a client checking the
 * endpoint exists), and an error it cannot read is an error the rider sees as a hang. Note the asymmetry
 * that follows: the refusals `EtaHub` itself returns carry no CORS, because they are only ever reached
 * *from* a real upgrade, and the browser WebSocket API exposes neither the status nor the body of a
 * failed handshake — `curl -i` still shows the envelope, and that is who it is for.
 */
export async function liveUpgrade(
  request: Request,
  env: Env,
  headers: Record<string, string>,
): Promise<Response> {
  const fail = (code: Parameters<typeof failWith>[0], message: string): Response =>
    failWith(code, message, headers)

  // **A Worker with no `ETA_HUB` binding still runs.** That is ADR-055's degrade-to-slow promise and
  // the shape the whole edge already follows for `DATASET`/`BUILDS`: the live socket is unavailable,
  // says so permanently (`not_found` — this deployment does not serve it, and asking again will not
  // change that), and every client falls back to the poll transport, which is the default engine
  // anyway. A required binding would instead make `pnpm dev:edge` fail to start for anyone who has not
  // provisioned a Durable Object.
  if (!env.ETA_HUB) {
    return fail('not_found', 'live ETAs are not enabled on this deployment')
  }

  if (request.method !== 'GET') {
    return fail('bad_request', `${LIVE_PATH} is a GET upgrade, not ${request.method}`)
  }

  // **400 and not 426, deliberately.** The correct status for "you must upgrade" is 426 (Cloudflare's
  // own examples use it), and no member of `ERROR_CODES` carries 426 — by design: ADR-064 binds the
  // status to the *meaning* so a call site cannot pick one, and the meaning here is exactly
  // `bad_request`'s: the caller must change the request, and no amount of asking again will help
  // (`retryable: false`). Answering 426 would mean either adding a taxonomy member — a contract change,
  // an ADR and a re-emit of two published documents, for a status whose only conformant use also
  // requires an `Upgrade` response header nothing in this repo sends — or hard-coding a number beside
  // the one table that exists to stop that. Recorded as a follow-up (`upgrade_required`) rather than
  // improvised here.
  if (!isUpgrade(request)) {
    return fail('bad_request', `${LIVE_PATH} requires an "Upgrade: websocket" request`)
  }

  if (!originAllowed(request.headers.get('origin'), env.LIVE_ALLOWED_ORIGINS)) {
    return fail('bad_request', 'origin not allowed')
  }

  const url = new URL(request.url)

  /*
    **`?route=` — the whole route, resolved here rather than named by the client** (proposals/05).

    Citybus and GMB publish no bulk route-eta feed, so a route screen has no times at all (ADR-114) while
    their per-pole boards answer perfectly well. A route watch subscribes to every pole of one route, which
    is ~13–41 of them, and three things follow from resolving that server-side:

     · **the URL stays short** — 41 percent-encoded ids in a query string, on every reconnect, versus one
       route id;
     · **the target set has one source of truth** — the same route document `/v1/route/:id` reads, so the
       socket cannot watch a pole the schematic does not draw;
     · **the client cannot pick the object.** As with `liveShardFor`, the Worker derives the name, so a
       client compiled against a stale rule lands nowhere unexpected.

    Everything about *being* a route watch then follows from the object's name, which is why nothing else is
    passed: see `routeIdFromWatchName` and `EtaHub.watchedRoute`.
  */
  const routeId = url.searchParams.get('route')
  if (routeId !== null) {
    const name = routeWatchName(routeId)
    // Refused before a stub exists, for the reason `routeWatchName` documents: `route-` plus arbitrary text
    // is a real Durable Object, and this is the door that arbitrary text arrives at.
    if (name === undefined) return fail('bad_request', `not a route id: ${routeId}`)

    const doc = await (await getDataset(env)).route(routeId)
    // Absent is nobody's fault and not worth retrying — the same split `routeDetail` makes between a
    // malformed id and an unknown one.
    if (!doc) return fail('not_found', `unknown route: ${routeId}`)

    const poles = doc.stops.map((stop) => stop.id)
    if (poles.length === 0) return fail('not_found', `route has no stops: ${routeId}`)

    // The object is told what to watch through `?targets=`, exactly as a place watch is — one door into the
    // shard, so a route watch is not a second protocol. What makes it a *route* watch is its name: the
    // object reads that to narrow every reading to this route and to use its own caps. Excess poles are
    // dropped and named by the shard, not silently truncated here.
    const forwarded = new URL(url)
    forwarded.searchParams.set('targets', poles.join(','))
    return env.ETA_HUB.getByName(name).fetch(new Request(forwarded, request))
  }

  const raw = url.searchParams.get('targets')
  if (raw === null) {
    return fail(
      'bad_request',
      `usage: ${LIVE_PATH}?targets=<comma-separated canonical stop or place ids, percent-encoded> — or ${LIVE_PATH}?route=<canonical route id> for every pole of one route`,
    )
  }

  const asked = parseLiveTargets(raw)
  const { accepted } = acceptTargets(asked)
  // Refused *before* a stub exists, on the kernel's own instruction: `liveShardFor` documents that "a
  // connection with nothing to watch should be refused before it gets here — the shard it would land on
  // is not a meaningful answer" (an empty set hashes the empty string, so every such client would pile
  // onto one object). The honest signal is a 400: nothing in this list is a stop we can watch.
  if (accepted.length === 0) {
    return fail('bad_request', `no watchable target in "${raw}"`)
  }

  // `liveShardFor` runs `acceptTargets` itself and hashes the lowest accepted id, so passing the
  // already-canonical set is the same number for one less pass — and it is why the per-connection
  // target cap inside the shard cannot move a client to a different object: the cap truncates in
  // canonical order, which never removes `accepted[0]`.
  const shard = liveShardFor(accepted)
  return env.ETA_HUB.getByName(liveShardName(shard)).fetch(request)
}
