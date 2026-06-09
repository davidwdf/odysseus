import { type Mode, resolveMode, type ThemeVars, themeColor, themes } from '@nextbus/ui'
import { useColorScheme } from 'react-native'
import { usePreferences } from './preferences'

/**
 * Resolves the active theme from the persisted appearance preference (auto/light/dark)
 * combined with the OS colour scheme when `auto` (docs/09 §7, ADR-029). One Ink theme,
 * two modes — resolved in one place so layouts and the nav chrome stay agnostic.
 */
export function useTheme(): {
  mode: Mode
  isDark: boolean
  vars: ThemeVars
  color: (token: `--${string}`) => string
} {
  const scheme = useColorScheme()
  const appearance = usePreferences((s) => s.appearance)
  const mode = resolveMode(appearance, scheme === 'dark')
  const vars = themes[mode]
  return { mode, isDark: mode === 'dark', vars, color: (token) => themeColor(vars, token) }
}
