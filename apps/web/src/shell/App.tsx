import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { useAppearance } from '../lib/appearance'
import { LocaleProvider } from '../providers/LocaleProvider'
import { QueryProvider } from '../providers/QueryProvider'
import { Favourites } from '../screens/Favourites'
import { Nearby } from '../screens/Nearby'
import { PlaceDetail } from '../screens/PlaceDetail'
import {
  type Destination,
  FAVOURITES_PATH,
  NEARBY_PATH,
  PLACE_PATH,
  PUSHED,
  SETTINGS_PATH,
  TABS,
} from './destinations'
import { CONTENT_INSET } from './layout'
import { Placeholder } from './Placeholder'
import { ShellPreferences } from './ShellPreferences'
import { TabBar } from './TabBar'

/**
 * The `apps/web` shell (WP6-0): a router over the declared destination set, the persisted query cache,
 * the locale provider and its override, and the appearance store — with **one screen ported**.
 *
 * ## The provider order is the RN root layout's
 *
 * `apps/mobile/app/_layout.tsx` nests `QueryProvider` outside `LocaleProvider`, and this does the same,
 * for the same reason: a query's *key* never contains the locale (the wire carries `I18nText` and the
 * kernel picks a rendering at display time — ADR-052), so switching language must not invalidate a single
 * cached response. Nesting the other way would work today and would quietly invite a locale-keyed query
 * later.
 *
 * `BrowserRouter` is outermost because a provider that wanted to read the location — a future screen-level
 * prefetch, say — must be able to.
 *
 * ## Why the tabs are a layout route
 *
 * expo-router expresses "these three destinations have a tab bar and the rest do not" as the `(tabs)`
 * group with its own `_layout`. `<Route element={<TabsLayout/>}>` is the identical shape in react-router,
 * and getting it right is what keeps `/search`, `/stop/:id` and the rest **without** a tab bar, which is
 * ADR-037's decision rather than a styling accident. It also means a pushed destination is the one that
 * owes the rider a back control, which is why `back` is set there and only there.
 */
export function App() {
  return (
    <BrowserRouter>
      <QueryProvider>
        <LocaleProvider>
          <Shell />
        </LocaleProvider>
      </QueryProvider>
    </BrowserRouter>
  )
}

function Shell() {
  // Keeps `<html>` in step with the persisted appearance and with the OS. `main.tsx` has already applied
  // the mode once before the first paint; this is what tracks a *change* to either input.
  useAppearance()
  return (
    <Routes>
      <Route element={<TabsLayout />}>
        {TABS.map((tab) => (
          <Route key={tab.path} path={tab.path} element={screenFor(tab)} />
        ))}
      </Route>
      {PUSHED.map((pushed) => (
        <Route key={pushed.path} path={pushed.path} element={screenFor(pushed, { back: true })} />
      ))}
      {/*
        An unknown path goes to Nearby rather than to a "not found" page, and that is a content decision
        rather than a lazy one: every string in this app comes from `@nextbus/i18n` (CLAUDE.md rule 5), the
        catalogue has no "page not found" message, and inventing one in three locales to describe a URL a
        rider cannot have typed on purpose is the wrong trade. `replace` keeps the bad URL out of history,
        so back does not bounce off it.
      */}
      <Route path="*" element={<Navigate to={NEARBY_PATH} replace />} />
    </Routes>
  )
}

/** The tab group: the tab bar, plus the room every screen inside it must leave for the bar. */
function TabsLayout() {
  return (
    <>
      <div style={{ paddingBottom: CONTENT_INSET }}>
        <Outlet />
      </div>
      <TabBar />
    </>
  )
}

/**
 * The element a destination renders.
 *
 * Every path but Nearby is still `apps/mobile`'s screen, so it renders a `Placeholder` — see that file for
 * why "not built" is a state the shell draws rather than a route that 404s. `/settings` additionally
 * carries the shell's own locale and appearance controls, which is what makes WP6-0's *"switches locale"*
 * something that was run rather than something that was wired.
 */
function screenFor(destination: Destination, opts: { back?: boolean } = {}): ReactNode {
  if (destination.path === NEARBY_PATH) return <Nearby />
  // Place detail brings its own back control, because its header is in flow rather than floating over the
  // content — see the screen. `opts.back` is the placeholder's chrome, not every pushed screen's.
  if (destination.path === PLACE_PATH) return <PlaceDetail />
  if (destination.path === FAVOURITES_PATH) return <Favourites />
  if (destination.path === SETTINGS_PATH) {
    return (
      <Placeholder destination={destination}>
        <ShellPreferences />
      </Placeholder>
    )
  }
  return <Placeholder destination={destination} back={opts.back} />
}
