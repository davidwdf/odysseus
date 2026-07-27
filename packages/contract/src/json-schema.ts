// How the wire schemas become JSON Schema — and the one option in here that decides whether we
// can ever change the data structures again without a coordinated three-platform release.
//
// OpenAPI 3.1's Schema Object *is* JSON Schema draft 2020-12, so Zod 4's built-in
// `z.toJSONSchema()` gets us the whole way with no `zod-to-openapi` dependency to keep in step.

import { z } from 'zod'

/**
 * **Wire objects emit as open, not closed.**
 *
 * Zod's `z.object()` strips unknown keys, so `toJSONSchema` faithfully reports that intent as
 * `additionalProperties: false`. That is right for a validator and wrong for a *published
 * contract*: a strict-by-default generated decoder rejects any payload containing a field it
 * doesn't know about. Which means the moment we add one optional field to a response, every
 * already-installed copy of the app stops decoding that endpoint — the failure lands on phones we
 * cannot update, for a change that is by construction backward-compatible.
 *
 * Stripping it inverts that: adding an optional field is a deploy, not a migration. Old clients
 * ignore what they don't understand and keep working; new clients read it. That property is the
 * whole reason the schema stays adjustable, so it is *this* hook — not the schemas — that carries
 * the guarantee. Removals, renames and type changes are still breaking and still need the
 * `oasdiff` gate plus an ADR (WP1-1); this only makes the additive case free.
 *
 * We keep `z.object()` rather than switching to `z.looseObject()`, because loose objects infer an
 * index signature into the TS type and `@nextbus/core`'s types are `z.infer` of these schemas —
 * every consumer would silently lose typo-checking on every wire shape. So: strict where it buys
 * type safety (in TS), open where it buys forward compatibility (on the wire).
 */
export const WIRE_JSON_SCHEMA_OPTIONS = {
  target: 'draft-2020-12',
  override: (ctx: { jsonSchema: Record<string, unknown> }) => {
    if (ctx.jsonSchema.additionalProperties === false) {
      delete ctx.jsonSchema.additionalProperties
    }
  },
} as const satisfies Parameters<typeof z.toJSONSchema>[1]

/** Emit one wire schema as forward-compatible JSON Schema draft 2020-12. */
export function toWireJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, WIRE_JSON_SCHEMA_OPTIONS) as Record<string, unknown>
}
