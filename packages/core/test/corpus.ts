// The TypeScript side of the fixture harness (WP1-5 of docs/proposals/03).
//
// The corpora in `../spec/*.spec.json` are the equivalence mechanism for the one kind of change
// ADR-052 says a schema cannot cover: **domain rules**, which are hand-ported to Swift and Kotlin
// rather than generated. So the rule is that the corpus is *data*, never TypeScript — no `undefined`,
// no functions, no comments, nothing an XCTest or JUnit suite could not read from the identical
// bytes. This file is deliberately thin for the same reason: everything it does (find a group, walk
// its cases, assert against `expect`) is what the native suites will do too, and if the TS side
// needed clever machinery to consume a corpus, the corpus would be wrong.
//
// Two conventions the loader encodes, both of which a port has to mirror:
//
//   · **JSON `null` means the language's absent value.** TS `undefined`, Swift `nil`, Kotlin `null`.
//     `nullToUndefined` does that translation at the single point where it belongs — the boundary —
//     rather than letting `null` leak into a function typed for `undefined`.
//   · **`nowIso` is a clock reading passed in as an argument.** Every rule under test is pure. No
//     test may read the real clock; a corpus row that depended on when it ran would be worthless to
//     a second platform, and flaky on the first.
//
// `scripts/check-spec-coverage.mjs` enforces the other half of the relationship (a tagged export has
// a non-empty corpus; a corpus has a tag), so this file can assume a well-formed file and fail loudly
// if that assumption breaks.

/** One row of a corpus group. `args` is named arguments; `expect` is the whole expected result. */
export interface SpecCase<Args, Expected> {
  id: string
  /** Prose for a porter: what this row catches, and why it is not decorative. */
  note?: string
  /**
   * True when the row records behaviour we agree is WRONG. It still asserts, so every platform stays
   * wrong in the same way rather than three different ways — and so the fix is a single coordinated
   * edit. The `note` says what `expect` becomes once it is fixed. `check-spec-coverage.mjs` requires
   * that note, and prints a count of these rows on every run so the number cannot creep unnoticed.
   */
  knownDefect?: boolean
  args: Args
  expect: Expected
}

interface RawGroup {
  doc: string
  cases: unknown[]
}

interface RawFile {
  module: string
  source: string
  doc: string
  groups: Record<string, RawGroup>
}

/**
 * The rows of one corpus group, typed for the caller. Throws rather than silently running zero
 * assertions: a `describe` block that loops over an empty array is a green test that proves nothing,
 * which is the exact failure mode this whole work package exists to prevent.
 */
export function specCases<Args, Expected>(
  file: unknown,
  group: string,
): Array<SpecCase<Args, Expected>> {
  const f = file as RawFile
  const g = f.groups[group]
  if (!g) throw new Error(`corpus ${f.module}.spec.json has no group "${group}"`)
  if (!Array.isArray(g.cases) || g.cases.length === 0)
    throw new Error(`corpus group ${f.module}#${group} has no cases`)
  return g.cases as Array<SpecCase<Args, Expected>>
}

/** The clock reading a case was written against. Never `Date.now()`. */
export function at(nowIso: string): number {
  return Date.parse(nowIso)
}

/** JSON `null` → the language's absent value, applied at the boundary. See the header. */
export function nullToUndefined<T>(values: Array<T | null>): Array<T | undefined> {
  return values.map((v) => (v === null ? undefined : v))
}

/**
 * A float assertion with the corpus's own tolerance. Trigonometry does not agree to the last bit
 * across languages, so the geo corpus states a tolerance per row and every platform compares this
 * way. A `tolerance` of 0 means the row really does demand exactness (e.g. a zero distance).
 */
export interface Approx {
  meters: number
  tolerance: number
}
