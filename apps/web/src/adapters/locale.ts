import { resolveLocale } from '@nextbus/i18n'
import type { LocaleProvider } from '@nextbus/ports'

/**
 * The browser's language preferences, resolved by the **same** `resolveLocale` the RN app uses.
 *
 * `navigator.languages` is an ordered list of BCP-47 tags, which is exactly what `resolveLocale`
 * takes — so there is no mapping table here, and therefore no second opinion about whether `zh-TW`
 * means Traditional. That function is the single declaration; this is a one-line adapter, which is
 * the whole shape of the exercise.
 */
export const browserLocaleProvider: LocaleProvider = {
  preferredLanguages: () => [...(navigator.languages ?? [navigator.language])],
}

/** The active locale for this session. No manual override yet — see the note in `Nearby.tsx`. */
export const detectedLocale = () => resolveLocale(browserLocaleProvider.preferredLanguages())
