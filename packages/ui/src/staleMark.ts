// The geometry of the staleness mark — the `~` an ETA readout carries once its board has aged past the
// served `staleAfterMs` (ADR-008).
//
// WHY THIS IS A MODULE AND NOT A CLASSNAME IN EACH RENDERER
// The mark's whole design constraint is that **the figure beside it must not move by one pixel when it
// appears**. That is not a look, it is an arithmetic identity between three numbers — a reserved gutter on
// the readout, and a mark whose own width is cancelled by an equal negative margin so it contributes
// nothing to the line. Written as `pl-3 / w-3 / -ml-3` in one renderer and `paddingLeft: 12 /
// width: 12 / marginLeft: -12` in the other, that identity is asserted nowhere and a later edit to either
// copy breaks it silently. Written here it is one number, both renderers read it, and each suite can read
// it straight back off the rendered node and check the cancellation.
//
// It is derived rather than declared: `tokens.json` is the one declaration of every design *value*
// (docs/09), and this is the 4px scale's `3`, chosen rather than invented. `elevation.ts` sits beside this
// for the same reason — a hand-written rule that acts on the tokens, never a second copy of one.
//
// WHAT IS DELIBERATELY *NOT* HERE
// **Which readouts carry the mark** — the rule that it qualifies a figure and only a figure, so a dash or a
// published headway never takes one. That was written out four times in view code and is now one function,
// `etaCarriesStaleMark` in `@nextbus/core/eta`, corpus-pinned like every other domain rule. Beside
// `ETA_STALE_GUTTER` is where a reviewer first proposed it and the layer line says otherwise: it is a rule
// over `EtaLabelParts`, which is the kernel's own union, under ADR-008's honesty tiers. `layers.json` would
// have *allowed* it (`tokens` may `use` `kernel`), which is the point — the gate cannot make this call. A
// design package that had learnt the shape of an arrival label is ADR-075's `ui-spec`-with-a-`stopId`
// warning one layer over, and it would also have put the rule somewhere the Swift and Kotlin ports read
// values from rather than rules. This module knows how big the mark is; the kernel knows when it is owed.
//
// The cue this replaced was `opacity.etaStale`, which is still in `tokens.json` and is **retired** — read
// its description there before applying it to anything.

import { SPACING, TYPE_SCALE } from './tokens.generated'

/**
 * The gutter reserved to the left of an ETA readout, in px — **present whether or not the mark is**.
 *
 * 12px, the spacing scale's `3`. The mark itself is caption-sized in both renderers, so its `~` has an
 * advance of roughly 6.4px and sits centred in the gutter with ~2.8px either side: attached to the figure
 * it qualifies, and not touching it. Reserving the space in CSS rather than by mounting a hidden `~` is
 * deliberate and is the one thing this design must not get wrong — this repo's conformance walker reads
 * text by **presence, not visibility**, so an always-mounted glyph would project a `~` from every fresh
 * readout on every screen for ever, and no state suite would catch it because they all mount settled.
 */
export const ETA_STALE_GUTTER = SPACING['3']

/**
 * The mark's own type size, in px — the caption role, whatever the figure beside it is set in.
 *
 * A fixed annotation size rather than one that tracks the figure: the same `~` reads the same on the card's
 * 22px `h2` readout and on the schematic's 14px secondary slot, and a mark that scaled with the figure
 * would need a different gutter at every call site — which is exactly the drift `ETA_STALE_GUTTER` exists
 * to prevent.
 */
export const ETA_STALE_MARK_SIZE = TYPE_SCALE.caption.fontSize
