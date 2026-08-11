import { type Locale, nearbyView } from '@nextbus/core'
import { type LocalizedString, t } from '@nextbus/i18n'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { LocateFixed } from 'lucide-react-native'
import { type ReactNode, useCallback } from 'react'
import { Linking, Platform, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../../components/Button'
import { Skeleton } from '../../components/Skeleton'
import { StopRow } from '../../components/StopRow'
import { Text } from '../../components/Text'
import { dataSource } from '../../lib/datasource'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useClientPolicy } from '../../lib/useClientPolicy'
import { useLiveNearby } from '../../lib/useLiveNearby'
import { useLocation } from '../../lib/useLocation'
import { useLocale } from '../../providers/LocaleProvider'

/** One array, so "no cards yet" has a stable identity — see `useLiveNearby`'s note on the storm. */
const EMPTY_IDS: readonly string[] = []

export default function Nearby() {
  const locale = useLocale()
  const { policy } = useClientPolicy()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const router = useRouter()
  const { state: loc, request } = useLocation()
  const ready = loc.status === 'ready' ? loc : null

  const query = useQuery({
    queryKey: ['nearby', ready?.lat, ready?.lng],
    // skipToken disables the query until a location fix is ready, and narrows
    // `ready` to non-null inside the queryFn — no assertion (TanStack Query v5).
    queryFn: ready
      ? () => dataSource.getNearby({ lat: ready.lat, lng: ready.lng }, 500)
      : skipToken,
    // **Only on error**, and that is the same shape the Place screen uses (`app/stop/[id].tsx`). The
    // arrivals come from the subscription below, so a healthy list needs no refetch — but a *failed*
    // first load had no way back at all before WP5-7: `retry: 1`, `refetchOnWindowFocus: false`, no
    // interval, and an error branch with no pull-to-refresh, so a rider whose first request lost a
    // network race sat on a dead screen until they killed the app.
    refetchInterval: (q) => (q.state.status === 'error' ? policy.refreshAfterMs : false),
  })

  const onRefresh = useCallback(() => {
    void query.refetch()
  }, [query])

  // The arrivals arrive by subscription (WP5-7), and the clock comes back out of the same hook —
  // deliberately inseparable, for the reason `useLiveEtas` gives at length: `refetchInterval` was a
  // screen's clock as much as its fetch, and `const now = Date.now()` only advances when something
  // re-renders. This screen had **neither** before now: no interval anywhere, so its minutes never aged
  // and `etaReadout`'s staleness cue could not fire. One request per window feeds up to six cards.
  const { now } = useLiveNearby(ready, query.data?.map((stop) => stop.stop.id) ?? EMPTY_IDS, {
    enabled: query.isSuccess,
    refreshAfterMs: policy.refreshAfterMs,
  })
  // The whole screen's content, derived in one call by the kernel (WP4-0). The order, the row cap, the
  // captions and the "+N more" counts are all `nearbyView`'s — pinned by
  // `packages/core/spec/stop-card.spec.json` and shared byte-for-byte with any other renderer. This
  // component's remaining job is layout, navigation and the location states below.
  const cards = nearbyView(query.data ?? [], { locale, now, policy })

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'nearbyTitle')}
        </Text>
        <Text variant="label" className="mt-1 text-muted">
          {/* Say so when the list is anchored on a remembered fix rather than a live one —
              offline, or while the first GPS reading is still coming in (ADR-008 honesty
              applies to the position, not just the arrival times). */}
          {ready?.stale ? t(locale, 'lastKnownLocation') : t(locale, 'appName')}
        </Text>
      </View>

      {loc.status === 'undetermined' ? (
        <Prime locale={locale} onEnable={request} />
      ) : loc.status === 'denied' ? (
        // If the OS won't show the prompt again, send the user to Settings instead.
        <Denied
          locale={locale}
          actionLabel={t(
            locale,
            !loc.canAskAgain && Platform.OS !== 'web' ? 'openSettings' : 'retry',
          )}
          onAction={
            !loc.canAskAgain && Platform.OS !== 'web'
              ? () => {
                  void Linking.openSettings()
                }
              : request
          }
        />
      ) : loc.status === 'error' ? (
        <Centered>
          <Text variant="body" className="text-danger">
            {loc.message}
          </Text>
        </Centered>
      ) : /* **`isPending`, never `isLoading`.** `isLoading` is `isPending && isFetching`, so it excludes a
             query whose fetch TanStack has *parked* — offline under `networkMode`, or between retries
             while the document is hidden. A parked query matched neither this arm nor the error arm and
             fell through to the list, where an empty `cards` reads **"No scheduled service"**: our silence
             rendered as a fact about Hong Kong, the ADR-073 conflation one screen over from where it was
             fixed. The same edit is on `apps/web/src/screens/Nearby.tsx`; the provider half is
             `networkMode: 'always'` in `providers/QueryProvider.tsx`. */
      loc.status === 'loading' || query.isPending ? (
        <LoadingList label={t(locale, 'locating')} />
      ) : /* An error **with** data is a board we could not refresh, not a board that failed. Showing the
             reason instead of the last known list is what the spec's `offline` state forbids. */
      query.isError && query.data === undefined ? (
        <Centered>
          <Text variant="body" className="text-danger">
            {(query.error as Error).message}
          </Text>
        </Centered>
      ) : (
        <ScrollView
          className="flex-1"
          refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={onRefresh} />}
        >
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
            {cards.length === 0 ? (
              <Text variant="body" className="px-4 pt-4 text-muted">
                {t(locale, 'noService')}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center px-6">{children}</View>
}

function Prime({ locale, onEnable }: { locale: Locale; onEnable: () => void }) {
  return (
    <Centered>
      <Text variant="h2" className="text-center text-text">
        {t(locale, 'nearbyPrimeTitle')}
      </Text>
      <Text variant="body" className="mb-5 mt-2 text-center text-muted">
        {t(locale, 'nearbyPrimeBody')}
      </Text>
      <Button label={t(locale, 'enableLocation')} onPress={onEnable} icon={LocateFixed} />
    </Centered>
  )
}

function Denied({
  locale,
  actionLabel,
  onAction,
}: {
  locale: Locale
  actionLabel: LocalizedString
  onAction: () => void
}) {
  return (
    <Centered>
      <Text variant="body" className="text-center text-text">
        {t(locale, 'locationDenied')}
      </Text>
      <Text variant="label" className="mb-5 mt-2 text-center text-muted">
        {t(locale, 'locationDeniedHelp')}
      </Text>
      <Button label={actionLabel} onPress={onAction} />
    </Centered>
  )
}

function LoadingList({ label }: { label: LocalizedString }) {
  return (
    <View>
      <Text variant="label" className="px-4 pb-1 text-muted">
        {label}
      </Text>
      {[0, 1, 2].map((i) => (
        <View key={i} className={`px-4 py-4 ${i === 0 ? '' : 'border-border border-t'}`}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-24" />
          <Skeleton className="mt-3 h-6 w-full" />
        </View>
      ))}
    </View>
  )
}
