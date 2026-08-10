import { describe, expect, it } from 'vitest'
import corpus from '../spec/live.spec.json'
import {
  acceptTargets,
  applyLiveEtasToNearby,
  applyLiveEtasToStopDetail,
  applyLiveFrame,
  diffEtas,
  LIVE_CADENCE_CEILING_MS,
  LIVE_CADENCE_FLOOR_MS,
  LIVE_CADENCE_RAMP_ROUNDS,
  LIVE_RECONNECT_INITIAL_MS,
  LIVE_ROUTE_MAX_GAP_MS,
  LIVE_ROUTE_MIN_GAP_MS,
  LIVE_SESSION_START,
  type LiveApplyResult,
  type LiveSession,
  liveReconnectDelayMs,
  liveShardFor,
  liveSocketUrl,
  liveTargetsKey,
  narrowEtasToRoutes,
  nextLiveCadenceMs,
  nextRouteRoundMs,
  retainFailedPoles,
  routeIdFromWatchName,
  routeWatchName,
  sameFailures,
  sameReading,
  unionFailures,
} from '../src/live'
import type {
  Eta,
  EtaFailure,
  EtaRef,
  NearbyStop,
  ServerFrame,
  StopDetail,
  WatchTarget,
} from '../src/types'
import { at, specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/live.spec.json. JSON `null` becomes the language's absent
// value at the boundary (see test/corpus.ts) — here that is an absent subscriber count and an absent
// shard-count override, both of which are real states a caller reaches.
//
// Note what these tests do NOT do: they never read a clock, open a socket or set a timer. Every rule
// under test is a pure function over plain data, which is the property that lets the identical rows
// drive an XCTest and a JUnit suite (ADR-060). If a rule here ever needed an environment, that would
// be evidence it belongs in `packages/api-client` or `apps/edge`, not evidence this file needs a fake.

describe('live#sameReading', () => {
  for (const c of specCases<{ a: Eta; b: Eta }, boolean>(corpus, 'sameReading')) {
    it(c.name, () => {
      expect(sameReading(c.args.a, c.args.b)).toBe(c.expect)
      // Symmetry is not stated in the corpus because a row asserting it would be a row about the
      // *implementation*, not about the wire. It is asserted here for every row instead: an
      // asymmetric "is this news?" would make a delta depend on which side happened to be `prev`,
      // and the poll emulator and the socket assign those two sides in opposite orders.
      expect(sameReading(c.args.b, c.args.a)).toBe(c.expect)
    })
  }
})

describe('live#diffEtas', () => {
  for (const c of specCases<{ prev: Eta[]; next: Eta[] }, { changed: Eta[]; gone: EtaRef[] }>(
    corpus,
    'diffEtas',
  )) {
    it(c.name, () => {
      expect(diffEtas(c.args.prev, c.args.next)).toEqual(c.expect)
    })
  }
})

describe('live#retainFailedPoles', () => {
  for (const c of specCases<{ prev: Eta[]; next: Eta[]; failedStopIds: string[] }, Eta[]>(
    corpus,
    'retainFailedPoles',
  )) {
    it(c.name, () => {
      const before = JSON.stringify(c.args.prev)
      expect(retainFailedPoles(c.args.prev, c.args.next, c.args.failedStopIds)).toEqual(c.expect)
      // The retained readings come out of `prev`, and both callers hold `prev` as the state they are
      // about to diff against — the poll emulator's `readings` map and the shard's `before`. Returning
      // the same objects is fine and intended; mutating them is not, and an in-place merge would look
      // identical on the first round and quietly corrupt the second.
      expect(JSON.stringify(c.args.prev)).toBe(before)
    })
  }
})

describe('live#narrowEtasToRoutes', () => {
  for (const c of specCases<{ etas: Eta[]; routeIds: string[] | null }, Eta[]>(
    corpus,
    'narrowEtasToRoutes',
  )) {
    it(c.name, () => {
      // JSON `null` is the language's absent value at this boundary — see `test/corpus.ts`. Translated
      // here rather than typed as `undefined`, because `null` must not leak into a parameter declared
      // `string[] | undefined`: the function's absent branch is the one every healthy round takes.
      const routeIds = c.args.routeIds ?? undefined
      const before = JSON.stringify(c.args.etas)
      expect(narrowEtasToRoutes(c.args.etas, routeIds)).toEqual(c.expect)
      // A filter that returned its input array would let a caller's `.sort()` reorder somebody else's
      // list. The edge hands this `stopArrivals`' output, which `coalesce` shares by reference across
      // every concurrent request for 30 s, so an aliased return is a real hazard rather than a purist
      // one — and the absent/empty branches are exactly where a `return etas` is tempting.
      expect(narrowEtasToRoutes(c.args.etas, routeIds)).not.toBe(c.args.etas)
      expect(JSON.stringify(c.args.etas)).toBe(before)
    })
  }
})

describe('live#liveTargetsKey', () => {
  for (const c of specCases<{ targets: WatchTarget[] }, string>(corpus, 'liveTargetsKey')) {
    it(c.name, () => {
      expect(liveTargetsKey(c.args.targets)).toBe(c.expect)
    })
  }

  it('two accepted sets that differ at all produce different keys', () => {
    // The property the rows cannot state one at a time, and the one a collision would silently break:
    // a key that repeated for a *different* subscription is a hook that never resubscribes. Every
    // distinct set below must produce a distinct string.
    const sets: WatchTarget[][] = [
      [{ stopId: 'KMB:A' }],
      [{ stopId: 'KMB:B' }],
      [{ stopId: 'KMB:A' }, { stopId: 'KMB:B' }],
      [{ stopId: 'P:KMB:A+KMB:B' }],
      [{ stopId: 'KMB:A', routeIds: ['KMB:B'] }],
      [{ stopId: 'KMB:A', routeIds: ['KMB:1:outbound:1'] }],
      [{ stopId: 'KMB:A', routeIds: ['KMB:1:outbound:1', 'KMB:6:outbound:1'] }],
    ]
    const keys = sets.map(liveTargetsKey)
    expect(new Set(keys).size).toBe(sets.length)
  })
})

describe('live#sameFailures', () => {
  for (const c of specCases<{ a: EtaFailure[]; b: EtaFailure[] }, boolean>(
    corpus,
    'sameFailures',
  )) {
    it(c.name, () => {
      expect(sameFailures(c.args.a, c.args.b)).toBe(c.expect)
      // Symmetry, over every row rather than as a row of its own — same argument as `sameReading`'s: an
      // asymmetric "is this news?" would make a frame depend on which side happened to be the previous
      // set, and the two engines assign those sides in opposite orders (the emulator holds `sent`, the
      // shard holds the attachment).
      expect(sameFailures(c.args.b, c.args.a)).toBe(c.expect)
    })
  }
})

describe('live#unionFailures', () => {
  for (const c of specCases<{ lists: EtaFailure[][] }, EtaFailure[]>(corpus, 'unionFailures')) {
    it(c.name, () => {
      const before = JSON.stringify(c.args.lists)
      expect(unionFailures(c.args.lists)).toEqual(c.expect)
      // The caller holds these lists as the round's own per-target answers and diffs against them
      // afterwards, so a union that sorted an input in place would corrupt the next round's comparison.
      expect(JSON.stringify(c.args.lists)).toBe(before)
    })
  }

  it('is idempotent over its own output', () => {
    // The output is itself a valid single-element input, and both engines pass one to `sameFailures`
    // against a previous *output*. A union that was not stable under a second pass would make two rounds
    // with identical failures compare unequal, which is a frame per round for no news.
    for (const c of specCases<{ lists: EtaFailure[][] }, EtaFailure[]>(corpus, 'unionFailures')) {
      const once = unionFailures(c.args.lists)
      expect(unionFailures([once]), c.name).toEqual(once)
    }
  })
})

describe('live#applyLiveFrame', () => {
  for (const c of specCases<{ state: LiveSession; frame: ServerFrame }, LiveApplyResult>(
    corpus,
    'applyLiveFrame',
  )) {
    it(c.name, () => {
      const before = JSON.stringify(c.args.state)
      expect(applyLiveFrame(c.args.state, c.args.frame)).toEqual(c.expect)
      // The reducer must not mutate the session it was handed. Checked on every row rather than in
      // one row of its own, because the caller is a React state setter and the persisted query cache
      // (ADR-058) holds the same object: an in-place merge would appear to work, then silently
      // rewrite what another observer is already showing.
      expect(JSON.stringify(c.args.state)).toBe(before)
    })
  }
})

describe('live#acceptTargets', () => {
  for (const c of specCases<
    { targets: WatchTarget[] },
    { accepted: WatchTarget[]; rejected: WatchTarget[] }
  >(corpus, 'acceptTargets')) {
    it(c.name, () => {
      expect(acceptTargets(c.args.targets)).toEqual(c.expect)
    })
  }
})

describe('live#nextLiveCadenceMs', () => {
  for (const c of specCases<
    { subscribers: number | null; unchangedRounds: number | null },
    number | null
  >(corpus, 'nextLiveCadenceMs')) {
    it(c.name, () => {
      // `?? undefined` and not `|| undefined`: `0` is a meaningful subscriber count (it is the row
      // that stops the alarm) and truthiness would silently turn it into "absent", which happens to
      // produce the same answer here and would hide the rule the row is pinning.
      expect(
        nextLiveCadenceMs({
          subscribers: c.args.subscribers ?? undefined,
          unchangedRounds: c.args.unchangedRounds ?? undefined,
        }),
      ).toBe(c.expect)
    })
  }
})

describe('live#liveReconnectDelayMs', () => {
  for (const c of specCases<
    {
      attempt: number | null
      jitter: number | null
      initialMs: number | null
      factor: number | null
      maxMs: number | null
    },
    number
  >(corpus, 'liveReconnectDelayMs')) {
    it(c.name, () => {
      // `?? undefined` again, and here it is load-bearing twice over: `jitter: 0` is the bottom of the
      // band (the row that proves the jitter can never reach zero) and a schedule parameter of `0` is a
      // misconfiguration with its own row. Truthiness would turn both into "absent" and both rows would
      // then pass against an implementation with no guard at all.
      expect(
        liveReconnectDelayMs({
          attempt: c.args.attempt ?? undefined,
          jitter: c.args.jitter ?? undefined,
          initialMs: c.args.initialMs ?? undefined,
          factor: c.args.factor ?? undefined,
          maxMs: c.args.maxMs ?? undefined,
        }),
      ).toBe(c.expect)
    })
  }
})

describe('live#liveShardFor', () => {
  for (const c of specCases<{ targets: WatchTarget[]; shardCount: number | null }, number>(
    corpus,
    'liveShardFor',
  )) {
    it(c.name, () => {
      expect(liveShardFor(c.args.targets, c.args.shardCount ?? undefined)).toBe(c.expect)
    })
  }
})

describe('live#routeWatchName', () => {
  for (const c of specCases<{ routeId: string }, string | null>(corpus, 'routeWatchName')) {
    it(c.name, () => {
      // `?? null` at the boundary: JSON has no `undefined`, so the corpus writes the absent answer as
      // `null` and the translation belongs here rather than in the signature (see test/corpus.ts).
      expect(routeWatchName(c.args.routeId) ?? null).toBe(c.expect)
    })
  }

  it('round-trips through `routeIdFromWatchName`, which is what pins the inverse', () => {
    // The object reads its own name to learn which route it is for, so the two functions have to agree
    // exactly. Asserted as a property over this group's rows rather than as a second corpus group
    // restating the same strings backwards.
    for (const c of specCases<{ routeId: string }, string | null>(corpus, 'routeWatchName')) {
      const name = routeWatchName(c.args.routeId)
      expect(routeIdFromWatchName(name), c.name).toBe(
        name === undefined ? undefined : c.args.routeId,
      )
    }
  })

  it('reads nothing back out of a name that is not a route watch', () => {
    // A shard's name, a plausible-looking forgery and the absent case. The validation on the way *out*
    // matters because by then the name is storage-shaped input, not something this process just made.
    expect(routeIdFromWatchName('live-3')).toBeUndefined()
    expect(routeIdFromWatchName('route-not a route id')).toBeUndefined()
    expect(routeIdFromWatchName('route-')).toBeUndefined()
    expect(routeIdFromWatchName(undefined)).toBeUndefined()
    expect(routeIdFromWatchName(null)).toBeUndefined()
  })

  it('never mints a name a shard could also be called', () => {
    // A property over the group rather than a value. The two namespaces share one Durable Object class, so a
    // name collision would silently put a route watch and a place shard in the same object — with two
    // different clocks and two different caps. `liveShardFor` names its objects `live-<n>`.
    for (const c of specCases<{ routeId: string }, string | null>(corpus, 'routeWatchName')) {
      const name = routeWatchName(c.args.routeId)
      if (name === undefined) continue
      expect(name.startsWith('live-'), `${c.name}: could collide with a shard`).toBe(false)
      expect(name).not.toBe(c.args.routeId)
    }
  })
})

describe('live#nextRouteRoundMs', () => {
  interface RoundArgs {
    publishedAt?: string
    previousPublishedAt?: string
    cacheAgeSec?: number
    now: string
  }
  const call = (a: RoundArgs) =>
    nextRouteRoundMs({
      ...(a.publishedAt === undefined ? {} : { publishedAt: a.publishedAt }),
      ...(a.previousPublishedAt === undefined
        ? {}
        : { previousPublishedAt: a.previousPublishedAt }),
      ...(a.cacheAgeSec === undefined ? {} : { cacheAgeSec: a.cacheAgeSec }),
      now: at(a.now),
    })

  for (const c of specCases<RoundArgs, number>(corpus, 'nextRouteRoundMs')) {
    it(c.name, () => {
      expect(call(c.args)).toBe(c.expect)
    })
  }

  it('never schedules outside its own floor and ceiling', () => {
    // The property the clamp exists for, asserted across every row rather than trusted per row: whatever the
    // arithmetic, a watch must not become a tight loop against somebody else's free API, and must not park
    // itself for so long that a rider watches a dead screen.
    for (const c of specCases<RoundArgs, number>(corpus, 'nextRouteRoundMs')) {
      const ms = call(c.args)
      expect(ms, `${c.name}: below the floor`).toBeGreaterThanOrEqual(LIVE_ROUTE_MIN_GAP_MS)
      expect(ms, `${c.name}: above the ceiling`).toBeLessThanOrEqual(LIVE_ROUTE_MAX_GAP_MS)
    }
  })

  it('asks sooner after a round that learned nothing than after one that did', () => {
    // The whole point of the not-advanced arms, stated as a comparison so it cannot be satisfied by two
    // numbers that happen to be equal. A round with news can afford to wait for the next publish; a round
    // without it should not wait a full period for news it already failed to get.
    const base = { publishedAt: '2026-08-10T21:29:12+08:00', now: '2026-08-10T21:29:20+08:00' }
    const advanced = call({ ...base, previousPublishedAt: '2026-08-10T21:28:13+08:00' })
    const stalled = call({ ...base, previousPublishedAt: base.publishedAt })
    const measured = call({ ...base, previousPublishedAt: base.publishedAt, cacheAgeSec: 30 })
    expect(stalled).toBeLessThan(advanced)
    expect(measured).toBeLessThan(advanced)
    // …and a measured turnover is its own answer, not the blind guess dressed up.
    expect(measured).not.toBe(stalled)
  })
})

describe('live#liveSocketUrl', () => {
  for (const c of specCases<{ apiBaseUrl: string }, string>(corpus, 'liveSocketUrl')) {
    it(c.name, () => {
      expect(liveSocketUrl(c.args.apiBaseUrl)).toBe(c.expect)
    })
  }
})

describe('live#applyLiveEtasToStopDetail', () => {
  // `failed` is `null` in the corpus wherever the caller passes nothing — JSON's stand-in for the
  // language's absent value (see test/corpus.ts), and the case that must CLEAR a stale list rather than
  // preserve it. `?? undefined` is that translation at the boundary; passing `null` through would type-
  // error, which is the point of doing it here rather than widening the signature.
  for (const c of specCases<
    { detail: StopDetail; etas: Eta[]; failed: EtaFailure[] | null },
    StopDetail
  >(corpus, 'applyLiveEtasToStopDetail')) {
    it(c.name, () => {
      expect(
        applyLiveEtasToStopDetail(c.args.detail, c.args.etas, c.args.failed ?? undefined),
      ).toEqual(c.expect)
    })
  }
})

describe('live#applyLiveEtasToNearby', () => {
  for (const c of specCases<
    { stops: NearbyStop[]; etas: Eta[]; failed: EtaFailure[] | null },
    NearbyStop[]
  >(corpus, 'applyLiveEtasToNearby')) {
    it(c.name, () => {
      expect(applyLiveEtasToNearby(c.args.stops, c.args.etas, c.args.failed ?? undefined)).toEqual(
        c.expect,
      )
    })
  }
})

// The branches no corpus row can reach, asserted here with the reasoning rather than hidden by
// lowering the coverage threshold — the same treatment `resolveClientPolicy`'s non-finite inputs and
// `formatBearing`'s unknown locale get, and for the same underlying reason: **JSON cannot express
// these values**, and `packages/core` performs no runtime validation (ADR-052 decision 2), so they are
// reachable in production even though no portable fixture can state them.
describe('live#nextLiveCadenceMs — inputs JSON cannot express', () => {
  it('treats a non-finite subscriber count as no subscribers', () => {
    // `JSON.parse` never yields NaN or Infinity, so no corpus row can produce this. A caller dividing
    // to compute an average of connections can, and an `Infinity` subscriber count that fell through
    // to the floor would keep a shard polling upstream for a room nobody is in.
    expect(nextLiveCadenceMs({ subscribers: Number.NaN, unchangedRounds: 0 })).toBeNull()
    expect(
      nextLiveCadenceMs({ subscribers: Number.POSITIVE_INFINITY, unchangedRounds: 0 }),
    ).toBeNull()
  })

  it('treats a non-finite round count as zero quiet rounds', () => {
    // Same origin, opposite direction: `NaN * step` is `NaN`, and `Math.min(60000, NaN)` is `NaN`, so
    // without the finite guard this would hand `setAlarm` a NaN — which is not a slow alarm, it is a
    // shard that never wakes again and reports nothing.
    expect(nextLiveCadenceMs({ subscribers: 1, unchangedRounds: Number.NaN })).toBe(
      LIVE_CADENCE_FLOOR_MS,
    )
    expect(nextLiveCadenceMs({ subscribers: 1, unchangedRounds: Number.POSITIVE_INFINITY })).toBe(
      LIVE_CADENCE_FLOOR_MS,
    )
  })

  it('treats values that are not numbers at all as absent', () => {
    // The types say `number | undefined` and nothing validates on this side of the network — a shard
    // count or a subscriber count read from an environment variable arrives as a string and reaches
    // this function typed as a number it is not.
    type Cadence = { subscribers?: number; unchangedRounds?: number }
    const hostileCount = { subscribers: '4', unchangedRounds: 2 } as unknown as Cadence
    expect(nextLiveCadenceMs(hostileCount)).toBeNull()
    const hostileRounds = { subscribers: 1, unchangedRounds: '2' } as unknown as Cadence
    expect(nextLiveCadenceMs(hostileRounds)).toBe(LIVE_CADENCE_FLOOR_MS)
  })
})

describe('live#liveReconnectDelayMs — inputs JSON cannot express', () => {
  // Same boundary as the block above, and the same reason it is a TypeScript test rather than a row: a
  // schedule parameter or an attempt counter can arrive as a string from an environment variable, or as
  // `NaN` from arithmetic on one, and `JSON.parse` can produce neither.
  type Schedule = Parameters<typeof liveReconnectDelayMs>[0]

  it('treats a non-finite attempt or schedule parameter as absent', () => {
    // `2 ** NaN` is `NaN` and `Math.min(30000, NaN)` is `NaN`, so without the guard this hands
    // `setTimeout` a NaN delay — which fires *immediately* rather than never, i.e. the tight loop the
    // whole backoff exists to prevent, against a server that has just dropped the connection.
    expect(liveReconnectDelayMs({ attempt: Number.NaN, jitter: 1 })).toBe(LIVE_RECONNECT_INITIAL_MS)
    // `Infinity` is the first attempt too, and not the cap: an unusable counter says nothing about how
    // long the outage has been, so the schedule restarts rather than jumping to its slowest step.
    expect(liveReconnectDelayMs({ attempt: Number.POSITIVE_INFINITY, jitter: 1 })).toBe(
      LIVE_RECONNECT_INITIAL_MS,
    )
    expect(liveReconnectDelayMs({ attempt: 1, jitter: 1, initialMs: Number.NaN })).toBe(
      LIVE_RECONNECT_INITIAL_MS,
    )
  })

  it('treats a non-finite jitter as the top of the band', () => {
    // The one input where zero is meaningful, so it has its own guard — and a `NaN` that fell through
    // would make the delay `NaN` from the other side of the sum.
    expect(liveReconnectDelayMs({ attempt: 1, jitter: Number.NaN })).toBe(LIVE_RECONNECT_INITIAL_MS)
  })

  it('treats values that are not numbers at all as absent', () => {
    const hostile = { attempt: '4', jitter: '0' } as unknown as Schedule
    // `'4'` would exponentiate correctly (`2 ** '3'` is 8) and `'0'` would multiply correctly, so this
    // input produces a *plausible* 8 s delay without the `typeof` clause — the kind of wrong number no
    // one investigates.
    expect(liveReconnectDelayMs(hostile)).toBe(LIVE_RECONNECT_INITIAL_MS)
  })
})

describe('live — properties a corpus row cannot express', () => {
  it('the ramp divides into whole milliseconds', () => {
    // The corpus pins 45/50/55/60 s as literals, and those literals are only correct while the span
    // divides by the ramp length. Changing one constant and not the others would produce fractional
    // cadences that every corpus row would then contradict — this assertion is the one that says
    // *why* the rows are the numbers they are, and it is why editing a cadence constant is
    // deliberately more than one edit.
    const span = LIVE_CADENCE_CEILING_MS - LIVE_CADENCE_FLOOR_MS
    expect(LIVE_CADENCE_FLOOR_MS).toBeLessThan(LIVE_CADENCE_CEILING_MS)
    expect(span % LIVE_CADENCE_RAMP_ROUNDS).toBe(0)
    expect(nextLiveCadenceMs({ subscribers: 1, unchangedRounds: LIVE_CADENCE_RAMP_ROUNDS })).toBe(
      LIVE_CADENCE_CEILING_MS,
    )
  })

  it('the starting session is the sentinel the reducer reads', () => {
    // `seq: 0` is what makes "no snapshot has ever landed" expressible without a fourth field, and the
    // wire's counter starting at 1 is what keeps the two apart. A corpus row states the *behaviour*
    // (a delta against seq 0 asks for a resync); this states the constant that behaviour depends on,
    // so the two cannot drift apart silently.
    expect(LIVE_SESSION_START).toEqual({
      seq: 0,
      etas: [],
      targets: [],
      // Empty rather than absent, and the two are not interchangeable here: `failed` is a required field
      // on a session precisely so a reader never has to ask whether "we know of no failures" and "we have
      // not been told" are the same state. On the *wire* the field is optional and absent means empty
      // (ADR-081); the session is where that ambiguity is resolved, once.
      failed: [],
      status: { state: 'connecting' },
    })
    expect(applyLiveFrame(LIVE_SESSION_START, { type: 'pong' }).state).toBe(LIVE_SESSION_START)
  })
})
