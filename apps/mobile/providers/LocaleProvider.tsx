import type { Locale } from '@nextbus/core'
import { resolveLocale } from '@nextbus/i18n'
import { getLocales } from 'expo-localization'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { usePreferences } from '../lib/preferences'

interface LocaleContextValue {
  locale: Locale
  /** The persisted manual override (null = follow device) — drives the Settings picker. */
  override: Locale | null
  setLocale: (locale: Locale | null) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function detectDeviceLocale(): Locale {
  try {
    return resolveLocale(getLocales().map((l) => l.languageTag))
  } catch {
    return 'en'
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const device = useMemo(detectDeviceLocale, [])
  // The override is persisted in the preferences store so the choice survives reload.
  const override = usePreferences((s) => s.localeOverride)
  const setLocale = usePreferences((s) => s.setLocaleOverride)
  const value = useMemo<LocaleContextValue>(
    () => ({ locale: override ?? device, override, setLocale }),
    [override, device, setLocale],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** Current UI locale (device-detected, or the manual override). */
export function useLocale(): Locale {
  return useContext(LocaleContext)?.locale ?? 'en'
}

/** The active manual override (null = following device), for the Settings picker. */
export function useLocaleOverride(): Locale | null {
  return useContext(LocaleContext)?.override ?? null
}

/** Set a manual locale override; pass null to follow the device again. */
export function useSetLocale(): (locale: Locale | null) => void {
  return useContext(LocaleContext)?.setLocale ?? (() => {})
}
