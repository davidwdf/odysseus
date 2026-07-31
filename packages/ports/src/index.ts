/**
 * # `@nextbus/ports` — the iOS/Android porting checklist
 *
 * `ls packages/ports/src` **is** the list of things a native client has to supply. Everything
 * else — arrival rules, ordering, id grammar, wire shapes, tokens, strings — is already written
 * once and shared. If a platform capability is not named here, we are not abstracting it, and
 * that is the decision, not an omission.
 *
 * | Port | Web / PWA | iOS | Android |
 * |---|---|---|---|
 * | {@link KeyValueStore} | `localStorage` / IndexedDB | `UserDefaults` | Jetpack `DataStore` |
 * | {@link LocationProvider} | `navigator.geolocation` | `CoreLocation` | `FusedLocation` |
 * | {@link LocaleProvider} | `navigator.languages` | `Locale.preferredLanguages` | `LocaleList` |
 * | {@link LinkOpener} | `window.open` | `UIApplication.open` | `Intent` |
 * | {@link Clock} | `Date.now()` | `Date()` | `System.currentTimeMillis()` |
 * | {@link TileSource} | `MiniMap` raster compositor | `MKTileOverlay` / MapLibre | `TileProvider` / MapLibre |
 * | {@link LiveTransport} | `WebSocket` | `URLSessionWebSocketTask` | OkHttp `WebSocket` |
 *
 * Each file's doc comment is the actual specification — read it before implementing, because in
 * several cases the *constraint* is the interesting part and the signature is trivial: don't
 * prompt for location on launch, snap every fix before it leaves the device, pass `noopener` on
 * web, never let `core` read the clock, always render the basemap attribution, and keep the
 * reconnect policy *out* of the socket.
 *
 * ## Three rules that keep this package honest
 *
 * 1. **It imports nothing.** Not `@nextbus/core`, not React, not React Native, not Node. A port
 *    that needs a domain type takes it as a type parameter instead (see {@link TileSource}), so
 *    no concept ends up defined twice.
 * 2. **It is type-only.** No `const`, no `enum`, no default implementation, no helper. Enforced
 *    at the compiler level, not by review: `scripts/check-type-only-contract.mjs` compiles the
 *    package to a temporary directory and fails if any emitted `.js` file contains anything
 *    beyond an empty module. It runs as this package's `test` script, so `pnpm test` covers it.
 * 3. **`types: []` in `tsconfig.json`**, so ambient `@types/node`, DOM and React Native globals
 *    are not even in scope — an accidental platform reference fails to compile here rather than
 *    surfacing as a surprise in a Swift port.
 *
 * ## Deliberately absent
 *
 * Push notifications, haptics, Widgets/Live Activities, background refresh, navigation, motion,
 * gestures and the whole view layer. Those stay fully native — abstracting them buys a lowest
 * common denominator that would make each platform's app worse.
 *
 * ## Status (WP1-3)
 *
 * These are declarations only. **No application code is wired to them yet** — that is Wave 2/3
 * work, and the existing implementations named in each file are the reference, not yet the
 * consumers. Two known gaps, recorded here so they are found deliberately rather than by
 * accident:
 *
 * - `apps/mobile/lib/tileSource.ts` still declares its own copy of {@link TileSource}. That copy
 *   is scheduled for deletion, not a second definition — see the note in `tile-source.ts`.
 * - `openExternal`/`openInMaps` satisfy {@link LinkOpener} shape-for-shape, but the app has no
 *   `LinkOpener` *value*: the platform switch lives inside the functions. Introducing the value
 *   is what removes the `Platform.OS` branches.
 */
export type { Clock } from './clock'
export type { KeyValueStore } from './key-value-store'
export type { LinkOpener, MapTarget } from './link-opener'
export type { LiveTransport, LiveTransportSink } from './live-transport'
export type { LocaleProvider } from './locale-provider'
export type {
  GeoFix,
  LocationPermission,
  LocationProvider,
  LocationState,
} from './location-provider'
export type { TileAttribution, TileSource } from './tile-source'
