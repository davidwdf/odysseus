import type { ClientPolicy, ResolvedClientPolicy } from './types'

// The values behind ADR-053's `ClientPolicy`, and the one function that resolves a served document
// against them.
//
// **Why the numbers live here and not in `packages/contract`.** The contract declares the *shape*;
// this declares the *values*. They cannot be the same file, because `core` imports the contract with
// `import type` only (ADR-052 decision 2) and so cannot read a runtime constant from it. That
// constraint turns out to be the right shape anyway: `apps/edge` is the `server` layer and may import
// the kernel, so the Worker **serves these very bytes**. There is one declaration of "three
// arrivals", not a client copy and a server copy that a reviewer has to diff.
//
// **Why serving a constant is not a no-op.** The value a client compiles in is only reachable by a
// store release; the value the Worker serves is reachable by a deploy. Changing a number here and
// deploying the edge moves it for every already-installed client on its next policy fetch. The
// defaults exist for exactly two moments — before the first fetch of a cold install, and offline
// (ADR-058 ships offline, so a client that cannot answer these questions on its own is broken in a
// tunnel). They are not a second source of truth; they are the same source, read locally.
//
// The corollary, stated plainly because it is the honest cost: an old client binary and a freshly
// deployed edge *can* disagree, in the window before the client's first policy fetch. That window is
// the price of working offline, and it is bounded and one-directional — the served value always wins
// once it arrives.

/**
 * The shipped defaults: what every client uses before its first policy fetch, and offline.
 *
 * Each number is a judgement about what a rider is told, so each carries the reasoning that would
 * otherwise be lost the first time somebody "tidied" it into a config file.
 */
export const CLIENT_POLICY_DEFAULTS: ResolvedClientPolicy = {
  // Under a minute we do not fake a number (ADR-008). Also the *symmetric* tolerance band: a reading
  // one minute in the past is still shown, because the feed's clock and ours disagree by seconds and
  // blanking a stop the rider is standing at is the worse error.
  dueUnderSec: 60,
  // Three minutes is roughly the point at which "there is a bus coming" becomes "run". Nothing reads
  // this yet — see the note at the bottom of this file.
  warnUnderSec: 180,
  // Upstream refreshes roughly once a minute (docs/01), so 90 s is the first moment a reading is
  // certainly not merely between refreshes.
  staleAfterMs: 90_000,
  // The edge coalesces live ETA calls for 30 s and serves that same `max-age` (ADR-057). Polling
  // faster cannot produce a newer reading — it returns the byte-identical cached response — so this
  // is the cadence, and `apps/edge/src/eta-cache.ts` derives its TTL from it rather than restating
  // the number. The client used to poll at 20 s against that 30 s window, which spent a request and a
  // re-render in three to learn nothing.
  refreshAfterMs: 30_000,
  // A stop row is a *glance* — the rider is deciding whether to stay on this screen, not reading a
  // timetable. The fourth reading is where the column starts to wrap and where the feed's confidence
  // has run out anyway.
  maxArrivals: 3,
  // A merged place can serve many routes; the compact card shows the soonest few and a tappable
  // "+N more" that opens the Place page for the full, grouped list (ADR-042).
  maxRows: 6,
}

/**
 * Is this a number a policy could plausibly mean?
 *
 * Every field is a count or a duration, so zero and negative are not "aggressive settings" — they are
 * a misconfiguration, and each one blanks something: `maxRows: 0` empties every stop card,
 * `refreshAfterMs: 0` is a request loop. A served policy is the one input to the client that is
 * neither user data nor code review, so it gets the one check that distinguishes a value from a
 * mistake, and a mistake falls back to a number we know works.
 *
 * Deliberately *not* clamped to a range: a clamp invents a policy nobody wrote, and the failure it
 * hides ("why is the cadence 5 s when I deployed 500 ms?") is harder to see than the one it prevents.
 */
function usable(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

/**
 * A served policy document filled out to a complete one.
 *
 * Field-by-field rather than `{...defaults, ...served}`: a spread would let an explicit `undefined`
 * or a garbage number through, and the whole point of resolving is that the caller receives six
 * usable numbers whatever arrived on the wire — including nothing at all, which is the ordinary
 * state of a cold start.
 *
 * @spec policy#resolveClientPolicy
 */
export function resolveClientPolicy(served: ClientPolicy | undefined): ResolvedClientPolicy {
  return {
    dueUnderSec: usable(served?.dueUnderSec, CLIENT_POLICY_DEFAULTS.dueUnderSec),
    warnUnderSec: usable(served?.warnUnderSec, CLIENT_POLICY_DEFAULTS.warnUnderSec),
    staleAfterMs: usable(served?.staleAfterMs, CLIENT_POLICY_DEFAULTS.staleAfterMs),
    refreshAfterMs: usable(served?.refreshAfterMs, CLIENT_POLICY_DEFAULTS.refreshAfterMs),
    maxArrivals: usable(served?.maxArrivals, CLIENT_POLICY_DEFAULTS.maxArrivals),
    maxRows: usable(served?.maxRows, CLIENT_POLICY_DEFAULTS.maxRows),
  }
}

// `warnUnderSec` has **no consumer today**, and is served anyway. That is a deliberate exception to
// this repo's preference for deleting a line over adding one, and the reason is the audience: the
// document this schema emits is what a native repo generates its models from, and a policy that
// omits the imminence threshold invites each platform to pick its own — which is precisely the
// three-way disagreement ADR-053 exists to end, rebuilt one platform at a time. It is recorded here,
// in the WP3-4 report and in ADR-053 as a forward declaration rather than left to be discovered.
