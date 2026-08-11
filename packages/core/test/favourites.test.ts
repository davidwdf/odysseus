import { describe, expect, it } from 'vitest'
import corpus from '../spec/favourites.spec.json'
import {
  FAVOURITE_KEY_VERSION,
  favouritePoleIds,
  favouritesView,
  mergePreferences,
  mergeSavedKeys,
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

/**
 * The branches the corpus does not reach, asserted here rather than hidden by a lowered threshold.
 *
 * **Why this block exists at all is the more useful half.** `packages/core/vitest.config.ts` scopes its
 * 100 % thresholds with a hand-spelled `include` list, and `src/favourites.ts` was never added to it when
 * WP6-4 created the module — so the file holding the rule a rider's hand-curated list survives on sat
 * *outside* the threshold for a whole wave while the threshold went on reporting green. WP6-7 added the
 * line and this is what fell out: eight branches nothing exercised. That is the repo's named recurring
 * failure — a gate that passes because it is looking at nothing — in its dullest possible costume, and
 * the reason the config now carries a paragraph about editing that list.
 *
 * These are tests rather than corpus rows, which `vitest.config.ts` already establishes as the honest
 * alternative for a branch a corpus cannot reach (it says so about `formatBearing`'s two). Each below is
 * either a **malformed input** the corpus deliberately does not model in a real payload, or a **fallback**
 * whose trigger is a shape the live dataset does not currently produce. A Swift port reads the corpus for
 * the rules; it reads these for the edges.
 */
describe('favourites — the edges the corpus cannot reach', () => {
  const NOW = Date.parse('2026-08-05T00:30:00+08:00')
  const options: StopCardOptions = { locale: 'en', now: NOW }

  /** A corpus place, cloned so a case can bend one route without disturbing the recorded fixtures. */
  const placeFrom = (caseName: string): StopDetail => {
    const found = cases<{ places: StopDetail[] }, unknown>('favouritesView').find(
      (c) => c.name === caseName,
    )
    if (!found) throw new Error(`the favouritesView corpus case \`${caseName}\` moved`)
    const place = found.args.places[0]
    if (!place) throw new Error(`\`${caseName}\` has no place to clone`)
    return structuredClone(place)
  }

  const QUIET = 'a-saved-route-with-no-reading-is-still-a-row'

  /**
   * A reading due `minutes` from the fixed `now`, in the wire's own shape.
   *
   * Built rather than borrowed because the corpus case these tests clone has `eta: null` — it is the row
   * that exists to prove a route with *no* reading is still drawn — and every edge below needs one.
   */
  const arrivalIn = (minutes: number, extra: Record<string, unknown> = {}) => ({
    routeId: 'CTB:969C:outbound:1',
    stopId: 'CTB:001992',
    operator: 'CTB' as const,
    arrivals: [new Date(NOW + minutes * 60_000).toISOString()],
    dataTimestamp: new Date(NOW - 20_000).toISOString(),
    observedAt: new Date(NOW - 5_000).toISOString(),
    ...extra,
  })

  it('drops an entry that is not a string rather than trusting it', () => {
    // A blob is JSON a previous version of this app wrote, and the one thing the migration must never do
    // is hand a non-key to the parser and act on whatever comes back. The corpus models a *corrupt string*
    // because that is what a scheme change produces; a `null` or a number in the array is what a hand-edit,
    // a partial write or a future field produces, and it reaches a different arm.
    expect(migrateFavouriteKeys([null, 42, { stopId: 'x' }], 0)).toEqual([
      null,
      42,
      { stopId: 'x' },
    ])
  })

  it('sorts two equally-ranked readings by which is due sooner', () => {
    // The tiebreaker inside the rank sort. Every corpus card has at most one live reading, so the
    // comparator's second clause has never run against real data — and it is the clause that decides which
    // of two buses a rider sees first, which is the whole reason they opened the screen.
    const place = placeFrom(QUIET)
    const [first] = place.routes
    if (!first) throw new Error('unreachable: the cloned place has no routes')
    const second = structuredClone(first)
    second.route.id = 'CTB:962:outbound:1'
    first.eta = arrivalIn(10) as typeof first.eta
    second.eta = arrivalIn(4, { routeId: second.route.id }) as typeof second.eta
    place.routes = [first, second]
    const view = favouritesView(
      {
        saved: [
          formatFavoriteRouteKey('CTB:001992', first.route.id),
          formatFavoriteRouteKey('CTB:001992', second.route.id),
        ],
        places: [place],
      },
      options,
    )
    expect(view[0]?.rows.map((row) => row.routeId)).toEqual([second.route.id, first.route.id])
  })

  it('falls back to the raw route id when the grammar cannot read a route number out of it', () => {
    // ADR-052 treats these ids as an open vocabulary, so a shape this build's grammar does not know will
    // reach a row before a parser update does — and showing the id beats showing nothing, which is the
    // same argument `operatorName` makes for an unknown operator code.
    const place = placeFrom(QUIET)
    const [route] = place.routes
    if (!route) throw new Error('unreachable: the cloned place has no routes')
    route.route.id = 'NOT-AN-ID'
    const view = favouritesView(
      { saved: [formatFavoriteRouteKey('CTB:001992', 'NOT-AN-ID')], places: [place] },
      options,
    )
    expect(view[0]?.rows[0]?.routeNo).toBe('NOT-AN-ID')
  })

  it('lets a remark stand in as the headline when the destination is blank, and untitle-cases it', () => {
    // Upstream really does send an empty `en` destination (the blank-`en` GMB circulars are a corpus
    // `knownDefect` elsewhere), and when it does the operator's own note is the only thing left to name
    // the row with. It is deliberately NOT title-cased: a remark is prose written for a rider to read,
    // where a destination arrives ALL-CAPS from the feed.
    const place = placeFrom(QUIET)
    const [route] = place.routes
    if (!route) throw new Error('unreachable: the cloned place has no routes')
    route.route.destination = { en: '', 'zh-Hant': '', 'zh-Hans': '' }
    route.eta = arrivalIn(6, {
      remark: { en: 'Scheduled departure', 'zh-Hant': '原定班次', 'zh-Hans': '原定班次' },
    }) as typeof route.eta
    const view = favouritesView(
      { saved: [formatFavoriteRouteKey('CTB:001992', route.route.id)], places: [place] },
      options,
    )
    const row = view[0]?.rows[0]
    expect(row?.headline).toBe('Scheduled departure')
    // …and it is not *also* printed as a remark line, or the same words appear twice in one row.
    expect(row).not.toHaveProperty('remark')
  })

  it('ranks a published timetable between a live reading and nothing at all, and holds the order of two silent rows', () => {
    // Three of the four remaining branches meet in one card, and they are the shape of a rider's list at
    // 23:00: most of it is peak-only services with no bus due. `headway` is the middle rank — WP6-4b's fix,
    // the reason an empty card is no longer possible — and it had never been exercised through this
    // function, only through the place screen's. Two rows with *neither* a reading nor a timetable then
    // reach the comparator's tiebreaker with no arrival on either side, which is the arm that decides
    // whether a rider's list is stable between refreshes or shuffles under them.
    const place = placeFrom(QUIET)
    const [base] = place.routes
    if (!base) throw new Error('unreachable: the cloned place has no routes')

    const timetabled = structuredClone(base)
    timetabled.route.id = 'CTB:962:outbound:1'
    timetabled.route.service = { ...timetabled.route.service, headway: { min: 12, max: 20 } }

    // Blank in every locale AND no remark — so there is nothing to head the row with, which is the last
    // arm of the headline conditional. The row is still drawn; it just has only its route number.
    const nameless = structuredClone(base)
    nameless.route.id = 'CTB:970:outbound:1'
    nameless.route.destination = { en: '', 'zh-Hant': '', 'zh-Hans': '' }

    place.routes = [base, timetabled, nameless]
    const view = favouritesView(
      {
        saved: [base, timetabled, nameless].map((route) =>
          formatFavoriteRouteKey('CTB:001992', route.route.id),
        ),
        places: [place],
      },
      options,
    )
    const rows = view[0]?.rows ?? []
    expect(rows.map((row) => row.label.kind)).toEqual(['headway', 'none', 'none'])
    expect(rows[0]?.routeId).toBe('CTB:962:outbound:1')
    // The two silent rows keep the order they arrived in, rather than swapping between refreshes.
    expect(rows.slice(1).map((row) => row.routeId)).toEqual([base.route.id, 'CTB:970:outbound:1'])
    expect(rows.find((row) => row.routeId === 'CTB:970:outbound:1')).not.toHaveProperty('headline')
  })

  it('keeps the remark on its own line when there is a destination to be the headline', () => {
    // The other arm of the same conditional, and the one that makes the assertion above mean something:
    // with both present the destination leads and the remark is a second line, so a rule that always chose
    // one of them would pass exactly one of these two tests.
    const place = placeFrom(QUIET)
    const [route] = place.routes
    if (!route) throw new Error('unreachable: the cloned place has no routes')
    route.eta = arrivalIn(8, {
      remark: { en: 'Last bus of the day', 'zh-Hant': '尾班車', 'zh-Hans': '尾班车' },
    }) as typeof route.eta
    const view = favouritesView(
      { saved: [formatFavoriteRouteKey('CTB:001992', route.route.id)], places: [place] },
      options,
    )
    const row = view[0]?.rows[0]
    expect(row?.headline).toBe('Kornhill Plaza, Kornhill Road')
    expect(row?.remark?.text).toBe('Last bus of the day')
  })
})

describe('favourites#mergeSavedKeys', () => {
  type Args = { base: string[]; mine: string[]; theirs: string[] }
  const rows = cases<Args, string[]>('mergeSavedKeys')

  for (const c of rows) {
    it(c.name, () => {
      expect(mergeSavedKeys(c.args.base, c.args.mine, c.args.theirs)).toEqual(c.expect)
    })
  }

  it('is symmetric in what it keeps, whichever writer is asked', () => {
    // The property two tabs converge on, and the one a corpus of one-sided rows cannot state: run every
    // case again with the two writers swapped and the *set* must be identical. Only the order may differ,
    // because each writer appends its own additions after the other's — and even that settles, since the
    // round after this one both writers are merging against the same ancestor.
    for (const c of rows) {
      const forwards = mergeSavedKeys(c.args.base, c.args.mine, c.args.theirs)
      const backwards = mergeSavedKeys(c.args.base, c.args.theirs, c.args.mine)
      expect([...backwards].sort(), `${c.name}: the two writers disagree`).toEqual(
        [...forwards].sort(),
      )
    }
  })

  it('never invents a key, and never duplicates one', () => {
    // The safety property, the same one the migration carries: this is a rider's hand-curated list, so a
    // merge may drop a key somebody deleted and may keep one somebody added, but it may not mint one — and
    // a duplicate is not merely untidy, because the screen treats the list as a set and an un-star that
    // removed one copy would look like it did nothing.
    for (const c of rows) {
      const got = mergeSavedKeys(c.args.base, c.args.mine, c.args.theirs)
      expect(new Set(got).size, `${c.name}: duplicated a key`).toBe(got.length)
      const offered = new Set([...c.args.mine, ...c.args.theirs])
      for (const key of got) expect(offered.has(key), `${c.name}: invented ${key}`).toBe(true)
    }
  })

  it('leaves every caller’s array alone', () => {
    // Two of the three arrays belong to a live zustand store, and one belongs to whatever was just parsed
    // off disk. A rule that sorted or spliced in place would corrupt the very list it was asked to
    // reconcile — and only for a rider with two tabs open, which is the population least able to notice.
    const base = ['CTB:001992|CTB:969:outbound:1']
    const mine = ['CTB:001992|CTB:969:outbound:1', 'KMB:775642281FBFE336|CTB:969:outbound:1']
    const theirs = ['KMB:AFB9321F7CD2C2E4|KMB:269D:outbound:1']
    const before = JSON.stringify([base, mine, theirs])
    mergeSavedKeys(base, mine, theirs)
    expect(JSON.stringify([base, mine, theirs])).toBe(before)
  })
})

describe('favourites#mergePreferences', () => {
  interface Blob {
    appearance: string
    localeOverride: Locale | null
    favoriteRoutes: string[]
    recentRoutes: string[]
    recentStops: string[]
  }
  type Args = { base: Blob | null; mine: Blob; theirs: Blob | null }
  const rows = cases<Args, Blob>('mergePreferences')

  for (const c of rows) {
    it(c.name, () => {
      expect(mergePreferences(c.args.base, c.args.mine, c.args.theirs)).toEqual(c.expect)
    })
  }

  it('says so by identity when it has nothing to do', () => {
    // The contract both stores are built on, and the reason it is worth asserting separately from the
    // values: the callers read `merged === mine` as "there is nothing to write and nobody to notify". An
    // equal-but-new object would make every remote write schedule a local write, which makes two tabs hand
    // an unchanged blob back and forth for as long as they are both open.
    for (const c of rows) {
      const got = mergePreferences(c.args.base, c.args.mine, c.args.theirs)
      const unchanged = JSON.stringify(got) === JSON.stringify(c.args.mine)
      expect(got === c.args.mine, `${c.name}: identity and equality disagree`).toBe(unchanged)
    }
  })

  it('converges: merging the result again changes nothing', () => {
    // What a `storage` listener does a moment later, on the round after this one. If a second pass moved
    // anything, two tabs would each keep finding something to write back and neither would ever settle —
    // the failure mode a merge that ordered its output by *this* writer's list would have.
    for (const c of rows) {
      if (c.args.theirs === null) continue
      const once = mergePreferences(c.args.base, c.args.mine, c.args.theirs)
      // The settled state: this writer now holds `once`, and `once` is what went to disk.
      expect(mergePreferences(once, once, once), `${c.name}: a second pass moved`).toBe(once)
    }
  })
})
