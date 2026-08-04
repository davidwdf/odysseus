import type { Locale } from '@nextbus/core'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { detectedLocale } from '../adapters/locale'
import { usePreferences } from '../lib/preferences'

/**
 * The active UI locale, and the manual override that can replace it.
 *
 * **Identical in shape and in API to `apps/mobile/providers/LocaleProvider.tsx`** — same three hooks,
 * same `null`-means-follow-the-device convention — because CLAUDE.md rule 5 says a screen reads the
 * locale through `useLocale()` and never hard-codes one, and a screen ported from the RN app must not
 * have to learn a second spelling of that. The only difference is where the device preference comes
 * from: `expo-localization`'s `getLocales()` there, `navigator.languages` here, both handed to the one
 * `resolveLocale` in `@nextbus/i18n` so neither app has its own opinion about whether `zh-TW` means
 * Traditional.
 *
 * The detection runs once per session (`useMemo` with no dependencies). A browser can in principle
 * change `navigator.languages` without a reload; re-resolving on every render to catch that would make
 * the locale a moving target during a paint, and the rider who changes their browser language reloads.
 */
interface LocaleContextValue {
  locale: Locale
  /** The persisted manual override (`null` = follow the browser) — drives the language picker. */
  override: Locale | null
  setLocale: (locale: Locale | null) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function detectBrowserLocale(): Locale {
  try {
    return detectedLocale()
  } catch {
    // `navigator.languages` is absent in some embedded webviews, and `resolveLocale` is given whatever
    // it holds. English is the fallback the RN provider uses for the same reason.
    return 'en'
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const device = useMemo(detectBrowserLocale, [])
  const override = usePreferences((s) => s.localeOverride)
  const setLocale = usePreferences((s) => s.setLocaleOverride)
  const value = useMemo<LocaleContextValue>(
    () => ({ locale: override ?? device, override, setLocale }),
    [override, device, setLocale],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * Current UI locale (browser-detected, or the manual override).
 *
 * Falls back to `en` outside a provider rather than throwing: the alternative is that a component
 * rendered in isolation by a test crashes on a locale lookup, which teaches nobody anything. Same
 * choice, same reason, as the RN provider.
 */
export function useLocale(): Locale {
  return useContext(LocaleContext)?.locale ?? 'en'
}

/** The active manual override (`null` = following the browser), for the language picker. */
export function useLocaleOverride(): Locale | null {
  return useContext(LocaleContext)?.override ?? null
}

/** Set a manual locale override; pass `null` to follow the browser again. */
export function useSetLocale(): (locale: Locale | null) => void {
  return useContext(LocaleContext)?.setLocale ?? (() => {})
}
