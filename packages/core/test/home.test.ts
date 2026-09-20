import { describe, expect, it } from 'vitest'
import corpus from '../spec/home.spec.json'
import { type HomeCard, type HomeSections, homeView } from '../src/home'
import type { StopCardOptions } from '../src/stop-card'
import type { LatLng, Locale, NearbyStop, StopDetail } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/home.spec.json.

type Args = {
  saved: string[]
  places: StopDetail[]
  nearby: NearbyStop[]
  locale: Locale
  now: string
  at?: LatLng
}

const cases = () => specCases<Args, HomeSections>(corpus, 'homeView')

const run = (a: Args): HomeSections =>
  homeView({ saved: a.saved, places: a.places, nearby: a.nearby, ...(a.at ? { at: a.at } : {}) }, {
    locale: a.locale,
    now: Date.parse(a.now),
  } satisfies StopCardOptions)

const every = (s: HomeSections): HomeCard[] => [...s.catch, ...s.saved, ...s.nearby]

describe('home#homeView', () => {
  for (const c of cases()) {
    it(c.name, () => {
      expect(run(c.args)).toEqual(c.expect)
    })
  }

  // The four properties the sections are *for*, asserted across every row rather than case by case —
  // each one is a claim a single golden can satisfy by accident.

  it('draws a place once, whatever section it lands in', () => {
    for (const c of cases()) {
      const ids = every(run(c.args)).map((card) => card.stopId)
      expect(new Set(ids).size, `${c.name}: a place is drawn twice`).toBe(ids.length)
    }
  })

  it('never puts a route in both a card’s rows and its chips', () => {
    for (const c of cases()) {
      for (const card of every(run(c.args))) {
        const rows = new Set(card.saved.map((r) => r.routeId))
        for (const chip of card.chips) {
          expect(
            rows.has(chip.routeId),
            `${c.name}/${card.stopId}: ${chip.routeId} is in both`,
          ).toBe(false)
        }
      }
    }
  })

  // The honesty rule in `CatchBand`, and the one a rider would actually be hurt by: they must never be
  // shown a bus they were told they could catch and cannot. A band therefore exists only where there is a
  // position AND a figure to subtract the walk from.
  it('bands a row only when there is a position and a live figure', () => {
    for (const c of cases()) {
      const banded = every(run(c.args)).flatMap((card) =>
        card.saved.filter((r) => r.catch !== undefined),
      )
      if (c.args.at === undefined) {
        expect(banded, `${c.name}: banded a row with no position`).toEqual([])
        continue
      }
      for (const row of banded) {
        expect(row.label.kind, `${c.name}: banded a row with no figure`).toBe('mins')
      }
    }
  })

  // `catch` and `saved` are one list split by a predicate, so the split has to be exhaustive in both
  // directions — a card with a catchable row must not sit in `saved`, and a card with none must not sit
  // in `catch`. Getting this backwards is silent: both sections render identically.
  it('splits catch and saved on exactly the same predicate', () => {
    for (const c of cases()) {
      const s = run(c.args)
      for (const card of s.catch)
        expect(
          card.saved.some((r) => r.catch !== undefined),
          `${c.name}/${card.stopId}: in catch with nothing catchable`,
        ).toBe(true)
      for (const card of s.saved)
        expect(
          card.saved.some((r) => r.catch !== undefined),
          `${c.name}/${card.stopId}: catchable but filed under saved`,
        ).toBe(false)
    }
  })

  it('counts the hidden chips honestly, never below zero', () => {
    for (const c of cases()) {
      for (const card of every(run(c.args)))
        expect(card.chipsMore, `${c.name}/${card.stopId}`).toBeGreaterThanOrEqual(0)
    }
  })
})
