import type { Map as MapLibreMap } from 'maplibre-gl'

// The camera arithmetic two maps share. Extracted from `RouteMap` when Home got a map of its own
// (ADR-183): both frame a set of points under a draggable sheet and floating chrome, and a second copy
// of this would be a second answer to "what does centred mean".

/**
 * The camera's padding, in pixels, from the fractions of the map that something else is covering.
 *
 * A base inset on every side so a route never runs to the very edge, plus whatever the sheet and the
 * floating chrome are hiding. MapLibre applies this to `fitBounds` and `flyTo` alike, which is what
 * makes "centred" mean centred in the part a rider can actually see.
 */
export function cameraPadding(
  map: MapLibreMap,
  inset: { top?: number; bottom?: number } | undefined,
): { top: number; bottom: number; left: number; right: number } {
  const height = map.getContainer().clientHeight
  return {
    top: EDGE_PADDING + (inset?.top ?? 0) * height,
    bottom: EDGE_PADDING + (inset?.bottom ?? 0) * height,
    left: EDGE_PADDING,
    right: EDGE_PADDING,
  }
}

/** Breathing room on every side, so a terminus marker is never half off the screen. */
const EDGE_PADDING = 28
