import {
  buildRouteTrie,
  EMPTY_FILTER,
  indexAlphabet,
  type Locale,
  type OperatorId,
  type RouteCategory,
  type RouteFilter,
  type RouteLite,
  routeMatchesFilter,
  type StopLite,
  searchRoutes,
  searchStops,
} from '@nextbus/core'
import { type Messages, t } from '@nextbus/i18n'
import { useRouter } from 'expo-router'
import { ChevronRight, type LucideIcon, MapPin, Route, Search, X } from 'lucide-react-native'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
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
import { titleCaseName } from '../lib/stopName'
import { useTheme } from '../lib/useTheme'
import { useLocale } from '../providers/LocaleProvider'

type Mode = 'routes' | 'stops'

const CATEGORY_LABELS: Record<RouteCategory, keyof Messages> = {
  night: 'filterNight',
  airport: 'filterAirport',
  express: 'filterExpress',
}
const CATEGORIES: RouteCategory[] = ['night', 'airport', 'express']
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

  const recentRoutes = usePreferences((s) => s.recentRoutes)
  const recentStops = usePreferences((s) => s.recentStops)
  const pushRecentRoute = usePreferences((s) => s.pushRecentRoute)
  const pushRecentStop = usePreferences((s) => s.pushRecentStop)

  // Operators present in the index drive the operator chips — so GMB/MTR appear
  // automatically the day those adapters land (ADR-037), no UI change needed.
  const operators = useMemo<OperatorId[]>(
    () => (index ? [...new Set(index.routes.map((r) => r.operator))].sort() : []),
    [index],
  )

  // Keypad + route search both honour the active filter, so dimmed keys and the
  // result list always agree on what's findable.
  const filteredRouteNos = useMemo(
    () =>
      index ? index.routes.filter((r) => routeMatchesFilter(r, filter)).map((r) => r.routeNo) : [],
    [index, filter],
  )
  const trie = useMemo(() => buildRouteTrie(filteredRouteNos), [filteredRouteNos])
  const letters = useMemo(() => indexAlphabet(filteredRouteNos).letters, [filteredRouteNos])

  const routeResults = useMemo(
    () => (index ? searchRoutes(index.routes, routeQuery, filter) : []),
    [index, routeQuery, filter],
  )
  const stopResults = useMemo(
    () => (index ? searchStops(index.stops, stopQuery, locale, filter.operators) : []),
    [index, stopQuery, locale, filter.operators],
  )

  const recentRouteItems = useMemo(
    () =>
      index
        ? recentRoutes
            .map((id) => index.routes.find((r) => r.id === id))
            .filter((r): r is RouteLite => Boolean(r))
        : [],
    [index, recentRoutes],
  )
  const recentStopItems = useMemo(
    () =>
      index
        ? recentStops
            .map((id) => index.stops.find((s) => s.id === id))
            .filter((s): s is StopLite => Boolean(s))
        : [],
    [index, recentStops],
  )

  const toggleOperator = (op: OperatorId) =>
    setFilter((f) => ({
      ...f,
      operators: f.operators.includes(op)
        ? f.operators.filter((o) => o !== op)
        : [...f.operators, op],
    }))
  const toggleCategory = (c: RouteCategory) =>
    setFilter((f) => ({
      ...f,
      categories: f.categories.includes(c)
        ? f.categories.filter((x) => x !== c)
        : [...f.categories, c],
    }))

  const opChips = operators.map((op) => ({
    key: `op:${op}`,
    label: op,
    active: filter.operators.includes(op),
  }))
  const catChips = CATEGORIES.map((c) => ({
    key: `cat:${c}`,
    label: t(locale, CATEGORY_LABELS[c]),
    active: filter.categories.includes(c),
  }))
  const chips = mode === 'routes' ? [...opChips, ...catChips] : opChips
  const onToggleChip = (key: string) => {
    const [kind, val] = key.split(':')
    if (kind === 'op') toggleOperator(val as OperatorId)
    else if (kind === 'cat') toggleCategory(val as RouteCategory)
  }

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
            onChange={setMode}
            routesLabel={t(locale, 'searchSegRoutes')}
            stopsLabel={t(locale, 'searchSegStops')}
          />
        </View>
      </View>

      {loading ? (
        <LoadingState />
      ) : error || !index ? (
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
            onClear={() => setRouteQuery('')}
          />
          <FilterChipsBar>
            <FilterChips chips={chips} onToggle={onToggleChip} />
          </FilterChipsBar>
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {routeQuery === '' ? (
              <RecentRoutes
                items={recentRouteItems}
                locale={locale}
                label={t(locale, 'searchRecent')}
                onOpen={openRoute}
              />
            ) : routeResults.length === 0 ? (
              <Empty label={t(locale, 'searchNoResults')} />
            ) : (
              routeResults.map((r, i) => (
                <View key={r.id} className={i === 0 ? '' : 'border-border border-t'}>
                  <RouteResultRow route={r} locale={locale} onPress={() => openRoute(r.id)} />
                </View>
              ))
            )}
          </ScrollView>
          <View
            className="border-border border-t pt-3"
            style={{ paddingBottom: insets.bottom + BOTTOM_GAP }}
          >
            <RouteKeypad
              value={routeQuery}
              trie={trie}
              letters={letters}
              onChange={setRouteQuery}
            />
          </View>
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
            <FilterChips chips={chips} onToggle={onToggleChip} />
          </FilterChipsBar>
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <View style={{ paddingBottom: insets.bottom + BOTTOM_GAP }}>
              {stopQuery === '' ? (
                <RecentStops
                  items={recentStopItems}
                  locale={locale}
                  label={t(locale, 'searchRecent')}
                  onOpen={openStop}
                />
              ) : stopResults.length === 0 ? (
                <Empty label={t(locale, 'searchNoResults')} />
              ) : (
                stopResults.map((s, i) => (
                  <View key={s.id} className={i === 0 ? '' : 'border-border border-t'}>
                    <StopResultRow stop={s} locale={locale} onPress={() => openStop(s.id)} />
                  </View>
                ))
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
  routesLabel: string
  stopsLabel: string
}) {
  const Item = ({ value, label, glyph }: { value: Mode; label: string; glyph: LucideIcon }) => {
    const active = mode === value
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        // onPressIn (press-down), not onPress: when the Stops text field is focused, the first
        // outside tap is consumed blurring it (react-native-web terminates the press responder on
        // blur, so onPress never fires → the dreaded two-tap). Press-down lands before that.
        onPressIn={() => onChange(value)}
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

/** Read-only display of the keypad-entered route number (no OS keyboard). */
function NumberField({
  value,
  placeholder,
  onClear,
}: {
  value: string
  placeholder: string
  onClear: () => void
}) {
  return (
    <View className="mx-4 mb-1 mt-1 h-12 flex-row items-center justify-between rounded-xl border border-border bg-surface px-4">
      {value === '' ? (
        <Text variant="body" className="text-subtle">
          {placeholder}
        </Text>
      ) : (
        <Text variant="h2" weight="bold" tabular className="text-text">
          {value}
        </Text>
      )}
      {value !== '' ? (
        <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8}>
          <Icon icon={X} tone="muted" size={18} />
        </Pressable>
      ) : null}
    </View>
  )
}

function RouteResultRow({
  route,
  locale,
  onPress,
}: {
  route: RouteLite
  locale: Locale
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
    >
      <RouteChip operator={route.operator} routeNo={route.routeNo} />
      <Text variant="body" className="flex-1 text-text" numberOfLines={1}>
        <Text className="text-subtle">{titleCaseName(route.origin[locale])} → </Text>
        {titleCaseName(route.destination[locale])}
      </Text>
      <Icon icon={ChevronRight} tone="subtle" size={20} />
    </Pressable>
  )
}

function StopResultRow({
  stop,
  locale,
  onPress,
}: {
  stop: StopLite
  locale: Locale
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center justify-between gap-3 px-4 py-3.5 active:opacity-60"
    >
      <View className="flex-1">
        <StopName name={stop.name[locale]} variant="body" />
      </View>
      <Icon icon={ChevronRight} tone="subtle" size={20} />
    </Pressable>
  )
}

function RecentRoutes({
  items,
  locale,
  label,
  onOpen,
}: {
  items: RouteLite[]
  locale: Locale
  label: string
  onOpen: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <View>
      <SectionLabel label={label} />
      {items.map((r, i) => (
        <View key={r.id} className={i === 0 ? '' : 'border-border border-t'}>
          <RouteResultRow route={r} locale={locale} onPress={() => onOpen(r.id)} />
        </View>
      ))}
    </View>
  )
}

function RecentStops({
  items,
  locale,
  label,
  onOpen,
}: {
  items: StopLite[]
  locale: Locale
  label: string
  onOpen: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <View>
      <SectionLabel label={label} />
      {items.map((s, i) => (
        <View key={s.id} className={i === 0 ? '' : 'border-border border-t'}>
          <StopResultRow stop={s} locale={locale} onPress={() => onOpen(s.id)} />
        </View>
      ))}
    </View>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Text variant="label" weight="medium" className="px-4 pb-1 pt-3 text-muted">
      {label}
    </Text>
  )
}

function Empty({ label }: { label: string }) {
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
