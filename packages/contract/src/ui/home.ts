import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'
import { FEED_NOTICE } from './feed-notice'

/**
 * **Home** — Nearby and Favourites as one board (`proposals/07`, ADR-177).
 *
 * ## The merge is visible in this file before it is visible on screen
 *
 * `nearby.spec.json` declares nine states and `favourites.spec.json` eight. **Five of those seventeen
 * are an apology the other screen could have answered**: Nearby's `undetermined`, `denied`,
 * `locationError` and `loading` are a permission prompt and grey bars while every saved place sits live
 * on the next tab, and Favourites' `empty` is an onboarding sentence while the six stops the rider is
 * standing next to sit on the previous one. Four of those five are the first thing a new rider sees.
 *
 * So this spec has **eleven** states rather than seventeen, and the six that went are the ones that were
 * only ever describing a screen's ignorance of the other half. What is left is one genuinely empty state
 * ({@link cold}) — no position and nothing saved, which is a cold install and nothing else.
 *
 * ## Every section is optional and the screen is never a blank
 *
 * `noSaved`, `noPosition` and `denied` are **content** states here, not failures: with no fix the saved
 * list is the whole screen, and with nothing saved the nearby list is. That is the property the merge
 * exists to have, and declaring those three as states with their own projections is what makes it an
 * assertion rather than a claim in a proposal.
 *
 * ## The sections are named after jobs
 *
 * *Catch it* is buses you can still make, *Saved* is your own list at any distance, *Around you* is what
 * happens to be here. A ranked list whose rank is unexplained is a list a rider has to reverse-engineer,
 * so every section that is drawn is drawn with its heading — including when it is the only one.
 *
 * ## One card shape, and the strip is the half with no times on it
 *
 * A card is a place, then the routes the rider saved **there** with readings, then every other route
 * there as a badge with no reading. The discovery half carries no times because we do not know which of
 * a stop's twenty-six routes a rider wants, and choosing three is a guess wearing an answer's clothes.
 * `lines` is a slot rather than prose so that *"the strip hides nothing it has been given"* is checked.
 */
/**
 * One section's cards — declared once and shared, because the alternative is six copies of it.
 *
 * ## A card is a `StopRow` **and then its strip**, and getting that nesting right took two attempts
 *
 * The strip was first declared at the state level, which claimed the chips came after *all* the cards;
 * the walker said so, because the screen interleaves them one per place. And it could only be an `each`
 * at all once `homeView` took over the cap — a slot cannot say *"the first six of these"*, so a spec
 * written against an uncapped array would have failed a correct screen and the obvious way to make it
 * pass would have been to stop capping. The kernel caps, the spec says *these chips*, and both are
 * checkable.
 */
const cardsOf = (field: string): SlotNode =>
  ({
    name: `${field}Cards`,
    each: field,
    of: [
      { name: 'card', component: 'StopRow' },
      {
        name: 'lines',
        each: 'chips',
        of: [{ name: 'lineNo', text: { field: 'routeNo' } }],
        invariant:
          'Exactly the chips the card draws — `homeView` caps them at `HOME_CHIPS_COLLAPSED`, which is what lets this slot be `each` and therefore checkable. The cap lives in the kernel for `stopCardView`’s reason: "show the first N and count the rest" is arithmetic over rows, and a renderer doing it would be a second declaration of the number.',
      },
      {
        name: 'moreLines',
        when: 'chipsMore',
        why: 'Nothing hidden means no badge. On a board served by `/v1/board` this is what the cap held back; on one served by `/v1/nearby` it also carries the lines the wire never sent (ADR-179).',
        text: { message: 'homeMoreLines', args: { n: 'chipsMore' } },
      },
    ],
    invariant:
      'One StopRow per place, in the kernel’s order, each followed by that place’s chip strip. A place appears in exactly one section — `homeView` makes the three exclusive, and a card drawn twice is a rider wondering what the difference is.',
  }) as const

export const HOME_SPEC: ComponentSpec = {
  component: 'Home',
  version: 1,
  doc: 'The rider’s board: what they can still catch, what they saved, and what is around them.',
  viewModel: {
    module: 'home',
    type: 'HomeSections',
    corpus: 'home.spec.json',
    group: 'homeView',
  },

  // Only the title survives every branch. Everything else — including which sections exist — is a
  // property of the state, which is the point: a section that is absent is absent because there is
  // nothing in it, never because the screen could not find out.
  slots: [
    /**
     * **Where you are** — the floating card, before the board (`proposals/07` Q4, option A).
     *
     * A top-level slot rather than one repeated per state, because it is chrome: it is present in every
     * state that has a position and absent in every state that does not, which is exactly what `when`
     * is for. It is declared *before* the title because that is the order the DOM has it — the card
     * floats over the map and the sheet's heading is inside the sheet.
     */
    {
      name: 'hereAnchor',
      when: 'here.near',
      why: 'No position, or a position with nothing around it. A card naming a place we had not measured to would be claiming a fix we do not have.',
      text: { field: 'here.near' },
      invariant:
        'Composed by the renderer from the catalogue’s `homeNear` and the kernel’s `anchor` — "Near Pak Hoi Street", never a bare stop name. The preposition is the honesty: nothing in the app reverse-geocodes, so the card names the nearest *stop* and must not read as "you are at this stop".',
    },
    {
      name: 'hereFreshness',
      when: 'here',
      why: 'Only with a position — there is nothing to be fresh or stale about otherwise.',
      oneOf: 'here.freshness',
      cases: {
        live: [{ name: 'hereNow', text: { message: 'homeHereNow' } }],
        remembered: [{ name: 'hereRemembered', text: { message: 'lastKnownLocation' } }],
      },
      invariant:
        'ADR-008’s honesty rule applies to the rider’s POSITION, not only to the arrival times — and on this screen it governs the ranking as well, because "saved outranks near" is measured from it. Said here and nowhere else: the card is the one thing on screen that is about the anchor.',
    },
    {
      name: 'title',
      text: { message: 'homeTitle' },
      invariant:
        'Present in every state, including the empty one. A screen that has lost its heading has lost the rider’s place in the app. Since ADR-183 it is the sheet’s own `sr-only` heading rather than a drawn `<h1>`: the card carries the visible identity, and a map-backed screen’s title taking 40 px off the board to repeat the app’s name is a poor trade.',
    },
  ],

  states: {
    /**
     * The ordinary state: a position, a saved list, and stops around the rider.
     */
    content: {
      must: 'The saved section and the nearby section, each under its own heading, each card carrying its saved rows and then its chip strip.',
      mustNot:
        'A reordering of its own, or a section drawn without its heading — the order is `homeView`’s, and an unexplained rank is one the rider has to reverse-engineer.',
      enforcement: {
        shows: [
          FEED_NOTICE,
          // A heading immediately before **its own** cards, which is the shape of the screen and was the
          // shape of a finding: declared as two headings and then one list, the walker reported the first
          // place name where it expected the second heading. A section is a heading and a board, and the
          // spec says so in the order a rider reads them.
          { name: 'savedHeading', text: { message: 'homeSaved' } },
          cardsOf('saved'),
          { name: 'aroundHeading', text: { message: 'homeAround' } },
          cardsOf('nearby'),
        ],
      },
    },

    /**
     * The headline feature: a saved route whose bus can still be made.
     */
    catchable: {
      must: 'A "Catch it" section, leading the board, with the saved places that have something still makeable in them.',
      mustNot:
        'A number for how long the rider has. The band is `arrival − walk`, both inputs are approximations (ADR-008), and printing the difference claims a precision neither has — so a tight one says "leave now" and a comfortable one says nothing at all.',
      why: 'The reason Home is worth building rather than a tidier Nearby: the rider’s own routes, filtered to the ones they can still get to. A bus they can no longer make is NOT in this section — they are never shown a bus they were told they would catch.',
      enforcement: {
        shows: [
          { name: 'catchHeading', text: { message: 'homeCatchIt' } },
          // `leaveNow` is a slot of `StopRow`, because a renderer draws it inside the row it describes —
          // and a `oneOf` there rather than a `when`, because only one of `catch`'s two bands is drawn.
          cardsOf('catch'),
        ],
      },
    },

    /**
     * A fix, and nothing saved. **Content, not an empty state** — this is Favourites' `empty` answered.
     */
    noSaved: {
      must: 'The nearby section, and one line saying what saving a route does.',
      mustNot:
        'An onboarding screen, or a heading with nothing under it. The rider is standing next to six stops; the screen has plenty to show and one thing to explain.',
      why: 'Favourites’ `empty` was an apology on a tab that had nothing else. Here it is a sentence under a full board — which is the merge doing its job, and the reason this spec is shorter than the two it replaces.',
      enforcement: {
        shows: [
          FEED_NOTICE,
          { name: 'aroundHeading', text: { message: 'homeAround' } },
          cardsOf('nearby'),
          {
            name: 'invitation',
            text: { message: 'homeNothingSavedYet' },
            invariant:
              'Under the list, not above it. It is a footnote about what this screen could become, and a rider who has just opened the app wants the stops first — a sentence between the heading and the board would interrupt the one thing they came for.',
          },
        ],
      },
    },

    /**
     * Saved places and no position. **Content, not an apology** — this is Nearby's `undetermined`
     * answered, and it is the owner's office case.
     */
    noPosition: {
      must: 'The saved section in full, and a line saying what turning on location would add — with the control that asks.',
      mustNot:
        'A permission prompt occupying the screen, a nearby section, or any `Catch it` row. Without a fix there is no walk estimate, and a catchability band computed from a position we do not have is exactly the false claim the band exists to avoid.',
      why: 'The rider checking a stop they are deliberately NOT at — before leaving the office. Nothing is wrong: the screen simply cannot rank by distance, and says so once.',
      enforcement: {
        shows: [
          // Before the board, deliberately: they explain why the screen looks the way it does, and an
          // explanation that arrives after the thing it explains has been read is an explanation nobody
          // needed. The `denied` state puts its own copy in the same place for the same reason.
          { name: 'noPositionNote', text: { message: 'homeNoPosition' } },
          { name: 'enableLocation', text: { message: 'enableLocation' } },
          FEED_NOTICE,
          { name: 'savedHeading', text: { message: 'homeSaved' } },
          cardsOf('saved'),
        ],
      },
    },

    /** Location refused. The saved half still shows; only the nearby half is missing. */
    denied: {
      must: 'That location is off, what that costs, and a way to try again — above whatever the rider has saved.',
      mustNot:
        'Telling the rider they refused something they did not. A timeout is not an answer, and the web port reports `canAskAgain: false` regardless, so the copy has to stand on its own.',
      why: 'Distinct from `noPosition`: we asked and were told no, so the control means "try again" rather than "turn it on". The saved list is unaffected either way, which is the difference this board makes.',
      enforcement: {
        shows: [
          { name: 'deniedTitle', text: { message: 'locationDenied' } },
          { name: 'deniedHelp', text: { message: 'locationDeniedHelp' } },
          { name: 'retry', text: { message: 'retry' } },
        ],
      },
    },

    /**
     * No position and nothing saved — a cold install, and **the only genuinely empty state left**.
     */
    cold: {
      must: 'What the app wants location for, and the control that asks for it.',
      mustNot:
        'An empty list, a prompt fired without the rider having asked for one, or a saved section with nothing in it.',
      why: 'The first thing every new rider sees. Six of the seventeen states the two old specs declared collapse into this one, because five of them were a screen describing its ignorance of the other half and this is the case where there genuinely is no other half.',
      enforcement: {
        shows: [
          { name: 'primeTitle', text: { message: 'nearbyPrimeTitle' } },
          { name: 'primeBody', text: { message: 'nearbyPrimeBody' } },
          { name: 'enableLocation', text: { message: 'enableLocation' } },
        ],
      },
    },

    /** A fix, nothing saved, and nothing within the radius. Rare in Hong Kong, and not a bug. */
    empty: {
      must: 'An explicit "no service" line.',
      mustNot:
        'A heading with nothing under it, which cannot be told from a screen that failed to load.',
      enforcement: {
        shows: [FEED_NOTICE, { name: 'noService', text: { message: 'noService' } }],
      },
    },

    loading: {
      must: 'The word "locating", and a skeleton in the shape of the cards beneath it.',
      mustNot:
        'A blank screen, or a spinner with no indication of what is being waited for. Nor a skeleton once a card has arrived: a saved place that has answered is drawn immediately rather than held for its siblings.',
      why: 'Two waits share this state — the fix and the first fetch — and a rider cannot tell them apart, so neither can the copy. **`isPending`, never `isLoading`** (ADR-124): the narrower claim excludes a *parked* fetch, which is exactly when a rider waits longest.',
      enforcement: { shows: [{ name: 'locating', text: { message: 'locating' } }] },
    },

    failed: {
      must: 'The reason the board could not be fetched, verbatim.',
      mustNot:
        'An empty list, or a silent absence — the two states ADR-073 spent a wave separating. Nor the reason in place of cards that DID arrive: a refresh that failed is a board we could not update, not a board we do not have.',
      enforcement: {
        shows: [
          {
            name: 'fetchError',
            text: { field: 'error' },
            invariant:
              'The error’s own message, not a catalogue string: it names which request failed, and inventing a friendlier sentence would discard the only diagnostic a rider could read out.',
          },
        ],
      },
    },

    stale: {
      must: 'The board, with the floating card saying the position is the last known one.',
      mustNot: 'A remembered position presented as a current one.',
      why: 'ADR-008’s honesty rule applies to the rider’s *position*, not only to the arrival times — and on this screen it also governs the ranking, because "saved outranks near" is measured from that position.',
      enforcement: {
        shows: [
          FEED_NOTICE,
          { name: 'savedHeading', text: { message: 'homeSaved' } },
          cardsOf('saved'),
          { name: 'aroundHeading', text: { message: 'homeAround' } },
          cardsOf('nearby'),
        ],
      },
    },

    offline: {
      must: 'The last known board, on the remembered position, under the line that says the rider’s own network is gone.',
      mustNot:
        'A blank list, a fresh-looking arrival time, or the same sentence as `stale` — a rider whose network is down can act on that, and one whose fix is old cannot.',
      enforcement: {
        shows: [
          FEED_NOTICE,
          { name: 'savedHeading', text: { message: 'homeSaved' } },
          cardsOf('saved'),
          { name: 'aroundHeading', text: { message: 'homeAround' } },
          cardsOf('nearby'),
        ],
      },
    },
  },

  interactions: [
    {
      target: 'savedCards',
      goes: 'StopRow’s own targets — place detail from a card’s heading, and the route from a row. A chip in the strip beneath goes to the same place a saved row does, which is why the strip is a new *source* of this navigation rather than a new destination.',
      note: 'Declared once, in `StopRow`’s spec. A screen that named the same destinations again would be a second declaration of them.',
    },
  ],

  a11y: {
    role: 'list of sections, each a list of places',
    name: { fromSlot: 'title' },
    reducedMotion:
      'Nothing moves on this screen except the strip’s expansion, which is a height change and is instant under reduced motion. The board itself re-renders when a round lands and never animates between orders — a card sliding to a new rank would be the screen drawing attention to an approximation (ADR-008).',
  },

  idiom: [
    'how a refresh is offered — pull-to-refresh on the platform with a natural gesture for it, nothing on the web: the arrivals arrive by subscription at the served cadence, so a manual refresh is reassurance rather than how a rider gets fresh data',
    'whether the collapsed chip strip is one line or two — a measurement of the viewport, not a rule about the data',
    'material and elevation of the list surface, and the divider between cards',
    'the skeleton’s shape and whether it shimmers',
    'how the section headings stick, or whether they stick at all',
  ],
}
