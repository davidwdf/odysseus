import {
  EMPTY_FILTER,
  type RouteCategory,
  type RouteFilter,
  type SearchRouteRow,
  type SearchStopRow,
  searchView,
  toggleSearchChip,
} from '@nextbus/core'
import { type LocalizedString, operatorName, type PlainMessageKey, t } from '@nextbus/i18n'
import { useRouter } from 'expo-router'
import {
  ChevronRight,
  Keyboard,
  type LucideIcon,
  MapPin,
  Route,
  Search,
  X,
} from 'lucide-react-native'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FilterChips, FilterChipsBar } from '../components/FilterChips'
import { BackButton } from '../components/GlassIconButton'
import { Icon } from '../components/Icon'
import { RouteChip } from '../components/RouteChip'
import { RouteKeypad } from '../components/RouteKeypad'
import { Skeleton } from '../components/Skeleton'
import { StopName } from '../components/StopName'
import { Text } from '../components/Text'
import { usePreferences } from '../lib/preferences'
import { useSearchIndex } from '../lib/searchIndex'
import { useTheme } from '../lib/useTheme'
import { useLocale } from '../providers/LocaleProvider'

type Mode = 'routes' | 'stops'

const CATEGORY_LABELS: Record<RouteCategory, PlainMessageKey> = {
  night: 'filterNight',
  airport: 'filterAirport',
  express: 'filterExpress',
}
const _CATEGORIES: RouteCategory[] = ['night', 'airport', 'express']
/** Gap below the keypad / results — this page has no tab bar, so just clear the safe area. */
const BOTTOM_GAP = 12

export default function SearchScreen() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { color } = useTheme()
  const { index, loading, error } = useSearchIndex()

  const [mode, setMode] = useState<Mode>('routes')
  const [routeQuery, setRouteQuery] = useState('')
  const [stopQuery, setStopQuery] = useState('')
  const [stopFocused, setStopFocused] = useState(false)
  const stopInputRef = useRef<TextInput>(null)
  const [filter, setFilter] = useState<RouteFilter>(EMPTY_FILTER)
  // Keypad dismiss-on-scroll: scrolling down the results collapses the keypad (like the OS
  // keyboard), so browsing gets the whole screen; tapping the number field brings it back.
  // onScrollBeginDrag covers touch instantly; onScroll catches wheel scrolling on web, where
  // drag events never fire — downward movement only, so overscroll bounce doesn't dismiss.
  const [padShown, setPadShown] = useState(true)
  const lastScrollY = useRef(0)
  const onResultsScroll = (y: number) => {
    if (y > lastScrollY.current + 2 && y > 10) setPadShown(false)
    lastScrollY.current = y
  }

  const recentRoutes = usePreferences((s) => s.recentRoutes)
  const recentStops = usePreferences((s) => s.recentStops)
  const pushRecentRoute = usePreferences((s) => s.pushRecentRoute)
  const pushRecentStop = usePreferences((s) => s.pushRecentStop)
  const clearRecentRoutes = usePreferences((s) => s.clearRecentRoutes)
  const clearRecentStops = usePreferences((s) => s.clearRecentStops)

  /**
   * **The whole screen's content, in one call** (WP6-5). Seven decisions used to live here as `useMemo`s:
   * which operator chips exist at all, which chips this mode offers, which of them are on, which route
   * numbers the keypad keeps live under the active filter, which letters its letter row shows, what a saved
   * *recent* resolves to now the index has been rebuilt, and whether the list is showing a search or a
   * history — every one of them reachable only by rendering this tree. They are `searchView` now, pinned by
   * 12 corpus cases, so `apps/web`'s Search screen calls the identical function.
   *
   * The **words** it composes with are handed in, never imported by the kernel (ADR-054: core owns the rule,
   * the catalogue owns the word) — a chip carries its own label because the label is what a renderer draws
   * and the *set* is what the kernel decides.
   *
   * No `useMemo`: `searchView` is pure and this screen re-renders on a keystroke either way, so memoizing
   * would add a dependency array that has to stay correct for no measured gain. The six it replaced each
   * had one.
   */
  const view = index
    ? searchView(
        {
          index,
          mode,
          query: mode === 'routes' ? routeQuery : stopQuery,
          filter,
          recentRouteIds: recentRoutes,
          recentStopIds: recentStops,
        },
        {
          locale,
          labels: {
            operator: (op) => operatorName(op, locale),
            category: (c) => t(locale, CATEGORY_LABELS[c]),
          },
        },
      )
    : undefined

  // The whole of what this screen does with a chip: hand the key straight back. `searchView` minted it and
  // `toggleSearchChip` reads it, so the key's *format* is known in one place and a renderer never takes one
  // apart. This screen used to `split(':')` it and cast the halves to two different unions, which read
  // exactly like ad-hoc id parsing and was flagged by the gate that bans it (ADR-091).
  const onToggleChip = (key: string) => setFilter((f) => toggleSearchChip(f, key))

  // The union narrowed once. `mode` selects the branch that draws each, so the other is always empty —
  // written here rather than inside the JSX so neither list is read through an inline cast.
  const rows = view?.list.kind === 'routes' ? view.list.routes : []
  const stops = view?.list.kind === 'stops' ? view.list.stops : []

  const openRoute = (id: string) => {
    pushRecentRoute(id)
    router.push(`/route/${encodeURIComponent(id)}`)
  }
  const openStop = (id: string) => {
    pushRecentStop(id)
    router.push(`/stop/${encodeURIComponent(id)}`)
  }

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* Header: the standard 48px back button to the left of the Routes / Stops segment. Layout
          (gap-3 px-4 pb-1 pt-4, default GlassIconButton size) matches the other pushed-page headers
          — about-data and faq. The route/stop screens use a different, floating collapsing header. */}
      <View className="flex-row items-center gap-3 px-4 pb-1 pt-4">
        <BackButton onPress={() => router.back()} accessibilityLabel={t(locale, 'back')} />
        <View className="flex-1">
          <Segment
            mode={mode}
            onChange={(m) => {
              setMode(m)
              setPadShown(true)
            }}
            routesLabel={t(locale, 'searchSegRoutes')}
            stopsLabel={t(locale, 'searchSegStops')}
          />
        </View>
      </View>

      {loading ? (
        <LoadingState />
      ) : error || !index || !view ? (
        <Centered>
          <Text variant="body" className="text-center text-danger">
            {error?.message ?? t(locale, 'searchNoResults')}
          </Text>
        </Centered>
      ) : mode === 'routes' ? (
        <>
          <NumberField
            value={routeQuery}
            placeholder={t(locale, 'searchRoutePrompt')}
            padHidden={!padShown}
            onPress={() => setPadShown(true)}
            onClear={() => {
              setRouteQuery('')
              setPadShown(true)
            }}
          />
          <FilterChipsBar>
            <FilterChips chips={view.chips} onToggle={onToggleChip} />
          </FilterChipsBar>
          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => setPadShown(false)}
            onScroll={(e) => onResultsScroll(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={32}
          >
            {/* Which of the three arms to draw is `view.source`'s answer, not a second reading of the
                query: "nothing matched" and "nothing searched" are different sentences, and the screen used
                to decide between them by re-testing `routeQuery === ''` beside a length check. */}
            {view.source === 'none' ? (
              <Empty label={t(locale, 'searchNoResults')} />
            ) : (
              <>
                {view.source === 'recents' ? (
                  <RecentsHeader
                    label={t(locale, 'searchRecent')}
                    clearLabel={t(locale, 'searchClearRecent')}
                    onClear={clearRecentRoutes}
                    empty={rows.length === 0}
                  />
                ) : null}
                {rows.map((r, i) => (
                  <View key={r.id} className={i === 0 ? '' : 'border-border border-t'}>
                    <RouteResultRow route={r} onPress={() => openRoute(r.id)} />
                  </View>
                ))}
              </>
            )}
          </ScrollView>
          <CollapsibleFooter shown={padShown}>
            <View
              className="border-border border-t pt-3"
              style={{ paddingBottom: insets.bottom + BOTTOM_GAP }}
            >
              <RouteKeypad keypad={view.keypad} value={routeQuery} onChange={setRouteQuery} />
            </View>
          </CollapsibleFooter>
        </>
      ) : (
        <>
          {/* Same footprint as the route NumberField (mx-4, h-12). Tapping anywhere — including the
              icon/padding — focuses the input; the *whole box* border lights on focus (the inner
              input's own outline is suppressed on web). */}
          <Pressable
            onPress={() => stopInputRef.current?.focus()}
            className={`mx-4 mb-1 mt-1 h-12 flex-row items-center gap-2 rounded-xl border bg-surface px-4 ${
              stopFocused ? 'border-accent' : 'border-border'
            }`}
          >
            <Icon icon={Search} tone="subtle" size={18} />
            <TextInput
              ref={stopInputRef}
              value={stopQuery}
              onChangeText={setStopQuery}
              onFocus={() => setStopFocused(true)}
              onBlur={() => setStopFocused(false)}
              placeholder={t(locale, 'searchStopPlaceholder')}
              placeholderTextColor={color('--text-subtle')}
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
              style={[
                { flex: 1, height: '100%', color: color('--text'), fontSize: 16 },
                // @ts-expect-error react-native-web: drop the inner input's focus outline — the
                // box border is the focus indicator (no effect / ignored on native).
                Platform.OS === 'web' ? { outlineStyle: 'none' } : null,
              ]}
            />
            {stopQuery !== '' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setStopQuery('')
                  stopInputRef.current?.focus()
                }}
                hitSlop={8}
              >
                <Icon icon={X} tone="muted" size={18} />
              </Pressable>
            ) : null}
          </Pressable>
          <FilterChipsBar>
            <FilterChips chips={view.chips} onToggle={onToggleChip} />
          </FilterChipsBar>
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <View style={{ paddingBottom: insets.bottom + BOTTOM_GAP }}>
              {view.source === 'none' ? (
                <Empty label={t(locale, 'searchNoResults')} />
              ) : (
                <>
                  {view.source === 'recents' ? (
                    <RecentsHeader
                      label={t(locale, 'searchRecent')}
                      clearLabel={t(locale, 'searchClearRecent')}
                      onClear={clearRecentStops}
                      empty={stops.length === 0}
                    />
                  ) : null}
                  {stops.map((stop, i) => (
                    <View key={stop.id} className={i === 0 ? '' : 'border-border border-t'}>
                      <StopResultRow stop={stop} onPress={() => openStop(stop.id)} />
                    </View>
                  ))}
                </>
              )}
            </View>
          </ScrollView>
        </>
      )}
    </View>
  )
}

function Segment({
  mode,
  onChange,
  routesLabel,
  stopsLabel,
}: {
  mode: Mode
  onChange: (m: Mode) => void
  routesLabel: LocalizedString
  stopsLabel: LocalizedString
}) {
  const Item = ({
    value,
    label,
    glyph,
  }: {
    value: Mode
    label: LocalizedString
    glyph: LucideIcon
  }) => {
    const active = mode === value
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        // onPressIn (press-down): when the Stops text field is focused, the first outside tap is
        // consumed blurring it (react-native-web terminates the press responder on blur, so
        // onPress never fires → the dreaded two-tap). Press-down lands before that. onPress stays
        // too — it's what keyboard activation (Enter/Space → click) reaches; duplicate calls are
        // idempotent.
        onPressIn={() => onChange(value)}
        onPress={() => onChange(value)}
        className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${
          active ? 'bg-bg' : ''
        }`}
      >
        <Icon icon={glyph} tone={active ? 'text' : 'muted'} size={16} />
        <Text
          variant="label"
          weight={active ? 'bold' : 'medium'}
          className={active ? 'text-text' : 'text-muted'}
        >
          {label}
        </Text>
      </Pressable>
    )
  }
  return (
    <View className="flex-row gap-1 rounded-xl border border-border bg-surface p-1">
      <Item value="routes" label={routesLabel} glyph={Route} />
      <Item value="stops" label={stopsLabel} glyph={MapPin} />
    </View>
  )
}

/** Read-only display of the keypad-entered route number (no OS keyboard). Tapping it re-opens
 *  a dismissed keypad — a subtle keypad glyph on the right signals that while it's hidden. */
function NumberField({
  value,
  placeholder,
  padHidden,
  onPress,
  onClear,
}: {
  value: string
  placeholder: LocalizedString
  padHidden: boolean
  onPress: () => void
  onClear: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mb-1 mt-1 h-12 flex-row items-center justify-between rounded-xl border border-border bg-surface px-4"
    >
      {value === '' ? (
        <Text variant="body" className="text-subtle">
          {placeholder}
        </Text>
      ) : (
        <Text variant="h2" weight="bold" tabular className="text-text">
          {value}
        </Text>
      )}
      <View className="flex-row items-center gap-3">
        {padHidden ? <Icon icon={Keyboard} tone="subtle" size={18} /> : null}
        {value !== '' ? (
          <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8}>
            <Icon icon={X} tone="muted" size={18} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}

/** Collapses the keypad footer to zero height (and back) with a short ease — the search page's
 *  keyboard-dismiss. Children keep their natural height inside; the wrapper clips. */
function CollapsibleFooter({ shown, children }: { shown: boolean; children: ReactNode }) {
  const [contentH, setContentH] = useState(0)
  const progress = useSharedValue(1)
  useEffect(() => {
    progress.value = withTiming(shown ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    })
  }, [shown, progress])
  const style = useAnimatedStyle(
    () => (contentH > 0 ? { height: progress.value * contentH, opacity: progress.value } : {}),
    [contentH],
  )
  return (
    <Animated.View style={[{ overflow: 'hidden' }, style]}>
      <View onLayout={(e) => setContentH(e.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  )
}

/** One route result. It decides nothing: both ends of the journey arrive title-cased on the row, and the
 *  arrow between them is the glyph this renderer supplies — the same split `StopRow` makes. */
function RouteResultRow({ route, onPress }: { route: SearchRouteRow; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
    >
      <RouteChip operator={route.operator} routeNo={route.routeNo} />
      <Text variant="body" className="flex-1 text-text" numberOfLines={1}>
        <Text className="text-subtle">{route.origin}</Text>
        {/* Its own node — see the DOM twin. */}
        <Text className="text-subtle"> → </Text>
        {route.destination}
      </Text>
      <Icon icon={ChevronRight} tone="subtle" size={20} />
    </Pressable>
  )
}

/** One stop result. The printed code is already split off the name (ADR-034), by the model. */
function StopResultRow({ stop, onPress }: { stop: SearchStopRow; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center justify-between gap-3 px-4 py-3.5 active:opacity-60"
    >
      <View className="flex-1">
        <StopName name={stop.name} variant="body" />
      </View>
      <Icon icon={ChevronRight} tone="subtle" size={20} />
    </Pressable>
  )
}

/**
 * The heading above a history list, with its clear control — all that is left of `RecentRoutes` and
 * `RecentStops` (WP6-5).
 *
 * Those two were the same twelve lines twice, and what differed between them was the *rows*, which
 * `searchView` now produces in one shape per mode. `empty` renders nothing at all rather than a heading with
 * no list under it: a rider who has searched for nothing yet should see the screen they would see before
 * they had a history, not a label announcing an absence.
 */
function RecentsHeader({
  label,
  clearLabel,
  onClear,
  empty,
}: {
  label: LocalizedString
  clearLabel: LocalizedString
  onClear: () => void
  empty: boolean
}) {
  if (empty) return null
  return <SectionLabel label={label} clearLabel={clearLabel} onClear={onClear} />
}

function SectionLabel({
  label,
  clearLabel,
  onClear,
}: {
  label: LocalizedString
  clearLabel?: LocalizedString
  onClear?: () => void
}) {
  return (
    <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
      <Text variant="label" weight="medium" className="text-muted">
        {label}
      </Text>
      {onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          onPress={onClear}
          hitSlop={8}
          className="flex-row items-center gap-1"
        >
          <Icon icon={X} tone="muted" size={14} />
          <Text variant="label" weight="medium" className="text-muted">
            {clearLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Empty({ label }: { label: LocalizedString }) {
  return (
    <Text variant="body" className="px-4 pt-6 text-center text-muted">
      {label}
    </Text>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center px-6">{children}</View>
}

function LoadingState() {
  return (
    <View className="px-4 pt-2">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className={`py-3.5 ${i === 0 ? '' : 'border-border border-t'}`}>
          <Skeleton className="h-5 w-1/2" />
        </View>
      ))}
    </View>
  )
}
