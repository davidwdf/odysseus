import type { ComponentSpec, SlotNode } from '@nextbus/ui-spec'

/**
 * **The Route screen** (WP6-6b) — the vertical schematic, its bus tokens, and the twenty states it can be
 * in. The row `proposals/04` calls *"the motion test — the first screen where 'motion is idiom' is a real
 * claim rather than a slogan"*.
 *
 * ## What the motion test actually answered
 *
 * WP6-5b established that a spec should not try to hold an interaction (ADR-092). Motion is the same
 * question one step further in, and the answer here is narrower and more useful than *"motion is idiom"*:
 *
 * > **Motion is idiom; what the motion is about is not.** A bus token slides down the rail from the origin
 * > on mount, tweens to a new position when a round arrives, and bobs on the spot in between. Every one of
 * > those is curve, duration and physics — the idiom side of ADR-075's table. What is **identity** is
 * > *which node the token is at*, and that is `routeDetailView.buses`: `{kind:'node', index}` or
 * > `{kind:'segment', from, to}` (ADR-093). One renderer may animate the move over 650 ms and another may
 * > cut to it; neither may disagree about the stop.
 *
 * A sheet the strip opens is a **separate surface** and is deliberately not a state of this spec: its content
 * is `routeFactSheet`'s, pinned by 15 corpus cases (ADR-095), and both renderers are projections of it. What
 * this spec holds about the sheets is one thing — that the pill which opens one is a control, and that the
 * strip's own text does not change according to whether the affordance exists.
 *
 * The same line settles the two the plan asked about by name. **The collapsing header** is idiom in its
 * *behaviour* and identity in its *content*: it says the route number and both ends of the journey, at
 * whatever size its platform gives it. **The auto-scroll** is idiom in the strongest sense — the DOM screen
 * scrolls the document with `scroll-margin-top` and needs no scroll code at all, where the RN screen owns a
 * measured offset and a reveal gate (which `docs/07` records as broken on web).
 *
 * ## The finding this spec produced by being unable to look at something
 *
 * A spec's vocabulary is **text** (ADR-083). A bus token is a disc with a glyph in it, so the conformance
 * walker cannot see one at all — and the tempting conclusion is that the tokens are `unenforced`. The honest
 * one is that a graphic carrying information a rider acts on needs an **accessible name**, which ADR-075's
 * own table puts on the identity side (*"every element's role and its label content"*). `BusToken` had none:
 * no label, `pointerEvents: 'none'`, and the screen's signature element silently invisible to a screen
 * reader. So `RailBus.label` is the kernel's, the tokens are projected through it, and the same edit that
 * made them checkable closed an accessibility hole nobody had reported (ADR-093 decision 3).
 *
 * ## Where the header's three journey strings are pinned, and why not here
 *
 * `routeDetailView.header` carries **three** compositions — `origin`, `destination`, and the `label` /
 * `collapsedLabel` pair that joins them with an arrow. All four are corpus-pinned. Only the first two are
 * projected, because the two composed ones are *chrome at a particular size*: `apps/mobile` cross-fades
 * between them inside a collapsing header, and `apps/web` puts the resting one in `document.title` and has
 * no collapsed size at all. Declaring them as slots would fail whichever renderer's chrome did not happen to
 * draw both. Each suite therefore asserts the narrower thing directly — that every journey string the header
 * renders is one the kernel produced — which is the same shape as `Search`'s per-suite `enabled` assertion
 * (ADR-092): *the spec holds what both must show; a suite holds what only one can see.*
 */

/** The static-facts strip — every loaded state shows it, and one shows it empty. */
const FACTS: SlotNode = {
  name: 'facts',
  each: 'facts',
  of: [
    {
      name: 'factValue',
      text: { field: 'value' },
      invariant:
        'Printed **verbatim**, and the strip is the pills the model hands over — in its order, with nothing added. Which facts exist, the fare’s fallback from a sectional span to the origin’s full fare, and the omission of the whole-route journey time were all inside `RouteMeta.tsx` until WP6-6a (ADR-093 decision 10). A route whose dataset carries no service block gets **no strip at all** rather than four pills reading "—".',
    },
    {
      name: 'factNoteSeparator',
      text: {
        literal: '·',
        why: 'The renderer’s glyph between a fare and its holiday qualifier, in its own node — React emits an expression and an adjacent literal as separate text nodes (ADR-092), so this is what the RN strip already produces and what the projection can therefore see. What it pins is the **order**: the fare, then the separator, then the qualifier.',
      },
      when: 'note',
      why: 'There is no qualifier to separate. Upstream publishes a holiday fare only where it differs.',
    },
    {
      name: 'factNote',
      text: { field: 'note' },
      when: 'note',
      why: 'Only where upstream published a holiday fare that differs from the ordinary one.',
      invariant:
        'A **note on the fare pill, never a pill of its own** — it qualifies the fare rather than standing beside it as a fifth fact. The qualifier word is the catalogue’s and the `$` is the kernel’s.',
    },
  ],
}

/** One stop on the schematic. Used by every state that draws the list, which is most of them. */
const STOP_ROWS: SlotNode = {
  name: 'stops',
  each: 'stops',
  of: [
    {
      name: 'seq',
      text: { field: 'seq' },
      invariant:
        'The stop’s **1-based position on the route**, as the wire numbers it — not the row’s index. They agree today and a payload that skipped a sequence number would make them differ, at which point the node a bus is drawn beside and the number printed in it would disagree.',
    },
    {
      name: 'stopName',
      text: { field: 'name.label' },
      invariant:
        'Title-cased with its printed code split off by `displayName`, never by the renderer (ADR-034). This is also the string the tapped-stop sheet is titled with — the screen used to compute that separately as `titleCaseName(splitStopCode(…).label)`, eleven lines away, which is one answer written twice (ADR-093 decision 11).',
    },
    {
      name: 'stopCode',
      text: { field: 'name.code' },
      when: 'name.code',
      why: 'A stop whose upstream name carries no parenthetical — common for GMB poles, and for a Citybus stop whose name is a plain place.',
      invariant:
        'What is printed on the physical flag, which is what a rider standing at the kerb is matching against. Latin letters and digits, so it is the same string in every locale — **except** where the parenthetical is a translated place phrase rather than a code, which `splitStopCode` cannot tell apart and does not try to: it understands ASCII parentheses only, so an English `CENTRAL (EXCHANGE SQUARE)` splits and a Chinese `中環（交易廣場）` does not. Pinned in `stop-name.spec.json`, and both renderers must reproduce it identically.',
    },
    {
      name: 'stopFare',
      text: { field: 'fareLabel' },
      when: 'fareLabel',
      why: 'The dataset carries no boarding fare for this stop — usually the last one, where boarding is not possible.',
      invariant:
        'The **printed** fare, `$` and all, from `formatFare` in the kernel. `fare` beside it is the raw decimal the fare-stage timeline compares and is deliberately not what is drawn: a projection reading it would expect `18.9` where every renderer draws `$18.9`.',
    },
    {
      name: 'stopIncomplete',
      text: { message: 'etasUnavailable' },
      when: 'incomplete',
      why: 'Nothing refused. Absent on every payload the server builds — a route is fetched in one upstream call — and present only where a **live route watch** asked this kerb separately and it would not answer (ADR-116).',
      invariant:
        'The same sentence the screen-level `noLiveBoard` line uses, on the row it is true of. It is what stops an empty row reading as *no bus is due*: `liveArrivals` cannot express "38 of 41 answered" without being wrong about most of the route, and a rider standing at the one kerb that refused is the person who most needs to know. Muted, never a warning colour, for the same reason the screen-level line is: nothing is wrong with the route.',
    },
    {
      name: 'stopArrivals',
      each: 'arrivals',
      of: [
        {
          name: 'arrival',
          oneOf: 'label.kind',
          cases: {
            mins: [
              { name: 'arrivalValue', text: { field: 'label.value' } },
              {
                name: 'arrivalUnit',
                text: { field: 'label.unit' },
                invariant:
                  'The unit rides **every** numeric slot, so the row reads "12 min  27 min  42 min" rather than "12  27  42 min". It is a separate node because the two are styled differently — the figure is tabular and emphasised on the first slot, the unit is muted — which is also why they are two fields on the model.',
              },
            ],
            due: [
              {
                name: 'arrivalDue',
                text: { field: 'label.label' },
                invariant:
                  'Under a minute the app prints a **word**, never a fabricated sub-minute number (ADR-008), and the band is the served `dueUnderSec` rather than a compiled-in 60 — the corpus row `a-served-policy-caps-the-arrivals-and-moves-the-due-band-with-them` exists to catch a port that honours the cap and keeps the band.',
              },
            ],
            headway: [
              {
                name: 'arrivalHeadway',
                text: { field: 'label.text' },
                invariant:
                  'Unreachable on this screen and declared anyway, because the union carries the arm: `upcoming` yields arrivals and a published frequency is not one. Declared rather than omitted so that a renderer falling through to the dash — losing a real sentence — is a spec failure rather than a silent one. The screen-level equivalent is the facts strip’s `freq` pill.',
              },
            ],
            departed: [
              {
                name: 'arrivalDeparted',
                text: {
                  literal: '—',
                  why: 'The em dash a renderer draws where there is nothing to count down. Also unreachable here — `upcoming` filters departed readings out before they reach a row — and declared for the same reason as `headway`.',
                },
              },
            ],
            none: [
              {
                name: 'arrivalNone',
                text: {
                  literal: '—',
                  why: 'As `departed`: the same dash, and the arm a row reaches by having no reading at all rather than a spent one. A row with no arrivals shows **nothing** on its right, which is a different thing again — see the `noReading` state.',
                },
              },
            ],
          },
        },
      ],
      invariant:
        'Up to the served `maxArrivals`, soonest first, in the **feed’s** order rather than one we impose: the operators publish soonest-first and `arrivals[0]` is what the bus inference reads, so sorting here would hide a feed that had stopped doing that from the one place a rider would notice.',
    },
  ],
}

/** The buses on the rail, read through their accessible names — see the note at the top of this file. */
const RAIL_BUSES: SlotNode = {
  name: 'buses',
  each: 'buses',
  of: [
    {
      name: 'busLabel',
      text: { field: 'label' },
      invariant:
        'The token’s **accessible name**, composed by the kernel from injected words — *"Bus at X"* for one standing at a stop, *"Bus approaching X"* for one on the segment leading into it. Two sentences rather than one with a degree, because a bus at a stop is one a rider standing there can board. Neither says a distance or a fraction of a segment: the token sits at a midpoint because that is the only position the data supports (ADR-030, no polylines upstream), so *"halfway to X"* would assert precision the pixel does not have (ADR-008).',
    },
  ],
  invariant:
    'One per bus the model says is on the rail, in **route order**, and the order is the model’s: `visibleBusMarkers` has already dropped a bus still parked at the origin (ADR-008 — a permanent token at a terminus reads as a bus a rider could catch), and `railBus` has already decided node-or-segment. A renderer that drew a token per *stop with a reading* would draw one for every stop on the route.',
}

export const ROUTE_DETAIL_SPEC: ComponentSpec = {
  component: 'RouteDetail',
  version: 1,
  doc: 'A route as a vertical schematic: every stop in sequence with its arrivals and boarding fare, the buses inferred to be on it, and the static service facts.',
  viewModel: {
    module: 'route-detail',
    type: 'RouteDetailView',
    corpus: 'route-detail.spec.json',
    group: 'routeDetailView',
  },

  slots: [
    {
      name: 'routeNo',
      text: { field: 'header.routeNo' },
      when: 'header.routeNo',
      why: 'Nothing has loaded yet. The chrome draws its back control before the route has a number — deliberately, so a rider can leave a screen that is still loading — and there is nothing else to put here that would not be invented.',
      invariant:
        'The number on the bus, verbatim from the wire. **Where it appears in the tree is idiom and where it appears on screen is not:** `apps/mobile` floats a collapsing header over its scroll content and therefore renders it last; `apps/web` puts it first, in flow, where a keyboard and a screen reader meet it. Each driver reads its own chrome first for that reason and says so.',
    },
    {
      name: 'origin',
      text: { field: 'header.origin' },
      when: 'header.origin',
      why: 'A payload with neither a stop sequence nor route labels — which is what an empty route document looks like. The header states nothing rather than guessing.',
      invariant:
        'The **stop list’s** own first name where the sequence has loaded, and the route’s abbreviated label only until then: upstream shortens its own labels to fit an LED sign, so "CENTRAL" is what the route calls an end and "Central (Exchange Square)" is what the stop is called. Composed by `routeTerminusNames`, so a renderer never chooses between them.',
    },
    {
      name: 'destination',
      text: { field: 'header.destination' },
      when: 'header.destination',
      why: 'As `origin` — an empty payload has no far end to name.',
      invariant:
        'A **finished sentence**, which is the part a renderer must not re-decide: for an ordinary route it is the last stop’s name, and for a loop it is the caller’s "Circular via …" line, because a circular service has no second terminus and a faithful "A → A" tells a rider nothing (ADR-046). The kernel picks the place; the catalogue owns the words around it (ADR-054).',
    },
  ],

  states: {
    /** The ordinary route: a strip of facts and a list of stops with their times. */
    content: {
      must: 'The route number, both ends of the journey, the facts strip, and one row per stop in sequence with its printed code, its boarding fare and its upcoming times.',
      mustNot:
        'A row for a stop the route does not call at, or a sequence number that is the row’s index rather than the wire’s. A rider counts stops to know when to get off.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * **A route whose times arrived over a live watch** — the state this whole feature exists to reach
     * (ADR-116/119, proposals/05).
     *
     * Citybus and GMB publish no bulk route-eta feed, so `noLiveBoard` above is what a rider saw on those
     * routes for two waves: a complete schematic with no times anywhere and one line explaining why. A
     * `/v1/live?route=` subscription asks each of the route's 13–41 poles separately and pushes what it
     * finds, and `applyLiveEtasToRouteDetail` merges that back onto the payload — which is why this state's
     * projection is `content`'s and **not** `noLiveBoard`'s: the explanation is gone, because there is
     * nothing left to explain.
     *
     * What makes it a state of its own rather than the same one is the two things it pins that no other
     * fixture can: that the notice **disappears** when readings arrive (a renderer that kept drawing it
     * would contradict the times beside it), and that a kerb the round could not ask about says so **on its
     * own row**. Both are reachable only from a payload a live round produced.
     *
     * `apps/mobile` does not subscribe (ADR-113 owes the reference renderer no new affordance) and can still
     * be put in this state, because a driver owns *how* it gets there — here, by being handed the payload a
     * round would have produced. The spec owns what must be there.
     */
    liveRouteTimes: {
      must: 'Times on the rows the round answered, no screen-level explanation at all, and the sentence on any row whose kerb would not answer.',
      mustNot:
        'Keeping the "live times unavailable" line above rows that now show minutes — the screen contradicting itself — or leaving a refused kerb looking like a stop with no bus due, which is the ADR-073 confusion one level down from where ADR-114 fixed it.',
      why: 'Most routes are KMB, whose bulk feed answers, so most of the time no subscription is wanted and this state is never entered.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * Opened from a place, so one row is the stop the rider is standing at.
     *
     * The projection cannot see the emphasis — it is a colour and a fill — so what this state pins is that
     * **the anchor changes nothing about what is shown**. That is worth a state rather than being obvious: a
     * screen that scrolled to a row could plausibly also filter to it, or drop the rows above it, and both
     * would look reasonable in a screenshot of the middle of a long route.
     */
    anchored: {
      must: 'Every row, in full, with the boarding row emphasised and scrolled to.',
      mustNot:
        'A shorter list. The rows before the boarding stop are how a rider checks they are waiting on the right side of the road.',
      why: '`hereIndex` and each row’s own `here` are one answer from one call, so the row that is highlighted and the row that is scrolled to cannot differ — which is a bug that looks like a scroll bug and is not (ADR-093 decision 8). A corpus property asserts they agree on every case.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * The rider flipped direction, so the anchor is **gone** — and the list is the other bound's.
     *
     * Declared because dropping the anchor is a decision rather than a side effect: the reverse serves the
     * opposite kerbs, so the stop the rider arrived at belongs to the direction they left.
     */
    flipped: {
      must: 'The reverse direction’s stops, with no row emphasised and nothing scrolled to.',
      mustNot:
        'A row still marked as the rider’s boarding stop. A terminus is often one pole for both bounds, so the id can still match — which is exactly why `flipped` is an argument and not something to infer.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A loop: one journey line and no direction toggle. */
    circular: {
      must: 'A single "Circular via …" line as the far end, and no way to reverse.',
      mustNot:
        'An arrow pointing at the loop line, which reads as travelling *to* the loop rather than around it — nor "A → A", which is faithful and tells a rider nothing (ADR-046).',
      why: 'HK operators carry the loop marker in the destination **name** ("TAI KOK TSUI (CIRCULAR)"), read from the **English** field whatever the display locale because it is the one field the three feeds spell consistently. Upstream ships GMB circulars with a blank `en`, so that is an exposure rather than a tidy assumption, and the corpus pins what a rider then sees.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A bus standing at the origin, nearly leaving. */
    busAtOrigin: {
      must: 'One token, named for the first stop, standing **on** its node.',
      mustNot:
        'A token drawn on a segment leading into the first stop. There is no such segment — stop 0 has nothing before it — so a renderer that treated every bus the same would place it at an offset it cannot compute.',
      why: 'Two rules composed, and the composition is what a renderer cannot be trusted with: the bus earns a token at all only because it is within two minutes of departing (`ORIGIN_BUS_DEPARTS_WITHIN_SEC` — otherwise it is furniture parked permanently at every terminus, reading as a bus a rider could catch), and it is drawn on the node because the origin has no approach.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A bus between two stops — the common case, and what the schematic exists for. */
    busMidRoute: {
      must: 'A token per inferred bus, each named for the stop it is approaching.',
      mustNot:
        'A token per stop with a reading. Every stop ahead of a bus reports it, so that would draw the same bus a dozen times — which is what `inferBusMarkers`’ drop-off detection exists to prevent.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A bus inside the "Due" band, at the stop rather than approaching it. */
    busAtStop: {
      must: 'A token named for the stop it is **at**, on that stop’s node.',
      mustNot:
        'The approaching sentence, when the row beside it says the bus is due. The token and the word are the same judgement and read the same `dueUnderSec`.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * A route with readings and **no** tokens — because the only bus is parked at the terminus.
     *
     * The state that makes the suppression visible. Without it a renderer that drew nothing at all would pass
     * every other bus state by drawing one token where one was expected.
     */
    emptyRail: {
      must: 'The rows and their times, with nothing on the rail.',
      mustNot:
        'A token at the origin for a bus that is not nearly leaving — and equally, no row hidden because the rail is empty. The times and the tokens are two readings of one payload and only one of them is suppressed.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A row the rider has saved this route at. */
    savedStop: {
      must: 'Every row, with the saved one flagged — and only that one.',
      mustNot:
        'A flag on every row of a saved route. A favourite is a route **at a pole** (ADR-042), so starring the line everywhere claims the rider saved a dozen stops, and the Favourites tab would list one.',
      why: 'The key is `formatFavoriteRouteKey`’s and is built from the row’s **raw** pole id — the same id `?pole=` carries and the same one `favouritesView` reads back. A corpus property reconstructs it rather than trusting the flag.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * A stop with no reading at all: a name, a fare, and nothing on its right.
     *
     * The one place this screen may draw a row with nothing under it, and it is worth saying why, because
     * `StopRow`'s spec has forbidden exactly that shape since WP6-1. A compact card is one place among many
     * and a blank right-hand side cannot be told from a broken favourite key; a row on a schematic is one
     * stop among a route's own, under a numbered node, in a list a rider is reading in order. Absence here
     * says *"no bus reported for this stop"*, which is a fact — not an ambiguity.
     */
    noReading: {
      must: 'The row, with its number, its name, its code and its fare.',
      mustNot:
        'A dash, a spinner, or the row omitted. A stop with no reading is still a stop the bus calls at, and dropping it would silently shorten the route.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A board old enough to say so. */
    stale: {
      must: 'The readings we have, dimmed, with the fresh rows beside them undimmed.',
      mustNot:
        'Colour alone (ADR-008), or a whole-screen staleness banner. Staleness is the **board’s** — one `dataTimestamp` per stop — so one row can be old while the next is current, and a screen-level cue would be wrong about both.',
      why: 'The projection cannot see opacity, so what it pins is that a stale row shows the **same text** as a fresh one: the value does not change, because a reading only changes when a fresh one arrives, and there is no client-side countdown. That is the honest half of the assertion, and each suite asserts the dimming itself.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** A service block with only some of its facts. */
    sparseFacts: {
      must: 'A pill for each fact the dataset carries, and none for the rest.',
      mustNot:
        'A pill reading "—" or a fixed four-pill row. The Static tier shows what the open data says and nothing else (ADR-036); a placeholder claims a fact we do not have.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * A holiday fare, which qualifies the ordinary one rather than standing beside it.
     *
     * Its own state because it is the only place in this spec where a `when`-gated **literal** sits between
     * two fields, and the order of those three is the whole content of the claim: the fare, the separator,
     * the qualifier. A renderer that put the note first, or dropped the separator into the same text node as
     * the note, would draw something plausible.
     */
    holidayFare: {
      must: 'The fare pill, then a separator, then the holiday fare — inside the one pill.',
      mustNot:
        'A fifth pill. A holiday fare is not a fact beside the fare; it is the same fact on a different day, and a strip that listed it separately would read as two fares in force at once.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /** No service block at all — a real state, and the one where the list is the whole screen. */
    noFacts: {
      must: 'The list, with no strip above it.',
      mustNot:
        'An empty strip holding space. It is the schematic’s first sibling, so an empty one shifts every measured row offset for no content.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    /**
     * A route document with no stop sequence.
     *
     * The canonical `empty`, and it is a real payload rather than a defensive branch: the dataset carries
     * routes with no sequence, and it is also the first paint after a cold open where the route has arrived
     * and its stops have not.
     */
    empty: {
      must: 'The route number and both ends from the route’s **own** labels, and no stop-count pill.',
      mustNot:
        'An empty header, or a "0 stops" pill. A route length of zero is a broken payload and printing it as a fact states something we do not believe.',
      enforcement: { shows: [FACTS, STOP_ROWS, RAIL_BUSES] },
    },

    loading: {
      must: 'A skeleton in the shape of the list, and nothing claimed.',
      mustNot:
        'A blank screen. The arms are ordered so that "we have no answer" is the **fallback**, because `isLoading` is `isPending && isFetching` and a paused retry matches neither the loading nor the error arm — which left Place detail rendering nothing at all, for ever, on both renderers (ADR-088).',
      why: 'Its declared projection is *no text*, which is right — nothing is known — and is also exactly what a screen that renders **nothing** produces. So each suite asserts the skeleton as an **element**, which is the only observable difference between the two.',
      enforcement: { shows: [] },
    },

    failed: {
      must: 'The reason the route could not be fetched, verbatim.',
      mustNot:
        'An empty schematic, and not a blank screen. A route view with no stops reads as a route that does not exist rather than a request that did not answer (ADR-073).',
      enforcement: { shows: [{ name: 'fetchError', text: { field: 'error' } }] },
    },

    /**
     * **A route whose operator publishes no route-level board** — enforced since ADR-114, `knownDefect`
     * before it.
     *
     * `/v1/route/:id` fetches live arrivals for KMB and LWB only: Citybus has no bulk route-eta endpoint
     * (ADR-021) and GMB is not wired. So on a CTB or GMB route **every** row carries no reading, for ever,
     * and both renderers drew exactly what a route with nothing currently due draws — a rider could not tell
     * a route the app never asks about from a route with no buses coming.
     *
     * What made it unenforceable was that the wire said nothing, so the view had nothing to expose. It says
     * `liveArrivals` now, and note what shape it is **not**: not the `EtaFailure[]` ADR-077 gave
     * `/v1/nearby` and `/v1/stop`. A route is fetched in one upstream call, so naming 34 poles would invent a
     * granularity the fetch does not have — which is also why `must` says *once for the screen*.
     *
     * The sentence is `etasUnavailable`, the one `StopRow` already uses, and it is honest but not the best
     * this could be: these operators' **per-pole** boards do answer, so the times a rider wants are one tap
     * away on any stop. Saying so needs a string of its own and is the owner's call, not this file's.
     */
    noLiveBoard: {
      must: 'One line saying live times are unavailable for this route — once for the screen, not per row.',
      mustNot:
        'Reading as "no bus is due at any stop", which is what both renderers drew until ADR-114. It is the arrivals-path failure ADR-073 is named for, arriving through an operator that was never asked.',
      why: 'Most routes are KMB, whose route-level feed does answer — so most of the time there is nothing to say and saying it anyway would be noise on the screen a rider uses most.',
      enforcement: {
        shows: [
          FACTS,
          {
            name: 'noLiveBoard',
            text: { message: 'etasUnavailable' },
            why: 'The operator publishes a route-level feed and it answered, so the readings on the schematic are the whole truth.',
            invariant:
              'Once, above the schematic — not per row. A rider cannot act on *which* rows, and 34 copies of one sentence is not more honest than one. Never a warning colour: nothing is wrong with the route, and nothing about it will change if they wait.',
          },
          STOP_ROWS,
        ],
      },
    },

    /**
     * **A round that did not answer**, which is the same silence for a different reason — and the reason
     * this is a second state rather than a second sentence in the one above.
     *
     * `/v1/route/:id` wraps the KMB route-eta fetch in a catch, deliberately: a route view without live
     * times is still a route view, because the stop list, the geometry and the fares are all static and
     * erroring the screen would lose them (ADR-073). What the catch also did, until ADR-114, was make an
     * upstream outage indistinguishable from a quiet route — **on KMB, where nearly every rider is.**
     *
     * It shows the same line as `noLiveBoard` today and it is not the same fact: this one is worth retrying
     * and that one never will be. Two states, one sentence, so that giving either its own words later is an
     * edit to one `shows` and to nothing else.
     */
    arrivalsUnavailable: {
      must: 'One line saying live times are unavailable, above an otherwise complete schematic.',
      mustNot:
        'Losing the static half. The stops, the fares and the facts strip did not fail and are the reason the fetch is caught rather than thrown — a screen that dropped them would be a worse answer than the one the failure allows.',
      why: 'The round answered, which is the ordinary case.',
      enforcement: {
        shows: [
          FACTS,
          {
            name: 'arrivalsUnavailable',
            text: { message: 'etasUnavailable' },
            why: 'The round answered, so the readings are complete and there is nothing to say about them.',
            invariant:
              'The same line, in the same place, as `noLiveBoard` — a rider is told what they can act on (no live times here) and not which of our two reasons produced it.',
          },
          STOP_ROWS,
        ],
      },
    },

    offline: {
      must: 'The whole screen, from the cached payload, with its readings dimmed.',
      mustNot:
        'A blank screen or an error, when a usable route payload is sitting in the persisted query cache. The stop sequence, the fares and the facts are static and do not go out of date offline.',
      why: 'The half that *is* checkable is `stale`, and it is: an offline screen is a stale screen whose refetch never lands, so the text is identical and the dimming is the same rule. What is not observable at this layer is the **cause** — a suite cannot tell a reading that aged from a network that stopped. ADR-058’s own coverage asserts the cache path where a cold start is measurable.',
      enforcement: {
        unenforced:
          'Textually identical to `stale` by construction, which is the point: a rider offline sees the last thing we knew, labelled as old. Asserting it here would be asserting `stale` twice.',
      },
    },
  },

  interactions: [
    {
      target: 'routeNo',
      goes: 'the top of the list',
      note: 'Tapping the header chrome scrolls to the top — a position, not a destination, which is why `goes` names one.',
    },
    {
      target: 'stopName',
      goes: 'a sheet offering to save this route at this stop, or to open the stop’s place',
      note: 'Deliberately **not** straight to the place: the row’s primary purpose is saving the route at that pole (ADR-042), and a tap that navigated away would make the common action the harder one.',
    },
    {
      target: 'factValue',
      goes: 'that fact’s detail — the fare-stage timeline, the frequency bands, the service hours, or the route overview (ADR-044)',
      note: 'It was `optional: true` for exactly one commit, while `apps/web` drew the strip as inert pills and `RouteFactSheets.tsx` still derived its own content. WP6-6c closed that (ADR-095): the four sheets are `routeFactSheet`’s, both renderers project them, and the pill is a control on both. **What `optional` bought in the meantime is worth keeping in mind** — it made the missing affordance a declaration rather than a silence, and it made the walker require the *text* to be identical either way, which is ADR-069’s overflow rule applied to a whole surface.',
    },
    {
      target: 'buses',
      goes: 'nowhere — it is not a control',
      optional: true,
      note: 'Named here so its `optional: true` is a *declaration* rather than an omission: the token is read by a screen reader and never focused, which is why it carries a role and a name but no handler. `pointerEvents` is `none` on both renderers.',
    },
  ],

  a11y: {
    role: 'a route’s stop sequence: a list of stops in order, each with its position, its name and its upcoming arrivals, overlaid with named markers for the buses on it',
    name: { fromSlot: 'routeNo' },
    reducedMotion:
      'Everything that moves here is decoration over a resting state that is already legible, and each piece honours the setting independently: the bus token’s slide-in from the origin and its tween to a new position become cuts, its idle bob stops, the direction-flip cascade does not stagger, and the auto-scroll to the boarding stop is instant rather than smooth. The **content is identical** without any of it — which is the claim, and it is checkable because the projection never sees a transform.',
  },

  idiom: [
    '**every curve, duration and physic of the bus token** — the 650 ms tween to a new position, the 550 ms bob, the 2 200 ms rock, the fade-in from the origin. What is *not* idiom is which node it is at, which is why the model says `{kind:"node", index}` or `{kind:"segment", from, to}` and never a pixel (ADR-093)',
    '**whether the header collapses at all** — `apps/mobile` cross-fades a full journey card into a one-line pill on scroll and therefore needs both composed labels; `apps/web` has one size and puts the resting label in `document.title`',
    '**how the boarding stop is reached** — the RN screen measures each row and scrolls to a computed offset as ADR-043’s deliberate second beat; the DOM screen sets `scroll-margin-top` and lets the browser do it, which also means it honours reduced motion without owning the decision',
    '**the direction flip** — a local state swap with a staggered re-entry cascade on `apps/mobile`, a navigation on `apps/web`, because a URL that names a direction is a URL a rider can share',
    'the rail itself: a 52 px gutter with a 2 px line and a 28 px node here, whatever a platform’s list idiom is elsewhere',
    'the saved-stop flag: a bordered star pinned to the node’s corner here, drawn above the tokens so a passing bus cannot hide a favourite',
    'the skeleton’s shape and whether it shimmers',
    'which glyph denotes each static fact — the *concepts* are shared and the icon **set** is not (ADR-075)',
  ],
}
