import { aboutView } from '@nextbus/core'
import { type PlainMessageKey, t } from '@nextbus/i18n'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { ExternalLink } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton } from '../components/GlassIconButton'
import { Icon } from '../components/Icon'
import { Text } from '../components/Text'
import { openExternal } from '../lib/openExternal'
import { useLocale } from '../providers/LocaleProvider'

// Which sources this app credits, in what order, with which URL — and the locale-aware terms links — left
// this file at WP6-7. They are `aboutView`'s now (`packages/core/src/settings.ts`), because attribution is
// an **obligation** rather than content: three of the six rows were missing here and each closed a
// decision that had been taken and never actioned (the basemap, ADR-049 decision 5; green minibus, a
// shipped operator this page did not credit; and the consolidated crawl every route and fare is built
// from, ADR-021's own decision). An obligation living as loose JSX in one renderer is one a second
// renderer can simply not have.
//
// The terms URL is the strongest kernel rule on this screen: the portals' path slugs are `en`/`tc`/`sc`
// and ours are `en`/`zh-Hant`/`zh-Hans`, so it is neither the identity nor a `toLowerCase()` — and a
// renderer inventing `zh-hant` lands a rider on a 404 in the one place the app sends them to read a
// licence.

export default function AboutData() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // expo-config `version` (app.json); shown plainly so testers can quote a build.
  const version = Constants.expoConfig?.version ?? '0.0.0'
  const view = aboutView(locale, {
    text: (key) => t(locale, key as PlainMessageKey),
    version,
  })

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* Pushed page (no tab bar): the floating glass back lens, same chrome as /search. */}
      <View className="flex-row items-center gap-3 px-4 pb-1 pt-4">
        <BackButton onPress={() => router.back()} accessibilityLabel={t(locale, 'back')} />
        <Text variant="h2" weight="bold" className="flex-1 text-text">
          {t(locale, 'aboutData')}
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View className="px-4 pb-2 pt-2">
          <Text variant="body" className="text-muted">
            {view.intro}
          </Text>
        </View>

        {/* Sources — full-width link rows, each opens the source in a new tab. */}
        <Section title={t(locale, 'aboutSourcesTitle')}>
          {view.sources.map((row) => (
            <LinkRow key={row.id} title={row.title} body={row.body} url={row.url} />
          ))}
        </Section>

        {/* Licences — one row per licence actually in force. Two since WP6-7: the basemap arrived a wave
            after ADR-038 built this section for exactly one, under a different set of terms. */}
        <Section title={t(locale, 'aboutLicenceTitle')}>
          {view.licences.map((row) => (
            <LinkRow key={row.id} title={row.title} body={row.body} url={row.url} />
          ))}
        </Section>

        <View className="px-4 pt-4">
          {/* Two text nodes, not one composed string — the kernel keeps the label and the number apart so
              that a projection can pin the order rather than a renderer's spacing (ADR-092). */}
          <Text variant="caption" className="text-subtle">
            {view.version.label} {view.version.value}
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="pt-6">
      <Text variant="label" className="mb-1 px-4 text-subtle">
        {title}
      </Text>
      {/* Rows are separated by whitespace — no dividers, no cards. */}
      <View className="gap-1">{children}</View>
    </View>
  )
}

function LinkRow({ title, body, url }: { title: string; body: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => openExternal(url)}
      className="flex-row items-center gap-3 rounded-xl px-4 py-2.5 active:bg-surface"
    >
      <View className="flex-1 gap-0.5">
        <Text variant="body" weight="semibold" className="text-accent">
          {title}
        </Text>
        <Text variant="body" className="text-muted">
          {body}
        </Text>
      </View>
      <Icon icon={ExternalLink} tone="accent" size={18} />
    </Pressable>
  )
}
