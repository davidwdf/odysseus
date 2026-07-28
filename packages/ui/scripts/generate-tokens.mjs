#!/usr/bin/env node
/**
 * `pnpm --filter @nextbus/ui tokens:emit` — derives every design-token consumer from
 * `packages/ui/tokens.json`.
 *
 * The same colours used to be hand-maintained in four files: `src/themes.ts`, two
 * byte-identical `global.css` copies, and `preset.js` — which additionally restated the radii,
 * the type scale, and the CJK font fallback four times over. Nothing enforced agreement, so a
 * palette edit could land in one file and quietly not the others; that is the drift this
 * generator exists to make impossible. tokens.json is the only file a human edits, and
 * `check-tokens-current.mjs` fails the build when a committed artefact no longer matches it.
 *
 * Output is committed on purpose: a reviewer sees the effect of a token change in the diff, and
 * a consumer with no Node toolchain — a Swift package, say — can just read the file. It is piped
 * through Biome on the way out (the trick `scripts/boundaries/generate.mjs` uses) so generated
 * code never shows up as a lint failure. Swift and Kotlin skip that step because Biome has no
 * formatter for them.
 *
 * This script lives outside `packages/ui/src` deliberately: that directory is the `tokens` layer,
 * whose npm allowlist is closed and empty (`layers.json`), so nothing inside it may be tooling.
 * The same constraint is why there is no Style Dictionary here — for ~40 tokens a dependency
 * would buy nothing but a `layers.json` edit another work package owns.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ROOT = path.join(PKG, '..', '..')
export const SOURCE = 'packages/ui/tokens.json'
export const EMIT_CMD = 'pnpm --filter @nextbus/ui tokens:emit'

// ---------------------------------------------------------------------------
// Reading the declaration
// ---------------------------------------------------------------------------

const NS = 'com.nextbus'
const ALIAS = /^\{([^}]+)\}$/
const isLeaf = (n) => n !== null && typeof n === 'object' && !Array.isArray(n) && '$value' in n

const doc = JSON.parse(readFileSync(path.join(ROOT, SOURCE), 'utf8'))

const node = (dotted) =>
  dotted.split('.').reduce((n, key) => {
    if (n?.[key] === undefined) throw new Error(`${SOURCE}: no token at "${dotted}"`)
    return n[key]
  }, doc)

/** Direct child names of a group, in declaration order. `$`-prefixed keys are DTCG metadata. */
const names = (dotted) => Object.keys(node(dotted)).filter((k) => !k.startsWith('$'))
const describe = (dotted) => node(dotted).$description
const ext = (dotted) => node(dotted).$extensions?.[NS] ?? {}

/** Every leaf, with its `$type` resolved through the group nesting DTCG inherits it down. */
function index(group, inherited, prefix, out) {
  const groupType = group.$type ?? inherited
  for (const [key, child] of Object.entries(group)) {
    if (key.startsWith('$')) continue
    const dotted = prefix ? `${prefix}.${key}` : key
    if (isLeaf(child)) out.set(dotted, { node: child, type: child.$type ?? groupType, dotted })
    else index(child, groupType, dotted, out)
  }
  return out
}

const leaves = index(doc, undefined, '', new Map())

/** Alias targets actually referenced — so an unused primitive is a failure, not dead weight. */
const referenced = new Set()

/** Replace every `{dotted.path}` in a `$value` with the value it points at. */
function deref(value, from, seen = []) {
  if (typeof value === 'string') {
    const match = ALIAS.exec(value)
    if (!match) return value
    const target = match[1]
    if (seen.includes(target)) throw new Error(`${from}: alias cycle via {${target}}`)
    const leaf = leaves.get(target)
    if (!leaf) throw new Error(`${from}: alias {${target}} does not resolve to a token`)
    referenced.add(target)
    return deref(leaf.node.$value, target, [...seen, target])
  }
  if (Array.isArray(value)) return value.map((v) => deref(v, from, seen))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deref(v, from, seen)]))
  return value
}

const hex = (value, from) => {
  if (typeof value !== 'string' || !/^#[0-9A-F]{6}$/.test(value))
    throw new Error(`${from}: expected an uppercase #RRGGBB colour, got ${JSON.stringify(value)}`)
  return value
}

const scalar = (value, unit, from) => {
  if (value === null || typeof value !== 'object' || value.unit !== unit)
    throw new Error(`${from}: expected {value, unit: "${unit}"}, got ${JSON.stringify(value)}`)
  if (typeof value.value !== 'number') throw new Error(`${from}: the value must be a number`)
  return value.value
}

/** One leaf, converted to the plain JS value every emitter works from. */
function tokenValue({ node: leaf, type, dotted }) {
  const value = deref(leaf.$value, dotted)
  const own = leaf.$extensions?.[NS] ?? {}
  switch (type) {
    case 'color':
      return hex(value, dotted)
    case 'dimension':
      return scalar(value, 'px', dotted)
    case 'duration':
      return scalar(value, 'ms', dotted)
    case 'number':
      if (typeof value !== 'number') throw new Error(`${dotted}: expected a number`)
      return value
    case 'fontFamily':
      return value
    case 'fontWeight':
      if (!names('font.cut').includes(value))
        throw new Error(`${dotted}: "${value}" is not one of the font.cut names`)
      return value
    case 'shadow':
      if (typeof own.opacity !== 'number')
        throw new Error(`${dotted}: a shadow needs $extensions.${NS}.opacity`)
      return {
        color: hex(value.color, dotted),
        opacity: own.opacity,
        offsetX: scalar(value.offsetX, 'px', dotted),
        offsetY: scalar(value.offsetY, 'px', dotted),
        blur: scalar(value.blur, 'px', dotted),
        spread: scalar(value.spread, 'px', dotted),
        ...(value.inset ? { inset: true } : {}),
        ...(own.androidDp === undefined ? {} : { androidDp: own.androidDp }),
      }
    case undefined:
      throw new Error(`${dotted}: no $type, and no enclosing group declares one`)
    default:
      throw new Error(`${dotted}: unsupported $type "${type}"`)
  }
}

// Resolve everything before writing anything, so a bad alias fails the run rather than leaving
// half a set of artefacts behind.
const values = new Map([...leaves].map(([dotted, leaf]) => [dotted, tokenValue(leaf)]))
const at = (dotted) => {
  if (!values.has(dotted)) throw new Error(`${SOURCE}: no token at "${dotted}"`)
  return values.get(dotted)
}

// A primitive nobody aliases is either dead, or a sign that a semantic token got wired to a
// literal instead of to the palette. Both are worth failing on while the palette is small
// enough to fix by hand.
const orphans = names('palette').filter((n) => !referenced.has(`palette.${n}`))
if (orphans.length)
  throw new Error(
    `${SOURCE}: palette primitives that nothing aliases: ${orphans.join(', ')}.\n` +
      '  Alias them from a semantic or component token, or delete them.',
  )

// ---------------------------------------------------------------------------
// The shapes every emitter works from
// ---------------------------------------------------------------------------

const MODES = ['light', 'dark']

const semantic = names('color.semantic').map((name) => {
  const group = `color.semantic.${name}`
  const { cssVar, tailwind } = ext(group)
  if (!cssVar || !tailwind)
    throw new Error(
      `${group}: needs $extensions.${NS}.cssVar and .tailwind, so the CSS variable and the utility class stay in step`,
    )
  const declared = names(group)
  if (declared.join() !== MODES.join())
    throw new Error(
      `${group}: declares modes [${declared}] — every semantic token must declare [${MODES}]`,
    )
  return {
    name,
    cssVar,
    tailwind,
    description: describe(group),
    ...Object.fromEntries(MODES.map((mode) => [mode, at(`${group}.${mode}`)])),
  }
})

/** `#RRGGBB` → `R G B`, the form `rgb(var(--x) / <alpha-value>)` needs. */
const triplet = (h) => channels(h).join(' ')
const channels = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
const argb = (h) => `0xFF${h.slice(1)}`

const flat = (group) =>
  names(group).map((name) => ({
    name,
    value: at(`${group}.${name}`),
    description: describe(`${group}.${name}`),
  }))

const typeScale = names('type').map((name) => ({
  name,
  description: describe(`type.${name}`),
  fontSize: at(`type.${name}.fontSize`),
  lineHeight: at(`type.${name}.lineHeight`),
  weight: at(`type.${name}.weight`),
}))

const cuts = flat('font.cut')
const fallback = at('font.fallback')
/** A cut plus the shared fallback tail. The tail is declared once in tokens.json and composed
 *  here, which is why it is no longer written out four times in the preset. */
const stack = (cut) => [cut, ...fallback]

// ---------------------------------------------------------------------------
// Emitter plumbing
// ---------------------------------------------------------------------------

/** Hard-wrap prose, so a generated doc comment doesn't run to 900 columns. */
function wrap(text, width) {
  const out = []
  let line = ''
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) out.push(line)
  return out
}

/** A JSDoc/KDoc block — one line when it fits, a wrapped block when it doesn't. */
const block = (text, indent = '') => {
  if (!text) return []
  const lines = wrap(text, 92 - indent.length)
  return lines.length === 1
    ? [`${indent}/** ${lines[0]} */`]
    : [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`]
}

/** A run of `///` or `//` lines. */
const lines = (text, indent = '', marker = '///') =>
  text ? wrap(text, 96 - indent.length).map((l) => `${indent}${marker} ${l}`) : []

const banner = (marker) => [
  `${marker} Generated from ${SOURCE} by its scripts/generate-tokens.mjs — do not edit.`,
  `${marker} Run \`${EMIT_CMD}\`; \`pnpm --filter @nextbus/ui test\` fails on a stale`,
  `${marker} copy, so drifting from the declaration is a red build, not a silent surprise.`,
]

const ts = (v) => JSON.stringify(v)
/** The TS type for any CSS custom-property name, emitted verbatim. */
const CSS_VAR_TYPE = `\`--\${string}\``
/** Quote an object key only when it isn't a bare identifier (`surface-2`, `1`). */
const key = (name) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name))
/** `text-muted` → `textMuted`, `surface-2` → `surface2`, `KMB` → `kmb`. */
const camel = (name) =>
  /^[A-Z0-9]+$/.test(name)
    ? name.toLowerCase()
    : name.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
/** Spacing steps are numbers, and `4` is not an identifier in Swift or Kotlin. */
const ident = (name) => (/^\d/.test(name) ? `s${name}` : camel(name))
const pascal = (name) => name[0].toUpperCase() + name.slice(1)

// ---------------------------------------------------------------------------
// packages/ui/src/tokens.generated.ts
// ---------------------------------------------------------------------------

function tsShadow(s) {
  return `{ ${[
    `color: ${ts(s.color)}`,
    `opacity: ${s.opacity}`,
    `offsetX: ${s.offsetX}`,
    `offsetY: ${s.offsetY}`,
    `blur: ${s.blur}`,
    `spread: ${s.spread}`,
    ...(s.inset ? ['inset: true'] : []),
    ...(s.androidDp === undefined ? [] : [`androidDp: ${s.androidDp}`]),
  ].join(', ')} }`
}

function tsModule() {
  const L = [...banner('//'), '']
  L.push(
    ...block(
      'A platform-neutral shadow recipe. `blur` is a CSS blur radius (2σ), because that is what the DTCG shadow type means; the iOS recipe halves it to get `shadowRadius`, which is σ. `androidDp` is absent when the platform should draw the geometry rather than step a Material elevation — see `elevationStyle`.',
    ),
  )
  L.push('export interface ShadowToken {')
  L.push('  color: string')
  L.push('  opacity: number')
  L.push('  offsetX: number')
  L.push('  offsetY: number')
  L.push('  blur: number')
  L.push('  spread: number')
  L.push('  inset?: boolean')
  L.push('  androidDp?: number')
  L.push('}', '')

  L.push('/** The two modes of the single Ink theme (ADR-029). */')
  L.push(`export type ThemeMode = ${MODES.map(ts).join(' | ')}`, '')

  L.push(...block(describe('color.semantic')))
  L.push(
    `export const SEMANTIC_TOKENS = [${semantic.map((s) => ts(s.cssVar)).join(', ')}] as const`,
    '',
  )
  L.push('export type SemanticToken = (typeof SEMANTIC_TOKENS)[number]', '')

  L.push(
    ...block(
      'The semantic token values per mode, as "R G B" triplets. Keyed loosely, on any CSS custom-property name, so `themeColor()` can keep taking one; use `SemanticToken` where you want the narrow set.',
    ),
  )
  L.push(`export const THEME_VARS: Record<ThemeMode, Record<${CSS_VAR_TYPE}, string>> = {`)
  for (const mode of MODES) {
    L.push(`  ${mode}: {`)
    for (const s of semantic) L.push(`    ${ts(s.cssVar)}: ${ts(triplet(s[mode]))},`)
    L.push('  },')
  }
  L.push('}', '')

  for (const [group, name, suffix] of [
    ['color.brand', 'BRAND', ' as const'],
    ['color.operator', 'OPERATOR_ACCENT', ' as const'],
    ['color.operatorText', 'OPERATOR_ACCENT_TEXT', ': Record<OperatorAccent, string>'],
    ['color.map', 'MAP_COLOR', ' as const'],
    ['radius', 'RADIUS', ' as const'],
    ['spacing', 'SPACING', ' as const'],
    ['motion', 'MOTION', ' as const'],
    ['opacity', 'OPACITY', ' as const'],
    ['font.cut', 'FONT_FAMILY', ' as const'],
  ]) {
    const typed = suffix.startsWith(':')
    L.push(...block(describe(group)))
    L.push(`export const ${name}${typed ? suffix : ''} = {`)
    for (const t of flat(group)) {
      L.push(...block(t.description, '  '))
      L.push(`  ${key(t.name)}: ${typeof t.value === 'string' ? ts(t.value) : t.value},`)
    }
    L.push(`}${typed ? '' : suffix}`, '')
    if (name === 'OPERATOR_ACCENT')
      L.push('export type OperatorAccent = keyof typeof OPERATOR_ACCENT', '')
    if (name === 'FONT_FAMILY') L.push('export type FontWeightName = keyof typeof FONT_FAMILY', '')
  }

  L.push(...block(describe('font.fallback')))
  L.push(`export const FONT_FALLBACK = [${fallback.map(ts).join(', ')}] as const`, '')

  L.push('export interface TypeStyle {')
  L.push('  fontSize: number')
  L.push('  lineHeight: number')
  L.push('  weight: FontWeightName')
  L.push('}', '')
  L.push(...block(describe('type')))
  L.push('export const TYPE_SCALE = {')
  for (const t of typeScale) {
    L.push(...block(t.description, '  '))
    L.push(
      `  ${key(t.name)}: { fontSize: ${t.fontSize}, lineHeight: ${t.lineHeight}, weight: ${ts(t.weight)} },`,
    )
  }
  L.push('} satisfies Record<string, TypeStyle>', '')
  L.push('export type TypeVariant = keyof typeof TYPE_SCALE', '')

  for (const [group, name, satisfies] of [
    ['elevation', 'ELEVATION', 'Record<string, ShadowToken>'],
    ['glassShadow', 'GLASS_SHADOW', "Record<'contact' | 'ambient', ShadowToken>"],
  ]) {
    L.push(...block(describe(group)))
    L.push(`export const ${name} = {`)
    for (const s of flat(group)) {
      L.push(...block(s.description, '  '))
      L.push(`  ${key(s.name)}: ${tsShadow(s.value)},`)
    }
    L.push(`} satisfies ${satisfies}`, '')
  }

  L.push(...block(describe('glassRim')))
  L.push('export const GLASS_RIM = {')
  for (const edge of names('glassRim')) {
    L.push(`  ${key(edge)}: {`)
    for (const mode of MODES) L.push(`    ${mode}: ${tsShadow(at(`glassRim.${edge}.${mode}`))},`)
    L.push('  },')
  }
  L.push("} satisfies Record<'top' | 'bottom', Record<ThemeMode, ShadowToken>>")
  return `${L.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// packages/ui/preset.js — the Tailwind / NativeWind preset
// ---------------------------------------------------------------------------

function preset() {
  const L = [...banner('//'), '//']
  L.push('// Semantic tokens mapped to CSS variables. Components only ever use these semantic')
  L.push('// classes (bg-bg, text-muted, text-accent…), so swapping the mode re-skins everything')
  L.push('// with zero component changes. The mapping is generated too: declaring a semantic token')
  L.push('// in tokens.json is all it takes for its utility class to exist.')
  L.push('// Use alongside nativewind/preset:')
  L.push("//   presets: [require('nativewind/preset'), require('@nextbus/ui/preset')]")
  L.push('')
  L.push("/** @type {import('tailwindcss').Config} */")
  L.push('module.exports = {')
  L.push('  theme: {')
  L.push('    extend: {')
  L.push('      colors: {')
  for (const s of semantic)
    L.push(`        ${key(s.tailwind)}: 'rgb(var(${s.cssVar}) / <alpha-value>)',`)
  L.push('        // Fixed brand ink — NOT a semantic token, so it does not invert with the')
  L.push('        // appearance. Use sparingly, e.g. a fixed dark glass tint (`bg-ink/55`).')
  L.push(`        ink: 'rgb(${triplet(at('color.brand.ink'))} / <alpha-value>)',`)
  L.push('      },')
  L.push('      borderRadius: {')
  for (const r of flat('radius')) L.push(`        ${key(r.name)}: '${r.value}px',`)
  L.push('      },')
  L.push('      // In rem, so the web build keeps honouring the browser font size: the px scale in')
  L.push("      // tokens.json over the 16px base, which is exactly Tailwind's own default scale —")
  L.push('      // restated here only so tokens.json is its declaration for the native platforms.')
  L.push('      spacing: {')
  for (const s of flat('spacing')) L.push(`        ${key(s.name)}: '${s.value / 16}rem',`)
  L.push('      },')
  L.push('      // The named type scale → `text-display`, `text-h1`, … as [size, lineHeight]. The')
  L.push('      // <Text> primitive is the canonical consumer; these keep the scale available to')
  L.push('      // any className-driven markup too.')
  L.push('      fontSize: {')
  for (const t of typeScale)
    L.push(`        ${key(t.name)}: ['${t.fontSize}px', '${t.lineHeight}px'],`)
  L.push('      },')
  L.push('      // Every Inter cut plus the shared fallback tail. On web that gives a real stack')
  L.push('      // incl. CJK; on native fontFamily is single-valued and the OS handles CJK glyph')
  L.push('      // fallback, and the <Text> primitive sets the cut directly.')
  L.push('      fontFamily: {')
  L.push(`        sans: [${stack(at('font.cut.regular')).map(ts).join(', ')}],`)
  for (const c of cuts.filter((c) => c.name !== 'regular'))
    L.push(`        ${key(c.name)}: [${stack(c.value).map(ts).join(', ')}],`)
  L.push('      },')
  L.push('    },')
  L.push('  },')
  L.push('}')
  return `${L.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// apps/mobile/global.css — the web defaults for the CSS variables
// ---------------------------------------------------------------------------

function globalCss() {
  const L = ['/*']
  L.push(...banner(' '), '')
  L.push(
    '  The web defaults for the semantic tokens — the single Ink theme (ADR-029): ink-on-paper',
  )
  L.push('  light, paper-on-ink dark. Runtime theme switching, and native, inject the same values')
  L.push("  via NativeWind's `vars()` from @nextbus/ui `themes`, applied at the app root in")
  L.push('  app/_layout.tsx. Wired into the bundle as the NativeWind input by metro.config.js.')
  L.push('*/')
  L.push('@tailwind base;')
  L.push('@tailwind components;')
  L.push('@tailwind utilities;')
  L.push('')
  L.push(':root {')
  for (const s of semantic) L.push(`  ${s.cssVar}: ${triplet(s.light)};`)
  L.push('}')
  L.push('')
  L.push('.dark {')
  for (const s of semantic) L.push(`  ${s.cssVar}: ${triplet(s.dark)};`)
  L.push('}')
  return `${L.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// packages/ui/generated/tokens.json — every token resolved, for tools with no TS toolchain
// ---------------------------------------------------------------------------

function resolvedJson() {
  const out = {
    $comment: `Every token in ${SOURCE}, with aliases resolved and units flattened to plain numbers. Generated — run \`${EMIT_CMD}\`. Read this from a build script (scripts/gen-icons.mjs does); edit ${SOURCE}.`,
  }
  for (const [dotted, value] of values) out[dotted] = value
  return `${JSON.stringify(out, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Swift + Kotlin — unverified by construction: this repo has no compiler for either
// ---------------------------------------------------------------------------

const UNVERIFIED =
  'UNVERIFIED: this repo has no Swift or Kotlin toolchain, so nothing below has ever been compiled. It is deliberately plain — nested namespaces of constants, no protocols, no generics, no extensions — so the first native client can compile it as-is, and so any fix is a one-line change to the emitter. Treat a compile error here as a bug in generate-tokens.mjs, not something to patch in place.'

function swift() {
  const L = [...banner('//'), '//', ...lines(UNVERIFIED, '', '//'), '//']
  L.push('// Assumes SwiftUI (iOS 13+) for `Color` and `CGFloat`.')
  L.push('', 'import SwiftUI', '')
  L.push('public enum NextBusTokens {')
  const colour = (h) => {
    const [r, g, b] = channels(h)
    return `Color(red: ${r} / 255, green: ${g} / 255, blue: ${b} / 255)`
  }

  L.push('    /// The two modes of the single Ink theme (ADR-029).')
  L.push('    public enum Mode {')
  for (const mode of MODES) L.push(`        case ${mode}`)
  L.push('    }')

  for (const mode of MODES) {
    L.push('', ...lines(`The semantic colours in the ${mode} mode (docs/09 §2).`, '    '))
    L.push(`    public enum ${pascal(mode)}Color {`)
    for (const s of semantic) {
      L.push(...lines(s.description, '        '))
      L.push(`        public static let ${camel(s.name)} = ${colour(s[mode])}`)
    }
    L.push('    }')
  }

  for (const [group, name] of [
    ['color.brand', 'BrandColor'],
    ['color.operator', 'OperatorColor'],
    ['color.operatorText', 'OperatorTextColor'],
    ['color.map', 'MapColor'],
  ]) {
    L.push('', ...lines(describe(group), '    '))
    L.push(`    public enum ${name} {`)
    for (const c of flat(group)) {
      L.push(...lines(c.description, '        '))
      L.push(`        public static let ${camel(c.name)} = ${colour(c.value)}`)
    }
    L.push('    }')
  }

  for (const [group, name] of [
    ['radius', 'Radius'],
    ['spacing', 'Spacing'],
  ]) {
    L.push('', ...lines(describe(group), '    '))
    L.push(`    public enum ${name} {`)
    for (const t of flat(group)) {
      L.push(...lines(t.description, '        '))
      L.push(`        public static let ${ident(t.name)}: CGFloat = ${t.value}`)
    }
    L.push('    }')
  }

  L.push(
    '',
    ...lines(`${describe('motion')} Emitted in seconds, the unit SwiftUI animations take.`, '    '),
  )
  L.push('    public enum Motion {')
  for (const t of flat('motion'))
    L.push(`        public static let ${ident(t.name)}: Double = ${t.value / 1000}`)
  L.push('    }')

  L.push('', '    public enum Opacity {')
  for (const t of flat('opacity')) {
    L.push(...lines(t.description, '        '))
    L.push(`        public static let ${ident(t.name)}: Double = ${t.value}`)
  }
  L.push('    }')

  L.push('', ...lines(describe('font.cut'), '    '))
  L.push('    public enum FontCut {')
  for (const c of cuts) L.push(`        public static let ${camel(c.name)} = ${ts(c.value)}`)
  L.push('    }')

  L.push('', ...lines(describe('font.fallback'), '    '))
  L.push(`    public static let fontFallback: [String] = [${fallback.map(ts).join(', ')}]`)

  L.push('', ...lines(describe('type'), '    '))
  L.push('    public enum TypeScale {')
  L.push('        public struct Style {')
  L.push('            public let size: CGFloat')
  L.push('            public let lineHeight: CGFloat')
  L.push("            /// One of `FontCut`'s names: RN and SwiftUI both want the concrete cut.")
  L.push('            public let cut: String')
  L.push('        }')
  for (const t of typeScale) {
    L.push(...lines(t.description, '        '))
    L.push(
      `        public static let ${camel(t.name)} = Style(size: ${t.fontSize}, lineHeight: ${t.lineHeight}, cut: ${ts(t.weight)})`,
    )
  }
  L.push('    }')

  L.push('', ...lines(describe('elevation'), '    '))
  L.push('    public enum Elevation {')
  L.push('        public struct Shadow {')
  L.push('            public let color: Color')
  L.push('            public let opacity: Double')
  L.push("            /// SwiftUI's shadow radius is σ, so this is the token's CSS blur halved.")
  L.push('            public let radius: CGFloat')
  L.push('            public let x: CGFloat')
  L.push('            public let y: CGFloat')
  L.push('            /// Material step, Android only; nil when the platform draws the geometry.')
  L.push('            public let androidDp: CGFloat?')
  L.push('        }')
  for (const s of flat('elevation')) {
    L.push(...lines(s.description, '        '))
    L.push(`        public static let ${camel(s.name)} = ${swiftShadow(s.value)}`)
  }
  L.push('    }')

  L.push('', ...lines(describe('glassShadow'), '    '))
  L.push('    public enum GlassShadow {')
  for (const s of flat('glassShadow'))
    L.push(`        public static let ${camel(s.name)} = ${swiftShadow(s.value, 'Elevation.')}`)
  L.push('    }')
  L.push('}')

  function swiftShadow(s, qualifier = '') {
    const dp = s.androidDp === undefined ? 'nil' : String(s.androidDp)
    return `${qualifier}Shadow(color: ${colour(s.color)}, opacity: ${s.opacity}, radius: ${s.blur / 2}, x: ${s.offsetX}, y: ${s.offsetY}, androidDp: ${dp})`
  }
  return `${L.join('\n')}\n`
}

function kotlin() {
  const L = [...banner('//'), '//', ...lines(UNVERIFIED, '', '//'), '//']
  L.push('// Assumes Jetpack Compose for `Color`, `Dp` and `TextUnit`.')
  L.push('', 'package hk.nextbus.tokens', '')
  L.push('import androidx.compose.ui.graphics.Color')
  L.push('import androidx.compose.ui.unit.Dp')
  L.push('import androidx.compose.ui.unit.TextUnit')
  L.push('import androidx.compose.ui.unit.dp')
  L.push('import androidx.compose.ui.unit.sp')
  L.push('', 'object NextBusTokens {')

  L.push('    /** The two modes of the single Ink theme (ADR-029). */')
  L.push(`    enum class Mode { ${MODES.map((m) => m.toUpperCase()).join(', ')} }`)

  for (const mode of MODES) {
    L.push('', ...block(`The semantic colours in the ${mode} mode (docs/09 §2).`, '    '))
    L.push(`    object ${pascal(mode)}Color {`)
    for (const s of semantic) {
      L.push(...block(s.description, '        '))
      L.push(`        val ${camel(s.name)}: Color = Color(${argb(s[mode])})`)
    }
    L.push('    }')
  }

  for (const [group, name] of [
    ['color.brand', 'BrandColor'],
    ['color.operator', 'OperatorColor'],
    ['color.operatorText', 'OperatorTextColor'],
    ['color.map', 'MapColor'],
  ]) {
    L.push('', ...block(describe(group), '    '))
    L.push(`    object ${name} {`)
    for (const c of flat(group)) {
      L.push(...block(c.description, '        '))
      L.push(`        val ${camel(c.name)}: Color = Color(${argb(c.value)})`)
    }
    L.push('    }')
  }

  for (const [group, name] of [
    ['radius', 'Radius'],
    ['spacing', 'Spacing'],
  ]) {
    L.push('', ...block(describe(group), '    '))
    L.push(`    object ${name} {`)
    for (const t of flat(group)) {
      L.push(...block(t.description, '        '))
      L.push(`        val ${ident(t.name)}: Dp = ${t.value}.dp`)
    }
    L.push('    }')
  }

  L.push(
    '',
    ...block(
      `${describe('motion')} Emitted in milliseconds, the unit Compose \`tween\` takes.`,
      '    ',
    ),
  )
  L.push('    object Motion {')
  for (const t of flat('motion')) L.push(`        const val ${ident(t.name)}: Int = ${t.value}`)
  L.push('    }')

  L.push('', '    object Opacity {')
  for (const t of flat('opacity')) {
    L.push(...block(t.description, '        '))
    L.push(`        const val ${ident(t.name)}: Float = ${t.value}f`)
  }
  L.push('    }')

  L.push('', ...block(describe('font.cut'), '    '))
  L.push('    object FontCut {')
  for (const c of cuts) L.push(`        const val ${camel(c.name)}: String = ${ts(c.value)}`)
  L.push('    }')

  L.push('', ...block(describe('font.fallback'), '    '))
  L.push(`    val fontFallback: List<String> = listOf(${fallback.map(ts).join(', ')})`)

  L.push('', ...block(describe('type'), '    '))
  L.push('    object TypeScale {')
  L.push('        data class Style(val size: TextUnit, val lineHeight: TextUnit, val cut: String)')
  for (const t of typeScale) {
    L.push(...block(t.description, '        '))
    L.push(
      `        val ${camel(t.name)} = Style(${t.fontSize}.sp, ${t.lineHeight}.sp, ${ts(t.weight)})`,
    )
  }
  L.push('    }')

  L.push('', ...block(describe('elevation'), '    '))
  L.push('    object Elevation {')
  L.push('        data class Shadow(')
  L.push('            val color: Color,')
  L.push('            val opacity: Float,')
  L.push('            /** The CSS blur radius. Compose draws from `dp`; this is for a painter. */')
  L.push('            val blur: Dp,')
  L.push('            val offsetX: Dp,')
  L.push('            val offsetY: Dp,')
  L.push('            /** Material step; null when the platform draws the geometry instead. */')
  L.push('            val dp: Dp?,')
  L.push('        )')
  for (const s of flat('elevation')) {
    L.push(...block(s.description, '        '))
    L.push(`        val ${camel(s.name)} = ${kotlinShadow(s.value)}`)
  }
  L.push('    }')

  L.push('', ...block(describe('glassShadow'), '    '))
  L.push('    object GlassShadow {')
  for (const s of flat('glassShadow'))
    L.push(`        val ${camel(s.name)} = ${kotlinShadow(s.value, 'Elevation.')}`)
  L.push('    }')
  L.push('}')

  function kotlinShadow(s, qualifier = '') {
    const dp = s.androidDp === undefined ? 'null' : `${s.androidDp}.dp`
    return `${qualifier}Shadow(Color(${argb(s.color)}), ${s.opacity}f, ${s.blur}.dp, ${s.offsetX}.dp, ${s.offsetY}.dp, ${dp})`
  }
  return `${L.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const BIOME_FORMATS = /\.(m?[jt]sx?|css|json)$/

const format = (text, file) =>
  BIOME_FORMATS.test(file)
    ? execFileSync('node_modules/.bin/biome', ['format', `--stdin-file-path=${file}`], {
        cwd: ROOT,
        input: text,
        encoding: 'utf8',
      })
    : text

/** @returns {{file: string, text: string}[]} every artefact, keyed by repo-relative path. */
export function generate() {
  return [
    { file: 'packages/ui/src/tokens.generated.ts', text: tsModule() },
    { file: 'packages/ui/preset.js', text: preset() },
    { file: 'apps/mobile/global.css', text: globalCss() },
    { file: 'packages/ui/generated/tokens.json', text: resolvedJson() },
    { file: 'packages/ui/generated/NextBusTokens.swift', text: swift() },
    { file: 'packages/ui/generated/NextBusTokens.kt', text: kotlin() },
  ].map(({ file, text }) => ({ file, text: format(text, file) }))
}

if (process.argv[1] === import.meta.filename) {
  for (const { file, text } of generate()) {
    const out = path.join(ROOT, file)
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, text)
    console.log(`tokens: wrote ${file}`)
  }
  console.log(
    `tokens: ${values.size} tokens · ${semantic.length} semantic colours × ${MODES.length} modes`,
  )
}
