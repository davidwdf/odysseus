import {
  EMPTY_FILTER,
  type RouteCategory,
  type RouteFilter,
  searchView,
  toggleSearchChip,
} from '@nextbus/core'
import { operatorName, type PlainMessageKey, t } from '@nextbus/i18n'
import { ChevronRight, MapPin, Route, Search as SearchIcon, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { FilterChips } from '../components/FilterChips'
import { RouteChip } from '../components/RouteChip'
import { RouteKeypad } from '../components/RouteKeypad'
import { StopName } from '../components/StopName'
import { useSearchIndex } from '../hooks/useSearchIndex'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'
import { BackButton } from '../shell/BackButton'

/**
 * Search, rendered by React DOM from the identical kernel function the React Native screen uses (WP6-5b).
 * Put this file beside `apps/mobile/app/search.tsx` and the difference is elements, classes and one genuine
 * platform decision: `searchView` produces every chip, the keypad's live keys, both result lists, the recents
 * and which of the three list states applies — once, for both.
 *
 * `packages/contract/ui/search.spec.json` declares what it must show in each of nine states, and
 * `test/search-states.test.tsx` drives every projected one, as does its RN twin from the same file and the
 * same corpus fixtures.
 *
 * ## The one platform decision, and it is the row's interesting question
 *
 * `proposals/04` picked Search for *"interaction-heavy specs"*, and the interaction that differs is the
 * **keypad**. On a phone the OS keyboard is the competition, so the RN screen collapses its pad when the
 * results are scrolled and brings it back on a tap — a gesture idiom. A browser has a real keyboard: this
 * screen therefore leaves the pad in place and **also accepts typing**, which native cannot offer and which
 * makes the pad an accelerator rather than the only way in. Both are declared `idiom`; what the spec holds
 * identical is that a *dimmed key means no route continues that way*, which is the same rule either way.
 */
export function Search() {
  const locale = useLocale()
  const navigate = useNavigate()
  const { index, loading, error } = useSearchIndex()

  const [mode, setMode] = useState<'routes' | 'stops'>('routes')
  const [routeQuery, setRouteQuery] = useState('')
  const [stopQuery, setStopQuery] = useState('')
  const [filter, setFilter] = useState<RouteFilter>(EMPTY_FILTER)

  const recentRoutes = usePreferences((s) => s.recentRoutes)
  const recentStops = usePreferences((s) => s.recentStops)
  const pushRecentRoute = usePreferences((s) => s.pushRecentRoute)
  const pushRecentStop = usePreferences((s) => s.pushRecentStop)
  const clearRecentRoutes = usePreferences((s) => s.clearRecentRoutes)
  const clearRecentStops = usePreferences((s) => s.clearRecentStops)

  // The whole screen's content, in one call. Nothing below this line decides anything.
  const view = index
    ? searchView(
        {
          index,
          mode,
          query: mode === 'routes' ? routeQuery : stopQuery,
          filter,
          recentRouteIds: recentRoutes,
          recentStopIds: recentStops,
        },
        {
          locale,
          labels: {
            operator: (op) => operatorName(op, locale),
            category: (c) => t(locale, CATEGORY_LABELS[c]),
          },
        },
      )
    : undefined

  // The union narrowed once, above the tree, so neither list is read through an inline cast.
  const routes = view?.list.kind === 'routes' ? view.list.routes : []
  const stops = view?.list.kind === 'stops' ? view.list.stops : []

  // The whole of what this screen does with a chip: hand the key straight back. `searchView` minted it and
  // `toggleSearchChip` reads it, so the key's *format* is known in one place and a renderer never takes one
  // apart (ADR-091). This screen previously held its own table of operators and categories to match against.
  const toggleChip = (key: string) => setFilter((f) => toggleSearchChip(f, key))

  const openRoute = (id: string) => {
    pushRecentRoute(id)
    navigate(`/route/${encodeURIComponent(id)}`)
  }
  const openStop = (id: string) => {
    pushRecentStop(id)
    navigate(`/stop/${encodeURIComponent(id)}`)
  }

  return (
    <main className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-3 px-4 pb-1 pt-4">
        <BackButton />
        <Segment
          mode={mode}
          onChange={setMode}
          routesLabel={t(locale, 'searchSegRoutes')}
          stopsLabel={t(locale, 'searchSegStops')}
        />
      </header>

      {loading ? (
        <div className="flex flex-col gap-3 px-4 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-sm bg-surface-2" />
          ))}
        </div>
      ) : error || !view ? (
        <p className="m-0 px-4 pt-6 text-center text-body text-danger">
          {error?.message ?? t(locale, 'searchNoResults')}
        </p>
      ) : (
        <>
          {mode === 'routes' ? (
            // **A real text field, not a display box.** The RN screen shows the typed number in a
            // non-editable field because its keypad *is* the input; a browser has a keyboard, so this
            // accepts typing as well and the pad becomes an accelerator. `inputMode="text"` rather than
            // `numeric`: route numbers carry letters (`A10`, `NA37`, `269D`).
            <div className="mx-4 mb-1 mt-1 flex h-12 items-center gap-2 rounded-xl border border-border bg-surface px-4 focus-within:border-accent">
              <Route aria-hidden width={18} height={18} className="shrink-0 text-subtle" />
              <input
                value={routeQuery}
                onChange={(e) => setRouteQuery(e.target.value.toUpperCase())}
                placeholder={t(locale, 'searchRoutePrompt')}
                // biome-ignore lint/a11y/noAutofocus: the rider arrived here to type; the RN twin autofocuses too
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label={t(locale, 'searchRoutePrompt')}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-h2 font-bold tabular-nums text-text outline-none placeholder:text-label placeholder:font-normal placeholder:text-subtle"
              />
              {routeQuery !== '' ? (
                <ClearButton
                  label={t(locale, 'searchClearRecent')}
                  onClear={() => setRouteQuery('')}
                />
              ) : null}
            </div>
          ) : (
            // A `<label>`, not a `<div>` with an `onClick`: clicking a label focuses its control natively, so
            // tapping the icon or the padding does what the RN screen's `Pressable` wrapper does — without a
            // click handler on a static element, which is both a lint error and a real a11y one (a mouse-only
            // affordance with no role and no keyboard path).
            <label className="mx-4 mb-1 mt-1 flex h-12 items-center gap-2 rounded-xl border border-border bg-surface px-4 focus-within:border-accent">
              <SearchIcon aria-hidden width={18} height={18} className="shrink-0 text-subtle" />
              <input
                value={stopQuery}
                onChange={(e) => setStopQuery(e.target.value)}
                placeholder={t(locale, 'searchStopPlaceholder')}
                // biome-ignore lint/a11y/noAutofocus: as above
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label={t(locale, 'searchStopPlaceholder')}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-body text-text outline-none placeholder:text-subtle"
              />
              {stopQuery !== '' ? (
                <ClearButton
                  label={t(locale, 'searchClearRecent')}
                  onClear={() => setStopQuery('')}
                />
              ) : null}
            </label>
          )}

          <FilterChips chips={view.chips} onToggle={toggleChip} />

          <div className="flex-1 overflow-y-auto">
            {/* Which of the three arms to draw is `view.source`'s answer, never a second reading of the
                query: "nothing matched" and "nothing searched" are different sentences (ADR-091). */}
            {view.source === 'none' ? (
              <p className="m-0 px-4 pt-6 text-center text-body text-muted">
                {t(locale, 'searchNoResults')}
              </p>
            ) : (
              <>
                {view.source === 'recents' && routes.length + stops.length > 0 ? (
                  <div className="flex items-center justify-between px-4 pb-1 pt-3">
                    <span className="text-label text-subtle">{t(locale, 'searchRecent')}</span>
                    <button
                      type="button"
                      onClick={mode === 'routes' ? clearRecentRoutes : clearRecentStops}
                      className="flex items-center gap-1 border-0 bg-transparent text-label text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
                    >
                      <X aria-hidden width={14} height={14} />
                      {t(locale, 'searchClearRecent')}
                    </button>
                  </div>
                ) : null}
                {routes.map((route, i) => (
                  <div key={route.id} className={i === 0 ? '' : 'border-t border-border'}>
                    <button
                      type="button"
                      onClick={() => openRoute(route.id)}
                      className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
                    >
                      <RouteChip operator={route.operator} routeNo={route.routeNo} />
                      {/* Both ends arrive title-cased on the row; the arrow is this renderer's glyph — the
                          same split `StopRow` makes for its destination. */}
                      <span className="min-w-0 flex-1 truncate text-body text-text">
                        <span className="text-subtle">{route.origin}</span>
                        {/* Its own node, so the projection can declare it as the renderer's glyph rather
                            than as part of a string the kernel did not compose (ADR-092). */}
                        <span className="text-subtle"> → </span>
                        {route.destination}
                      </span>
                      <ChevronRight
                        aria-hidden
                        width={20}
                        height={20}
                        className="shrink-0 text-subtle"
                      />
                    </button>
                  </div>
                ))}
                {stops.map((stop, i) => (
                  <div key={stop.id} className={i === 0 ? '' : 'border-t border-border'}>
                    <button
                      type="button"
                      onClick={() => openStop(stop.id)}
                      className="flex w-full items-center justify-between gap-3 border-0 bg-transparent px-4 py-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
                    >
                      <StopName name={stop.name} />
                      <ChevronRight
                        aria-hidden
                        width={20}
                        height={20}
                        className="shrink-0 text-subtle"
                      />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {mode === 'routes' ? (
            // **Always present, where the RN pad collapses on scroll.** A phone competes with the OS
            // keyboard for the bottom of the screen; a browser does not, and a pad that vanished as a rider
            // scrolled a long result list would be a gesture answer to a problem this platform does not
            // have. Declared `idiom` in the spec, with the RN behaviour named beside it.
            <div className="border-t border-border pb-3 pt-3">
              <RouteKeypad keypad={view.keypad} value={routeQuery} onChange={setRouteQuery} />
            </div>
          ) : null}
        </>
      )}
    </main>
  )
}

const CATEGORY_LABELS: Record<RouteCategory, PlainMessageKey> = {
  night: 'filterNight',
  airport: 'filterAirport',
  express: 'filterExpress',
}

function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClear}
      className="shrink-0 border-0 bg-transparent p-0 text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-60"
    >
      <X aria-hidden width={18} height={18} />
    </button>
  )
}

/** Routes / Stops, as a two-option toggle. `aria-pressed` so the state is announced, not just filled. */
function Segment({
  mode,
  onChange,
  routesLabel,
  stopsLabel,
}: {
  mode: 'routes' | 'stops'
  onChange: (mode: 'routes' | 'stops') => void
  routesLabel: string
  stopsLabel: string
}) {
  return (
    <div className="flex flex-1 gap-1 rounded-pill bg-surface-2 p-1">
      {(
        [
          ['routes', routesLabel, Route],
          ['stops', stopsLabel, MapPin],
        ] as const
      ).map(([value, label, Glyph]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill border-0 py-2 text-label focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
            mode === value ? 'bg-surface font-semibold text-text' : 'bg-transparent text-subtle'
          }`}
        >
          <Glyph aria-hidden width={15} height={15} />
          {label}
        </button>
      ))}
    </div>
  )
}
