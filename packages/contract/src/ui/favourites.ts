import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'
import { FEED_NOTICE } from './feed-notice'

/**
 * **The Favourites screen** (WP6-4b) — a rider's own list, and the eight states it can be in.
 *
 * ## The one screen whose content a rider authored
 *
 * Every other surface shows what the data says. This one shows what the *rider said*, which changes what a
 * mistake costs: a stop that renders wrong is a stop, and a favourite that renders wrong is something they
 * curated by hand and cannot get back. That asymmetry is why the key scheme is versioned (ADR-062/089), why
 * the migration is corpus-pinned rather than a store's private business, and why the two states below that
 * used to be wrong were wrong in the same direction — **the screen showed a rider less than they had asked
 * for, silently.**
 *
 * ## Two states that were bugs, declared here and closed by changing what a card is built from
 *
 *  · **`quietRoute`** — a saved route with no live reading contributed *nothing*, so a card could be a name
 *    with nothing under it. `StopRow`'s spec has carried that sentence as a `mustNot` since WP6-1 and could
 *    not enforce it, because the fix was never in the card: `favouritesView` emits a row per **saved route**
 *    now, whose readout is the published frequency, else a dash.
 *  · **`bothKerbs`** — a rider who starred one line at *both* kerbs of a place saw **one** row, because the
 *    compact card collapses to one row per line. Right for a card summarising a place; wrong for a list the
 *    rider curated, and it hid the other kerb's bus entirely (ADR-072, WP5-12's residual).
 *
 * Neither is enforceable by a card spec alone, which is the useful lesson: a `mustNot` a component cannot
 * satisfy is usually a statement about its *producer*.
 *
 * ## What this screen has no words for, and says so
 *
 * There is no distance and no compass caption beyond the place's own bearing, no "+N more" that means
 * anything about the place (the saved rows *are* the total), and no sort a rider chose. The order is the
 * readout's rank then the arrival, because a rider opens this to find the next bus.
 */

/** The cards, as a list of the component whose spec already declares them. Used by four states. */
const CARDS: SlotNode = {
  name: 'cards',
  each: 'cards',
  of: [{ name: 'card', component: 'StopRow' }],
  invariant:
    'One card per saved **place**, in save order, capped inside each card by the served `maxRows`. Never one per saved *pole*: a rider who saved two lines at two kerbs of one interchange saved two things at one place, and two cards would read as two places (ADR-089).',
}

export const FAVOURITES_SPEC: ComponentSpec = {
  component: 'Favourites',
  version: 1,
  doc: "A rider's saved route-at-stop pairs, as one card per place — the only screen whose content a rider authored.",
  viewModel: {
    module: 'favourites',
    type: 'StopCardView[]',
    corpus: 'favourites.spec.json',
    group: 'favouritesView',
  },

  slots: [
    {
      name: 'title',
      text: { message: 'tabFavorites' },
      invariant:
        'Present in every state, including the empty one — a rider who has saved nothing still has to be able to tell which tab they are on.',
    },
  ],

  states: {
    content: {
      must: 'One card per saved place, each carrying only the rows the rider saved.',
      mustNot:
        'A row the rider did not save, or a place they saved nothing at. The list is theirs, not the data’s.',
      enforcement: { shows: [FEED_NOTICE, CARDS] },
    },

    /** A saved route with no live reading — the empty card, closed. */
    quietRoute: {
      must: 'A row for the saved route, with its published frequency or a dash on the right.',
      mustNot:
        'A card with a name and nothing under it, which cannot be told from a favourite key that no longer resolves.',
      why: 'A peak-only service at 23:00 — most of a rider’s list overnight. Found by WP5-11 and unowned for a wave: the card was never the place to fix it, because the row was never built. `docs/11`’s open bug, closed by `favouritesView` emitting a row per saved route rather than per reading.',
      enforcement: { shows: [FEED_NOTICE, CARDS] },
    },

    /** One line saved at two kerbs of one place — WP5-12's residual, from the favourites side. */
    bothKerbs: {
      must: 'Two rows for that line, each carrying its own kerb’s reading.',
      mustNot:
        'One merged row. The collapse-to-one-row-per-line is right for a card summarising a place and wrong for a list the rider curated — it hid the other kerb’s bus entirely.',
      why: 'ADR-072 declined this and WP5-12 left it open, both because a *label* naming the two kerbs needs room a compact row does not have. Measured before it was declined again: across five Hong Kong neighbourhoods **not one** line published at two kerbs of a place had *distinct* printed codes on them, and it could not — a place’s poles are clustered by sharing a name and the code is part of the name. So the rows are two and the kerbs are unnamed, and Place detail, which has room for ADR-080’s ladder, is one tap away.',
      enforcement: { shows: [FEED_NOTICE, CARDS] },
    },

    empty: {
      must: 'What this tab is for, and how to put something in it.',
      mustNot:
        'A bare heading. It is the first thing most riders see here, and it is the only screen in the app whose emptiness is the rider’s own doing rather than the data’s.',
      why: 'The same state for "nothing saved" and "nothing saved that can still be read": a key the id grammar cannot parse is skipped by `favouritePoleIds` rather than guessed at, and to a rider a list of unreadable keys is a list with nothing in it.',
      enforcement: {
        shows: [
          { name: 'emptyTitle', text: { message: 'favoritesEmpty' } },
          { name: 'emptyHelp', text: { message: 'favoritesEmptyHelp' } },
        ],
      },
    },

    loading: {
      must: 'A skeleton in the shape of a card, under the heading.',
      mustNot: 'A borrowed name, or an invented word — nothing is claimed while nothing is known.',
      why: 'This screen fans out one query per saved pole, so it is the one most likely to be part-way: the state is "no card has arrived yet", and a card that *has* arrived is drawn immediately rather than held for its siblings.',
      enforcement: { shows: [] },
    },

    failed: {
      must: 'The reason the saved places could not be fetched, verbatim.',
      mustNot: 'A heading with an empty list, which reads as "you have nothing saved".',
      why: '**This was a bug until WP6-4b**, and the third instance of one shape: the screen guarded only on `isLoading`, so once every query had failed it rendered its heading and nothing else — a rider could not tell "still fetching" from "we could not reach any of them", and a list they had curated looked empty. The same hole WP6-3b found on Place detail through a different door.',
      enforcement: {
        shows: [{ name: 'fetchError', text: { field: 'error' } }],
      },
    },

    stale: {
      must: 'The cards, and one line saying when the newest board on screen was published.',
      mustNot:
        'A value presented as fresh, and — since ADR-123 — a cue on each reading. Staleness is the **board’s**: one `dataTimestamp` per board, so a per-figure mark draws one fact once per row and a rider can act on none of it.',
      why: 'ADR-008. Unlike Nearby there is no *position* to be stale here — this screen measures no distance and has nothing to say about where the rider is — so the only stale thing is a reading. The sentence is the screen’s (`eta#feedNotice`), and the figures beside it do not change while it is up: a reading only moves when a fresh one arrives.',
      enforcement: { shows: [FEED_NOTICE, CARDS] },
    },

    offline: {
      must: 'The last known cards, and the line that says the rider’s own network is gone.',
      mustNot:
        'A blank list, a fresh-looking arrival time, or the same sentence as `stale` — a rider whose network is down is told that, not that their data is old, because the first explains the second (ADR-133’s precedence).',
      why: 'ADR-058: the queries this screen fans out are persisted like any other, so a cold offline start replays them with their original `observedAt` and the ETA helpers age them. **This state was `unenforced` on all four screens until ADR-150**, with the same reason each time — *textually identical to `stale`, so asserting it would be asserting `stale` twice* — and that reason was a description of the gap rather than of the design: the screen had no sentence of its own. Now it has one, and the difference is a word a harness can read.',
      enforcement: { shows: [FEED_NOTICE, CARDS] },
    },
  },

  interactions: [
    {
      target: 'cards',
      goes: 'StopRow’s own targets — place detail from the heading, route-at-this-stop from a row',
      note: 'Declared once, in `StopRow`’s spec. A screen that named the same destinations again would be a second declaration of them.',
    },
  ],

  a11y: {
    role: 'list of list items, one per saved place',
    name: { fromSlot: 'title' },
    reducedMotion:
      'No entrance cascade for the list; the content is identical either way. There is no motion on this screen at all today, which is the honest thing to say rather than describing one.',
  },

  idiom: [
    'material and elevation of the list surface, and the divider between cards',
    'the skeleton’s shape and whether it shimmers',
    'how a saved row is removed — a swipe on native, a control on the web; neither exists yet and the star lives on the route schematic (ADR-032)',
    'whether the empty state carries an illustration',
    'how a refresh is offered — nothing on either renderer: this screen fetches on the served cadence, so a manual refresh is reassurance rather than how a rider gets fresh data',
  ],
}
