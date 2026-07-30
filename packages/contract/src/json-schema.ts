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

/**
 * Every registered wire schema, as a `components.schemas` map — the one emit **both** published
 * documents call.
 *
 * `openapi.json` and `asyncapi.json` describe different transports and must still agree about what an
 * `Eta` is, byte for byte. That holds only if there is one registry emit and one set of pointers, so
 * this function is it: one `z.globalRegistry` pass, one `uri` template, one place `$schema` is
 * stripped. The pointer prefix `#/components/schemas/` is *identical* in OpenAPI 3.1 and AsyncAPI 3.0,
 * which is the small piece of luck that makes sharing possible at all.
 *
 * **Do not reach for a second `z.registry()` for a new family of shapes.** Verified against the
 * installed zod 4.4.3: a separate registry that references a globally-registered schema emits
 * `"$ref": "#/components/schemas/__shared#/$defs/Eta"` plus a synthetic `__shared` component — a
 * nested-fragment pointer that means nothing to an AsyncAPI parser or a code generator. Register every
 * shape on the global registry with `.meta({ id })`, like the rest of `src/wire/`.
 *
 * Registry mode only sees schemas whose module has actually been imported, so **what a document
 * contains is decided by that document's import graph**, not by this function. `openapi.ts` reaches
 * `wire/responses` and therefore the seven endpoints' shapes; `asyncapi.ts` reaches `wire/live` as
 * well and therefore also the frames. That is deliberate — a frame is not a JSON GET response and has
 * no business in the OpenAPI document — and it is why both emit scripts import exactly one assembly
 * module and nothing else.
 */
export function wireComponents(): Record<string, Record<string, unknown>> {
  const emitted = z.toJSONSchema(z.globalRegistry, {
    ...WIRE_JSON_SCHEMA_OPTIONS,
    uri: (id: string) => `#/components/schemas/${id}`,
  } as never) as { schemas: Record<string, Record<string, unknown>> }

  // `$schema` is meaningful for a standalone JSON Schema document and noise inside a components map,
  // where the dialect is declared once by the document (`jsonSchemaDialect`, or — AsyncAPI having no
  // such field — the `x-json-schema-dialect` extension `asyncapi.ts` sets).
  for (const schema of Object.values(emitted.schemas)) delete schema.$schema
  return emitted.schemas
}
