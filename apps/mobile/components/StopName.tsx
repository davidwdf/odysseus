import type { StopCardName } from '@nextbus/core'
import type { TypeVariant } from '@nextbus/ui'
import { Text } from './Text'

/**
 * The single way to render a bus-stop name across the app (ADR-034): the name proper with the
 * operator's own stop code beside it, a step smaller and muted. Keeps Nearby, Favourites and the
 * route schematic visually consistent.
 *
 * **The split is no longer done here.** It is `displayName` in `@nextbus/core` (WP4-0). Which part of
 * a name is the code, and that the code comes off *before* title-casing so "ST935" is not turned into
 * "St935", are rules — and rules a second renderer would otherwise have had to rediscover by reading
 * this file. What remains here is the only genuinely presentational part: the size, the tone and the
 * vertical alignment.
 */
export function StopName({
  name,
  variant = 'h3',
  emphasis = false,
  numberOfLines,
}: {
  name: StopCardName
  /** Type role for the name (heading vs in-list). The code stays one step smaller/muted. */
  variant?: TypeVariant
  /** Highlight (e.g. the origin stop on the route schematic). */
  emphasis?: boolean
  numberOfLines?: number
}) {
  return (
    <Text
      variant={variant}
      className={emphasis ? 'font-semibold text-accent' : 'text-text'}
      numberOfLines={numberOfLines}
    >
      {name.label}
      {name.code ? (
        // verticalAlign centres the smaller code within the line rather than letting it sit on
        // the name's baseline (low). Effective on web/PWA; native keeps baseline for now.
        <Text variant="caption" className="text-subtle" style={{ verticalAlign: 'middle' }}>
          {'  '}
          {name.code}
        </Text>
      ) : null}
    </Text>
  )
}
