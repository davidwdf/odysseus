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

import { dedupeEtas } from './eta'
import { formatFavoriteRouteKey, parseFavoriteRouteKey } from './ids'
import { type StopCardOptions, type StopCardView, stopCardView } from './stop-card'
import type { Eta, StopDetail } from './types'

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
    const etas: Eta[] = dedupeEtas(
      detail.routes
        .filter((route) => savedKeys.has(formatFavoriteRouteKey(route.stopId, route.route.id)))
        // `/v1/stop`'s readings do not carry a destination — only the canonical route does — so it is
        // stamped on here. Without it the card's row falls back to the remark and prints
        // "→ Scheduled Bus" where every other surface prints the destination.
        .map((route): Eta | null =>
          route.eta
            ? { ...route.eta, destination: route.eta.destination ?? route.route.destination }
            : null,
        )
        .filter((eta): eta is Eta => eta !== null),
    ).sort((a, b) => (a.arrivals[0] ?? '').localeCompare(b.arrivals[0] ?? ''))

    return stopCardView({ stop: detail.stop, etas }, opts)
  })
}
