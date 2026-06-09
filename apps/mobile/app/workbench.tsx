import type { Eta, OperatorId } from '@nextbus/core'
import { type Messages, t } from '@nextbus/i18n'
import {
  type Appearance,
  LIVERIES,
  OPERATOR_ACCENT,
  RADIUS,
  TYPE_SCALE,
  type TypeVariant,
} from '@nextbus/ui'
import { Stack } from 'expo-router'
import {
  Bell,
  Bus,
  ChevronRight,
  Clock,
  type LucideIcon,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  Star,
} from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EtaBadge } from '../components/EtaBadge'
import { GlassView } from '../components/GlassView'
import { Icon, type IconTone } from '../components/Icon'
import { RouteChip } from '../components/RouteChip'
import { SaveButton } from '../components/SaveButton'
import { Skeleton } from '../components/Skeleton'
import { StopRow } from '../components/StopRow'
import { Text } from '../components/Text'
import { usePreferences } from '../lib/preferences'
import { useLocale } from '../providers/LocaleProvider'

// Design Workbench — a live gallery of every foundation + component in each state,
// rendered through the REAL theme store so what you see is what ships. Reachable at
// /workbench on web (not linked in the tab bar). The canonical surface for revising
// component designs and the design rules in docs/09. Dev-facing.

/** Build a believable ETA for the gallery without hitting the network. */
function mockEta(
  routeId: string,
  operator: OperatorId,
  mins: number[],
  opts: { stale?: boolean; remark?: string } = {},
): Eta {
  const now = Date.now()
  return {
    routeId,
    stopId: 'WB',
    operator,
    arrivals: mins.map((m) => new Date(now + m * 60_000).toISOString()),
    remark: opts.remark
      ? { en: opts.remark, 'zh-Hant': opts.remark, 'zh-Hans': opts.remark }
      : undefined,
    dataTimestamp: new Date(now - (opts.stale ? 120_000 : 4_000)).toISOString(),
    observedAt: new Date(now).toISOString(),
  }
}

// Literal class strings so Tailwind's scanner generates them (no dynamic `bg-${x}`).
const COLOR_SWATCHES: Array<{ label: string; cls: string }> = [
  { label: 'bg', cls: 'bg-bg' },
  { label: 'surface', cls: 'bg-surface' },
  { label: 'surface-2', cls: 'bg-surface-2' },
  { label: 'border', cls: 'bg-border' },
  { label: 'text', cls: 'bg-text' },
  { label: 'muted', cls: 'bg-muted' },
  { label: 'subtle', cls: 'bg-subtle' },
  { label: 'accent', cls: 'bg-accent' },
  { label: 'accent-contrast', cls: 'bg-accent-contrast' },
  { label: 'focus', cls: 'bg-focus' },
  { label: 'positive', cls: 'bg-positive' },
  { label: 'warning', cls: 'bg-warning' },
  { label: 'danger', cls: 'bg-danger' },
]

const TYPE_ORDER: TypeVariant[] = ['display', 'h1', 'h2', 'h3', 'body', 'label', 'caption']
const APPEARANCES: Appearance[] = ['auto', 'light', 'dark']

// A representative slice of the Lucide set we draw on, with their semantic role.
const ICON_SAMPLES: Array<{ icon: LucideIcon; label: string }> = [
  { icon: MapPin, label: 'MapPin' },
  { icon: Navigation, label: 'Navigation' },
  { icon: RouteIcon, label: 'Route' },
  { icon: Bus, label: 'Bus' },
  { icon: Star, label: 'Star' },
  { icon: Clock, label: 'Clock' },
  { icon: Search, label: 'Search' },
  { icon: Bell, label: 'Bell' },
  { icon: SettingsIcon, label: 'Settings' },
  { icon: ChevronRight, label: 'ChevronRight' },
]

const ICON_TONES: IconTone[] = [
  'text',
  'muted',
  'subtle',
  'accent',
  'positive',
  'warning',
  'danger',
]

export default function Workbench() {
  const insets = useSafeAreaInsets()
  const locale = useLocale()
  const now = Date.now()

  const livery = usePreferences((s) => s.livery)
  const setLivery = usePreferences((s) => s.setLivery)
  const appearance = usePreferences((s) => s.appearance)
  const setAppearance = usePreferences((s) => s.setAppearance)

  const single = [
    mockEta('KMB:6:outbound:1', 'KMB', [0.2]),
    mockEta('KMB:1A:outbound:1', 'KMB', [4], { remark: 'Scheduled' }),
    mockEta('KMB:9:outbound:1', 'KMB', [13]),
  ]
  const merged = [
    mockEta('CTB:12:inbound:1', 'CTB', [0.2]),
    mockEta('KMB:680X:outbound:1', 'KMB', [6]),
    mockEta('CTB:720:inbound:1', 'CTB', [11]),
  ]

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Controls — drive the real theme store so the whole gallery (and Card's
          light/dark rule) renders faithfully. */}
      <View className="border-border border-b px-4 pb-3 pt-2">
        <Text variant="h2" className="text-text">
          Design Workbench
        </Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {LIVERIES.map((l) => {
            const on = l.id === livery
            return (
              <Pressable
                key={l.id}
                accessibilityRole="button"
                onPress={() => setLivery(l.id)}
                className={`flex-row items-center gap-2 rounded-full border px-3 py-1.5 ${
                  on ? 'border-accent bg-surface-2' : 'border-border'
                }`}
              >
                <View className="h-3 w-3 rounded-full" style={{ backgroundColor: l.swatch }} />
                <Text variant="label" className={on ? 'text-text' : 'text-muted'}>
                  {t(locale, l.labelKey as keyof Messages)}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <View className="mt-2 flex-row gap-2">
          {APPEARANCES.map((a) => {
            const on = a === appearance
            return (
              <Pressable
                key={a}
                accessibilityRole="button"
                onPress={() => setAppearance(a)}
                className={`rounded-full border px-3 py-1.5 ${
                  on ? 'border-accent bg-accent' : 'border-border'
                }`}
              >
                <Text variant="label" className={on ? 'text-accent-contrast' : 'text-muted'}>
                  {a}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Section title="TYPE SCALE">
          {TYPE_ORDER.map((v) => (
            <View key={v}>
              <Text variant={v} className="text-text">
                Bus arrives 巴士 24
              </Text>
              <Text variant="caption" className="text-subtle">
                {v} · {TYPE_SCALE[v].fontSize}/{TYPE_SCALE[v].lineHeight} · {TYPE_SCALE[v].weight}
              </Text>
            </View>
          ))}
        </Section>

        <Section title="COLOUR TOKENS">
          <View className="flex-row flex-wrap gap-3">
            {COLOR_SWATCHES.map((s) => (
              <View key={s.label} className="items-center">
                <View className={`h-12 w-16 rounded-md border border-border ${s.cls}`} />
                <Text variant="caption" className="mt-1 text-subtle">
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
          <View className="mt-2 flex-row flex-wrap gap-3">
            {(Object.keys(OPERATOR_ACCENT) as Array<keyof typeof OPERATOR_ACCENT>).map((op) => (
              <View key={op} className="items-center">
                <View
                  className="h-12 w-16 rounded-md border border-border"
                  style={{ backgroundColor: OPERATOR_ACCENT[op] }}
                />
                <Text variant="caption" className="mt-1 text-subtle">
                  {op}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="RADIUS">
          <View className="flex-row flex-wrap items-end gap-3">
            {(Object.keys(RADIUS) as Array<keyof typeof RADIUS>).map((k) => (
              <View key={k} className="items-center">
                <View className="h-14 w-14 bg-accent" style={{ borderRadius: RADIUS[k] }} />
                <Text variant="caption" className="mt-1 text-subtle">
                  {k} · {RADIUS[k]}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="ELEVATION (e0–e3)">
          <View className="flex-row flex-wrap gap-4">
            {(['e0', 'e1', 'e2', 'e3'] as const).map((lvl) => (
              <Card key={lvl} level={lvl} className="h-16 w-20 items-center justify-center">
                <Text variant="label" className="text-text">
                  {lvl}
                </Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section title="GLASS — liquid material (content shows through)">
          <View className="h-44 overflow-hidden rounded-lg border border-border">
            {/* Busy content filling the whole box, so the refraction is visible across
                the entire pane/lens (not just the rim). */}
            <View className="absolute inset-0 flex-row flex-wrap content-start gap-2 p-3">
              {(
                [
                  ['KMB', '6'],
                  ['CTB', '720'],
                  ['KMB', '182'],
                  ['LWB', 'E11'],
                  ['CTB', '85A'],
                  ['KMB', '49X'],
                  ['KMB', 'N691'],
                  ['CTB', '12'],
                  ['KMB', '1A'],
                  ['CTB', '5B'],
                  ['LWB', 'A21'],
                  ['KMB', '68X'],
                  ['CTB', '90'],
                  ['KMB', '203'],
                  ['CTB', '788'],
                  ['KMB', '40'],
                  ['LWB', 'A22'],
                  ['KMB', '7'],
                  ['CTB', '11'],
                  ['KMB', '234X'],
                ] as Array<[OperatorId, string]>
              ).map(([op, no]) => (
                <RouteChip key={`${op}${no}`} operator={op} routeNo={no} />
              ))}
            </View>
            <View
              style={StyleSheet.absoluteFill}
              className="flex-row items-center justify-center gap-3"
            >
              {/* Subtle panel glass (as on the tab bar). */}
              <GlassView
                radius={16}
                blur={4}
                className="items-center px-5 py-4"
                tintClassName="bg-surface/55"
              >
                <Text variant="label" weight="semibold" className="text-text">
                  Glass
                </Text>
                <Text variant="caption" className="text-muted">
                  subtle
                </Text>
              </GlassView>
              {/* Strong refraction — the magnifier "lens" (low tint shows the bend). */}
              <GlassView
                lens
                radius={9999}
                className="h-24 w-24 items-center justify-center"
                tintClassName="bg-surface/15"
              >
                <Text variant="caption" weight="semibold" className="text-text">
                  Lens
                </Text>
              </GlassView>
            </View>
          </View>
          <Text variant="caption" className="text-subtle">
            web: real SVG refraction (backdrop bends) · native: expo-blur fallback
          </Text>
        </Section>

        <Section title="ICONS (Lucide)">
          <View className="flex-row flex-wrap gap-4">
            {ICON_SAMPLES.map((s) => (
              <View key={s.label} className="w-16 items-center">
                <Icon icon={s.icon} tone="text" />
                <Text variant="caption" className="mt-1 text-subtle">
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="label" className="mt-3 text-subtle">
            tones (Star)
          </Text>
          <View className="flex-row flex-wrap items-center gap-4">
            {ICON_TONES.map((tn) => (
              <View key={tn} className="items-center">
                <Icon icon={Star} tone={tn} />
                <Text variant="caption" className="mt-1 text-subtle">
                  {tn}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        <Section title="ROUTE CHIPS">
          <View className="flex-row flex-wrap items-center gap-3">
            <RouteChip operator="KMB" routeNo="6" />
            <RouteChip operator="CTB" routeNo="720" />
            <RouteChip operator="LWB" routeNo="E11" />
            <RouteChip operator="KMB" routeNo="N691" />
          </View>
        </Section>

        <Section title="ETA BADGE (states)">
          <View className="gap-2">
            {(
              [
                ['due', mockEta('KMB:6:outbound:1', 'KMB', [0.2])],
                ['soon (≤5)', mockEta('KMB:6:outbound:1', 'KMB', [3])],
                ['normal', mockEta('KMB:6:outbound:1', 'KMB', [13])],
                ['stale', mockEta('KMB:6:outbound:1', 'KMB', [8], { stale: true })],
                ['none', mockEta('KMB:6:outbound:1', 'KMB', [])],
              ] as Array<[string, Eta]>
            ).map(([label, eta]) => (
              <View key={label} className="flex-row items-center justify-between">
                <Text variant="body" className="text-muted">
                  {label}
                </Text>
                <EtaBadge eta={eta} locale={locale} now={now} />
              </View>
            ))}
          </View>
        </Section>

        <Section title="BUTTONS / SAVE / SKELETON">
          <Button label="Enable location" onPress={() => {}} />
          <View className="mt-1 flex-row gap-3">
            <SaveButton stopId="workbench:demo" />
          </View>
          <Skeleton className="mt-1 h-12 w-full" />
        </Section>

        <Section title="STOP ROW — nearby list (single + merged)">
          {/* The flat list item used on the Nearby screen: no card chrome, a
              distance/walk heading, hairline dividers between stops. */}
          <View className="border-border border-y">
            <StopRow
              name="Mong Kok Road, Nathan Road"
              distanceM={90}
              etas={single}
              locale={locale}
              now={now}
              onPress={() => {}}
              onRoutePress={() => {}}
            />
            <View className="border-border border-t">
              <StopRow
                name="Jardine House, Connaught Road Central"
                distanceM={340}
                etas={merged}
                locale={locale}
                now={now}
                onPress={() => {}}
                onRoutePress={() => {}}
              />
            </View>
          </View>
        </Section>
      </ScrollView>
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mb-7">
      <Text variant="label" className="mb-2 text-subtle">
        {title}
      </Text>
      <View className="gap-3">{children}</View>
    </View>
  )
}
