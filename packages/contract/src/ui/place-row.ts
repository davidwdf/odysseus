import type { ComponentSpec } from '@nextbus/ui-spec'

/**
 * **One line at one kerb** (WP6-3b) — the row Place detail is a list of, grouped or flat.
 *
 * ## Why it is its own spec rather than slots repeated inside the screen's
 *
 * Place detail draws its rows in two shapes: under a kerb heading for a merged place, and as one flat
 * list for a lone stop. Writing the row's slots out twice inside the screen's spec would be two
 * declarations of one thing — the exact failure this format exists to prevent, reproduced inside it. So the
 * row is a spec and the screen references it with a `component` slot (ADR-084's sixth word), twice; a slot
 * added here turns up in both of the screen's shapes with no edit there.
 *
 * ## The three-way readout is the branch a renderer forgets
 *
 * A row's right-hand side is **not** an optional arrival. It is a live reading, *else* the timetable's own
 * published frequency, *else* a dash — and the middle case is the one that gets dropped, because "no
 * reading" reads like "nothing to say" when in fact the operator published a headway. `placeRouteRow`
 * decides which of the three it is; this spec is what makes a renderer that draws only two of them go red.
 * The `oneOf` nests, because a live reading is itself three-way (minutes, "Due", a dash for a departure
 * already past) and that inner union is `EtaLabelParts` — the same one `StopRow` declares.
 */
export const PLACE_ROW_SPEC: ComponentSpec = {
  component: 'PlaceRow',
  version: 1,
  doc: 'One route at one boarding point — the chip, where it is headed, and the three-way readout.',
  viewModel: {
    module: 'stop-detail',
    type: 'PlaceRouteRow',
    corpus: 'stop-detail.spec.json',
    group: 'placeDetailView',
  },

  slots: [
    {
      name: 'routeNo',
      text: { field: 'routeNo' },
      invariant:
        'The operators’ service-type variants are already collapsed to one row per rider line by `dedupeRoutes`, so two rows with the same number at one kerb mean two genuinely different services — never a duplicate to hide.',
    },
    {
      name: 'destinationArrow',
      text: {
        literal: '→',
        why: 'The renderer supplies the glyph and the kernel supplies only the destination — a direction marker rather than a word, so it is not in the catalogue and needs no translation. The same literal `StopRow` declares, for the same reason.',
      },
    },
    {
      name: 'destination',
      text: { field: 'destination' },
      invariant:
        'Title-cased by `displayName`, never by the renderer — the feeds shout ("KENNEDY TOWN") and they do not agree with each other about it (ADR-034).',
    },
    {
      name: 'remark',
      text: { field: 'remark.text' },
      when: 'remark',
      why: 'Most departures carry none. Where one exists it is classified by `remarkView` and reduced to this locale.',
      invariant:
        'One tone for every class (ADR-036): the honesty cue is the word "Scheduled", not a colour. A row must never be coloured to mean "not a real reading" — that is the "never colour alone" half of ADR-008.',
    },
    {
      name: 'readout',
      oneOf: 'readout.kind',
      cases: {
        eta: [
          {
            name: 'etaLabel',
            oneOf: 'readout.label.kind',
            cases: {
              mins: [
                { name: 'etaValue', text: { field: 'readout.label.value' } },
                { name: 'etaUnit', text: { field: 'readout.label.unit' } },
              ],
              due: [{ name: 'etaDue', text: { field: 'readout.label.label' } }],
              departed: [
                {
                  name: 'etaDeparted',
                  text: {
                    literal: '—',
                    why: 'An em dash, not a word: the reading exists but names a moment already past, and inventing "gone" would be a claim the feed did not make (ADR-008).',
                  },
                },
              ],
            },
          },
        ],
        headway: [
          {
            name: 'headway',
            text: { field: 'readout.text' },
            invariant:
              'The published frequency, composed by `formatHeadway` — including the en-dash range and its spacing. A route with no live reading but a timetable is **not** a route with nothing to say, and this is the arm a renderer drops.',
          },
        ],
        none: [
          {
            name: 'noReading',
            text: {
              literal: '—',
              why: 'Neither a live reading nor a published frequency. A dash rather than a blank, so the row has a right-hand side and a rider can tell "we do not know" from "the column is still loading".',
            },
          },
        ],
      },
      invariant:
        'Tabular figures, and no client-side countdown — the value changes only when fresh data arrives (ADR-008). A `kind` with no case here is a hard failure rather than a silent skip, so growing either union goes red instead of quietly dropping the whole readout.',
    },
  ],

  states: {
    loading: {
      must: 'Nothing of its own — the screen draws the skeleton, and a row is never mounted without a reading to show.',
      mustNot: 'A row with a chip and an empty right-hand side, which reads as a reading of zero.',
      enforcement: {
        unenforced:
          'This component is never mounted without a view: the Place screen renders its skeleton instead of its list, so there is no per-row loading state to hold anyone to. Declared on the screen, where it is drawn.',
      },
    },
    empty: {
      must: 'The dash — the third arm of the readout.',
      mustNot: 'A blank right-hand side.',
      why: 'A route serving this kerb with neither a live reading nor a published headway is ordinary, and it must still look like a row.',
      enforcement: { by: 'noReading' },
    },
    failed: {
      must: 'The dash, and the *screen* saying that a boarding point would not answer.',
      mustNot: 'Reading as "no buses due" when an upstream board refused us.',
      why: 'ADR-073: `coalesce` used to resolve a rejected board to an empty list, so an outage rendered identically to a quiet stop. The fact lives on the place (`PlaceDetailView.incomplete`), not on the row — a rider cannot act on the difference between one refusing kerb and four.',
      enforcement: {
        unenforced:
          'A row cannot tell the two apart: it is handed a readout, and `none` is what both a quiet route and a refused board produce. The screen owns the distinction and `place-detail.spec.json` declares it — as a `knownDefect`, because today neither renderer draws it.',
      },
    },
    stale: {
      must: 'The `opacity.etaStale` treatment on the readout.',
      mustNot: 'Colour alone, and never a value presented as fresh.',
      why: 'ADR-008. A reading replayed from the persisted cache arrives with its original `observedAt`, so `etaReadout` ages it rather than showing it as live (ADR-058).',
      enforcement: {
        unenforced:
          '`readout.stale` is drawn as opacity, which is not text, so this harness cannot see it. The relative age is the screen’s, not the row’s.',
      },
    },
    offline: {
      must: 'The last known reading, aged and marked stale.',
      mustNot: 'A blank row, and never a fresh-looking value.',
      enforcement: {
        unenforced:
          'Indistinguishable from `stale` at the level of one row — the difference is whose network failed, which only the screen knows.',
      },
    },
  },

  interactions: [
    {
      target: 'destination',
      goes: 'route-detail-at-this-kerb',
      note: 'The row carries its own **raw** boarding pole (`stopId`), which is what `?stop=` must be: a favourite and an "arrivals here" view are keyed on the same thing (ADR-062). Never the place id.',
    },
  ],

  a11y: {
    role: 'button',
    name: { fromSlot: 'destination' },
    reducedMotion: 'No entrance animation; the content is identical either way.',
  },

  idiom: [
    'the saved-state star beside the row — present on native, and a **sibling** tap target rather than a nested one (ADR-024); it has no text, so no slot can declare it',
    'how the readout is emphasised — size, weight, and the colour ramp `etaUrgency` names',
    'the divider between rows, and whether there is one at all',
    'the pressed-state treatment (opacity here, ripple on Android)',
    'the chip’s shape, and whether the operator livery is its background or its border',
  ],
}
