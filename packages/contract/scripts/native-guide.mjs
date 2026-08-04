// The generated regions of the native-consumer guide — `README.md` and the two conformance
// templates beside it.
//
// WHY ANY OF THIS IS GENERATED
// `README.md` is a document whose whole job is to tell another repository what to consume and how
// many of it there is. Every figure in it is therefore a fact about this tree that a later commit
// can invalidate silently, and we have a worked example of exactly that: ADR-060 recorded
// "36 groups, 274 cases" and was still saying so two waves later, by which point the real corpus was
// 65 groups and 510 cases. A README written the same way rots the same way — and it rots pointing at
// a *native* repo, where the cost of a wrong figure is a porter who believes their suite is complete.
//
// So the figures are not written down. They are counted from the artefacts on every run, spliced into
// marked regions, and `check-native-guide.mjs` fails when the committed regions do not match a fresh
// count. Prose stays hand-written, because prose is judgement; numbers and file inventories are facts
// and facts get generated.
//
// The second generated region is the corpus module list inside the XCTest and JUnit templates. Those
// have to enumerate the corpora by name — a Swift test bundle cannot portably glob its resources, and
// a JVM cannot list a directory inside a jar — so the one thing a template *must* hard-code is also
// the one thing that goes stale when a corpus is added. Generating it is what stops a new corpus from
// being invisible to both native suites.
//
// Returns `{file, text}[]` rather than writing, so emit and check share one code path (the idiom of
// `scripts/boundaries/generate.mjs`). A checker that recomputed the expected text differently from
// the emitter would be a gate that can disagree with its own generator.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = join(PKG_ROOT, '..', '..')

const README = join(PKG_ROOT, 'README.md')
const SWIFT_TEMPLATE = join(PKG_ROOT, 'native', 'ios', 'CorpusConformanceTests.swift')
const KOTLIN_TEMPLATE = join(PKG_ROOT, 'native', 'android', 'CorpusConformanceTest.kt')

const read = (p) => readFileSync(p, 'utf8')

/** Every figure the guide quotes, counted from the artefact itself rather than remembered. */
export function figures() {
  const doc = JSON.parse(read(join(PKG_ROOT, 'openapi.json')))
  const live = JSON.parse(read(join(PKG_ROOT, 'asyncapi.json')))

  const specDir = join(REPO_ROOT, 'packages', 'core', 'spec')
  const corpora = readdirSync(specDir)
    .filter((f) => f.endsWith('.spec.json'))
    .sort()
    .map((file) => {
      const parsed = JSON.parse(read(join(specDir, file)))
      const groups = Object.values(parsed.groups)
      return {
        file,
        module: parsed.module,
        source: parsed.source,
        groups: groups.length,
        cases: groups.reduce((n, g) => n + g.cases.length, 0),
        knownDefect: groups.reduce((n, g) => n + g.cases.filter((c) => c.knownDefect).length, 0),
      }
    })

  const sum = (key) => corpora.reduce((n, c) => n + c[key], 0)

  // The component specs (WP6-1). Counted the same way the corpora are, so the README's figure goes stale
  // the moment one is added and `check-native-guide.mjs` says so — a native reader is told what to vendor,
  // and a number nobody regenerates is how that instruction rots.
  const uiDir = join(PKG_ROOT, 'ui')
  const uiSpecs = readdirSync(uiDir)
    .filter((f) => f.endsWith('.spec.json'))
    .sort()
    .map((file) => {
      const parsed = JSON.parse(read(join(uiDir, file)))
      const states = Object.values(parsed.states)
      return {
        file,
        component: parsed.component,
        slots: parsed.slots.length,
        interactions: parsed.interactions.length,
        knownDefect: states.filter((s) => 'knownDefect' in s.enforcement).length,
      }
    })

  const tokens = JSON.parse(read(join(REPO_ROOT, 'packages', 'ui', 'generated', 'tokens.json')))
  const i18nRoot = join(REPO_ROOT, 'packages', 'i18n', 'generated')
  const iosStrings = read(join(i18nRoot, 'ios', 'en.lproj', 'Localizable.strings'))
  const iosPlurals = read(join(i18nRoot, 'ios', 'en.lproj', 'Localizable.stringsdict'))

  return {
    paths: Object.keys(doc.paths).length,
    schemas: Object.keys(doc.components.schemas).length,
    contractVersion: doc.info.version,
    // The bullet list of `info.description`, which is canonical for wire conventions. Everything
    // before the first bullet is the document's own title matter and belongs to the document.
    conventions: doc.info.description.slice(doc.info.description.indexOf('\n- ')).trim(),
    asyncApiVersion: live.asyncapi,
    liveMessages: Object.keys(live.components.messages).length,
    liveSchemas: Object.keys(live.components.schemas).length,
    uiSpecs,
    uiSpecFiles: uiSpecs.length,
    uiSpecComponents: uiSpecs.map((s) => s.component).join(', '),
    uiSpecDefects: uiSpecs.reduce((n, s) => n + s.knownDefect, 0),
    corpora,
    corpusFiles: corpora.length,
    corpusGroups: sum('groups'),
    corpusCases: sum('cases'),
    corpusDefects: sum('knownDefect'),
    tokenCount: Object.keys(tokens).filter((k) => !k.startsWith('$')).length,
    iosLocales: readdirSync(join(i18nRoot, 'ios')).filter((d) => d.endsWith('.lproj')).length,
    androidLocales: readdirSync(join(i18nRoot, 'android')).filter((d) => d.startsWith('values'))
      .length,
    stringKeys: (iosStrings.match(/^"/gm) ?? []).length,
    pluralKeys: (iosPlurals.match(/NSStringLocalizedFormatKey/g) ?? []).length,
  }
}

/** `| a | b |` with the pipes a table needs and no alignment padding Biome would reflow. */
const row = (cells) => `| ${cells.join(' | ')} |`

function artefactsBlock(f) {
  const rows = [
    row(['Artefact', 'What it is today', 'What you do with it']),
    row(['---', '---', '---']),
    row([
      '`packages/contract/openapi.json`',
      `OpenAPI 3.1, v${f.contractVersion} — **${f.paths} paths, ${f.schemas} component schemas**`,
      'Generate your models. This is the only artefact you *must* consume.',
    ]),
    row([
      '`packages/contract/asyncapi.json`',
      `AsyncAPI ${f.asyncApiVersion} for the \`/v1/live\` socket — **${f.liveMessages} frames, ${f.liveSchemas} component schemas**`,
      'Read it. **Do not plan to generate from it** — there is no AsyncAPI→Swift generator at all, and the Kotlin one cannot serialise. See §7.',
    ]),
    row([
      '`packages/contract/src/ids/id-grammar.abnf`',
      'ABNF (RFC 5234) for every id that crosses the wire',
      'Hand-write a parser against it. The `ids` corpus below is what proves your parser agrees with ours.',
    ]),
    row([
      '`packages/core/spec/`',
      `**${f.corpusFiles} corpora, ${f.corpusGroups} groups, ${f.corpusCases} cases, ${f.corpusDefects} \`knownDefect\` rows**`,
      'Drive your XCTest/JUnit suite from these bytes. This is the domain-rule half of the port.',
    ]),
    row([
      '`packages/contract/ui/`',
      `**${f.uiSpecFiles} component spec(s)** — ${f.uiSpecComponents}; each declares its slots and their order, all five states with what each must *not* look like, its interaction targets and its a11y role (${f.uiSpecDefects} state(s) marked \`knownDefect\`)`,
      'The **view** half of the port, and the newest thing here — read §7 before you rely on it. Two renderers drive these today; yours would be the third and the first independent one.',
    ]),
    row([
      '`packages/contract/native/ios/CorpusConformanceTests.swift`',
      '**Template — never compiled, never run**',
      'Copy into your test target on day one and make it build. See §6.',
    ]),
    row([
      '`packages/contract/native/android/CorpusConformanceTest.kt`',
      '**Template — never compiled, never run**',
      'Ditto, for `src/test/kotlin`.',
    ]),
    row([
      '`packages/ui/generated/NextBusTokens.swift`',
      `${f.tokenCount} design tokens — **never compiled**`,
      'Compile it. A compile error here is a bug in the emitter, not something to patch in place.',
    ]),
    row([
      '`packages/ui/generated/NextBusTokens.kt`',
      `${f.tokenCount} design tokens — **never compiled**`,
      'Ditto.',
    ]),
    row([
      '`packages/i18n/generated/ios/`',
      `${f.iosLocales} locales × ${f.stringKeys} strings + ${f.pluralKeys} plural messages`,
      '`.lproj` bundles — drop in as-is; do not retype a string.',
    ]),
    row([
      '`packages/i18n/generated/android/`',
      `${f.androidLocales} resource folders`,
      '`values*/strings.xml` — drop in as-is.',
    ]),
  ]
  return rows.join('\n')
}

function corpusBlock(f) {
  const rows = [
    row(['Corpus', 'Reference implementation', 'Groups', 'Cases', '`knownDefect`']),
    row(['---', '---', '--:', '--:', '--:']),
    ...f.corpora.map((c) =>
      row([
        `\`${c.file}\``,
        `\`packages/core/${c.source}\``,
        String(c.groups),
        String(c.cases),
        c.knownDefect === 0 ? '—' : String(c.knownDefect),
      ]),
    ),
    row([
      '**total**',
      '',
      `**${f.corpusGroups}**`,
      `**${f.corpusCases}**`,
      `**${f.corpusDefects}**`,
    ]),
  ]
  return rows.join('\n')
}

function conventionsBlock(f) {
  return [
    '*Transcluded verbatim from `openapi.json` → `info.description`, which is **canonical** for wire',
    'conventions. A native repo may only ever receive the OpenAPI document — through a generator',
    'pipeline, a vendored copy, an artefact store — and must still be told these rules, so they live in',
    'the document and are copied here rather than the other way round. Editing the list below is a red',
    'build; edit `packages/contract/src/openapi.ts` and re-emit.*',
    '',
    f.conventions,
  ].join('\n')
}

function swiftModulesBlock(f) {
  const list = f.corpora.map((c) => `        "${c.module}",`).join('\n')
  return [
    '    /// Every corpus in `packages/core/spec/`. Enumerated rather than discovered because a test',
    '    /// bundle cannot portably glob its resources — and because a hard-coded list is the one part',
    '    /// of this file that goes stale when a corpus is added, it is generated and gated instead.',
    '    static let modules = [',
    list,
    '    ]',
  ].join('\n')
}

function kotlinModulesBlock(f) {
  const list = f.corpora.map((c) => `        "${c.module}",`).join('\n')
  return [
    '    /** Every corpus in `packages/core/spec/`. Enumerated rather than discovered: a JVM cannot',
    '     *  list a directory inside a jar. Generated and gated, so a new corpus cannot be invisible. */',
    '    val modules = listOf(',
    list,
    '    )',
  ].join('\n')
}

/**
 * Splice one named region in place, keeping its markers.
 *
 * Fails loudly on a missing marker rather than appending: a region that silently stopped being
 * generated is the failure this whole file exists to prevent, and it would look like a passing gate.
 */
function splice(text, name, body, comment) {
  const [open, close] =
    comment === 'html'
      ? [`<!-- BEGIN GENERATED: ${name} -->`, `<!-- END GENERATED: ${name} -->`]
      : [`// BEGIN GENERATED: ${name}`, `// END GENERATED: ${name}`]
  const start = text.indexOf(open)
  const end = text.indexOf(close)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`marker "${name}" is missing or inverted — cannot generate`)
  }
  // Resume from the *start of the closing marker's line*, not from the marker itself, so its own
  // indentation survives. Slicing at `end` would left-align a `// END` that sits inside a Swift
  // `enum` or a Kotlin `object` — valid but visibly wrong, and it would churn on every re-emit.
  const closeLineStart = text.lastIndexOf('\n', end) + 1
  return `${text.slice(0, start + open.length)}\n${body}\n${text.slice(closeLineStart)}`
}

/** The files this generator owns, each with its regions filled from a fresh count. */
export function render() {
  const f = figures()

  let readme = read(README)
  readme = splice(readme, 'artefacts', artefactsBlock(f), 'html')
  readme = splice(readme, 'conventions', conventionsBlock(f), 'html')
  readme = splice(readme, 'corpus', corpusBlock(f), 'html')

  return [
    { file: README, text: readme },
    {
      file: SWIFT_TEMPLATE,
      text: splice(read(SWIFT_TEMPLATE), 'corpus-modules', swiftModulesBlock(f), 'slash'),
    },
    {
      file: KOTLIN_TEMPLATE,
      text: splice(read(KOTLIN_TEMPLATE), 'corpus-modules', kotlinModulesBlock(f), 'slash'),
    },
  ]
}
