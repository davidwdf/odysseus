import type { SlotNode } from '@nextbus/ui-spec'

/**
 * **The one line a screen says when it has stopped being fed** — declared once here and referenced by all
 * four screens that draw readings (ADR-133, wired everywhere by ADR-150).
 *
 * ## Why it is a `oneOf` and not three `when`-gated lines
 *
 * The states are exclusive by construction: `feedNotice` applies a precedence — `offline` → `unreachable` →
 * `lastUpdated` → `none` — because each earlier state *explains* the later ones, and a rider with no network
 * does not also need telling their data is old. Three optional slots could each be true at once, which would
 * make the format say something the kernel forbids. A discriminated branch says exactly what the rule says,
 * and `oneOf` is **total**: a fifth kind added to the kernel with no case here is a hard failure in every
 * suite rather than a line that quietly stops being projected.
 *
 * ## Why the notice is on the driven view rather than in a view model
 *
 * A screen's freshness is not a field of `nearbyView`'s or `placeDetailView`'s output, and it never can be:
 * it joins the newest board on screen to two facts the kernel is handed rather than told — whether the
 * platform has a network, and how the last attempt to reach *us* failed. So each driver puts the notice its
 * own renderer computed onto the view it hands the walker, exactly as it already does with the error message
 * in a `failed` state. What keeps that honest is that the value is a kernel call (`eta#feedNotice`, nine
 * corpus rows) over a kernel-selected timestamp (`eta#newestNearbyBoard` / `eta#newestPlaceBoard`) — a driver
 * that made one up would have to write a different sentence than the screen shows, and the comparison is
 * exact.
 *
 * ## What it deliberately does not carry
 *
 * An **upstream board refusing** has its own vocabulary — `StopRow`'s `etasUnavailable`, a route's
 * `liveArrivals`, a card's `incomplete` — and is never routed through here. A live round asks each pole
 * separately, so one kerb can refuse while forty answer, and no screen-level sentence can say that without
 * being wrong about most of the screen. A screen may therefore show two lines at once, which is correct:
 * they answer different questions.
 *
 * ⚠️ **`feedLastUpdated` prints a wall-clock with no date**, so a payload replayed from the persisted cache
 * after midnight says *"Last updated 23:58"* with no hint that it is a day old. Recorded rather than hidden,
 * and visible in this repo's own goldens: several `placeDetailView` corpus cases are a coherent payload
 * captured two days before their `now`, so the states driven from them project a time from another day. The
 * honest fix needs a date-aware, locale-aware format and is a `docs/07` row.
 */
export const FEED_NOTICE: SlotNode = {
  name: 'feedNotice',
  oneOf: 'notice.kind',
  invariant:
    'Once per screen, above the readings, in the muted text token and **never a warning colour** — nothing is wrong with the rider’s stop, and an alarm that fires when their train goes into a tunnel is one they learn to ignore before the day it matters (ADR-122). It is rendered inside the arm that has content to show: when the whole screen *is* a failure, the failure’s own message is the sentence, and a second line above it would be the same fact twice.',
  cases: {
    none: [],
    lastUpdated: [
      {
        name: 'feedLastUpdated',
        text: { message: 'feedLastUpdated', args: { time: 'notice.at' } },
        invariant:
          'An **absolute** time, from the corpus-pinned `formatClock`. ADR-008 prefers it to a fabricated relative one: *"2 minutes ago"* ages while nothing re-renders, which is the same dishonesty as a client-side countdown, and it is the reading’s own operator clock (`dataTimestamp`) rather than when we fetched it.',
      },
    ],
    offline: [
      {
        name: 'feedOffline',
        text: { message: 'feedOffline' },
        invariant:
          'Said only where the platform reports **no network**, which is evidence; a platform that reports a network merely has no evidence against one — `true` is `true` behind a captive portal, the ordinary MTR-station case — and the `unreachable` arm is what covers that.',
      },
    ],
    unreachable: [
      {
        name: 'feedUnreachable',
        text: { message: 'feedUnreachable' },
        invariant:
          'A failure that reached **us**: our own edge answered and said no, or the request never arrived. It is not an upstream board’s refusal, which the rows and cards say for themselves.',
      },
    ],
  },
}
