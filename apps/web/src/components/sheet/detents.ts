/**
 * **Where a draggable sheet is allowed to rest**, and which rest it should snap to — the arithmetic
 * half of `DraggableSheet`, with no React and no DOM in it.
 *
 * Separated so it can be reasoned about and tested as numbers. Everything here is a **fraction of the
 * available height**, never a pixel: a sheet that stores pixels is a sheet that is wrong after a device
 * rotation, a keyboard, or a browser chrome bar sliding away.
 */

/** A named rest position, as the fraction of the container the sheet covers. */
export interface Detent {
  name: string
  /** 0 = fully collapsed, 1 = fully expanded. */
  fraction: number
}

/**
 * The three the mockups settled on (`docs/proposals/06 §8`, round 2).
 *
 * `half` is the default and the reason there are three rather than two: it is the only one where the
 * map and the list are both usefully sized, so it is what the screen should open at and what the other
 * two are departures *from*. `list` is close to the screen before the map existed; `map` is the peek.
 */
export const ROUTE_DETENTS: readonly Detent[] = [
  { name: 'map', fraction: 0.22 },
  { name: 'half', fraction: 0.55 },
  { name: 'list', fraction: 0.88 },
]

export const DEFAULT_DETENT = 'half'

/**
 * The detent a sheet released at `fraction` should settle into.
 *
 * **Velocity beats proximity, and that is what makes a flick feel right.** Dragging slowly and letting
 * go picks the nearest rest, which is what the hand expects. Throwing the sheet — past
 * {@link FLICK_VELOCITY} — moves one detent *in the direction of the throw* regardless of how near the
 * one behind it still is, because a rider who flicks upward has said where they want to go and landing
 * back where they started reads as the gesture having failed.
 *
 * `velocity` is fractions per second, signed: positive expands.
 */
export function settleDetent(
  fraction: number,
  velocity: number,
  detents: readonly Detent[] = ROUTE_DETENTS,
  from?: string,
): Detent {
  const ordered = [...detents].sort((a, b) => a.fraction - b.fraction)
  const fallback = ordered[0] as Detent
  if (ordered.length === 0) return fallback

  if (Math.abs(velocity) >= FLICK_VELOCITY && from !== undefined) {
    const at = ordered.findIndex((d) => d.name === from)
    if (at !== -1) {
      const next = at + (velocity > 0 ? 1 : -1)
      return ordered[Math.max(0, Math.min(ordered.length - 1, next))] as Detent
    }
  }

  let best = fallback
  let bestGap = Number.POSITIVE_INFINITY
  for (const d of ordered) {
    const gap = Math.abs(d.fraction - fraction)
    if (gap < bestGap) {
      bestGap = gap
      best = d
    }
  }
  return best
}

/**
 * Fractions per second past which a drag counts as a flick.
 *
 * 1.2 is "the sheet crossed the screen in under a second", which a deliberate drag does not do and a
 * throw comfortably does.
 */
export const FLICK_VELOCITY = 1.2

/**
 * Clamp a drag to the range the detents allow, with **resistance** past each end.
 *
 * Past the last detent the sheet still moves, at a third of the input. That is not decoration: a sheet
 * that stops dead under a moving finger reads as broken or as having been let go, where one that gives
 * a little says *"this is the end"* while staying attached to the hand. The same trick every native
 * scroller uses at the top of a list, and the reason is the same.
 */
export function resist(fraction: number, detents: readonly Detent[] = ROUTE_DETENTS): number {
  const ordered = [...detents].sort((a, b) => a.fraction - b.fraction)
  const min = ordered[0]?.fraction ?? 0
  const max = ordered[ordered.length - 1]?.fraction ?? 1
  if (fraction < min) return min - (min - fraction) * OVERDRAG_RESISTANCE
  if (fraction > max) return max + (fraction - max) * OVERDRAG_RESISTANCE
  return fraction
}

/** How much of an over-drag actually moves the sheet. A third: felt, but clearly a boundary. */
export const OVERDRAG_RESISTANCE = 1 / 3

/** The detents smallest-first. Everything here reasons in that order; nothing assumes callers do. */
export function ordered(detents: readonly Detent[]): Detent[] {
  return [...detents].sort((a, b) => a.fraction - b.fraction)
}

/** The detent called `name`, or the smallest — so an unknown name opens somewhere rather than crashing. */
export function resolveDetent(detents: readonly Detent[], name: string): Detent {
  const list = ordered(detents)
  return list.find((d) => d.name === name) ?? (list[0] as Detent)
}

/**
 * One detent up (`+1`) or down (`-1`) from `from`, clamped at both ends.
 *
 * Used by the keyboard, and it is why the handle is a `<button>`: a sheet that can only be dragged is
 * a sheet that cannot be operated without a pointing device, which on a screen whose whole content
 * lives inside it is not a small omission.
 */
export function stepDetent(detents: readonly Detent[], from: string, step: 1 | -1): Detent {
  const list = ordered(detents)
  const at = list.findIndex((d) => d.name === from)
  const next = Math.max(0, Math.min(list.length - 1, (at === -1 ? 0 : at) + step))
  return list[next] as Detent
}

/**
 * A drag's speed in **fractions of the container per second**, signed so positive means expanding —
 * the unit {@link settleDetent} compares against {@link FLICK_VELOCITY}.
 *
 * `elapsedMs` is floored at 1: two pointer events can share a timestamp, and dividing by zero turns a
 * gentle release into an infinite flick.
 */
export function dragVelocity(deltaY: number, height: number, elapsedMs: number): number {
  return (deltaY / height / Math.max(1, elapsedMs)) * 1000
}
