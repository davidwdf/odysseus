import { describe, expect, it } from 'vitest'
import corpus from '../spec/stop-card.spec.json'
import { CLIENT_POLICY_DEFAULTS } from '../src/policy'
import {
  displayName,
  nearbyView,
  type StopCardOptions,
  stopCardCaption,
  stopCardView,
} from '../src/stop-card'
import type { Eta, EtaFailure, Locale, NearbyStop } from '../src/types'
import { at, specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/stop-card.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/**
 * The corpus states an absent optional as JSON `null` on **both** sides — `args` and `expect` — per
 * the convention in `./corpus.ts`. TypeScript's absent value is `undefined`, so the boundary has to
 * translate in both directions, and doing it here rather than in the module under test is the point:
 * a Swift port compares structs whose optionals are `nil`, and a corpus that *omitted* absent keys
 * instead would leave it guessing whether the field is missing or genuinely null.
 *
 * `nulled` is therefore a **named projection**, not a convenience: it is the one transformation
 * applied to real output before comparison, and naming it is what stops a behaviour change hiding
 * inside a formatting difference.
 */
const nulled = (value: unknown): unknown =>
  value === undefined
    ? null
    : JSON.parse(JSON.stringify(value, (_k, v) => (v === undefined ? null : v)))

/** JSON `null` → `undefined` on the way in. */
const nn = <T>(value: T | null): T | undefined => (value === null ? undefined : value)

interface ViewArgs {
  input: {
    stop: NearbyStop['stop']
    etas?: Eta[]
    routeCount: number | null
    distanceM: number | null
    /** Absent in most rows — the wire omits it when every board answered (ADR-077). */
    failed?: EtaFailure[]
  }
  locale: Locale
  now: string
  policy?: StopCardOptions['policy'] | null
}

const optsOf = (a: { locale: Locale; now: string; policy?: StopCardOptions['policy'] | null }) => ({
  locale: a.locale,
  now: at(a.now),
  policy: nn(a.policy ?? null),
})

describe('stop-card#displayName', () => {
  for (const c of cases<{ name: string }, unknown>('displayName')) {
    it(c.name, () => {
      expect(nulled(displayName(c.args.name))).toEqual(c.expect)
    })
  }
})

describe('stop-card#stopCardCaption', () => {
  for (const c of cases<
    { distanceM: number | null; bearingDeg: number | null; locale: Locale },
    string
  >('stopCardCaption')) {
    it(c.name, () => {
      expect(stopCardCaption(nn(c.args.distanceM), nn(c.args.bearingDeg), c.args.locale)).toBe(
        c.expect,
      )
    })
  }
})

describe('stop-card#stopCardView', () => {
  for (const c of cases<ViewArgs, unknown>('stopCardView')) {
    it(c.name, () => {
      // Destructured field by field rather than spread, deliberately: a row that grew a field the
      // kernel does not read would otherwise pass silently. That is also how `failed` was found to be
      // arriving nowhere — the flag stayed false against a row that named a refusing kerb.
      const { stop, etas, routeCount, distanceM, failed } = c.args.input
      const got = stopCardView(
        { stop, etas: etas ?? [], routeCount: nn(routeCount), distanceM: nn(distanceM), failed },
        optsOf(c.args),
      )
      expect(nulled(got)).toEqual(c.expect)
    })
  }
})

describe('stop-card#nearbyView', () => {
  for (const c of cases<{ stops: NearbyStop[]; locale: Locale; now: string }, unknown>(
    'nearbyView',
  )) {
    it(c.name, () => {
      expect(nulled(nearbyView(c.args.stops, optsOf(c.args)))).toEqual(c.expect)
    })
  }
})

// ── the two assertions a JSON corpus cannot state ──────────────────────────────────────────────
//
// Both are properties of the *call*, not of the returned value, so there is nothing for an `expect`
// field to hold. They live here with their reasoning rather than being dropped, which is the same
// choice `test/geo.test.ts` documents for its two uncoverable branches.

describe('stop-card: properties a corpus row cannot express', () => {
  it('does not reorder the caller’s array in place', () => {
    // `nearbyView` sorts, and the array it is handed belongs to the TanStack Query cache — a value
    // other observers hold and re-render from. Sorting it in place would mutate their copy and, worse,
    // do so invisibly: the list would look right, because the mutation produces the order we wanted.
    const stops = (
      corpus.groups.nearbyView.cases.find(
        (c) => c.name === 'nearest-first-whatever-order-the-response-arrived-in',
      )?.args as { stops: NearbyStop[] }
    ).stops
    const before = stops.map((s) => s.stop.id)
    nearbyView(stops, { locale: 'en', now: at('2026-07-29T11:50:30+08:00') })
    expect(stops.map((s) => s.stop.id)).toEqual(before)
  })

  it('falls back to the shipped policy when none is served', () => {
    // A cold start and an offline launch both reach this path (ADR-053), and the corpus rows that
    // omit `policy` already exercise it — but only implicitly, by matching numbers that happen to be
    // the defaults. Asserting the equivalence directly means a change to `CLIENT_POLICY_DEFAULTS`
    // cannot silently make those rows pass for a different reason than they did before.
    const stop = {
      id: 'KMB:X',
      name: { en: 'Somewhere', 'zh-Hant': '某處', 'zh-Hans': '某处' },
    }
    const input = { stop, etas: [], routeCount: 9 }
    const opts = { locale: 'en' as Locale, now: at('2026-07-29T11:50:30+08:00') }
    expect(stopCardView(input, opts)).toEqual(
      stopCardView(input, { ...opts, policy: CLIENT_POLICY_DEFAULTS }),
    )
  })
})
