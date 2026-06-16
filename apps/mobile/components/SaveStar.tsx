import { t } from '@nextbus/i18n'
import { Star } from 'lucide-react-native'
import { Pressable, type StyleProp, type ViewStyle } from 'react-native'
import { favoriteRouteKey, usePreferences } from '../lib/preferences'
import { useTheme } from '../lib/useTheme'
import { useLocale } from '../providers/LocaleProvider'
import { Icon } from './Icon'

/**
 * The route-at-stop favourite indicator (ADR-032/042): a star reflecting whether this route —
 * at the **member pole** it departs from — is saved. The key is the operator-scoped member
 * stop id (`favoriteRouteKey(stopId, routeId)`), **never** the churning `P:` place id, so
 * re-tuning the clustering can't orphan a saved favourite.
 *
 * Used in Place detail as a per-row indicator. With `hideWhenEmpty` it renders nothing until
 * the route is saved — favouriting itself happens via the route-schematic action sheet, so an
 * unsaved row stays uncluttered.
 */
export function SaveStar({
  stopId,
  routeId,
  size = 22,
  hideWhenEmpty = false,
  style,
}: {
  /** The member pole id the route departs from, e.g. `KMB:ST141` — never a `P:` place id. */
  stopId: string
  routeId: string
  size?: number
  /** Render nothing until the route is saved (the row's favourite indicator). */
  hideWhenEmpty?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const locale = useLocale()
  const { color } = useTheme()
  const key = favoriteRouteKey(stopId, routeId)
  const saved = usePreferences((s) => s.favoriteRoutes.includes(key))
  const toggle = usePreferences((s) => s.toggleFavoriteRoute)

  if (hideWhenEmpty && !saved) return null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      accessibilityLabel={t(locale, saved ? 'saved' : 'save')}
      hitSlop={8}
      onPress={() => toggle(stopId, routeId)}
      className="active:opacity-60"
      style={style}
    >
      {/* Filled accent star when saved; subtle outline when not. */}
      <Icon
        icon={Star}
        size={size}
        tone={saved ? 'accent' : 'subtle'}
        fill={saved ? color('--accent') : 'none'}
      />
    </Pressable>
  )
}
