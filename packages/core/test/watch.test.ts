import { describe, expect, it } from 'vitest'
import corpus from '../spec/watch.spec.json'
import type { EtaReport, Locale } from '../src/types'
import {
  WATCH_TTL_MS,
  type WatchRecord,
  type WatchView,
  watchExpired,
  watchView,
} from '../src/watch'
import { at, specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/watch.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

describe('watch#watchExpired', () => {
  type Args = { watch: WatchRecord; now: string; ttlMs: number | null }
  for (const c of cases<Args, boolean>('watchExpired')) {
    it(c.name, () => {
      // The corpus's `null` is the language's absent value, and absent here means "use the default
      // window" — so it is passed as `undefined` rather than as a zero, which would expire everything.
      const ttl = c.args.ttlMs === null ? undefined : c.args.ttlMs
      expect(watchExpired(c.args.watch, at(c.args.now), ttl)).toBe(c.expect)
    })
  }

  it('is a strictly-greater comparison, so the boundary minute belongs to the rider', () => {
    // The property the two boundary rows pin, asserted directly as well: a port that writes `>=` here
    // takes a watch away one tick early, which is exactly the sort of off-by-one a corpus row can be read
    // past but a named property cannot.
    const watch = { ...(cases<Args, boolean>('watchExpired')[0] as { args: Args }).args.watch }
    const touched = Date.parse(watch.touchedIso)
    expect(watchExpired(watch, touched + WATCH_TTL_MS)).toBe(false)
    expect(watchExpired(watch, touched + WATCH_TTL_MS + 1)).toBe(true)
  })
})

describe('watch#watchView', () => {
  type Args = {
    watch: WatchRecord
    report: EtaReport | null
    now: string
    locale: Locale
    online: boolean
    trouble: 'none' | 'unreachable'
    distanceM?: number
    showing?: { poleId?: string; routeId?: string }
  }
  for (const c of cases<Args, WatchView>('watchView')) {
    it(c.name, () => {
      expect(
        watchView({
          watch: c.args.watch,
          // JSON has no `undefined`, and the difference between "no report" and "an empty report" is the
          // difference between `pending` and `noService` — the first arm of ADR-088's order. So the
          // translation happens here, at the boundary, exactly as `nullToUndefined` does for lists.
          report: c.args.report ?? undefined,
          now: at(c.args.now),
          locale: c.args.locale,
          online: c.args.online,
          trouble: c.args.trouble,
          distanceM: c.args.distanceM,
          showing: c.args.showing,
        }),
      ).toEqual(c.expect)
    })
  }

  it('never puts a sentence where the figure goes', () => {
    // `proposals/07` §4b, as a property over every row: in any arm without a reading there is no lead to
    // draw, and the sentence is carried by `subLine` instead. A future arm that returned a word in the
    // readout would pass its own row and fail here — which is the point, because that shape is what
    // truncated the stop's name in the mockup, and the stop's name is what the rider is watching.
    for (const c of cases<Args, WatchView>('watchView')) {
      const view = c.expect
      if (view.readout.kind === 'reading') continue
      expect(Object.keys(view.readout), c.name).toEqual(['kind'])
      expect(view.arrivals, c.name).toEqual([])
    }
  })

  it('says exactly one thing on line two, and offline outranks the rest', () => {
    // The sub-line's precedence, asserted as a property rather than inferred from five rows: whenever the
    // platform is offline line two says so, whatever else is also true of the board. And every row has a
    // line — the `destination` kind is what makes "nothing to report" a thing the view states rather than
    // a null two renderers each decide what to do about.
    for (const c of cases<Args, WatchView>('watchView')) {
      expect(c.expect.subLine.kind, c.name).toBeTruthy()
      if (c.args.online) continue
      expect(c.expect.subLine.kind, c.name).toBe('offline')
    }
  })

  it('never claims a rider can catch a bus they cannot', () => {
    // The `leave` invariant: the line exists only when the walk fits inside the wait. Zero is legal and
    // means *leave now*; a negative number would be a false reassurance and must never be produced.
    for (const c of cases<Args, WatchView>('watchView')) {
      const leave = c.expect.leave
      if (leave === null) continue
      expect(leave.leaveInMin, c.name).toBeGreaterThanOrEqual(0)
      expect(leave.walkMin, c.name).toBeGreaterThanOrEqual(1)
    }
  })
})
