import { favouritePoleIds, favouritesView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { dataSource } from '../adapters/datasource'
import { StopCard } from '../components/StopCard'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'

/**
 * Favourites, rendered by React DOM from the identical kernel functions the React Native screen uses
 * (WP6-4b). Put this file beside `apps/mobile/app/(tabs)/favorites.tsx` and the difference is elements and
 * classes: `favouritePoleIds` decides which poles to fetch and `favouritesView` produces every card, its
 * rows, their order and their readouts — once, for both.
 *
 * `packages/contract/ui/favourites.spec.json` declares what it must show in each of eight states, and
 * `test/favourites-states.test.tsx` drives every projected one, as does its RN twin from the same file and
 * the same corpus fixtures.
 *
 * **The store is the same store.** Since WP6-4a this app writes `nextbus.preferences` — the blob the RN app
 * writes — with all five of its fields modelled, so a favourite starred in either app is visible in the
 * other once they share an origin. See `src/lib/preferences.ts` for why modelling *more* is what made that
 * safe rather than dangerous.
 */
export function Favourites() {
  const locale = useLocale()
  const navigate = useNavigate()
  const { policy } = useClientPolicy()
  // ADR-042/ADR-062: favourites key on the *member pole* id, never the churning `P:` place id.
  const saved = usePreferences((s) => s.favoriteRoutes)

  // Which poles to ask about — a rule, and one the screen needs *before* it has any data, which is why it is
  // its own kernel export. It skips a key the id grammar cannot read rather than guessing at it, and asks
  // once per place rather than once per saved pole.
  const poleIds = favouritePoleIds(saved)

  const results = useQueries({
    queries: poleIds.map((stopId) => ({
      queryKey: ['stop', stopId],
      queryFn: () => dataSource.getStop(stopId),
      // Served cadence (ADR-053), and the same value the RN screen uses. This screen fans out one query per
      // saved pole, so it is the one that most wants a cadence matched to the edge's TTL.
      refetchInterval: policy.refreshAfterMs,
    })),
  })

  // `Date.now()` in the render body, as on the RN screen and for the same reason: this screen still fetches
  // on `refetchInterval`, so it re-renders every cadence and the clock advances with it. The two screens
  // that took their clock out of a hook did so because a *subscription* replaced their interval.
  const now = Date.now()

  // The whole screen's content, in one call. Nothing below this line decides anything.
  const cards = favouritesView(
    { saved, places: results.flatMap((r) => (r.data ? [r.data] : [])) },
    { locale, now, policy },
  )

  // Three states, not one — see the RN twin's note: guarding only on `isLoading` is what made a screen whose
  // every query had failed render its heading and an empty list, which reads as "you have nothing saved".
  const loading = results.some((r) => r.isLoading) && cards.length === 0
  const errors = results.flatMap((r) => (r.isError ? [r.error] : []))
  const failure = cards.length === 0 ? errors[0] : undefined

  return (
    <main className="min-h-dvh bg-bg">
      <header className="px-4 pb-3 pt-2">
        <h1 className="m-0 text-h1 font-bold text-text">{t(locale, 'tabFavorites')}</h1>
      </header>

      {poleIds.length === 0 ? (
        <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6">
          <h2 className="m-0 text-center text-h3 font-semibold text-text">
            {t(locale, 'favoritesEmpty')}
          </h2>
          <p className="m-0 mt-2 text-center text-body text-muted">
            {t(locale, 'favoritesEmptyHelp')}
          </p>
        </div>
      ) : failure ? (
        <p className="m-0 px-4 text-body text-danger">{(failure as Error).message}</p>
      ) : loading ? (
        <div className="px-4 py-4">
          <div className="h-5 w-2/3 animate-pulse rounded-sm bg-surface-2" />
          <div className="mt-3 h-6 w-full animate-pulse rounded-sm bg-surface-2" />
        </div>
      ) : (
        <div>
          {cards.map((card, i) => (
            <div key={card.stopId} className={i === 0 ? '' : 'border-t border-border'}>
              {/* The same two destinations, spelled the same way, as the RN screen's — declared once, in
                  `StopRow`'s spec. A row opens that route **at this place**, which is what the RN screen
                  passes too: the card has no per-row kerb (see `favouritesView` on why the label was
                  declined), so the place id is the honest thing to hand on. */}
              <StopCard
                view={card}
                locale={locale}
                onPress={() => navigate(`/stop/${encodeURIComponent(card.stopId)}`)}
                onRoutePress={(routeId) =>
                  navigate(
                    `/route/${encodeURIComponent(routeId)}?stop=${encodeURIComponent(card.stopId)}`,
                  )
                }
              />
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
