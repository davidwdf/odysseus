import type { ComponentSpec, SlotNode, TextSource } from './schema'

/**
 * **The projection**: every string a component must show for one view model, in reading order, derived
 * from the spec rather than hand-written per renderer.
 *
 * This is the function WP6-1 exists to create. Both renderers had a hand-written `expectedText` before
 * it — 20 lines, deliberately duplicated, with ADR-069 decision 7's reasoning that *"a shared helper
 * lets one edit silently relax every renderer at once"*. That reasoning was right about **helpers** and
 * ADR-075 changes what is shared: the spec is now the declaration, reviewed as a contract, emitted and
 * drift-gated, and each renderer still owns the half where a renderer-specific mistake lives — how it
 * builds a tree and reads the text back out.
 *
 * What replaces the protection duplication gave is stronger than it looks, and it is worth being precise
 * about because it is the whole argument for doing this at all. The conformance check is **exact
 * equality**, so the spec is pinned from both sides: a missing slot means the renderers show text the
 * projection does not, and an invented slot means the projection expects text no renderer draws. Either
 * way, both suites go red. A wrong spec is therefore not a silently relaxed spec — with one exception,
 * stated rather than hidden: a rule that *neither* renderer implements and the spec does not mention is
 * invisible to all of this. That blind spot is what a second, independent renderer is for, which is
 * WP6-9.
 *
 * @param translate resolves a `message` source. Injected because this package must not know any
 * particular string catalogue — the same reason it takes no locale.
 */
export function project(
  spec: ComponentSpec,
  view: unknown,
  translate: (key: string, args?: Record<string, unknown>) => string,
): string[] {
  return projectNodes(spec.slots, view, translate, spec.component)
}

function projectNodes(
  nodes: readonly SlotNode[],
  scope: unknown,
  translate: (key: string, args?: Record<string, unknown>) => string,
  component: string,
): string[] {
  const out: string[] = []
  for (const node of nodes) {
    // Truthiness, not presence: an empty caption, an absent code, a zero count and a false flag are one
    // condition in this format, and `read` returns `undefined` for a path that does not resolve.
    if (node.when !== undefined && !read(scope, node.when)) continue

    if ('text' in node) {
      const text = resolve(node.text, scope, translate, component, node.name)
      // A node that resolves to nothing contributes nothing, rather than an empty string that would
      // shift every subsequent comparison by one. An unconditional slot resolving empty is a *spec*
      // error and is caught by the conformance run, not silently smoothed over here.
      if (text !== '') out.push(text)
      continue
    }

    if ('of' in node) {
      const items = read(scope, node.each)
      if (!Array.isArray(items)) {
        throw new Error(
          `${component}: slot \`${node.name}\` repeats over \`${node.each}\`, which is not an array.`,
        )
      }
      for (const item of items) out.push(...projectNodes(node.of, item, translate, component))
      continue
    }

    const discriminant = read(scope, node.oneOf)
    const branch = typeof discriminant === 'string' ? node.cases[discriminant] : undefined
    if (branch === undefined) {
      // Deliberately fatal. A view model that grew a variant the spec has never heard of is the exact
      // moment a specification stops describing the app, and the alternative — skipping the unknown
      // case — would let a whole ETA readout disappear from the projection while both suites stayed
      // green.
      throw new Error(
        `${component}: slot \`${node.name}\` has no case for \`${node.oneOf}\` = ` +
          `${JSON.stringify(discriminant)}. Cases: ${Object.keys(node.cases).join(', ')}`,
      )
    }
    out.push(...projectNodes(branch, scope, translate, component))
  }
  return out
}

function resolve(
  source: TextSource,
  scope: unknown,
  translate: (key: string, args?: Record<string, unknown>) => string,
  component: string,
  slot: string,
): string {
  if ('literal' in source) return source.literal
  if ('message' in source) {
    const args: Record<string, unknown> = {}
    for (const [name, path] of Object.entries(source.args ?? {})) args[name] = read(scope, path)
    return translate(source.message, source.args ? args : undefined)
  }
  const value = read(scope, source.field)
  if (value === undefined || value === null) return ''
  // Numbers are stringified rather than rejected: a count and a minutes value are both fields, and a
  // renderer prints them. Anything that is not a primitive is a spec mistake — a slot pointed at an
  // object would otherwise render `[object Object]` in the projection *and* pass, because no renderer
  // draws that either.
  if (typeof value === 'object') {
    throw new Error(
      `${component}: slot \`${slot}\` reads \`${source.field}\`, which is an object, not text.`,
    )
  }
  return String(value)
}

/** Read a dot path. Returns `undefined` for anything that does not resolve — the format's "absent". */
export function read(scope: unknown, path: string): unknown {
  let value: unknown = scope
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}
