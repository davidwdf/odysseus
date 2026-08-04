import type { Locale } from '@nextbus/core'
import { endonym, type LocalizedString, type PlainMessageKey, t } from '@nextbus/i18n'
import type { Appearance } from '@nextbus/ui'
import { usePreferences } from '../lib/preferences'
import { useLocale, useLocaleOverride, useSetLocale } from '../providers/LocaleProvider'

/**
 * The shell's own language and appearance controls — **scaffolding, and the one thing in WP6-0 that a
 * rider can see.**
 *
 * ## Why it exists at all, given "zero screens ported"
 *
 * WP6-0's acceptance is that the PWA *"opens offline and switches locale, with zero screens ported"*.
 * The two halves pull against each other: a locale override that nothing can operate is a claim about
 * plumbing, and this repo's standard is that a claim is exactly as large as what has been run. So the
 * shell carries the smallest control that makes the override real, and it is deliberately **not** the
 * Settings screen: no sections, no glass, no navigation rows, no `Text` primitive, no spec. WP6-7 ports
 * the real screen against a spec extracted from `apps/mobile/app/(tabs)/settings.tsx` and **deletes this
 * file**; it is named as a deletion in `docs/11` so that "temporary" has an owner.
 *
 * What it does share with the RN screen is everything that is identity: the same catalogue keys, the same
 * option order, `null` for *follow the device*, and language names as **endonyms** — a reader whose UI is
 * Chinese and who wants English must be able to find the word "English", which is why `endonym()` is the
 * documented exception in `@nextbus/i18n` rather than three literals here.
 */
const APPEARANCES: readonly { value: Appearance; labelKey: PlainMessageKey }[] = [
  { value: 'auto', labelKey: 'appearanceAuto' },
  { value: 'light', labelKey: 'appearanceLight' },
  { value: 'dark', labelKey: 'appearanceDark' },
]

const LANGUAGES: readonly Locale[] = ['en', 'zh-Hant', 'zh-Hans']

export function ShellPreferences() {
  const locale = useLocale()
  const override = useLocaleOverride()
  const setLocale = useSetLocale()
  const appearance = usePreferences((s) => s.appearance)
  const setAppearance = usePreferences((s) => s.setAppearance)

  return (
    <div className="mt-6 flex flex-col gap-6">
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 p-0 text-label text-subtle">{t(locale, 'settingsLanguage')}</legend>
        <div className="flex flex-wrap gap-2">
          <Choice
            label={t(locale, 'languageAuto')}
            selected={override === null}
            onSelect={() => setLocale(null)}
          />
          {LANGUAGES.map((l) => (
            <Choice
              key={l}
              label={endonym(l)}
              selected={override === l}
              onSelect={() => setLocale(l)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 p-0 text-label text-subtle">
          {t(locale, 'settingsAppearance')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {APPEARANCES.map((option) => (
            <Choice
              key={option.value}
              label={t(locale, option.labelKey)}
              selected={appearance === option.value}
              onSelect={() => setAppearance(option.value)}
            />
          ))}
        </div>
      </fieldset>
    </div>
  )
}

/**
 * One option.
 *
 * `aria-pressed` rather than a radio group: these are toggles over a persisted value, applied on the
 * spot with no submit, which is what the RN screen's `accessibilityState={{ selected }}` says too. The
 * ≥44 px minimum height is identity (ADR-075's spacing row), not a look.
 */
function Choice({
  label,
  selected,
  onSelect,
}: {
  label: LocalizedString
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`min-h-[44px] rounded-pill border px-4 text-label focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
        selected
          ? 'border-accent bg-accent font-semibold text-accent-contrast'
          : 'border-border bg-surface text-text'
      }`}
    >
      {label}
    </button>
  )
}
