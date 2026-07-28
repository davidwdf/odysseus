/**
 * # Clock — the only source of "now"
 *
 * **What a native developer must supply:** one function returning the current wall-clock
 * time as epoch milliseconds. That is the whole port. It exists so that no shared rule ever
 * reads the clock itself.
 *
 * | Platform | Implementation |
 * |---|---|
 * | Web / React Native | `() => Date.now()` |
 * | iOS | `Date().timeIntervalSince1970 * 1000` (rounded) |
 * | Android | `System.currentTimeMillis()` |
 *
 * ## Why a port at all, when every platform has a one-liner
 *
 * Because the point is not the implementation — it is the **ban**. `packages/core` is the ring
 * that gets hand-ported to Swift and Kotlin, and its fixtures have to be byte-reproducible in
 * all three languages. A single `Date.now()` inside a domain rule makes that impossible: the
 * function is no longer a function of its inputs. So the convention, already followed by every
 * helper in `packages/core/src/eta.ts` (`etaView(arrivalIso, now)`, `isStale(eta, now)`,
 * `formatRelative(arrivalIso, now, locale)`), is:
 *
 * > **`core` takes `now: number` as an explicit parameter. Only the view layer holds a `Clock`.**
 *
 * This interface is therefore *consistent with* that convention rather than a competing
 * mechanism: a screen calls `clock.now()` **once**, then passes the resulting number down. Do
 * not pass a `Clock` into `core` — if a signature there ever needs one, the rule is wrong, not
 * the port.
 *
 * ## Wall clock, not monotonic
 *
 * Upstream ETAs are absolute ISO-8601 timestamps with a fixed `+08:00` offset, so the only
 * useful comparison is against wall-clock time; a monotonic uptime counter cannot be compared
 * to them. The cost is that a device with a skewed clock shows skewed arrivals — accepted
 * (every transit app has this), and visible in practice as ETAs that look uniformly early or
 * late rather than as an error.
 *
 * ## What this port deliberately does **not** have
 *
 * - **No timers.** No `setInterval`, no `schedule()`. Refresh cadence is the data layer's job
 *   (`watch()` in `@nextbus/api-client`), and per-second countdown ticking is banned outright
 *   (ADR-008): an ETA value changes only when fresh data arrives.
 * - **No time zone or formatting.** Hong Kong is a single fixed offset; the `+08:00` profile
 *   belongs to the wire contract and the formatters, not to the clock.
 */
export interface Clock {
  /**
   * Current time in **epoch milliseconds, UTC**. Must be plain wall-clock time — the same
   * value shape the `now` parameters throughout `@nextbus/core` expect.
   */
  now(): number
}
