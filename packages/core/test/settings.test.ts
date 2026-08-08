import { describe, expect, it } from 'vitest'
import corpus from '../spec/settings.spec.json'
import {
  ABOUT_LICENCES,
  ABOUT_SOURCES,
  type AboutView,
  aboutView,
  FAQ_ENTRIES,
  type FaqView,
  faqView,
  SETTINGS_ABOUT_ROWS,
  type SettingsView,
  settingsView,
} from '../src/settings'
import type { Locale } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/settings.spec.json.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/**
 * The label fixtures, and they are fixtures rather than the app's catalogue on purpose.
 *
 * The corpus is language-neutral data a Swift suite will read, so what it may pin is the **composition** —
 * which key is paired with which, in what order, and which URL a locale lands on. `text` is therefore the
 * identity, which has a payoff beyond neutrality: every `title`/`body`/`question`/`answer` in the corpus
 * *is* its catalogue key, so a mis-paired question and answer is a byte diff rather than a screen a reader
 * has to notice is strange.
 *
 * The endonyms are the exception and are the real ones, because they are language-neutral by definition —
 * that is the entire reason `endonym()` exists as a named exception in `@nextbus/i18n` rather than as three
 * catalogue keys.
 */
const ENDONYMS: Record<Locale, string> = {
  en: 'English',
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
}

const LABELS = {
  languageAuto: 'Automatic',
  endonym: (locale: Locale) => ENDONYMS[locale],
  appearance: (value: string) => value,
  aboutRow: (id: string) => id,
}

const identity = (key: string) => key

describe('settings#settingsView', () => {
  interface Args {
    locales: Locale[]
    localeOverride: Locale | null
    appearances: string[]
    appearance: string
  }

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, SettingsView<string>>('settingsView')
    // The anti-vacuous control. A group that resolved to nothing would make the loop assert nothing —
    // the shape four of this repo's gates have shipped in.
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const c of rows) {
      expect(settingsView(c.args, LABELS), c.name).toEqual(c.expect)
    }
  })

  it('lights exactly one option in each group, in every case', () => {
    // **The property that makes this screen honest**, and it is the one a reader would assume rather than
    // check: a picker showing two selected rows is not a worse picker, it is a picker that has stopped
    // meaning anything. Both directions matter — zero selected is a rider who cannot tell what they chose,
    // and two is a rider who is being told something false.
    for (const c of cases<Args, SettingsView<string>>('settingsView')) {
      const view = settingsView(c.args, LABELS)
      expect(
        view.languages.filter((o) => o.selected),
        `${c.name}: languages`,
      ).toHaveLength(1)
      expect(
        view.appearances.filter((o) => o.selected),
        `${c.name}: appearances`,
      ).toHaveLength(1)
    }
  })

  it('distinguishes following the device from choosing that same language', () => {
    // The trap, asserted as a *difference* rather than as two values. Both calls below produce a screen
    // whose seven labels are identical; the only thing that differs is which row is lit, and a renderer
    // reading `useLocale()` instead of `useLocaleOverride()` collapses them into one. Written as an
    // inequality so that a future change making them agree cannot be absorbed by updating a golden.
    const base = {
      locales: ['en', 'zh-Hant', 'zh-Hans'] as Locale[],
      appearances: ['auto'],
      appearance: 'auto',
    }
    const following = settingsView({ ...base, localeOverride: null }, LABELS)
    const chosen = settingsView({ ...base, localeOverride: 'en' }, LABELS)
    expect(following.languages.map((o) => o.label)).toEqual(chosen.languages.map((o) => o.label))
    expect(following.languages.map((o) => o.selected)).not.toEqual(
      chosen.languages.map((o) => o.selected),
    )
  })

  it('offers following the device even where a build ships one language', () => {
    // `Automatic` does not come from the locale list, so it survives a list of one. A rule that mapped
    // over `locales` and prepended nothing would be right in every corpus case but this one.
    const view = settingsView(
      { locales: ['en'], localeOverride: null, appearances: ['auto'], appearance: 'auto' },
      LABELS,
    )
    expect(view.languages[0]?.value).toBeNull()
    expect(view.languages).toHaveLength(2)
  })

  it('offers exactly the About rows the constant declares, in order', () => {
    // The rows are navigation, and navigation is identity (ADR-082). Asserted against the constant rather
    // than against a literal so that adding a row is one edit and a corpus diff, not two edits and a
    // silently unchanged test.
    const view = settingsView(
      { locales: ['en'], localeOverride: null, appearances: ['auto'], appearance: 'auto' },
      LABELS,
    )
    expect(view.about.map((row) => row.id)).toEqual([...SETTINGS_ABOUT_ROWS])
  })
})

describe('settings#aboutView', () => {
  interface Args {
    locale: Locale
    version: string
  }

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, AboutView>('aboutView')
    expect(rows.length).toBeGreaterThanOrEqual(3)
    for (const c of rows) {
      const got = aboutView(c.args.locale, { text: identity, version: c.args.version })
      expect(got, c.name).toEqual(c.expect)
    }
  })

  it('covers every locale, so no slug is pinned by the one that happens to be the identity', () => {
    // **The coverage control WP6-3b's lesson demands**: fixtures have to be audited against branches, not
    // merely written. `en` maps to `en` in both slug tables, so a case list that covered only English
    // would exercise the mapping and prove nothing about it.
    const covered = new Set(cases<Args, AboutView>('aboutView').map((c) => c.args.locale))
    expect([...covered].sort()).toEqual(['en', 'zh-Hans', 'zh-Hant'])
  })

  it('gives every source and every licence an absolute external URL', () => {
    // Attribution is an obligation rather than content, and a row whose link does not leave the app is a
    // credit a reader cannot check. Both lists, because the licence URLs are built per locale and the
    // source URLs are constants — two different ways to get it wrong.
    for (const locale of ['en', 'zh-Hant', 'zh-Hans'] as const) {
      const view = aboutView(locale, { text: identity, version: '0.0.0' })
      for (const row of [...view.sources, ...view.licences]) {
        expect(row.url, `${locale}/${row.id}`).toMatch(/^https:\/\/[^\s]+$/)
      }
    }
  })

  it('credits every operator the app ships, so coverage and attribution cannot disagree', () => {
    // The bug WP6-7 found: `faqCoverageA` named green minibus and the Sources list did not, so the app's
    // own answer about which operators it uses contradicted its own attribution page. Asserted against the
    // ids rather than the words, so it survives a rewording and fails on a deletion.
    const ids = ABOUT_SOURCES.map((source) => source.id)
    for (const operator of ['kmb', 'ctb', 'gmb']) expect(ids).toContain(operator)
    // And the two non-operator sources whose absence was a broken promise in an ADR rather than an
    // oversight: the basemap (ADR-049 decision 5) and the consolidation the static tier comes from
    // (ADR-021's decision, ADR-038's follow-up list).
    expect(ids).toContain('landsd')
    expect(ids).toContain('hkbus')
  })

  it('names one licence row per licence actually in force', () => {
    // ADR-038 built this section for exactly one link row and the basemap arrived a wave later under
    // different terms, leaving one sentence covering two licences. Two rows, and the count is asserted so
    // that a third licence cannot be folded into an existing body.
    expect(ABOUT_LICENCES).toHaveLength(2)
    const view = aboutView('en', { text: identity, version: '0.0.0' })
    expect(view.licences.map((row) => row.id)).toEqual(ABOUT_LICENCES.map((row) => row.id))
  })

  it('keeps the version label and the version number apart', () => {
    // ADR-092's finding, applied before it can bite: `{label} {value}` reads as one line and is three text
    // nodes, so a projection declaring it as one composed string fails against both renderers while
    // looking correct. If it should ever be one string, the joining is this function's job.
    const view = aboutView('en', { text: identity, version: '1.2.3' })
    expect(view.version).toEqual({ label: 'aboutVersion', value: '1.2.3' })
  })
})

describe('settings#faqView', () => {
  interface Args {
    expanded: string[]
  }

  it('matches the corpus, case for case', () => {
    const rows = cases<Args, FaqView>('faqView')
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const c of rows) {
      expect(faqViewOf(c.args.expanded), c.name).toEqual(c.expect)
    }
  })

  it('omits a collapsed answer rather than emptying it', () => {
    // **The load-bearing property, and the reason this function exists at all.** A conformance projection
    // reads text by *presence*, never by visibility — a `<details>` a rider has not opened still hands its
    // answer to the walker, and so does anything behind `display: none`. So an answer that is present but
    // empty, or present and hidden, makes the collapsed state unprojectable and lets a renderer that shows
    // everything pass as one that shows nothing. `toHaveProperty` rather than a falsiness check, because
    // `answer: ''` would satisfy the latter and is exactly the shape being ruled out.
    for (const item of faqViewOf([]).items) {
      expect(item, item.id).not.toHaveProperty('answer')
    }
  })

  it('opens several at once, and closes none of them', () => {
    // Seven independent questions rather than a wizard: a rider comparing "how fresh are the times" with
    // "does it work offline" needs both open. The single-open accordion is what a second renderer reaches
    // for by default, and it would pass every other assertion here.
    const view = faqViewOf(['freshness', 'offline', 'map'])
    expect(view.items.filter((item) => item.expanded).map((item) => item.id)).toEqual([
      'freshness',
      'offline',
      'map',
    ])
  })

  it('pairs every question with its own answer', () => {
    // The pairing, as a rule rather than as four recorded rows: opening item *i* must produce item *i*'s
    // answer key and no other. A mis-paired FAQ type-checks and renders, so this is the only thing between
    // it and a reader noticing.
    for (const entry of FAQ_ENTRIES) {
      const opened = faqViewOf([entry.id]).items.find((item) => item.id === entry.id)
      expect(opened?.question, entry.id).toBe(entry.questionKey)
      expect(opened?.answer, entry.id).toBe(entry.answerKey)
    }
  })

  it('never lets what is open change what exists', () => {
    // The list is this rule's and the open set is the caller's, so the second must not widen the first.
    // The obvious alternative implementation — mapping over the expanded set — produces a row with no
    // question in it for an id that has outlived its question.
    const ids = faqViewOf([]).items.map((item) => item.id)
    expect(faqViewOf(['there-is-no-such-question']).items.map((item) => item.id)).toEqual(ids)
    expect(faqViewOf(FAQ_ENTRIES.map((entry) => entry.id)).items.map((item) => item.id)).toEqual(
      ids,
    )
  })

  it('answers every question it asks, with no key used twice', () => {
    // A cheap structural control over the table itself: seven distinct ids, seven distinct question keys,
    // seven distinct answer keys. A duplicated id would make the open set ambiguous and a duplicated key
    // is the copy-paste this table is most exposed to.
    expect(new Set(FAQ_ENTRIES.map((e) => e.id)).size).toBe(FAQ_ENTRIES.length)
    expect(new Set(FAQ_ENTRIES.map((e) => e.questionKey)).size).toBe(FAQ_ENTRIES.length)
    expect(new Set(FAQ_ENTRIES.map((e) => e.answerKey)).size).toBe(FAQ_ENTRIES.length)
  })
})

/** The corpus's `text` fixture, applied — the identity, so a rendered value IS its catalogue key. */
function faqViewOf(expanded: readonly string[]): FaqView {
  return faqView(expanded, identity)
}
