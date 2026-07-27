// Study: would segment-based name matching let GMB stops merge with franchised bus stops?
// Run from the repo root: `pnpm study:gmb-names`
// (it lives under apps/edge because that is where the @nextbus/* workspace deps resolve)
//
// Backlog item: docs/07 "GMB never merges with franchised buses". Recorded 2026-07-27 against the
// live consolidated dataset. This script is the *reproducible* half — it re-derives the pair-level
// numbers from scratch every run, so the argument in docs/07 can be re-checked (or falsified)
// against tomorrow's data rather than trusted from a table.
//
// THE PROBLEM. `buildPlaces` gates a merge on `namesMatch`, which compares only the **head**
// segment of a stop name — everything before the first comma or bracket. The three operators do
// not agree on what goes first:
//
//   GMB      "Tai Chung Kiu Road, outside Belair Gardens"  → head: taichungkiuroad   (the ROAD)
//   KMB      "BELAIR GARDEN (ST141)"                       → head: belairgarden      (the LANDMARK)
//   Citybus  "Belair Garden, Tai Chung Kiu Road"           → head: belairgarden      (the LANDMARK)
//
// So a GMB stand 29 m from a franchised pole is rejected before distance or bearing is even
// considered, and a rider standing at Belair Garden gets three cards for one place.
//
// THE CANDIDATE RULE, and why each part is there:
//   1. compare EVERY segment, not just the head        — GMB puts the landmark second
//   2. drop road-like segments before matching         — otherwise "Tai Chung Kiu Road" matches
//                                                        every stop along a road kilometres long,
//                                                        and the name gate stops being a gate
//   3. de-pluralise                                    — "Belair Garden**s**" vs "BELAIR GARDEN"
//   4. conflicting positional qualifiers = VETO        — GMB's own naming encodes the kerb:
//                                                        "outside X" and "opposite X" are, by
//                                                        construction, opposite sides of the road.
//                                                        Free signal we were throwing away.
//
// WHAT THIS SCRIPT DOES NOT MEASURE. The cluster-level effect needs `buildPlaces` re-run with the
// candidate rule, and `namesMatch` is module-private. Those figures were taken on 2026-07-27 by
// temporarily patching `packages/data-normalize/src/dataset.ts`; they are printed at the end as a
// recorded baseline, NOT as a live measurement. To reproduce: paste `candidateMatch` over
// `namesMatch`, rebuild the index, and count.
import { fetchConsolidatedIndex, haversineM, type IndexStop } from '@nextbus/data-normalize'

/** Must stay in sync with MERGE_RADIUS_M in packages/data-normalize/src/dataset.ts. */
const MERGE_RADIUS_M = 30

const norm = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()

// ── the rule as it ships today ──────────────────────────────────────────────────────────
const head = (s: string) => norm(s.split(/[,，(（]/)[0] ?? s)
function currentMatch(a: IndexStop, b: IndexStop): boolean {
  const ae = head(a.name.en)
  const be = head(b.name.en)
  if (ae && be && ae === be) return true
  const az = head(a.name['zh-Hant'])
  const bz = head(b.name['zh-Hant'])
  return Boolean(az && bz && az === bz)
}

// ── the candidate ───────────────────────────────────────────────────────────────────────
const ROADY_EN =
  /\b(road|street|st|avenue|ave|lane|path|drive|terrace|crescent|praya|highway|bypass|circuit|boulevard|way|rise|hill)\b/i
const ROADY_ZH = /(道|街|路|徑|里|坊|巷)$/
const QUALIFIER = /^(outside|opposite|near|adjacent to|in front of|beside|behind|before|after)\s+/i
const deplural = (s: string) => (s.length > 4 && s.endsWith('s') ? s.slice(0, -1) : s)

interface Seg {
  qualifier: string
  token: string
}
function segments(name: string, zh: boolean): Seg[] {
  return name
    .split(/[,，(（)）]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      qualifier: (QUALIFIER.exec(p)?.[1] ?? '').toLowerCase(),
      text: p.replace(QUALIFIER, ''),
    }))
    .filter((p) => !(zh ? ROADY_ZH.test(p.text) : ROADY_EN.test(p.text)))
    .map((p) => ({ qualifier: p.qualifier, token: deplural(norm(p.text)) }))
    .filter((p) => p.token.length >= 3)
}

type Verdict = { match: boolean; token?: string; qualifiers?: string; vetoed?: boolean }
function candidateMatch(a: IndexStop, b: IndexStop): Verdict {
  if (currentMatch(a, b)) return { match: true, token: head(a.name.en) }
  let vetoed = false
  for (const zh of [false, true]) {
    const A = segments(zh ? a.name['zh-Hant'] : a.name.en, zh)
    const B = segments(zh ? b.name['zh-Hant'] : b.name.en, zh)
    for (const x of A) {
      for (const y of B) {
        if (!x.token || x.token !== y.token) continue
        const q = `${x.qualifier || '-'}/${y.qualifier || '-'}`
        // "outside X" vs "opposite X" — the same landmark seen from two different kerbs.
        if (x.qualifier && y.qualifier && x.qualifier !== y.qualifier) {
          vetoed = true
          continue
        }
        return { match: true, token: x.token, qualifiers: q }
      }
    }
  }
  return { match: false, vetoed }
}

// ── enumerate every pair inside the merge radius ────────────────────────────────────────
const index = await fetchConsolidatedIndex()
const CELL = MERGE_RADIUS_M / 111_000
const grid = new Map<string, number[]>()
index.stops.forEach((s, i) => {
  const k = `${Math.round(s.lat / CELL)},${Math.round(s.lng / CELL)}`
  const bucket = grid.get(k)
  if (bucket) bucket.push(i)
  else grid.set(k, [i])
})

let inRange = 0
let matchToday = 0
const gained: Array<{ a: IndexStop; b: IndexStop; d: number; token: string; q: string }> = []
const vetoed: Array<{ a: IndexStop; b: IndexStop; d: number }> = []
index.stops.forEach((s, i) => {
  const ci = Math.round(s.lat / CELL)
  const cj = Math.round(s.lng / CELL)
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const j of grid.get(`${ci + di},${cj + dj}`) ?? []) {
        if (j <= i) continue
        const o = index.stops[j]
        if (!o) continue
        const d = haversineM(s.lat, s.lng, o.lat, o.lng)
        if (d > MERGE_RADIUS_M) continue
        inRange++
        const today = currentMatch(s, o)
        if (today) matchToday++
        const cand = candidateMatch(s, o)
        if (!today && cand.match) {
          gained.push({ a: s, b: o, d, token: cand.token ?? '', q: cand.qualifiers ?? '-/-' })
        }
        if (!today && !cand.match && cand.vetoed) vetoed.push({ a: s, b: o, d })
      }
    }
  }
})

const isGmbCross = (p: { a: IndexStop; b: IndexStop }) =>
  p.a.operator !== p.b.operator && (p.a.operator === 'GMB' || p.b.operator === 'GMB')

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`
console.log(`pairs within ${MERGE_RADIUS_M} m:            ${inRange}`)
console.log(`  name-match today (head only):  ${matchToday}`)
console.log(`  name-match with the candidate: ${matchToday + gained.length}  (+${gained.length})`)
console.log(
  `  of the gained: cross-operator  ${gained.filter((p) => p.a.operator !== p.b.operator).length}`,
)
console.log(`  of the gained: GMB↔franchised  ${gained.filter(isGmbCross).length}`)
console.log(`  rejected by the qualifier veto: ${vetoed.length}`)

console.log('\nsample gained (GMB↔franchised):')
for (const p of gained.filter(isGmbCross).slice(0, 6)) {
  console.log(`  ${p.d.toFixed(0)}m via "${p.token}" q=${p.q}`)
  console.log(`     ${p.a.operator} ${p.a.name.en}`)
  console.log(`     ${p.b.operator} ${p.b.name.en}`)
}
console.log('\nsample vetoed (same landmark, opposite kerbs):')
for (const p of vetoed.slice(0, 4)) {
  console.log(`  ${p.d.toFixed(0)}m  ${p.a.name.en}  ||  ${p.b.name.en}`)
}

// ── the cluster-level effect, recorded (see the header note) ────────────────────────────
console.log(`
── recorded 2026-07-27 by temporarily patching \`namesMatch\` (NOT measured by this run) ──
                              today      candidate
  places                       2,397        2,553
  stops absorbed into a place  6,351        7,017
  GMB poles inside a place       828        1,205   (17.4% → 25.3%)
  GMB-only / mixed places   324 / 119    250 / 556
  largest place                   11           11   ← unchanged
  places with confidence <40      14           14   ← unchanged

  Belair Garden merges: bearing spread 14°, confidence 81.
  The largest place and the low-confidence count holding still is the load-bearing result —
  it means the extra merges come from the name gate opening, not from the bearing gate or the
  linesShared / consecutivePairs vetoes weakening.`)

const gmbTotal = index.stops.filter((s) => s.operator === 'GMB').length
let gmbIn = 0
for (const p of index.places) gmbIn += p.members.filter((m) => m.operator === 'GMB').length
console.log(
  `\n  today, live: ${gmbIn}/${gmbTotal} GMB poles inside a place (${pct(gmbIn, gmbTotal)})`,
)
