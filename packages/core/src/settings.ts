// The Settings section's rules: the preference screen, and the two pages it pushes to (WP6-7).
//
// `proposals/04` files this row as *"mostly chrome and prose"* and it is the only screen group in the app
// with no `DataSource` call anywhere in it. That made the hoist look unnecessary and it is not, for a
// reason worth stating before the code: **a preference screen's content is a choice, and a choice is a
// decision like any other.** Which languages are offered, in what order, which one is lit, which sources
// this app is obliged to credit and where each link goes, which questions it answers and in what order —
// every one of those was a private `const` inside one renderer, and the second renderer's copy of two of
// them was already sitting three files away in `apps/web/src/shell/ShellPreferences.tsx`, waiting to
// disagree.
//
// TWO OF THESE RULES ARE TRAPS RATHER THAN TABLES, and they are why this file exists at all:
//
//  · **A language is selected by the OVERRIDE, never by the resolved locale.** `useLocale()` returns
//    `override ?? device`; `useLocaleOverride()` returns the override, where `null` means *follow the
//    device*. Both are in scope in the RN screen four lines apart and either type-checks in the
//    comparison — and reading the wrong one lights **two** rows at once for the commonest rider there is,
//    the one on an English device who has never touched the picker.
//  · **An appearance is selected by the raw preference, never by the mode it resolves to.**
//    `resolveMode('auto', systemIsDark)` is `'dark'`, so a renderer marking the resolved value shows
//    *Dark* as chosen to a rider who chose *Auto* — and it looks right on every machine whose system
//    theme happens to be light.
//
// Neither is expressible as a type, both are one `===` away, and both are now a corpus row.
//
// WHAT IS INJECTED, AND WHAT IS NOT. Words are injected, never imported (ADR-054: core owns the rule, the
// catalogue owns the word) — the same shape `placeDetailView` uses, and the corpus drives it with fixture
// labels because the corpus is language-neutral data a Swift suite will read. What is **not** injected is
// the ordered list of catalogue *keys* the FAQ and the About page are built from: a key is an opaque
// string here, and *which questions this app answers, in what order, paired with which answers* is a
// product decision of exactly the same class as *which sources it credits*. Putting it in the caller is
// what left it as a literal in one screen that a second renderer would have copied.
//
// WHAT IS NOT HERE, DELIBERATELY. The membership of the two option lists comes from the package that owns
// each type — `SUPPORTED_LOCALES` from `@nextbus/i18n`, the appearance list from `@nextbus/ui` beside
// `resolveMode` — and arrives as an argument. A fourth literal spelling of `['en','zh-Hant','zh-Hans']`
// here would have *added* a declaration to remove two, which is the opposite of the point.

import type { Locale } from './types'

// ── Choices ────────────────────────────────────────────────────────────────────────────────────

/**
 * One option in a group where exactly one is the rider's current choice.
 *
 * `selected` is a field of the model rather than a colour, and that is load-bearing twice over. A
 * conformance projection reads **text** (ADR-083), so a control that says "chosen" only by filling a pill
 * or drawing a dot says it to nothing a spec can check — the same edge ADR-093 found from the other side
 * when the walker could not see a bus token at all. And the two suites assert this flag directly, the way
 * `search.spec.json` says they must for a keypad key's `enabled`.
 */
export interface ChoiceOption<V> {
  /** What the renderer hands back when this option is chosen. */
  value: V
  /** The word a rider reads, from the caller's catalogue. */
  label: string
  /** The rider's current choice. Exactly one option per group carries it — asserted as a property. */
  selected: boolean
}

/** The rows the Settings screen pushes to. Their order is the order they are drawn in. */
export type SettingsAboutRowId = 'about-data' | 'faq'

/**
 * The About-section rows, in order.
 *
 * Data rather than a literal in a screen for the same reason the destination set is data (ADR-082): what
 * a rider can reach from here is navigation, and navigation is identity.
 */
export const SETTINGS_ABOUT_ROWS: readonly SettingsAboutRowId[] = ['about-data', 'faq']

/** The words the Settings screen composes with, supplied by the caller's catalogue. */
export interface SettingsLabels {
  /** "Automatic" — the follow-the-device option, and the only language row that *is* translated. */
  languageAuto: string
  /**
   * A language's name **in that language**.
   *
   * The one label here that must not follow the active locale: a reader whose UI is Chinese and who wants
   * English has to be able to find the word "English". `@nextbus/i18n` carries it as `endonym()`, a named
   * exception with its own paragraph; this takes it as a function so the kernel never learns why.
   */
  endonym: (locale: Locale) => string
  /** An appearance option's word, by its value. */
  appearance: (value: string) => string
  /** An About row's word, by its id. */
  aboutRow: (id: SettingsAboutRowId) => string
}

/** What the Settings screen is built from: two persisted preferences, and what this build ships. */
export interface SettingsInput<A extends string> {
  /** Every UI language this build ships, in the order they are offered. */
  locales: readonly Locale[]
  /** The persisted override. `null` = follow the device, which is an option rather than an absence. */
  localeOverride: Locale | null
  /** Every appearance this build ships, in the order they are offered. */
  appearances: readonly A[]
  /** The persisted preference — **never** the mode it resolves to. See the trap at the top of this file. */
  appearance: A
}

/** What a renderer needs to draw the Settings screen, with nothing left to decide. */
export interface SettingsView<A extends string> {
  /** Follow-the-device first, then one per shipped language, each in its own script. */
  languages: ChoiceOption<Locale | null>[]
  /** One per shipped appearance, in the order this build offers them. */
  appearances: ChoiceOption<A>[]
  /** Where this screen can go next. */
  about: { id: SettingsAboutRowId; label: string }[]
}

/**
 * The Settings screen: three groups, in order, with exactly one option lit in each of the first two.
 *
 * **"Automatic" is an option, not the absence of one, and it is first.** A rider who has never touched
 * the picker is *following their device*, which is a state worth naming and worth showing as chosen — and
 * putting it last would make the list read as three languages with a fallback under them rather than four
 * things one of which is true.
 *
 * @spec settings#settingsView
 */
export function settingsView<A extends string>(
  input: SettingsInput<A>,
  labels: SettingsLabels,
): SettingsView<A> {
  return {
    languages: [
      { value: null, label: labels.languageAuto, selected: input.localeOverride === null },
      ...input.locales.map((locale) => ({
        value: locale,
        label: labels.endonym(locale),
        selected: input.localeOverride === locale,
      })),
    ],
    appearances: input.appearances.map((value) => ({
      value,
      label: labels.appearance(value),
      selected: input.appearance === value,
    })),
    about: SETTINGS_ABOUT_ROWS.map((id) => ({ id, label: labels.aboutRow(id) })),
  }
}

// ── About the data ─────────────────────────────────────────────────────────────────────────────

/**
 * One credited source: what it is called, what we take from it, and where a rider can go and check.
 *
 * A row rather than a sentence because attribution is an **obligation** rather than content — three of
 * the five below are conditions of the licences this app ships under — and an obligation that lives as
 * loose JSX in one renderer is one a second renderer can simply not have.
 */
export interface AboutSource {
  /** Stable id, so a suite can name a row without quoting its words. */
  id: string
  /** The catalogue key for its name. */
  titleKey: string
  /** The catalogue key for the one line saying what we take from it. */
  bodyKey: string
  /** Where the row goes. An absolute URL, always external, always opened away from the app. */
  url: string
}

/**
 * The sources this app credits, in the order they are shown.
 *
 * **Three of these five were missing until WP6-7 and each closes a decision that had been taken and never
 * actioned**, which is what a licence obligation living in a screen file costs:
 *
 *  · `landsd` — ADR-049 decision 5 ends *"This extends the ADR-038 'About the data' sources list."* It
 *    never did. The binding credit is the one on the map face and that has always shipped; this is the
 *    second half, and the CSDI grant conditions on naming the portal as well as the department.
 *  · `gmb` — green minibus shipped as a v1 operator with its own feed, and `faqCoverageA` names it, so the
 *    app's own coverage answer and its own attribution page disagreed about which operators it uses.
 *  · `hkbus` — every route, stop, fare and frequency in the app is normalized from the consolidated crawl,
 *    not fetched from the portal. ADR-021's decision says to attribute it and ADR-038's follow-up list
 *    repeats it.
 *
 * Order is deliberate: the portal that governs the terms, then the three feeds in the order their
 * operators reached the app, then the basemap, then the consolidation. It is the order a reader checking
 * a claim would want, rather than the order they were written.
 */
export const ABOUT_SOURCES: readonly AboutSource[] = [
  {
    id: 'govhk',
    titleKey: 'aboutGovHk',
    bodyKey: 'aboutGovHkBody',
    url: 'https://data.gov.hk',
  },
  {
    id: 'kmb',
    titleKey: 'aboutKmb',
    bodyKey: 'aboutKmbBody',
    url: 'https://data.etabus.gov.hk',
  },
  {
    id: 'ctb',
    titleKey: 'aboutCtb',
    bodyKey: 'aboutCtbBody',
    url: 'https://rt.data.gov.hk/v2/transport/citybus',
  },
  {
    id: 'gmb',
    titleKey: 'aboutGmb',
    bodyKey: 'aboutGmbBody',
    url: 'https://data.etagmb.gov.hk',
  },
  {
    id: 'landsd',
    titleKey: 'aboutLandsd',
    bodyKey: 'aboutLandsdBody',
    url: 'https://portal.csdi.gov.hk',
  },
  {
    id: 'hkbus',
    titleKey: 'aboutHkbus',
    bodyKey: 'aboutHkbusBody',
    url: 'https://data.hkbus.app',
  },
]

/**
 * The licence rows, in order — one per licence this app actually ships under.
 *
 * Two, not one. ADR-038 built the section for exactly one link row and the basemap arrived a wave later
 * under a **different** licence (the CSDI terms), leaving `aboutTermsBody` — *"Open data from DATA.GOV.HK
 * is used under the Government's terms"* — as the app's only licence statement while a second one was
 * silently in force on every map. Saying "the Government's terms" once, for two different sets of terms,
 * is the kind of near-truth this section exists to avoid.
 */
export const ABOUT_LICENCES: readonly AboutLicence[] = [
  {
    id: 'govhk-terms',
    titleKey: 'aboutTerms',
    bodyKey: 'aboutTermsBody',
    href: (locale) => `https://data.gov.hk/${GOVHK_SLUG[locale]}/terms-and-conditions`,
  },
  {
    id: 'csdi-terms',
    titleKey: 'aboutCsdiTerms',
    bodyKey: 'aboutCsdiTermsBody',
    href: (locale) => `https://portal.csdi.gov.hk/csdi-webpage/${CSDI_SLUG[locale]}/terms`,
  },
]

/** A licence row: like a source, but its URL depends on the reader's language. */
export interface AboutLicence {
  id: string
  titleKey: string
  bodyKey: string
  /** Where a reader in this locale goes to read the terms. */
  href: (locale: Locale) => string
}

/**
 * The path segment each portal uses for each of our locales.
 *
 * **A real mapping rule and the strongest kernel candidate on these screens**, because the portals' slugs
 * are `en` / `tc` / `sc` and ours are `en` / `zh-Hant` / `zh-Hans` — so it is neither the identity nor a
 * `toLowerCase()`, and a renderer inventing `zh-hant` lands a rider on a 404 in the one place the app
 * sends them to read a licence. Its twin, the basemap's `LABEL_LANG`, is already duplicated
 * byte-identically in both renderers' `tileSource` adapters, which is the same rule waiting to diverge.
 *
 * Two tables that happen to hold the same three values, rather than one shared table, and the duplication
 * is the honest shape: these are two organisations' independent URL schemes, and the day CSDI renames
 * `tc` to `zh-hk` a shared constant would silently break data.gov.hk's links too.
 */
const GOVHK_SLUG: Record<Locale, string> = { en: 'en', 'zh-Hant': 'tc', 'zh-Hans': 'sc' }
const CSDI_SLUG: Record<Locale, string> = { en: 'en', 'zh-Hant': 'tc', 'zh-Hans': 'sc' }

/** The words and figures the About screen composes with. */
export interface AboutLabels {
  /** Resolve a catalogue key. The same injected shape the conformance walker uses (ADR-083). */
  text: (key: string) => string
  /** This build's version, from whatever the renderer's build system calls it. */
  version: string
}

/** One row of the About screen, already resolved into the words a rider reads. */
export interface AboutRow {
  id: string
  title: string
  body: string
  url: string
}

/** What a renderer needs to draw "About the data", with nothing left to decide. */
export interface AboutView {
  /** The lead paragraph. */
  intro: string
  sources: AboutRow[]
  licences: AboutRow[]
  /** The label, and the number, as **two** values — see below. */
  version: { label: string; value: string }
}

/**
 * "About the data": the credits, the licences, and the build a rider can quote.
 *
 * **The version is two values and not one composed string, and that is the rule rather than a detail.**
 * `{t('aboutVersion')} {version}` reads as one line and is three text nodes, so a projection that
 * declared it as one string would fail against both renderers while looking correct — ADR-092 found the
 * same thing in Search's journey arrow. If it ever *should* be one string, the joining is this function's
 * job and not a renderer's, which is exactly ADR-085's line.
 *
 * @spec settings#aboutView
 */
export function aboutView(locale: Locale, labels: AboutLabels): AboutView {
  return {
    intro: labels.text('aboutIntro'),
    sources: ABOUT_SOURCES.map((source) => ({
      id: source.id,
      title: labels.text(source.titleKey),
      body: labels.text(source.bodyKey),
      url: source.url,
    })),
    licences: ABOUT_LICENCES.map((licence) => ({
      id: licence.id,
      title: labels.text(licence.titleKey),
      body: labels.text(licence.bodyKey),
      url: licence.href(locale),
    })),
    version: { label: labels.text('aboutVersion'), value: labels.version },
  }
}

// ── FAQ ────────────────────────────────────────────────────────────────────────────────────────

/** A question and the answer paired with it — as catalogue keys, so this file holds no prose. */
export interface FaqEntry {
  id: string
  questionKey: string
  answerKey: string
}

/**
 * The questions this app answers, in the order it answers them.
 *
 * The pairing is the part nothing could get wrong *loudly*: a mis-paired question and answer type-checks,
 * renders, and reads as a strange but plausible FAQ. It is data here so that a corpus row pins it.
 *
 * The order is a product decision — freshness first, because *"how old is this number"* is the question
 * ADR-008 exists to answer and the one a rider arrives with.
 */
export const FAQ_ENTRIES: readonly FaqEntry[] = [
  { id: 'freshness', questionKey: 'faqFreshnessQ', answerKey: 'faqFreshnessA' },
  { id: 'timings', questionKey: 'faqTimingsQ', answerKey: 'faqTimingsA' },
  { id: 'coverage', questionKey: 'faqCoverageQ', answerKey: 'faqCoverageA' },
  { id: 'merge', questionKey: 'faqMergeQ', answerKey: 'faqMergeA' },
  { id: 'offline', questionKey: 'faqOfflineQ', answerKey: 'faqOfflineA' },
  { id: 'map', questionKey: 'faqMapQ', answerKey: 'faqMapA' },
  { id: 'remarks', questionKey: 'faqRemarksQ', answerKey: 'faqRemarksA' },
]

/** One FAQ row: always its question, and its answer only when the rider has opened it. */
export interface FaqItem {
  id: string
  question: string
  /** Present only when `expanded`. Absent — not empty — when collapsed, because it is not on screen. */
  answer?: string
  expanded: boolean
}

export interface FaqView {
  items: FaqItem[]
}

/**
 * The FAQ, with whichever answers the rider has opened.
 *
 * **A collapsed answer is absent from the model rather than present and hidden**, and that is the whole
 * reason this function is worth having. A conformance projection reads text by presence, not by
 * visibility — a `<details>` a rider has not opened still hands its answer to the walker, and so does
 * anything behind `display: none` — so a renderer that keeps every answer mounted and merely hides it is
 * *indistinguishable from one that shows them all*. Modelling the answer as absent makes the collapsed
 * state projectable, and it makes the two renderers agree about what a screen reader is offered.
 *
 * **Several may be open at once**, which is a decision and not an accident: these are seven independent
 * questions rather than a wizard, and an accordion that closed the previous answer would make comparing
 * two of them impossible. `expanded` is a set the caller owns; this function only reads it.
 *
 * @spec settings#faqView
 */
export function faqView(expanded: readonly string[], text: (key: string) => string): FaqView {
  const open = new Set(expanded)
  return {
    items: FAQ_ENTRIES.map((entry) => {
      const isOpen = open.has(entry.id)
      return {
        id: entry.id,
        question: text(entry.questionKey),
        ...(isOpen ? { answer: text(entry.answerKey) } : {}),
        expanded: isOpen,
      }
    }),
  }
}
