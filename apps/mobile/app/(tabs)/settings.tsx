import { type SettingsAboutRowId, settingsView } from '@nextbus/core'
import {
  endonym,
  type LocalizedString,
  type PlainMessageKey,
  SUPPORTED_LOCALES,
  t,
} from '@nextbus/i18n'
import { APPEARANCES, type Appearance } from '@nextbus/ui'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon } from '../../components/Icon'
import { Text } from '../../components/Text'
import { usePreferences } from '../../lib/preferences'
import { useTabBarLayout } from '../../lib/tabBarLayout'
import { useLocale, useLocaleOverride, useSetLocale } from '../../providers/LocaleProvider'

// The two option tables and the About-row list left this file at WP6-7: they are `settingsView`'s now
// (`packages/core/src/settings.ts`), with the ordered memberships coming from the packages that own each
// type — `SUPPORTED_LOCALES` from the catalogue, `APPEARANCES` from the tokens. What the kernel decides is
// the part that was a rule: that "Automatic" is an option rather than an absence and comes first, and
// which one row in each group is lit.
//
// **The selectedness is why this is worth a kernel call at all.** A language is chosen by the OVERRIDE and
// never by the resolved locale — `useLocale()` and `useLocaleOverride()` are both in scope below, four
// lines apart, and reading the wrong one lights two rows for a rider on an English device who has never
// touched the picker. An appearance is chosen by the RAW preference and never by `resolveMode`'s answer.
// Both are one `===` away and neither is expressible as a type; both are corpus rows now.
//
// The label for each option is INJECTED rather than looked up inside the kernel (ADR-054: core owns the
// rule, the catalogue owns the word). `endonym` is the interesting one: a language's name must NOT follow
// the active locale, because a reader whose UI is Chinese and who wants English has to be able to find the
// word "English".

export default function Settings() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const appearance = usePreferences((s) => s.appearance)
  const setAppearance = usePreferences((s) => s.setAppearance)
  const localeOverride = useLocaleOverride()
  const setLocale = useSetLocale()
  const router = useRouter()

  const view = settingsView<Appearance>(
    {
      locales: SUPPORTED_LOCALES,
      localeOverride,
      appearances: APPEARANCES,
      appearance,
    },
    {
      languageAuto: t(locale, 'languageAuto'),
      endonym,
      appearance: (value) => t(locale, APPEARANCE_LABEL[value as Appearance]),
      aboutRow: (id) => t(locale, ABOUT_ROW_LABEL[id]),
    },
  )

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: tab.contentInset }}
    >
      <View className="px-4 pb-4 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'tabSettings')}
        </Text>
      </View>

      {/* Language: Automatic (follow device) + per-language endonyms; persisted. */}
      <Section title={t(locale, 'settingsLanguage')}>
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          {view.languages.map((option, index) => (
            <OptionRow
              key={option.value ?? 'auto'}
              label={option.label}
              selected={option.selected}
              first={index === 0}
              onPress={() => setLocale(option.value)}
            />
          ))}
        </View>
      </Section>

      {/* Appearance: auto (default) / light / dark — the one Ink theme (ADR-029). */}
      <Section title={t(locale, 'settingsAppearance')}>
        <View className="flex-row gap-1 rounded-lg bg-surface-2 p-1">
          {view.appearances.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: option.selected }}
              aria-pressed={option.selected}
              onPress={() => setAppearance(option.value)}
              className={`min-h-[40px] flex-1 items-center justify-center rounded-md ${
                option.selected ? 'bg-accent' : ''
              }`}
            >
              <Text
                variant="label"
                weight={option.selected ? 'semibold' : 'medium'}
                className={option.selected ? 'text-accent-contrast' : 'text-muted'}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>

      {/* About: data attribution + licence and the FAQ each live on their own
          screen (P10, ADR-038) to keep this list clean — rows push to them. */}
      <Section title={t(locale, 'settingsAbout')}>
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          {view.about.map((row, index) => (
            <NavRow
              key={row.id}
              label={row.label}
              first={index === 0}
              onPress={() => router.push(ABOUT_ROW_PATH[row.id])}
            />
          ))}
        </View>
      </Section>
    </ScrollView>
  )
}

/** The catalogue key for each appearance — the word, where the kernel owns the order. */
const APPEARANCE_LABEL: Record<Appearance, PlainMessageKey> = {
  auto: 'appearanceAuto',
  light: 'appearanceLight',
  dark: 'appearanceDark',
}

// Keyed on the kernel's own union rather than on `string`, so both lookups are exhaustive: adding a row to
// `SETTINGS_ABOUT_ROWS` is a typecheck failure here until it has a word and a destination.
const ABOUT_ROW_LABEL: Record<SettingsAboutRowId, PlainMessageKey> = {
  'about-data': 'aboutData',
  faq: 'settingsFaq',
}

const ABOUT_ROW_PATH: Record<SettingsAboutRowId, '/about-data' | '/faq'> = {
  'about-data': '/about-data',
  faq: '/faq',
}

// `label` is a plain `string` on both rows below and not a `LocalizedString`: the kernel has already
// picked the word out of the catalogue for the active locale, so branding it again would be laundering it
// through the wrong door. Same choice, same reason, as the Place screen's kernel-composed headings.
function NavRow({
  label,
  onPress,
  first,
}: {
  label: string
  onPress: () => void
  first?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${
        first ? '' : 'border-t border-border'
      }`}
    >
      <Text variant="body" className="flex-1 text-text">
        {label}
      </Text>
      <Icon icon={ChevronRight} tone="subtle" size={20} />
    </Pressable>
  )
}

function Section({ title, children }: { title: LocalizedString; children: ReactNode }) {
  return (
    <View className="px-4 pb-6">
      <Text variant="label" className="mb-2 text-subtle">
        {title}
      </Text>
      {children}
    </View>
  )
}

function OptionRow({
  label,
  selected,
  first,
  onPress,
}: {
  label: string
  selected: boolean
  first?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      // **Both props, and neither is redundant** — this is the one place in the app where the two
      // platforms need different spellings of one fact, so it is worth the two lines.
      //
      // `react-native-web@0.21` forwards the modern `aria-*` props and **drops `accessibilityState`
      // entirely**, so on the shipping Expo PWA this control announced no state at all: the selection was
      // a dot and a font weight and nothing a screen reader could read. Measured while writing this
      // screen's conformance suite (WP6-7).
      //
      // But `aria-pressed` is **not a React Native prop**. RN 0.85 declares fourteen `aria-*` props and
      // that is not among them, so on iOS and Android it is dropped exactly the way `accessibilityState`
      // is dropped on the web — the same defect, one platform over. (It type-checks because
      // `PressableProps` widens; the type system is no help here, which is the whole lesson.) Found by
      // WP6-7b's parity audit, hours after the first fix shipped.
      //
      // So: `accessibilityState` is read on native and ignored on web; `aria-pressed` is read on web and
      // ignored on native. `aria-selected` would satisfy both mechanically and is wrong on the web, where
      // `aria-selected` on a `button` is not valid ARIA and a screen reader may drop it.
      accessibilityState={{ selected }}
      aria-pressed={selected}
      onPress={onPress}
      className={`min-h-[52px] flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${
        first ? '' : 'border-t border-border'
      }`}
    >
      <Text variant="body" weight={selected ? 'semibold' : 'regular'} className="flex-1 text-text">
        {label}
      </Text>
      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </Pressable>
  )
}
