/**
 * # KeyValueStore — small, durable, string-keyed preferences
 *
 * **What a native developer must supply:** three async methods (`get`/`set`/`remove`) over a
 * string→string store that survives app restarts and OS upgrades, plus one flag saying whether
 * the platform can actually keep the data.
 *
 * | Platform | Implementation |
 * |---|---|
 * | Web / PWA | `localStorage`, or IndexedDB once a value outgrows it |
 * | React Native (today) | `@react-native-async-storage/async-storage` — this is what `lib/preferences.ts` persists through |
 * | iOS | `UserDefaults` (`suiteName` if a Widget must read the same keys) |
 * | Android | Jetpack `DataStore` (Preferences flavour), **not** `SharedPreferences` |
 *
 * ## Why async, when `localStorage` and `UserDefaults` are synchronous
 *
 * Because `AsyncStorage` and `DataStore` are not, and an interface has to be satisfiable by its
 * slowest implementor. Sync platforms just return an already-resolved promise. This has a
 * consequence the view layer must handle rather than hide: **the first paint happens before the
 * store has been read.** `lib/preferences.ts` models the right answer — a `hydrated` flag flipped
 * on `onFinishHydration`, so the app can hold the first frame instead of flashing the default
 * theme and then snapping to the rider's choice.
 *
 * ## What goes in here — and what must not
 *
 * This is for **preferences and tiny resumable state**, on the order of a few kilobytes: the
 * appearance mode, the manual locale override, favourited route-at-stop keys, recent searches,
 * the last known (already grid-snapped) fix. Real keys in use today, which double as the
 * naming convention — `nextbus.` prefix, dotted area, explicit `.vN` when the shape may change:
 *
 * - `nextbus.preferences` — the whole Zustand-persisted preferences blob
 * - `nextbus.lastFix.v1` — the remembered snapped fix that makes a cold offline launch render
 *
 * It is **not** a cache. Bus data, tiles and ETA responses belong to the HTTP cache, the service
 * worker and the persisted query cache (ADR-058) — none of which this port should grow into.
 * It is also **not** secure storage: no tokens, nothing a rider would mind another app reading.
 *
 * ## Values are opaque strings
 *
 * The store never parses. Callers serialize to JSON (UTF-8) themselves, and — because a stored
 * blob is a **persistence contract with the rider's own device** — must tolerate reading back a
 * value written by an older version of the app. That is why keys carry a version suffix and why
 * WP2-5 needs a real migration: silently dropping an unreadable blob loses somebody's
 * favourites.
 */
export interface KeyValueStore {
  /** The stored value, or `null` when the key has never been written (not an error). */
  get(key: string): Promise<string | null>
  /**
   * Write a value, overwriting any previous one. Rejects only on a genuine platform failure
   * (quota exceeded, disk full, a partitioned or private-mode `localStorage` that accepts
   * nothing) — callers treat a rejection as "the preference did not stick this time", never as
   * a reason to drop the in-memory value or interrupt the rider.
   */
  set(key: string, value: string): Promise<void>
  /** Delete a key. Removing an absent key succeeds — this is idempotent by design. */
  remove(key: string): Promise<void>
}
