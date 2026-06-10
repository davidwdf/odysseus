import type { Locale } from '@nextbus/core'
import type { Messages } from '@nextbus/i18n'
import { t } from '@nextbus/i18n'
import type { Appearance } from '@nextbus/ui'
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

const APPEARANCES: { value: Appearance; labelKey: keyof Messages }[] = [
  { value: 'auto', labelKey: 'appearanceAuto' },
  { value: 'light', labelKey: 'appearanceLight' },
  { value: 'dark', labelKey: 'appearanceDark' },
]

// Language endonyms are shown in their own script regardless of the active UI locale;
// only "Automatic" (follow device) is localized.
const LANGUAGES: { value: Locale | null; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'zh-Hans', label: '简体中文' },
]

export default function Settings() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const tab = useTabBarLayout()
  const appearance = usePreferences((s) => s.appearance)
  const setAppearance = usePreferences((s) => s.setAppearance)
  const localeOverride = useLocaleOverride()
  const setLocale = useSetLocale()
  const router = useRouter()

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
          <OptionRow
            label={t(locale, 'languageAuto')}
            selected={localeOverride === null}
            first
            onPress={() => setLocale(null)}
          />
          {LANGUAGES.map((l) => (
            <OptionRow
              key={l.value}
              label={l.label}
              selected={localeOverride === l.value}
              onPress={() => setLocale(l.value)}
            />
          ))}
        </View>
      </Section>

      {/* Appearance: auto (default) / light / dark — the one Ink theme (ADR-029). */}
      <Section title={t(locale, 'settingsAppearance')}>
        <View className="flex-row gap-1 rounded-lg bg-surface-2 p-1">
          {APPEARANCES.map((opt) => {
            const selected = appearance === opt.value
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setAppearance(opt.value)}
                className={`min-h-[40px] flex-1 items-center justify-center rounded-md ${
                  selected ? 'bg-accent' : ''
                }`}
              >
                <Text
                  variant="label"
                  weight={selected ? 'semibold' : 'medium'}
                  className={selected ? 'text-accent-contrast' : 'text-muted'}
                >
                  {t(locale, opt.labelKey)}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </Section>

      {/* About: data attribution + licence and the FAQ each live on their own
          screen (P10, ADR-038) to keep this list clean — rows push to them. */}
      <Section title={t(locale, 'settingsAbout')}>
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          <NavRow label={t(locale, 'aboutData')} onPress={() => router.push('/about-data')} first />
          <NavRow label={t(locale, 'settingsFaq')} onPress={() => router.push('/faq')} />
        </View>
      </Section>
    </ScrollView>
  )
}

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

function Section({ title, children }: { title: string; children: ReactNode }) {
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
      accessibilityState={{ selected }}
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
