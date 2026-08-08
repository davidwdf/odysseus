/**
 * Which part of a readout actually changed — the string diff behind the arrival odometer.
 *
 * `"52 min"` → `"51 min"` differs in one character, so only the `2`→`1` should slide; the `5` and the
 * ` min` must stay put or the whole readout appears to lurch when a single digit ticks. `"1 min"` → `"Due"`
 * shares nothing, so the whole thing slides. That is the rule, and it is `apps/mobile`'s
 * (`components/EtaTimes.tsx`'s `SlideNumber`), reproduced rather than reinvented.
 *
 * ## Why this is `lib/` and not the component
 *
 * It is a pure string utility with no React in it, so it belongs beside the other pure helpers whether or
 * not anything else were true. Worth saying explicitly because `lib/` is *also* outside
 * `check-no-derivation`'s policed set, and this function does contain the shapes that gate looks for — a
 * `Math.min` and two numeric comparisons. Moving code to dodge a gate is the failure this repo keeps
 * writing ADRs about; the test is whether it would live here anyway, and a `(string, string) => segments`
 * function plainly would.
 *
 * The gate would be *wrong* here rather than merely inconvenient, which is the other half: its rules exist
 * because ordering, capping and thresholds are **domain** decisions that two renderers must not each
 * invent. Both strings arriving here were already decided by `etaReadout` in the kernel. What character
 * they first differ at is a fact about two strings, not an answer about what a rider is owed.
 */
export interface ValueChange {
  /** The leading characters both values share — drawn statically, never animated. */
  prefix: string
  /** The trailing characters both share — likewise. */
  suffix: string
  /** The part of the old value that slides out. */
  prevMid: string
  /** The part of the new value that slides in. */
  nextMid: string
}

export function splitChange(prev: string, next: string): ValueChange {
  let p = 0
  const min = Math.min(prev.length, next.length)
  while (p < min && prev[p] === next[p]) p += 1
  let s = 0
  while (
    s < prev.length - p &&
    s < next.length - p &&
    prev[prev.length - 1 - s] === next[next.length - 1 - s]
  ) {
    s += 1
  }
  return {
    prefix: next.slice(0, p),
    suffix: s > 0 ? next.slice(next.length - s) : '',
    prevMid: prev.slice(p, prev.length - s),
    nextMid: next.slice(p, next.length - s),
  }
}
