import { favouritePoleIds, favouritesView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQueries } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Skeleton } from '../../components/Skeleton'
import { StopRow } from '../../components/StopRow'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { usePreferences } from '../../lib/preferences'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useClientPolicy } from '../../lib/useClientPolicy'
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
  const cards = favouritesView(
    { saved, places: results.flatMap((r) => (r.data ? [r.data] : [])) },
    { locale, now, policy },
  )

  // **A screen with saved favourites and nothing to show is one of three states, not one** — and until
  // WP6-4b it collapsed them: `loading` was the only guard, so once every query had *failed* the screen
  // rendered its heading and an empty list, which is the same blank-screen hole WP6-3b found on Place detail
  // through a different door. A rider could not tell "still fetching" from "we could not reach any of them".
  const loading = results.some((r) => r.isLoading) && cards.length === 0
  const errors = results.flatMap((r) => (r.isError ? [r.error] : []))
  const failure = cards.length === 0 ? errors[0] : undefined

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
      ) : failure ? (
        <Text variant="body" className="px-4 text-danger">
          {(failure as Error).message}
        </Text>
      ) : loading ? (
        <View className="px-4 py-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-3 h-6 w-full" />
        </View>
      ) : (
        <ScrollView>
          <View style={{ paddingBottom: tab.contentInset }}>
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
