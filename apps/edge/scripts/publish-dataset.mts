/**
 * Publish a dataset build to KV + R2 (WP0-1 / ADR-055).
 *
 *   pnpm dataset:publish              # remote (needs CLOUDFLARE_API_TOKEN + ACCOUNT_ID)
 *   pnpm dataset:publish --local      # into the Miniflare state `wrangler dev` uses
 *   pnpm dataset:publish --force      # republish even if the upstream data is unchanged
 *
 * **The write order is the safety property, not an implementation detail.** Every shard key is
 * namespaced by the build hash, so writing them cannot disturb the build currently being served.
 * `build:current` — the single mutable key — is written **last**, and only if every shard write
 * succeeded. Consequences worth stating plainly:
 *
 *  - a crash halfway through leaves an unreachable orphan, never a half-served dataset;
 *  - a rollback is one key write (`build:current` back to a previous manifest);
 *  - readers never see a mixed build, because they resolve one hash for the whole request.
 *
 * Old builds are pruned *after* the flip, and the prune keeps an explicit allowlist — the build
 * just published and the one it replaced — so a rollback target always survives.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { buildObjects, datasetKeys } from '@nextbus/data-normalize'
import { buildDataset } from './build-dataset.mts'

/** Must match `[[r2_buckets]] bucket_name` in wrangler.toml. */
const BUCKET = 'nextbus-builds'

/**
 * How many superseded builds survive a prune.
 *
 * Not 1. An isolate can hold a stale `build:current` for up to `MANIFEST_TTL_MS` (60 s), and that
 * window is measured in *time*, not in flips — so two publishes in quick succession (a CI retry, a
 * manual re-run) would delete a build that isolates are still reading from. Two gives a second
 * flip's worth of slack and a rollback target either way.
 */
const KEEP_PRIOR = 2

/** Keys per `kv bulk delete` request; the bulk API caps at 10,000. */
const DELETE_CHUNK = 5_000

const args = new Set(process.argv.slice(2))
const local = args.has('--local')
const force = args.has('--force')
const scope = local ? ['--local'] : ['--remote']

function wrangler(argv: string[]): string {
  return execFileSync('npx', ['wrangler', ...argv], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  })
}

function kv(argv: string[]): string {
  return wrangler(['kv', ...argv, '--binding', 'DATASET', ...scope])
}

interface Manifest {
  hash: string
  sourceHash: string
}

/**
 * The manifest currently being served: `{manifest}` when we read one, `{absent: true}` when the
 * namespace genuinely has no pointer, `{unknown: true}` when we could not tell.
 *
 * The three-way answer matters. Collapsing "couldn't read it" into "there isn't one" would make a
 * transient wrangler failure look like a first-ever publish — and the prune would then treat the
 * build that was live seconds ago as superseded and delete all ~20k of its keys, taking out every
 * isolate still inside its 60 s pointer cache and destroying the rollback target at the same time.
 */
function currentManifest(): { manifest?: Manifest; absent?: true; unknown?: true } {
  let out: string
  try {
    out = kv(['key', 'get', datasetKeys.current])
  } catch {
    // wrangler exits non-zero for a missing key *and* for an auth/network failure. We can only
    // distinguish them by asking whether the namespace is reachable at all.
    try {
      kv(['key', 'list'])
      return { absent: true }
    } catch {
      return { unknown: true }
    }
  }
  try {
    return { manifest: JSON.parse(out) as Manifest }
  } catch {
    return { unknown: true }
  }
}

const current = currentManifest()
const previous = current.manifest ?? null
const built = await buildDataset()

if (!force && previous?.sourceHash === built.manifest.sourceHash) {
  // The upstream dataset barely changes on a quiet day. Skipping is not just a saving: KV writes
  // are the metered side of this design (~20k keys a build), so a no-op republish is pure cost.
  console.log(`= upstream unchanged (${built.manifest.sourceHash.slice(0, 12)}) — nothing to do`)
  console.log(`  pass --force to republish build ${built.manifest.hash} anyway`)
  process.exit(0)
}

console.log(`▸ publishing ${built.manifest.hash}${local ? ' (local)' : ''}`)

// 0 — record the new hash in the history BEFORE writing anything it names. `build:history` is
// never read by the Worker, only by this script, so writing it early is free — and it means a run
// that dies midway still leaves its partial key set prunable. Recording it afterwards would strand
// ~20k keys in the namespace with nothing that knows they exist.
const priorHistory: string[] = (() => {
  try {
    return JSON.parse(kv(['key', 'get', datasetKeys.history])) as string[]
  } catch {
    return []
  }
})()
kv([
  'key',
  'put',
  datasetKeys.history,
  JSON.stringify([...new Set([built.manifest.hash, ...priorHistory])]),
])

// 1 — shards. Hash-namespaced, so this is invisible to readers.
for (const file of built.kvFiles) {
  process.stdout.write(`  kv ${file.split('/').pop()} … `)
  kv(['bulk', 'put', file])
  console.log('ok')
}

// 2 — bulk objects.
for (const { key, file } of built.objects) {
  process.stdout.write(`  r2 ${key} … `)
  wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, ...scope])
  console.log('ok')
}

// 3 — the flip. Everything above has landed, so this is the moment the build becomes reachable.
process.stdout.write('  flip build:current … ')
kv(['key', 'put', built.pointer.key, built.pointer.value])
console.log('ok')

// 4 — prune superseded builds. Only after the flip: a failure here costs storage, never
// availability. Two rules make it safe:
//
//  * **What survives is an explicit allowlist** — the build just published and the one it
//    replaced — not "the newest N". KV has no per-key timestamp, so any ordering inferred from a
//    key listing would be lexicographic on a content hash (i.e. arbitrary) and could delete the
//    very build we'd roll back to.
//  * **What dies is read from the build's own `keys.json`**, never enumerated. `kv key list` pages
//    at 1,000 keys and a build is ~20k, so a listing-driven prune would leak most of every
//    superseded build forever while *looking* like it worked.
if (current.unknown) {
  // We could not establish what was live before the flip, so we cannot say which builds are
  // superseded. Skipping costs storage until the next run; guessing costs availability.
  console.log('  ! could not read the previous build:current — skipping the prune')
} else {
  // De-duplicated: a `--force` republish of unchanged data yields the same hash for both.
  const keep = [...new Set([built.manifest.hash, ...priorHistory.slice(0, KEEP_PRIOR)])]
  const doomed = priorHistory.filter((h) => !keep.includes(h))
  // Builds we meant to prune but couldn't must stay in the history, or they become permanently
  // invisible: never a prune candidate again, and their ~20k keys resident forever.
  const stranded: string[] = []

  for (const hash of doomed) {
    const listFile = `${built.dir}/prune-${hash}.json`
    try {
      wrangler([
        'r2',
        'object',
        'get',
        `${BUCKET}/${buildObjects.keys(hash)}`,
        '--file',
        listFile,
        ...scope,
      ])
    } catch {
      // No key list means we cannot delete this build precisely; leave it rather than guess.
      console.log(`  ! build ${hash} has no keys.json — leaving its keys in place`)
      stranded.push(hash)
      continue
    }
    const names = JSON.parse(readFileSync(listFile, 'utf8')) as string[]
    console.log(`  pruning ${hash} (${names.length} keys)`)
    // Chunked for the same reason the build chunks its writes: the bulk API caps a request at
    // 10,000 keys, and a build is roughly twice that.
    for (let i = 0; i < names.length; i += DELETE_CHUNK) {
      const part = `${built.dir}/prune-${hash}-${i}.json`
      writeFileSync(part, JSON.stringify(names.slice(i, i + DELETE_CHUNK)))
      kv(['bulk', 'delete', part, '--force'])
      rmSync(part)
    }
    rmSync(listFile)
    for (const key of [
      buildObjects.searchIndex(hash),
      buildObjects.keys(hash),
      buildObjects.manifest(hash),
    ]) {
      try {
        wrangler(['r2', 'object', 'delete', `${BUCKET}/${key}`, ...scope])
      } catch {
        // Storage only — an orphaned R2 object costs pennies and never affects a reader.
      }
    }
  }

  kv(['key', 'put', datasetKeys.history, JSON.stringify([...keep, ...stranded])])
}

const c = built.manifest.counts
console.log(
  `✓ live: ${built.manifest.hash} — ${c.places} places · ${c.routes} routes · ${c.cells} cells`,
)
console.log(`  verify: curl "$EDGE_URL/v1/health"  → datasetBuildsThisIsolate must stay 0`)
