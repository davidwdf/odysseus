import type { TypeVariant } from '@nextbus/ui'
import { splitStopCode, titleCaseName } from '../lib/stopName'
import { Text } from './Text'

/**
 * The single way to render a bus-stop name across the app (ADR-034): the title-cased
 * name with the operator stop code split off and rendered smaller/muted. Keeps Nearby,
 * Favourites and the route schematic visually consistent. CJK names pass through
 * unchanged (see `titleCaseName`).
 */
export function StopName({
  name,
  variant = 'h3',
  emphasis = false,
  numberOfLines,
}: {
  name: string
  /** Type role for the name (heading vs in-list). The code stays one step smaller/muted. */
  variant?: TypeVariant
  /** Highlight (e.g. the origin stop on the route schematic). */
  emphasis?: boolean
  numberOfLines?: number
}) {
  const { label, code } = splitStopCode(name)
  return (
    <Text
      variant={variant}
      className={emphasis ? 'font-semibold text-accent' : 'text-text'}
      numberOfLines={numberOfLines}
    >
      {titleCaseName(label)}
      {code ? (
        <Text variant="caption" className="text-subtle">
          {'  '}
          {code}
        </Text>
      ) : null}
    </Text>
  )
}
