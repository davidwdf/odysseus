// The live-ETA engine room: three transports and one controller, all behind `@nextbus/ports`'
// `LiveTransport`.
//
//   ./engine.ts      the frames, the `'poll' | 'socket'` label, and the two timers a transport may hold
//   ./poll.ts        the poll emulator — HTTP polling wearing the socket protocol. **The default.**
//   ./memory.ts      the scripted fake — WP5-1's other half and WP5-2's `FakeSocketDataSource` engine
//   ./socket.ts      the real one: keepalive, reconnect, backoff
//   ./controller.ts  the subscription lifecycle, in `createLocationController`'s shape
//
// A directory rather than one `live.ts` because these are four independent things a reader will want to
// read one at a time, and the house comment style means one file would run past 700 lines with the
// controller — the part a screen author actually needs — at the bottom.

export {
  createLiveEtaController,
  type LiveEtaController,
  type LiveEtaControllerDeps,
  type LiveEtaUpdate,
} from './controller'
export {
  frameAt,
  type LiveEngine,
  type LiveEtaEngine,
  type LiveEtaTransport,
  systemTimers,
  type Timers,
} from './engine'
export {
  createMemoryTransport,
  type MemoryTransport,
  type MemoryTransportOptions,
} from './memory'
export { createPollTransport, type PollTransportDeps } from './poll'
export {
  browserSocketFactory,
  createSocketTransport,
  DEFAULT_KEEPALIVE_MS,
  DEFAULT_SOCKET_BACKOFF,
  type LiveSocketConnection,
  type LiveSocketFactory,
  type LiveSocketHandlers,
  type SocketBackoff,
  type SocketTransportDeps,
} from './socket'
