import { describe, expect, it } from 'vitest'
import corpus from '../spec/favourites.spec.json'
import {
  FAVOURITE_KEY_VERSION,
  favouritePoleIds,
  favouritesView,
  migrateFavouriteKeys,
} from '../src/favourites'
import { formatFavoriteRouteKey, parseFavoriteRouteKey } from '../src/ids'
import type { StopCardOptions, StopCardView } from '../src/stop-card'
import type { Locale, StopDetail } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/favourites.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

describe('favourites#migrateFavouriteKeys', () => {
  // The loader turns the corpus's JSON `null` into the language's absent value, so a row that records
  // "a version that is not a number" arrives here as `undefined` rather than as `null`.
  type Args = { saved: unknown[]; fromVersion: number | undefined }
  for (const c of cases<Args, unknown[]>('migrateFavouriteKeys')) {
    it(c.name, () => {
      // `null` in the corpus is the language's absent value, and this rule's whole point is that a
      // version it cannot read is treated as the oldest rather than trusted — so `NaN` is the honest
      // translation here, not `0`, which would be testing a different input.
      const from = c.args.fromVersion === undefined ? Number.NaN : c.args.fromVersion
      expect(migrateFavouriteKeys(c.args.saved, from)).toEqual(c.expect)
    })
  }

  it('is idempotent, because a future blob is re-stamped at our version', () => {
    // The property the doc comment promises and the one a second step will depend on: a blob from a
    // *future* version is returned untouched and then stamped at ours, so the next step added below this
    // one will meet data it has already been run against.
    for (const c of cases<Args, unknown[]>('migrateFavouriteKeys')) {
      const once = migrateFavouriteKeys(c.args.saved, 0)
      expect(migrateFavouriteKeys(once, 0), c.name).toEqual(once)
    }
  })

  it('never loses an entry, and never invents a pole', () => {
    // The safety property, and the reason this rule is versioned rather than merely changed: a favourite
    // is a thing a rider curated by hand, so the one thing the migration must never do is end up with
    // *fewer* things than it was given, or with a key naming a pole the place does not have.
    for (const c of cases<Args, unknown[]>('migrateFavouriteKeys')) {
      const got = migrateFavouriteKeys(c.args.saved, 0)
      expect(got.length, `${c.name}: lost an entry`).toBeGreaterThanOrEqual(
        new Set(c.args.saved).size,
      )
      for (const entry of got) {
        if (typeof entry !== 'string') continue
        const parsed = parseFavoriteRouteKey(entry)
        if (!parsed) continue
        // Every produced key is either one it was given, or a member of a place it was given.
        const fromInput = c.args.saved.some((original) => {
          if (typeof original !== 'string') return false
          if (original === entry) return true
          const source = parseFavoriteRouteKey(original)
          return (
            source?.stop.kind === 'place' &&
            source.routeId === parsed.routeId &&
            source.stop.members.some((m) => formatFavoriteRouteKey(m.id, source.routeId) === entry)
          )
        })
        expect(fromInput, `${c.name}: invented ${entry}`).toBe(true)
      }
    }
  })

  it('leaves the caller’s array alone', () => {
    // zustand hands `migrate` the persisted blob and shallow-merges what comes back, so a rule that
    // mutated its input would corrupt the very list it was asked to repair — and only for a rider whose
    // blob needed repairing, which is the population least able to notice.
    const saved = ['P:CTB:1+CTB:2|CTB:1:outbound:1']
    const before = JSON.stringify(saved)
    migrateFavouriteKeys(saved, 0)
    expect(JSON.stringify(saved)).toBe(before)
  })

  it('has a version the corpus and the code agree on', () => {
    // The anti-vacuous control for the shared constant. Two stores stamp a blob with this number, and a
    // disagreement is silent: a lower version re-runs a completed step, a higher one makes the next step
    // skip data it has never seen. The corpus's own "already at the current version" row is written
    // against the literal 1, so the two cannot drift apart without a red test.
    expect(FAVOURITE_KEY_VERSION).toBe(1)
    const current = cases<Args, unknown[]>('migrateFavouriteKeys').find(
      (c) => c.args.fromVersion === FAVOURITE_KEY_VERSION,
    )
    expect(current, 'no corpus row exercises the already-current version').toBeDefined()
  })
})

describe('favourites#favouritePoleIds', () => {
  type Args = { saved: string[] }
  for (const c of cases<Args, string[]>('favouritePoleIds')) {
    it(c.name, () => {
      expect(favouritePoleIds(c.args.saved)).toEqual(c.expect)
    })
  }

  it('answers with poles the saved keys actually name, and each at most once', () => {
    // Two properties in one loop because they are the same guarantee from either side: this list becomes
    // one HTTP request each, so an invented id is a request for a stop nobody saved and a duplicate is a
    // request paid for twice — on the screen that fans out the most queries in the app.
    for (const c of cases<Args, string[]>('favouritePoleIds')) {
      const got = favouritePoleIds(c.args.saved)
      expect(new Set(got).size, `${c.name}: duplicated a pole`).toBe(got.length)
      const named = new Set(
        c.args.saved.flatMap((key) => {
          const parsed = parseFavoriteRouteKey(key)
          return parsed ? [parsed.stopId] : []
        }),
      )
      for (const id of got) expect(named.has(id), `${c.name}: invented ${id}`).toBe(true)
    }
  })
})

describe('favourites#favouritesView', () => {
  interface Args {
    saved: string[]
    places: StopDetail[]
    locale: Locale
    now: string
  }
  const optionsFor = (a: Args): StopCardOptions => ({ locale: a.locale, now: Date.parse(a.now) })

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, StopCardView[]>('favouritesView')
    // The anti-vacuous control: a group that resolved to nothing would make the loop assert nothing.
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const c of rows) {
      expect(
        favouritesView({ saved: c.args.saved, places: c.args.places }, optionsFor(c.args)),
        c.name,
      ).toEqual(c.expect)
    }
  })

  it('draws one card per resolved place, never per saved pole', () => {
    // The grouping decision as a property. Two poles of one interchange are two saved keys and ONE card;
    // getting this wrong shows a rider two cards with the same name, which reads as two places.
    for (const c of cases<Args, StopCardView[]>('favouritesView')) {
      const got = favouritesView({ saved: c.args.saved, places: c.args.places }, optionsFor(c.args))
      const distinctPlaces = new Set(c.args.places.map((p) => p.stop.id))
      expect(got.length, c.name).toBe(distinctPlaces.size)
      expect(new Set(got.map((card) => card.stopId)).size, `${c.name}: duplicated a card`).toBe(
        got.length,
      )
    }
  })

  it('shows only rows the rider saved', () => {
    // The other half of the same guarantee: a screen showing a line the rider did not star is showing a
    // list they did not curate. Asserted over every case rather than in one, because the intersection is
    // at the *pole* — so a place reporting the same route number at two kerbs is where it would slip.
    let checked = 0
    for (const c of cases<Args, StopCardView[]>('favouritesView')) {
      const got = favouritesView({ saved: c.args.saved, places: c.args.places }, optionsFor(c.args))
      const savedRouteIds = new Set(
        c.args.saved.flatMap((key) => {
          const parsed = parseFavoriteRouteKey(key)
          return parsed ? [parsed.routeId] : []
        }),
      )
      for (const card of got) {
        for (const row of card.rows) {
          expect(savedRouteIds.has(row.routeId), `${c.name}: ${row.routeId} was not saved`).toBe(
            true,
          )
          checked += 1
        }
      }
    }
    // Without this the loop above passes on a corpus whose every card is empty — which is exactly the
    // shape of the `knownDefect` row below, so it is not a hypothetical.
    expect(checked, 'no corpus case produced a single row').toBeGreaterThan(0)
  })

  it('gives a saved route with no reading a row, and a readout that says so', () => {
    // **The bug WP6-4b closed, pinned from the other side.** Until 2026-08-05 a saved route with no live
    // reading contributed nothing, so a card could be a name with nothing under it — indistinguishable by
    // eye from a favourite key that no longer resolves, which is why WP5-11's favourites proof had to rest
    // on a route with a live arrival. Asserted as the *shape* rather than as one golden, because what
    // matters is that every saved route reaches the card with something on its right-hand side.
    const quiet = cases<Args, StopCardView[]>('favouritesView').find(
      (c) => c.name === 'a-saved-route-with-no-reading-is-still-a-row',
    )
    if (!quiet) throw new Error('the no-reading row moved — read its `why` before changing this')
    const got = favouritesView(
      { saved: quiet.args.saved, places: quiet.args.places },
      optionsFor(quiet.args),
    )
    expect(got).toHaveLength(1)
    expect(got[0]?.rows).toHaveLength(quiet.args.saved.length)
    for (const row of got[0]?.rows ?? []) {
      expect(['headway', 'none'], 'a route with no reading claimed one').toContain(row.label.kind)
      expect(row.urgency, 'nothing to be urgent about').toBe('none')
      expect(row.stale, 'nothing to be old').toBe(false)
    }
  })

  it('never draws a card with a name and nothing under it while something is saved there', () => {
    // The general form of the same rule, over every case — the sentence `StopRow`'s spec has carried as a
    // `mustNot` since WP6-1. A card exists because a place resolved; a row exists because the rider saved
    // one. So a card with saved routes at its place and no rows is the empty card, and there is now no
    // payload in the corpus that produces one.
    for (const c of cases<Args, StopCardView[]>('favouritesView')) {
      const got = favouritesView({ saved: c.args.saved, places: c.args.places }, optionsFor(c.args))
      for (const card of got) {
        const savedHere = c.args.places
          .filter((place) => place.stop.id === card.stopId)
          .flatMap((place) => place.routes)
          .filter((route) => c.args.saved.includes(`${route.stopId}|${route.route.id}`))
        if (savedHere.length === 0) continue
        expect(card.rows.length, `${c.name}: ${card.stopId} is an empty card`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps one line saved at two kerbs as two rows', () => {
    // WP5-12's residual from the favourites side (ADR-072): the compact card's collapse-to-one-row-per-line
    // is right for a card summarising a place and wrong for a list the rider curated — one merged row hid
    // the other kerb's bus entirely. The label naming the kerbs was declined on a measurement; see the
    // corpus row's `why` and the note in `favouritesView`.
    const both = cases<Args, StopCardView[]>('favouritesView').find(
      (c) => c.name === 'one-line-saved-at-two-kerbs-is-two-rows',
    )
    if (!both) throw new Error('the two-kerbs row moved — read its `why` before changing this')
    const got = favouritesView(
      { saved: both.args.saved, places: both.args.places },
      optionsFor(both.args),
    )
    expect(got).toHaveLength(1)
    expect(got[0]?.rows).toHaveLength(2)
    // The same rider line, twice — which is the whole point, and what `soonestPerLine` would have collapsed.
    const lines = new Set((got[0]?.rows ?? []).map((row) => `${row.operator}|${row.routeNo}`))
    expect(lines.size).toBe(1)
  })

  it('puts a live reading above a timetable and a timetable above a dash', () => {
    // A rider opens this screen to find the next bus, so the order is the readout's own rank before it is
    // anything else. It is the card's own sort because Favourites is the one surface whose rows do not
    // arrive pre-ordered from anywhere: the wire orders a *place's* rows, not a rider's list.
    const rank = (kind: string) => (kind === 'headway' ? 1 : kind === 'none' ? 2 : 0)
    for (const c of cases<Args, StopCardView[]>('favouritesView')) {
      const got = favouritesView({ saved: c.args.saved, places: c.args.places }, optionsFor(c.args))
      for (const card of got) {
        const ranks = card.rows.map((row) => rank(row.label.kind))
        expect(
          [...ranks].sort((a, b) => a - b),
          `${c.name}: ${card.stopId} is out of order`,
        ).toEqual(ranks)
      }
    }
  })
})
