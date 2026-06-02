import type { Eta, Locale } from '@nextbus/core'
import { OPERATOR_ACCENT, OPERATOR_ACCENT_TEXT } from '@nextbus/ui'
import { View } from 'react-native'
import { Card } from './Card'
import { EtaBadge } from './EtaBadge'
import { Text } from './Text'

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
    <Card className="p-4">
      <Text variant="h3" className="mb-3 text-text">
        {name}
      </Text>
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
                  variant="label"
                  weight="bold"
                  style={{ color: OPERATOR_ACCENT_TEXT[eta.operator] }}
                >
                  {routeNo(eta.routeId)}
                </Text>
              </View>
              {eta.remark?.[locale] ? (
                <Text variant="label" className="text-muted">
                  {eta.remark[locale]}
                </Text>
              ) : null}
            </View>
            <EtaBadge eta={eta} locale={locale} now={now} />
          </View>
        ))}
      </View>
    </Card>
  )
}
