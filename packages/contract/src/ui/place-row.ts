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
/**
 * **The staleness mark** — the same node `stop-row.ts` declares, over this model's own path.
 *
 * A row's `stale` hangs off the readout rather than off the row (`readout.stale`), because only the `eta`
 * arm of the three-way readout has a reading old enough to be one. Everything else about it is `StopRow`'s
 * — a muted renderer-supplied `~`, sitting in a gutter the readout reserves whether or not the mark is
 * drawn, mounted only when stale, and translated through its accessible name rather than its glyph. See
 * the long note there.
 */
const STALE_MARK = {
  text: {
    literal: '~',
    why: 'The renderer supplies the glyph, exactly as it does the `→` above: a marker rather than a word, so it is not in the catalogue. Its meaning is — `etaStaleMark`, on the node’s accessible name.',
  },
  when: 'readout.stale',
  why: 'The board this reading came from is fresher than the served `staleAfterMs`, which is the ordinary case.',
  invariant:
    'Muted whatever `etaUrgency` colours the figure, and it must not move the figure: the gutter is reserved in either state. Declared inside `mins` and `due` and not beside them — `departed` prints an em dash, and `~ —` claims nothing.',
} as const

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
                { name: 'etaStale', ...STALE_MARK },
                { name: 'etaValue', text: { field: 'readout.label.value' } },
                { name: 'etaUnit', text: { field: 'readout.label.unit' } },
              ],
              due: [
                { name: 'etaStale', ...STALE_MARK },
                { name: 'etaDue', text: { field: 'readout.label.label' } },
              ],
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
      must: 'A muted `~` immediately before the figure, in the gutter the readout reserves in either state.',
      mustNot:
        'Colour alone, and never a value presented as fresh — nor a cue that shifts the figure, which would read as the value having changed.',
      why: 'ADR-008. A reading replayed from the persisted cache arrives with its original `observedAt`, so `etaReadout` ages it rather than showing it as live (ADR-058).',
      enforcement: {
        by: 'etaStale',
        // `unenforced` until the `~` replaced the fade, with the note *"`readout.stale` is drawn as
        // opacity, which is not text, so this harness cannot see it"*. Which was the cue's problem as much
        // as the harness's: a rider seeing one reading has nothing to compare a 45% fade against. The
        // relative age is still the screen's and still unbuilt (docs/07).
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
    'the saved-state star beside the row — **on both renderers now**, and a **sibling** tap target rather than a nested one (ADR-024). It stays idiom for the reason it always did: it has no text, so no slot can declare it and each renderer draws it its own way. What changed is the claim beside it: this entry read *"present on native"* until WP6-7b’s parity audit, on the premise that a web rider could favourite somewhere else — and they could not, because WP6-4 ported the screen that *reads* favourites and neither affordance that *writes* one. **An `idiom` entry that names a renderer is a claim about that renderer, and this one had gone stale into a capability gap.** Each suite asserts the star directly, including that it changes not one word of the projection, which is what keeps the classification honest rather than convenient',
    'how the readout is emphasised — size, weight, and the colour ramp `etaUrgency` names',
    'the divider between rows, and whether there is one at all',
    'the pressed-state treatment (opacity here, ripple on Android)',
    'the chip’s shape, and whether the operator livery is its background or its border',
  ],
}
