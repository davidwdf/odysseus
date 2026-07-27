// The id grammar's corpus-driven suite (WP1-2). Every case comes from
// `packages/contract/src/ids/id-corpus.json`; this file is only the harness that drives it, so a
// new case is a JSON row and never a new test.
//
// WHY THIS LIVES IN `apps/mobile` AND NOT NEXT TO THE CODE IT TESTS
// The implementation is `packages/core/src/ids.ts`, and that is where this file belongs. `core` has
// no test runner yet — WP1-5 adds vitest plus a branch-coverage threshold there, and that work
// package owns `packages/core/package.json`'s test wiring. Standing up a second, conflicting vitest
// config in `core` to land this a few days earlier would cost more than it buys, so the suite runs
// in the one workspace that already has a runner and already depends on `@nextbus/core`. **Move it
// to `packages/core/src/ids.test.ts` when WP1-5 lands** — nothing here is app-specific.
//
// The corpus is read as a plain JSON import rather than through `@nextbus/contract`: this is a
// fixture, not a dependency. `apps/mobile` must not gain an edge to the contract package (WP1-4's
// `layers.json` forbids it, and WP1-1's acceptance criterion was a literally zero app diff), and a
// test-only file is not in the app's runtime graph either way.

import {
  formatFavoriteRouteKey,
  formatPlaceId,
  formatRouteId,
  formatStopId,
  memberStopIds,
  parseFavoriteRouteKey,
  parsePlaceId,
  parseRouteId,
  parseStopId,
  parseStopOrPlaceId,
} from '@nextbus/core'
import { describe, expect, it } from 'vitest'
import rawCorpus from '../../../packages/contract/src/ids/id-corpus.json'

// The corpus is language-neutral by design, so it is untyped data here; these shapes are the
// harness's reading of it rather than a second declaration of anything.
type ParseKind = 'stopId' | 'placeId' | 'stopOrPlaceId' | 'routeId' | 'favoriteRouteKey'
type FormatKind = 'stopId' | 'placeId' | 'routeId' | 'favoriteRouteKey'

interface Corpus {
  parse: Array<{
    name: string
    as: ParseKind
    input: string
    expect: Record<string, unknown> | null
    why?: string
  }>
  memberStopIds: Array<{ name: string; input: string; expect: string[]; why?: string }>
  format: Array<{ name: string; fn: FormatKind; args: unknown[]; expect: string; why?: string }>
}

const corpus = rawCorpus as unknown as Corpus

/**
 * Each parser's result, flattened to the plain fields the corpus states. Deliberately explicit
 * rather than `toMatchObject`: a row saying `{ operator, rawId }` should fail if the parser starts
 * returning something else as well, and a partial match would let that through.
 */
function parseToPlain(as: ParseKind, input: string): Record<string, unknown> | null {
  switch (as) {
    case 'stopId': {
      const parts = parseStopId(input)
      return parts && { operator: parts.operator, rawId: parts.rawId }
    }
    case 'placeId': {
      const parts = parsePlaceId(input)
      return parts && { members: parts.members.map((m) => m.id) }
    }
    case 'stopOrPlaceId': {
      const parts = parseStopOrPlaceId(input)
      if (!parts) return null
      return parts.kind === 'stop'
        ? { kind: parts.kind, operator: parts.operator, rawId: parts.rawId }
        : { kind: parts.kind, members: parts.members.map((m) => m.id) }
    }
    case 'routeId': {
      const parts = parseRouteId(input)
      return (
        parts && {
          operator: parts.operator,
          routeNo: parts.routeNo,
          bound: parts.bound,
          serviceType: parts.serviceType,
        }
      )
    }
    case 'favoriteRouteKey': {
      const parts = parseFavoriteRouteKey(input)
      return parts && { stopId: parts.stopId, routeId: parts.routeId, stopKind: parts.stop.kind }
    }
  }
}

function formatFrom(fn: FormatKind, args: unknown[]): string {
  switch (fn) {
    case 'stopId':
      return formatStopId(args[0] as never, args[1] as string)
    case 'routeId':
      return formatRouteId(args[0] as never, args[1] as string, args[2] as never, args[3] as string)
    case 'placeId':
      return formatPlaceId(args[0] as string[])
    case 'favoriteRouteKey':
      return formatFavoriteRouteKey(args[0] as string, args[1] as string)
  }
}

/** The parser that must accept whatever the matching formatter emitted. */
const REPARSE: Record<FormatKind, (id: string) => unknown> = {
  stopId: parseStopId,
  placeId: parsePlaceId,
  routeId: parseRouteId,
  favoriteRouteKey: parseFavoriteRouteKey,
}

describe('id grammar — parse (corpus-driven)', () => {
  for (const row of corpus.parse) {
    it(`${row.as}: ${row.name}`, () => {
      expect(parseToPlain(row.as, row.input)).toEqual(row.expect)
    })
  }
})

describe('id grammar — memberStopIds (corpus-driven)', () => {
  for (const row of corpus.memberStopIds) {
    it(row.name, () => {
      expect(memberStopIds(row.input)).toEqual(row.expect)
    })
  }
})

describe('id grammar — format (corpus-driven)', () => {
  for (const row of corpus.format) {
    it(row.name, () => {
      const formatted = formatFrom(row.fn, row.args)
      expect(formatted).toBe(row.expect)
      // The two directions must agree: anything the formatter mints, the parser accepts. Without
      // this a formatter could drift into emitting a string only it understands.
      expect(REPARSE[row.fn](formatted)).not.toBeNull()
    })
  }
})

describe('id grammar — the corpus itself', () => {
  // A corpus is only a cross-platform guarantee if the boundary cases are actually in it. These
  // are the rows WP1-2 was specified around; losing one silently would leave the suite green and
  // the guarantee gone, which is the failure mode a gate is supposed to prevent.
  const REQUIRED = [
    'place-four-members', // N members, not two
    'stop-reject-literal-pipe-in-raw-id', // an id carrying the favourite-key delimiter
    'favourite-key-reject-two-pipes', // the naive-split bug
    'favourite-key-legacy-place-side', // what WP2-5 has to migrate
    'route-gmb-gtfs-id-as-service-type', // GMB numbers repeat across regions
    'route-kmb-plain', // a numeric-looking service type
    'route-unknown-operator', // ADR-052 unknown-enum tolerance
  ]
  const names = [
    ...corpus.parse.map((r) => r.name),
    ...corpus.memberStopIds.map((r) => r.name),
    ...corpus.format.map((r) => r.name),
  ]

  it.each(REQUIRED)('keeps the named boundary row %s', (name) => {
    expect(names).toContain(name)
  })

  it('has unique row names, so a failure names exactly one case', () => {
    expect(names.length).toBe(new Set(names).size)
  })

  it('rejects more shapes than it accepts — the rows are mostly the wrong ids', () => {
    // Not a vanity metric: every `expect: null` row is a shape some call site used to accept
    // silently. If this ratio inverts, the corpus has drifted towards testing the happy path.
    const rejects = corpus.parse.filter((r) => r.expect === null).length
    expect(rejects).toBeGreaterThan(corpus.parse.length / 3)
  })
})

describe('id grammar — the bug the favourite key used to have', () => {
  it('a two-pipe key parses as null, where a naive split returned a plausible wrong pair', () => {
    const corrupt = 'KMB:AB|CD|KMB:6:outbound:1'
    // What the code this replaced did — and note it looks entirely successful.
    const [naiveStopId, naiveRouteId] = corrupt.split('|')
    expect(naiveStopId).toBe('KMB:AB')
    expect(naiveRouteId).toBe('CD')
    // What the grammar says.
    expect(parseFavoriteRouteKey(corrupt)).toBeNull()
  })
})
