import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { useAppearance } from '../lib/appearance'
import { LocaleProvider } from '../providers/LocaleProvider'
import { QueryProvider } from '../providers/QueryProvider'
import { AboutData } from '../screens/AboutData'
import { Faq } from '../screens/Faq'
import { Favourites } from '../screens/Favourites'
import { Nearby } from '../screens/Nearby'
import { PlaceDetail } from '../screens/PlaceDetail'
import { RouteDetail } from '../screens/RouteDetail'
import { Search } from '../screens/Search'
import { Settings } from '../screens/Settings'
import {
  ABOUT_PATH,
  type Destination,
  FAQ_PATH,
  FAVOURITES_PATH,
  NEARBY_PATH,
  PLACE_PATH,
  PUSHED,
  ROUTE_PATH,
  SEARCH,
  SETTINGS_PATH,
  TABS,
} from './destinations'
import { CONTENT_INSET } from './layout'
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
        <Route key={pushed.path} path={pushed.path} element={screenFor(pushed)} />
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
 * The element a destination renders — **all eight of them, as of WP6-7.**
 *
 * There is no fallback arm and no `Placeholder` any more. From WP6-0 until this row, every unported path
 * rendered a placeholder naming the work package that owed it, so that "not yet here" was a drawn state
 * rather than a route that 404s; that file is deleted, and a destination added to the table without a
 * branch here is now a **typecheck failure** (the switch is exhaustive over a union of literals) rather
 * than a screen that renders nothing. That is a stronger guarantee than the placeholder gave, and it is
 * only available because the set is finally complete.
 *
 * Every pushed screen brings its own back control, because each has a header in flow rather than chrome
 * floating over the content — so the shell owes none of them one.
 */
function screenFor(destination: Destination): ReactNode {
  switch (destination.path) {
    case NEARBY_PATH:
      return <Nearby />
    case FAVOURITES_PATH:
      return <Favourites />
    case SETTINGS_PATH:
      return <Settings />
    case SEARCH.path:
      return <Search />
    case PLACE_PATH:
      return <PlaceDetail />
    case ROUTE_PATH:
      return <RouteDetail />
    case ABOUT_PATH:
      return <AboutData />
    case FAQ_PATH:
      return <Faq />
    default:
      // Unreachable while `DESTINATIONS` and this switch agree, and `test/shell-parity.test.ts` asserts
      // that they do — by mounting every declared destination and requiring a non-empty render, which is
      // what the `owner` field used to promise in words.
      throw new Error(`no screen for the declared destination \`${destination.path}\``)
  }
}
