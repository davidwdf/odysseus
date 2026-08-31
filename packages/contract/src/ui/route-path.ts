import type { SlotNode } from '@nextbus/ui-spec'

/**
 * **What a screen draws for a route's geography**, and — the only part a projection can see — whether
 * it says so in words (ADR-152/154, `docs/proposals/06 §5`).
 *
 * ## Why this is a spec at all, when a map has no text
 *
 * Almost nothing here projects. `surveyed` shows nothing; `none` shows nothing; the whole declaration
 * exists for the one arm that *does*, and for the two that must not. That is the point rather than a
 * weakness of it: the decision this feature turns on is **that an approximated line is labelled and a
 * surveyed one is not**, and a spec is where a decision is made checkable.
 *
 * hkbus.app joins a route's ordered stops with straight lines whenever the surveyed geometry is
 * missing — unmarked, no styling difference, no message. For KMB `101R` that draws a bus crossing
 * Victoria Harbour through the water. Under rule 3 — *never fake precision* (ADR-008) — an unmarked
 * crow-flies line is the cartographic twin of a client-side per-second countdown. So the sketch is
 * dashed **and** captioned, and this node is what makes losing either half a red suite rather than a
 * regression nobody notices until a rider walks into the sea.
 *
 * The inverse matters as much and is easier to break: a renderer that captioned *every* line would
 * make the caption meaningless within a day. `surveyed: []` is a **positive** claim — this arm shows
 * nothing — and the walker checks the empty list as strictly as a full one.
 *
 * ## Why the model is on the driven view rather than in a view model
 *
 * The same reason as `FEED_NOTICE`, and it is worth stating twice because it is the format's main
 * escape hatch and therefore the one most easily abused. A route's geometry is not a field of
 * `routeDetailView`'s output and never can be: it is a **separate request** on a separate clock (a day
 * at the edge, against thirty seconds for arrivals — ADR-152), so a screen renders its stop list long
 * before it has a line, and binding the two would tie a day-cacheable body to a live one.
 *
 * What keeps that honest is that the value is a kernel call. `route-path#routePathView` decides the
 * arm over seven corpus rows; a driver that made one up would have to caption a line the screen does
 * not caption, and the comparison is exact.
 *
 * ## `when: 'path'` is “no answer yet”, which is not one of the three answers
 *
 * `routePathView(available: false, …)` means *asked, and told there is no surveyed line* — which for a
 * dense urban route is a legitimate `approximate`. A query that has not resolved is a different thing
 * entirely, and feeding it in would flash a dashed sketch on the way to every real line: the honest
 * fallback used as a loading state, which is exactly the trick the fallback exists to prevent. So a
 * pending answer is the **absence** of a model, `when` gates on it, and the arms stay the kernel's
 * three rather than growing a fourth that no corpus row could ever produce.
 */
export const ROUTE_PATH: SlotNode = {
  name: 'routePath',
  when: 'path',
  why: 'The geometry request has not answered yet. The strip holds its height and draws no line — see the note above on why “pending” is an absent model rather than a fourth arm.',
  oneOf: 'path.kind',
  invariant:
    'Said **once, under the map**, in the muted text token — the same shape as the freshness notice and for the same reason (ADR-133): the fact is about the whole line, so a per-segment cue would draw one fact several hundred times. Never a warning colour: an approximated line is a fact about the dataset, not a failure, and it is still the most useful thing we can draw.',
  cases: {
    /**
     * The road, from the Transport Department's own survey. Silent on purpose: this is the ordinary
     * case for ~93% of route-directions, and a caption on it would train a rider to ignore captions.
     */
    surveyed: [],
    approximate: [
      {
        name: 'routePathApproximate',
        text: { message: 'routePathApproximate' },
        invariant:
          'Says what the line **is** — "Approximate path — stops shown in order" — rather than what is missing. "No route data" would be a fact about us; a rider cannot act on it, and it is not even true, because the stops are real and in the right order. The dashes carry the same meaning to anyone who reads dashes; this is the half that survives a screen reader, and neither is sufficient alone (never colour or texture alone — ADR-008).',
      },
    ],
    /**
     * Stops too far apart for a chord between them to mean anything — a cross-harbour express with
     * four stops over 7.6 km. Nothing is drawn and nothing is said: there is no line to caption, and
     * a sentence explaining an absent map would be an apology for a screen that is otherwise complete.
     */
    none: [],
  },
}
