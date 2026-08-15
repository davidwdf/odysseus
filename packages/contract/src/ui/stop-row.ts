import type { ComponentSpec } from '@nextbus/ui-spec'

/**
 * **The first component spec** (WP6-1) — the compact stop card, the unit Nearby and Favourites are both
 * lists of.
 *
 * ## Retrofitted, not designed
 *
 * ADR-075 decision 5 says every spec is extracted from the working renderer *while it still exists*, and
 * `proposals/04` picks this component first for a specific reason: two renderers already draw it and
 * already agree, so writing its spec validates the **format** for free. If the format could not express a
 * component that demonstrably works, the format would be wrong — and we would learn that in an afternoon
 * instead of at screen five. Both `apps/mobile/components/StopRow.tsx` and
 * `apps/web/src/components/StopCard.tsx` pass this **unmodified**; not one line of either changed.
 *
 * ## It contains no derivation, and that is checkable
 *
 * Every slot below reads a field the kernel already filled in. `stopCardView` in `@nextbus/core` decides
 * the row cap, the "+N more" count, the caption and its two separator widths, the destination-else-remark
 * headline, and whether the card is incomplete — all pinned by
 * `packages/core/spec/stop-card.spec.json`, which is the corpus both renderers' conformance suites
 * replay. So the golden cannot drift from what the kernel produces, and a rule change goes red in every
 * suite at once.
 *
 * ## Why the `states` block has three `knownDefect`s
 *
 * `proposals/04`'s worked example declares `empty.mustNot` as *"a card with a name and nothing under
 * it"*, citing `docs/11`'s open bug. Writing that as an enforced assertion would have failed both
 * renderers on day one — the card **does** render a name with nothing under it today — and WP6-1's
 * acceptance is that both pass unmodified. Silently softening the sentence would have been worse: it is
 * the correct target. So the state keeps the sentence it deserves and declares that no renderer satisfies
 * it yet, which is the shape Wave 2 already established with its four `knownDefect` corpus rows, for the
 * reason ADR-075 restates: identical and visible beats different and hidden.
 */
export const STOP_ROW_SPEC: ComponentSpec = {
  component: 'StopRow',
  version: 1,
  doc: 'The compact stop card — the unit Nearby and Favourites are both lists of.',
  viewModel: {
    module: 'stop-card',
    type: 'StopCardView',
    corpus: 'stop-card.spec.json',
    group: 'stopCardView',
  },

  slots: [
    {
      name: 'headline',
      text: { field: 'name.label' },
      invariant:
        'Title-cased and split by `displayName`/`splitStopCode`, never by the renderer (ADR-034).',
    },
    {
      name: 'code',
      text: { field: 'name.code' },
      when: 'name.code',
      why: 'A place whose upstream name carries no printed code — and a GMB pole rarely has one at all.',
    },
    {
      name: 'caption',
      text: { field: 'caption' },
      when: 'caption',
      why: 'Favourites passes no distance and a single-pole stop has no compass direction, so the whole caption is empty rather than half-built.',
      invariant:
        'Rendered verbatim. Its two separator widths are semantic — `" · "` binds a distance to its own walk time, a wider `"  ·  "` separates that pair from the direction — and HTML collapses consecutive whitespace, which is a divergence apps/web shipped and its projection suite caught (ADR-069).',
    },
    {
      name: 'rows',
      each: 'rows',
      of: [
        {
          name: 'routeNo',
          text: { field: 'routeNo' },
          invariant:
            'The whole id when it cannot be parsed, so an unreadable id still shows the rider something rather than an empty chip.',
        },
        {
          name: 'headlineArrow',
          text: {
            literal: '→',
            why: 'The renderer supplies the glyph; the kernel supplies only the destination. It is a direction marker rather than a word, so it is not in the catalogue and needs no translation.',
          },
          when: 'headline',
          why: 'No arrow without a destination to point at.',
        },
        {
          name: 'headline',
          text: { field: 'headline' },
          when: 'headline',
          why: 'The feed gave neither a destination nor a remark to stand in for one.',
        },
        {
          name: 'remark',
          text: { field: 'remark.text' },
          when: 'remark',
          why: 'Absent when the remark is already standing in as the headline, so the same words never appear twice in one row.',
        },
        {
          name: 'eta',
          oneOf: 'label.kind',
          cases: {
            mins: [
              { name: 'etaValue', text: { field: 'label.value' } },
              { name: 'etaUnit', text: { field: 'label.unit' } },
            ],
            due: [{ name: 'etaDue', text: { field: 'label.label' } }],
            departed: [
              {
                name: 'etaDeparted',
                text: {
                  literal: '—',
                  why: 'An em dash, not a word: the reading exists but names a moment already past, and inventing "gone" would be a claim the feed did not make (ADR-008).',
                },
              },
            ],
            headway: [
              {
                name: 'etaHeadway',
                text: { field: 'label.text' },
                invariant:
                  'The **published timetable**, where there is no live reading at all — composed by `formatHeadway`, en-dash range and spacing included. Drawn small and muted rather than as a figure, because it is the *Static* honesty tier (docs/09) and must not read as a bus that has been seen. Reached only by a **saved** route today (WP6-4b): `stopCardView` builds its rows from readings and `etaLabelParts` cannot return this arm, so on Nearby it is unreachable by construction.',
              },
            ],
            none: [
              {
                name: 'etaNone',
                text: {
                  literal: '—',
                  why: 'Neither a reading nor a published frequency. The same dash as `departed` and a different fact — which is why they are separate arms rather than one: a renderer that folded them would lose the ability to say anything else about either later.',
                },
              },
            ],
          },
          invariant:
            'Tabular figures, and no client-side countdown — the value changes only when fresh data arrives (ADR-008). A `label.kind` with no case here is a hard failure rather than a silent skip, so growing the union goes red instead of quietly dropping the readout.',
        },
      ],
      invariant:
        'Capped at the served `maxRows` by `stopCardView`, which computes the overflow count in the same pass. A caller that sliced first would make that count zero — a bug this repo has already shipped once (WP3-1).',
    },
    {
      name: 'incomplete',
      text: { message: 'etasUnavailable' },
      when: 'incomplete',
      why: 'Every boarding point answered, so `rows` is a complete list rather than a short one.',
      invariant:
        "Below the rows, because the readings that did arrive are true and this describes the ones that are missing. Never a warning colour: nothing is wrong with the rider's stop, an upstream board refused us (ADR-077).",
    },
    {
      name: 'overflow',
      text: { message: 'moreRoutes', args: { n: 'remaining' } },
      when: 'remaining',
      why: 'Zero hidden lines means no affordance — the count is the whole content of the slot.',
      invariant:
        'Rendered whether or not it can be tapped. `remaining > 0 && onPress` is what both renderers had, and it silently showed 6 of 26 to any caller with nowhere to navigate — hiding an honest total because the affordance is unavailable is the silent filter ADR-008 forbids. The harness enforces this generally, as `content-not-affordance` (ADR-069).',
    },
  ],

  states: {
    loading: {
      must: 'A skeleton in the shape of the card — a heading block and row blocks.',
      mustNot: 'An empty card, or a spinner where the list will be.',
      enforcement: {
        unenforced:
          "The skeleton is the list screen's, not the card's: this component is never mounted without a view. WP6-2 declares it on Nearby, where it is drawn.",
      },
    },
    empty: {
      must: 'The static timetable band, or an explicit "no service" line under the heading.',
      mustNot: 'A card with a name and nothing under it.',
      why: "docs/11: a peak-only favourite rendered blank, and an empty card cannot be told from a broken favourite key by eye — which is why WP5-11's favourites proof had to rest on a route with a live arrival.",
      enforcement: {
        by: 'etaHeadway',
        // Was a `knownDefect` owned by WP6-4 from WP6-1 until 2026-08-05, and this is what closing it looked
        // like: **not** a band added to the card, but a change to what a card is built *from*. `favouritesView`
        // now emits a row per **saved route** rather than per reading, so a peak-only service reaches the card
        // with its published frequency (`headway`) or a dash (`none`) instead of contributing nothing at all.
        // The slot named here is the timetable arm, which is the "band" this sentence has always asked for.
      },
    },
    failed: {
      must: 'An explicit "could not reach" cue, distinguishable from having no service.',
      mustNot: 'Reading as "no buses due" when a boarding point refused to answer.',
      why: 'ADR-073: `coalesce` resolved a rejected upstream board to an empty list, so an outage rendered identically to a quiet stop. ADR-077 gave the card a boolean to say it with.',
      enforcement: { by: 'incomplete' },
    },
    stale: {
      must: 'A relative age somewhere the rider can see it — the screen’s “last updated” line.',
      mustNot: 'Colour alone, and never a value presented as fresh.',
      why: 'ADR-008. A replayed reading from the persisted cache arrives with its original `observedAt`, so it is aged and labelled rather than shown as live (ADR-058).',
      enforcement: {
        unenforced:
          'Nothing on the CARD says this, and since ADR-123 nothing is meant to: two per-reading treatments (a 45% fade, then a muted `~`) were built and withdrawn because staleness is a property of the BOARD, so a per-figure cue draws one fact once per reading. The sentence is the screen’s — ADR-133’s `feedNotice` — and since ADR-150 **both screens that draw this card say it**: `nearby.spec.json` and `favourites.spec.json` project it as a slot of their own, and each drives its `stale` state through it. It stays `unenforced` HERE because there is nothing on this component to enforce; the claim is checked one level up, which is where the fact lives.',
      },
    },
    offline: {
      must: 'The last known readings, aged and marked stale, with the position labelled as remembered if it is.',
      mustNot: 'A blank list, and never a fresh-looking value.',
      why: 'ADR-058: offline is a service worker plus a persisted query cache, and what is restored is a labelled old reading rather than a new one.',
      enforcement: {
        unenforced:
          'Indistinguishable from `stale` at the level of one card — the difference is whose network failed, which only the screen knows. WP6-2 declares it where the distinction is drawn.',
      },
    },
  },

  interactions: [
    {
      target: 'headline',
      goes: 'place-detail',
      note: 'A sibling of the rows, never a parent: nested interactive elements are invalid HTML on web and an ambiguous tap target everywhere (ADR-024). The harness enforces this as `sibling-not-nested`.',
    },
    { target: 'rows', goes: 'route-detail-at-this-stop' },
    {
      target: 'overflow',
      goes: 'place-detail',
      optional: true,
      note: 'Inert wherever the caller has nowhere to navigate — Nearby on apps/web is exactly that caller today. The count is shown either way.',
    },
  ],

  a11y: {
    role: 'list item, whose heading and each row are buttons',
    name: { fromSlot: 'headline' },
    reducedMotion: 'No entrance animation; the content is identical either way.',
  },

  idiom: [
    'material and elevation — a flat surface on web, a floating card or a glass pane on native',
    'shape: corner radius and divider treatment',
    'motion: whether rows cascade in at all, and the curve if they do',
    'the icon set: the chevron, the compass needle and the generic pin',
    'the pressed-state treatment (opacity here, ripple on Android)',
    'how the ETA readout is emphasised — size, weight, colour ramp',
  ],
}
