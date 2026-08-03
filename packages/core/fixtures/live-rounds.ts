// The cross-runtime scenario corpus for the live protocol: what a subscriber holds after each round,
// whichever engine is feeding it (WP5-5, ADR-074).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS, AND WHY IT IS NOT `packages/api-client/test/live-matrix.test.ts`
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Three rules are implemented **twice** — once in `packages/api-client/src/live/poll.ts` and once in
// `apps/edge/src/eta-hub.ts`:
//
//   1. a failed round is not a departure          (ADR-056 decision 5, extended per-pole by ADR-073)
//   2. an unchanged round is silent               (ADR-056 decision 5)
//   3. a mid-stream drop is re-echoed as a snapshot, because only a snapshot carries `targets`
//                                                 (ADR-056 decision 17)
//
// Every defect Wave 5 found in its own code survived because **no test spanned two implementations of
// one rule** — three for three, recorded in ADR-056's own "what is not done". The scenario matrix drove
// the poll emulator against a *hand-written script*, so a rule the emulator got wrong was a rule the
// script had been written to describe. This file is the other half: one declaration of what a round
// does, read by a driver in each package.
//
// It cannot be a shared *module*, and that is a layer fact rather than an inconvenience. `layers.json`
// gives `server` the dirs `["apps/edge"]` — tests included — and `use: [contract, kernel, ports,
// adapters]`, so an edge test may not import `@nextbus/api-client` at all. What both sides may import
// is `@nextbus/core`. So the rows are data, like every other corpus in this repo (ADR-060), and each
// runtime brings its own driver.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT IS ASSERTED, AND WHY IT IS NOT THE FRAME TRANSCRIPT
// ────────────────────────────────────────────────────────────────────────────────────────────────
// `live-matrix.test.ts` asserts the **per-repaint transcript** — every update, in order — against a
// hand-written server script, and that assertion is kept: it is what pins frame ordering (the data
// frame before the status frames) and the reducer's behaviour on a gap or a reconnect.
//
// The shard cannot be compared on a transcript, for a structural reason rather than a defect: it is a
// *stateful server*, so it answers a `subscribe` immediately from what it has stored — an empty
// snapshot plus `live` on a cold shard — and only then polls. The poll emulator has nothing to answer
// with until its first fetch returns. Two correct engines, two different transcripts, and no
// implementation of either could make them equal. (`seq` differs too: monotonic across a
// re-subscription on the server, reset on the client — ADR-056 records both.)
//
// So this corpus asserts what a rider actually has: **after each round settles, what does the listener
// hold, and did the round say anything at all.** That is engine-independent, and it is precisely where
// the three rules live — a retained reading, a silent round, a shrunken accepted set. It also carries
// the accepted target set, which `summarize()` in the matrix deliberately does not: adding it there
// would have asserted the *stale* echo, because the scripts describe one engine (ADR-056 decision 17).
// With two real engines and one hand-written expectation, that trap is gone.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────
// THE VOCABULARY IS LOGICAL, AND EVERY DRIVER SUBSTITUTES ITS OWN IDS
// ────────────────────────────────────────────────────────────────────────────────────────────────
// A row names places, poles, routes and arrival times abstractly, because the two runtimes cannot
// share concrete ones: the edge driver has to use ids that exist in its seeded dataset, and the client
// driver has none. See `LIVE_ROUNDS_TOPOLOGY` for the fixed three-place shape every row uses.
//
// Arrival times are `"+N"`, minutes from the driver's own notional now, and the summarizer converts
// back — so a row is readable and neither driver has to agree with the other about a wall clock.

import rows from './live-rounds.json'

/** What one boarding point's upstream board did this round. */
export type BoardAnswer =
  /** The board answered with these lines. An empty array is a real answer: no buses due. */
  | Array<{ route: string; at: string[] }>
  /**
   * The board **refused** — a non-2xx, a dropped connection, a body that did not parse. The edge
   * classifies it `upstream_unavailable` (`retryable: true`) and names the pole in `EtaReport.failed`;
   * before ADR-073 it resolved to an empty list and was indistinguishable from the case above.
   */
  | 'refused'

/** One polling round: what every pole in the row's target set answered. */
export interface LiveRound {
  /** Logical pole label → its board's answer. Every pole of every target must be present. */
  boards: Record<string, BoardAnswer>
}

export interface LiveRoundsScenario {
  name: string
  /** Prose for a porter and for a reviewer: what this row catches, and why it is not decorative. */
  why: string
  /** Logical place labels this subscription watches, in the order the client asks for them. */
  targets: string[]
  rounds: LiveRound[]
  /**
   * One line per round, in order — what the listener holds once that round has settled.
   *
   * `"silent"` means the round produced **no update at all**, which is rule 2 and is the only line
   * that is not a state. Otherwise:
   *
   *     <state>[!<errorCode>] etas=[<pole>/<route>@<+m>,<+m> …] watching=[<place> …] failed=[<pole> …]
   *
   * Readings are in the kernel's canonical `(stopId, routeId)` order (D1), so the line is a total
   * function of the data and not of the order frames happened to arrive in.
   *
   * **`failed` is WP5-14's column** (ADR-081) and it is why the grammar moved. Until the frames carried
   * the failure set, a line could show a *retained* reading but not why it was retained — so a row could
   * not distinguish "this kerb is refusing and we are keeping its last bus" from "this kerb is quiet",
   * which is the very distinction rule 1 is about. It is the complete current set, in canonical `stopId`
   * order, and it names **poles** rather than places: a whole target that could not be answered is a
   * `status` frame, so it shows up in `<state>` instead.
   *
   * It also gives the corpus a fourth rule to bind: **a round whose failure set moved is news even when
   * no reading did.** Look for the rows where a line is *not* `silent` despite identical readings — a
   * kerb that started or stopped refusing — and for the recovery, where `failed=[]` has to arrive within
   * one round of the board answering again.
   */
  settles: string[]
}

/**
 * The fixed topology every row is written against — three places, four poles.
 *
 * Fixed rather than declared per row so a driver's id mapping is one table instead of a parser, and
 * so the two-kerb case is always available: since ADR-072 an arrival is a line at a *kerb*, so a place
 * with two boarding points is where the per-pole rules actually bite and where a one-pole fixture
 * would quietly prove nothing.
 */
export const LIVE_ROUNDS_TOPOLOGY = {
  /** Logical place label → its boarding poles, in canonical id order. */
  places: {
    A: ['A'],
    B: ['B'],
    C: ['C1', 'C2'],
  },
} as const

export const LIVE_ROUNDS = rows as unknown as LiveRoundsScenario[]
