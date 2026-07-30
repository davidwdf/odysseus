/**
 * # LiveTransport — a socket, as a type
 *
 * **What a native developer must supply:** one object that can be opened, hands every frame it
 * receives to a callback, accepts frames going the other way, and closes. Four members, no state
 * machine. Every platform already has the implementation; what it does not have is agreement about
 * where the *rest* of a live subscription lives, which is what this file is for.
 *
 * | Platform | Implementation |
 * |---|---|
 * | Web / React Native | the global `WebSocket` — `packages/api-client/src/live/socket.ts` |
 * | iOS | `URLSessionWebSocketTask` (`receive(completionHandler:)` re-armed per message) |
 * | Android | OkHttp `WebSocket` + `WebSocketListener` |
 *
 * The web implementation is shared by the PWA and by React Native, because React Native ships a
 * `WebSocket` global too (`Libraries/WebSocket/WebSocket.js`), so `packages/api-client`'s transport is
 * the implementation for two of the three platforms and iOS/Android need one only if they choose a
 * native client over the JS one.
 *
 * ## What deliberately sits *above* this port, and not in it
 *
 * This is the interesting part of the file; the signature is trivial. Three things a socket
 * implementation is constantly tempted to grow, each of which belongs one layer up:
 *
 *  1. **Reconnection and backoff.** *When* to try again, how fast to widen the delay, when to stop
 *     asking — that is a policy three platforms must not each invent, and it is written down once in
 *     `createSocketTransport`. A port that owned it would make the policy unobservable: a test could
 *     no longer watch the second attempt happen at the right moment without a real socket and a real
 *     clock.
 *  2. **The frame reducer.** What a `snapshot` or a `delta` *means* — merge by identity, honour
 *     `gone`, ask for a resync on a gap — is `applyLiveFrame` in `@nextbus/core`, pinned by
 *     `packages/core/spec/live.spec.json` and hand-ported to Swift and Kotlin from that corpus. A
 *     transport that reduced frames would be a second implementation of the protocol per platform,
 *     which is the one thing this repo's whole layering exists to prevent.
 *  3. **The subscription lifecycle** — sending `subscribe`, keepalive, re-declaring targets after a
 *     reconnect, deciding what the rider is told — is `createLiveEtaController`, the same shape as
 *     `createLocationController`.
 *
 * That note is not decoration. `LocationProvider` has three methods and its doc says *"there is no
 * `watch()` here on purpose"*, and the reason it is still three methods is that the sentence exists:
 * grid-snapping, the remembered fix and the state machine all tried to move into it and were kept out
 * (ADR-051 records the version where they had not been). A socket attracts the same pressure with more
 * force, because a reconnect looks like the socket's own business.
 *
 * ## Why it is generic over the frames rather than importing them
 *
 * `packages/ports` imports **nothing** — not `@nextbus/core`, not `@nextbus/contract` (rule 1 in
 * `index.ts`). The frames are declared once in `@nextbus/contract/src/wire/live.ts` and reach the
 * client as `ServerFrame` / `ClientFrame`, so this interface takes them as type parameters exactly the
 * way `TileSource<LocaleId, ImageAsset>` takes the locale union and the platform's image type
 * (ADR-051). `packages/api-client` instantiates `LiveTransport<ServerFrame, ClientFrame>`; a native
 * client instantiates it over its own generated frame types; the port itself stays import-free and no
 * concept ends up declared twice.
 *
 * ## The two shapes that are *not* here, and why
 *
 * - **No error callback.** A transport reports its own state through the protocol's `status` frame —
 *   `{ type: 'status', state: 'retrying', error }` — because `applyLiveFrame` already knows what to do
 *   with one and the rider-facing vocabulary (`connecting` · `live` · `retrying` · `closed`) is
 *   declared in the contract. A parallel error channel would be a second declaration of "what is this
 *   connection doing", and the two would disagree in the case that matters, which is a failure during
 *   a reconnect.
 * - **No `Promise` on `open`.** A connection becoming ready is an *event*, not the resolution of the
 *   call that asked for it: it can happen more than once (every reconnect), and it can fail after
 *   having succeeded. `open` is therefore fire-and-forget and readiness arrives as a `status` frame,
 *   which is also what makes a reconnect invisible to the caller.
 */
export interface LiveTransport<InboundFrame = unknown, OutboundFrame = InboundFrame> {
  /**
   * Start connecting, and deliver every inbound frame to `sink`.
   *
   * Called **once** per transport instance. A reconnect is the transport's own business and reuses the
   * same sink — the caller is not told, beyond the `status` frames it sees like any other.
   */
  open(sink: LiveTransportSink<InboundFrame>): void
  /**
   * Send one frame. Legal before the connection is ready: an implementation that cannot send yet must
   * queue, because the first thing any caller does is declare its targets and losing that frame leaves
   * a connected socket that never receives anything.
   */
  send(frame: OutboundFrame): void
  /**
   * Release everything: the connection, any timer, any pending reconnect. Idempotent, and after it
   * the sink is never called again — a frame delivered to a screen that has unmounted is the leak
   * this method exists to make impossible.
   */
  close(): void
}

/**
 * Where a transport delivers what it receives.
 *
 * One method, and it takes a **decoded** frame: text-vs-binary and JSON parsing are per-platform
 * details (`URLSessionWebSocketTask` hands over a `String` or a `Data`; OkHttp calls a different
 * listener method for each), so decoding belongs on the platform side of the port. What must not
 * differ per platform is what happens to the frame afterwards.
 *
 * An object rather than a bare callback so a member can be added — `onSent`, say, for a diagnostic —
 * without changing the shape every implementation was written against.
 */
export interface LiveTransportSink<InboundFrame = unknown> {
  /** One inbound frame, in arrival order. Never called after `close()`. */
  frame(frame: InboundFrame): void
}
