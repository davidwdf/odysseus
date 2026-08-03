import { type Locale, nearbyView } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { skipToken, useQuery } from '@tanstack/react-query'
import { LocateFixed } from 'lucide-react'
import type { ReactNode } from 'react'
import { dataSource } from '../adapters/datasource'
import { StopCard } from '../components/StopCard'
import { useClientPolicy } from '../hooks/useClientPolicy'
import { useLiveNearby } from '../hooks/useLiveNearby'
import { useLocation } from '../hooks/useLocation'

/** One array, so "no cards yet" has a stable identity — see `useLiveNearby`'s note on the storm. */
const EMPTY_IDS: readonly string[] = []

/**
 * Nearby, rendered by React DOM from the identical kernel functions the React Native screen uses
 * (WP4-1). Put this file beside `apps/mobile/app/(tabs)/index.tsx` and the difference is entirely
 * elements and classes: `nearbyView` produces the list, its order, every caption, every row and every
 * "+N more" count, once, for both.
 *
 * **What is deliberately absent.** Navigation (there is one screen, so a tap has nowhere to go yet),
 * a manual locale override, pull-to-refresh, and the persisted query cache. Each is real work and none
 * of it is what this package is testing; adding any of them would grow the diff a reviewer has to read
 * to check the claim. `Nearby` therefore takes no router — the RN screen's `router.push` calls are its
 * only structural difference from this one.
 */
export function Nearby({ locale }: { locale: Locale }) {
  const { policy } = useClientPolicy()
  const { state: loc, request } = useLocation()
  const ready = loc.status === 'ready' ? loc : null

  const query = useQuery({
    // The identical query key, radius and cadence as the RN screen — the coordinates arrive already
    // snapped to a 25 m cell by the shared controller, which is what makes this key stable enough to
    // cache at all (ADR-058).
    queryKey: ['nearby', ready?.lat, ready?.lng],
    queryFn: ready ? () => dataSourceGetNearby(ready.lat, ready.lng) : skipToken,
    // **Only on error since WP5-7.** The arrivals arrive by subscription now, so a healthy list needs no
    // refetch — but a *failed* first load must still find its way back, and nothing else here would let
    // it: `staleTime` is 15 s, `refetchOnWindowFocus` is false, and this screen has no pull-to-refresh.
    // Same shape as the RN Place screen's, which is where the pattern came from.
    refetchInterval: (q) => (q.state.status === 'error' ? policy.refreshAfterMs : false),
  })

  // The clock comes out of the subscription hook, and the pairing is the point: deleting
  // `refetchInterval` deletes a screen's clock as well as its fetch, and `const now = Date.now()` only
  // advances when something re-renders. Without this, `etaReadout`'s staleness cue could never fire —
  // which `apps/mobile/test/live-clock.test.tsx` exists to catch on the other renderer.
  const { now } = useLiveNearby(ready, query.data?.map((stop) => stop.stop.id) ?? EMPTY_IDS, {
    enabled: query.isSuccess,
    refreshAfterMs: policy.refreshAfterMs,
  })
  // The whole screen's content, in one call. Nothing below this line decides anything.
  const cards = nearbyView(query.data ?? [], { locale, now, policy })

  return (
    <main className="min-h-dvh bg-bg">
      <header className="px-4 pb-3 pt-2">
        <h1 className="m-0 text-h1 font-bold text-text">{t(locale, 'nearbyTitle')}</h1>
        <p className="m-0 mt-1 text-label text-muted">
          {/* Say so when the list is anchored on a remembered fix rather than a live one — offline, or
              while the first reading is still coming in. ADR-008's honesty rule applies to the
              position, not only to the times. */}
          {ready?.stale ? t(locale, 'lastKnownLocation') : t(locale, 'appName')}
        </p>
      </header>

      {loc.status === 'undetermined' ? (
        <Centred>
          <h2 className="m-0 text-center text-h2 font-semibold text-text">
            {t(locale, 'nearbyPrimeTitle')}
          </h2>
          <p className="mb-5 mt-2 text-center text-body text-muted">
            {t(locale, 'nearbyPrimeBody')}
          </p>
          <button
            type="button"
            onClick={request}
            className="inline-flex items-center gap-2 rounded-pill border-0 bg-accent px-5 py-3 text-label font-medium text-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <LocateFixed aria-hidden width={18} height={18} />
            {t(locale, 'enableLocation')}
          </button>
        </Centred>
      ) : loc.status === 'denied' ? (
        <Centred>
          <p className="m-0 text-center text-body text-text">{t(locale, 'locationDenied')}</p>
          <p className="mb-5 mt-2 text-center text-label text-muted">
            {t(locale, 'locationDeniedHelp')}
          </p>
          {/* No "open Settings" affordance: a browser has no settings screen we can deep-link, which is
              why the port reports `canAskAgain: false` on the web and the copy has to stand alone. */}
          <button
            type="button"
            onClick={request}
            className="rounded-pill border border-border bg-surface px-5 py-3 text-label text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {t(locale, 'retry')}
          </button>
        </Centred>
      ) : loc.status === 'error' ? (
        <Centred>
          <p className="m-0 text-body text-danger">{loc.message}</p>
        </Centred>
      ) : loc.status === 'loading' || query.isLoading ? (
        <div>
          <p className="m-0 px-4 pb-1 text-label text-muted">{t(locale, 'locating')}</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className={`px-4 py-4 ${i === 0 ? '' : 'border-t border-border'}`}>
              <div className="h-5 w-2/3 animate-pulse rounded-sm bg-surface-2" />
              <div className="mt-2 h-3 w-24 animate-pulse rounded-sm bg-surface-2" />
              <div className="mt-3 h-6 w-full animate-pulse rounded-sm bg-surface-2" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <Centred>
          <p className="m-0 text-body text-danger">{(query.error as Error).message}</p>
        </Centred>
      ) : (
        <div>
          {cards.map((card, i) => (
            <div key={card.stopId} className={i === 0 ? '' : 'border-t border-border'}>
              <StopCard view={card} locale={locale} />
            </div>
          ))}
          {cards.length === 0 ? (
            <p className="px-4 pt-4 text-body text-muted">{t(locale, 'noService')}</p>
          ) : null}
        </div>
      )}
    </main>
  )
}

function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6">{children}</div>
  )
}

/** Kept out of the component body so the query function is not re-created per render, and so the
 *  radius sits next to the RN screen's identical literal rather than hiding in a hook. (`radius` is
 *  arguably the seventh policy knob — see `docs/11`.) */
function dataSourceGetNearby(lat: number, lng: number) {
  return dataSource.getNearby({ lat, lng }, 500)
}
