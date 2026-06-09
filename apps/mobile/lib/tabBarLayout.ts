import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Geometry for the floating tab bar, in one place so the bar (which is
// position:absolute and thus out of layout flow) and the screens that must leave
// room beneath their scroll content stay in agreement.

/** Bar height — fits the 24px icon + 16px label stack with breathing room. */
export const TAB_BAR_HEIGHT = 62
/** Side margins and the minimum gap below the bar / above scroll content. */
export const TAB_BAR_GAP = 12
/** Rounded-pill corner radius for the floating bar. */
export const TAB_BAR_RADIUS = 24

export interface TabBarLayout {
  /** Side inset (left/right) of the floating bar. */
  side: number
  /** Distance from the screen bottom to the bar — clears the home-indicator inset. */
  bottom: number
  /** Bar height. */
  height: number
  /** Bottom padding a scroll view should leave so nothing hides behind the bar. */
  contentInset: number
}

/**
 * Resolve the floating tab bar's position from the safe-area insets. The bar sits
 * `bottom` px above the screen edge (at least `TAB_BAR_GAP`, or the home-indicator
 * inset when larger), and scroll content should pad its bottom by `contentInset`.
 */
export function useTabBarLayout(): TabBarLayout {
  const insets = useSafeAreaInsets()
  const bottom = Math.max(insets.bottom, TAB_BAR_GAP)
  return {
    side: TAB_BAR_GAP,
    bottom,
    height: TAB_BAR_HEIGHT,
    contentInset: bottom + TAB_BAR_HEIGHT + TAB_BAR_GAP,
  }
}
