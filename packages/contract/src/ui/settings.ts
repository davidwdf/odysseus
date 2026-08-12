import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'

/**
 * **Settings** (WP6-7) — and the first spec in this repo for a screen that fetches nothing.
 *
 * ## The question this row settles: what are the five canonical states for a screen with no data?
 *
 * `ui-spec` requires every spec to declare `loading`, `empty`, `failed`, `stale` and `offline`, and the
 * five were designed around a query: they are branches over an async status (ADR-084). Nothing on this
 * screen fetches. The tempting reading is that all five are vacuous here and should be `unenforced`, which
 * would make this spec decoration — the exact failure `enforcement` exists to prevent.
 *
 * The answer is that **the five stop being branches over a fetch and become claims that hold without
 * one**, and the mechanism is an inversion of the `slots`/`shows` split every previous spec uses. On a
 * screen with data, `slots` is the thin chrome that survives every branch and each state adds its own
 * content. Here the *whole screen* is `slots`, so a state declaring `shows: []` is declaring **everything**
 * — and a renderer that drew nothing, or that deferred a section to an effect, diverges at index 0 rather
 * than passing. `route-detail.spec.json` records the trap this inverts: there, `shows: []` and "renders
 * nothing at all" are indistinguishable to a text projection. Here they are opposites.
 *
 * So: `empty` is enforced `by` the slot that would have to be empty for it to happen; `offline` is a full
 * projection, because every control here works with no network and that is a claim; `loading` and `stale`
 * are `unenforced`, each for a reason worth reading (below) and each naming who *does* hold it, which is
 * the whole difference between an honest gap and decoration; and `failed` is a real defect this row found
 * and declined to hide. `stale` was the second such defect, and WP6-8a fixed it — in the producer, so
 * nothing on this screen changed.
 *
 * ## What the projection cannot see, and what the suites do about it
 *
 * **Selection is not text.** Both controls say "this one is yours" with a filled pill, a weight and a dot
 * — nothing a walker that reads text nodes can observe. So a spec declaring only the seven labels would be
 * *exactly equal in every selection state*: it could not tell "Auto" from "Dark". That is the same edge
 * ADR-093 met from the other side when the walker could not see a bus token at all, and this spec takes
 * the answer `search.spec.json` already established for a keypad key's `enabled`: the flag is a field of
 * the view model, the kernel owns it, and **each suite asserts it directly**. What is enforced here is
 * that the options exist, in order, with the right words; what the suites add is which one is lit.
 */

const LANGUAGE_OPTIONS: SlotNode = {
  name: 'languageOptions',
  each: 'languages',
  of: [{ name: 'languageLabel', text: { field: 'label' } }],
  invariant:
    'Follow-the-device first, then one row per language this build ships — **in that language**, always. A reader whose UI is Chinese and who wants English has to be able to find the word "English", so these labels are the one place in the app that deliberately does not follow the active locale (`endonym`). A renderer that ran them through the catalogue would produce a list nobody locked out of their own language could escape from.',
}

const APPEARANCE_OPTIONS: SlotNode = {
  name: 'appearanceOptions',
  each: 'appearances',
  of: [{ name: 'appearanceLabel', text: { field: 'label' } }],
  invariant:
    'All three, always, in the order `@nextbus/ui` declares them beside the type — never a subset, and never reordered to put the current one first. Which one is *selected* is `selected`, which this projection cannot see: it is a fill and a weight, and the suites assert it directly.',
}

const ABOUT_ROWS: SlotNode = {
  name: 'aboutRows',
  each: 'about',
  of: [{ name: 'aboutRowLabel', text: { field: 'label' } }],
  invariant:
    'Where this screen can go next, and therefore identity rather than chrome (ADR-082 puts the destination set on that side). Two rows: the attribution page and the FAQ.',
}

export const SETTINGS_SPEC: ComponentSpec = {
  component: 'Settings',
  version: 1,
  doc: 'The preference screen: language, appearance, and the two pages it pushes to — the app’s only screen whose content is a choice rather than data.',
  viewModel: {
    module: 'settings',
    type: 'SettingsView',
    corpus: 'settings.spec.json',
    group: 'settingsView',
  },

  slots: [
    {
      name: 'title',
      text: { message: 'tabSettings' },
      invariant:
        'The tab’s own key rather than a screen-title key, so the label in the tab bar and the heading on the screen cannot drift apart.',
    },
    { name: 'languageHeading', text: { message: 'settingsLanguage' } },
    LANGUAGE_OPTIONS,
    { name: 'appearanceHeading', text: { message: 'settingsAppearance' } },
    APPEARANCE_OPTIONS,
    { name: 'aboutHeading', text: { message: 'settingsAbout' } },
    ABOUT_ROWS,
  ],

  states: {
    content: {
      must: 'Three sections in order, with every option this build ships in each, and exactly one lit per group.',
      mustNot:
        'A group with nothing selected, or with two. A picker showing two selected rows is not a worse picker — it is a picker that has stopped meaning anything.',
      why: 'The whole screen, which is why this state’s projection is empty: everything is in `slots`. A renderer that drew a heading and filled its list in an effect would diverge at index 0 rather than passing, which is the inversion this spec turns on.',
      enforcement: { shows: [] },
    },

    /**
     * The same screen, read in Chinese — and the state that turns the endonym rule from a comment into an
     * assertion.
     */
    localeOverridden: {
      must: 'Headings in the reader’s language, and language names still in their own.',
      mustNot:
        'A translated language name. "英文" is the one word a reader who has accidentally set the app to a language they cannot read will never find, and finding it is the entire purpose of this list.',
      why: 'The two halves of this screen resolve through different doors — headings through the catalogue, language names through `endonym()` — and a renderer that sent both through the same one looks completely correct in English. This is the only state in the repo that is driven under a non-`en` locale.',
      enforcement: { shows: [] },
    },

    loading: {
      must: 'Nothing — this screen has no loading state to draw.',
      mustNot:
        'A skeleton. A shape standing in for a list that is already in memory is a frame of flicker bought for nothing.',
      why: 'The one state where the two renderers close the same window by different means, which is worth recording because a third would have to choose: `apps/web` persists through `localStorage`, which is synchronous, so `persist` has read the blob before `create` returns and there is no window at all; `apps/mobile` persists through AsyncStorage and holds the splash screen until rehydration finishes, so the window exists and a rider never sees it.',
      enforcement: {
        unenforced:
          'There is no state to enter. Asserting "no skeleton" would be asserting the absence of something neither renderer contains — the shape of a check looking at nothing. What *is* asserted is the consequence: `content` is the first frame, and its projection is the whole screen.',
      },
    },

    empty: {
      must: 'Unreachable: a build always ships at least one language and always three appearances.',
      mustNot:
        'A section heading with no options under it — which is what a renderer that filtered the lists (to hide the current one, say, or a language with no translations yet) would produce.',
      why: 'Both lists are build constants handed in from the packages that own them, and "Automatic" does not come from the language list at all, so even a build shipping one language has two rows. The corpus pins that case for exactly this reason.',
      enforcement: { by: 'languageOptions' },
    },

    failed: {
      must: 'That the preference was not saved.',
      mustNot: 'Silence, or a row that appears to be selected when nothing was written.',
      why: 'Storage can refuse — Safari private browsing, a full quota, a wiped profile — and both stores write through a wrapper that swallows the throw so the app keeps running. The screen then shows a choice that will not survive a reload, which is the honest definition of lying to a rider about their own data.',
      enforcement: {
        knownDefect:
          'Neither renderer can say it: `safeLocalStorage` and the RN twin both swallow the error, and zustand’s `persist` reports nothing to a component. Owner: `docs/07`’s hardening list, added by WP6-7.',
      },
    },

    stale: {
      must: 'The preferences as they are on disk now.',
      mustNot:
        'A choice this tab made three minutes ago, written over a choice another tab made since.',
      why: '**A real defect this row found, and WP6-8a fixed it.** Two stores share one storage key (ADR-089), neither listened for a `storage` event, and zustand’s `persist` writes `partialize`’s output as the *whole* blob — so a second tab held a stale copy and the next preference it wrote silently reverted the first tab’s language, favourites included. It was ADR-082 decision 5’s hazard between two *apps*, arriving between two tabs of one. The fix is in the **producer**, not here (ADR-090, third instance): `@nextbus/core`’s `mergePreferences` is the arithmetic, corpus-pinned so both stores resolve a conflict the same way, and each store does a read-modify-write on every save plus a `storage` listener that re-reads and merges.',
      enforcement: {
        unenforced:
          'Not at this layer — and saying so is the point, because this state’s first classification was ' +
          '`by: languageOptions`, which was worse than none. `conformStates` does not project a `by` ' +
          'state at all, so that claim named a slot nothing ever asks about the merge: delete the ' +
          '`storage` listener tomorrow and every conformance run on both renderers stays green. A ' +
          'projection is not the alternative either, and not merely for want of a fixture. This state is ' +
          '**two tabs of one origin**, and there is no second writer on a native build by design — the ' +
          'merge and the listener are both gated on a web feature test, so iOS and Android still do one ' +
          'write per mutation (`apps/mobile/lib/preferences.ts`, and the comment above the gate says so). ' +
          'A `shows` on `stale` would therefore oblige the RN driver to enter a state its surface does ' +
          'not have, through a `useLocaleOverride` it mocks — a fixture faking the thing under test, ' +
          'which is a worse lie than an honest gap. What holds it instead, named so that a port knows ' +
          'what to copy rather than having to infer it: `favourites#mergePreferences` and ' +
          '`favourites#mergeSavedKeys` in `packages/core/spec` pin the arithmetic once for every ' +
          'platform; `apps/web/test/preferences-sync.test.ts` and `apps/mobile/lib/preferences.sync.test.ts` ' +
          'drive the real stores with a second writer on the other end; and the last block of ' +
          '`apps/web/test/settings-states.test.tsx` mounts **this screen**, delivers a `storage` event, ' +
          'reads the new language back off the DOM, and carries a watched-failing control beside it — ' +
          'which is as close to a projection as the state gets, on the one renderer where it exists.',
      },
    },

    offline: {
      must: 'The whole screen, and every control on it working.',
      mustNot:
        'A disabled control, or a warning. Nothing here needs a network, and saying so would teach a rider to distrust the one screen that is always right.',
      why: 'Worth declaring rather than assuming: this is the screen a rider reaches for when something is wrong, and it is the one that changes the language of every error message they are about to read.',
      enforcement: { shows: [] },
    },
  },

  interactions: [
    {
      target: 'languageOptions',
      goes: 'the same screen, and the whole app, in that language — or back to following the device',
      note: 'Applied on the spot with no submit, which is why both renderers express it as a toggle state (`aria-pressed` / `accessibilityState.selected`) rather than as a radio group awaiting a confirm.',
    },
    { target: 'appearanceOptions', goes: 'the same screen, and the whole app, in that appearance' },
    { target: 'aboutRows', goes: 'about-data and faq, in that order' },
  ],

  a11y: {
    role: 'settings page: three labelled groups, the first two of selectable options and the third of links',
    name: { fromSlot: 'title' },
    reducedMotion:
      'No motion on this screen at all on either renderer — no cross-fade when the appearance changes, which is deliberate: the change is the feedback. Stated rather than described, because describing motion that does not exist is how `docs/09` §5 came to be superseded.',
  },

  idiom: [
    'how a selected option is drawn — a dot beside the row on native, a filled pill on the web; what is identity is that exactly one is marked and that the mark is not colour alone',
    'whether the language list is a bordered card with dividers or a plain run of rows',
    'whether the appearance control is a segmented control or three separate buttons',
    'the chevron on a navigation row, and whether a row highlights on press or on hover',
    'where the screen sits in the shell — a tab on both renderers today, but a nav rail or a menu elsewhere',
  ],
}
