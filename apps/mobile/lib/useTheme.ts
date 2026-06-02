import {
  type LiveryId,
  type Mode,
  resolveMode,
  type ThemeVars,
  themeColor,
  themes,
} from '@nextbus/ui'
import { useColorScheme } from 'react-native'
import { usePreferences } from './preferences'

/**
 * Resolves the active theme from two persisted axes — the chosen livery and the
 * appearance preference (auto/light/dark) — combined with the OS colour scheme
 * when appearance is `auto` (docs/09 §7, ADR-018). Theme selection lives in one
 * hook so layouts and the nav chrome stay agnostic.
 */
export function useTheme(): {
  livery: LiveryId
  mode: Mode
  isDark: boolean
  vars: ThemeVars
  color: (token: `--${string}`) => string
} {
  const scheme = useColorScheme()
  const livery = usePreferences((s) => s.livery)
  const appearance = usePreferences((s) => s.appearance)
  const mode = resolveMode(appearance, scheme === 'dark')
  const vars = themes[livery][mode]
  return { livery, mode, isDark: mode === 'dark', vars, color: (token) => themeColor(vars, token) }
}
