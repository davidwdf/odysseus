import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'

/**
 * **FAQ** (WP6-7) — seven questions, and the row where the conformance walker's *other* blind spot turned
 * up.
 *
 * ## The finding: the walker sees presence, not visibility
 *
 * ADR-093 found that a spec's vocabulary is text, so the walker could not see a bus token *at all* — a
 * graphic carrying information a rider acts on. This screen is the mirror image, and it is the more
 * dangerous of the two because it fails **open**: every driver in this repo reads text with
 * `createTreeWalker(host, NodeFilter.SHOW_TEXT)`, which consults the DOM and never CSS. A collapsed
 * `<details>` still hands its answer to that walk. So does anything behind `display: none`, `hidden`, or
 * an off-screen clip.
 *
 * The consequence is precise and it decides the port: **a disclosure that keeps its content mounted is
 * indistinguishable, to every check in this repo, from one that shows everything.** A `<details>`-based
 * FAQ would render the collapsed state — the state a rider *arrives* in — as seven questions and seven
 * answers, and the only escape would be to declare that state without a projection. So the DOM twin is a
 * `<button aria-expanded>` with a conditionally-rendered answer, matching what the RN screen already did,
 * and `faqView` models a collapsed answer as **absent rather than empty** so the rule is in the kernel
 * rather than in two renderers' habits. (`<summary>` is also not an interactive element by the drivers'
 * own selector, so a `<details>` FAQ would report zero tap targets and make the nesting check vacuous
 * too — two independent reasons, one answer.)
 *
 * ## Three expansion states, because one would not have found it
 *
 * `allCollapsed`, `oneExpanded` and `severalExpanded`. The third is not padding: several-at-once is a
 * decision (these are seven independent questions, not a wizard, and "how fresh are the times" and "does
 * it work offline" are exactly the pair a rider reads together), and the single-open accordion is what a
 * second renderer reaches for by default. It would pass the first two states.
 *
 * This is ADR-092's shape applied again — a spec cannot hold the *tap*, but it can hold what a rider is
 * left looking at afterwards.
 */

const ITEMS: SlotNode = {
  name: 'items',
  each: 'items',
  of: [
    { name: 'question', text: { field: 'question' } },
    {
      name: 'answer',
      text: { field: 'answer' },
      when: 'expanded',
      why: 'A collapsed answer is not on screen, and — because a text walker reads presence rather than visibility — it must not be in the tree either. This is the node the whole spec turns on: declared as unconditional it would be satisfied by a renderer that shows every answer at once, and declared with no `when` it would be satisfied by one that mounts them all and hides them.',
    },
  ],
  invariant:
    'All seven questions, always, in the kernel’s order, each paired with **its own** answer. The pairing is the part nothing could get wrong loudly: a mis-paired question and answer type-checks, renders, and reads as merely a strange FAQ.',
}

export const FAQ_SPEC: ComponentSpec = {
  component: 'Faq',
  version: 1,
  doc: 'The seven questions this app answers about its own honesty — freshness, what is live, what is covered, why stops merge, what works offline, why there is no bus map, and what an operator’s note means.',
  viewModel: {
    module: 'settings',
    type: 'FaqView',
    corpus: 'settings.spec.json',
    group: 'faqView',
  },

  slots: [{ name: 'title', text: { message: 'settingsFaq' } }, ITEMS],

  states: {
    /** What a rider arrives to, and the state a `<details>` renderer cannot satisfy. */
    allCollapsed: {
      must: 'Seven questions and not one answer.',
      mustNot:
        'An answer in the tree. Not merely off screen — *absent*: a hidden answer is read by a screen reader, counted by a text walker, and found by a page search, so "collapsed" that keeps its content is a claim about pixels rather than about content.',
      why: 'The default, and the reason this spec exists in the shape it does. See the note at the top: this is the state that decides the DOM port cannot use `<details>`.',
      enforcement: { shows: [] },
    },

    oneExpanded: {
      must: 'Seven questions, and the opened one’s own answer directly under it.',
      mustNot:
        'A neighbour’s answer. The opened item is deliberately in the middle of the corpus list so that an off-by-one in either direction is a different projection.',
      enforcement: { shows: [] },
    },

    severalExpanded: {
      must: 'Every opened answer, all of them, each under its own question.',
      mustNot:
        'One. An accordion that closes the previous answer makes comparing two of them impossible, and comparing two of them is what this page is for.',
      why: 'Not padding: the single-open accordion is the default a second renderer reaches for, and it satisfies `allCollapsed` and `oneExpanded` perfectly. This is the state that fails it.',
      enforcement: { shows: [] },
    },

    loading: {
      must: 'The finished page, on the first frame.',
      mustNot: 'A skeleton in the shape of seven rows.',
      why: 'The same claim `about-data.spec.json` makes and for the same reason: the whole screen is in `slots`, so `shows: []` here means *everything*, and a renderer that deferred the list to an effect diverges at index 0.',
      enforcement: { shows: [] },
    },

    empty: {
      must: 'Unreachable: the question list is a kernel constant with seven entries.',
      mustNot:
        'A page with a heading and nothing under it — which is what a renderer that filtered the list by a search box, or by "questions relevant to your region", would produce.',
      why: 'The open set cannot widen the list either: an id in it that names no question contributes no row, which the corpus pins, because the obvious alternative implementation — mapping over the *expanded* set — produces a row with no question in it.',
      enforcement: { by: 'items' },
    },

    failed: {
      must: 'Nothing: there is no request behind this page to fail.',
      mustNot: 'An error. A question with no answer under it would be one.',
      why: 'The honest reading of `failed` for a screen whose content is the string catalogue: the failure mode is not a request but a *missing key*, and that is a compile error rather than a runtime state — `PlainMessageKey` makes a key that is not in the catalogue a `TS2322`, and `check-i18n` fails a locale that is missing one.',
      enforcement: {
        unenforced:
          'Enforced, but not here: by the type of a catalogue key and by `check-i18n`’s key-parity check, both of which fire before a build exists. Naming what *does* enforce it is the point — a state whose enforcement is "the compiler" is not the same as one nothing checks.',
      },
    },

    stale: {
      must: 'Answers that are true of the app as it is now.',
      mustNot:
        'A claim the app has outgrown. This page is where a rider goes to find out whether to trust a number; an answer that is out of date here costs more than one that is missing.',
      why: '**The worked example is this row’s own acceptance.** `faqOfflineA` understated offline by two ADRs and described live times as coming "straight from the operators", which stopped being true when the Worker began coalescing them. It was not the only one: `faqMergeA` still described ADR-022’s cross-operator pair merge, a rule ADR-042 replaced and ADR-072 partly reversed, and `faqTimingsA` said every figure was "shown as published" while the app was drawing concession fares it works out itself and marks with a `~`.',
      enforcement: {
        unenforced:
          'Nothing mechanical can know that a sentence has stopped being true, and pretending otherwise would be the vacuous pass this format exists to prevent. The mitigation is procedural and is written into `docs/07`: an ADR that changes what a rider is told re-reads this page.',
      },
    },

    offline: {
      must: 'All seven questions, and any answer a rider opens.',
      mustNot: 'A blank page, or a subset.',
      why: 'The nicest property on this screen and worth declaring for its own sake: **the answer to "does this app work offline?" has to be readable offline.** It is, because the page is part of the precached shell and its content is the string catalogue rather than a request.',
      enforcement: { shows: [] },
    },
  },

  interactions: [
    {
      target: 'items',
      goes: 'the same page with that answer opened — or closed, and without closing any other',
      note: 'The tap is idiom; what a rider is left looking at is not, which is why three expansion states are projected rather than the interaction being described (ADR-092).',
    },
  ],

  a11y: {
    role: 'list of disclosure buttons, each labelled by its question and each reporting whether it is expanded',
    name: { fromSlot: 'title' },
    reducedMotion:
      'The RN screen’s `LayoutAnimation` on expand and its chevron flip are the only motion, and the content is identical without either; the DOM twin animates nothing at all, which is ADR-094’s "the web curve is chosen, not inherited" in its cheapest form.',
  },

  idiom: [
    '**the disclosure mechanism** — with one hard edge this spec has to state, because it is the one place idiom and identity meet on this screen: whatever the mechanism, a collapsed answer must not be in the tree. That rules out `<details>` and CSS-hidden content on any renderer, and it rules them out for an accessibility reason as much as a testing one',
    'the expand animation — a `LayoutAnimation` on native, nothing on the web',
    'the chevron: whether it exists, which way it points, and whether it rotates',
    'whether the questions are separated by rules, cards or whitespace',
  ],
}
