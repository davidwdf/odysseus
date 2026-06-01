import type { Eta, Locale } from '@nextbus/core'
import { OPERATOR_ACCENT } from '@nextbus/ui'
import { Text, View } from 'react-native'
import { EtaBadge } from './EtaBadge'

function routeNo(routeId: string): string {
  return routeId.split(':')[1] ?? routeId
}

export function StopCard({
  name,
  etas,
  locale,
  now,
}: {
  name: string
  etas: Eta[]
  locale: Locale
  now: number
}) {
  return (
    <View className="rounded-lg border border-border bg-surface p-4">
      <Text className="mb-3 text-base font-semibold text-text">{name}</Text>
      <View className="gap-3">
        {etas.map((eta) => (
          <View key={eta.routeId} className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              {/* Operator accent used sparingly — just the route-number chip. */}
              <View
                className="rounded-md px-2 py-1"
                style={{ backgroundColor: OPERATOR_ACCENT[eta.operator] }}
              >
                <Text
                  className="text-sm font-bold"
                  style={{ color: eta.operator === 'CTB' ? '#0F172A' : '#FFFFFF' }}
                >
                  {routeNo(eta.routeId)}
                </Text>
              </View>
              {eta.remark?.[locale] ? (
                <Text className="text-sm text-muted">{eta.remark[locale]}</Text>
              ) : null}
            </View>
            <EtaBadge eta={eta} locale={locale} now={now} />
          </View>
        ))}
      </View>
    </View>
  )
}
