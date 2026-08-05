import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'

/**
 * **Search** (WP6-5b) — the screen `proposals/04` picked for *"interaction-heavy specs"*, and the ten states
 * that turned out to mean.
 *
 * ## What is identity here, and it is not what the row assumed
 *
 * The plan's question was whether a spec can carry *interaction*. It mostly cannot, and should not try: a
 * keypad that collapses on scroll, a field that autofocuses, a segment that animates — all of that is gesture
 * and motion, which ADR-075 puts on the idiom side, and this spec says so by enumeration rather than by
 * silence. What **is** identity is the thing a rider infers from the interaction: **a key drawn as live means
 * some route number continues that way.** That is one rule (`nextValidChars` over the *filtered* key set), it
 * is now a field of the view rather than a coincidence of two components, and the states below drive it — with
 * the `night`-filter state as the extreme case where the honest answer is a pad with nothing pressable on it.
 *
 * ## The field's own text is not declared, and that is a platform difference rather than an omission
 *
 * `apps/mobile` draws the typed number in a `<Text>`, because its keypad *is* the input; `apps/web` uses a
 * real `<input>`, so both the value and the placeholder are attributes and neither is a text node. Two
 * renderers, two honest answers, no shared projection — so each driver drops the field's text and this spec
 * names the difference in `idiom`. What neither driver can see is a field showing the wrong number.
 */

/** The chip row, and the keypad — the two things every routes-mode state shows. */
const CHIPS: SlotNode = {
  name: 'chips',
  each: 'chips',
  of: [{ name: 'chipLabel', text: { field: 'label' } }],
  invariant:
    'Every operator the **index** carries, then the categories the mode filters by. Which operators exist is the index’s answer, not a hard-coded list (ADR-037), so a fifth operator’s chip appears the day its adapter lands — and a chip is never offered for an operator that cannot produce a result.',
}

const KEYPAD: SlotNode[] = [
  {
    name: 'keypadLetters',
    each: 'keypad.letters',
    of: [{ name: 'keypadLetter', text: { field: 'char' } }],
    invariant:
      'Only the letters that can **continue the current prefix**, in `indexAlphabet`’s stable order — so the row shrinks as a rider types and disappears entirely when no letter can follow. A letter offered here always extends the prefix into some findable number, which is asserted as a corpus property.',
  },
  {
    name: 'keypadDigits',
    each: 'keypad.digits',
    of: [{ name: 'keypadDigit', text: { field: 'char' } }],
    invariant:
      'All ten, always, in **keyboard** order (1–5 then 6–0). An unusable key is drawn inert rather than removed, so the grid does not move under a rider’s thumb between taps — and the set and its order are the view’s, precisely so one renderer cannot adopt a phone’s 1-2-3 grid while the other keeps the keyboard’s. Whether a key is *live* is `enabled`, which this projection cannot see: it is a colour, and the suites assert it directly.',
  },
]

export const SEARCH_SPEC: ComponentSpec = {
  component: 'Search',
  version: 1,
  doc: 'Find a route by number on a smart keypad, or a stop by name — over an index that works offline.',
  viewModel: {
    module: 'search',
    type: 'SearchView',
    corpus: 'search.spec.json',
    group: 'searchView',
  },

  slots: [
    {
      name: 'segRoutes',
      text: { message: 'searchSegRoutes' },
      invariant:
        'Both segment labels are present in every state, including the failed one: a rider who cannot search routes must still be able to try stops, and a screen that lost its own navigation has lost more than its results.',
    },
    { name: 'segStops', text: { message: 'searchSegStops' } },
  ],

  states: {
    /** A route query with matches — the ordinary shape. */
    content: {
      must: 'One row per matching route, each with its number chip and both ends of its journey.',
      mustNot:
        'A row for a route the query does not match, or a journey with one end — a rider chooses between routes by where they go.',
      enforcement: {
        shows: [
          CHIPS,
          {
            name: 'routes',
            each: 'list.routes',
            of: [
              { name: 'routeNo', text: { field: 'routeNo' } },
              {
                name: 'origin',
                text: { field: 'origin' },
                invariant:
                  'Title-cased by the model, never by the row: the feeds shout and they do not agree with each other about it (ADR-034).',
              },
              {
                name: 'journeyArrow',
                text: {
                  literal: '→',
                  why: 'The renderer supplies the glyph and the kernel supplies both ends. A direction marker rather than a word, so it is not in the catalogue — the same literal `StopRow` declares. It is its **own** node in both renderers, which they were changed to make true: `{origin} → ` as one string is a composition the kernel did not perform, and the projection would have had to spell it out to see it.',
                },
              },
              { name: 'destination', text: { field: 'destination' } },
            ],
          },
          ...KEYPAD,
        ],
      },
    },

    /** A stop query with matches. */
    stopsMode: {
      must: 'One row per matching stop, with its printed code split off the name.',
      mustNot:
        'A category chip. A stop has no route number, so a category cannot narrow it, and a dimmed-but-present night-bus chip offers a filter that does nothing.',
      why: 'The other half of the screen, and the one that has no keypad at all — a stop is found by typing words, which is what a platform keyboard is for.',
      enforcement: {
        shows: [
          CHIPS,
          {
            name: 'stops',
            each: 'list.stops',
            of: [
              { name: 'stopName', text: { field: 'name.label' } },
              {
                name: 'stopCode',
                text: { field: 'name.code' },
                when: 'name.code',
                why: 'A place whose upstream name carries no printed code — and a GMB pole rarely has one at all.',
              },
            ],
          },
        ],
      },
    },

    /** Nothing typed, and a history to offer. */
    recents: {
      must: 'The rider’s recent routes under a heading that says so, with a way to clear them.',
      mustNot:
        'A result list presented as a search. What a rider looked at before is not what they asked for now.',
      why: 'A saved id is a *reference*: the dataset is rebuilt daily, a route can leave it, and clustering can mint a new `P:` id for a place — so a recent the index no longer has is dropped rather than rendered as a row that opens nothing.',
      enforcement: {
        shows: [
          CHIPS,
          { name: 'recentsHeading', text: { message: 'searchRecent' } },
          { name: 'clearRecents', text: { message: 'searchClearRecent' } },
          {
            name: 'recentRoutes',
            each: 'list.routes',
            of: [
              { name: 'routeNo', text: { field: 'routeNo' } },
              { name: 'origin', text: { field: 'origin' } },
              {
                name: 'journeyArrow',
                text: {
                  literal: '→',
                  why: 'As in `content` — the renderer’s glyph, in its own node.',
                },
              },
              { name: 'destination', text: { field: 'destination' } },
            ],
          },
          ...KEYPAD,
        ],
      },
    },

    /**
     * A query that matched nothing — and **it is reachable only in stops mode**, which is a fact about the
     * keypad rather than about this state.
     *
     * A smart keypad cannot type a query that matches nothing: the key that would take you there is inert,
     * by construction and by design. So the no-results copy exists for the mode with a *free-text* field,
     * where a rider can type any words at all. Discovered by writing this driver — it pressed `9` five times
     * and got a one-character query, because the pad had disabled the key after the first press.
     */
    noMatches: {
      must: 'An explicit "no matches" line.',
      mustNot:
        'The recents heading. A rider who mistyped must not be told they have no history — the screen used to decide between the two by re-testing the query beside a length check.',
      why: 'Three list states, not two (ADR-091). The copy differs and so does what a rider should do next.',
      enforcement: {
        shows: [CHIPS, { name: 'noResults', text: { message: 'searchNoResults' } }],
      },
    },

    /**
     * A filter that admits nothing for this prefix — the extreme case, and the one that makes the whole
     * invariant visible.
     */
    filteredToNothing: {
      must: 'The ten digits, all of them inert, and only the letters a filtered number can still begin with.',
      mustNot:
        'A live key. A key a rider can press that leads to an empty list is the one thing this screen must never draw, and it is exactly what a keypad computed over an *unfiltered* set would produce.',
      why: 'Walked in a browser: with the *Night* chip on, every digit is inert and only `N` is offered, because every night route begins with one. Type the `2` as well and the letter row goes too. The keypad and the list agree without either knowing about the other — and the projection can only see the *characters*, so each suite asserts `enabled` directly.',
      enforcement: { shows: [CHIPS, ...KEYPAD] },
    },

    empty: {
      must: 'The chip row and the keypad, ready, with no list under them.',
      mustNot:
        'An error, or a "no matches" line. Nothing has been asked yet — the screen is not empty, it is waiting.',
      why: 'A rider’s first visit, and also a rider whose every saved recent has left the index. To them those are the same screen, which is why `favouritePoleIds`’ analogue here drops what it cannot read rather than reporting it.',
      enforcement: { shows: [CHIPS, ...KEYPAD] },
    },

    loading: {
      must: 'A skeleton, and both segment labels.',
      mustNot:
        'A spinner over a keypad that cannot be used yet, or a chip row with no operators in it — a row that filled in afterwards would move under a rider’s finger.',
      why: '**The only loading state is a cold start with nothing cached.** The index is stale-while-revalidate: a previous session’s copy is read before the first render, so a rider who has used the app before never sees this at all, online or off.',
      enforcement: { shows: [] },
    },

    failed: {
      must: 'The reason the index could not be fetched, verbatim.',
      mustNot:
        'An empty search screen. A keypad with no index behind it is a set of keys that match nothing, which reads as a broken dataset rather than a failed request.',
      why: 'And it is narrower than it looks: a network failure **with a cache in hand is not an error** — yesterday’s index still finds a route number. This state is reachable only on a first-ever visit with no network.',
      enforcement: { shows: [{ name: 'fetchError', text: { field: 'error' } }] },
    },

    stale: {
      must: 'The whole screen, working, on the index we already had.',
      mustNot:
        'A staleness warning. A route number that existed yesterday almost certainly exists today.',
      why: 'Deliberately **not** ADR-008’s staleness rule, and the difference is worth stating: that rule is about *readings*, which decay in minutes. A search index decays in days and the screen’s job is to keep working — so a cached index is used silently and refreshed behind the rider.',
      enforcement: {
        unenforced:
          'There is nothing to assert: a stale index renders identically to a fresh one, by design. What is checkable is that it is *used* — the load order in `useSearchIndex` — and that is asserted where a cold start is measurable rather than here.',
      },
    },

    offline: {
      must: 'The whole screen, working, from the cached index.',
      mustNot: 'A blank screen or an error, when a usable index is sitting in storage.',
      why: 'ADR-037’s reason for an on-device index in the first place: searching a route number is the one thing this app should never need a network for.',
      enforcement: {
        unenforced:
          'Textually identical to `stale`, and for the same reason — the whole point is that a rider cannot tell. The cache path itself is asserted in each app’s own index-hook coverage.',
      },
    },
  },

  interactions: [
    { target: 'segRoutes', goes: 'the route keypad and the route list' },
    { target: 'segStops', goes: 'the stop text field and the stop list' },
    {
      target: 'chips',
      goes: 'the same screen, narrowed — and the keypad narrowed with it',
      note: 'A chip hands its key straight back to `toggleSearchChip`; the format of that key is known only to the kernel, which mints it and reads it (ADR-091).',
    },
    { target: 'keypadDigits', goes: 'the same screen with one more character in the query' },
    { target: 'keypadLetters', goes: 'the same screen with one more character in the query' },
    { target: 'routeNo', goes: 'route-detail, and the route joins the rider’s recents' },
    { target: 'stopName', goes: 'place-detail, and the stop joins the rider’s recents' },
    {
      target: 'clearRecents',
      goes: 'the same screen with an empty history',
      optional: true,
      note: 'Absent when there is no history to clear — which is the `empty` state, where the heading is absent too.',
    },
  ],

  a11y: {
    role: 'search page: a two-option mode toggle, a query field, a row of toggle chips, a list, and a keypad',
    name: { fromSlot: 'segRoutes' },
    reducedMotion:
      'The RN keypad’s collapse and the segment’s slide are the only motion, and the content is identical without either. Neither renderer animates a result list.',
  },

  idiom: [
    '**how a query is typed** — and it is the one genuine platform split on this screen: `apps/mobile` draws the number in a `<Text>` because its keypad *is* the input, while `apps/web` uses a real `<input>` and accepts the hardware keyboard as well, making the pad an accelerator. Neither the value nor the placeholder is therefore a shared projection, and each driver drops the field’s own text',
    '**whether the keypad collapses** — the RN screen hides it when the results are scrolled and brings it back on a tap, because on a phone it competes with the OS keyboard for the bottom of the screen; the web screen leaves it in place, because nothing there competes',
    'the segment’s treatment: a sliding indicator, a pressed fill, or a pair of tabs',
    'the chip row’s scroll affordance, and whether a pressed chip inverts or tints',
    'the skeleton’s shape and whether it shimmers',
    'whether backspace long-presses to clear (native does; the web has a clear control instead)',
  ],
}
