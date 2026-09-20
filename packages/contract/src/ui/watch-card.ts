import type { ComponentSpec } from '@nextbus/ui-spec'

/**
 * **The watch card** — what the pill becomes when it is tapped (`proposals/07`, round 3's C2).
 *
 * The same view model as `WatchPill`, projected further: one board cannot be two boards, and a card that
 * fetched anything of its own would be able to disagree with the pill it grew out of about which bus is
 * next. So both specs name `watch#watchView`, and the difference between them is which slots each draws.
 *
 * ## What the card adds, and the argument for each
 *
 *  · **The rest of the board.** The pill has room for the lead figure; the card is where *"then 11 · 24"*
 *    lives. That split is the answer to round 3's A4, which tried to put the second figure on the pill and
 *    cost the stop's name to do it.
 *  · **The freshness sentence**, from `feedNotice` — the same words on the same rule as Nearby, Place,
 *    Favourites and Route (ADR-133/150). This is why `WatchPill` declares its `stale` state `unenforced`:
 *    the sentence exists once, here, because a board has one age.
 *  · **The stand and direction** (ADR-080), which is genuinely useful while walking to a pole and is the
 *    line the pill's second line no longer carries since *"2 stops away"* was withdrawn (§4c).
 *  · **"Leave in N min"** — `proposals/00`'s P13, finally answerable because a watch names the stop the
 *    rider is heading for. Absent whenever the kernel says so, which includes the case that matters: a bus
 *    that cannot be caught produces no line at all rather than a reassuring zero.
 *
 * ## What it does NOT add
 *
 * **The sub-line.** `subLine` is the collapsed pill's one line; repeating it here would put two spellings
 * of *offline* in one open card, which is the per-screen duplication ADR-123 removed from the arrival rows.
 * The card says the same facts at their proper size: the freshness sentence for offline and staleness, the
 * readout itself for a refusal or a quiet stop.
 */
export const WATCH_CARD_SPEC: ComponentSpec = {
  component: 'WatchCard',
  version: 1,
  doc: 'The expanded watch: the whole board for one route at one pole, plus when to leave for it.',
  viewModel: {
    module: 'watch',
    type: 'WatchView',
    corpus: 'watch.spec.json',
    group: 'watchView',
  },

  slots: [
    { name: 'routeNo', text: { field: 'routeNo' } },
    {
      name: 'stopName',
      text: { field: 'stop.label' },
      invariant:
        "`displayName`'s, so the card and the pill it grew from cannot spell one pole two ways.",
    },
    {
      name: 'stopCode',
      text: { field: 'stop.code' },
      when: 'stop.code',
      why: 'A pole whose upstream name carries no printed flag code.',
    },
    {
      name: 'destinationArrow',
      text: {
        literal: '→',
        why: 'The renderer supplies the glyph, the kernel the destination — as everywhere else in the app.',
      },
    },
    {
      name: 'destination',
      text: { field: 'destination' },
      invariant:
        'Unconditional here, unlike on the pill: the card has the width, so the destination is never displaced by a sentence and a rider always knows which direction they are watching.',
    },
    {
      name: 'board',
      oneOf: 'readout.kind',
      cases: {
        pending: [],
        reading: [
          {
            name: 'lead',
            oneOf: 'readout.lead.label.kind',
            cases: {
              mins: [
                { name: 'leadValue', text: { field: 'readout.lead.label.value' } },
                { name: 'leadUnit', text: { field: 'readout.lead.label.unit' } },
              ],
              due: [{ name: 'leadDue', text: { field: 'readout.lead.label.label' } }],
              departed: [],
              headway: [{ name: 'leadHeadway', text: { field: 'readout.lead.label.text' } }],
              none: [],
            },
          },
          {
            name: 'rest',
            each: 'readout.rest',
            of: [
              {
                name: 'restReading',
                oneOf: 'label.kind',
                cases: {
                  mins: [
                    { name: 'restValue', text: { field: 'label.value' } },
                    { name: 'restUnit', text: { field: 'label.unit' } },
                  ],
                  due: [{ name: 'restDue', text: { field: 'label.label' } }],
                  departed: [],
                  headway: [{ name: 'restHeadway', text: { field: 'label.text' } }],
                  none: [],
                },
              },
            ],
            invariant:
              'Quieter than the lead and in feed order, never re-sorted: the operators publish soonest-first and the whole app reads `arrivals[0]` as the next bus, so a card that sorted would hide a feed that had stopped doing that from the one place a rider would notice.',
          },
        ],
        unavailable: [{ name: 'boardUnavailable', text: { message: 'etasUnavailable' } }],
        noService: [{ name: 'boardNoService', text: { message: 'noService' } }],
      },
      invariant:
        "The four arms in ADR-088's order, and the card draws the sentence at full size where the pill could only manage a dash. `readout.rest` is capped by the served `ClientPolicy.maxArrivals` before it gets here (ADR-053) — a card that sliced again would be a second answer to a served question.",
    },
    {
      name: 'stand',
      text: { field: 'stand' },
      when: 'stand',
      why: 'A lone pole has no second kerb to be told apart from, so there is nothing to say (ADR-080).',
      invariant:
        "Captured with the watch, in the rider's language, and never re-derived here — the sentence is the one the screen that created the watch was already showing.",
    },
    {
      name: 'leave',
      when: 'leave',
      why: 'No location fix, no reading, or a bus the rider cannot catch — three absences the kernel decides, and the third is the one that matters: flooring at zero would print "leave now" to someone who cannot make it.',
      oneOf: 'leave.leaveInMin',
      cases: {
        '0': [{ name: 'leaveNow', text: { message: 'watchLeaveNow' } }],
      },
      invariant:
        '**A `oneOf` over a number with one case is deliberate and it is a live trap.** Zero has its own sentence because *"Leave in 0 min"* is not something anyone says; every other value must be projected by the `leaveIn` slot below. A renderer that drew "Leave in 0 min" fails here, and a future case added to this map is a decision, not a formatting choice.',
    },
    {
      name: 'leaveIn',
      text: { message: 'watchLeaveIn', args: { n: 'leave.leaveInMin' } },
      when: 'leave.leaveInMin',
      why: 'Zero is said by `leaveNow` above, and absent leave has no line at all.',
    },
    {
      name: 'walk',
      text: { message: 'watchWalk', args: { n: 'leave.walkMin' } },
      when: 'leave',
      why: 'Same absence as the leave line: without a fix there is no walk to estimate, and an invented one would be the fabricated precision ADR-008 rules out.',
      invariant:
        '`walkMinutes` is a straight-line estimate at a fixed pace with a floor of one minute — the same figure every stop card in the app shows, so the card cannot disagree with the list the rider tapped through.',
    },
    {
      name: 'feedNotice',
      oneOf: 'notice.kind',
      cases: {
        none: [],
        lastUpdated: [
          {
            name: 'noticeLastUpdated',
            text: { message: 'feedLastUpdated', args: { time: 'notice.at' } },
          },
        ],
        offline: [{ name: 'noticeOffline', text: { message: 'feedOffline' } }],
        unreachable: [{ name: 'noticeUnreachable', text: { message: 'feedUnreachable' } }],
      },
      invariant:
        'The screen-level freshness sentence, said **once per board** and never as a mark on a figure (ADR-123/133/150). `notice.at` is Hong Kong wall-clock from `formatClock` — absolute rather than relative, because "2 minutes ago" ages while nothing re-renders, which is the same dishonesty as a client-side countdown.',
    },
  ],

  states: {
    loading: {
      must: 'A skeleton where the board will be, with the stop and route already drawn.',
      mustNot:
        'An empty card, a dash, or "no service" — none of which is what "we have not been told yet" means.',
      why: "ADR-088, and the card inherits the pill's reason: the identity is known from the moment the watch was made, so only the board is ever pending.",
      enforcement: {
        // The `pending` case of `board` projects no text, and `shows: []` compares the whole rendering
        // against the always-present slots exactly — so a dash, a zero or a "no service" in this state is
        // text the spec does not declare, and fails.
        shows: [],
      },
    },
    empty: {
      must: 'An explicit "no service" where the times would be.',
      mustNot:
        'A card with a stop name and nothing under it — the `StopRow` defect, one component over.',
      why: '`stop-row.spec.json` carried this sentence as a `knownDefect` for months and WP6-4 closed it by changing what a card is built *from*. This spec starts where that one ended up.',
      enforcement: { by: 'boardNoService' },
    },
    failed: {
      must: 'An explicit "could not reach" line, distinguishable from having no service.',
      mustNot: 'Reading as "no buses due" when the board refused us.',
      why: 'ADR-073/077.',
      enforcement: { by: 'boardUnavailable' },
    },
    stale: {
      must: 'The readings, plus "Last updated HH:MM" — the age said once, for the whole board.',
      mustNot: 'Colour alone, a per-figure cue, or a value presented as fresh.',
      why: 'ADR-123/133/150. This is the slot `WatchPill` points at when it declares its own `stale` state unenforced.',
      enforcement: { by: 'noticeLastUpdated' },
    },
    offline: {
      must: 'The last known readings, aged, with the offline sentence.',
      mustNot: 'A blank card, and never a fresh-looking value.',
      why: 'ADR-058: what is replayed from the persisted cache is a labelled old reading rather than no reading.',
      enforcement: { by: 'noticeOffline' },
    },
    cannotCatch: {
      must: 'The board, with no leave line at all.',
      mustNot:
        '"Leave now" for a bus the rider cannot reach in time — a false reassurance is worse than silence.',
      why: "`proposals/07` §6 and `watch#watchView`'s `a-bus-you-cannot-catch-says-nothing` row. The kernel returns no `leave`, and this state is what stops a renderer inventing one from the figures beside it.",
      enforcement: {
        // `leave`, `leaveIn` and `walk` are all `when`-gated on a field the kernel deliberately left
        // absent, so the projection for this state contains no leave line at all — and the exact
        // comparison is what turns "we do not say it" into something a renderer can fail.
        shows: [],
      },
    },
  },

  interactions: [
    { target: 'stopName', goes: 'place-detail' },
    { target: 'routeNo', goes: 'route-detail-at-this-stop' },
    {
      target: 'feedNotice',
      goes: 'watch-pill',
      optional: true,
      note: "Collapsing is a gesture on the card rather than a control in it — a tap outside, a downward drag, or the pill's own surface again. Declared `optional` because a renderer may have no explicit control for it; the text is unchanged either way.",
    },
  ],

  a11y: {
    role: 'dialog or region, whose board is a list and whose actions are buttons',
    name: { fromSlot: 'stopName' },
    reducedMotion:
      'The card appears in place rather than growing out of the pill; the content is identical either way.',
  },

  idiom: [
    "material and elevation, and whether the card keeps the pill's glass or moves to a solid surface",
    'shape: corner radius, and whether the header row is visually the pill that opened it',
    'motion: the expansion, and whether the card can be dragged between heights',
    'how the lead figure is emphasised against the rest of the board',
    'the action row: filled pills, a text row, or a platform toolbar',
    'the icon set — the walk glyph, the stand glyph, the route and stop shortcuts',
  ],
}
