import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'

/**
 * **About the data** (WP6-7) — the attribution page, and the one screen in the app whose content is an
 * *obligation* rather than a choice about what a rider would like to see.
 *
 * ## Why a spec for a page of static prose
 *
 * Because three of its six source rows were missing, and each absence closed nothing — it *left open* a
 * decision that had been taken and written down and never actioned:
 *
 *  · **the basemap.** ADR-049 decision 5 ends *"This extends the ADR-038 'About the data' sources list."*
 *    It never did. The binding credit is the one on the map face and that has always shipped; this is the
 *    second half, and the CSDI grant conditions on naming the portal as well as the department.
 *  · **green minibus.** A v1 operator with its own feed, named by `faqCoverageA` — so the app's own answer
 *    about which operators it uses contradicted its own attribution page.
 *  · **the consolidation.** Every route, stop, fare and frequency is normalized from a third party's crawl
 *    rather than fetched from the portal. ADR-021's decision says to attribute it; ADR-038's follow-up
 *    list repeats it.
 *
 * A licence obligation that lives as loose JSX in one renderer is one a second renderer can simply not
 * have, and nothing would fail. That is the whole argument for this file.
 *
 * ## The five canonical states, on a screen that fetches nothing
 *
 * Same inversion as `settings.spec.json`: the **whole screen is `slots`**, so a state declaring
 * `shows: []` is declaring everything, and a blank first frame is a divergence at index 0. What that buys
 * here specifically is that **`loading` is a real, projected state with the full screen in it** — the
 * strongest claim this spec makes. The first frame of this page *is* the finished page, and the way to
 * prove it is to drive the screen with no query client and no `DataSource` in scope at all: if it ever
 * grows a fetch, the driver stops compiling rather than the assertion quietly weakening.
 *
 * ## The version is two nodes and not one string
 *
 * `{label} {value}` reads as one line and is three text nodes, so a spec declaring it as one composed
 * string fails against both renderers while looking correct. ADR-092 found the same thing in Search's
 * journey arrow. The kernel keeps them apart for that reason — and if it should ever be one string, the
 * joining is the kernel's job, not a renderer's.
 */

const SOURCES: SlotNode = {
  name: 'sources',
  each: 'sources',
  of: [
    { name: 'sourceTitle', text: { field: 'title' } },
    { name: 'sourceBody', text: { field: 'body' } },
  ],
  invariant:
    'One row per source this app actually reads, in the kernel’s order — never a subset, and never reordered by prominence. The set is asserted against the operator list too, so an operator can no longer ship without its credit: that disagreement is exactly what this row found.',
}

const LICENCES: SlotNode = {
  name: 'licences',
  each: 'licences',
  of: [
    { name: 'licenceTitle', text: { field: 'title' } },
    { name: 'licenceBody', text: { field: 'body' } },
  ],
  invariant:
    'One row **per licence actually in force**, and there are two. ADR-038 built this section for exactly one link row; the basemap arrived a wave later under different terms, leaving a single sentence about "the Government’s terms" standing for two different sets of them.',
}

export const ABOUT_DATA_SPEC: ComponentSpec = {
  component: 'AboutData',
  version: 1,
  doc: 'Where every figure in this app comes from, which licences it ships under, and which build a rider is looking at.',
  viewModel: {
    module: 'settings',
    type: 'AboutView',
    corpus: 'settings.spec.json',
    group: 'aboutView',
  },

  slots: [
    { name: 'title', text: { message: 'aboutData' } },
    {
      name: 'intro',
      text: { field: 'intro' },
      invariant:
        'A field rather than a message, because it is the kernel that decides this page opens with a claim about its sources at all. The claim itself was narrowed by this row: "no scraping, no private feeds" was true of us and glossed that the static tier arrives through someone else’s crawl, which is now a credited row below.',
    },
    { name: 'sourcesHeading', text: { message: 'aboutSourcesTitle' } },
    SOURCES,
    { name: 'licenceHeading', text: { message: 'aboutLicenceTitle' } },
    LICENCES,
    {
      name: 'versionLabel',
      text: { field: 'version.label' },
      invariant:
        'Its own node. See the note at the top: a renderer composing `"Version 1.4.0"` as one string would diverge from one that does not, and both are plausible.',
    },
    { name: 'versionValue', text: { field: 'version.value' } },
  ],

  states: {
    content: {
      must: 'Every source, every licence, and the build.',
      mustNot:
        'A source the app reads and does not name, or a licence it ships under and does not name. Both were true before this row.',
      enforcement: { shows: [] },
    },

    /**
     * The strongest claim in this spec, and the reason it is a *projected* state rather than an
     * `unenforced` one.
     */
    loading: {
      must: 'The finished screen, on the first frame.',
      mustNot:
        'A skeleton, a spinner, or a section that fills in afterwards — there is nothing to wait for.',
      why: 'A state that would be vacuous if the projection were empty and is the opposite because the whole screen is in `slots`: entering `loading` here asserts that every row is already there. The driver renders with no query client and no `DataSource` in scope, so a future fetch on this screen breaks the harness rather than quietly weakening it.',
      enforcement: { shows: [] },
    },

    empty: {
      must: 'Unreachable: the source and licence lists are constants and neither can be filtered.',
      mustNot:
        'A "Sources" heading with nothing under it, which is what a renderer that built this list from whichever operators had data today would produce on a bad morning.',
      why: 'Worth declaring precisely because the obvious "improvement" — showing only the sources currently in use — would break a licence condition rather than a layout.',
      enforcement: { by: 'sources' },
    },

    failed: {
      must: 'Nothing this screen can promise: the hand-off to an external page is one-way.',
      mustNot: 'A claim that the page opened.',
      why: '`packages/ports`’ `LinkOpener` is `void` on both members and argues the case at length: once the OS or the browser has the URL we have lost control, so a promise would resolve on "handed over" rather than on "the rider saw the page" — precision we do not have, which is ADR-008’s rule applied to a side effect. A blocked pop-up therefore fails silently.',
      enforcement: {
        unenforced:
          'Deliberately unobservable at this layer, by the port’s own decision rather than by omission. The web renderer narrows it anyway by using a real anchor, where a blocked pop-up is not a failure mode at all.',
      },
    },

    stale: {
      must: 'Prose that is true of the app as it is now.',
      mustNot:
        'A credit for a source that has been replaced, or a licence that no longer applies — a wrong attribution is worse than a missing one, because it looks discharged.',
      why: 'The only decay this screen has, and it is measured in ADRs rather than in seconds. It is not hypothetical: three sources were missing for between one and three waves, and the words were audited only when this row forced someone to read them against the code.',
      enforcement: {
        unenforced:
          'Nothing mechanical can know that a sentence has stopped being true. What *is* mechanical is the corpus row asserting that every shipped operator has a credit — which would have caught the GMB omission on the day it shipped — and that is the honest half.',
      },
    },

    offline: {
      must: 'Every row, drawn, with its link.',
      mustNot:
        'A hidden or disabled link. The rider is offline; the credit is still owed, and the URL is still the answer to "where did this come from".',
      why: 'The page is part of the precached shell (ADR-058/082), so it opens with no network like any other. What a link *does* offline is the browser’s business and not this screen’s — which is the same division the walker’s `content-not-affordance` rule makes: the text is a function of the model, never of whether the affordance can be honoured.',
      enforcement: { shows: [] },
    },
  },

  interactions: [
    {
      target: 'sources',
      goes: 'that source’s own site, externally — away from the app, in a new tab or the OS browser',
      note: 'The one screen in the app whose targets are all off-site. The role is `link` on both renderers, which is why the web one uses a real anchor rather than the `LinkOpener` port a button would need.',
    },
    { target: 'licences', goes: 'the terms, in the reader’s own language' },
  ],

  a11y: {
    role: 'article: an intro, two labelled lists of external links, and a build identifier',
    name: { fromSlot: 'title' },
    reducedMotion: 'No motion on this screen on either renderer.',
  },

  idiom: [
    '**how an external URL is opened** — a real `<a href target="_blank" rel="noopener noreferrer">` on the web, a `Pressable` with `accessibilityRole="link"` handing off through `openExternal` on native. The anchor is the DOM-idiomatic answer and buys middle-click, copy-link-address and a visible target; what is identity is that the row *is* a link and that it leaves the app',
    'whether rows sit in cards with dividers or in whitespace-separated runs',
    'the trailing external-link glyph, and whether it is drawn at all',
    'where the build identifier sits — the foot of the page on both, but a rider-facing "about" sheet elsewhere',
  ],
}
