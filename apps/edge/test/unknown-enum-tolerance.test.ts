import { buildOpenApiDocument, EtaSchema, OperatorIdSchema } from '@nextbus/contract'
import { describe, expect, it } from 'vitest'

// WP3-3 acceptance: the unknown-enum decode contract, gated as far as TypeScript honestly can.
//
// WHY THIS FILE EXISTS, AND WHY IT IS SHAPED SO ODDLY
// `packages/contract/src/wire/primitives.ts` states the obligation and then says who has to carry it:
// `x-unknown-tolerant` "must be enforced at codegen … because nothing in the TS build can fail to
// remind us". That is exactly right, and it is worth being precise about why, because the naive
// version of this test is vacuous.
//
// The web client does **no runtime validation at all**. `@nextbus/core` imports every wire schema with
// `import type`, so the schemas erase completely and an unrecognized operator reaches a web `switch` as
// an ordinary unmatched string. There is nothing to throw. Meanwhile the Zod schemas themselves are
// *strict* — `z.enum` rejects a member it has never heard of — so "assert the contract accepts NLB"
// would assert the opposite of what ships.
//
// So the guarantee genuinely lives in a Swift/Kotlin decoder nobody in this repo can compile. What this
// file gates is the part that genuinely is checkable here, in three layers:
//
//   1. **Every enum the document publishes carries the flag.** This is the codegen-side obligation, and
//      it is the one that rots: a new closed enum added without the marker is a native client that
//      throws on a value the server is free to start sending. Watched failing (see the report).
//   2. **A decoder that honours the document behaves correctly** — accepts an unknown member of a
//      tolerant enum, and still rejects one for an enum that is genuinely closed. The decoder below is
//      the executable form of what the two templates in `packages/contract/native/` tell a porter to
//      build, so "what should my generated decoder do?" has an answer that runs.
//   3. **Zod's own strictness, asserted deliberately** — so nobody later reads layer 2 and concludes
//      the TypeScript runtime is protecting anything. It is not, and the comment on that test says so.
//
// What this cannot do: check your generator's output. Only `CorpusConformanceTests.swift` /
// `CorpusConformanceTest.kt` can, and neither has ever been compiled.

type Doc = {
  components: { schemas: Record<string, Record<string, unknown>> }
}

/**
 * An enum member as a tolerant decoder must represent it: known, or unknown-but-preserved.
 *
 * The raw string is *kept*. A decoder that mapped every unrecognized member onto a single `.other`
 * case would satisfy "does not throw" and still lose the information a client needs to log the value,
 * or to render it verbatim rather than as a blank.
 */
type Member = { known: true; value: string } | { known: false; unknown: string }

const enumsIn = (doc: Doc): Array<[string, Record<string, unknown>]> =>
  Object.entries(doc.components.schemas).filter(([, s]) => Array.isArray(s.enum))

/**
 * Decode one enum member the way the document says to.
 *
 * This is the whole rule, and it is three lines: a listed member is known; an unlisted member of a
 * tolerant enum is preserved; an unlisted member of a closed enum is an error. The third branch is
 * what makes the second one meaningful — a decoder that accepted everything would pass a test for
 * tolerance while providing no validation at all.
 */
function decodeMember(doc: Doc, schemaId: string, raw: string): Member {
  const schema = doc.components.schemas[schemaId]
  if (!schema || !Array.isArray(schema.enum)) {
    throw new Error(`${schemaId} is not an enum in this document`)
  }
  if (schema.enum.includes(raw)) return { known: true, value: raw }
  if (schema['x-unknown-tolerant'] === true) return { known: false, unknown: raw }
  throw new Error(`${schemaId} is closed and has no member "${raw}"`)
}

/**
 * Decode a payload against a named schema, honouring the two rules a native generator must be
 * configured for: **open objects** (an unrecognized key is carried, never fatal) and **tolerant
 * enums** (via `decodeMember`).
 *
 * Deliberately small and deliberately not a validator — it checks required keys and enum members and
 * nothing else. Its job is to be the reference answer to "what should the generated decoder do", so
 * anything it does beyond the document's own rules would be a rule a porter cannot find written down.
 */
function decode(doc: Doc, schemaId: string, value: unknown): unknown {
  const schema = doc.components.schemas[schemaId]
  if (!schema) throw new Error(`${schemaId} is not in this document`)
  if (Array.isArray(schema.enum)) {
    if (typeof value !== 'string') throw new Error(`${schemaId}: expected a string`)
    return decodeMember(doc, schemaId, value)
  }

  const properties = (schema.properties ?? {}) as Record<string, { $ref?: string }>
  const required = (schema.required ?? []) as string[]
  const object = value as Record<string, unknown>

  for (const key of required) {
    if (!(key in object)) throw new Error(`${schemaId}: required property "${key}" is absent`)
  }

  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(object)) {
    const ref = properties[key]?.$ref?.replace('#/components/schemas/', '')
    // An unrecognized key is carried through unchanged: objects are open by design, and this is the
    // branch a generator configured to "reject unknown properties" would turn into a crash.
    out[key] = ref ? decode(doc, ref, raw) : raw
  }
  return out
}

/** New Lantao Bus: real, in the consolidated dataset, out of v1 scope — the likeliest fifth operator. */
const UNKNOWN_OPERATOR = 'NLB'

const etaWithUnknownMembers = {
  routeId: 'NLB:11:outbound:1',
  stopId: 'NLB:0001',
  operator: UNKNOWN_OPERATOR,
  arrivals: ['2026-07-29T14:31:00+08:00'],
  remark: { en: 'Typhoon service', 'zh-Hant': '颱風服務', 'zh-Hans': '台风服务' },
  remarkKind: 'typhoon',
  dataTimestamp: '2026-07-29T14:30:00+08:00',
  observedAt: '2026-07-29T14:30:02+08:00',
}

describe('every published enum is unknown-tolerant', () => {
  const doc = buildOpenApiDocument() as unknown as Doc

  /**
   * An enum that is genuinely closed — one whose vocabulary we mint ourselves and would treat a new
   * member as a breaking change — would go here **with a reason**. It is empty, and that is the
   * finding: every enum on this wire is a vocabulary that can grow, because every one of them is
   * either an operator list, a locale list, a classification we expect to refine, or an error
   * taxonomy. `bound` is the closest thing to closed and is still marked, correctly: a third
   * direction (a circular's "loop") is a data change we would rather not turn into a store release.
   */
  const CLOSED_ON_PURPOSE: Record<string, string> = {}

  it('finds enums at all — a walk that matched nothing would pass vacuously', () => {
    expect(enumsIn(doc).length).toBeGreaterThan(0)
  })

  it('marks every one of them x-unknown-tolerant', () => {
    const unmarked = enumsIn(doc)
      .filter(([id, s]) => s['x-unknown-tolerant'] !== true && !(id in CLOSED_ON_PURPOSE))
      .map(([id, s]) => `${id} (${(s.enum as string[]).join('|')})`)

    expect(
      unmarked,
      'an unmarked enum generates a native model that throws on a member the server is free to ' +
        'start sending — one added operator bricks every installed client. Mark it, or record it in ' +
        'CLOSED_ON_PURPOSE with a reason.',
    ).toEqual([])
  })
})

describe('a decoder that honours the document', () => {
  const doc = buildOpenApiDocument() as unknown as Doc

  it('preserves an unknown member of a tolerant enum instead of throwing', () => {
    expect(decodeMember(doc, 'OperatorId', UNKNOWN_OPERATOR)).toEqual({
      known: false,
      unknown: 'NLB',
    })
    expect(decodeMember(doc, 'OperatorId', 'KMB')).toEqual({ known: true, value: 'KMB' })
  })

  it('still rejects an unknown member of a closed enum — tolerance is not "accept anything"', () => {
    // The document has no closed enum, so one is synthesized by removing the flag. This is the same
    // mutation the gate above is watched failing on, used here to prove the decoder discriminates:
    // without this assertion, `decodeMember` returning `{known: false}` unconditionally would pass
    // every other test in this file.
    const closed = structuredClone(doc)
    delete closed.components.schemas.OperatorId?.['x-unknown-tolerant']
    expect(() => decodeMember(closed, 'OperatorId', UNKNOWN_OPERATOR)).toThrow(
      /OperatorId is closed/,
    )
  })

  it('decodes a whole Eta carrying two unknown members and an undocumented field', () => {
    const payload = { ...etaWithUnknownMembers, someFieldFromTheFuture: 42 }
    const decoded = decode(doc, 'Eta', payload) as Record<string, unknown>

    expect(decoded.operator).toEqual({ known: false, unknown: 'NLB' })
    expect(decoded.remarkKind).toEqual({ known: false, unknown: 'typhoon' })
    // Open objects: the added field survives rather than failing the decode.
    expect(decoded.someFieldFromTheFuture).toBe(42)
    expect(decoded.arrivals).toEqual(['2026-07-29T14:31:00+08:00'])
  })

  it('leaves an absent remarkKind absent rather than defaulting it to "info"', () => {
    const { remark, remarkKind, ...withoutRemark } = etaWithUnknownMembers
    void remark
    void remarkKind
    const decoded = decode(doc, 'Eta', { ...withoutRemark, operator: 'KMB' }) as Record<
      string,
      unknown
    >

    // Not `toBeUndefined()` on a defaulted key: the assertion is that the key is *absent*, because a
    // port that filled in `info` would invent an honesty cue the operator never gave (ADR-008).
    expect('remarkKind' in decoded).toBe(false)
    expect('remark' in decoded).toBe(false)
  })
})

describe('the TypeScript runtime is not what protects a native client', () => {
  it('rejects the unknown operator, which is why the obligation sits on codegen', () => {
    // Asserted rather than worked around. `z.enum` is strict by design and this is the *correct*
    // behaviour for the edge, which must not invent operators it cannot serve. The consequence is
    // that no TypeScript gate can prove a native decoder is tolerant — only the document's flag
    // (asserted above) and a compiled native test (which does not exist yet) can.
    expect(OperatorIdSchema.safeParse(UNKNOWN_OPERATOR).success).toBe(false)
    expect(EtaSchema.safeParse(etaWithUnknownMembers).success).toBe(false)

    // And the reason the PWA is nonetheless unaffected: the schemas never reach its runtime. This is
    // asserted in `packages/core` rather than here; the note is so the asymmetry is not surprising.
    expect(OperatorIdSchema.safeParse('KMB').success).toBe(true)
  })
})
