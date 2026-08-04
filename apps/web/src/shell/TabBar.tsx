import { t } from '@nextbus/i18n'
import { Link, NavLink } from 'react-router'
import { useLocale } from '../providers/LocaleProvider'
import { SEARCH, TABS } from './destinations'
import { TAB_BAR_HEIGHT } from './layout'

/** Capitalised so JSX treats it as a component rather than an HTML tag. */
const SearchIcon = SEARCH.icon

/**
 * The bottom bar: three tabs, and the search launcher sharing the row at the far right.
 *
 * **What is identity here and what is idiom** (ADR-075's table): the three destinations, their order,
 * that search is a launcher rather than a fourth tab, that each control is at least 44×44 px, and that
 * the active tab is announced — all identity, and all of it matches `apps/mobile/app/(tabs)/_layout.tsx`.
 * The *material* is idiom, and this is where the two renderers deliberately differ: the RN bar is a
 * floating liquid-glass pill, which is a Chromium-only effect (ADR-028) that `react-native-web` renders
 * approximately at best. The web treatment is a flat surface behind a hairline — the same tokens, an
 * honest medium.
 *
 * `NavLink` is doing two jobs a hand-rolled tab would have to redo: it renders a real `<a href>`, so the
 * bar works with middle-click, "open in new tab" and a screen reader's link list, and it sets
 * `aria-current="page"` on the active one, which is the DOM's way of saying `accessibilityState:
 * { selected }`. `end` matters on `/`: without it every path would match it and two tabs would read as
 * current.
 *
 * No `aria-label` on the `<nav>`: there is exactly one navigation landmark in this shell, so a label
 * would add a name where the role already says everything, and inventing an English one would break
 * CLAUDE.md rule 5.
 */
export function TabBar() {
  const locale = useLocale()
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex items-stretch gap-2 border-t border-border bg-surface px-2"
      // The bar sits on the screen edge and must clear the home indicator on an installed iOS PWA;
      // `index.html` asks for `viewport-fit=cover`, which is what makes the inset non-zero there.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex flex-1 items-stretch">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
            style={{ minHeight: TAB_BAR_HEIGHT }}
          >
            <tab.icon aria-hidden width={22} height={22} />
            <span className="text-caption font-medium">{t(locale, tab.titleKey)}</span>
          </NavLink>
        ))}
      </div>

      {/* Search is its own page with no tab bar (ADR-037), so it is launched rather than switched to.
          A square lens at the far right, the RN app's arrangement in a flat medium. */}
      <Link
        to={SEARCH.path}
        aria-label={t(locale, SEARCH.titleKey)}
        className="flex items-center justify-center self-center rounded-pill border border-border bg-surface-2 text-text no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        style={{ width: LENS, height: LENS }}
      >
        <SearchIcon aria-hidden width={22} height={22} />
      </Link>
    </nav>
  )
}

/** The launcher is inset from the bar's own height so it reads as a lens *in* the row, not as a fourth
 *  tab — still well above the 44 px minimum. */
const LENS = TAB_BAR_HEIGHT - 8
