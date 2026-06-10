import type { Locale } from '@nextbus/core'
import { type Messages, t } from '@nextbus/i18n'
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

// External sources we attribute (docs/02). The terms link is locale-aware so it
// lands on the user's language; the source portals are single hosts.
const TERMS_URL: Record<Locale, string> = {
  en: 'https://data.gov.hk/en/terms-and-conditions',
  'zh-Hant': 'https://data.gov.hk/tc/terms-and-conditions',
  'zh-Hans': 'https://data.gov.hk/sc/terms-and-conditions',
}
const GOVHK_URL = 'https://data.gov.hk'
const KMB_URL = 'https://data.etabus.gov.hk'
const CTB_URL = 'https://www.citybus.com.hk'

export default function AboutData() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // expo-config `version` (app.json); shown plainly so testers can quote a build.
  const version = Constants.expoConfig?.version ?? '0.0.0'

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
            {t(locale, 'aboutIntro')}
          </Text>
        </View>

        {/* Sources — full-width link rows, each opens the source in a new tab. */}
        <Section title={t(locale, 'aboutSourcesTitle')}>
          <LinkRow titleKey="aboutGovHk" bodyKey="aboutGovHkBody" url={GOVHK_URL} locale={locale} />
          <LinkRow titleKey="aboutKmb" bodyKey="aboutKmbBody" url={KMB_URL} locale={locale} />
          <LinkRow titleKey="aboutCtb" bodyKey="aboutCtbBody" url={CTB_URL} locale={locale} />
        </Section>

        {/* Licence — a single link row to the (locale-aware) terms. */}
        <Section title={t(locale, 'aboutLicenceTitle')}>
          <LinkRow
            titleKey="aboutTerms"
            bodyKey="aboutTermsBody"
            url={TERMS_URL[locale]}
            locale={locale}
          />
        </Section>

        <View className="px-4 pt-4">
          <Text variant="caption" className="text-subtle">
            {t(locale, 'aboutVersion')} {version}
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

function LinkRow({
  titleKey,
  bodyKey,
  url,
  locale,
}: {
  titleKey: keyof Messages
  bodyKey: keyof Messages
  url: string
  locale: Locale
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => openExternal(url)}
      className="flex-row items-center gap-3 rounded-xl px-4 py-2.5 active:bg-surface"
    >
      <View className="flex-1 gap-0.5">
        <Text variant="body" weight="semibold" className="text-accent">
          {t(locale, titleKey)}
        </Text>
        <Text variant="body" className="text-muted">
          {t(locale, bodyKey)}
        </Text>
      </View>
      <Icon icon={ExternalLink} tone="accent" size={18} />
    </Pressable>
  )
}
