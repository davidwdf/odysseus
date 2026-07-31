// Assembles the AsyncAPI 3.0 document for the `/v1/live` socket — the frame half of the published
// contract, beside `openapi.json`'s request/response half.
//
// **One registry, two documents, and — read this part — two dialects.** Both documents' components
// come from the same `wireComponents()` emit with the same `#/components/schemas/<Id>` pointers, so an
// `Eta` cannot mean one thing over HTTP and another over the socket. What is *not* shared is the JSON
// Schema dialect, and the tempting sentence "one registry, one dialect" would have been false:
//
//   · OpenAPI 3.1's Schema Object **is** JSON Schema draft 2020-12, which is what
//     `WIRE_JSON_SCHEMA_OPTIONS` emits and what `openapi.json` declares via `jsonSchemaDialect`.
//   · AsyncAPI 3.0's Schema Object is a superset of JSON Schema **draft-07** (spec §"Schema Object":
//     *"This object is a superset of the JSON Schema Specification Draft 07"*). `2020-12` appears
//     nowhere in the 3.0.0 or 3.1.0 spec, nor in either meta-schema; the issue asking for it
//     (asyncapi/spec#596) was closed stale in 2022 and has no successor.
//
// So this document asserts draft-07 over bytes generated as 2020-12. Two things make that honest
// rather than a lie of omission: the `x-json-schema-dialect` root extension records what the bytes
// actually are (AsyncAPI's root object is closed — `additionalProperties: false` with only `^x-` keys
// permitted — so an extension is the only place it *can* be recorded), and
// `scripts/check-asyncapi-current.mjs` walks every emitted schema and fails on any keyword outside the
// draft-07 ∩ AsyncAPI vocabulary. Today's surface passes; the gate is what stops the next schema
// quietly making the assertion untrue.
//
// **`schemaFormat` is deliberately omitted** on every message, which makes each payload an AsyncAPI
// Schema Object — the one format `@asyncapi/parser` and Modelina actually consume. The more
// literally-honest alternative (`application/schema+json;version=2020-12`) is a custom value the
// parser's registry does not know: it returns *"Unknown schema format"* and **skips payload validation
// altogether**, which trades a documentation nicety for every validator in the ecosystem.
//
// **Version is `3.0.0`, not `3.1.0`.** 3.1.0's only substantive addition is ROS 2 bindings, and
// Modelina's input support caps at 3.0.0.

import { wireComponents } from './json-schema'
import { CONTRACT_VERSION } from './openapi'
import {
  LIVE_CHANNEL,
  LIVE_PING_MESSAGE,
  LIVE_PONG_MESSAGE,
  type LiveMessage,
  PingFrameSchema,
  PongFrameSchema,
} from './wire/live'

/** The one channel key. WebSockets have no virtual channels — the connection *is* the channel. */
const CHANNEL_KEY = 'live'

/**
 * The websockets channel-binding version. **`0.1.0` is the only value the meta-schema permits**
 * (`http://asyncapi.com/bindings/websockets/0.1.0/channel.json` declares `enum: ["0.1.0"]`), and the
 * binding key is `ws`, not `websockets`. Both are the kind of detail that validates fine in a text
 * editor and fails in a parser.
 */
const WS_BINDING_VERSION = '0.1.0'

/**
 * Every frame on the channel, in the order the document lists them. One flat list because the
 * "one and only one" check below is a property of the *channel*, not of a direction: two frames with
 * the same `type` const would be ambiguous even if they travelled opposite ways.
 */
function allMessages(): readonly LiveMessage[] {
  return [...LIVE_CHANNEL.clientFrames, ...LIVE_CHANNEL.serverFrames]
}

/**
 * The invariant no AsyncAPI tool checks, and that this document is illegal without.
 *
 * The spec states it twice as a MUST — for the channel's `messages` map and again for an operation's
 * list: *"Every message sent to this channel MUST be valid against one, and only one, of the message
 * objects defined in this map."* Nothing in the toolchain enforces it, and our forward-compatibility
 * hook makes it *easy* to break: `WIRE_JSON_SCHEMA_OPTIONS` strips `additionalProperties: false`
 * (deliberately — see `json-schema.ts`), so two open frame objects are trivially co-satisfiable. An
 * open `{"type":"delta","seq":9}` also validates against an open `Snapshot` whose remaining keys are
 * all optional. The *only* thing keeping the document legal is that every frame requires `type` and
 * pins it to a distinct `const`, so that is checked here rather than asserted in prose.
 */
function assertFramesAreMutuallyExclusive(schemas: Record<string, Record<string, unknown>>): void {
  const consts = new Map<string, string>()
  for (const message of allMessages()) {
    const id = message.payload.meta()?.id
    if (!id) {
      // Would emit an inline, un-referencable payload — the same failure `buildOpenApiDocument`
      // refuses for a response body, and worse here: a generator names it after the message and the
      // name churns on every unrelated edit.
      throw new Error(`${message.name}: frame payload is missing .meta({ id })`)
    }
    const schema = schemas[id]
    if (!schema) throw new Error(`${message.name}: ${id} is not in the emitted components`)
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
    const properties = (schema.properties ?? {}) as Record<string, { const?: unknown }>
    const discriminator = properties.type?.const
    if (!required.includes('type') || typeof discriminator !== 'string') {
      throw new Error(
        `${id}: a frame must require "type" and pin it to a string const, or the channel's ` +
          '"one and only one message" MUST cannot hold (see assertFramesAreMutuallyExclusive)',
      )
    }
    const clash = consts.get(discriminator)
    if (clash) throw new Error(`${id} and ${clash} both use type "${discriminator}"`)
    consts.set(discriminator, id)
  }
}

/**
 * The keepalive constants really are the frames' JSON encoding.
 *
 * `LIVE_PING_MESSAGE` exists because Cloudflare's hibernation auto-response compares the incoming
 * message to a request string **byte for byte**; a mismatch means every keepalive wakes the Durable
 * Object instead of being answered for free. The two representations — a Zod frame schema and a string
 * literal — cannot be one declaration, so this is the next best thing: the emit refuses to write a
 * document whose `PingFrame` no longer encodes to the bytes the runtime compares against. Both the
 * emit and the staleness check build the document, so this runs on every `pnpm test`.
 */
function assertKeepaliveBytes(): void {
  const pairs = [
    { name: 'LIVE_PING_MESSAGE', schema: PingFrameSchema, bytes: LIVE_PING_MESSAGE },
    { name: 'LIVE_PONG_MESSAGE', schema: PongFrameSchema, bytes: LIVE_PONG_MESSAGE },
  ]
  for (const { name, schema, bytes } of pairs) {
    const encoded = JSON.stringify(schema.parse(JSON.parse(bytes)))
    if (encoded !== bytes) {
      throw new Error(
        `${name} is ${JSON.stringify(bytes)} but the frame encodes to ${JSON.stringify(encoded)} — ` +
          "Cloudflare's auto-response matches the request string exactly, so a mismatched byte means " +
          'every keepalive wakes the shard.',
      )
    }
  }
}

/**
 * Rewrite `{ $ref, …siblings }` as `allOf: [{ $ref }, { …siblings }]`, everywhere, recursively.
 *
 * **This is not tidying; without it the document loses field notes silently.** AsyncAPI's Reference
 * Object says *"This object cannot be extended with additional properties and any properties added
 * SHALL be ignored"*, and the Schema Object says `$ref` MUST follow that behaviour "instead of the one
 * in JSON Schema". Legal and honoured under OpenAPI 3.1/2020-12; dropped here. `openapi.json` has
 * exactly four such sites — `Eta.destination`, `Eta.remark`, `Eta.remarkKind` and `RouteDetail.reverse`,
 * all `description` — and `Eta.remarkKind`'s is the absent-versus-`"info"` note, the single most
 * consequential field note in the contract. `StatusFrame.error` adds a fifth.
 *
 * Fixed **here and not in `openapi.json`**: the siblings are legal and honoured under OpenAPI 3.1, so
 * changing that document to suit a second consumer would be a wire-doc change smuggled into a feature.
 * One document's parser rules are that document's emit's problem.
 *
 * A node counts as a reference only when `$ref` holds a *string*. That guard is what keeps a property
 * legitimately *named* `$ref` (whose value would be a schema object) from being mistaken for one.
 */
function foldRefSiblings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(foldRefSiblings)
  if (value === null || typeof value !== 'object') return value
  const rewritten: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) rewritten[key] = foldRefSiblings(child)
  if (typeof rewritten.$ref === 'string' && Object.keys(rewritten).length > 1) {
    const { $ref, ...siblings } = rewritten
    return { allOf: [{ $ref }, siblings] }
  }
  return rewritten
}

/**
 * The shared component schemas, adjusted for AsyncAPI's reading of them.
 *
 * Two adjustments, both losses of information that would otherwise be silent:
 *  · `$id` goes. `"$id": "#/components/schemas/Eta"` is a JSON-pointer fragment in a field that means
 *    "the base URI of this schema". It passes draft-07's `uri-reference` format so no validator
 *    complains, it is outright invalid under 2020-12 §8.2.1, and its effect on Modelina's and Studio's
 *    ref resolution is **unverified** — we have not run either. Dropping it costs nothing (the pointer
 *    that resolves a reference is the components key) and removes an unknown.
 *  · `$ref` siblings are folded — see `foldRefSiblings`.
 *
 * `$schema` is already stripped by `wireComponents()`.
 */
function asyncApiSchemas(): Record<string, Record<string, unknown>> {
  const schemas = wireComponents()
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, schema] of Object.entries(schemas)) {
    delete schema.$id
    out[id] = foldRefSiblings(schema) as Record<string, unknown>
  }
  return out
}

/** `components.messages` — one entry per frame, payload by reference. */
function messageComponents(): Record<string, unknown> {
  const entries = allMessages().map((message) => [
    message.name,
    {
      name: message.name,
      summary: message.summary,
      contentType: 'application/json',
      payload: { $ref: `#/components/schemas/${message.payload.meta()?.id}` },
    },
  ])
  return Object.fromEntries(entries)
}

/**
 * An operation's message list. The refs **must** point into the channel rather than at
 * `components.messages`: *"the messages MUST contain a subset of the messages defined in the channel
 * referenced in this operation, and MUST NOT point to … the Components Object"*.
 */
function operationMessages(messages: readonly LiveMessage[]): unknown[] {
  return messages.map((m) => ({ $ref: `#/channels/${CHANNEL_KEY}/messages/${m.name}` }))
}

/**
 * `bindings.ws` — how a connect-URL query parameter is expressed, and the only place it may be.
 *
 * The Channel Object's `address` field is explicit: *"Query parameters and fragments SHALL NOT be
 * used, instead use bindings to define them."* So `?targets=…` lives here. The binding's `query` MUST
 * be an object schema with a `properties` key, which is why this is hand-shaped rather than emitted
 * from a Zod object — a one-property object schema is cheaper to write than a schema declaration
 * nothing else would reference.
 */
function wsBinding(): unknown {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const param of LIVE_CHANNEL.query) {
    properties[param.name] = { type: param.type, description: param.description }
    if (param.required) required.push(param.name)
  }
  return {
    method: 'GET',
    query: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
    bindingVersion: WS_BINDING_VERSION,
  }
}

export function buildAsyncApiDocument(): Record<string, unknown> {
  const schemas = asyncApiSchemas()
  assertFramesAreMutuallyExclusive(schemas)
  assertKeepaliveBytes()

  return {
    asyncapi: '3.0.0',
    // AsyncAPI has no `jsonSchemaDialect` field and its root object is closed, so the truth about
    // these bytes is recorded in the one place the spec leaves open. See the header.
    'x-json-schema-dialect': 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'NextBus HK — live ETA stream',
      version: CONTRACT_VERSION,
      description: [
        'The frames on `/v1/live`: one socket per client, a `snapshot` then `delta`s, pushed on a',
        'server-controlled cadence. Companion to `openapi.json`, which describes the JSON endpoints.',
        '',
        'Both documents are emitted from the same Zod declarations, through one registry pass, with one set',
        'of `#/components/schemas/` pointers — so they cannot disagree about what an `Eta` *is*. They are',
        '**not** byte-identical, and the two differences are deliberate losses of information that',
        "AsyncAPI's own rules force (see `foldRefSiblings` in `src/asyncapi.ts`): this document drops the",
        '`$id` every schema carries there, and it rewrites `$ref`-with-`description` into',
        '`allOf: [{$ref}, {description}]` at four sites — `Eta.destination`, `Eta.remark`,',
        "`Eta.remarkKind` and `RouteDetail.reverse` — because AsyncAPI's Reference Object ignores sibling",
        'keywords, and `Eta.remarkKind`\'s note (absent, never `"info"`) is the one field note in this',
        'contract most expensive to lose. A generator therefore produces slightly different shapes for',
        'those four from the two documents; everything else matches.',
        '',
        '**Read this before planning to generate anything from this document.** It is a specification',
        'artefact with a validator, and only aspirationally a codegen input:',
        '',
        '- **There is no AsyncAPI→Swift generator in existence.** Modelina — the reference generator —',
        '  emits 12 languages and Swift is not among them, and a sweep of `asyncapi.com/tools` finds no',
        '  tool mentioning Swift, Objective-C or iOS in any category. An iOS client hand-writes these',
        '  frame types.',
        "- **Kotlin generation exists and cannot serialise.** Modelina's Kotlin output lists JSON, XML",
        '  and binary serialization as "currently not supported", so `generate models kotlin` yields',
        '  annotation-free data classes and the decode layer is hand-written anyway — which puts the',
        '  unknown-enum tolerance obligation (`x-unknown-tolerant`) on hand-written code on Android too.',
        '- **`asyncapi diff` is not an `oasdiff` equivalent.** Its standards table has no',
        '  `/components/schemas/*` pointer, so adding *or removing* a payload field classifies as',
        '  `unclassified`, not `breaking`. A gate built on it would go green on a removed field — a gate',
        '  looking at nothing. Breaking-change discipline for these shapes is ADR-052 §5 plus review.',
        '- **The schemas are generated as JSON Schema 2020-12** and this document declares draft-07,',
        "  because that is what AsyncAPI 3.0's Schema Object is a superset of. The",
        '  `x-json-schema-dialect` extension above records what the bytes are, and',
        '  `packages/contract/scripts/check-asyncapi-current.mjs` fails on any keyword outside the',
        '  intersection of the two vocabularies, so the declaration stays true as the schemas grow.',
        '- **This document has never been validated against the AsyncAPI meta-schema.** Doing that needs',
        '  a dependency this repo has not taken (`@asyncapi/parser`, or `@asyncapi/specs` + ajv). The',
        '  gate transcribes the field lists and constraints that matter from the spec instead, and says',
        '  so. Treat "AsyncAPI 3.0" here as a careful reading, not a validator\'s verdict.',
        '',
        'Conventions inherited from `openapi.json` and restated because a reader may only ever see this',
        'file:',
        '',
        '- **Objects are open.** Additional properties are permitted by design; do not configure a',
        '  generator to reject unknown keys, or one added optional field stops every deployed client',
        '  decoding.',
        '- **Enums marked `x-unknown-tolerant` will gain members** without a major version bump.',
        '  Generate a fallback case; do not throw on an unrecognised value.',
        '- **A frame is identified by its `type` const, which is required on every frame.** That is what',
        '  makes the channel\'s "valid against one and only one message" rule hold given open objects.',
        "- **`Eta.dataTimestamp` carries a `+08:00` offset; a frame's own `at` and `Eta.observedAt` are",
        '  `Z`-suffixed UTC**, because our layer stamps those two and the operators stamp the other.',
        '  Parse them as instants. Judge staleness from `dataTimestamp` — never from `observedAt`, which',
        '  would make a replayed offline reading look fresh (ADR-008, ADR-058).',
        '- **ETAs are approximations.** No per-second countdown; repaint when a frame arrives.',
      ].join('\n'),
    },
    defaultContentType: 'application/json',
    servers: {
      // The only host this document can honestly name. WP0-5 (deploy + custom domain) is not done, so
      // there is no production origin yet; `EXPO_PUBLIC_API_URL` / `VITE_API_URL` both default to
      // `http://localhost:8787`, and `liveSocketUrl` in `@nextbus/core` derives this server's URL from
      // that value — `http:`→`ws:`, `https:`→`wss:`, plus this pathname. When the real domain lands,
      // deriving is still the rule and this entry gains a sibling rather than moving.
      dev: {
        host: 'localhost:8787',
        pathname: LIVE_CHANNEL.address,
        protocol: 'ws',
        description:
          'The local `wrangler dev` Worker (`pnpm dev:edge`). No production host is declared because none exists yet — see WP0-5. A deployed origin is `wss://<host>` with the same pathname.',
      },
    },
    channels: {
      [CHANNEL_KEY]: {
        address: LIVE_CHANNEL.address,
        title: LIVE_CHANNEL.title,
        summary: LIVE_CHANNEL.summary,
        messages: Object.fromEntries(
          allMessages().map((m) => [m.name, { $ref: `#/components/messages/${m.name}` }]),
        ),
        bindings: { ws: wsBinding() },
      },
    },
    // `action` is written from the point of view of the application that owns this document — the
    // Worker. So a frame the *client* sends is `receive`. This inverts the reading of AsyncAPI 2.x,
    // where `publish` meant "others may publish here because I subscribe", and getting it backwards
    // produces a document that validates perfectly and describes the opposite protocol.
    operations: {
      receiveClientFrame: {
        action: 'receive',
        channel: { $ref: `#/channels/${CHANNEL_KEY}` },
        summary: 'Frames the client sends to the Worker.',
        messages: operationMessages(LIVE_CHANNEL.clientFrames),
      },
      sendServerFrame: {
        action: 'send',
        channel: { $ref: `#/channels/${CHANNEL_KEY}` },
        summary: 'Frames the Worker pushes to the client.',
        messages: operationMessages(LIVE_CHANNEL.serverFrames),
      },
    },
    components: {
      messages: messageComponents(),
      // Every registered wire shape, not only the frame-reachable ones — the consequence of sharing one
      // global registry with `openapi.json` (see `wireComponents`). It is not waste: a `snapshot`
      // carries `Eta[]`, an `Eta` carries `I18nText` and `OperatorId`, and a native repo generating
      // frame models from this file alone gets a complete set. The gate prints the count so growth is
      // visible rather than assumed.
      schemas,
    },
  }
}
