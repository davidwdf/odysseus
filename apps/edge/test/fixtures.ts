// Synthetic upstream fixtures for the Worker tests. Small enough to reason about, shaped
// exactly like the real feeds so the production code path runs unmodified — the tests drive
// `SELF.fetch('/v1/...')`, not internal functions.

/** Anchor coordinate for the nearby tests (Mong Kok-ish). */
export const ORIGIN = { lat: 22.3193, lng: 114.1694 }

/** Metres → degrees, near HK's latitude. Good to ~0.1% at this scale. */
const M_PER_DEG_LAT = 111_320
const mLat = (m: number) => m / M_PER_DEG_LAT
const mLng = (m: number) => m / (M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180))

export interface Pole {
  /** Raw operator stop id (what the live ETA API takes). */
  rawId: string
  /** Canonical id, `KMB:<rawId>`. */
  id: string
  lat: number
  lng: number
  name: string
  /** The one route serving this pole — distinct per pole (see the clustering note below). */
  route: string
  /** Metres north of ORIGIN. */
  offsetM: number
}

/**
 * **20 poles inside the default 500 m radius**: `PLACES` × `POLES_PER_PLACE` merged into
 * same-kerb places, plus `SINGLETONS` standalone poles sitting further out.
 *
 * The clustering rules (ADR-042) decide the shape, so the fixture satisfies them
 * deliberately rather than by luck. Within a cluster:
 *  - members sit 12 m apart (inside the 30 m merge radius) and **share a landmark name**, so
 *    they are candidate edges;
 *  - each pole is served by a **different** route, because `buildPlaces` vetoes a merge
 *    between two stops that share a route line or are consecutive on one;
 *  - every route runs due east to a far terminus, so all travel bearings agree and the
 *    bearing gate passes.
 * The singletons carry distinct landmark names, so they never merge with anything.
 *
 * `/v1/nearby` pulls `MAX_STOPS * 2 = 12` hits and groups them, so the 12 nearest poles (the
 * six places) are the ones served — the eight singletons behind them are the control group
 * that must cost **zero** upstream calls.
 */
export const PLACES = 6
export const POLES_PER_PLACE = 2
export const SINGLETONS = 8
export const SERVED_POLES = PLACES * POLES_PER_PLACE // 12
export const TOTAL_POLES = SERVED_POLES + SINGLETONS // 20

export const poles: Pole[] = []
const push = (rawId: string, offsetM: number, name: string, route: string) => {
  poles.push({
    rawId,
    id: `KMB:${rawId}`,
    lat: ORIGIN.lat + mLat(offsetM),
    lng: ORIGIN.lng,
    name,
    route,
    offsetM,
  })
}
// Clusters march north at 60 m intervals (well beyond the merge radius).
for (let c = 0; c < PLACES; c++) {
  for (let p = 0; p < POLES_PER_PLACE; p++) {
    push(`POLE${c}${p}`, 60 * c + 12 * p, `LANDMARK ${c} (X${c}${p})`, `R${c}${p}`)
  }
}
// Singletons start beyond the last cluster and stay inside the 500 m radius.
for (let s = 0; s < SINGLETONS; s++) push(`SOLO${s}`, 360 + 15 * s, `SOLO STOP ${s}`, `S${s}`)

/** Far-east terminus for every route — gives each pole a due-east travel bearing and sits
 *  outside the nearby radius so it never appears as a result. */
const TERMINUS = { rawId: 'TERMEAST', lat: ORIGIN.lat, lng: ORIGIN.lng + mLng(4000) }

/**
 * A GTFS frequency table for every fixture route, plus the service-day mask that resolves it.
 *
 * Present so the two **service fidelity tiers** are testable at all (ADR-065): without a frequency
 * table no route would have `service.patterns`, and "the stop endpoint omits `patterns`" would pass
 * vacuously. Two service ids on purpose — a weekday mask and a Sunday one — so the day-type
 * classification produces more than one profile.
 */
const FREQ = {
  WEEKDAY: { '0530': ['2330', '600'] as [string, string] },
  SUNDAY: { '0600': ['2300', '900'] as [string, string] },
}
const SERVICE_DAY_MAP = {
  WEEKDAY: ['0', '1', '1', '1', '1', '1', '0'],
  SUNDAY: ['1', '0', '0', '0', '0', '0', '0'],
}

/** The consolidated dataset (`data.hkbus.app/routeFareList.min.json`) shape, ADR-021. */
export function datasetJson(): unknown {
  const stopList: Record<string, unknown> = {
    [TERMINUS.rawId]: {
      location: { lat: TERMINUS.lat, lng: TERMINUS.lng },
      name: { en: 'EAST TERMINUS', zh: '東總站' },
    },
  }
  for (const s of poles) {
    stopList[s.rawId] = { location: { lat: s.lat, lng: s.lng }, name: { en: s.name, zh: s.name } }
  }
  const routeList: Record<string, unknown> = {}
  for (const s of poles) {
    routeList[`${s.route}+1+A+B`] = {
      co: ['kmb'],
      route: s.route,
      serviceType: '1',
      bound: { kmb: 'O' },
      orig: { en: s.name, zh: s.name },
      dest: { en: 'EAST TERMINUS', zh: '東總站' },
      stops: { kmb: [s.rawId, TERMINUS.rawId] },
      fares: ['5.8', null],
      freq: FREQ,
    }
  }
  return { routeList, stopList, serviceDayMap: SERVICE_DAY_MAP }
}

/** A KMB `stop-eta` board for one pole: the routes at that pole, two arrivals each. */
export function kmbStopEtaJson(rawId: string): unknown {
  const route = poles.find((s) => s.rawId === rawId)?.route ?? 'R00'
  const now = new Date('2026-07-27T12:00:00+08:00')
  const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
  return {
    generated_timestamp: now.toISOString(),
    data: [1, 2].map((n) => ({
      co: 'KMB',
      route,
      dir: 'O',
      service_type: 1,
      seq: 1,
      dest_en: 'EAST TERMINUS',
      dest_tc: '東總站',
      dest_sc: '东总站',
      eta_seq: n,
      eta: at(n * 4),
      // A real remark, not the empty strings this fixture used to carry. `remarkKind` is served since
      // ADR-053 and is derived *from* the remark, so with no remark anywhere in the fixture the field
      // was absent from every response and the conformance suite could not see it — a served field
      // nothing exercises is the hole this suite exists to close. "Scheduled" is also the remark that
      // matters most: it means the reading is timetable-based rather than a tracked bus.
      rmk_en: 'Scheduled Bus',
      rmk_tc: '預定班次',
      rmk_sc: '预定班次',
      data_timestamp: now.toISOString(),
    })),
  }
}
