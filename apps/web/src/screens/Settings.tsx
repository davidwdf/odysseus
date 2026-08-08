import { type SettingsAboutRowId, settingsView } from '@nextbus/core'
import { endonym, type PlainMessageKey, SUPPORTED_LOCALES, t } from '@nextbus/i18n'
import { APPEARANCES, type Appearance } from '@nextbus/ui'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router'
import { usePreferences } from '../lib/preferences'
import { useLocale, useLocaleOverride, useSetLocale } from '../providers/LocaleProvider'
import { ABOUT_PATH, FAQ_PATH } from '../shell/destinations'

/**
 * Settings, rendered by React DOM from the identical kernel function the React Native screen uses (WP6-7).
 *
 * It replaces `src/shell/ShellPreferences.tsx`, the scaffolding WP6-0 shipped with this work package's name
 * on it: a two-control fieldset that existed so *"the PWA switches locale"* was something that had been run
 * rather than something that had been wired. `packages/contract/ui/settings.spec.json` declares what this
 * screen must show in each of seven states, and `test/settings-states.test.tsx` drives every projected one,
 * as does its RN twin from the same file.
 *
 * **What the projection cannot see, and what the suite does about it.** Selection is a filled pill here and
 * a dot on native — nothing a walker that reads text nodes can observe — so the spec enforces that the
 * options exist, in order, with the right words, and the suite asserts `selected` directly against the
 * kernel's own answer. That division is `search.spec.json`'s, for a keypad key's `enabled`, and the reason
 * it is safe is that the flag is the *kernel's*: both renderers read one rule rather than each deciding.
 */
export function Settings() {
  const locale = useLocale()
  const navigate = useNavigate()
  const localeOverride = useLocaleOverride()
  const setLocale = useSetLocale()
  const appearance = usePreferences((s) => s.appearance)
  const setAppearance = usePreferences((s) => s.setAppearance)

  const view = settingsView<Appearance>(
    { locales: SUPPORTED_LOCALES, localeOverride, appearances: APPEARANCES, appearance },
    {
      languageAuto: t(locale, 'languageAuto'),
      // Never through `t()`: a language's name must not follow the active locale, or a reader who has
      // set the app to a language they cannot read has no word to search for.
      endonym,
      appearance: (value) => t(locale, APPEARANCE_LABEL[value as Appearance]),
      aboutRow: (id) => t(locale, ABOUT_ROW_LABEL[id]),
    },
  )

  return (
    <main className="min-h-dvh bg-bg">
      <header className="px-4 pb-3 pt-2">
        <h1 className="m-0 text-h1 font-bold text-text">{t(locale, 'tabSettings')}</h1>
      </header>

      <Section title={t(locale, 'settingsLanguage')}>
        {/* A card of rows with a dot on the chosen one — the web's reading of the RN list, and the same
            shape as the About rows below so the two read as one screen. */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {view.languages.map((option, index) => (
            <OptionRow
              key={option.value ?? 'auto'}
              label={option.label}
              selected={option.selected}
              first={index === 0}
              onSelect={() => setLocale(option.value)}
            />
          ))}
        </div>
      </Section>

      <Section title={t(locale, 'settingsAppearance')}>
        {/* A segmented control, as on native: three equal buttons in one track, the chosen one filled. */}
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
          {view.appearances.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.selected}
              onClick={() => setAppearance(option.value)}
              className={`min-h-[40px] flex-1 rounded-md text-label focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                option.selected
                  ? 'bg-accent font-semibold text-accent-contrast'
                  : 'font-medium text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t(locale, 'settingsAbout')}>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {view.about.map((row, index) => (
            <button
              key={row.id}
              type="button"
              onClick={() => navigate(ABOUT_ROW_PATH[row.id])}
              className={`flex min-h-[52px] w-full items-center gap-3 bg-transparent px-4 py-3 text-left text-body text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                index === 0 ? '' : 'border-0 border-t border-solid border-border'
              }`}
            >
              <span className="flex-1">{row.label}</span>
              {/* An SVG rather than a `›` character, and the suite caught the difference: a text glyph is
                  a **text node**, which the conformance walker reads whether or not it is `aria-hidden` —
                  so the web row would have projected one more string than the RN row, which draws an icon.
                  The same blind spot the FAQ turns on, arriving from the opposite direction. */}
              <ChevronRight aria-hidden width={20} height={20} className="shrink-0 text-subtle" />
            </button>
          ))}
        </div>
      </Section>
    </main>
  )
}

/** The catalogue key for each appearance — the word, where the kernel owns the order. */
const APPEARANCE_LABEL: Record<Appearance, PlainMessageKey> = {
  auto: 'appearanceAuto',
  light: 'appearanceLight',
  dark: 'appearanceDark',
}

// Keyed on the kernel's own union rather than on `string`, so both lookups are exhaustive: adding a row to
// `SETTINGS_ABOUT_ROWS` is a typecheck failure here until it has a word and a destination, where a
// `Record<string, …>` would have silently yielded `undefined` and drawn a blank row.
const ABOUT_ROW_LABEL: Record<SettingsAboutRowId, PlainMessageKey> = {
  'about-data': 'aboutData',
  faq: 'settingsFaq',
}

const ABOUT_ROW_PATH: Record<SettingsAboutRowId, string> = {
  'about-data': ABOUT_PATH,
  faq: FAQ_PATH,
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 pb-6">
      <h2 className="mb-2 mt-0 text-label font-normal text-subtle">{title}</h2>
      {children}
    </section>
  )
}

/**
 * One language row.
 *
 * `aria-pressed` rather than a radio group: these are toggles over a persisted value, applied on the spot
 * with no submit, which is what the RN screen's `accessibilityState={{ selected }}` says too. The dot is
 * `aria-hidden` because `aria-pressed` already carries the state — drawing it *and* announcing it twice is
 * how a screen reader ends up saying "selected, selected".
 */
function OptionRow({
  label,
  selected,
  first,
  onSelect,
}: {
  label: string
  selected: boolean
  first: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-[52px] w-full items-center gap-3 bg-transparent px-4 py-3 text-left text-body text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
        first ? '' : 'border-0 border-t border-solid border-border'
      } ${selected ? 'font-semibold' : ''}`}
    >
      <span className="flex-1">{label}</span>
      {selected ? <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </button>
  )
}
