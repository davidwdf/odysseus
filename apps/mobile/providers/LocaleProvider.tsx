import type { Locale } from '@nextbus/core'
import { resolveLocale } from '@nextbus/i18n'
import { getLocales } from 'expo-localization'
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

interface LocaleContextValue {
  locale: Locale
  /** Manual override (e.g. from a future Settings toggle). null = follow device. */
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
  const [override, setLocale] = useState<Locale | null>(null)
  const value = useMemo<LocaleContextValue>(
    () => ({ locale: override ?? device, setLocale }),
    [override, device],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/** Current UI locale (device-detected, or the manual override). */
export function useLocale(): Locale {
  return useContext(LocaleContext)?.locale ?? 'en'
}

/** Set a manual locale override; pass null to follow the device again. */
export function useSetLocale(): (locale: Locale | null) => void {
  return useContext(LocaleContext)?.setLocale ?? (() => {})
}
