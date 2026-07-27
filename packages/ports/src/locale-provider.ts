/**
 * # LocaleProvider — "which languages does this rider read?"
 *
 * **What a native developer must supply:** the OS's ordered list of preferred language tags.
 * One method. Nothing else.
 *
 * | Platform | Implementation |
 * |---|---|
 * | Web / PWA | `navigator.languages` (fall back to `[navigator.language]`) |
 * | React Native (today) | `expo-localization`'s `getLocales().map(l => l.languageTag)` — see `apps/mobile/providers/LocaleProvider.tsx` |
 * | iOS | `Locale.preferredLanguages` |
 * | Android | `LocaleListCompat.getAdjustedDefault()` / `LocaleList.getDefault()`, flattened to tags |
 *
 * ## Why the port returns raw tags and not our `Locale`
 *
 * Because mapping "what the OS says" to "which of our three bundles" is a **rule**, not a
 * platform capability — and it is a rule with Hong Kong-specific judgement in it that must not
 * be re-decided per platform. `resolveLocale()` in `@nextbus/i18n` already owns it, and its
 * decisions are the reason this split matters:
 *
 * - bare `zh` → `zh-Hant`, because Traditional is the HK form;
 * - `zh-HK` / `zh-TW` / `zh-MO` / `…-Hant` → `zh-Hant`; `zh-CN` / `zh-SG` / `…-Hans` → `zh-Hans`;
 * - anything else, including unsupported languages → `en`.
 *
 * Hand three platforms `navigator.languages`-shaped input and one pure function, and they agree.
 * Hand them "return the app locale" and you get three subtly different answers for a Singapore
 * device. So: **the port detects, `resolveLocale` decides.** Keep the tags in OS order — the
 * order *is* the preference — and do not filter, lower-case or otherwise "tidy" them;
 * `resolveLocale` is already case- and separator-tolerant (`en_GB` as well as `en-GB`).
 *
 * ## What is not here
 *
 * - **The manual override.** A rider who picks a language in Settings is expressing a
 *   preference we persist ourselves, through {@link KeyValueStore} (`localeOverride` in
 *   `lib/preferences.ts`). Resolution order is override → device → `en`.
 * - **Message lookup and formatting.** `@nextbus/i18n` owns strings; the transit-data
 *   formatters in `@nextbus/core` take a `Locale` argument. Neither belongs to a platform seam.
 * - **Region, currency, calendar, 12/24-hour.** We serve one city: fares are HK$, times are
 *   24-hour, the offset is `+08:00`. Adding `Intl`-shaped surface here would invite
 *   non-determinism into exactly the layer we are keeping deterministic.
 */
export interface LocaleProvider {
  /**
   * The rider's preferred languages as **BCP-47 tags, most-preferred first**, straight from the
   * OS. Must not throw: a platform that cannot answer returns an empty array, and
   * `resolveLocale([])` yields `'en'`.
   */
  preferredLanguages(): readonly string[]
}
