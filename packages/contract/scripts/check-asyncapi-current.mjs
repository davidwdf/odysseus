#!/usr/bin/env node
// Gate for WP5-1 / ADR-056: the committed `asyncapi.json` still matches what the frame schemas emit,
// and the document it emits is still the document it claims to be.
//
// WHY A MECHANICAL CHECK, WHEN `check-openapi-current.mjs` ALREADY DOES THE FIRST HALF
// The staleness half is the same failure and gets the same treatment: a committed generated file has
// exactly one failure mode — someone edits the source and forgets to re-run the generator — and this
// repo has watched it happen (WP4-0 added a corpus module and the native-guide gate replayed green from
// another worktree's turbo cache). The second half is new, and it is the reason this file is longer than
// its OpenAPI twin. `asyncapi.json` makes three claims that nothing else in this repo, and nothing in
// the AsyncAPI toolchain, would notice going false:
//
//  1. **"These payloads are draft-07."** They are emitted as JSON Schema 2020-12 (that is what
//     OpenAPI 3.1 needs) and AsyncAPI 3.0's Schema Object is a superset of **draft-07** — `2020-12`
//     appears nowhere in its spec or meta-schema. Today's keyword surface happens to lie in the
//     intersection, so the claim is true; the day a schema gains `$defs` or `prefixItems` it becomes a
//     lie in a file a native repo generates from, and no test anywhere would fail. So the vocabulary is
//     walked here.
//  2. **"Every field note survives."** AsyncAPI's Reference Object ignores properties beside a `$ref`,
//     which would silently drop the four `$ref` + `description` sites in the shared components —
//     including `Eta.remarkKind`'s absent-versus-`"info"` note, the most consequential field note in
//     the contract. `src/asyncapi.ts` folds them into `allOf`; this asserts none survived the fold.
//  3. **"The frames are not in `openapi.json`."** That separation is enforced only by which module
//     `src/openapi.ts` imports. An added import would publish socket frames as HTTP components with no
//     endpoint returning them, which is the "documented but never exercised" failure
//     `wire/responses.ts` exists to prevent, reintroduced in a second document.
//
// WHAT IS AND IS NOT A VIOLATION — the distinction this file turns on
// `minimum` / `maximum` are **not** violations: draft-07 has both (they are what `z.number().int()`
// emits for `seq`), and a gate that flagged them would be flagging the contract's own integer bound.
// `x-` extensions are not violations either — AsyncAPI's Schema Object explicitly permits
// `^x-[\w\d\.\x2d_]+$`, which is what carries `x-unknown-tolerant`. What *is* a violation is a keyword
// that only exists in 2020-12, or a `$ref` that has grown a sibling, or a document field the spec's
// closed field lists do not permit.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK
// **It does not validate the document against the AsyncAPI meta-schema.** That needs a dependency this
// repo has not taken (`@asyncapi/parser`, or `@asyncapi/specs` + ajv), and pretending otherwise would be
// worse than the gap. The field lists and constraints below are *transcribed* from the 3.0.0 spec and
// the websockets binding meta-schema, with what each one is, and they cover the mistakes that produce a
// document a parser rejects. Treat "AsyncAPI 3.0" as a careful reading, not a validator's verdict — the
// same honesty the never-compiled Swift and Kotlin artefacts get in `README.md` §7.
// It also does not check the "one and only one message" MUST or the keepalive byte equality: those are
// invariants of our own declaration, so `buildAsyncApiDocument()` throws on them and a broken build is
// reported here as a build failure. See `assertFramesAreMutuallyExclusive` and `assertKeepaliveBytes`.
//
// Run `--selftest` to watch every rule below fail on purpose against synthetic documents, with the live
// artefact as the last control. A gate nobody has seen fail is not known to work.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const committedPath = join(pkgRoot, 'asyncapi.json')
const openapiPath = join(pkgRoot, 'openapi.json')

// ── The transcribed vocabulary ───────────────────────────────────────────────
//
// Every keyword JSON Schema draft-07 defines, plus the three the AsyncAPI 3.0 Schema Object adds
// (`deprecated`, `discriminator`, `externalDocs`). Sourced from draft-07 §6–§10 and the spec's Schema
// Object section. `definitions` and `dependencies` are the draft-07 spellings of things we never emit;
// they are listed because a *legal* document may contain them and this list is about legality, not
// about our current output.
const DRAFT07_KEYWORDS = new Set([
  '$ref',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'type',
  'enum',
  'const',
  'multipleOf',
  'maximum',
  'minimum',
  'maxLength',
  'minLength',
  'pattern',
  'items',
  'additionalItems',
  'maxItems',
  'minItems',
  'uniqueItems',
  'contains',
  'maxProperties',
  'minProperties',
  'required',
  'properties',
  'patternProperties',
  'additionalProperties',
  'dependencies',
  'propertyNames',
  'if',
  'then',
  'else',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'format',
  'contentMediaType',
  'contentEncoding',
  'definitions',
  // AsyncAPI's own additions to the draft-07 vocabulary.
  'deprecated',
  'discriminator',
  'externalDocs',
])

/**
 * Keywords that must never appear, each with the reason. Split from "not in `DRAFT07_KEYWORDS`" so the
 * failure names *why* rather than saying "unknown keyword" about something perfectly well known.
 */
const FORBIDDEN_KEYWORDS = {
  $schema: 'the dialect is declared once, by the document — `wireComponents()` strips this',
  $id: 'a JSON-pointer fragment in a field that means "base URI"; `src/asyncapi.ts` strips it',
  $defs:
    '2020-12 renamed draft-07 `definitions`; a draft-07 parser will not follow pointers into it',
  $anchor: '2020-12 only',
  $dynamicRef: '2020-12 only',
  $dynamicAnchor: '2020-12 only',
  $recursiveRef: 'draft 2019-09 only',
  $recursiveAnchor: 'draft 2019-09 only',
  $vocabulary: '2020-12 only',
  prefixItems: '2020-12 only — draft-07 spells positional tuples `items: [...]`',
  unevaluatedItems: '2019-09/2020-12 only',
  unevaluatedProperties: '2019-09/2020-12 only',
  dependentSchemas: '2019-09/2020-12 split of draft-07 `dependencies`',
  dependentRequired: '2019-09/2020-12 split of draft-07 `dependencies`',
  contentSchema: '2019-09/2020-12 only',
  minContains: '2019-09/2020-12 only',
  maxContains: '2019-09/2020-12 only',
  // UNSETTLED, and denied on purpose. The Wave 5 scout recorded the *numeric* form of these as
  // 2020-12-only; draft-07 §6.2.3 specifies them as numbers, so that looks wrong, and we could not
  // confirm which reading AsyncAPI's Schema Object takes without running its parser. We emit neither
  // keyword today, so denying them costs nothing and the first person who needs a bound reads this note
  // and settles it — with a citation — rather than discovering the ambiguity in a generated client.
  exclusiveMinimum:
    "unsettled between draft-07 (a number) and the scout's reading of AsyncAPI; settle it with a citation before emitting one",
  exclusiveMaximum:
    "unsettled between draft-07 (a number) and the scout's reading of AsyncAPI; settle it with a citation before emitting one",
}

/** Root Object: `required` and the closed property list, from `spec-json-schemas/schemas/3.0.0.json`. */
const ROOT_REQUIRED = ['asyncapi', 'info']
const ROOT_FIELDS = new Set([
  'asyncapi',
  'id',
  'info',
  'servers',
  'defaultContentType',
  'channels',
  'operations',
  'components',
])

/** Channel Object: closed property list, from the spec's Channel Object section. */
const CHANNEL_FIELDS = new Set([
  'title',
  'description',
  'address',
  'bindings',
  'externalDocs',
  'messages',
  'parameters',
  'servers',
  'summary',
  'tags',
])

/** Components Object: the maps it may hold. */
const COMPONENT_FIELDS = new Set([
  'schemas',
  'servers',
  'channels',
  'serverVariables',
  'operations',
  'messages',
  'securitySchemes',
  'parameters',
  'correlationIds',
  'operationTraits',
  'messageTraits',
  'replies',
  'replyAddresses',
  'serverBindings',
  'channelBindings',
  'operationBindings',
  'messageBindings',
  'tags',
  'externalDocs',
])

/** `channelBindingsObject.json`'s closed protocol list. The WebSockets key is `ws`, not `websockets`. */
const BINDING_PROTOCOLS = new Set([
  'amqp',
  'amqp1',
  'anypointmq',
  'googlepubsub',
  'http',
  'ibmmq',
  'jms',
  'kafka',
  'mqtt',
  'nats',
  'pulsar',
  'redis',
  'sns',
  'solace',
  'sqs',
  'stomp',
  'ws',
])
/** `bindings/websockets/0.1.0/channel.json`: closed, and `bindingVersion` is `enum: ["0.1.0"]`. */
const WS_BINDING_FIELDS = new Set(['method', 'query', 'headers', 'bindingVersion'])
const WS_BINDING_VERSIONS = new Set(['0.1.0'])
const WS_METHODS = new Set(['GET', 'POST'])

/** `components.schemas` / `components.messages` keys must match this, per the meta-schema. */
const COMPONENT_KEY_RE = /^[\w\d.\-_]+$/
const EXTENSION_RE = /^x-[\w\d.\x2d_]+$/

// ── Analysis ─────────────────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Which keywords hold schemas, and in what shape. **This is the distinction the walk turns on**, and
// getting it wrong is not a subtle failure: recursing into every object indiscriminately treats
// `properties` as a schema node and then reports every *field name* in the contract as an unknown
// keyword. (Written that way first; the live-artefact control below is what caught it.) So schema
// positions are enumerated, and a keyword this list does not know is simply not descended into — it has
// already been reported as unknown by the caller, which is the more useful message anyway.
const SCHEMA_VALUED = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items', // draft-07: a schema, or an array of schemas for a positional tuple
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])
const SCHEMA_LIST_VALUED = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_MAP_VALUED = new Set([
  '$defs',
  'definitions',
  'dependencies', // draft-07: a schema, or an array of property names
  'dependentSchemas',
  'patternProperties',
  'properties',
])

/**
 * Every schema node under `components.schemas`, as `[pointer, node]` — the root of each component and
 * every nested schema reachable through a keyword that holds one.
 */
function* walkSchemas(schemas) {
  const stack = Object.entries(schemas).map(([id, node]) => [`#/components/schemas/${id}`, node])
  while (stack.length > 0) {
    const [pointer, node] = stack.pop()
    if (!isObject(node)) continue
    yield [pointer, node]
    for (const [keyword, value] of Object.entries(node)) {
      const at = `${pointer}/${keyword}`
      if (SCHEMA_VALUED.has(keyword)) {
        // `items` takes either form; `additionalProperties: false` is a boolean and holds no schema.
        if (Array.isArray(value)) {
          for (const [i, child] of value.entries()) stack.push([`${at}/${i}`, child])
        } else {
          stack.push([at, value])
        }
      } else if (SCHEMA_LIST_VALUED.has(keyword)) {
        if (Array.isArray(value))
          for (const [i, child] of value.entries()) stack.push([`${at}/${i}`, child])
      } else if (SCHEMA_MAP_VALUED.has(keyword)) {
        if (isObject(value))
          for (const [name, child] of Object.entries(value)) stack.push([`${at}/${name}`, child])
      }
    }
  }
}

/**
 * Every problem with a built document, each carrying a stable `code` so the selftest can assert *which*
 * rule fired rather than merely that something did.
 *
 * `openapiSchemaIds` is optional: pass it to check claim 3 (frames absent from the OpenAPI document).
 */
export function analyse(doc, { openapiSchemaIds } = {}) {
  const problems = []
  const fail = (code, message) => problems.push({ code, message })

  if (!isObject(doc)) {
    fail('DOC_UNPARSABLE', 'the document is not a JSON object')
    return { problems, stats: {} }
  }

  // ── the root object ────────────────────────────────────────────────────────
  for (const field of ROOT_REQUIRED) {
    if (!(field in doc)) fail('ROOT_FIELD', `the root object is missing required "${field}"`)
  }
  for (const field of Object.keys(doc)) {
    if (ROOT_FIELDS.has(field) || EXTENSION_RE.test(field)) continue
    fail(
      'ROOT_FIELD',
      `"${field}" is not a Root Object field and is not an "x-" extension — the root is closed, ` +
        'which is why the JSON Schema dialect is recorded as `x-json-schema-dialect`',
    )
  }
  if (doc.asyncapi !== '3.0.0') {
    fail(
      'ROOT_FIELD',
      `asyncapi is "${doc.asyncapi}", expected "3.0.0" — Modelina's input support caps there, and ` +
        "3.1.0's only substantive addition is ROS 2 bindings",
    )
  }

  // ── servers ────────────────────────────────────────────────────────────────
  for (const [name, server] of Object.entries(doc.servers ?? {})) {
    if (!isObject(server)) {
      fail('SERVER_FIELD', `servers.${name} is not an object`)
      continue
    }
    for (const field of ['host', 'protocol']) {
      if (typeof server[field] !== 'string')
        fail(
          'SERVER_FIELD',
          `servers.${name} is missing required "${field}" — v3 split 2.x's single \`url\` into ` +
            'host + pathname + protocol',
        )
    }
  }

  // ── channels ───────────────────────────────────────────────────────────────
  const channelMessageKeys = new Map()
  for (const [key, channel] of Object.entries(doc.channels ?? {})) {
    if (!isObject(channel)) {
      fail('CHANNEL_FIELD', `channels.${key} is not an object`)
      continue
    }
    for (const field of Object.keys(channel)) {
      if (CHANNEL_FIELDS.has(field) || EXTENSION_RE.test(field)) continue
      fail('CHANNEL_FIELD', `channels.${key}.${field} is not a Channel Object field`)
    }
    if (typeof channel.address === 'string' && /[?#]/.test(channel.address)) {
      fail(
        'CHANNEL_FIELD',
        `channels.${key}.address contains "?" or "#" — query parameters and fragments SHALL NOT ` +
          'appear in an address; declare them in `bindings.ws.query`',
      )
    }
    channelMessageKeys.set(key, new Set(Object.keys(channel.messages ?? {})))

    for (const [protocol, binding] of Object.entries(channel.bindings ?? {})) {
      if (!BINDING_PROTOCOLS.has(protocol)) {
        fail(
          'WS_BINDING',
          `channels.${key}.bindings.${protocol} is not in the binding protocol list — the ` +
            'WebSockets key is "ws", not "websockets"',
        )
        continue
      }
      if (protocol !== 'ws') continue
      for (const field of Object.keys(binding)) {
        if (WS_BINDING_FIELDS.has(field) || EXTENSION_RE.test(field)) continue
        fail('WS_BINDING', `channels.${key}.bindings.ws.${field} is not a ws channel-binding field`)
      }
      if (!WS_BINDING_VERSIONS.has(binding.bindingVersion)) {
        fail(
          'WS_BINDING',
          `channels.${key}.bindings.ws.bindingVersion is "${binding.bindingVersion}"; the ` +
            'meta-schema permits only "0.1.0"',
        )
      }
      if (binding.method !== undefined && !WS_METHODS.has(binding.method)) {
        fail('WS_BINDING', `channels.${key}.bindings.ws.method must be GET or POST`)
      }
      if (binding.query !== undefined) {
        if (binding.query.type !== 'object' || !isObject(binding.query.properties)) {
          fail(
            'WS_BINDING',
            `channels.${key}.bindings.ws.query MUST be of type object and have a properties key`,
          )
        }
      }
    }
  }

  // ── operations ─────────────────────────────────────────────────────────────
  //
  // Only what the spec text pins is checked: `action` and `channel` are required and `action` is one of
  // two values. The Operation Object's *full* closed field list is not transcribed here because nothing
  // in this repo has read it, and a list somebody half-remembered would fail a legal document.
  for (const [name, op] of Object.entries(doc.operations ?? {})) {
    if (!isObject(op)) {
      fail('OPERATION_FIELD', `operations.${name} is not an object`)
      continue
    }
    if (op.action !== 'send' && op.action !== 'receive') {
      fail(
        'OPERATION_FIELD',
        `operations.${name}.action is "${op.action}"; it must be "send" or "receive", from the ` +
          'point of view of the application that owns this document',
      )
    }
    const channelRef = op.channel?.$ref
    const channelKey = typeof channelRef === 'string' ? channelRef.replace('#/channels/', '') : null
    if (!channelKey || !channelMessageKeys.has(channelKey)) {
      fail('OPERATION_FIELD', `operations.${name}.channel must $ref a channel in this document`)
      continue
    }
    for (const [i, ref] of (op.messages ?? []).entries()) {
      const pointer = ref?.$ref
      const expected = `#/channels/${channelKey}/messages/`
      if (typeof pointer !== 'string' || !pointer.startsWith(expected)) {
        fail(
          'OPERATION_MESSAGE',
          `operations.${name}.messages[${i}] is "${pointer}" — an operation's messages MUST point ` +
            'into its channel and MUST NOT point at the Components Object',
        )
        continue
      }
      const messageKey = pointer.slice(expected.length)
      if (!channelMessageKeys.get(channelKey).has(messageKey)) {
        fail(
          'OPERATION_MESSAGE',
          `operations.${name}.messages[${i}] references "${messageKey}", which is not in ` +
            `channels.${channelKey}.messages`,
        )
      }
    }
  }

  // ── components ─────────────────────────────────────────────────────────────
  const components = doc.components ?? {}
  for (const field of Object.keys(components)) {
    if (COMPONENT_FIELDS.has(field)) continue
    fail('COMPONENTS_FIELD', `components.${field} is not a Components Object map`)
  }
  for (const map of ['schemas', 'messages']) {
    for (const key of Object.keys(components[map] ?? {})) {
      if (!COMPONENT_KEY_RE.test(key))
        fail('COMPONENT_KEY', `components.${map}.${key} does not match ${COMPONENT_KEY_RE}`)
    }
  }

  const schemas = components.schemas ?? {}
  const frameIds = new Set()
  for (const [name, message] of Object.entries(components.messages ?? {})) {
    const ref = message?.payload?.$ref
    if (typeof ref !== 'string' || !ref.startsWith('#/components/schemas/')) {
      fail(
        'MESSAGE_PAYLOAD',
        `components.messages.${name}.payload must $ref a component schema, so a generator gets a ` +
          'stable type name instead of one it invented',
      )
      continue
    }
    const id = ref.slice('#/components/schemas/'.length)
    frameIds.add(id)
    if (!(id in schemas))
      fail('MESSAGE_PAYLOAD', `components.messages.${name}.payload references missing schema ${id}`)
  }

  // ── the two claims about the schema bytes ──────────────────────────────────
  let nodes = 0
  for (const [pointer, node] of walkSchemas(schemas)) {
    nodes++
    for (const keyword of Object.keys(node)) {
      if (EXTENSION_RE.test(keyword)) continue
      const forbidden = FORBIDDEN_KEYWORDS[keyword]
      if (forbidden) {
        fail('DIALECT_KEYWORD', `${pointer}: "${keyword}" — ${forbidden}`)
        continue
      }
      if (!DRAFT07_KEYWORDS.has(keyword)) {
        fail(
          'DIALECT_KEYWORD',
          `${pointer}: "${keyword}" is not in the draft-07 ∩ AsyncAPI vocabulary. If it is legal ` +
            'in both, add it to DRAFT07_KEYWORDS with a citation; if it is 2020-12-only, the ' +
            'document must stop claiming draft-07',
        )
      }
    }
    if (typeof node.$ref === 'string' && Object.keys(node).length > 1) {
      fail(
        'REF_WITH_SIBLINGS',
        `${pointer}: a $ref with siblings (${Object.keys(node)
          .filter((k) => k !== '$ref')
          .join(', ')}) — AsyncAPI's Reference Object SHALL ignore them, so this note would ` +
          'vanish. `foldRefSiblings` should have rewritten it to allOf',
      )
    }
  }

  // ── claim 3: the frames are not in the OpenAPI document ────────────────────
  if (openapiSchemaIds) {
    for (const id of [...frameIds].sort()) {
      if (openapiSchemaIds.has(id)) {
        fail(
          'FRAME_IN_OPENAPI',
          `${id} is a socket frame and is also in openapi.json — src/openapi.ts has grown an ` +
            'import that reaches src/wire/live.ts, which publishes a frame as an HTTP component no ' +
            'endpoint returns',
        )
      }
    }
  }

  return {
    problems,
    stats: {
      channels: Object.keys(doc.channels ?? {}).length,
      messages: Object.keys(components.messages ?? {}).length,
      schemas: Object.keys(schemas).length,
      nodes,
      frames: frameIds.size,
    },
  }
}

// ── Selftest ─────────────────────────────────────────────────────────────────

/** A minimal well-formed document, which each scenario then breaks in exactly one way. */
function fixture() {
  return {
    asyncapi: '3.0.0',
    'x-json-schema-dialect': 'https://json-schema.org/draft/2020-12/schema',
    info: { title: 'fixture', version: '1.0.0' },
    servers: { dev: { host: 'localhost:8787', pathname: '/v1/live', protocol: 'ws' } },
    channels: {
      live: {
        address: '/v1/live',
        title: 'fixture',
        messages: { Ping: { $ref: '#/components/messages/Ping' } },
        bindings: {
          ws: {
            method: 'GET',
            query: { type: 'object', properties: { targets: { type: 'string' } } },
            bindingVersion: '0.1.0',
          },
        },
      },
    },
    operations: {
      receiveClientFrame: {
        action: 'receive',
        channel: { $ref: '#/channels/live' },
        messages: [{ $ref: '#/channels/live/messages/Ping' }],
      },
    },
    components: {
      messages: {
        Ping: {
          name: 'Ping',
          contentType: 'application/json',
          payload: { $ref: '#/components/schemas/PingFrame' },
        },
      },
      schemas: {
        PingFrame: {
          type: 'object',
          properties: { type: { type: 'string', const: 'ping' } },
          required: ['type'],
        },
      },
    },
  }
}

const SCENARIOS = [
  {
    // THE CONTROL. Without it, an `analyse` that returned early — or a walk that never recursed —
    // would pass every fixture below by finding nothing in any of them.
    name: 'a well-formed document passes',
    build: (d) => d,
    expect: [],
  },
  {
    // THE SECOND CONTROL: prose and extensions must never be flagged. `description` is a draft-07
    // keyword and `x-unknown-tolerant` is explicitly permitted by the Schema Object; a gate that
    // flagged either would be flagging the contract's own documentation and would be deleted within a
    // week.
    name: 'prose and x- extensions are not violations',
    build: (d) => {
      d.components.schemas.PingFrame.description = 'The keepalive frame.'
      d.components.schemas.PingFrame['x-unknown-tolerant'] = true
      d.components.schemas.PingFrame.properties.type.minimum = 0
      return d
    },
    expect: [],
  },
  {
    name: 'a 2020-12-only keyword in a nested schema',
    build: (d) => {
      d.components.schemas.PingFrame.$defs = { Nested: { type: 'string' } }
      return d
    },
    expect: ['DIALECT_KEYWORD'],
  },
  {
    name: 'a keyword in no vocabulary at all',
    build: (d) => {
      d.components.schemas.PingFrame.properties.type.probably = 'a typo for propertyNames'
      return d
    },
    expect: ['DIALECT_KEYWORD'],
  },
  {
    name: '$id survived the strip',
    build: (d) => {
      d.components.schemas.PingFrame.$id = '#/components/schemas/PingFrame'
      return d
    },
    expect: ['DIALECT_KEYWORD'],
  },
  {
    name: 'a $ref that has grown a description sibling',
    build: (d) => {
      d.components.schemas.PingFrame.properties.type = {
        $ref: '#/components/schemas/Something',
        description: 'the note that would vanish',
      }
      return d
    },
    // The `type` const goes with it, so the discriminator is gone too — but that MUST is checked in
    // the assembly, not here; this asserts only the reference rule.
    expect: ['REF_WITH_SIBLINGS'],
  },
  {
    name: 'a root field the closed root object does not permit',
    build: (d) => {
      d.jsonSchemaDialect = 'https://json-schema.org/draft/2020-12/schema'
      return d
    },
    expect: ['ROOT_FIELD'],
  },
  {
    name: 'the wrong spec version',
    build: (d) => {
      d.asyncapi = '3.1.0'
      return d
    },
    expect: ['ROOT_FIELD'],
  },
  {
    name: 'query parameters smuggled into the channel address',
    build: (d) => {
      d.channels.live.address = '/v1/live?targets=KMB:1'
      return d
    },
    expect: ['CHANNEL_FIELD'],
  },
  {
    name: 'the binding keyed "websockets" instead of "ws"',
    build: (d) => {
      d.channels.live.bindings = { websockets: d.channels.live.bindings.ws }
      return d
    },
    expect: ['WS_BINDING'],
  },
  {
    name: 'a bindingVersion the meta-schema does not permit',
    build: (d) => {
      d.channels.live.bindings.ws.bindingVersion = '0.2.0'
      return d
    },
    expect: ['WS_BINDING'],
  },
  {
    name: 'a ws query binding that is not an object with properties',
    build: (d) => {
      d.channels.live.bindings.ws.query = { type: 'string' }
      return d
    },
    expect: ['WS_BINDING'],
  },
  {
    name: 'an operation whose messages point at the Components Object',
    build: (d) => {
      d.operations.receiveClientFrame.messages = [{ $ref: '#/components/messages/Ping' }]
      return d
    },
    expect: ['OPERATION_MESSAGE'],
  },
  {
    name: 'an operation with a 2.x action verb',
    build: (d) => {
      d.operations.receiveClientFrame.action = 'publish'
      return d
    },
    expect: ['OPERATION_FIELD'],
  },
  {
    name: 'a message payload inlined instead of referenced',
    build: (d) => {
      d.components.messages.Ping.payload = { type: 'object' }
      return d
    },
    expect: ['MESSAGE_PAYLOAD'],
  },
  {
    name: 'a frame schema that also appears in openapi.json',
    build: (d) => d,
    openapiSchemaIds: new Set(['PingFrame']),
    expect: ['FRAME_IN_OPENAPI'],
  },
]

function selftest({ verbose }) {
  let failures = 0
  console.log('check-asyncapi-current --selftest: watching the gate fail on purpose')
  for (const s of SCENARIOS) {
    const { problems } = analyse(s.build(fixture()), { openapiSchemaIds: s.openapiSchemaIds })
    const got = [...new Set(problems.map((p) => p.code))].sort()
    const want = [...new Set(s.expect)].sort()
    const ok = got.join(',') === want.join(',')
    if (!ok) failures++
    console.log(`  ${ok ? '✓' : '✗'} ${s.name} → ${got.length ? got.join(', ') : '(no problems)'}`)
    if (!ok || verbose) {
      console.log(`      expected: ${want.length ? want.join(', ') : '(no problems)'}`)
      for (const p of problems) console.log(`      · ${p.code}: ${p.message}`)
    }
  }

  // The last control, and the one that matters most: the rules above are run against the **live
  // artefact**. Every scenario could pass while the real document was broken, and every scenario could
  // pass while the real document was empty.
  const live = JSON.parse(readFileSync(committedPath, 'utf8'))
  const { problems, stats } = analyse(live, {
    openapiSchemaIds: new Set(
      Object.keys(JSON.parse(readFileSync(openapiPath, 'utf8')).components.schemas),
    ),
  })
  const liveOk = problems.length === 0 && stats.nodes > 0 && stats.frames > 0
  if (!liveOk) failures++
  console.log(
    `  ${liveOk ? '✓' : '✗'} the committed asyncapi.json passes every rule above ` +
      `(${stats.frames} frames, ${stats.nodes} schema nodes)`,
  )
  for (const p of problems) console.log(`      · ${p.code}: ${p.message}`)

  if (failures > 0) {
    console.error(`✗ selftest: ${failures} scenario(s) did not behave as documented.`)
    process.exit(1)
  }
  console.log(
    `  ✓ all ${SCENARIOS.length} scenarios + the live artefact behaved as documented (--verbose for details).`,
  )
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (process.argv.includes('--selftest')) {
  selftest({ verbose: process.argv.includes('--verbose') })
} else {
  if (!existsSync(committedPath)) {
    console.error(
      '✗ asyncapi.json is missing — run `pnpm --filter @nextbus/contract asyncapi:emit`.',
    )
    process.exit(1)
  }

  // Build the document in a child process via tsx: this script is plain `.mjs` (so it needs no
  // toolchain to run in CI) while the document builder is TypeScript. The child imports
  // `./src/asyncapi.ts` and nothing else, which is not incidental — a document's contents depend on
  // which modules were imported (see `wireComponents`), so emit and check importing the *same* module
  // is what makes this comparison meaningful.
  let freshJson
  try {
    freshJson = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        "import { buildAsyncApiDocument } from './src/asyncapi.ts'; process.stdout.write(JSON.stringify(buildAsyncApiDocument()))",
      ],
      { cwd: pkgRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (err) {
    console.error('✗ could not build the AsyncAPI document:\n')
    console.error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message)
    process.exit(1)
  }

  const fresh = JSON.parse(freshJson)
  const committed = JSON.parse(readFileSync(committedPath, 'utf8'))

  // Parsed, not bytes, so a formatting-only difference doesn't fail the build with a diff nobody can
  // read — the same choice `check-openapi-current.mjs` makes.
  if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
    console.error(
      '✗ asyncapi.json is stale — the frame schemas have changed since it was emitted.\n\n' +
        '  Run: pnpm --filter @nextbus/contract asyncapi:emit\n\n' +
        '  Then review the diff. If it removes or renames a frame, a field, or a `type` const, that\n' +
        '  is a **breaking** change: it needs an ADR and a deprecation window, not just a re-emit\n' +
        '  (ADR-052 §5). Note that `asyncapi diff` would classify it as `unclassified`, not\n' +
        '  breaking — the review is the mechanism here, not a tool.',
    )
    process.exit(1)
  }

  const openapiSchemaIds = existsSync(openapiPath)
    ? new Set(Object.keys(JSON.parse(readFileSync(openapiPath, 'utf8')).components.schemas))
    : undefined
  const { problems, stats } = analyse(fresh, { openapiSchemaIds })
  if (problems.length > 0) {
    console.error('✗ asyncapi.json is not the document it claims to be:\n')
    for (const p of problems) console.error(`  · ${p.code}: ${p.message}`)
    console.error(
      [
        '',
        '  Dialect:  the document asserts draft-07 (AsyncAPI 3.0 Schema Object) over bytes emitted as',
        '            2020-12 — see the header of packages/contract/src/asyncapi.ts.',
        '  Selftest: node scripts/check-asyncapi-current.mjs --selftest  (watch each rule fail)',
      ].join('\n'),
    )
    process.exit(1)
  }

  console.log(
    `✓ asyncapi.json is current — ${stats.channels} channel, ${stats.messages} messages ` +
      `(${stats.frames} frame payloads), ${stats.schemas} component schemas, ` +
      `${stats.nodes} schema nodes all inside the draft-07 ∩ AsyncAPI vocabulary.`,
  )
}
