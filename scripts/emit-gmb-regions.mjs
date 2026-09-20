#!/usr/bin/env node
// Emit `packages/data-normalize/src/gmb-regions.generated.ts` — the GMB `route_id` → region table.
// Run from the repo root: `pnpm gmb:regions:emit`.
//
// WHY THIS IS A COMMITTED TABLE RATHER THAN A FETCH
// A green minibus route number is only unique *within* a region (`HKI` / `KLN` / `NT`), so Search
// draws two identical `1` chips for two genuinely different routes — the follow-up ADR-047 left
// open and `docs/07` has carried since. The region that tells them apart is published, but only one
// route at a time: `data.etagmb.gov.hk` has no bulk route dump, so learning it costs **572 requests**
// (one per region+code pair). Three consequences decided the shape:
//
//  1. **The Worker cannot do it.** `apps/edge/src/dataset.ts`'s inline tier builds the same
//     `StaticIndex` in-isolate, and a Worker gets 50 subrequests. A region that existed only in the
//     KV tier would be a field that is present in production and absent in `pnpm dev:edge` — the
//     exact class of difference nobody notices until a rider reports it.
//  2. **The daily build should not depend on it either.** `pnpm dataset:build` already stakes itself
//     on one 8.3 MB upstream; staking it on 572 more requests to a second host multiplies the ways a
//     day's publish can fail, for a field that changes when the Transport Department gazettes a new
//     minibus route — a handful of times a year.
//  3. So the crawl is a **deliberate act**, its result is committed, and every tier reads the same
//     bytes. Same shape as `packages/ui/src/tokens.generated.ts`: generated, committed, reviewed.
//
// It is NOT drift-gated like `openapi.json` or the component specs, and that asymmetry is honest:
// those five artefacts are re-emitted from sources *in this repo*, so a gate can rebuild them
// offline and diff. This one's source is a government API, and a gate that reached for the network
// would make `pnpm test` fail when `data.etagmb.gov.hk` is down. Re-run it when a GMB route appears
// untagged; a route the table does not know is simply untagged, never wrongly tagged.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'packages/data-normalize/src/gmb-regions.generated.ts')

const BASE = 'https://data.etagmb.gov.hk'
// The host 403s an empty `User-Agent` — the same gotcha `packages/data-normalize/src/gmb.ts`
// documents for the Workers runtime. Node sends none by default either.
const HEADERS = { 'user-agent': 'NextBusHK/1.0 (+https://github.com/nextbus-hk)' }

/** Concurrent in-flight requests. Polite to a government host, and 572 of them still finish fast. */
const CONCURRENCY = 6
/** Attempts per request, with a widening pause. A single 5xx should not cost the whole crawl. */
const ATTEMPTS = 3

async function getJson(path) {
  let lastError
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json()
    } catch (err) {
      lastError = err
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error(`GMB ${path}: ${lastError?.message ?? lastError}`)
}

/** Run `task` over `items`, `CONCURRENCY` at a time, preserving nothing but the side effects. */
async function pooled(items, task) {
  const queue = [...items]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await task(next)
  })
  await Promise.all(workers)
}

const all = await getJson('/route')
/** `{ HKI: ['1', '1A', …], KLN: […], NT: […] }` — every public route code, by region. */
const byRegion = all?.data?.routes
if (!byRegion || typeof byRegion !== 'object') throw new Error('GMB /route: unexpected shape')

const pairs = Object.entries(byRegion).flatMap(([region, codes]) =>
  codes.map((code) => ({ region, code })),
)
console.log(
  `▸ ${pairs.length} region+code pairs · ${Object.entries(byRegion)
    .map(([r, c]) => `${r} ${c.length}`)
    .join(' · ')}`,
)

/** `route_id` (as a string, the shape `gtfsId` arrives in) → region. */
const regionByRouteId = new Map()
let conflicts = 0

await pooled(pairs, async ({ region, code }) => {
  // One code can carry several route_ids — "Normal Departure" and its special/peak variants are
  // separate ids under one number, and they all share the region, which is the only field we take.
  const detail = await getJson(`/route/${region}/${encodeURIComponent(code)}`)
  for (const route of detail?.data ?? []) {
    const id = String(route.route_id)
    // `route.region` rather than the `region` we asked under: the record's own answer is the one
    // the ETA feed agrees with, and a disagreement is worth counting rather than papering over.
    const found = route.region ?? region
    const existing = regionByRouteId.get(id)
    if (existing !== undefined && existing !== found) {
      conflicts++
      console.warn(`! route_id ${id} claims both ${existing} and ${found}`)
      continue
    }
    regionByRouteId.set(id, found)
  }
})

if (conflicts) throw new Error(`${conflicts} route_id(s) claimed two regions — table not written`)

const sorted = [...regionByRouteId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
const regions = [...new Set(sorted.map(([, r]) => r))].sort()

const body = `// GENERATED by \`pnpm gmb:regions:emit\` — do not edit by hand.
//
// Green minibus \`route_id\` → the region its public number is unique within. Emitted from
// \`data.etagmb.gov.hk\` (572 requests, so it is crawled deliberately and committed rather than
// fetched per build — see \`scripts/emit-gmb-regions.mjs\` for the three reasons), and joined onto a
// route by \`gtfsId\`, which the consolidated dataset carries for every GMB route-direction.
//
// A route_id absent here is **untagged, not mis-tagged**: \`region\` is optional the whole way to the
// wire, and a new minibus route simply shows no tag until this is re-run.
//
// ${sorted.length} routes · ${regions.join(' / ')} · emitted ${new Date().toISOString().slice(0, 10)}
//
// \`GmbRegion\` is imported rather than declared here **on purpose**: the three codes are a wire
// vocabulary, so \`packages/contract\` owns them (ADR-052), and the day the Transport Department mints
// a fourth this file stops compiling — which is the loud failure, and the one we want.

import type { GmbRegion } from '@nextbus/core'

export const GMB_REGION_BY_ROUTE_ID: Readonly<Record<string, GmbRegion>> = {
${sorted.map(([id, region]) => `  '${id}': '${region}',`).join('\n')}
}
`

writeFileSync(OUT, body)
console.log(`✓ ${sorted.length} route ids · ${regions.join(' / ')} → ${OUT}`)
