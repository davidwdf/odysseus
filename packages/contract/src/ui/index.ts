import type { ComponentSpec } from '@nextbus/ui-spec'
import { FAVOURITES_SPEC } from './favourites'
import { NEARBY_SPEC } from './nearby'
import { PLACE_DETAIL_SPEC } from './place-detail'
import { PLACE_ROW_SPEC } from './place-row'
import { SEARCH_SPEC } from './search'
import { STOP_ROW_SPEC } from './stop-row'

/**
 * **NextBus's own component specs** — the instances; `@nextbus/ui-spec` is the format.
 *
 * They live in `packages/contract` rather than beside the components for the reason ADR-075 decision 3
 * gives: a native reader already starts at `packages/contract/README.md`, and a component contract belongs
 * in the same shipment as `openapi.json` and `asyncapi.json`. Each is emitted to `ui/<file>.spec.json`,
 * committed, and drift-gated — `pnpm test` fails on a stale copy, exactly as it does for the other two.
 *
 * The map's keys are the emitted file stems, so adding a spec is one entry and a `ui:emit`.
 */
export const UI_SPECS: Record<string, ComponentSpec> = {
  favourites: FAVOURITES_SPEC,
  nearby: NEARBY_SPEC,
  'place-detail': PLACE_DETAIL_SPEC,
  'place-row': PLACE_ROW_SPEC,
  search: SEARCH_SPEC,
  'stop-row': STOP_ROW_SPEC,
}

/**
 * The same specs keyed by their `component` name — what a `component` slot node is resolved through.
 *
 * Derived from `UI_SPECS` rather than written out, so a spec cannot be emitted and yet be unreferenceable:
 * `Nearby` declares itself a list of `StopRow`, and that claim is only checkable if the walker can find it.
 */
export const UI_SPEC_REGISTRY: Record<string, ComponentSpec> = Object.fromEntries(
  Object.values(UI_SPECS).map((spec) => [spec.component, spec]),
)

export {
  FAVOURITES_SPEC,
  NEARBY_SPEC,
  PLACE_DETAIL_SPEC,
  PLACE_ROW_SPEC,
  SEARCH_SPEC,
  STOP_ROW_SPEC,
}
