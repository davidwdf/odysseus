import { describe, expect, it } from 'vitest'
import corpus from '../spec/policy.spec.json'
import { CLIENT_POLICY_DEFAULTS, resolveClientPolicy } from '../src/policy'
import type { ClientPolicy, ResolvedClientPolicy } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/policy.spec.json. JSON `null` becomes the language's
// absent value at the boundary (see test/corpus.ts) — here that is "no policy document at all",
// which is the ordinary state of a cold start and of every offline launch.

describe('policy#resolveClientPolicy', () => {
  for (const c of specCases<{ served: ClientPolicy | null }, ResolvedClientPolicy>(
    corpus,
    'resolveClientPolicy',
  )) {
    it(c.name, () => {
      expect(resolveClientPolicy(c.args.served ?? undefined)).toEqual(c.expect)
    })
  }

  it('the corpus pins the shipped defaults, so they cannot drift from the constant', () => {
    // The corpus states the default values as literals in seven rows, which is what makes them
    // portable — a Swift suite reads the same numbers. That only holds while the literals agree with
    // the constant the Worker actually serves, and nothing above checks that: every row would still
    // pass if `CLIENT_POLICY_DEFAULTS` and the corpus were changed apart. This is the one assertion
    // that ties them together, and it is why editing a default is deliberately two edits.
    expect(resolveClientPolicy(undefined)).toEqual(CLIENT_POLICY_DEFAULTS)
  })
})

// The two branches the corpus cannot reach, asserted here with the reasoning rather than hidden by
// lowering the coverage threshold — the same treatment `formatBearing`'s unknown-locale and NaN
// branches get in test/geo.test.ts, and for the same underlying reason: **JSON cannot express these
// inputs**, and `core` performs no runtime validation (ADR-052 decision 2), so they are reachable in
// production even though no corpus row can state them.
describe('policy#resolveClientPolicy — inputs JSON cannot express', () => {
  it('rejects a non-finite number', () => {
    // `JSON.parse` never yields NaN or Infinity, so no corpus row can produce this. A division in a
    // config script can, and `Infinity` as a refresh cadence is a screen that never updates again.
    expect(resolveClientPolicy({ refreshAfterMs: Number.NaN }).refreshAfterMs).toBe(
      CLIENT_POLICY_DEFAULTS.refreshAfterMs,
    )
    expect(resolveClientPolicy({ maxRows: Number.POSITIVE_INFINITY }).maxRows).toBe(
      CLIENT_POLICY_DEFAULTS.maxRows,
    )
  })

  it('rejects a value that is not a number at all', () => {
    // The type says `number | undefined` and the wire says the same, but nothing validates on this
    // side of the network: a served `"30000"` arrives as a string and reaches this function typed as
    // a number it is not. Without the `typeof` guard it would flow into `slice()` and
    // `refetchInterval` as a string, where the failure is silent and platform-dependent.
    const hostile = { maxArrivals: '3' } as unknown as ClientPolicy
    expect(resolveClientPolicy(hostile).maxArrivals).toBe(CLIENT_POLICY_DEFAULTS.maxArrivals)
  })
})
