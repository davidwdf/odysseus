// The wire contract's primitives. These schemas are the **single declaration** of every shape
// that crosses the network; `@nextbus/core`'s types are `z.infer` of them (ADR-052), and the
// OpenAPI document a native client generates from is emitted from them. One edit here, and every
// platform either regenerates or fails CI — nothing is transcribed by hand.
//
// Three rules hold everywhere in `src/wire/`:
//
// 1. **No shape changes during WP1-1.** These are a faithful transcription of what
//    `packages/core/src/types.ts` already declared and what the Worker already returns. Anything
//    that looks wrong is recorded as an adjustment candidate in `docs/08` ADR-052, not fixed here
//    — a refactor that also changes the wire is a refactor nobody can review.
// 2. **Every named shape carries `.meta({ id })`.** Zod hoists a schema with an `id` into
//    `$defs` and references it, which is what turns into a reusable OpenAPI component instead of
//    the same object inlined nine times.
// 3. **Closed enums are marked `x-unknown-tolerant`.** See the note on `OperatorId` below.

import { z } from 'zod'

/** Supported UI + data locales. Traditional Chinese is the primary HK form. */
export const LocaleSchema = z
  .enum(['en', 'zh-Hant', 'zh-Hans'])
  .meta({ id: 'Locale', 'x-unknown-tolerant': true })

/**
 * Localized text; every name from the operators carries these variants.
 *
 * Transcribed as an explicit object rather than `z.record(LocaleSchema, z.string())` because
 * `Record<Locale, string>` requires **all three** keys, and a record schema would emit an
 * open-ended map that lets a native client compile happily and then find `zh-Hans` missing at
 * runtime. The three keys are required on the wire and this says so.
 */
export const I18nTextSchema = z
  .object({
    en: z.string(),
    'zh-Hant': z.string(),
    'zh-Hans': z.string(),
  })
  .meta({ id: 'I18nText' })

/**
 * Operators in scope. v1 = KMB/LWB + Citybus + Green Minibus (GMB); rail/NLB/MTR-Bus are in the
 * consolidated dataset but out of v1 scope.
 *
 * **`x-unknown-tolerant: true` is load-bearing, not decoration.** The day a fourth operator ships,
 * the server starts emitting a value no already-installed phone has ever heard of. A generated
 * Swift `enum` with four cases throws on decode, and one added operator bricks every deployed
 * client — a store release to fix, on iOS review time, for what should be a data change. The flag
 * tells the generators to emit `case unknown(String)` / a Kotlin fallback instead.
 *
 * Note what this does **not** need to protect: the web client. Because `@nextbus/core` imports
 * these schemas with `import type`, they erase completely and the PWA does no runtime validation
 * at all (proven — `types.js` emits `export {};`). An unknown operator reaches a web
 * `switch` as an ordinary unmatched string. So this obligation binds generated native decoders
 * and the conformance tests, and it must be **enforced at codegen** in WP3-3, because nothing in
 * the TS build can fail to remind us.
 */
export const OperatorIdSchema = z
  .enum(['KMB', 'LWB', 'CTB', 'GMB'])
  .meta({ id: 'OperatorId', 'x-unknown-tolerant': true })

/** Direction of travel. */
export const BoundSchema = z
  .enum(['inbound', 'outbound'])
  .meta({ id: 'Bound', 'x-unknown-tolerant': true })

/** A geographic coordinate (WGS84). */
export const LatLngSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .meta({ id: 'LatLng' })

export const OperatorSchema = z
  .object({
    id: OperatorIdSchema,
    name: I18nTextSchema,
  })
  .meta({ id: 'Operator' })
