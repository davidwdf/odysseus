import type { Locale } from '@nextbus/core'
import { type Messages, t } from '@nextbus/i18n'
import { useRouter } from 'expo-router'
import { ChevronDown } from 'lucide-react-native'
import { useState } from 'react'
import { LayoutAnimation, Platform, Pressable, ScrollView, UIManager, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton } from '../components/GlassIconButton'
import { Icon } from '../components/Icon'
import { Text } from '../components/Text'
import { useLocale } from '../providers/LocaleProvider'

// Each entry is a question/answer string pair in @nextbus/i18n. Add a pair here
// (and its keys to Messages) to grow the FAQ — no layout change needed.
const ITEMS: { q: keyof Messages; a: keyof Messages }[] = [
  { q: 'faqFreshnessQ', a: 'faqFreshnessA' },
  { q: 'faqTimingsQ', a: 'faqTimingsA' },
  { q: 'faqCoverageQ', a: 'faqCoverageA' },
  { q: 'faqMergeQ', a: 'faqMergeA' },
  { q: 'faqOfflineQ', a: 'faqOfflineA' },
  { q: 'faqMapQ', a: 'faqMapA' },
  { q: 'faqRemarksQ', a: 'faqRemarksA' },
]

// Android needs LayoutAnimation explicitly enabled; on web it's a graceful no-op.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export default function Faq() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Collapsed by default — the page is a tidy list of questions until tapped.
  // Multiple may be open at once (independent toggles).
  const [open, setOpen] = useState<Set<number>>(() => new Set())

  const toggle = (i: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* Floating glass back lens — the app-wide standard (matches the route header / search). */}
      <View className="flex-row items-center gap-3 px-4 pb-1 pt-4">
        <BackButton onPress={() => router.back()} accessibilityLabel={t(locale, 'back')} />
        <Text variant="h2" weight="bold" className="flex-1 text-text">
          {t(locale, 'settingsFaq')}
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View className="px-4 pt-2">
          {ITEMS.map((item, i) => (
            <FaqAccordion
              key={item.q}
              q={item.q}
              a={item.a}
              locale={locale}
              open={open.has(i)}
              onToggle={() => toggle(i)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function FaqAccordion({
  q,
  a,
  locale,
  open,
  onToggle,
}: {
  q: keyof Messages
  a: keyof Messages
  locale: Locale
  open: boolean
  onToggle: () => void
}) {
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="flex-row items-center gap-3 py-3.5 active:opacity-60"
      >
        <Text variant="body" weight="semibold" className="flex-1 text-text">
          {t(locale, q)}
        </Text>
        {/* Chevron points down when collapsed, flips up when open. */}
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon icon={ChevronDown} tone="muted" size={20} />
        </View>
      </Pressable>
      {open ? (
        <Text variant="body" className="pb-4 text-muted">
          {t(locale, a)}
        </Text>
      ) : null}
    </View>
  )
}
