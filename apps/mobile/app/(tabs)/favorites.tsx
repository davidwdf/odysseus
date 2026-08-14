import { favouritePoleIds, favouritesView, newestPlaceBoard } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQueries } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FeedNotice, feedNotice } from '../../components/FeedNotice'
import { Skeleton } from '../../components/Skeleton'
import { StopRow } from '../../components/StopRow'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { usePreferences } from '../../lib/preferences'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useClientPolicy } from '../../lib/useClientPolicy'
import { useOnline } from '../../lib/useOnline'
import { useLocale } from '../../providers/LocaleProvider'

export default function Favorites() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const router = useRouter()
  const { policy } = useClientPolicy()
  // ADR-042/ADR-062: favourites key on the *member pole* id, never the churning `P:` place id.
  const saved = usePreferences((s) => s.favoriteRoutes)

  /**
   * **Which poles to ask about, and it is a rule** (WP6-4). The screen needs this list *before* it has any
   * data, so it cannot be derived from the cards below — hence two kernel exports rather than one. It also
   * decides two things a renderer should not: that a key the id grammar cannot read is **skipped rather
   * than guessed at** (the migration keeps it on disk in case a later grammar can — ADR-059/062), and that
   * two saved poles of one place are **one** query, because `getStop` promotes a member id to its place.
   */
  const poleIds = favouritePoleIds(saved)

  const results = useQueries({
    queries: poleIds.map((stopId) => ({
      queryKey: ['stop', stopId],
      queryFn: () => dataSource.getStop(stopId),
      // Served cadence (ADR-053). This screen fans out one query per saved pole, so it is the one that most
      // wanted a cadence matched to the edge's TTL rather than a faster guess.
      refetchInterval: policy.refreshAfterMs,
    })),
  })

  // `Date.now()` in the render body, and unlike Nearby and Place detail that is **correct here**: this
  // screen still fetches on `refetchInterval`, so it re-renders every cadence and the clock advances with
  // it. The two screens that took their clock out of `useLiveEtas` did so because a *subscription* replaced
  // their interval and nothing re-rendered them on a quiet stop (see that hook). Favourites keeps its
  // interval, so adding a second timer would buy nothing and cost a wake-up.
  const now = Date.now()

  /**
   * **The whole screen's content, in one call** (WP6-4). Three decisions used to live here as loose
   * expressions: grouping the resolved poles by their place while preserving save order, intersecting each
   * place's route rows with the saved keys *at the pole*, and assembling the readings — stamping the
   * destination the wire omits, de-duplicating per boarding point, sorting soonest-first and deliberately
   * **not** capping, because the cap is the served `maxRows` and `stopCardView` applies it together with
   * the "+N more" count. `apps/web` calls the identical function rather than re-deriving them from this JSX.
   */
  const places = results.flatMap((r) => (r.data ? [r.data] : []))
  const cards = favouritesView({ saved, places }, { locale, now, policy })

  /**
   * The screen's freshness notice (ADR-133, wired on this renderer by ADR-150).
   *
   * `newestPlaceBoard` takes the **whole list** rather than one document per query, which is the point of its
   * shape: this screen fans out one request per saved pole, and *"the newest board on this screen"* is a fact
   * about the screen rather than about whichever place resolved last.
   *
   * `trouble` fires when **any** query has errored, deliberately, on the one screen that has several: a rider
   * whose third saved pole is unreachable is looking at an incomplete list, and the cards that did arrive
   * cannot say so for it.
   */
  const online = useOnline()
  const notice = feedNotice({
    lastUpdatedIso: newestPlaceBoard(places),
    now,
    online,
    trouble: results.some((r) => r.isError) ? 'unreachable' : 'none',
    staleAfterMs: policy.staleAfterMs,
  })

  // **A screen with saved favourites and nothing to show is one of three states, not one** — and until
  // WP6-4b it collapsed them: `loading` was the only guard, so once every query had *failed* the screen
  // rendered its heading and an empty list, which is the same blank-screen hole WP6-3b found on Place detail
  // through a different door. A rider could not tell "still fetching" from "we could not reach any of them".
  //
  // **And WP6-4b named the hazard while still branching on `isLoading`, which does not guard it** (ADR-124).
  // `isLoading` is `isPending && isFetching`, so it is false for a fetch TanStack has **parked** — offline
  // under `networkMode` before that ADR set it to `'always'`, and *still* between retries while the document
  // is hidden, because `retryer.canContinue()` ANDs `focusManager.isFocused()`. With every query parked there
  // was nothing loading, nothing failed and no cards, so the screen fell through to the list arm and drew
  // **its heading and nothing else**: the third state's own `mustNot`, reached through the door the comment
  // above was watching. So the branch is on `isPending` — status alone.
  //
  // The aggregate is per **screen**, not per query, which is what the spec's `loading` state already says:
  // "no card has arrived yet", with "a card that has arrived drawn immediately rather than held for its
  // siblings". Hence `some(isPending)` and not `every`: one pole still waiting while another has answered is
  // a partial list. Measured in `apps/web/test/favourites-offline.test.tsx` against the real provider; the
  // same edit is on `apps/web/src/screens/Favourites.tsx`.
  const nothingToShow = cards.length === 0
  const loading = nothingToShow && results.some((r) => r.isPending)
  const errors = results.flatMap((r) => (r.isError ? [r.error] : []))
  // The `nothingToShow` guard is this screen's version of Nearby's `data === undefined`: a refresh that
  // failed is a list we could not update, and replacing it with the reason is what the spec's `offline`
  // state forbids ("never a blank list").
  const failure = nothingToShow ? errors[0] : undefined

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'tabFavorites')}
        </Text>
      </View>
      {poleIds.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="h3" className="text-center text-text">
            {t(locale, 'favoritesEmpty')}
          </Text>
          <Text variant="body" className="mt-2 text-center text-muted">
            {t(locale, 'favoritesEmptyHelp')}
          </Text>
        </View>
      ) : /* The wait comes before the reason, and with one query per saved pole that ordering is load-bearing:
             a pole that has exhausted its retries must not answer for one that is still trying. Nothing to
             show and something still pending is a wait, and the skeleton says so honestly. */
      loading ? (
        <View className="px-4 py-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-3 h-6 w-full" />
        </View>
      ) : failure ? (
        <Text variant="body" className="px-4 text-danger">
          {(failure as Error).message}
        </Text>
      ) : (
        <ScrollView>
          <View style={{ paddingBottom: tab.contentInset }}>
            {/* Inside the arm that has cards to show, as on `apps/web`: when the screen *is* the reason a
                fetch failed, that reason is already the sentence. */}
            <FeedNotice notice={notice} />
            {cards.map((card, i) => (
              <View key={card.stopId} className={i === 0 ? '' : 'border-border border-t'}>
                <StopRow
                  view={card}
                  locale={locale}
                  onPress={() => router.push(`/stop/${encodeURIComponent(card.stopId)}`)}
                  onRoutePress={(routeId) =>
                    router.push(
                      `/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(card.stopId)}`,
                    )
                  }
                />
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  )
}
