import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from './Text'

export interface FilterChip {
  key: string
  /**
   * A plain `string`, deliberately — and it is the ADR-054 line rather than a weakening of the brand.
   *
   * Since WP6-5 the chip set is `searchView`'s: the kernel decides *which* chips exist (the operators come
   * from the index, so a fifth one appears the day its adapter lands) and the caller injects the *words*.
   * A `LocalizedString` cannot survive that round trip — the kernel may not import `@nextbus/i18n` — so the
   * brand is laundered at the injection boundary, on purpose and in one place. The same call
   * `PlaceGroup.heading` makes for the same reason: what is a rule is the joining, and what is a word is the
   * catalogue's.
   *
   * The brand still does its job where it can: `searchView`'s `labels.category` is typed to take a
   * `PlainMessageKey`, so an English literal cannot reach a chip without passing through `t()` first.
   */
  label: string
  active: boolean
}

/**
 * A horizontal row of toggle chips for search filters (operator / route category —
 * ADR-037). Active = accent fill; inactive = tokened outline. The chip set is passed
 * in, so operators are data-driven from the index (GMB/MTR appear automatically once
 * those adapters land) and categories are added by extending the caller's list.
 */
export function FilterChips({
  chips,
  onToggle,
}: {
  chips: FilterChip[]
  onToggle: (key: string) => void
}) {
  if (chips.length === 0) return null
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // So a chip tap registers in one go while the stop field has focus (the blur would
      // otherwise eat the first tap — see the Segment note in search.tsx).
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingLeft: 16, paddingRight: 16, gap: 8 }}
    >
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          // Both props: `accessibilityState` is read on native and dropped by react-native-web;
          // `aria-pressed` is read on the web and is not a React Native prop at all. See the long note in
          // `app/(tabs)/settings.tsx` — one fact, two spellings, neither platform reading the other's.
          accessibilityState={{ selected: chip.active }}
          aria-pressed={chip.active}
          onPress={() => onToggle(chip.key)}
          className={`rounded-full px-3.5 py-1.5 active:opacity-60 ${
            chip.active ? 'bg-accent' : 'border border-border bg-surface'
          }`}
        >
          <Text
            variant="label"
            weight="medium"
            className={chip.active ? 'text-accent-contrast' : 'text-muted'}
          >
            {chip.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

/** A spacer wrapper that keeps the chip row a consistent height in the layout. */
export function FilterChipsBar({ children }: { children: ReactNode }) {
  return <View className="py-2">{children}</View>
}
