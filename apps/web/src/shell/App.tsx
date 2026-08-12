import type { ReactNode } from 'react'
import { useState } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { useNavigationMoment } from '../hooks/useScrollToTop'
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
/**
 * The route table, as data — the shape `createBrowserRouter` takes.
 *
 * **A data router rather than `<BrowserRouter>`, and the reason is motion.** `react-router@7.18.2` wires
 * View Transitions only inside a data router: `<Link viewTransition>`, `navigate(to, { viewTransition })`
 * and — the one that matters — `useViewTransitionState(href)`, which is what lets a component put a
 * `view-transition-name` on itself *for the duration of one navigation*. That is the difference between a
 * page that cross-fades and a route badge that flies from a list row into the header, and there is no way
 * to get it from `<BrowserRouter>` (the call sits behind `router.window`, which the component router never
 * populates).
 *
 * **This is the second attempt at web page transitions and the first one was reverted.** ADR-043 built a JS
 * navigator stack for push/back and took it out again because it broke web scrolling; `docs/07` still
 * carries the item. View Transitions do not have that failure mode — no navigator swap, no scroll container
 * of their own, the browser snapshots and animates — which is why this is a different attempt rather than a
 * retry. Firefox has no View Transitions today and cuts, exactly as the app does now.
 *
 * The providers moved *inside* the router, into a root route element. `RouterProvider` has to be outermost,
 * and the order below is otherwise the one the RN root layout uses: `QueryProvider` outside
 * `LocaleProvider`, because a query key never contains the locale (ADR-052) and switching language must not
 * invalidate a single cached response.
 */
/*
  **`handle` carries the whole `Destination` on every leaf route**, and it exists for one consumer:
  `useNavigationMoment` announces where a rider has landed and needs that destination's name. Reading it
  back off the match is what keeps the announcement from becoming a second path→name table — the one the
  tab bar and this file already share — which is the shape ADR-054 keeps finding in this repo. The two
  layout routes carry none, because neither is a destination.

  **Exported for `test/navigation-a11y.test.tsx`**, which mounts this table under a memory router: the two
  most interesting destinations — a place and a route — cannot be reached from a networkless shell, because
  every control that leads to one is drawn from data. The alternative was a second, synthetic table in a
  test, and a route table that only a test can see is the one thing this file exists to prevent.
*/
export const routes = [
  {
    element: <Root />,
    children: [
      {
        element: <TabsLayout />,
        children: TABS.map((tab) => ({ path: tab.path, element: screenFor(tab), handle: tab })),
      },
      ...PUSHED.map((pushed) => ({
        path: pushed.path,
        element: screenFor(pushed),
        handle: pushed,
      })),
      /*
        An unknown path goes to Nearby rather than to a "not found" page, and that is a content decision
        rather than a lazy one: every string in this app comes from `@nextbus/i18n` (CLAUDE.md rule 5), the
        catalogue has no "page not found" message, and inventing one in three locales to describe a URL a
        rider cannot have typed on purpose is the wrong trade. `replace` keeps the bad URL out of history,
        so back does not bounce off it.
      */
      { path: '*', element: <Navigate to={NEARBY_PATH} replace /> },
    ],
  },
]

export function App() {
  /**
   * Built on first render rather than at module scope, and that is load-bearing for the suites.
   *
   * `createBrowserRouter` reads `window.location` **when it is created**. At module scope it would capture
   * whatever the URL was when the bundle loaded, so `shell.test.tsx`'s `pushState(path)` → mount would open
   * the wrong screen every time and the whole file would be asserting one route eight times. `useState`'s
   * initialiser runs once per mount, which is also exactly what its `remount()` cold-start helper wants.
   */
  const [router] = useState(() => createBrowserRouter(routes))
  return <RouterProvider router={router} />
}

/** The providers, and the one effect that has to run above every screen. */
function Root() {
  // Keeps `<html>` in step with the persisted appearance and with the OS. `main.tsx` has already applied
  // the mode once before the first paint; this is what tracks a *change* to either input.
  useAppearance()
  return (
    <QueryProvider>
      <LocaleProvider>
        <Outlet />
        {/*
          **After `<Outlet/>`, which is the shell saying it is the fallback.** React runs a host node's
          `autoFocus` in the same commit phase as layout effects and in tree order, so declared here the
          announcer asks about focus only once the new screen has had its own commit to claim it — and
          Search's autofocused field, the one screen that claims it, keeps the keyboard.

          It would in fact work from either side of the outlet, because what protects that field is the
          condition in `focusScreen` rather than the order — measured both ways: the suite goes red on
          removing the condition and stays green on swapping these two lines. This is the position that
          says what the rule is.

          Inside `LocaleProvider` for the ordinary reason: what it says is a catalogue string in the
          rider's language.
        */}
        <NavigationMoment />
      </LocaleProvider>
    </QueryProvider>
  )
}

/**
 * The shell's answer to *"nothing tells a screen-reader rider that the page changed"* — a polite live
 * region naming the destination, plus the focus move and the scroll reset the same instant owes (all three
 * live in `useNavigationMoment`, because they share one definition of a navigation).
 *
 * Empty on a page load and empty on the two screens a rider reaches by tapping a place or a route, whose
 * names are bus data rather than UI strings. A region that is present-but-empty from the start is also the
 * only kind that reliably announces: a live region inserted *with* its text is frequently missed, so this
 * one is mounted for the life of the app and only its content changes.
 */
function NavigationMoment() {
  const announcement = useNavigationMoment()
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {announcement}
    </p>
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
