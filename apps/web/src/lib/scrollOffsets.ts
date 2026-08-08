import { safeSessionStorage } from '../adapters/storage'

/**
 * Where a rider was in a scrolling element, per history entry — the store half of `useScrollRestoration`,
 * kept separate because none of it is React and all of it is worth testing on its own.
 *
 * **One blob rather than one key per entry.** A browsing session pushes as many history entries as it likes
 * and nothing ever prunes a store keyed by them, so a per-entry key would leave orphans behind for the life
 * of the tab. react-router's own `<ScrollRestoration>` keeps its window offsets in one blob for the same
 * reason, and `MAX_ENTRIES` bounds it: generous by two orders of magnitude for a rider, finite for a script.
 *
 * `sessionStorage`, so it dies with the tab — see `safeSessionStorage`.
 */
export const SCROLL_OFFSETS_STORAGE_KEY = 'nextbus.scrollOffsets.v1'

/** How many entries' offsets are kept. The oldest are dropped first. */
export const MAX_SCROLL_OFFSETS = 50

function readAll(): Record<string, number> {
  const raw = safeSessionStorage.getItem(SCROLL_OFFSETS_STORAGE_KEY)
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    // A truncated or hand-edited blob is the same as no blob — the same call `useSearchIndex` makes about
    // its cache. A scroll offset is never worth taking a screen down for.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, number>
  } catch {
    return {}
  }
}

/** The offset stored for a history entry, or `null` if there is none — or if what is there is not a number. */
export function readScrollOffset(key: string): number | null {
  const value = readAll()[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function writeScrollOffset(key: string, offset: number): void {
  const all = readAll()
  // Deleted before it is re-added so a rewritten key moves to the **end**: a JS object iterates its string
  // keys in insertion order, and that order is the only thing that makes the trim below drop the oldest
  // entry rather than an arbitrary one.
  delete all[key]
  all[key] = offset
  const keys = Object.keys(all)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_SCROLL_OFFSETS)))
    delete all[stale]
  safeSessionStorage.setItem(SCROLL_OFFSETS_STORAGE_KEY, JSON.stringify(all))
}
