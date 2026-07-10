import { nextValidChars, type RouteTrieNode } from '@nextbus/core'
import { Delete } from 'lucide-react-native'
import { type ReactNode, useMemo } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Icon } from './Icon'
import { Text } from './Text'

// The smart route-number keypad (ADR-037). Digits sit in a compact keyboard-style
// 5×2 strip (1–5 / 6–0) with a double-height backspace on the right — half the
// height of the old phone-style 3×4 pad, so results keep the screen. The letters
// HK route numbers actually use sit in a single horizontally-scrollable row above
// it. Digits are always shown, dimmed when they can't continue the number; letters
// are **filtered to only the valid next ones** as you type (fewer, changing options —
// clearer than a wall of dimmed keys), both driven by a prefix-trie lookup. There is
// no clear key: the number field's ✕ clears, and long-pressing backspace does too.
// The letter row runs edge-to-edge: default left inset, items overflowing under the
// right edge, with matching padding once scrolled.

const DIGIT_ROWS: string[][] = [
  ['1', '2', '3', '4', '5'],
  ['6', '7', '8', '9', '0'],
]

function Key({
  label,
  enabled,
  onPress,
  onLongPress,
  tall,
  children,
}: {
  label?: string
  enabled: boolean
  onPress: () => void
  onLongPress?: () => void
  /** Stretch to the full grid height (the backspace column) instead of one row. */
  tall?: boolean
  children?: ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={label}
      disabled={!enabled}
      onPress={onPress}
      onLongPress={onLongPress}
      className={`flex-1 items-center justify-center rounded-xl border border-border bg-surface ${
        tall ? '' : 'h-11'
      } ${enabled ? 'active:opacity-60' : 'opacity-25'}`}
    >
      {children ?? (
        <Text variant="h3" weight="bold" tabular className="text-text">
          {label}
        </Text>
      )}
    </Pressable>
  )
}

export function RouteKeypad({
  value,
  trie,
  letters,
  onChange,
}: {
  value: string
  trie: RouteTrieNode
  /** Letters this dataset's route numbers ever use, in a stable order. */
  letters: string[]
  onChange: (next: string) => void
}) {
  const valid = useMemo(() => nextValidChars(trie, value), [trie, value])
  const validLetters = useMemo(() => letters.filter((ch) => valid.has(ch)), [letters, valid])
  const append = (ch: string) => onChange(value + ch)
  const backspace = () => onChange(value.slice(0, -1))

  return (
    <View className="gap-2">
      {/* Letters — one scrollable row above the numbers, filtered to the valid next letters.
          Edge-to-edge: 16px lead inset, items run off the right edge, 16px trailing inset
          revealed once scrolled all the way (the app's horizontal-scroll rule). */}
      {validLetters.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingLeft: 16, paddingRight: 16 }}
        >
          {validLetters.map((ch) => (
            <Pressable
              key={ch}
              accessibilityRole="button"
              accessibilityLabel={ch}
              onPress={() => append(ch)}
              className="min-w-[40px] items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 active:opacity-60"
            >
              <Text variant="label" weight="bold" className="text-text">
                {ch}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Digit strip — keyboard order (1–5 / 6–0), backspace spanning both rows on the right.
          Long-press backspace clears the whole number. */}
      <View className="flex-row gap-2 px-4">
        <View className="flex-[5] gap-2">
          {DIGIT_ROWS.map((row) => (
            <View key={row[0]} className="flex-row gap-2">
              {row.map((d) => (
                <Key key={d} label={d} enabled={valid.has(d)} onPress={() => append(d)} />
              ))}
            </View>
          ))}
        </View>
        <Key
          label="Backspace"
          tall
          enabled={value.length > 0}
          onPress={backspace}
          onLongPress={() => onChange('')}
        >
          <Icon icon={Delete} tone={value.length > 0 ? 'text' : 'muted'} size={22} />
        </Key>
      </View>
    </View>
  )
}
