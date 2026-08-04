import type { ComponentSpec } from '@nextbus/ui-spec'
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
  'stop-row': STOP_ROW_SPEC,
}

export { STOP_ROW_SPEC }
