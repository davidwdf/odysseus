// Two writers, one blob: the regression suite for `docs/07`'s highest-severity defect (WP6-8a).
//
// WHAT WAS WRONG. `nextbus.preferences` is one `localStorage` key on one origin, and this app is not its
// only writer: a second tab of it is, the Expo PWA it replaces is (ADR-082 decision 5), and a tab restored
// from the back/forward cache is a writer whose memory is hours stale. zustand's `persist` reads the blob
// once, at load, and writes `partialize`'s output as the **whole** blob — so the second writer did not
// merely fail to see the first's change, its next write *deleted* it. `docs/07`'s reproduction is three
// steps: open `/settings` in two tabs, change the language in the first, star a route in the second,
// reload the first. The language is gone, and so is anything else the first tab had done.
//
// WHY THE TESTS ARE SHAPED LIKE THIS. Everything below drives the **real store** through its public API
// and treats `window.localStorage` as the wire between the two writers, because that is exactly what it
// is. "The other tab" is a direct write to the key plus, where the case wants one, a `storage` event —
// and the cases that *omit* the event are the important ones: a frozen tab receives none, so a fix that
// lived only in a listener would leave the widest window open. Nothing here mocks the store, the storage
// or the merge; the only thing simulated is the second browsing context.
//
// The arithmetic of the merge is not asserted here. It is `@nextbus/core`'s `mergePreferences` /
// `mergeSavedKeys`, corpus-pinned in `spec/favourites.spec.json` so the RN store and a future Swift one
// resolve a conflict the same way (ADR-089's argument, applied to the second rule about this blob). What
// is asserted here is the wiring: that the store reaches for that rule at the right two moments.

import { formatFavoriteRouteKey, type Locale } from '@nextbus/core'
import type { Appearance } from '@nextbus/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptRemotePreferences,
  PREFERENCES_QUARANTINE_KEY,
  PREFERENCES_STORAGE_KEY,
  PREFERENCES_VERSION,
  usePreferences,
} from '../src/lib/preferences'

// Real Hong Kong ids — the same poles and routes `packages/core/spec/ids.spec.json` uses, because a
// synthetic `A:1` would not exercise the grammar a favourite key is actually made of.
const POLE_A = 'KMB:18492910339E23AA'
const POLE_B = 'CTB:002403'
const POLE_C = 'KMB:5BB4A5D9AAF9D5C1'
const ROUTE_6 = 'KMB:6:outbound:1'
const ROUTE_720 = 'CTB:720:inbound:1'

const FAV_A = formatFavoriteRouteKey(POLE_A, ROUTE_6)
const FAV_B = formatFavoriteRouteKey(POLE_B, ROUTE_720)
const FAV_C = formatFavoriteRouteKey(POLE_C, ROUTE_6)

interface Blob {
  appearance: Appearance
  localeOverride: Locale | null
  favoriteRoutes: string[]
  recentRoutes: string[]
  recentStops: string[]
}

const DEFAULTS: Blob = {
  appearance: 'auto',
  localeOverride: null,
  favoriteRoutes: [],
  recentRoutes: [],
  recentStops: [],
}

/** The envelope `persist` writes — `{"state":…,"version":…}` — which is what the other writer writes too. */
const envelope = (state: Partial<Blob>): string =>
  JSON.stringify({ state: { ...DEFAULTS, ...state }, version: PREFERENCES_VERSION })

/**
 * The other browsing context writes the blob.
 *
 * `notify: false` is the **frozen tab**, and it is not an edge case dressed up: a page in the back/forward
 * cache is not delivered `storage` events at all, and neither is one whose listener has not been reached
 * because the two writes landed in the same millisecond. Every case that omits the event is asserting that
 * this tab recovers without ever being told.
 */
function otherWriterSaves(state: Partial<Blob>, { notify = true } = {}): void {
  const oldValue = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
  const newValue = envelope(state)
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, newValue)
  if (!notify) return
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: PREFERENCES_STORAGE_KEY,
      oldValue,
      newValue,
      storageArea: window.localStorage,
    }),
  )
}

/** What is on disk now, unwrapped. */
function onDisk(): Blob {
  const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
  if (raw === null) throw new Error('nothing is on disk')
  return JSON.parse(raw).state as Blob
}

/** What this tab holds now, in the same shape. */
function inMemory(): Blob {
  const { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops } =
    usePreferences.getState()
  return { appearance, localeOverride, favoriteRoutes, recentRoutes, recentStops }
}

beforeEach(() => {
  window.localStorage.clear()
  // Writing the defaults through the store is what makes this tab's *ancestor* the defaults, which is the
  // state a freshly-loaded tab is in. Setting the store without writing would leave the merge measuring
  // against whatever the previous case left behind.
  usePreferences.setState({ ...DEFAULTS })
})

describe('the reproduction from docs/07, from the tab that writes second', () => {
  it('keeps the other tab’s language when this tab stars a route — with no event delivered', async () => {
    // **The defect, exactly.** This tab loaded before the other one changed the language, and it is not
    // told: no `storage` event is dispatched. Before the fix, `partialize` handed `persist` this tab's
    // whole stale blob and the language went back to following the browser. It is the widest window there
    // is, because it is the one a bfcached tab lives in.
    otherWriterSaves({ localeOverride: 'zh-Hant' }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    await Promise.resolve()

    expect(onDisk().localeOverride, 'the other tab’s language was overwritten').toBe('zh-Hant')
    expect(onDisk().favoriteRoutes).toEqual([FAV_A])
    // And this tab catches up rather than continuing to draw the old language.
    expect(inMemory().localeOverride).toBe('zh-Hant')
  })

  it('keeps this tab’s favourites when the other tab changes the appearance', () => {
    // The same defect with the two writers swapped, which is the half that costs a rider the data they
    // made by hand rather than a preference they can re-pick in two taps.
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)

    otherWriterSaves({ appearance: 'dark', favoriteRoutes: [FAV_A, FAV_B] })

    expect(inMemory().appearance).toBe('dark')
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_B])
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_B])
  })

  it('applies an un-star here and a star there in the same round', () => {
    // The case that decides the merge's shape. A set-union would resurrect `FAV_B`; "adopt whatever
    // arrived" would drop the other tab's `FAV_C`. Both writers moved, and the round has to keep both
    // decisions — which is only possible because the ancestor says which side changed what.
    usePreferences.setState({ favoriteRoutes: [FAV_A, FAV_B] })
    otherWriterSaves({ favoriteRoutes: [FAV_A, FAV_B, FAV_C] }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720) // un-star, here

    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])
  })
})

describe('a write in another tab reaches this one without a reload', () => {
  it('adopts a language chosen in the other tab', () => {
    otherWriterSaves({ localeOverride: 'zh-Hans' })
    expect(inMemory().localeOverride).toBe('zh-Hans')
  })

  it('adopts a route starred in the other tab, and an un-star too', () => {
    otherWriterSaves({ favoriteRoutes: [FAV_A, FAV_C] })
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_C])

    otherWriterSaves({ favoriteRoutes: [FAV_C] })
    expect(inMemory().favoriteRoutes).toEqual([FAV_C])
  })

  it('ignores a write under any other key', () => {
    // The query cache persists to this same origin under its own key (ADR-058), and `useScrollRestoration`
    // writes `sessionStorage` on every scroll. Waking the merge for either would be a re-render per event.
    usePreferences.setState({ appearance: 'dark' })
    window.localStorage.setItem('nextbus.query.v1', '{"junk":true}')
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'nextbus.query.v1',
        newValue: '{"junk":true}',
        storageArea: window.localStorage,
      }),
    )
    expect(inMemory().appearance).toBe('dark')
  })

  it('catches up when a frozen tab is restored, which no storage event announces', () => {
    // The widest window there is, and the only one a listener cannot cover: a page in the back/forward
    // cache is frozen and `storage` events are not queued for it, so a tab restored after an hour is
    // drawing preferences that changed fifty minutes ago. Its next write is already safe — the
    // read-modify-write sees to that — but what it *shows* is stale until something asks. `pageshow` with
    // `persisted` is that restore and nothing else.
    usePreferences.setState({ favoriteRoutes: [FAV_A] })
    otherWriterSaves({ appearance: 'dark', favoriteRoutes: [FAV_A, FAV_B] }, { notify: false })

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

    expect(inMemory().appearance).toBe('dark')
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_B])
  })

  it('ignores an ordinary navigation, which has nothing to catch up on', () => {
    // `pageshow` also fires on every normal load, where `persisted` is false and the store has just
    // hydrated from the very blob it would be re-reading. Merging there would be a wasted read on the
    // critical path of the first paint.
    usePreferences.setState({ appearance: 'light' })
    otherWriterSaves({ appearance: 'dark' }, { notify: false })
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    expect(inMemory().appearance).toBe('light')
  })

  it('does not let another app’s clear() empty a rider’s list', () => {
    // `key === null` is a `clear()`. Adopting it literally would delete a hand-curated list because some
    // other page on the origin tidied up after itself — the same loss this suite exists to stop, arriving
    // from the opposite direction. This tab keeps what it has and re-creates the blob on its next write.
    usePreferences.setState({ favoriteRoutes: [FAV_A] })
    window.localStorage.clear()
    window.dispatchEvent(
      new StorageEvent('storage', { key: null, storageArea: window.localStorage }),
    )

    expect(inMemory().favoriteRoutes).toEqual([FAV_A])
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])
  })
})

describe('the two writers settle instead of arguing', () => {
  it('writes nothing at all when the other tab’s blob says what this one already holds', () => {
    // The termination property. Each write fires a `storage` event in the other context, so a merge that
    // always wrote back would give two open tabs an infinite exchange. `mergePreferences` reports "nothing
    // to do" by returning this tab's own state by identity, and the store reads that as "do not write".
    usePreferences.setState({ appearance: 'dark', favoriteRoutes: [FAV_A] })
    const writes = vi.spyOn(Storage.prototype, 'setItem')

    otherWriterSaves({ appearance: 'dark', favoriteRoutes: [FAV_A] })

    // The one write is `otherWriterSaves`' own; the merge added none.
    expect(writes.mock.calls.filter((c) => c[0] === PREFERENCES_STORAGE_KEY)).toHaveLength(1)
    writes.mockRestore()
  })

  it('settles after one round when it does have something to say', async () => {
    // The other side of the same property. This tab is starring `FAV_C` while the other has, unseen,
    // starred `FAV_B`, so the merge produces something *neither* writer held: it has to be written, and
    // memory has to catch up with it. Two writes — the mutation and the one reconciliation — and then
    // nothing, which is what "settles after one round" has to mean if two open tabs are ever to go quiet.
    usePreferences.setState({ favoriteRoutes: [FAV_A] })
    otherWriterSaves({ favoriteRoutes: [FAV_A, FAV_B] }, { notify: false })

    const writes = vi.spyOn(Storage.prototype, 'setItem')
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    await Promise.resolve()

    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_B, FAV_C])
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_B, FAV_C])
    expect(writes.mock.calls.filter((c) => c[0] === PREFERENCES_STORAGE_KEY)).toHaveLength(2)

    // And a merge over the settled state finds nothing left to do.
    writes.mockClear()
    adoptRemotePreferences()
    expect(writes).not.toHaveBeenCalled()
    writes.mockRestore()
  })

  it('applies a deletion the other tab made, rather than arguing about it', () => {
    // The limitation this scheme accepts, pinned so it cannot be forgotten. Once this tab has written a
    // key, it is on disk — so a blob arriving *without* it says "the other writer deleted it", and this
    // tab agrees. A writer that produced such a blob from a stale copy (one that skipped its own
    // read-modify-write) would therefore take the key with it. Both stores do that read, which is what
    // makes the conclusion sound; the alternative — never trusting a deletion — is a favourite a rider
    // cannot remove while a second tab is open.
    usePreferences.setState({ favoriteRoutes: [FAV_A, FAV_B] })
    otherWriterSaves({ favoriteRoutes: [FAV_A] })
    expect(inMemory().favoriteRoutes).toEqual([FAV_A])
  })
})

// ── Two of this tab's own changes, before the first has been adopted (WP6-8b) ──────────────────
//
// `setItem` advances the ancestor synchronously but hands the merged state back to memory in a
// *microtask*, because `persist` is mid-write inside its own subscriber when it is called. A second
// mutation in the same task therefore starts from a `mine` that has not adopted the first merge, while
// the ancestor already has — so `mergeSavedKeys` measures a **forward** ancestor against a state that
// is missing the other writer's key, calls that a remote deletion, and drops one of the rider's own
// stars on the way past. The queued `setState` then writes the loss out.
//
// It only appears once the merge has something to merge (an unseen key on disk), which is precisely the
// bfcached-tab case this wiring exists for: the machinery that stops a rider losing a favourite was the
// thing losing it. No second tab is needed while it is happening — two taps in one frame will do.

describe('two of this tab’s own changes in one task', () => {
  /** Let every queued catch-up run, including any it queues in turn. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('keeps both stars when the other tab has an unseen favourite on disk', async () => {
    otherWriterSaves({ favoriteRoutes: [FAV_C] }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    await settle()

    expect(onDisk().favoriteRoutes, 'a star was lost from disk').toEqual([FAV_C, FAV_A, FAV_B])
    expect(inMemory().favoriteRoutes, 'a star was lost from memory').toEqual([FAV_C, FAV_A, FAV_B])
  })

  it('keeps both stars when there is nothing on disk to merge with', async () => {
    // The control. Without an unseen remote key the merge is a no-op and the same two taps were always
    // correct — which is why this went unnoticed, and why the case above has to name the remote key.
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    await settle()

    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_B])
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_B])
  })

  it('keeps a star made in the same task as another tab’s language change', async () => {
    // The RN twin's third case, kept here as the parity control rather than as a reproduction: this
    // listener is synchronous, so the star cannot land between an adoption's read and its `setState` — and
    // that is exactly the window `apps/mobile` had to buy with a write queue. If this file's `storage`
    // handler ever becomes deferred, this is the case that says what it costs.
    otherWriterSaves({ localeOverride: 'zh-Hant' })
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    await settle()

    expect(inMemory().favoriteRoutes).toEqual([FAV_A])
    expect(inMemory().localeOverride).toBe('zh-Hant')
    expect(onDisk().favoriteRoutes).toEqual([FAV_A])
    expect(onDisk().localeOverride).toBe('zh-Hant')
  })

  it('keeps an un-star made in the same task as a star', async () => {
    // A removal and an addition in one task, over an unseen remote key: the un-star must survive the
    // catch-up rather than being resurrected by the first write's own bytes, and the star must survive
    // the deletion arithmetic that the un-star puts into the same round.
    const FAV_D = formatFavoriteRouteKey(POLE_A, ROUTE_720)
    usePreferences.setState({ favoriteRoutes: [FAV_A, FAV_B] })
    otherWriterSaves({ favoriteRoutes: [FAV_A, FAV_B, FAV_C] }, { notify: false })

    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720) // un-star, here
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_720) // …and star, same task
    await settle()

    // `FAV_B` is gone because this tab removed it against an ancestor that held it; `FAV_C` — which the
    // other tab added and this one had never seen — is kept; `FAV_D` is the tap made second.
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C, FAV_D])
    expect(inMemory().favoriteRoutes).toEqual([FAV_A, FAV_C, FAV_D])
  })
})

describe('the blob stays the one the Expo PWA can read', () => {
  it('writes the same envelope, under the same key, at the same version', () => {
    // The merge changed *how* this store writes (a `PersistStorage` rather than `createJSONStorage`), and
    // the one thing that may not change with it is the bytes: `apps/mobile`'s AsyncStorage-on-web reads
    // this exact key and `persist` there parses this exact envelope. A renamed wrapper field would make the
    // other app hydrate as the defaults — which is to say, silently forget everything.
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string)
    expect(Object.keys(parsed).sort()).toEqual(['state', 'version'])
    expect(parsed.version).toBe(PREFERENCES_VERSION)
    expect(Object.keys(parsed.state).sort()).toEqual([
      'appearance',
      'favoriteRoutes',
      'localeOverride',
      'recentRoutes',
      'recentStops',
    ])
  })

  it('brings an older writer’s place-keyed favourites up to date before merging them', () => {
    // The other app may be an older build. Merging its v0 keys in raw would put back exactly the
    // place-keyed favourites ADR-062 spent a work package rebasing onto member poles — and they resolve to
    // nothing the day clustering is re-tuned, which is the bug that migration exists for.
    const placeKey = `P:${POLE_B}+${POLE_A}|${ROUTE_720}`
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ state: { ...DEFAULTS, favoriteRoutes: [placeKey] }, version: 0 }),
    )
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: PREFERENCES_STORAGE_KEY,
        storageArea: window.localStorage,
      }),
    )

    expect(inMemory().favoriteRoutes).toEqual([FAV_B, formatFavoriteRouteKey(POLE_A, ROUTE_720)])
  })

  it('survives a blob it cannot read at all', () => {
    // Storage is a file a rider can corrupt and a browser can truncate. Nothing here may throw: this runs
    // inside a `storage` handler and inside `persist`'s write, and an exception in either takes out a
    // preference change or an unrelated event listener rather than reporting anything.
    usePreferences.setState({ favoriteRoutes: [FAV_A] })
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, '{"state":')
    expect(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: PREFERENCES_STORAGE_KEY,
          storageArea: window.localStorage,
        }),
      )
    }).not.toThrow()
    expect(inMemory().favoriteRoutes).toEqual([FAV_A])
    // …and the next write repairs the file rather than leaving the rider's list unreachable.
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])
  })

  it('quarantines the bytes it cannot read before writing over them (ADR-149)', () => {
    // The comfort the old comment offered — "the next write merges over whatever is still there" — was
    // the defect: the next write's own read of the blob fails the same way, so it merges with nobody
    // and *replaces* what is still there. The unreadable bytes (another writer's list, truncated
    // mid-flush) now survive that repair verbatim, under a key nothing reads — the same rule the Expo
    // store applies at launch (ADR-143).
    const corrupt = '{"state":{"favoriteRoutes":["KMB:18492910339E23AA|KMB:6'
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, corrupt)
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    expect(window.localStorage.getItem(PREFERENCES_QUARANTINE_KEY)).toBe(corrupt)
    // The repair itself is unchanged: the main key holds this tab's state again.
    expect(onDisk().favoriteRoutes).toEqual([FAV_A])
  })
})

describe('the two ways the first fix could still lose a favourite (found by adversarial review)', () => {
  it('does not advance the ancestor past a write the disk refused', () => {
    // 🔴 **The blocker, and it needs no second tab and no second app.** `safeLocalStorage` swallows a
    // `QuotaExceededError` — Safari private browsing, or simply a full origin, which is reachable because
    // the TanStack query cache persists to this same origin through this same wrapper (ADR-058). The first
    // fix advanced `ancestor = merged` unconditionally, so a refused write left the ancestor naming bytes
    // the disk never took. The *next* merge then reads this tab's own addition as the other writer's
    // deletion — because that is what `base \ theirs` means — and erases it.
    //
    // Before the merge existed, a refused write only meant "not persisted". With it, an unconditional
    // ancestor advance turns a full disk into silent favourite loss.
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    expect(onDisk().favoriteRoutes).toEqual([FAV_C])

    // The disk stops accepting writes. Nothing else changes.
    //
    // Spied on `Storage.prototype`, not on `window.localStorage`: jsdom's `localStorage` is a proxy whose
    // own properties do not take an assignment, so a spy installed on the instance is silently a no-op and
    // the write goes through. The first draft of this test did that and "passed" the interesting assertion
    // by never reaching it — worth knowing before stubbing storage anywhere else in this repo.
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    refuse.mockRestore()

    // Memory is right either way — the swallowed throw was always meant to keep the screen working.
    expect(inMemory().favoriteRoutes).toEqual([FAV_C, FAV_A])
    // …and the disk is untouched, which is the honest outcome of a refused write.
    expect(onDisk().favoriteRoutes).toEqual([FAV_C])

    // The assertion that matters: the rider stars something else once the quota frees up, and **the
    // favourite that never reached the disk is still there**. With the ancestor advanced, this ends
    // `[FAV_C, FAV_B]` and `FAV_A` is gone.
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    expect(onDisk().favoriteRoutes).toEqual([FAV_C, FAV_A, FAV_B])
    expect(inMemory().favoriteRoutes).toEqual([FAV_C, FAV_A, FAV_B])
  })

  it('treats a blob with no saved-route list as unreadable rather than as an empty one', () => {
    // The more nearly-valid corruption was the destructive one. An *unparseable* blob is safe — `null`
    // reads as "nobody to merge with", asserted above — but a parseable envelope merely *missing*
    // `favoriteRoutes` used to be filled out to `[]`, which turns "this writer did not say" into "this
    // writer says none". Every key then looks like a remote deletion and the rider's whole list goes.
    usePreferences.getState().toggleFavoriteRoute(POLE_A, ROUTE_6)
    usePreferences.getState().toggleFavoriteRoute(POLE_C, ROUTE_6)
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C])

    // A writer puts a valid envelope on the key that simply does not mention the list.
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: { appearance: 'dark', localeOverride: null },
        version: PREFERENCES_VERSION,
      }),
    )
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: PREFERENCES_STORAGE_KEY,
        storageArea: window.localStorage,
      }),
    )

    expect(inMemory().favoriteRoutes, 'the list was read as a remote deletion').toEqual([
      FAV_A,
      FAV_C,
    ])
    // …and the next write puts the rider's list back rather than persisting the erasure.
    usePreferences.getState().toggleFavoriteRoute(POLE_B, ROUTE_720)
    expect(onDisk().favoriteRoutes).toEqual([FAV_A, FAV_C, FAV_B])
  })
})
