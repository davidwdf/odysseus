import type { ComponentSpec } from '@nextbus/ui-spec'

/**
 * **The watch pill** — the collapsed floating board that follows a rider around the app
 * (`proposals/07`, round 3's S2).
 *
 * ## Written before either renderer, which is new here and is the point
 *
 * Every spec before this one was *retrofitted*: ADR-075 decision 5 extracts a spec from a working
 * renderer while it still exists, and WP6-1 chose `StopRow` first precisely because two renderers already
 * agreed about it, so writing its spec validated the format for free. This component has no renderer at
 * all. The owner asked for the spec first, and the reason is the record: WP6-3b's spec-writing found *a
 * failed fetch rendering nothing at all on both renderers*, and WP6-4's found *two arms declared and never
 * projected* — both of them defects that existed because the states were drawn before they were declared.
 * Declaring first is the cheaper order, and this is the first component where we get to try it.
 *
 * What follows from that: **this spec is a claim about a component that does not exist**, and every state
 * below names what will enforce it — four by a slot, one by a projection, one explicitly unenforced with
 * its reason. Nothing here is `knownDefect`, which is only honest because there is no renderer yet to be
 * wrong; the first one to exist has to satisfy these states rather than the other way round, and the day
 * it cannot is the day a `knownDefect` gets written with an owner.
 *
 * ## The two rules the design rounds paid for, and where they are enforced here
 *
 *  1. **A sentence never lands in the figure slot** (§4b). The `figure` slot's `oneOf` has no case that
 *     yields a sentence: the three non-reading arms draw a dash or nothing at all, and every sentence the
 *     pill can say is a case of `subLine`. A renderer that put *"Live times unavailable"* where the number
 *     goes would fail the `failed` state's projection, which is what truncated the stop's name in the
 *     mockup — and the stop's name is what the rider is watching.
 *  2. **No chevron, and that is content rather than styling** (§4c). At 390 px the pill shares its row
 *     with the search lens and gets 296 px; the chevron is 19 px of it, and 19 px is exactly the
 *     difference between *"Nathan Road / Jordan Road"* and *"Nathan Road / Jordan…"*. So there is no
 *     disclosure slot below. The affordance is the whole pill, which `interactions` says.
 */
export const WATCH_PILL_SPEC: ComponentSpec = {
  component: 'WatchPill',
  version: 1,
  doc: 'The collapsed watch — one route at one pole, following the rider across every screen.',
  viewModel: {
    module: 'watch',
    type: 'WatchView',
    corpus: 'watch.spec.json',
    group: 'watchView',
  },

  slots: [
    {
      name: 'routeNo',
      text: { field: 'routeNo' },
      invariant:
        'The printed number the rider saw when they started watching, captured with the watch — not looked up. A pill draws on the first frame of any screen, with no fetch and possibly with no network.',
    },
    {
      name: 'stopName',
      text: { field: 'stop.label' },
      invariant:
        'Title-cased and split by `displayName`, so the pill spells a pole exactly as the card, the row and the sheet do (ADR-034). **The one string on this component that must never be truncated** — it is what the rider is watching, and §4c bought its width by deleting the chevron.',
    },
    {
      name: 'stopCode',
      text: { field: 'stop.code' },
      when: 'stop.code',
      why: 'A pole whose upstream name carries no printed flag code — a GMB pole rarely has one at all.',
    },
    {
      name: 'subLine',
      oneOf: 'subLine.kind',
      cases: {
        destination: [
          {
            name: 'destinationArrow',
            text: {
              literal: '→',
              why: 'The renderer supplies the glyph and the kernel supplies only the destination, exactly as `StopRow` does — a direction marker rather than a word, so it is not in the catalogue and needs no translation.',
            },
          },
          { name: 'destination', text: { field: 'destination' } },
        ],
        offline: [{ name: 'subOffline', text: { message: 'watchOffline' } }],
        unavailable: [{ name: 'subUnavailable', text: { message: 'etasUnavailable' } }],
        noService: [{ name: 'subNoService', text: { message: 'noService' } }],
        scheduled: [{ name: 'subScheduled', text: { message: 'watchScheduled' } }],
      },
      invariant:
        'Exactly one of the five, always — `destination` is a case rather than the absence of one, so neither renderer implements a "no note, show the destination instead" fallback of its own. The precedence is the kernel\'s: offline, then the board\'s refusal, then nothing-due, then the timetable cue, then the destination. `subLine.tone` names a meaning (`warn` / `muted`) and never a colour, so each renderer maps it with its own tokens (ADR-053).',
    },
    {
      name: 'figure',
      oneOf: 'readout.kind',
      cases: {
        // No text at all: a board on its way is a skeleton, and a skeleton has no words to read.
        // The state below is what holds a renderer to drawing one.
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
            invariant:
              "Three of these five are unreachable through this component and are declared anyway. `upcoming` filters departed readings out before a lead exists, `etaLabelParts` cannot return `headway`, and `none` needs a row with no reading at all — but a `oneOf` value with no case is a hard failure in this format, so enumerating them is what makes growing `EtaLabelParts` go red here instead of silently dropping the pill's only figure.",
          },
        ],
        unavailable: [
          {
            name: 'figureAbsentUnavailable',
            text: {
              literal: '—',
              why: 'The board refused us, so there is no figure. The dash is the same one `StopRow` draws for a reading it cannot make, and the *reason* is on the sub-line, where a sentence fits.',
            },
          },
        ],
        noService: [
          {
            name: 'figureAbsentNoService',
            text: {
              literal: '—',
              why: 'Nothing is due. A different fact from the dash above it and drawn identically, because the pill has one figure slot and only one of them can be true at a time — the sub-line is what distinguishes them.',
            },
          },
        ],
      },
      invariant:
        'Tabular figures, and **no client-side countdown**: the value changes only when a frame lands (ADR-008). The pill is the most tempting place in the app to animate a number down, and the one where it would be least honest — it is on screen continuously, so a stale figure ticking would be a lie told for minutes rather than seconds.',
    },
  ],

  states: {
    loading: {
      must: 'A skeleton in the shape of the pill — the badge, a name block and a figure block.',
      mustNot:
        'A dash where the figure will be, an empty pill, or a spinner. A board on its way must never read as a board that answered.',
      why: 'ADR-088: `loading` is the first arm for exactly this reason, and the mistake it names — a paused fetch matching no arm — shipped on two screens before a spec asked the question.',
      enforcement: {
        // **`shows: []` is the assertion, not the absence of one.** The state is projected as the
        // always-present slots and nothing else, and `conform` compares that list *exactly* — so the
        // `pending` case of `figure`, which yields no text, means a renderer that drew a dash produces
        // text where the spec declares none, and fails. An absence is only checkable by projecting the
        // state and finding nothing there.
        shows: [],
      },
    },
    empty: {
      must: 'The stop, the route and an explicit "no service" on the sub-line, with a dash for the figure.',
      mustNot:
        'A blank second line, and never the destination — which would make a route with no buses look identical to one with buses the pill has not drawn yet.',
      enforcement: { by: 'subNoService' },
    },
    failed: {
      must: 'An explicit "could not reach" cue on the sub-line, distinguishable from having no service.',
      mustNot: 'Reading as "no buses due", and never the sentence in the figure slot.',
      why: 'ADR-073/077: `coalesce` resolved a refused board to an empty list, so an outage rendered identically to a quiet stop. The pill inherits both the distinction and the words the rest of the app uses for it.',
      enforcement: { by: 'subUnavailable' },
    },
    stale: {
      must: 'The last readings, with the age said once — on the card, which is where `feedNotice` lives.',
      mustNot: 'A per-figure cue of any kind, and never a value presented as fresh.',
      why: "ADR-123/133/150: a fade and then a muted `~` were both built and withdrawn, because staleness is a property of the board and a per-figure cue draws one fact once per reading. A pill *is* one board, so its one sentence is the card's.",
      enforcement: {
        unenforced:
          'Nothing on the collapsed pill says it, deliberately. The claim is checked one level up, on `WatchCard`, whose `feedNotice` slot is the sentence — the same division `stop-row.spec.json` makes with the screens that draw it.',
      },
    },
    offline: {
      must: 'The last known readings, with the sub-line saying the network is gone.',
      mustNot: 'A blank pill, and never a fresh-looking value.',
      why: 'ADR-058: offline is a service worker plus a persisted query cache, so what is replayed is a labelled old reading rather than no reading. The sub-line outranks every other sentence here, because a rider who does not know they are offline cannot interpret anything else the pill says.',
      enforcement: { by: 'subOffline' },
    },
    redundant: {
      must: 'Nothing, or a reduced form — the screen underneath is already drawing this exact board.',
      mustNot:
        'A second full copy of a board the rider can already see, covering the one they are reading.',
      why: "`proposals/07` §5.5. The *comparison* is the kernel's (`WatchView.redundant`) because comparing ids in a view is the derivation `check-no-derivation` bans; what to do about it — hide, or shrink to badge and figure — is layout, and therefore each renderer's.",
      enforcement: { by: 'routeNo' },
    },
  },

  interactions: [
    {
      target: 'stopName',
      goes: 'watch-card',
      note: "The **whole pill** is the target, not a disclosure control: §4c deleted the chevron because its 19 px were the difference between the stop name fitting and not, and a control whose entire surface is tappable does not need an arrow to say so. The slot named here is the pill's accessible name, which is what the interaction is anchored to.",
    },
  ],

  a11y: {
    role: 'button, and a polite live region for the figure',
    name: { fromSlot: 'stopName' },
    reducedMotion:
      'No rise-and-expand; the card appears in place. The pill itself never animates its figure — see the `figure` invariant.',
  },

  idiom: [
    'material and elevation — glass over content on both renderers today, but a value-swap either could change',
    'shape: the corner radius, and whether the pill shares the bottom row with the search lens or sits alone',
    'motion: the rise above the lens and the widening into the card, and whether they are one gesture',
    'how the lead figure is emphasised — size, weight, and which token `urgency` maps to',
    'the dismiss gesture, if any — a swipe is idiom, the 90-minute expiry is not',
    'whether `redundant` hides the pill or reduces it to a badge and a figure',
  ],
}
