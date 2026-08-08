import { t } from '@nextbus/i18n'
import { ELEVATION, GLASS_RIM, webBoxShadow } from '@nextbus/ui'
import { Link, NavLink } from 'react-router'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { SEARCH, TABS } from './destinations'
import { BAR_BOTTOM, LENS_SIZE, TAB_BAR_GAP, TAB_BAR_HEIGHT } from './layout'

/** Capitalised so JSX treats it as a component rather than an HTML tag. */
const SearchIcon = SEARCH.icon

/**
 * The bottom bar: a floating glass pill of three tabs, with the search lens beside it.
 *
 * ## This file used to argue the opposite, and the argument was wrong
 *
 * It said the material was idiom and that "the web treatment is a flat surface behind a hairline — the
 * same tokens, an honest medium". The owner's line is that the app's **signature** material and motion are
 * identity and only platform-conventional detail is idiom, and a floating glass bar is about as signature
 * as this app gets. So the geometry, the tint, the rim and the lens are `apps/mobile`'s, value for value
 * (`lib/tabBarLayout.ts`, `app/(tabs)/_layout.tsx`, `components/GlassView.tsx`).
 *
 * ## What is *not* ported, and why that is not a compromise
 *
 * The RN `GlassView` runs a Chromium-only SVG displacement filter for true refraction and falls back to
 * `blur(13px) saturate(1.8)` on Safari and Firefox — where the filter is parsed and then not rendered
 * (ADR-028). This ships the **fallback everywhere**: it is what the majority of riders already see, it is
 * one line rather than sixty of literal-bearing SVG, and it needs no exemption from
 * `check-no-raw-colours`. Adding the refraction later is additive and changes nothing here.
 *
 * Two guards `apps/mobile` never got, because the DOM makes them cheap and both are legibility rather than
 * taste: with no `backdrop-filter` support, and under `prefers-reduced-transparency`, the tint goes opaque.
 * That closes the standing item `docs/09-theme.md` carries about glass and contrast, on this side.
 *
 * ## Structure: one landmark, two panes, and a hole in the middle
 *
 * The `<nav>` spans the viewport so both children can be positioned against it, and is
 * `pointer-events-none` so it does not eat taps on the content scrolling underneath — which
 * `position: absolute` gave the RN bar for free and a full-width fixed overlay does not. Each pane turns
 * pointer events back on.
 *
 * `NavLink` is doing two jobs a hand-rolled tab would have to redo: it renders a real `<a href>`, so the
 * bar works with middle-click, "open in new tab" and a screen reader's link list, and it sets
 * `aria-current="page"` on the active one, which is the DOM's way of saying `accessibilityState:
 * { selected }`. `end` matters on `/`: without it every path would match and two tabs would read as
 * current.
 *
 * The inactive tint is `--text-muted` and not `--text-subtle`, which is the one colour decision copied
 * from the RN bar for a stated reason rather than for symmetry: a dim grey loses too much contrast over a
 * blurred, moving backdrop.
 */
export function TabBar() {
  const locale = useLocale()
  const mode = useAppearance()

  /**
   * Tab → tab is a 150 ms linear cross-fade, matching React Navigation's `FadeSpec` — which is what the RN
   * shell uses and what ADR-043 left standing after it reverted the JS stack.
   *
   * `viewTransition` on the link, rather than a hand-rolled `document.startViewTransition`: the shell moved
   * to a data router precisely so the router owns this, which is also what makes
   * `useViewTransitionState()` available to any component that wants a `view-transition-name` for the
   * duration of one navigation. That is the difference between a page that cross-fades and a shared element
   * that flies, and it is the direction this is going.
   *
   * Where View Transitions are absent — Firefox today — react-router navigates exactly as it did before: a
   * cut, which is what this app shipped until now. The duration and the curve live in `index.css` on
   * `::view-transition-old/new(root)`, where a `prefers-reduced-motion` query turns them off — the one
   * thing the RN version cannot do.
   */

  // A drop shadow has almost no contrast budget on a near-black field, so ADR-035 drops elevation in dark
  // and leans on the surface and border instead — the same branch `elevationStyle` makes on native.
  const glass = {
    boxShadow: webBoxShadow(
      mode === 'dark'
        ? [GLASS_RIM.top.dark, GLASS_RIM.bottom.dark]
        : [GLASS_RIM.top.light, GLASS_RIM.bottom.light, ELEVATION.e3],
    ),
  }

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 z-20 flex items-center"
      style={{
        bottom: BAR_BOTTOM,
        paddingLeft: TAB_BAR_GAP,
        paddingRight: TAB_BAR_GAP,
        gap: TAB_BAR_GAP,
      }}
    >
      <div
        className="glass-pane pointer-events-auto flex flex-1 items-stretch overflow-hidden rounded-pill border border-border"
        style={{ height: TAB_BAR_HEIGHT, ...glass }}
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end
            viewTransition
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <tab.icon aria-hidden width={22} height={22} />
            <span className="text-caption font-medium">{t(locale, tab.titleKey)}</span>
          </NavLink>
        ))}
      </div>

      {/* Search is its own page with no tab bar (ADR-037), so it is launched rather than switched to — a
          circular lens the same size as the bar is tall, so the two read as one row. */}
      <Link
        to={SEARCH.path}
        aria-label={t(locale, SEARCH.titleKey)}
        className="glass-pane pointer-events-auto flex shrink-0 items-center justify-center rounded-full border border-border text-text no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        style={{ width: LENS_SIZE, height: LENS_SIZE, ...glass }}
      >
        <SearchIcon aria-hidden width={22} height={22} />
      </Link>
    </nav>
  )
}
