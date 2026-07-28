// @nextbus/contract — the single source of truth for every shape that crosses the network.
//
// Consumers:
//  · `@nextbus/core` re-exports `z.infer` of these as its canonical types, via `import type` only,
//    so zod never enters a client's runtime graph (ADR-052).
//  · `apps/edge` validates its own responses against them in the conformance test — the gate that
//    makes this a contract rather than a wish.
//  · iOS/Android generate their models from the emitted `openapi.json` (WP3-3).
//
// Nothing here may import from `@nextbus/core`: the dependency runs core → contract, and
// WP1-4's `layers.json` enforces it.

export * from './json-schema'
export * from './openapi'
export * from './wire/detail'
export * from './wire/eta'
export * from './wire/primitives'
export * from './wire/responses'
export * from './wire/route'
export * from './wire/search'
export * from './wire/stop'
