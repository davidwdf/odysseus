import type { LatLng, Locale } from './types'

// Distance / walk-time formatting for nearby stops. Straight-line distance is an
// approximation, so we never show fake precision (ADR-008 honesty applied to
// geography): metres are rounded to the nearest 10, and walk time to a whole minute.

// `@spec <module>#<export>` below means: that export's behaviour is pinned by the language-neutral
// JSON corpus at `../spec/<module>.spec.json`, group `<export>`. These are **domain rules** — the
// one kind of change no schema can generate (ADR-052 context, kind 2), so they are hand-ported to
// Swift and Kotlin and the corpus is the only thing keeping the ports equal. Change a rule and you
// edit the corpus; every platform's suite then goes red until it has been ported.
// `scripts/check-spec-coverage.mjs` fails a tagged export with no corpus **and** a corpus with no tag.

/** Mean Earth radius, metres (WGS84 authalic). */
const EARTH_R = 6_371_008.8

/** Great-circle (haversine) distance between two WGS84 points, in metres. A
 *  straight-line approximation — never presented with fake precision (ADR-008).
 *
 * @spec geo#haversineMeters
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total straight-line length of a path through ordered points — the sum of great-circle hops
 *  between consecutive points. Used as an APPROXIMATE bus-route distance from its stop
 *  coordinates: HK open data carries no route polylines, so this under-counts the real road
 *  distance (a bus follows curving roads, not straight hops) and is only ever shown as an
 *  explicit estimate (ADR-008 / ADR-044). Returns 0 for fewer than two points.
 *
 * @spec geo#routeDistanceM
 */
export function routeDistanceM(points: LatLng[]): number {
  let total = 0
  let prev: LatLng | undefined
  for (const p of points) {
    if (prev) total += haversineMeters(prev, p)
    prev = p
  }
  return total
}

/** Average pedestrian pace, metres per minute (~4.8 km/h). */
const WALK_M_PER_MIN = 80

/**
 * Estimated walking minutes for a straight-line distance. Floor of 1 min.
 *
 * @spec geo#walkMinutes
 */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.round(distanceM / WALK_M_PER_MIN))
}

/** Human distance: rounded metres under 1 km, else one-decimal km. Unit symbols
 *  (`m` / `km`) are locale-neutral, so this needs no locale. No space before the unit
 *  ("200m", "1.2km") — reads tighter for a glanceable distance label.
 *
 * @spec geo#formatDistance
 */
export function formatDistance(distanceM: number): string {
  // The unit is chosen from the ROUNDED metres, but the km figure is computed from the raw
  // distance. Both halves matter and they are easy to conflate:
  //  · choosing from the raw distance sent 995–999 m down the metres path, where rounding to the
  //    nearest 10 then produced "1000m" — about one reading in 200, sitting next to a neighbouring
  //    stop's "1.0km" and reading as a different kind of number;
  //  · but formatting the km figure from the rounded value too would drag 1049 m up to "1.1km",
  //    because 1049 rounds to 1050. The corpus pins both ends, which is how that was caught.
  const rounded = Math.round(distanceM / 10) * 10
  if (rounded < 1000) return `${rounded}m`
  return `${(distanceM / 1000).toFixed(1)}km`
}

const WALK_LABEL: Record<Locale, string> = {
  en: 'min walk',
  'zh-Hant': '分鐘路程',
  'zh-Hans': '分钟路程',
}

const WALK_HOURS_LABEL: Record<Locale, string> = {
  en: 'hr walk',
  'zh-Hant': '小時路程',
  'zh-Hans': '小时路程',
}

/**
 * Where minutes stop being readable and become hours.
 *
 * An hour is the boundary because that is where the *unit* stops helping: "45 min walk" is a decision a
 * rider can make and "270 min walk" is arithmetic they have to do. It came out of a real screen — a
 * location fix outside Hong Kong put "270 min walk" under a place name, which is honest and useless.
 *
 * These readings are all degenerate by construction: nobody walks an hour to a bus stop, and every walk
 * the app shows for a place a rider is actually at is under ten minutes. Which is the argument for
 * formatting them *well* rather than for capping them — a capped value invents a claim ("more than an
 * hour away" is not what we measured), while a badly-scaled one merely reads as a bug in the app.
 */
const WALK_HOURS_FROM_MIN = 60

/**
 * The figure for a walk in hours: one decimal, with a bare `.0` dropped.
 *
 * `4.5`, not `4 hr 30 min` — one number a rider can compare against another, which is the same reason
 * `formatDistance` says "1.2km" rather than "1 km 200 m". `.replace()` rather than a conditional because
 * the two cases ("4.5", "4") differ only in whether the tenth is zero.
 */
function walkHours(minutes: number): string {
  return (minutes / 60).toFixed(1).replace(/\.0$/, '')
}

/**
 * Localized walk estimate, e.g. "2 min walk" / "2 分鐘路程" — and "4.5 hr walk" past an hour.
 *
 * @spec geo#formatWalk
 */
export function formatWalk(distanceM: number, locale: Locale): string {
  const minutes = walkMinutes(distanceM)
  return minutes < WALK_HOURS_FROM_MIN
    ? `${minutes} ${WALK_LABEL[locale]}`
    : `${walkHours(minutes)} ${WALK_HOURS_LABEL[locale]}`
}

/** 8-point compass labels (N, NE, E, … NW) as localized "-bound" directions. The cue that
 *  tells two same-named places apart — the NE vs SW kerb of one landmark (ADR-042). */
const COMPASS_LABELS: Record<Locale, readonly string[]> = {
  en: [
    'Northbound',
    'Northeast-bound',
    'Eastbound',
    'Southeast-bound',
    'Southbound',
    'Southwest-bound',
    'Westbound',
    'Northwest-bound',
  ],
  'zh-Hant': ['北行', '東北行', '東行', '東南行', '南行', '西南行', '西行', '西北行'],
  'zh-Hans': ['北行', '东北行', '东行', '东南行', '南行', '西南行', '西行', '西北行'],
}

/**
 * Which of the 8 compass points a travel bearing snaps to, `0`–`7` clockwise from North.
 *
 * One rule, two consumers, and they *must* agree: `formatBearing` turns it into a word and every
 * renderer's compass needle turns it into a rotation. `apps/mobile/components/BearingArrow.tsx` had
 * its own `Math.round(bearingDeg / 45) * 45`, which happens to land on the same octant for every real
 * bearing — but it omits the range normalisation, so the two would part company the day the dataset
 * produced a negative or >360° value, and a needle pointing somewhere the label does not name is worse
 * than either being wrong alone (ADR-042: the direction is the cue that tells two same-named places
 * apart). Porting the screen to a second renderer would have made it a third copy.
 *
 * @spec geo#bearingOctant
 */
export function bearingOctant(deg: number): number {
  // `% 8` after rounding, because 337.5°–360° rounds up to 8 and wraps to North.
  return Math.round((((deg % 360) + 360) % 360) / 45) % 8
}

/** The rotation, in degrees clockwise from North, for a compass needle at this bearing — the octant
 *  above expressed the way a renderer applies it. Derived rather than restated so the needle and the
 *  label cannot disagree. */
export function bearingOctantDeg(deg: number): number {
  return bearingOctant(deg) * 45
}

/**
 * Initial great-circle bearing from `a` to `b`, degrees clockwise from North (0–360).
 *
 * **Every other bearing in this repo is a *travel* bearing that arrives precomputed** — `Stop`
 * carries `bearingDeg`, and `bearingOctant`/`formatBearing`/`BearingArrow` only ever *consume* it.
 * The arithmetic that produces one lived in exactly one place, `buildPlaces`' private `bearingDeg`
 * in `@nextbus/data-normalize`, where no rule the app runs could reach it. `poleSideOctants`
 * (`stop-detail.ts`) needs a bearing at *render* time, so the choice was to move this here or to
 * write it a second time — and a bearing written twice is the drift ADR-060 exists to catch, with
 * the added trap that the sign conventions are easy to get subtly right on one copy and wrong on
 * the other. The pipeline now calls this one, and the corpus pins both callers at once.
 *
 * The expression is transcribed **exactly** as the pipeline had it, `(deg * Math.PI) / 180` and all,
 * rather than reassociated to match `haversineMeters`' `deg * toRad`. Floating-point multiplication
 * is not associative, so reordering could move a last bit — and a last bit here can move a cluster
 * across `BEARING_SPREAD_CAP_DEG` and change which poles merge into a place, which would rebuild
 * the dataset under a new hash for no reason anybody could see. Verified bit-identical
 * (`Object.is`) against the pipeline's own implementation over 18 430 real coordinate pairs from
 * the shipped build before the pipeline was switched over.
 *
 * @spec geo#initialBearingDeg
 */
export function initialBearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Localized 8-point compass direction for a travel bearing (deg, any range), e.g.
 *  "Northeast-bound" / "東北行". Snaps to the nearest octant.
 *
 * @spec geo#formatBearing
 */
export function formatBearing(deg: number, locale: Locale): string {
  const labels = COMPASS_LABELS[locale] ?? COMPASS_LABELS.en
  return labels[bearingOctant(deg)] ?? ''
}

/** Localized walk estimate across a *range* of distances (a multi-pole place — ADR-042):
 *  "4–6 min walk" when the poles differ in walking minutes, else a single "4 min walk"
 *  (never "4–4"). Order-independent.
 *
 * @spec geo#formatWalkRange
 */
export function formatWalkRange(
  minDistanceM: number,
  maxDistanceM: number,
  locale: Locale,
): string {
  const lo = walkMinutes(Math.min(minDistanceM, maxDistanceM))
  const hi = walkMinutes(Math.max(minDistanceM, maxDistanceM))
  // **One unit for both ends, chosen by the larger.** A range that switched units mid-way — "45–1.5" —
  // would be unreadable, and a rider comparing the two ends of a range is comparing numbers. The far end
  // decides, because it is the one that needed hours. The case this makes ugly ("0.8–1.5 hr" for kerbs
  // 45 and 90 minutes apart) cannot arise from a real place: a place's kerbs are metres apart.
  const hours = hi >= WALK_HOURS_FROM_MIN
  const label = hours ? WALK_HOURS_LABEL[locale] : WALK_LABEL[locale]
  const figure = (minutes: number) => (hours ? walkHours(minutes) : String(minutes))
  const low = figure(lo)
  const high = figure(hi)
  // **The never-"4–4" rule compares the printed figures, not the minutes**, and the difference is not
  // cosmetic — it is a bug the hours path introduced and a corpus row caught. Two minute values that differ
  // (270 and 271) round to the same tenth of an hour, so comparing minutes said "these are a range" while
  // the figures said "4.5–4.5". On the minutes path the two comparisons are identical, which is why this
  // was invisible until there was a second unit.
  return low === high ? `${low} ${label}` : `${low}–${high} ${label}`
}
