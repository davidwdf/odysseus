import { t } from '@nextbus/i18n'
import { ELEVATION, GLASS_RIM, webBoxShadow } from '@nextbus/ui'
import { Link } from 'react-router'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { SEARCH, SETTINGS } from './destinations'
import { BAR_BOTTOM, CONTENT_INSET_TOP, LENS_SIZE, TAB_BAR_GAP } from './layout'

/**
 * **The shell's chrome, now that there is no tab bar** (ADR-181): two floating glass lenses, and
 * nothing else.
 *
 * ## Why the bar went, and what it is not
 *
 * Not a dislike of the chrome — the floating glass bar is *identity* under ADR-100, ported value for
 * value at the owner's own direction after the parity review. **Its destinations dissolved.** Walk the
 * three it would have carried against the merged board: *Saved* is now a section of Home, so a tab for it
 * is a second door to something already on screen; *Map* is the sheet dragged down once Home is
 * map-backed, which is better than a tab because it keeps the board one **gesture** away rather than one
 * navigation; and Home is the only root left. A one-tab bar is not a bar.
 *
 * So this amends ADR-100 rather than contradicting it: the material and the geometry survive unchanged —
 * the same `LENS_SIZE`, the same rim, the same tint, the same `max(safe-area, 12px)` floor — and what is
 * gone is the row of destinations they used to sit beside.
 *
 * ## Two lenses, placed by how often they are used
 *
 * **Search, bottom-right**, where the thumb is and where the lens already sat. Unlabelled, at the owner's
 * call: *"search is a well known icon"*. It is the busiest secondary surface in the app and the one this
 * change costs the most discoverability, so it keeps the corner nearest the hand.
 *
 * **Settings, top-right**, the same geometry as the back lens on the other diagonal. Rarely opened, and
 * a gear is as well understood as a magnifier.
 *
 * ## Both are `Link`s, and that is not a detail
 *
 * A real `<a href>` works with middle-click, "open in new tab" and a screen reader's link list. A
 * hand-rolled button would have to re-earn all three, and the tab bar's own note says so about `NavLink`.
 * Neither carries `aria-current`: these are destinations you go to and come back from, not a set of peers
 * one of which you are in.
 *
 * ## It renders on every screen that has no back control
 *
 * Which is Home, and — once they are routes again or not at all — nothing else. A pushed screen has the
 * back lens in the top-left and its own bottom edge to itself; putting Search over a route's stop sheet
 * would be a control floating above a control.
 */
export function ShellChrome() {
  const locale = useLocale()
  const mode = useAppearance()

  // A drop shadow has almost no contrast budget on a near-black field, so ADR-035 drops elevation in
  // dark and leans on the surface and border instead — the same branch `elevationStyle` makes on native,
  // and the same one the tab bar made.
  const glass = {
    boxShadow: webBoxShadow(
      mode === 'dark'
        ? [GLASS_RIM.top.dark, GLASS_RIM.bottom.dark]
        : [GLASS_RIM.top.light, GLASS_RIM.bottom.light, ELEVATION.e3],
    ),
  }
  const lens =
    'glass-pane fixed z-20 flex items-center justify-center rounded-full border border-border text-text no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus'

  return (
    <>
      <Link
        to={SETTINGS.path}
        aria-label={t(locale, SETTINGS.titleKey)}
        className={lens}
        style={{
          top: `calc(${CONTENT_INSET_TOP} + ${TAB_BAR_GAP}px)`,
          right: TAB_BAR_GAP,
          // Smaller than the search lens on purpose: the two are not peers, and a gear the size of the
          // primary action would read as one. It still clears the 44 px touch target ADR-075 puts on the
          // identity side.
          width: 48,
          height: 48,
          ...glass,
        }}
      >
        <SETTINGS.icon aria-hidden width={21} height={21} />
      </Link>

      <Link
        to={SEARCH.path}
        aria-label={t(locale, SEARCH.titleKey)}
        className={lens}
        style={{
          bottom: BAR_BOTTOM,
          right: TAB_BAR_GAP,
          width: LENS_SIZE,
          height: LENS_SIZE,
          ...glass,
        }}
      >
        <SEARCH.icon aria-hidden width={22} height={22} />
      </Link>
    </>
  )
}
