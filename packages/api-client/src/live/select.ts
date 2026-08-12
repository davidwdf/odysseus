// Which engine a configured spelling selects — the one declaration of it (WP5-6, ADR-076).
//
// WHY A MODULE, WHEN THE ANSWER IS A THREE-BRANCH SWITCH
// Because the *read* of the environment variable cannot live here and the *decision* must not live at
// the read. `process.env.EXPO_PUBLIC_*` and `import.meta.env.VITE_*` are inlined at build time by two
// different bundlers — babel-preset-expo's inliner only visits a literal `process.env.X` member
// expression, so a destructure, a computed key or a helper taking the name as an argument bakes in
// **nothing** and the value is silently `undefined` in a production bundle. `endpoint.ts` explains the
// same constraint for the API URL. So each app shell keeps one literal read, and both hand the string
// here, which is the only part that can be shared and the only part with a rule in it.
//
// Before this, `EdgeClientOptions.transport` was the plumbing and nothing read the documented
// variables: `/v1/live` shipped **unreachable from a real build**, and every one of the five shard
// defects Wave 5's review found was latent for exactly that reason (ADR-056, "what is not done").
// Flipping a variable is now the whole change, which is why the default has to be the safe one.

import type { LiveEngine, LiveEtaEngine, LiveTransportContext } from './engine'
import { createPollTransport } from './poll'
import { createSocketTransport } from './socket'

/**
 * The two legal spellings, as data — so the warning below can name them and a test can enumerate them.
 *
 * **There is deliberately no `auto` spelling, and there is now a supervised fallback — those are
 * different things** (WP6-8b; the original "no fallback exists" stance is ADR-056's, amended). A
 * *transport* still never quietly becomes a different transport: `createSocketTransport` reconnects for
 * ever, because a socket that silently turned into a poll would make "which engine is driving"
 * unanswerable and would hide a broken socket behind a working poll. What changed is one level up:
 * `EdgeClient` supervises a socket *subscription* and rebuilds it on the poll engine after
 * `SOCKET_FALLBACK_AFTER_FAILURES` consecutive connection failures with no data ever delivered — a
 * whole-subscription swap with a stated trigger, not a transport mood. The stance was written when the
 * socket was opt-in behind an env var; once ADR-121 made it the *default*, "no fallback" changed
 * meaning: a rider whose network blocks WebSockets (an office proxy, a captive portal — and a browser
 * exposes neither the status nor the body of a refused upgrade, so nothing can even say why) would ship
 * with live times that never arrive. Degrade-to-slow is the promise the edge already makes for every
 * missing binding (ADR-055); this extends it to the network path.
 */
export const LIVE_ENGINES: readonly LiveEngine[] = ['poll', 'socket']

/**
 * Consecutive socket connection failures — with **no data frame ever delivered** — before a
 * subscription is rebuilt on the poll engine (WP6-8b).
 *
 * Three, which at the kernel's reconnect schedule (1 s → 2 s → 4 s, half-jittered) means a
 * WebSocket-hostile network is discovered and degraded within roughly ten seconds of first paint —
 * inside one poll cadence, so the rider's first live round arrives about when the socket's first
 * round would have. One failure is a blip a reconnect absorbs; three in a row with nothing ever
 * received is a network that does not carry this protocol.
 *
 * The guard is "never delivered data", not "recently failed": a socket that has ever produced a frame
 * has proved the path works, and its failures thereafter are outages the reconnect schedule owns —
 * falling back *then* would swap a recovering fast engine for a slow one mid-journey. And a terminal
 * `closed` + `retryable: false` never counts: the server answered, and what it said was "stop asking",
 * which polling the same targets would not change.
 */
export const SOCKET_FALLBACK_AFTER_FAILURES = 3

/**
 * The shipped default — **the socket since 2026-08-11**, and the reason is a measurement rather than a
 * preference (ADR-121).
 *
 * The poll emulator asks `/v1/etas?ids=…`, which carries no per-id route list, so every pole it names is
 * asked about **every route that calls there**. Measured on Citybus 182 (31 poles, `wrangler dev` against
 * the live feed): one chunk of twelve poles cost **153 upstream calls and 19.9 s**, where the same twelve
 * narrowed to route 182 cost **12 calls and 0.49 s** — and a whole round was **~395 calls / 75.7 s** against
 * a 30 s cadence, so rounds overlapped and queued behind each other for as long as the screen stayed open.
 * The socket's round is one call per pole because the Durable Object narrows from its own name (ADR-116/117).
 *
 * Two more things follow from where the work happens rather than from how fast it is. The fan-out runs **at
 * the edge**, so a rider on a slow or distant connection pays for one WebSocket and some small frames
 * instead of three batch requests per round. And every client watching one route shares **one** round, which
 * is the property the whole design was built for and which polling cannot have.
 */
export const DEFAULT_LIVE_ENGINE: LiveEngine = 'socket'

/**
 * A configured spelling → the engine it names. Anything unrecognised is the default, **loudly**.
 *
 * The two failure modes were weighed and neither is free:
 *
 *  · **Throwing** on a typo — `EXPO_PUBLIC_LIVE_TRANSPORT=websocket` — breaks first paint over a
 *    misconfigured *optional* knob, on a screen whose data layer is constructed at module scope. That
 *    is a worse outcome than the misconfiguration.
 *  · **Silently polling** is this repo's own recurring failure shape: a gate that passes while looking
 *    at nothing. Somebody sets the variable, sees ordinary behaviour, and concludes the socket works.
 *
 * So it falls back and says so once, on the console, naming the value it did not understand and the two
 * it does. `endpoint.ts` argues the same way about not validating a base URL: make a misconfiguration
 * *visible* rather than fatal or invisible.
 *
 * An absent or empty value is the normal case and warns about nothing.
 */
export function liveEngineFrom(spelling: string | undefined): LiveEngine {
  if (spelling === undefined || spelling === '') return DEFAULT_LIVE_ENGINE
  if ((LIVE_ENGINES as readonly string[]).includes(spelling)) return spelling as LiveEngine
  console.warn(
    `[live] ignoring LIVE_TRANSPORT="${spelling}" — expected one of ${LIVE_ENGINES.join(' | ')}; ` +
      `using "${DEFAULT_LIVE_ENGINE}"`,
  )
  return DEFAULT_LIVE_ENGINE
}

/**
 * The transport factory for an engine — what an app shell passes to `EdgeClientOptions.transport`.
 *
 * The socket branch is three arguments wide and every one of them matters:
 *
 *  · **`ctx.endpoints.socketUrl`, read inside the factory.** `EdgeClient.watch()` calls the factory
 *    once per *subscription*, and the socket's connect URL carries `?targets=` because the **Worker**
 *    derives the shard from it (D4). A closure that captured a URL built at module scope would be wrong
 *    the moment a second screen watched a different place.
 *  · **`ctx.clock`, not `Date.now`.** The frames' `at` stamps come from the client's injected clock, so
 *    a test that pinned the clock and got real timestamps anyway would be comparing two engines with
 *    one of them ignoring the pin.
 *  · **`ctx.route`, when the subscription is a whole route** (ADR-116/119). Forwarded rather than
 *    defaulted, and this line is here because its absence was a real defect: this factory is where a
 *    `LiveTransportContext` becomes `SocketTransportDeps`, so a field the context grew and this call did
 *    not copy is silently dropped — `watchRoute` built its controller, called `open()`, and connected to
 *    nothing at all. Every unit test passed, because they construct `createSocketTransport` directly with
 *    the field. Found by opening a Citybus route in a browser, which is the only place the two halves meet.
 *  · **Nothing else.** `timers`, `socketFactory`, `keepaliveMs`, `backoff` and `random` all default —
 *    and `browserSocketFactory` is the platform `WebSocket`, which React Native ships too, so one
 *    adapter serves both renderers and no app shell ever names a socket.
 */
export function liveTransportFor(engine: LiveEngine): (ctx: LiveTransportContext) => LiveEtaEngine {
  if (engine === 'socket') {
    return (ctx) =>
      createSocketTransport({
        url: ctx.endpoints.socketUrl,
        clock: ctx.clock,
        ...(ctx.route === undefined ? {} : { route: ctx.route }),
      })
  }
  return createPollTransport
}

/**
 * The whole of WP5-6 at a call site: a configured spelling → a transport, or `undefined` for the default.
 *
 * `undefined` rather than a factory for the default case on purpose: it leaves *the client* holding the
 * answer to "what is the default", which is where the two app shells and every test agree it lives. An app
 * shell that spelled the default itself would be a second declaration of it, and the day the default changes
 * it would be the one that did not — which is exactly the day this comment was rewritten, so the mechanism
 * earned its keep: flipping `DEFAULT_LIVE_ENGINE` moved both shells and neither was edited.
 */
export function liveTransportFromEnv(
  spelling: string | undefined,
): ((ctx: LiveTransportContext) => LiveEtaEngine) | undefined {
  const engine = liveEngineFrom(spelling)
  return engine === DEFAULT_LIVE_ENGINE ? undefined : liveTransportFor(engine)
}
