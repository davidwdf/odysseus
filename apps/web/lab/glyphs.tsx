/**
 * Glyph proposals for the rail's bus token — **candidates, not components** (ADR-112).
 *
 * They live in `lab/` on purpose. `apps/web/src/components/BusGlyph.tsx` is the one that ships; everything
 * here is a drawing to be looked at and mostly thrown away, and the dev-pages gate's one rule is that
 * `src/` may never import from `lab/`. When one of these wins, it is **copied** into `src/` (and its RN
 * twin), not imported from here.
 *
 * ## Settled (round four)
 *
 * · **Radii are Lucide's, everywhere.** Body `rx=2`, windows `rx=1`. That is the two-value system the
 *   installed `lucide-react` set actually uses — `rx="2"` 260 times, `rx="1"` 111 — rather than a formula.
 *   The shipping glyph's body was 2.5, which was never a decision: `docs/09` §8 pins the 24 px grid, the
 *   2 px stroke and the round caps/joins and has never mentioned radius.
 *
 *   The concentric alternative (window radius = body radius − side inset) was measured and **abandoned as
 *   unobservable**: it gives `2 − 3 → 0`, i.e. square, and `stroke-linejoin="round"` on a 2 px stroke rounds
 *   a square corner by about half the stroke anyway. The whole sweep from 0 to a full pill was **visually
 *   identical at token size** in a browser. Below about `rx=1` the stroke decides the look, not the path —
 *   so the radius was chosen on the rule, because nothing else could choose it.
 *
 * · **The decker is D1c**: body 14 × 17.0 from y=2.2, two 3.6-high bands, three derived gaps of 3.27.
 *
 * · **The minibus is the decker's width** (14) with the decker's window width (8), a **high** window
 *   (roof-to-glass 3.0), and a filled roof sign box. Its **window height is the one open question** — the
 *   owner is *"kind of liking a height around 4.4"*, so `MINIBUSES` is that sweep and nothing else.
 *
 * ## Why the minibus glass is allowed to be taller than the decker's
 *
 * It is not an inconsistency. A light bus really does have a proportionally bigger windscreen — one deck of
 * glass instead of two bands sharing the same face — so at 4.4 the minibus reads as *one big screen* against
 * the decker's *two slots*, which is a second axis of difference on top of height. What to watch as it grows:
 * the glazed interior passes the 2 px stroke at band 4.0 (interior 2.0), and the aspect ratio passes 2:1 at
 * the same point, after which the window stops reading as a *band* and starts reading as a *pane*.
 */

interface GlyphProps {
  size?: number
  strokeWidth?: number
}

/** Lucide's two values, settled in round four. */
const BODY_RX = 2
const WIN_RX = 1

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

/**
 * **A headlight, drawn the way Lucide draws one.** `bus-front` and `tram-front` both use a **zero-length
 * path** — `M8 15h.01` — which with `stroke-linecap="round"` paints a round dot exactly one stroke-width
 * across. Three things that buys, and they are why this is worth copying rather than reinventing:
 * the dot's size is the stroke's, so it never needs its own constant and cannot drift from it; it is
 * stroke-only, so it inherits `currentColor` with no `fill` override; and it is the same idiom Lucide uses
 * for every dot in the set, so a reader who knows Lucide reads it without being told.
 *
 * Positioned at x = 8 and 16 — **±4 from the body's centre line, which is Lucide's own offset** in
 * `bus-front`, and which here lands directly below the window's two corners. (Our body is 14 wide against
 * Lucide's 16, so the *proportional* equivalent would be 8.5 and 15.5; the absolute match reads better
 * because it lines up with the glass.)
 */
function Headlights({ y, s }: { y: number; s: ReturnType<typeof stroke> }) {
  return (
    <>
      <path d={`M8 ${y}h.01`} {...s} />
      <path d={`M16 ${y}h.01`} {...s} />
    </>
  )
}

/**
 * Both tyres, on the ground line every glyph here shares.
 *
 * ⚠️ **Lucide would draw these as short vertical strokes**, not filled pills — `bus-front` uses
 * `M6 19v2`. The pill is a deliberate, documented divergence (`docs/09` §8): at a 2 px stroke a tyre's
 * interior is too small to outline. Noted here because the rest of this file has just been brought onto
 * Lucide's rules, and this is the one place that stays off them on purpose.
 */
function Tyres({ s }: { s: ReturnType<typeof stroke> }) {
  return (
    <>
      <rect x="6.4" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </>
  )
}

const BODY_X = 5
const BODY_W = 14
const WIN_X = 8
const WIN_W = 8
/** Half the 2 px stroke — the amount a path's paint hangs either side of it. */
const HALF_STROKE = 1

/* ────────────────────────────────────────────────────────────────────────── the decker */

/**
 * **The decker, settled.** Two bands in a derived even rhythm: `gap = (17 − 2·band) / 3`, which for D1c's
 * 3.6 bands is 3.27 three times over. Written as arithmetic rather than as placed coordinates so a later
 * retune cannot quietly break the evenness — the property that made *"are they padded perfectly?"* a yes.
 */
function Decker({
  band,
  gap,
  headlights = false,
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { band: number; gap?: number; headlights?: boolean }) {
  const s = stroke(strokeWidth)
  const TOP = 2.2
  const HEIGHT = 17
  // Undefined `gap` means the even rhythm — three equal gaps around two bands. Passing one explicitly
  // spends the difference on the LOWER face instead, which is what makes room for headlights.
  const g = gap ?? (HEIGHT - 2 * band) / 3
  const lowerBandEnd = TOP + g * 2 + band * 2
  const lampY = (lowerBandEnd + HALF_STROKE + (TOP + HEIGHT - HALF_STROKE)) / 2
  return (
    <Frame size={size}>
      <rect x={BODY_X} y={TOP} width={BODY_W} height={HEIGHT} rx={BODY_RX} {...s} />
      <rect x={WIN_X} y={TOP + g} width={WIN_W} height={band} rx={WIN_RX} {...s} />
      <rect x={WIN_X} y={TOP + g * 2 + band} width={WIN_W} height={band} rx={WIN_RX} {...s} />
      {headlights ? <Headlights y={lampY} s={s} /> : null}
      <Tyres s={s} />
    </Frame>
  )
}

/** **D0 — what ships today.** Body 14 × 15.5 from y=3, bands 2.8, body `rx` 2.5. Kept as the "before". */
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

/** **D1c — the pick.** Bands 3.6, even gaps 3.27, Lucide radii, no headlights (they do not fit). */
export const DeckerD1c = (p: GlyphProps) => <Decker band={3.6} {...p} />
/** **D1c with headlights forced** — kept to *show* the collision rather than assert it. */
export const DeckerD1cLampsForced = (p: GlyphProps) => <Decker band={3.6} headlights {...p} />
/**
 * **D1s — the same bands, shifted up so there is a lower face to put lamps on.** Top and middle gaps 2.6,
 * bottom 4.6, which gives 2.60 of clear inner face against the 2.00 a dot needs.
 *
 * It gives up the even rhythm on purpose, and the trade is arguable both ways: evenness was a nice property
 * and nothing depended on it, while a real bus genuinely has more sheet metal below its windows than above.
 */
export const DeckerD1s = (p: GlyphProps) => <Decker band={3.6} gap={2.6} {...p} />
export const DeckerD1sLamps = (p: GlyphProps) => <Decker band={3.6} gap={2.6} headlights {...p} />

/* ──────────────────────────────────────────────────────────────────────── the minibus */

/** Roof-to-glass, fixed at M3n's high placement — the owner asked for the window up here. */
const MINI_TOP_GAP = 3.0

/**
 * **The minibus, settled apart from its window height.** Body 14 × 12.6 from y=6.6 (so the tyres share the
 * decker's ground line at 19.2), window 8 wide starting 3.0 below the roof, and a **filled** sign box above
 * the roofline — filled because an outlined 1.8-high box has no interior left at a 2 px stroke, which is why
 * the outlined and filled variants were indistinguishable two rounds ago.
 */
function Minibus({
  band,
  headlights = false,
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { band: number; headlights?: boolean }) {
  const s = stroke(strokeWidth)
  const TOP = 6.6
  const HEIGHT = 12.6
  const winEnd = TOP + MINI_TOP_GAP + band
  const lampY = (winEnd + HALF_STROKE + (TOP + HEIGHT - HALF_STROKE)) / 2
  return (
    <Frame size={size}>
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x={BODY_X} y={TOP} width={BODY_W} height={HEIGHT} rx={BODY_RX} {...s} />
      <rect x={WIN_X} y={TOP + MINI_TOP_GAP} width={WIN_W} height={band} rx={WIN_RX} {...s} />
      {headlights ? <Headlights y={lampY} s={s} /> : null}
      <Tyres s={s} />
    </Frame>
  )
}

/** **The minibus, settled at window 4.4.** */
export const MinibusM = (p: GlyphProps) => <Minibus band={4.4} {...p} />
/** **The same, with Lucide-dot headlights** — which fit here, with 3.20 of clear face against a need of 2.00. */
export const MinibusMLamps = (p: GlyphProps) => <Minibus band={4.4} headlights {...p} />

export const DECKERS = [
  { id: 'D0', label: 'D0 — ships today', Glyph: DeckerD0, primary: false },
  { id: 'D1c', label: 'D1c — the pick, no lamps', Glyph: DeckerD1c, primary: true },
  { id: 'D1c!', label: 'D1c + lamps — collides', Glyph: DeckerD1cLampsForced, primary: false },
  { id: 'D1s', label: 'D1s — bands up 2.6/2.6/4.6', Glyph: DeckerD1s, primary: false },
  { id: 'D1s+', label: 'D1s + lamps — fits', Glyph: DeckerD1sLamps, primary: false },
] as const

export const MINIBUSES = [
  { id: 'M', label: 'M — window 4.4, no lamps', Glyph: MinibusM, primary: true },
  { id: 'M+', label: 'M + lamps — fits', Glyph: MinibusMLamps, primary: false },
] as const
