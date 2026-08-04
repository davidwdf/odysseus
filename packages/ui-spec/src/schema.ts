import { z } from 'zod'

/**
 * **The component-spec format**: what a component renders, in what order, in which states, with which
 * interaction targets — as data validated by a schema, never as prose (ADR-075 decision 3).
 *
 * ## What this package may and may not know
 *
 * Nothing here names a stop, a route, an arrival or a bus. That is not tidiness: ADR-075 decision 7 says
 * the portable half of this system is extracted only when a second app needs it, and *"a `ui-spec` that
 * has grown a `stopId` is the early warning"* that it is being built for one consumer. Two mechanisms
 * hold the line — `layers.json` gives this layer `use: []`, so it cannot import the contract or the
 * kernel, and `scripts/check-no-domain-vocabulary.mjs` scans for the words, because an import graph
 * cannot see a type *named* after a bus.
 *
 * ## Why prose was not an option, and where prose survives anyway
 *
 * `docs/09` §6 has been titled *"ETA display spec"* since Wave 1 and is prose, and the imminence band it
 * describes was simultaneously written down **four times with two different values**. So the *structure*
 * is data: which slots exist, their order, what gates each one, which states must be declared, what each
 * state must and must not look like. What stays prose is the content of a `must`/`mustNot` sentence —
 * because "a skeleton in the shape of the card" is a judgement a schema cannot hold. The schema's job
 * there is to make the sentence **mandatory and located**, and to make each state declare whether
 * anything actually checks it (`enforcement`, below). A spec that quietly omitted a state would be the
 * repo's recurring failure — a gate that passes because it is looking at nothing.
 *
 * ## The vocabulary is five words, and StopRow needed all five
 *
 * `field` · `message` · `literal` · `each` · `oneOf`. The format was validated by retrofitting it to a
 * component that demonstrably works rather than by designing it first (ADR-075 decision 5), and each of
 * the five is there because that component could not be expressed without it: a repeated row list needs
 * `each`, an ETA readout that is either a number-plus-unit, a word, or a dash needs `oneOf`, and the
 * arrow before a destination is a `literal` the renderer supplies. There is deliberately **no expression
 * language** — `when` is a *path*, tested for truthiness, never a predicate to evaluate. Code in data is
 * how a specification becomes a second implementation.
 */

/**
 * A dot path into the view model, rooted at the current scope (the view, or the current `each` item).
 *
 * Constrained by a pattern rather than left as `string` so a typo is a schema failure at emit time
 * instead of an `undefined` that reads as "absent" at test time — which would make a slot silently
 * optional and the exact-equality projection silently weaker.
 */
export const PathSchema = z
  .string()
  .regex(/^[a-zA-Z_][A-Za-z0-9_]*(?:\.[a-zA-Z_][A-Za-z0-9_]*)*$/, 'a dot path like `name.label`')

/**
 * Where one piece of visible text comes from. Exactly one of the three, and the distinction is the
 * point:
 *
 * - **`field`** — the view model's own value. The kernel decided it; the renderer prints it.
 * - **`message`** — a key in the app's string catalogue, with arguments read from the view model. The
 *   kernel supplies the count; the catalogue owns the plural rule and the wording (ADR-054). The
 *   harness never resolves it itself — the driver passes a `translate`, which is what keeps this
 *   package free of any particular catalogue.
 * - **`literal`** — a glyph the *renderer* supplies, like the arrow before a destination. It needs a
 *   `why`, because a literal in a spec is the one shape here that could quietly become an
 *   untranslated English string.
 */
export const TextSourceSchema = z.union([
  z.strictObject({ field: PathSchema }),
  z.strictObject({
    message: z.string().min(1),
    /** Argument name → the path its value is read from. */
    args: z.record(z.string().min(1), PathSchema).optional(),
  }),
  z.strictObject({ literal: z.string().min(1), why: z.string().min(1) }),
])
export type TextSource = z.infer<typeof TextSourceSchema>

/** Shared by every node: what it is called, when it is absent, and what a renderer could get wrong. */
const nodeCommon = {
  /** Stable name — what a state's `enforcement.by` and a finding's message refer to. */
  name: z.string().min(1),
  /**
   * The path whose **truthiness** gates this node. Absent means unconditional.
   *
   * A path and not a predicate, deliberately. Every conditional StopRow has is a presence test — an
   * empty caption, an absent code, a zero count, a false flag — and JavaScript's falsiness covers all
   * four. The moment a spec needs `> 0` the number belongs in the view model, which is exactly the
   * argument `check-no-derivation` makes to a renderer.
   */
  when: PathSchema.optional(),
  /**
   * Why this node can be absent. **Required whenever `when` is**, because a bare optional teaches
   * nobody: `proposals/04`'s checklist says *"the `why` is the part that survives"*.
   */
  why: z.string().min(1).optional(),
  /** Something a renderer could plausibly get wrong here, in one sentence, with its citation. */
  invariant: z.string().min(1).optional(),
}

export interface TextNode {
  name: string
  when?: string
  why?: string
  invariant?: string
  text: TextSource
}
export interface EachNode {
  name: string
  when?: string
  why?: string
  invariant?: string
  /** The array to repeat over. Paths inside `of` are rooted at each item. */
  each: string
  of: SlotNode[]
}
export interface OneOfNode {
  name: string
  when?: string
  why?: string
  invariant?: string
  /** The discriminant's path. Its value selects a case; a value with no case is a **failure**, which is
   *  how the spec goes red when the view model grows a variant rather than silently ignoring it. */
  oneOf: string
  cases: Record<string, SlotNode[]>
}
export type SlotNode = TextNode | EachNode | OneOfNode

export const SlotNodeSchema: z.ZodType<SlotNode> = z.lazy(() =>
  z.union([
    z.strictObject({ ...nodeCommon, text: TextSourceSchema }),
    z.strictObject({ ...nodeCommon, each: PathSchema, of: z.array(SlotNodeSchema).min(1) }),
    z.strictObject({
      ...nodeCommon,
      oneOf: PathSchema,
      cases: z.record(z.string().min(1), z.array(SlotNodeSchema)),
    }),
  ]),
)

/**
 * How a declared state is held to.
 *
 * Every state must say which of the three it is, and that is the anti-vacuous rule of this whole
 * format. A spec full of `mustNot` sentences that nothing checks reads exactly like a spec that is
 * enforced, and this repo has shipped that failure four times in other guises (ADR-070's cache key, the
 * rules that fired on a stale `dist/`, the field-reference gate that was built and deleted, the native
 * artefacts that would have been compared only on the machine that made them).
 *
 * - **`by`** — the slot that makes the state observable. The harness asserts the name resolves, so the
 *   claim cannot be made falsely.
 * - **`knownDefect`** — no renderer satisfies it *yet*. Wave 2 pinned four of these in the corpus rather
 *   than fixing them, for the reason ADR-075 restates: identical and visible beats different and hidden.
 *   Needs the citation and the owner.
 * - **`unenforced`** — nothing at this layer can check it, and why. A skeleton's *shape* is the usual
 *   one.
 */
export const EnforcementSchema = z.union([
  z.strictObject({ by: z.string().min(1) }),
  z.strictObject({ knownDefect: z.string().min(1) }),
  z.strictObject({ unenforced: z.string().min(1) }),
])

export const StateSchema = z.strictObject({
  must: z.string().min(1),
  /** What it must **not** look like. Every known defect becomes one of these, with its citation. */
  mustNot: z.string().min(1),
  why: z.string().min(1).optional(),
  enforcement: EnforcementSchema,
})

/**
 * The five states, all mandatory.
 *
 * ADR-075 puts *"that each of loading / empty / error / stale / offline is distinguishable and
 * non-blank"* on the identity side of the invariant line, and `proposals/04` traces two of `docs/11`'s
 * open bugs to states that *"nothing ever declared"* — a favourite with no arrival renders an empty
 * card, an upstream outage blanks a screen. Neither is a rendering bug. So the schema will not accept a
 * spec that has not thought about all five, and `failed` is spelled that way rather than `error` because
 * ADR-073's distinction — a board that refused is not a board that is empty — is the one the app makes.
 */
export const StatesSchema = z.strictObject({
  loading: StateSchema,
  empty: StateSchema,
  failed: StateSchema,
  stale: StateSchema,
  offline: StateSchema,
})

export const InteractionSchema = z.strictObject({
  /** The slot the rider touches. Asserted to name a real one. */
  target: z.string().min(1),
  /** Where it goes — a destination name, not a URL: the path is the shell's business, not the card's. */
  goes: z.string().min(1),
  /** True when the target may be inert. The harness then requires the *text* to be unchanged — see
   *  `conform.ts`, and ADR-069's overflow finding, which is why this flag exists at all. */
  optional: z.boolean().optional(),
  note: z.string().min(1).optional(),
})

export const A11ySchema = z.strictObject({
  role: z.string().min(1),
  /**
   * Where the accessible name comes from. `fromSlot` is the common case and the honest one for a
   * control whose content *is* its name; `i18nKey` is for a control with no text, where an English
   * literal would otherwise be shipped to a screen reader in a Chinese UI.
   */
  name: z.union([
    z.strictObject({ fromSlot: z.string().min(1) }),
    z.strictObject({ i18nKey: z.string().min(1), reads: z.string().min(1) }),
  ]),
  reducedMotion: z.string().min(1),
})

export const ComponentSpecSchema = z.strictObject({
  component: z.string().min(1),
  version: z.number().int().positive(),
  doc: z.string().min(1),
  /**
   * The view model this component renders, and where its cases come from. **No spec may contain a
   * derivation** (`proposals/04`'s checklist): the content is one kernel function's output, pinned by a
   * corpus, and the corpus is what both renderers' suites replay — so the golden cannot drift from what
   * the kernel actually produces, and a rule change goes red in every suite at once.
   */
  viewModel: z.strictObject({
    module: z.string().min(1),
    type: z.string().min(1),
    corpus: z.string().min(1),
    group: z.string().min(1),
  }),
  /** Every piece of visible text, in reading order. Order is asserted, not merely listed. */
  slots: z.array(SlotNodeSchema).min(1),
  states: StatesSchema,
  interactions: z.array(InteractionSchema),
  a11y: A11ySchema,
  /**
   * What is explicitly **not** shared — named by enumeration so that "flexible" has edges (ADR-075's
   * invariant/idiom table, applied per component). An empty list is rejected: if nothing about a
   * component is idiom, say so by listing the one thing that is, because a component with no idiom at
   * all is usually a component nobody has thought about.
   */
  idiom: z.array(z.string().min(1)).min(1),
})

export type ComponentSpec = z.infer<typeof ComponentSpecSchema>
export type ComponentState = z.infer<typeof StateSchema>
export type Interaction = z.infer<typeof InteractionSchema>

/**
 * Validate a spec, and check the things a Zod schema cannot: that every cross-reference resolves.
 *
 * A `states.failed.enforcement.by` naming a slot that does not exist, or an `interactions[].target`
 * naming one, is the shape of rot this format is most exposed to — a slot gets renamed and the claim
 * that something enforces a state survives as a string. So the references are resolved here, at emit
 * time and again in every conformance run, and a dangling one throws with both names in the message.
 */
export function parseComponentSpec(input: unknown): ComponentSpec {
  const spec = ComponentSpecSchema.parse(input)
  const names = new Set<string>()
  const collect = (nodes: readonly SlotNode[]): void => {
    for (const node of nodes) {
      names.add(node.name)
      if ('of' in node) collect(node.of)
      if ('cases' in node) for (const branch of Object.values(node.cases)) collect(branch)
      if (node.when !== undefined && node.why === undefined) {
        throw new Error(
          `${spec.component}: slot \`${node.name}\` is conditional (\`when\`) but has no \`why\`. ` +
            'A bare optional teaches nobody why it can be absent.',
        )
      }
    }
  }
  collect(spec.slots)

  for (const [state, declared] of Object.entries(spec.states)) {
    const by = 'by' in declared.enforcement ? declared.enforcement.by : null
    if (by !== null && !names.has(by)) {
      throw new Error(
        `${spec.component}: state \`${state}\` claims to be enforced by slot \`${by}\`, ` +
          `which does not exist. Slots: ${[...names].join(', ')}`,
      )
    }
  }
  for (const interaction of spec.interactions) {
    if (!names.has(interaction.target)) {
      throw new Error(
        `${spec.component}: interaction target \`${interaction.target}\` is not a slot. ` +
          `Slots: ${[...names].join(', ')}`,
      )
    }
  }
  const nameFrom = spec.a11y.name
  if ('fromSlot' in nameFrom && !names.has(nameFrom.fromSlot)) {
    throw new Error(
      `${spec.component}: a11y name comes from slot \`${nameFrom.fromSlot}\`, which does not exist.`,
    )
  }
  return spec
}
