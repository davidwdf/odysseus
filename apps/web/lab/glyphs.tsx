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

/** Both tyres, on the ground line every glyph here shares. */
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

/* ────────────────────────────────────────────────────────────────────────── the decker */

/**
 * **The decker, settled.** Two bands in a derived even rhythm: `gap = (17 − 2·band) / 3`, which for D1c's
 * 3.6 bands is 3.27 three times over. Written as arithmetic rather than as placed coordinates so a later
 * retune cannot quietly break the evenness — the property that made *"are they padded perfectly?"* a yes.
 */
function Decker({ band, size = 18, strokeWidth = 2 }: GlyphProps & { band: number }) {
  const s = stroke(strokeWidth)
  const TOP = 2.2
  const HEIGHT = 17
  const gap = (HEIGHT - 2 * band) / 3
  return (
    <Frame size={size}>
      <rect x={BODY_X} y={TOP} width={BODY_W} height={HEIGHT} rx={BODY_RX} {...s} />
      <rect x={WIN_X} y={TOP + gap} width={WIN_W} height={band} rx={WIN_RX} {...s} />
      <rect x={WIN_X} y={TOP + gap * 2 + band} width={WIN_W} height={band} rx={WIN_RX} {...s} />
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

/** **D1c — the pick.** Bands 3.6, gaps 3.27, Lucide radii. */
export const DeckerD1c = (p: GlyphProps) => <Decker band={3.6} {...p} />

/* ──────────────────────────────────────────────────────────────────────── the minibus */

/** Roof-to-glass, fixed at M3n's high placement — the owner asked for the window up here. */
const MINI_TOP_GAP = 3.0

/**
 * **The minibus, settled apart from its window height.** Body 14 × 12.6 from y=6.6 (so the tyres share the
 * decker's ground line at 19.2), window 8 wide starting 3.0 below the roof, and a **filled** sign box above
 * the roofline — filled because an outlined 1.8-high box has no interior left at a 2 px stroke, which is why
 * the outlined and filled variants were indistinguishable two rounds ago.
 */
function Minibus({ band, size = 18, strokeWidth = 2 }: GlyphProps & { band: number }) {
  const s = stroke(strokeWidth)
  const TOP = 6.6
  const HEIGHT = 12.6
  return (
    <Frame size={size}>
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x={BODY_X} y={TOP} width={BODY_W} height={HEIGHT} rx={BODY_RX} {...s} />
      <rect x={WIN_X} y={TOP + MINI_TOP_GAP} width={WIN_W} height={band} rx={WIN_RX} {...s} />
      <Tyres s={s} />
    </Frame>
  )
}

/**
 * The window-height sweep, which is the only open question left.
 *
 * `interior` is the glazed area left inside a 2 px stroke, and `ratio` is width : height. Both cross a
 * threshold at **4.0** — the interior becomes as thick as the stroke around it, and the shape passes 2:1 —
 * which is where a *band* starts reading as a *pane*. 6.6 is included as the far end rather than as a
 * candidate: it is the symmetric case, where roof-to-glass and glass-to-floor are both 3.0.
 */
export const MINI_HEIGHTS = [
  { band: 3.8, note: 'interior 1.8 · 2.11:1' },
  { band: 4.0, note: 'interior 2.0 · 2.00:1' },
  { band: 4.2, note: 'interior 2.2 · 1.90:1' },
  { band: 4.4, note: 'interior 2.4 · 1.82:1' },
  { band: 4.6, note: 'interior 2.6 · 1.74:1' },
  { band: 5.0, note: 'interior 3.0 · 1.60:1' },
  { band: 6.6, note: 'symmetric · 1.21:1' },
] as const

export const DECKERS = [
  { id: 'D0', label: 'D0 — ships today', Glyph: DeckerD0, primary: false },
  { id: 'D1c', label: 'D1c — the pick (bands 3.6)', Glyph: DeckerD1c, primary: true },
] as const

export const MINIBUSES = MINI_HEIGHTS.map(({ band, note }) => ({
  id: `M-${band}`,
  label: `window ${band} — ${note}`,
  Glyph: (p: GlyphProps) => <Minibus band={band} {...p} />,
  primary: band === 4.4,
}))
