/**
 * Glyph proposals for the rail's bus token — **candidates, not components** (ADR-112).
 *
 * They live in `lab/` on purpose. `apps/web/src/components/BusGlyph.tsx` is the one that ships; everything
 * here is a drawing to be looked at and mostly thrown away, and the dev-pages gate's one rule is that
 * `src/` may never import from `lab/`. When one of these wins, it is **copied** into `src/` (and its RN
 * twin), not imported from here.
 *
 * ## Settled
 *
 * · **The decker is D1c** — body 14 × 17.0 from y=2.2, two 3.6-high bands, three derived gaps of 3.27, and
 *   **no headlights**: they do not fit (1.27 of clear lower face against the 2.00 a dot needs), and the
 *   shifted-rhythm version that would have made room is not being taken.
 * · **The minibus is the decker's width** (14), with the decker's window width (8), a **high** window
 *   (roof-to-glass 3.0) **4.4 tall**, and a filled roof sign box.
 * · **Radii are Lucide's two values**: body `rx=2`, windows `rx=1`. The concentric alternative was measured
 *   and dropped as unobservable — the whole sweep from square to a full pill is identical at token size,
 *   because a round linejoin on a 2 px stroke rounds a square corner anyway.
 * · **Headlights are out.** Drawn Lucide's way (a zero-length path a round cap paints as a dot) they fit the
 *   minibus and not the decker, and a detail on one vehicle only becomes a *distinguishing* mark rather than
 *   a shared one — which competes with the height-and-pane difference already doing that work.
 *
 * ## The two questions this round
 *
 * **1. Is there anything worth putting in the minibus's empty lower face?** A single horizontal line, less
 * than full width — a bumper, or a plate. The arithmetic is not encouraging and is worth stating before
 * looking: round caps add half the stroke at each end, so a **6-wide path paints 8 wide, which is the
 * window's full width**. "Not full width" therefore caps the path at about 4–5. At token size that is a
 * 2.7–3.3 px dash, a third of the glyph's width and one stroke tall — right at the edge of reading as a mark
 * rather than as dirt. The owner's own default is to leave it empty, and this row exists to confirm that
 * rather than to talk them out of it.
 *
 * **2. Lucide-style wheels.** `bus-front` draws a wheel as `M6 19v2` — a 2-long vertical stroke from the
 * body's bottom edge, not a filled pill. Ours are pills, which `docs/09` §8 records as a deliberate
 * divergence: at a 2 px stroke a tyre's interior is too small to outline. Now that everything else here is
 * on Lucide's rules, that is the one remaining departure, so it is worth seeing rather than assuming.
 * Note the stroke version is not "smaller": a 2-long path with round caps paints **4 tall**, from the body's
 * inner bottom edge to 2 below its outer one, which is exactly how Lucide's own sits.
 */

interface GlyphProps {
  size?: number
  strokeWidth?: number
}

/** Lucide's two values. */
const BODY_RX = 2
const WIN_RX = 1
/** Half the 2 px stroke — how far a path's paint hangs beyond it, at a cap or a join. */
const HALF_STROKE = 1

const BODY_X = 5
const BODY_W = 14
const WIN_X = 8
const WIN_W = 8
/** Where the wheels sit horizontally — the centres our filled pills already use. */
const WHEEL_X = [7.6, 16.4] as const

export type WheelStyle = 'pill' | 'stroke'

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
 * The wheels, either way.
 *
 * `pill` is what ships: a solid rounded rect peeking below the body, filled because at a 2 px stroke its
 * interior is too small to outline (`docs/09` §8). `stroke` is Lucide's: a 2-long vertical path from the
 * body's bottom edge, which its round caps paint 4 tall — so it reads as a wheel emerging from underneath
 * rather than as a shape parked below it.
 */
function Wheels({
  style,
  bodyBottom,
  s,
}: {
  style: WheelStyle
  bodyBottom: number
  s: ReturnType<typeof stroke>
}) {
  if (style === 'stroke') {
    return (
      <>
        {WHEEL_X.map((x) => (
          <path key={x} d={`M${x} ${bodyBottom}v2`} {...s} />
        ))}
      </>
    )
  }
  return (
    <>
      {WHEEL_X.map((x) => (
        <rect
          key={x}
          x={x - 1.2}
          y={bodyBottom}
          width="2.4"
          height="2.6"
          rx="1"
          {...s}
          fill="currentColor"
        />
      ))}
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────────── the decker */

const DECK_TOP = 2.2
const DECK_HEIGHT = 17
const DECK_BAND = 3.6

/** **D1c — settled.** Two 3.6 bands in a derived even rhythm, `gap = (17 − 2·band) / 3` = 3.27. */
function Decker({
  wheels = 'pill',
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { wheels?: WheelStyle }) {
  const s = stroke(strokeWidth)
  const gap = (DECK_HEIGHT - 2 * DECK_BAND) / 3
  return (
    <Frame size={size}>
      <rect x={BODY_X} y={DECK_TOP} width={BODY_W} height={DECK_HEIGHT} rx={BODY_RX} {...s} />
      <rect x={WIN_X} y={DECK_TOP + gap} width={WIN_W} height={DECK_BAND} rx={WIN_RX} {...s} />
      <rect
        x={WIN_X}
        y={DECK_TOP + gap * 2 + DECK_BAND}
        width={WIN_W}
        height={DECK_BAND}
        rx={WIN_RX}
        {...s}
      />
      <Wheels style={wheels} bodyBottom={DECK_TOP + DECK_HEIGHT} s={s} />
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

/* ──────────────────────────────────────────────────────────────────────── the minibus */

const MINI_TOP = 6.6
const MINI_HEIGHT = 12.6
const MINI_TOP_GAP = 3.0
const MINI_BAND = 4.4
/** The clear inner face below the glass runs 15.0 → 18.2, so anything drawn in it centres on 16.6. */
const MINI_FACE_MID =
  (MINI_TOP + MINI_TOP_GAP + MINI_BAND + HALF_STROKE + (MINI_TOP + MINI_HEIGHT - HALF_STROKE)) / 2

/**
 * **The minibus — settled apart from what goes in the lower face.**
 *
 * `line` is a **path** width, not a painted one: round caps add 1 at each end, so `line: 4` paints 6 of the
 * window's 8. `lineY` defaults to the centre of the clear face; a larger value sits it nearer the floor,
 * where a bumper actually is.
 */
function Minibus({
  line,
  lineY = MINI_FACE_MID,
  wheels = 'pill',
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { line?: number; lineY?: number; wheels?: WheelStyle }) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      {/* Filled: an outlined 1.8-high box has no interior left at a 2 px stroke. */}
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x={BODY_X} y={MINI_TOP} width={BODY_W} height={MINI_HEIGHT} rx={BODY_RX} {...s} />
      <rect
        x={WIN_X}
        y={MINI_TOP + MINI_TOP_GAP}
        width={WIN_W}
        height={MINI_BAND}
        rx={WIN_RX}
        {...s}
      />
      {line ? <path d={`M${12 - line / 2} ${lineY}h${line}`} {...s} /> : null}
      <Wheels style={wheels} bodyBottom={MINI_TOP + MINI_HEIGHT} s={s} />
    </Frame>
  )
}

export const DeckerD1c = (p: GlyphProps) => <Decker {...p} />
export const DeckerD1cStroke = (p: GlyphProps) => <Decker wheels="stroke" {...p} />
export const MinibusM = (p: GlyphProps) => <Minibus {...p} />
export const MinibusMStroke = (p: GlyphProps) => <Minibus wheels="stroke" {...p} />

/** The lower-face question, all on pill wheels so only one thing moves. */
export const LOWER_FACE = [
  { id: 'empty', label: 'empty — the default', Glyph: (p: GlyphProps) => <Minibus {...p} /> },
  {
    id: 'l3',
    label: 'line 3 → paints 5 of 8',
    Glyph: (p: GlyphProps) => <Minibus line={3} {...p} />,
  },
  {
    id: 'l4',
    label: 'line 4 → paints 6 of 8',
    Glyph: (p: GlyphProps) => <Minibus line={4} {...p} />,
  },
  {
    id: 'l5',
    label: 'line 5 → paints 7 of 8',
    Glyph: (p: GlyphProps) => <Minibus line={5} {...p} />,
  },
  {
    id: 'l4low',
    label: 'line 4, low (a bumper)',
    Glyph: (p: GlyphProps) => <Minibus line={4} lineY={17.4} {...p} />,
  },
] as const

/** The wheel question, on both vehicles, with nothing else changing. */
export const WHEEL_STUDY = [
  { id: 'd-pill', label: 'D1c · pill wheels (ships)', Glyph: DeckerD1c },
  { id: 'd-stroke', label: 'D1c · Lucide stroke wheels', Glyph: DeckerD1cStroke },
  { id: 'm-pill', label: 'minibus · pill wheels', Glyph: MinibusM },
  { id: 'm-stroke', label: 'minibus · Lucide stroke wheels', Glyph: MinibusMStroke },
] as const

export const DECKERS = [
  { id: 'D0', label: 'D0 — ships today', Glyph: DeckerD0, primary: false },
  { id: 'D1c', label: 'D1c — settled', Glyph: DeckerD1c, primary: true },
] as const

export const MINIBUSES = [
  { id: 'M', label: 'M — window 4.4, empty face', Glyph: MinibusM, primary: true },
] as const
