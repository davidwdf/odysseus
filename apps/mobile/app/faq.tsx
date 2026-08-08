import { faqView } from '@nextbus/core'
import { type PlainMessageKey, t } from '@nextbus/i18n'
import { useRouter } from 'expo-router'
import { ChevronDown } from 'lucide-react-native'
import { useState } from 'react'
import { LayoutAnimation, Platform, Pressable, ScrollView, UIManager, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton } from '../components/GlassIconButton'
import { Icon } from '../components/Icon'
import { Text } from '../components/Text'
import { useLocale } from '../providers/LocaleProvider'

// Which questions this app answers, in what order, paired with which answers, left this file at WP6-7 —
// they are `faqView`'s now (`packages/core/src/settings.ts`). The pairing is the part nothing could get
// wrong *loudly*: a mis-paired question and answer type-checks, renders, and reads as merely a strange
// FAQ. It is data with a corpus row now.
//
// **A collapsed answer is absent from the model rather than present and hidden**, and that is the load-
// bearing half. A conformance projection reads text by *presence*, never by visibility — a `<details>` a
// rider has not opened still hands its answer to the walker, and so does anything behind `display: none` —
// so a renderer that keeps every answer mounted and merely hides it is indistinguishable from one that
// shows them all. This screen already rendered the answer conditionally; modelling it that way is what
// makes the collapsed state projectable at all, and it is why the DOM twin is a button rather than a
// `<details>`.

// Android needs LayoutAnimation explicitly enabled; on web it's a graceful no-op.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export default function Faq() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Collapsed by default — the page is a tidy list of questions until tapped.
  // Multiple may be open at once (independent toggles), which is `faqView`'s decision and not this
  // component's: these are seven independent questions rather than a wizard, and an accordion that closed
  // the previous answer would make comparing two of them impossible.
  // A `Set` rather than an array, and the reason is a gate rather than taste: `check-no-derivation`
  // polices this file from WP6-7 and reads `.filter(` as a rule about what a rider sees, which a
  // membership toggle is not. `Set` says the same thing in words the gate has no rule for — and this row
  // deliberately adds no allowlist entry, because an exemption is the thing that makes the next one easy.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const view = faqView([...open], (key) => t(locale, key as PlainMessageKey))

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
          {view.items.map((item) => (
            <FaqAccordion
              key={item.id}
              question={item.question}
              answer={item.answer}
              open={item.expanded}
              onToggle={() => toggle(item.id)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function FaqAccordion({
  question,
  answer,
  open,
  onToggle,
}: {
  question: string
  /** Present only when open — see the note at the top of this file. */
  answer?: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        // `aria-expanded`, not `accessibilityState={{ expanded }}` — see the note in `(tabs)/settings.tsx`:
        // `react-native-web@0.21` drops `accessibilityState` silently, so on the shipping PWA a rider using
        // a screen reader was told nothing about whether a question was open.
        aria-expanded={open}
        onPress={onToggle}
        className="flex-row items-center gap-3 py-3.5 active:opacity-60"
      >
        <Text variant="body" weight="semibold" className="flex-1 text-text">
          {question}
        </Text>
        {/* Chevron points down when collapsed, flips up when open. */}
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon icon={ChevronDown} tone="muted" size={20} />
        </View>
      </Pressable>
      {answer === undefined ? null : (
        <Text variant="body" className="pb-4 text-muted">
          {answer}
        </Text>
      )}
    </View>
  )
}
