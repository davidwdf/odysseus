import type { SearchIndex } from '@nextbus/core'
import {
  allGeoCells,
  type BuildManifest,
  buildObjects,
  cellsForRadius,
  datasetKeys,
  fetchConsolidatedIndex,
  type GeoEntry,
  type PlaceDoc,
  placeDocFor,
  type RouteDoc,
  routeDocFor,
  type StaticIndex,
} from '@nextbus/data-normalize'
import type { Env } from './env'
import { buildSearchIndex } from './search-index'

/**
 * The dataset seam (WP0-1 / ADR-055).
 *
 * Every endpoint reads its data through `DatasetSource`, which has two implementations:
 *
 *  - **`kvSource`** — production. Reads precomputed, content-addressed shards written by the
 *    daily GitHub Action. A request costs a handful of KV point reads; the 8.3 MB dataset is
 *    never fetched, never parsed and never held in the isolate.
 *  - **`inlineSource`** — the fallback. Builds the whole `StaticIndex` in-isolate exactly as
 *    the Worker used to. It exists so `pnpm dev:edge` works against no remote state, and so a
 *    catastrophically empty KV namespace degrades to "slow" rather than "down".
 *
 * The fallback is the thing WP0-1 exists to eliminate from the request path, so it is
 * **counted**: `datasetBuildsThisIsolate` on `/v1/health` is the number of times this isolate
 * built the index, and CI asserts it stays 0 across a full endpoint sweep. That counter, not a
 * code review, is what stops the slow path quietly coming back.
 *
 * Both implementations return the same document shapes from `@nextbus/data-normalize/shards`,
 * so there is one downstream code path and the dev fallback genuinely exercises production's.
 */
export interface DatasetSource {
  /** Where the data came from — surfaced on `/v1/health`. */
  readonly origin: 'kv' | 'inline'
  /** Content hash of the build being served, or `null` for the inline fallback. */
  readonly buildHash: string | null
  /** A place, a member pole, or a standalone stop — one document either way. */
  place(id: string): Promise<PlaceDoc | null>
  route(id: string): Promise<RouteDoc | null>
  /** Candidate places whose cells overlap the radius (unfiltered; the caller ranks). */
  cells(lat: number, lng: number, radiusM: number): Promise<GeoEntry[]>
  searchIndex(): Promise<SearchIndex>
}

// ── The counter WP0-1 is judged on ───────────────────────────────────────────────────────

let datasetBuildsThisIsolate = 0

export function datasetBuildCount(): number {
  return datasetBuildsThisIsolate
}

/** Test seam — drops every piece of isolate state: the counter, the memoized inline index and
 *  the cached `build:current` pointer (a spec that flips the pointer must see the flip). */
export function resetDatasetState(): void {
  datasetBuildsThisIsolate = 0
  inlineIndex = null
  cachedManifest = null
}

// ── Inline fallback ──────────────────────────────────────────────────────────────────────

let inlineIndex: Promise<StaticIndex> | null = null

function getInlineIndex(): Promise<StaticIndex> {
  if (!inlineIndex) {
    datasetBuildsThisIsolate++
    // Don't cache a rejected build — a transient upstream failure would otherwise poison the
    // isolate until it recycles. Clear it so the next request retries.
    inlineIndex = fetchConsolidatedIndex().catch((err) => {
      inlineIndex = null
      throw err
    })
  }
  return inlineIndex
}

export function inlineSource(): DatasetSource {
  return {
    origin: 'inline',
    buildHash: null,
    async place(id) {
      return placeDocFor(await getInlineIndex(), id)
    },
    async route(id) {
      return routeDocFor(await getInlineIndex(), id)
    },
    async cells(lat, lng, radiusM) {
      const index = await getInlineIndex()
      // Building every cell to answer one query is wasteful, but this path is the dev
      // fallback: the index is already memoized, and correctness-by-shared-code matters more
      // here than speed. Production reads four keys.
      const all = allGeoCells(index)
      return cellsForRadius(lat, lng, radiusM).flatMap((c) => all.get(c) ?? [])
    },
    async searchIndex() {
      return buildSearchIndex(await getInlineIndex())
    },
  }
}

// ── KV/R2 source ─────────────────────────────────────────────────────────────────────────

/**
 * How long an isolate trusts its cached `build:current` pointer. The dataset is republished
 * once a day, so a minute of staleness after a flip is irrelevant — and re-reading the pointer
 * on every request would double the KV traffic for no benefit. A rollback still takes effect
 * within a minute across the fleet, which is what makes "rollback is a one-key write" true.
 */
const MANIFEST_TTL_MS = 60_000

let cachedManifest: { at: number; value: Promise<BuildManifest | null> } | null = null

async function readManifest(env: Env): Promise<BuildManifest | null> {
  const now = Date.now()
  if (cachedManifest && now - cachedManifest.at < MANIFEST_TTL_MS) return cachedManifest.value
  const value = (env.DATASET as KVNamespace)
    .get(datasetKeys.current, 'json')
    .then((v) => (v as BuildManifest | null) ?? null)
    .catch((err) => {
      console.warn(`[dataset] build:current unreadable: ${(err as Error).message}`)
      return null
    })
  cachedManifest = { at: now, value }
  // **Never cache a null.** One transient KV blip would otherwise pin the whole isolate onto the
  // inline path for a full minute — an 8.3 MB fetch, a parse and ~20 MB of heap for every request
  // in that window, and `datasetBuildsThisIsolate` non-zero for the isolate's remaining life.
  // That is the exact failure WP0-1 exists to prevent, so the next request retries instead.
  void value.then((m) => {
    if (!m && cachedManifest?.value === value) cachedManifest = null
  })
  return value
}

function kvSource(env: Env, manifest: BuildManifest): DatasetSource {
  const kv = env.DATASET as KVNamespace
  const hash = manifest.hash
  // `cacheTtl` lets Cloudflare keep the value in the colo's KV cache, so a hot key is answered
  // locally instead of from the central store. Shard values are immutable for a build (the hash
  // is in the key), so this can be long without any staleness risk at all.
  const opts = { cacheTtl: 3600 } as const

  return {
    origin: 'kv',
    buildHash: hash,
    async place(id) {
      const direct = await kv.get<PlaceDoc>(datasetKeys.place(hash, id), { type: 'json', ...opts })
      if (direct) return direct
      // Miss. Two reasons that happens, and both resolve through the alias table:
      //  - `id` is a bare member pole (the common case — a route's stop list gives pole ids);
      //  - `id` is a **stale place id**. `P:` ids are `P:<memberId>+<memberId>`, so they change
      //    whenever clustering does, and riders have them persisted in favourites.
      // Try **every** member, not just the first: a retired pole at the head of a saved id must not
      // take the whole favourite down with it. (The id scheme itself is WP2-5's to fix properly;
      // this keeps already-saved favourites resolving in the meantime.)
      const seeds = id.startsWith('P:') ? id.slice(2).split('+').filter(Boolean) : [id]
      for (const seed of seeds) {
        const placeId = await kv.get(datasetKeys.alias(hash, seed), { type: 'text', ...opts })
        if (placeId) {
          const doc = await kv.get<PlaceDoc>(datasetKeys.place(hash, placeId), {
            type: 'json',
            ...opts,
          })
          if (doc) return doc
          continue
        }
        // A member that is no longer merged is a place of one, keyed by its own id.
        if (seed === id) continue
        const solo = await kv.get<PlaceDoc>(datasetKeys.place(hash, seed), {
          type: 'json',
          ...opts,
        })
        if (solo) return solo
      }
      return null
    },
    async route(id) {
      return kv.get<RouteDoc>(datasetKeys.route(hash, id), { type: 'json', ...opts })
    },
    async cells(lat, lng, radiusM) {
      const keys = cellsForRadius(lat, lng, radiusM)
      const buckets = await Promise.all(
        keys.map((c) => kv.get<GeoEntry[]>(datasetKeys.cell(hash, c), { type: 'json', ...opts })),
      )
      return buckets.flatMap((b) => b ?? [])
    },
    async searchIndex() {
      const obj = await (env.BUILDS as R2Bucket).get(buildObjects.searchIndex(hash))
      // A populated KV with an empty R2 (a fresh bucket, a `--local` publish against different
      // Miniflare state) would otherwise take out on-device search and the smart keypad while every
      // other endpoint looked healthy. Degrade to slow, as the rest of this module promises.
      if (!obj) {
        console.warn(`[dataset] search index missing for build ${hash} — falling back inline`)
        return inlineSource().searchIndex()
      }
      return obj.json<SearchIndex>()
    },
  }
}

/**
 * Pick the source for this request. KV wins whenever the bindings exist **and** `build:current`
 * points at a complete build; anything else falls back and gets counted.
 */
export async function getDataset(env: Env): Promise<DatasetSource> {
  if (!env.DATASET || !env.BUILDS) return inlineSource()
  const manifest = await readManifest(env)
  if (!manifest?.hash) return inlineSource()
  return kvSource(env, manifest)
}
