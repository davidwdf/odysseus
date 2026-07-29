import type { StopCardName } from '@nextbus/core'

/** A stop name (ADR-034): the name proper, with the operator's own pole code a step smaller and muted.
 *  The split itself is `displayName` in the kernel — which part is the code, and that the code comes off
 *  before title-casing, are rules. */
export function StopName({ name }: { name: StopCardName }) {
  return (
    <h3 className="m-0 text-h3 font-semibold text-text">
      {name.label}
      {name.code ? (
        <span className="align-middle text-caption text-subtle">
          {'  '}
          {name.code}
        </span>
      ) : null}
    </h3>
  )
}
