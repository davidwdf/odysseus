import type { StopCardName } from '@nextbus/core'

/** A stop name (ADR-034): the name proper, with the operator's own pole code a step smaller and muted.
 *  The split itself is `displayName` in the kernel — which part is the code, and that the code comes off
 *  before title-casing, are rules. */
export function StopName({
  name,
  emphasis = false,
}: {
  name: StopCardName
  /**
   * The rider's own stop — their boarding point on the route schematic.
   *
   * The RN row emphasises `here` in **three** places, not one: the row background, the rail node, and the
   * name. The web had the first two and not this, so the boarding stop was less legible than its twin for
   * exactly the rider who is looking for it. `apps/mobile/components/StopName.tsx:32` is the same rule.
   */
  emphasis?: boolean
}) {
  return (
    <h3 className={`m-0 text-h3 font-semibold ${emphasis ? 'text-accent' : 'text-text'}`}>
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
