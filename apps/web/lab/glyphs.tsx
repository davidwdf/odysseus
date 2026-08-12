/**
 * Glyph proposals for the rail's bus token — **candidates, not components** (ADR-112).
 *
 * They live in `lab/` on purpose. `apps/web/src/components/BusGlyph.tsx` is the one that ships; everything
 * here is a drawing to be looked at and mostly thrown away, and the dev-pages gate's one rule is that
 * `src/` may never import from `lab/`. When one of these wins, it is **copied** into `src/` (and its RN
 * twin), not imported from here.
 *
 * ## What is being decided
 *
 * Now that every stop on a GMB route has times, the schematic draws a bus token for minibus routes too —
 * and `BusGlyph` currently draws one silhouette for every operator. So there are two questions, and the
 * second is the owner's:
 *
 *  1. What does a **front-facing light bus** look like at 16–18 px?
 *  2. Does the **double-decker** need to be taller, given the bounce squashes it 6 % at the wheels?
 *
 * ## The proportions are real, not stylised
 *
 * A Hong Kong light bus is ~2.0 m wide and ~2.8 m tall; a double-decker is ~2.5 m wide and ~4.4 m tall.
 * Head-on that is an aspect ratio of about **1.4 against 1.76** — the decker is both taller *and* wider.
 * Leaning into that is what makes them tell apart at 16 px, so every minibus below is **shorter and
 * narrower** than every decker below, and they share a ground line (tyres at the same y) so the height
 * difference is the thing the eye catches rather than a vertical offset.
 *
 * All of them keep `BusGlyph`'s existing DNA: a 24 px grid, 2 px stroke, round caps and joins,
 * `currentColor` throughout so the caller sets the colour with a text utility, and solid pill tyres
 * peeking below the body.
 */

interface GlyphProps {
  size?: number
  strokeWidth?: number
}

/** The shared stroke, identical to `BusGlyph`'s. */
const stroke = (strokeWidth: number) =>
  ({
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  }) as const

function Frame({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────────── deckers */

/**
 * **D0 — the shipping decker, unchanged.** Body 14 × 15.5 from y=3, two 2.8-high window bands whose *gap*
 * is the deck split, in a perfectly even rhythm (3.3 roof / 3.3 between / 3.3 base).
 */
export function DeckerD0({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="5" y="3" width="14" height="15.5" rx="2.5" {...s} />
      <rect x="8" y="6.3" width="8" height="2.8" rx="1" {...s} />
      <rect x="8" y="12.4" width="8" height="2.8" rx="1" {...s} />
      <rect x="6.4" y="18.5" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="18.5" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/**
 * **D1 — taller.** Body 14 × 17.0 from y=2.2, which is +1.5 px of height on the same width and buys back
 * roughly what the bounce's 6 % squash takes away at the wheels. The even rhythm is *preserved* rather
 * than stretched: three equal 3.8 gaps around two 2.8 bands, so it is the same drawing pulled taller and
 * not a different one.
 */
export function DeckerD1({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="5" y="2.2" width="14" height="17" rx="2.5" {...s} />
      <rect x="8" y="6" width="8" height="2.8" rx="1" {...s} />
      <rect x="8" y="12.6" width="8" height="2.8" rx="1" {...s} />
      <rect x="6.4" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/**
 * **D2 — taller, with the deck split stated.** D1 plus a hairline between the bands. The shipping glyph
 * deliberately has no divider (the *gap* is the split), and this is the version that tests whether saying
 * it out loud helps at 16 px or just fills in. Expect it to muddy; included so the choice is made by
 * looking rather than by assumption.
 */
export function DeckerD2({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="5" y="2.2" width="14" height="17" rx="2.5" {...s} />
      <rect x="8" y="6" width="8" height="2.8" rx="1" {...s} />
      <line x1="5" y1="10.7" x2="19" y2="10.7" {...s} />
      <rect x="8" y="12.6" width="8" height="2.8" rx="1" {...s} />
      <rect x="6.4" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/* ───────────────────────────────────────────────────────────────────────── minibuses */

/**
 * **M1 — one band, nothing else.** The control. Body 12 × 12.6 from y=6.6, one 3.4-high windscreen that is
 * *wider* than the decker's bands (8.4 against 8) because a light bus's screen fills more of its face.
 * Tyres share the decker's ground line at y=19.2.
 *
 * If this reads as "small bus" on its own, every variant below is decoration.
 */
export function MinibusM1({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="6" y="6.6" width="12" height="12.6" rx="2.2" {...s} />
      <rect x="7.8" y="9.6" width="8.4" height="3.4" rx="1.1" {...s} />
      <rect x="7" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="14.6" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/**
 * **M2 — the owner's suggestion: a slight rectangle on top for the sign.** M1 plus a 6.4 × 1.9 box sitting
 * above the roofline, which is the destination sign box every HK light bus carries and the decker does not.
 * It is the cheapest silhouette difference available: it changes the *outline*, which is what survives
 * when a shape is 16 px and two-thirds of a token's circle.
 */
export function MinibusM2({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="8.8" y="4.5" width="6.4" height="2" rx="0.7" {...s} />
      <rect x="6" y="6.6" width="12" height="12.6" rx="2.2" {...s} />
      <rect x="7.8" y="9.6" width="8.4" height="3.4" rx="1.1" {...s} />
      <rect x="7" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="14.6" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/**
 * **M3 — the sign filled.** M2 with the box solid rather than outlined. At 16 px an outlined 2 px-high box
 * drawn with a 2 px stroke has no interior left, so it renders as a grey smudge; filling it makes it a
 * deliberate mark instead of a failed one. Same trick the tyres already use, and for the same reason.
 */
export function MinibusM3({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x="6" y="6.6" width="12" height="12.6" rx="2.2" {...s} />
      <rect x="7.8" y="9.6" width="8.4" height="3.4" rx="1.1" {...s} />
      <rect x="7" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="14.6" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/**
 * **M4 — sign as a roof pod, flush with the body.** Instead of a floating box, the sign is the full width
 * of the roof and reads as part of the vehicle rather than an aerial. Squarer overall, which is closer to
 * a real light bus's blunt front — and the least likely of the four to be mistaken for a decker's upper
 * deck at very small sizes, because it sits *outside* the body outline.
 */
export function MinibusM4({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="7.2" y="4.4" width="9.6" height="2.4" rx="1" {...s} fill="currentColor" />
      <rect x="6" y="6.6" width="12" height="12.6" rx="2.2" {...s} />
      <rect x="7.8" y="9.8" width="8.4" height="3.4" rx="1.1" {...s} />
      <rect x="7" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="14.6" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

/**
 * **M5 — the roof stripe.** Every HK light bus carries a statutory coloured roof band: **green** for a GMB
 * and red for the red minibuses we do not serve. This is M1 with that band drawn as a filled bar just under
 * the roofline.
 *
 * ⚠️ Drawn in `currentColor` here like everything else, so in the lab it is monochrome. Shipping it in
 * *green* would mean the glyph carries two colours — the token's own accent and the operator's — which is a
 * question for `docs/09` §2's operator-accent rule rather than a drawing decision, and it is the reason
 * this variant is last: it is the only one that cannot be adopted without a colour decision attached.
 */
export function MinibusM5({ size = 18, strokeWidth = 2 }: GlyphProps) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      <rect x="6" y="6.6" width="12" height="12.6" rx="2.2" {...s} />
      <rect x="7.6" y="7.6" width="8.8" height="1.4" rx="0.7" {...s} fill="currentColor" />
      <rect x="7.8" y="10.6" width="8.4" height="3.2" rx="1.1" {...s} />
      <rect x="7" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="14.6" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </Frame>
  )
}

export const DECKERS = [
  { id: 'D0', label: 'D0 — shipping (14 × 15.5)', Glyph: DeckerD0 },
  { id: 'D1', label: 'D1 — taller (14 × 17.0)', Glyph: DeckerD1 },
  { id: 'D2', label: 'D2 — taller + deck line', Glyph: DeckerD2 },
] as const

export const MINIBUSES = [
  { id: 'M1', label: 'M1 — one band, no sign', Glyph: MinibusM1 },
  { id: 'M2', label: 'M2 — sign box, outlined', Glyph: MinibusM2 },
  { id: 'M3', label: 'M3 — sign box, filled', Glyph: MinibusM3 },
  { id: 'M4', label: 'M4 — roof pod, flush', Glyph: MinibusM4 },
  { id: 'M5', label: 'M5 — roof stripe', Glyph: MinibusM5 },
] as const
