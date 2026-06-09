import type { LucideIcon, LucideProps } from 'lucide-react-native'
import { useTheme } from '../lib/useTheme'

/** Semantic colour roles an icon may take — the same token vocabulary as the rest
 *  of the design system (docs/09 §2, §8). Components pick a role, never a hex. */
export type IconTone =
  | 'text'
  | 'muted'
  | 'subtle'
  | 'accent'
  | 'accent-contrast'
  | 'positive'
  | 'warning'
  | 'danger'

const TONE_VAR: Record<IconTone, `--${string}`> = {
  text: '--text',
  muted: '--text-muted',
  subtle: '--text-subtle',
  accent: '--accent',
  'accent-contrast': '--accent-contrast',
  positive: '--positive',
  warning: '--warning',
  danger: '--danger',
}

type IconProps = Omit<LucideProps, 'color'> & {
  /** A Lucide glyph component, e.g. `Star`, `MapPin` (docs/09 §8: Lucide, 24px line set). */
  icon: LucideIcon
  /** Semantic colour role; resolved through the active theme. Default `text`. */
  tone?: IconTone
  /** Explicit colour override for the rare value-driven case (operator accent, the
   *  nav-resolved tab tint). Bypasses `tone`; keep it for those exceptions only. */
  color?: string
}

/**
 * The single icon primitive. Wraps a Lucide glyph and resolves its colour from a
 * semantic token through `useTheme()`, so icons follow the active livery/appearance
 * exactly like `<Text>` colours do. Decorative by default — put the
 * `accessibilityLabel` on the pressable that wraps it, not here.
 */
export function Icon({
  icon: Glyph,
  tone = 'text',
  size = 24,
  strokeWidth = 2,
  color,
  ...rest
}: IconProps) {
  const { color: resolve } = useTheme()
  return (
    <Glyph
      {...rest}
      size={size}
      strokeWidth={strokeWidth}
      color={color ?? resolve(TONE_VAR[tone])}
    />
  )
}
