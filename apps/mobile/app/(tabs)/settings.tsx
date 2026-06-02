import type { Messages } from '@nextbus/i18n'
import { t } from '@nextbus/i18n'
import { type Appearance, LIVERIES, type LiveryId } from '@nextbus/ui'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '../../components/Text'
import { usePreferences } from '../../lib/preferences'
import { useLocale } from '../../providers/LocaleProvider'

const APPEARANCES: { value: Appearance; labelKey: keyof Messages }[] = [
  { value: 'auto', labelKey: 'appearanceAuto' },
  { value: 'light', labelKey: 'appearanceLight' },
  { value: 'dark', labelKey: 'appearanceDark' },
]

export default function Settings() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const livery = usePreferences((s) => s.livery)
  const appearance = usePreferences((s) => s.appearance)
  const setLivery = usePreferences((s) => s.setLivery)
  const setAppearance = usePreferences((s) => s.setAppearance)

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}
    >
      <View className="px-4 pb-4 pt-2">
        <Text variant="h1" className="text-text">
          {t(locale, 'tabSettings')}
        </Text>
      </View>

      {/* Appearance: auto (default) / light / dark — independent of the livery. */}
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

      {/* Theme / livery: colour identity. Each ships both light + dark, so it
          combines freely with the appearance choice above. */}
      <Section title={t(locale, 'settingsTheme')}>
        <View className="overflow-hidden rounded-lg border border-border bg-surface">
          {LIVERIES.map((l, i) => (
            <LiveryRow
              key={l.id}
              label={t(locale, l.labelKey as keyof Messages)}
              swatch={l.swatch}
              selected={livery === l.id}
              first={i === 0}
              onPress={() => setLivery(l.id as LiveryId)}
            />
          ))}
        </View>
      </Section>
    </ScrollView>
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

function LiveryRow({
  label,
  swatch,
  selected,
  first,
  onPress,
}: {
  label: string
  swatch: string
  selected: boolean
  first: boolean
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
      <View
        className="h-6 w-6 rounded-full border border-border"
        style={{ backgroundColor: swatch }}
      />
      <Text variant="body" weight={selected ? 'semibold' : 'regular'} className="flex-1 text-text">
        {label}
      </Text>
      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
    </Pressable>
  )
}
