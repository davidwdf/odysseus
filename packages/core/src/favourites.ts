// The Favourites screen's rules: which poles it asks about, how a saved key survives a change of
// scheme, and what the cards it draws contain.
//
// They lived in `apps/mobile/app/(tabs)/favorites.tsx` and `apps/mobile/lib/preferences.ts` until WP6-4,
// where they were reachable only by rendering a React tree or by loading a zustand store — so nothing
// could assert them, and a second renderer could only re-implement them. Two of the three are unusual
// enough to be worth naming before the code:
//
//  · **The migration is a rule about a rider's own data.** Everything else in this repo can be got wrong
//    and fixed in the next release; a favourite is a thing a rider curated by hand, and dropping one is
//    silent and unrecoverable. So it is versioned, corpus-pinned, and shared — because the actual hazard
//    of two apps is not that they disagree about a *display*, it is that they stamp different versions on
//    one storage blob (ADR-082 decision 5).
//  · **Which poles to ask about is not the same question as what to show.** The screen needs the pole set
//    *before* it has any data, to fan its queries out; it needs the cards *after*. Two exports, because a
//    renderer that derived the first from the second would have to fetch before it could fetch.
//
// Nothing here reads a clock, a locale or a device: `now` and `locale` arrive as arguments, for the reason
// every rule in this package takes them that way.

import { etaReadout, formatHeadway, type RemarkView, remarkView } from './eta'
import { formatFavoriteRouteKey, parseFavoriteRouteKey, parseRouteId } from './ids'
import { CLIENT_POLICY_DEFAULTS } from './policy'
import {
  displayName,
  type StopCardOptions,
  type StopCardRow,
  type StopCardView,
  stopCardCaption,
} from './stop-card'
import type { StopDetailRoute } from './stop-detail'
import { titleCaseName } from './stop-name'
import type { Locale, StopDetail } from './types'

/**
 * The persisted favourite-key scheme's version. Bump it — and add a step to `migrateFavouriteKeys` —
 * when the *meaning* of a key already on disk changes.
 *
 * **It is shared rather than per app, and that is the load-bearing part.** `apps/mobile` and `apps/web`
 * both persist a rider's favourites, and once they share a storage key (WP6-4) the thing that must not
 * differ between them is the number they stamp the blob with: a store that wrote a *lower* version would
 * re-run a completed migration, and one that wrote a *higher* version would make the next step skip data
 * it has never seen. Neither fails loudly.
 *
 * `0 → 1` — favourite keys are re-based from the `P:` place id onto the member pole id (ADR-042/ADR-062).
 */
export const FAVOURITE_KEY_VERSION = 1

/**
 * Bring a rider's saved keys up to `FAVOURITE_KEY_VERSION`, from whatever version wrote them.
 *
 * ## v0 → v1: one key per member pole, in save order
 *
 * **Every member, not a guess at one.** A place-keyed favourite recorded "this route, at this merged
 * place" and simply does not say which kerb the rider meant. Picking a member would be a coin flip whose
 * losing side is an invisibly missing favourite; expanding to all of them is invisible in the other
 * direction, because the screen intersects the saved keys with the route-at-pole rows the place actually
 * reports, so a key for a pole that does not serve the route can never render. Over-expansion costs a
 * string; guessing costs the favourite.
 *
 * **A key we cannot parse is kept exactly as it is** — not deleted, and not moved to a quarantine list
 * that would become a second place to forget about. Today's grammar is deliberately narrower than
 * tomorrow's (a fifth operator ships and `OPERATOR_RE` widens), the render path already skips what it
 * cannot parse, and a key that starts parsing again later simply starts working again.
 *
 * **A blob from a *future* version is returned untouched** rather than reset to defaults: a scheme we
 * cannot read renders as nothing, which is recoverable by upgrading again; discarding it is not. Every
 * step must therefore be idempotent, because a caller re-stamps such a blob at *our* version and the
 * next step will meet data it has already been run against.
 *
 * @spec favourites#migrateFavouriteKeys
 */
export function migrateFavouriteKeys(
  saved: readonly unknown[],
  fromVersion: number,
): readonly unknown[] {
  // A non-number is treated as 0 rather than trusted: it costs one comparison, and the alternative
  // failure — a hand-edited or truncated blob skipping every step — is silent.
  const from = Number.isFinite(fromVersion) ? fromVersion : 0
  if (from >= FAVOURITE_KEY_VERSION) return saved
  return rebaseOntoPoles(saved)
}

function rebaseOntoPoles(entries: readonly unknown[]): readonly unknown[] {
  const out: unknown[] = []
  const seen = new Set<unknown>()
  const keep = (entry: unknown) => {
    if (seen.has(entry)) return // a place expansion can land on a key that is already saved
    seen.add(entry)
    out.push(entry)
  }
  for (const entry of entries) {
    const parsed = typeof entry === 'string' ? parseFavoriteRouteKey(entry) : null
    if (parsed?.stop.kind === 'place') {
      for (const member of parsed.stop.members) {
        keep(formatFavoriteRouteKey(member.id, parsed.routeId))
      }
    } else keep(entry)
  }
  return out
}

// ── One blob, more than one writer ─────────────────────────────────────────────────────────────
//
// The migration above answers *"how does a saved key survive a change of scheme"*. These two answer the
// question that turned out to be sitting next to it and was never asked: **what happens when two writers
// hold the same blob at once.**
//
// It is not hypothetical and it is not only about two apps. `nextbus.preferences` is one `localStorage`
// key on one origin, and every one of these is a second writer: a second *tab* of the PWA, the Expo PWA
// and `apps/web` on the same origin (ADR-082 decision 5), and a tab restored from the back/forward cache
// that missed every write made while it was frozen. zustand's `persist` writes `partialize`'s output as
// the **whole** blob, so a writer holding a stale copy in memory does not merely fail to see the other's
// change — its next write *deletes* it. A language change reverts a starred route; a starred route
// reverts a language change; and the data at stake is the only data in this app a rider made by hand.
//
// WHY THIS IS A KERNEL RULE AND NOT PLUMBING. The listener, the event and the storage API are each
// platform's own (ADR-069 decision 7: the rule is shared, the wiring is not). What must not differ
// between two writers of one blob is **the arithmetic of the merge** — exactly the argument that put
// `FAVOURITE_KEY_VERSION` and `bumpRecent` here (ADR-089). Two stores that resolved a conflict
// differently would converge on nothing, and would do it silently.
//
// THE THREE-WAY MERGE, AND WHY NEITHER OF THE TWO OBVIOUS RULES WORKS.
//
//  · **Last-writer-wins on the whole blob** — adopt whatever arrived — loses whatever this writer has
//    that the other has not seen yet, which on a restored tab is everything it did while frozen.
//  · **Set-union of the favourites** never loses an addition and therefore **can never express a
//    removal**: un-starring a route in one tab would be undone by the other tab's stale copy, so a
//    rider with two tabs open could not delete a favourite at all. That is a worse bug than the one
//    being fixed, and it is the reason `base` exists.
//
// So the merge is three-way, and the ancestor is the load-bearing argument. `base` is **this writer's own
// previous persisted state** — the value it held before the change it is now writing — which the caller
// always has, because `persist` writes on every mutation. Against that ancestor a removal and an addition
// are *not* symmetric and *are* distinguishable: `base \ mine` is what this writer deleted, `mine \ base`
// is what it added, and the same two differences read off `theirs` say what the other writer did. No
// clock, no tombstone, no vector clock, and no field that has to be added to the blob.
//
// THE ONE PRECONDITION, AND WHY IT IS THE CALLER'S TO KEEP. `base` and `theirs` have to be *consistent in
// time*: **`theirs` must be a snapshot of the blob taken after `base` was written.** Violated, the
// arithmetic is not approximate, it is inverted — a key this writer added a moment ago sits in `base` and
// is missing from the stale `theirs`, which is indistinguishable from the other writer having deleted it,
// so the merge erases the rider's own star. `mergeSavedKeys`' corpus carries that row
// (`an-ancestor-ahead-of-theirs-reads-an-addition-as-a-deletion`) because it is the shape of a real defect
// (WP6-8b: both stores lost a favourite to two taps in one task) and because the wrong fix is tempting —
// weakening the `base \ theirs` half would make a rider with two tabs open unable to delete anything, which
// is the bug `base` exists to avoid.
//
// **No signature can enforce it**, and that is worth stating rather than leaving as an omission. The
// precondition is about the *order two I/O operations happened in*, not about the values, so the only
// in-band way to detect a stale snapshot would be a per-writer counter or a tombstone **on the blob** — and
// the blob's envelope is fixed by a shipped app that already reads it (ADR-082 decision 5). So what the
// callers do instead is keep the read, the merge, the write and the adoption in one critical section, and
// advance the ancestor only *with* a write: on web that is free, because `localStorage` is synchronous;
// on AsyncStorage it takes a write queue. The rule is shared, the sequencing is each platform's — the
// third platform to call this must read this paragraph before it writes its own store.
//
// WHAT IT STILL CANNOT DO, stated rather than glossed:
//
//  · Two writers changing the **same** scalar before either has seen the other: one choice is discarded.
//    The rule is *local wins* (see below), so on disk the later write survives and the earlier tab
//    adopts it when the event lands. Somebody has to lose a coin flip they caused by making two
//    conflicting choices at once.
//  · A removal is only distinguishable **while the removing writer's `base` is intact**. A writer whose
//    write silently failed (Safari private browsing, a full quota — `docs/07`'s other open preferences
//    defect) advances its ancestor anyway, so the other writer's copy resurrects the key on its next
//    write. Recoverable by un-starring again; the fix belongs with the failed-write defect, not here.
//  · The recents are merged as **whole lists**, not per entry — see `mergePreferences`.

/**
 * The persisted preferences, exactly as they sit in the one blob both apps write.
 *
 * Generic over the appearance rather than naming it: `Appearance` is `@nextbus/ui`'s and the kernel may
 * not import it (ADR-051), which is the same shape `settingsView<A extends string>` already takes. Every
 * field is the store's own — this is a description of a blob on disk, not a new model.
 */
export interface StoredPreferences<A extends string> {
  appearance: A
  /** The manual UI-language override; `null` = follow the device, which is a value and not an absence. */
  localeOverride: Locale | null
  /** Favourited route-at-stop pairs, keyed by `formatFavoriteRouteKey(memberPoleId, routeId)`. */
  favoriteRoutes: string[]
  /** Recently-opened route ids from search, most-recent first. */
  recentRoutes: string[]
  /** Recently-opened stop/place ids from search, most-recent first. */
  recentStops: string[]
}

/**
 * Merge two writers' favourite lists against the ancestor they diverged from.
 *
 * **A key survives unless somebody deleted it.** `base` is what this writer held before its own change,
 * so a key in `base` that is missing from `mine` was un-starred *here*, and one missing from `theirs` was
 * un-starred *there* — either is a deletion and wins over the other side's stale retention. Everything
 * else is a union, so an addition on each side keeps both.
 *
 * **The order is `theirs` first, then this writer's own additions**, and it is chosen for convergence
 * rather than for looks: both writers append the *same* set to the *same* prefix, so two tabs that have
 * seen each other's writes hold byte-identical lists and neither has anything left to write back. An
 * order that put `mine` first would have each tab writing the list back in its own order forever.
 *
 * **`theirs` must have been read after `base` was written** — the precondition set out above. An ancestor
 * that has run ahead of the snapshot turns this writer's own addition into the other writer's deletion, and
 * no argument here can tell the two apart.
 *
 * The one thing it cannot see: a key deleted *and re-added* by the other writer between two rounds looks
 * exactly like a key it never touched. That needs a tombstone, and a tombstone is a field on a blob a
 * shipped app is already reading — the cost is one resurrected favourite in a race nobody can hit twice.
 *
 * @spec favourites#mergeSavedKeys
 */
export function mergeSavedKeys(
  base: readonly string[],
  mine: readonly string[],
  theirs: readonly string[],
): string[] {
  const inMine = new Set(mine)
  const inTheirs = new Set(theirs)
  const deleted = new Set<string>()
  for (const key of base) {
    if (!inMine.has(key) || !inTheirs.has(key)) deleted.add(key)
  }
  const out: string[] = []
  const kept = new Set<string>()
  for (const key of [...theirs, ...mine]) {
    if (deleted.has(key) || kept.has(key)) continue
    kept.add(key)
    out.push(key)
  }
  return out
}

/** Two lists holding the same strings in the same order. */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** The list-valued fields, so the sameness check below is one loop rather than three comparisons. */
const LIST_FIELDS = ['favoriteRoutes', 'recentRoutes', 'recentStops'] as const

function sameStored<A extends string>(a: StoredPreferences<A>, b: StoredPreferences<A>): boolean {
  return (
    a.appearance === b.appearance &&
    a.localeOverride === b.localeOverride &&
    LIST_FIELDS.every((field) => sameList(a[field], b[field]))
  )
}

/**
 * The whole blob, merged: what this writer should now hold, and write.
 *
 * `base` — the state this writer last **wrote** — `mine` — what it holds now, change included — and
 * `theirs` — what is on disk right now, read after that write (the precondition above). Two absences are
 * meaningful and neither is an error:
 *
 *  · `theirs === null` — nothing on disk, so there is nobody to merge with. Returns `mine` **by
 *    identity**, which is this file's existing convention for "the rule had nothing to do"
 *    (`migrateFavouriteKeys` does the same) and is what lets a caller skip a pointless write.
 *  · `base === null` — this writer has never persisted, so it cannot have deleted anything and its
 *    values are defaults rather than choices. Treating `mine` as its own ancestor says exactly that:
 *    every scalar falls to `theirs`, and nothing is subtracted from the union.
 *
 * **Scalars: local wins on a true conflict.** A field this writer has not touched since `base` takes the
 * other writer's value — that is the whole point, and it is what makes a language change in one tab
 * appear in the other. A field it *has* touched keeps its own, because at a write this is the rider's
 * finger a millisecond ago and at a remote event it is a change already on disk. The loser of a genuine
 * simultaneous conflict is the earlier choice, and it converges: the other writer adopts what it reads.
 *
 * **Recents are merged whole rather than per entry, and that is a decision.** They are an *ordered* MRU
 * list whose order is its meaning, and there is nothing in the blob to interleave two orders by — a union
 * would produce a history in an order neither writer ever saw, and it would break the cap
 * `bumpRecent` maintains. So the list follows the scalar rule, and the cost is a concurrent bump
 * discarded. A recent is regenerated by using the app; a favourite is not, which is why only one of the
 * two is merged element-wise.
 *
 * Returns `mine` by identity whenever the merge changes nothing, so a caller can write, and notify, only
 * when there is something to say.
 *
 * @spec favourites#mergePreferences
 */
export function mergePreferences<A extends string>(
  base: StoredPreferences<A> | null,
  mine: StoredPreferences<A>,
  theirs: StoredPreferences<A> | null,
): StoredPreferences<A> {
  if (theirs === null) return mine
  const ancestor = base ?? mine
  // **A writer that has never persisted cannot have deleted anything, so its LIST ancestor is empty**
  // (ADR-145). `base ?? mine` used to stand in for the list arms too, and it read this writer's own
  // unwritten addition as the other writer's deletion: `base = null`, `mine = [K]`, `theirs = [X]`
  // puts K in the ancestor and not in `theirs`, so `mergeSavedKeys` erased the star at the moment of
  // its own first write — in memory and on disk. The empty list is what a null `base` *means* for a
  // list: no write has happened, so nothing can have been removed since it, and the docblock's
  // "nothing is subtracted from the union" becomes arithmetically true instead of true only while
  // `mine`'s lists are still default-empty. The scalars keep `mine` as the stand-in — there is no
  // neutral scalar value, and falling to `theirs` is the approximation the docblock documents.
  const listAncestor = base ?? EMPTY_LIST_ANCESTOR
  const merged: StoredPreferences<A> = {
    appearance: mine.appearance === ancestor.appearance ? theirs.appearance : mine.appearance,
    localeOverride:
      mine.localeOverride === ancestor.localeOverride ? theirs.localeOverride : mine.localeOverride,
    favoriteRoutes: mergeSavedKeys(
      listAncestor.favoriteRoutes,
      mine.favoriteRoutes,
      theirs.favoriteRoutes,
    ),
    recentRoutes: [
      ...(sameList(mine.recentRoutes, listAncestor.recentRoutes) ? theirs : mine).recentRoutes,
    ],
    recentStops: [
      ...(sameList(mine.recentStops, listAncestor.recentStops) ? theirs : mine).recentStops,
    ],
  }
  return sameStored(merged, mine) ? mine : merged
}

/** What a null `base` means to the list arms: nothing written, so nothing possibly deleted. */
const EMPTY_LIST_ANCESTOR: Record<(typeof LIST_FIELDS)[number], readonly string[]> = {
  favoriteRoutes: [],
  recentRoutes: [],
  recentStops: [],
}

/**
 * The distinct boarding poles a rider has saved something at, in save order — one query each.
 *
 * **A key the grammar cannot read is skipped rather than guessed at.** The migration keeps it on disk in
 * case a later grammar can (ADR-059, ADR-062); what this must never do is resolve it to a pole the rider
 * did not save. So an empty result and an empty saved list are the same answer here, and the screen's
 * *empty* state is the same state for both — which is right: a list of keys none of which can be read is,
 * to a rider, a screen with nothing saved.
 *
 * **De-duplicated, because one query returns a whole place.** `getStop` promotes a member id to its
 * place, so two saved poles of one place would fetch the same document twice; the ordering is the save
 * order of the *first* key that named each pole, which is what makes the cards below stable as a rider
 * adds to the list.
 *
 * @spec favourites#favouritePoleIds
 */
export function favouritePoleIds(saved: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const key of saved) {
    const parsed = parseFavoriteRouteKey(key)
    if (!parsed || seen.has(parsed.stopId)) continue
    seen.add(parsed.stopId)
    out.push(parsed.stopId)
  }
  return out
}

/** What the Favourites screen is built from: the saved keys, and whatever places have resolved. */
export interface FavouritesInput {
  /** The saved `${memberPoleId}|${routeId}` keys, in save order — the store's list, verbatim. */
  saved: readonly string[]
  /**
   * The resolved places, in the order their queries were issued (`favouritePoleIds`' order). A pole
   * whose query has not resolved is simply absent, which is what makes this screen render incrementally
   * rather than all at once.
   */
  places: readonly StopDetail[]
}

/**
 * One card per saved **place**, in save order, each carrying that place's saved routes.
 *
 * ## Why a place rather than a pole
 *
 * Favourites key on the *member pole* (ADR-062) precisely so a clustering change cannot orphan them, and
 * that is the wrong unit to *draw*: a rider who saved two lines at two kerbs of one interchange saved two
 * things at one place, and two cards for it would read as two places. So the cards are grouped by the
 * place each saved pole resolves to — `getStop` promotes a member id to its place, so the grouping is the
 * wire's answer rather than this function's guess — and the first save order of any of its poles is where
 * the card sits.
 *
 * ## What each card contains, and the one thing it deliberately does not
 *
 * Only the rows the rider actually saved: `detail.routes` is every line at every kerb of the place, and it
 * is intersected with the saved keys **at the pole**, so opposite-kerb directions of one route number stay
 * distinct (ADR-042). No `routeCount` and no `distanceM` are passed: Favourites knows what the rider
 * saved, not what serves the place, and distance is irrelevant on a screen a rider opens from anywhere.
 * `stopCardView` handles both absences — the readings become the total, and the caption loses its distance
 * half.
 *
 * **The cap is `stopCardView`'s, and the sort is here.** The `.slice(0, 4)` that used to sit in the screen
 * was a third answer to a question the app answers once, and it was also a bug: the row count it passed on
 * was already truncated, so the "+N more" count computed `4 - 4` and a place with nine saved routes showed
 * four and said nothing about the rest.
 *
 * @spec favourites#favouritesView
 */
export function favouritesView(input: FavouritesInput, opts: StopCardOptions): StopCardView[] {
  const policy = opts.policy ?? CLIENT_POLICY_DEFAULTS
  const savedKeys = new Set(input.saved)
  const order: string[] = []
  const byPlace = new Map<string, StopDetail>()
  for (const detail of input.places) {
    const placeId = detail.stop.id
    if (byPlace.has(placeId)) continue
    byPlace.set(placeId, detail)
    order.push(placeId)
  }

  return order.map((placeId) => {
    // `order` is built from the keys of `byPlace`, so the entry exists; the `as` records that rather
    // than a `?? throw` arm no payload can reach — the shape the 100 % branch threshold refuses.
    const detail = byPlace.get(placeId) as StopDetail
    const saved = detail.routes.filter((route) =>
      savedKeys.has(formatFavoriteRouteKey(route.stopId, route.route.id)),
    )

    // **Two rows for one line saved at two kerbs, and no label naming them** (WP6-4b, closing WP5-12's
    // residual from the favourites side). The collapse this used to inherit from `soonestPerLine` is right
    // for a card *summarising a place* and wrong for a list the rider curated: starring a line at both
    // kerbs is an explicit choice, and one merged row hid the other kerb's bus entirely.
    //
    // Naming the kerbs was tried and **declined on a measurement**, which is the part worth keeping: across
    // five Hong Kong neighbourhoods, **not one** line published at two kerbs of a place had *distinct*
    // printed codes on them — and it could not, because a place's poles are clustered by sharing a name and
    // the code is part of the name (at Tin Shui Wai Park both TN510 poles print `TN510`, which is ADR-071's
    // own example). A label repeated on both rows claims a distinction it does not make, so there is none.
    // What a rider gets is both buses instead of one, and Place detail — which has room for ADR-080's
    // compass side, pole name and "check the sign" ladder — is one tap away.
    const rows = saved
      .map((route) => favouriteRow(route, opts.locale, opts.now, policy))
      // **Soonest first, and the ones with no reading last.** A rider opens this screen to find the next
      // bus, so a live arrival outranks a timetable and a timetable outranks a dash — and within the
      // readings, the sooner one. It is the card's own order because Favourites is the one surface whose
      // rows do not arrive pre-sorted from anywhere: the wire orders a *place's* rows, not a rider's list.
      .sort((a, b) => readoutRank(a) - readoutRank(b) || compareDue(a.due, b.due))
      .map(({ due: _due, ...row }) => row)

    const shown = rows.slice(0, policy.maxRows)
    return {
      stopId: detail.stop.id,
      name: displayName(detail.stop.name[opts.locale]),
      // No distance: Favourites knows what the rider saved, not where they are — and a screen opened
      // from anywhere has nothing to measure from. `stopCardCaption` drops that half of the caption.
      caption: stopCardCaption(undefined, detail.stop.bearingDeg, opts.locale),
      ...(detail.stop.bearingDeg === undefined ? {} : { bearingDeg: detail.stop.bearingDeg }),
      rows: shown,
      // The cap and its count in one pass, over the **saved** rows: the `.slice(0, 4)` that used to sit in
      // the screen passed on an already-truncated list, so the count computed `4 - 4` and a place with nine
      // saved routes showed four of them and said nothing about the rest.
      remaining: Math.max(0, rows.length - shown.length),
      // Presence, not length — the same argument `stopCardView` makes: a rider cannot act on the
      // difference between one refusing kerb and four (ADR-077).
      incomplete: (detail.failed ?? []).length > 0,
    }
  })
}

/** A row, plus the arrival it sorts on — stripped before it leaves `favouritesView`. */
type SortableRow = StopCardRow & { due?: string }

/**
 * Live reading, then published timetable, then the dashes. See the sort above.
 *
 * `departed` ranks with `none`, not with the readings (ADR-144): both render the dash — there is no
 * bus to catch either way — and the fall-through that used to give it rank 0 put an **empty or
 * departed board above a bus due in five minutes**, because its absent `due` compared before every
 * ISO string. Rank 0 is now exactly the kinds that carry a figure or "Due", which is what "soonest
 * first" was always about.
 */
function readoutRank(row: SortableRow): number {
  if (row.label.kind === 'due' || row.label.kind === 'mins') return 0
  if (row.label.kind === 'headway') return 1
  return 2
}

/**
 * Code-point order on the sort key — **not `localeCompare`**, which is banned in this package because
 * the host's ICU decides its answer (see the comparator note in `live.ts`). Arrivals are ISO-8601
 * with a fixed +08:00 offset, so lexical order is chronological.
 */
function compareDue(a: string | undefined, b: string | undefined): number {
  const x = a ?? ''
  const y = b ?? ''
  if (x < y) return -1
  if (x > y) return 1
  return 0
}

/**
 * One saved route as a card row — **whether or not a bus is due**, which is the whole of WP6-4b's first fix.
 *
 * The readout is the same three-way choice `PlaceRouteRow` has carried since WP6-3a: a live arrival, else
 * the timetable's own published frequency, else a dash. Before this, a route with no reading contributed
 * *nothing*, so a card could be a name with nothing under it — indistinguishable by eye from a favourite
 * key that no longer resolves, which is why WP5-11's favourites proof had to rest on a route with a live
 * arrival.
 */
function favouriteRow(
  route: StopDetailRoute,
  locale: StopCardOptions['locale'],
  now: number,
  policy: NonNullable<StopCardOptions['policy']>,
): SortableRow {
  // Blank collapses to absent, deliberately: upstream really does send an empty `en`, and every decision
  // here was a truthiness test in JSX before it was a rule (see `stopCardRow`).
  const destination = route.route.destination?.[locale] || undefined
  const remark: RemarkView | undefined = remarkView(
    route.eta?.remark,
    locale,
    route.eta?.remarkKind,
  )
  // The destination is title-cased; a remark standing in for one is not — a remark is already prose the
  // operator wrote for a rider to read, where a stop or route name arrives ALL-CAPS.
  const headline = destination === undefined ? remark?.text : titleCaseName(destination)
  const reading = route.eta ? etaReadout(route.eta, locale, now, policy) : undefined
  const headway = route.route.service?.headway
  return {
    routeId: route.route.id,
    operator: route.route.operator,
    routeNo: parseRouteId(route.route.id)?.routeNo ?? route.route.id,
    ...(headline === undefined ? {} : { headline }),
    // Its own line only when it is not already the headline — otherwise the same words print twice.
    ...(destination === undefined || remark === undefined ? {} : { remark }),
    ...(reading ?? {
      label:
        headway === undefined
          ? ({ kind: 'none' } as const)
          : ({ kind: 'headway', text: formatHeadway(headway, locale) } as const),
      urgency: 'none' as const,
      stale: false,
    }),
    ...(route.eta?.arrivals[0] === undefined ? {} : { due: route.eta.arrivals[0] }),
  }
}
