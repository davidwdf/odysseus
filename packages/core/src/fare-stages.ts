/**
 * **Where a route's fare changes** — the runs of consecutive stops that cost the same to board at.
 *
 * A Hong Kong route is priced in *stages*: every stop between two fare points charges the same, and
 * the figure steps down (or up) at the boundary. `routeDetailView` already gives each row its own
 * fare; what nobody has is where one stage ends and the next begins, which is the only thing a screen
 * needs in order to say the price **once per stage** rather than forty times.
 *
 * ## Why this is a kernel rule and not a `!==` in a list
 *
 * It is a comparison between adjacent rows — exactly the shape `check-no-derivation` catches, and
 * rightly: "the fare changed here" is a claim about the route, and two renderers deciding it
 * separately is how they come to disagree about which stop is a fare point. It is also not as obvious
 * as it looks, because **a missing fare is not a fare change** — the last stop of most routes carries
 * no boarding fare at all, and treating that as a new stage would print a stage header over the end of
 * every route.
 */

/**
 * `true` at each index that **begins** a fare stage.
 *
 * The first stop with a fare always begins one. After that, a stop begins a stage when its fare
 * differs from the last fare actually seen — not from its immediate predecessor, which is the
 * distinction that matters when a stop in the middle has no fare at all: a gap does not end a stage,
 * and the run continues through it.
 *
 * Stops with no fare are never stage starts. There is nothing to print for them, and a header with no
 * figure in it is a divider pretending to be information.
 *
 * @spec fare-stages#fareStageStarts
 */
export function fareStageStarts(fares: readonly (string | undefined | null)[]): boolean[] {
  let seen: string | undefined
  return fares.map((fare) => {
    if (fare === undefined || fare === null || fare === '') return false
    if (fare === seen) return false
    seen = fare
    return true
  })
}
