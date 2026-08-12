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

/**
 * **The tyre pill, the rule it never had, and the 2 units nobody had noticed.**
 *
 * `docs/09` §8 says the tyres are *filled* — "at a 2 px stroke their interior is too small to outline" —
 * and says nothing about their **size**. The shipping `2.4 × 2.6` is a hand-picked Wave 1 value.
 *
 * ⚠️ **But `2.4` is not what a rider sees.** The pill carries a `fill` **and** the shared 2 px stroke, so
 * the stroke adds one unit on every side: the painted pill is **4.4 × 4.6**, measured by rasterising the
 * shipping glyph and scanning the pixel row through the tyres (ink runs 5.4 → 9.8). That is **31 % of the
 * 14-wide body**, and it is why the pill reads as a foot rather than a wheel — the painted ratio is
 * 1.045 : 1, essentially square, not the 1.08 : 1 the attributes suggest.
 *
 * So the stroke on this shape is doing nothing but padding: the rect is filled, so an outline of the same
 * colour only makes it bigger. **`pillStroke: false` is therefore the real lever** — with the stroke gone,
 * the path width *is* the painted width, and "thinner" becomes something you can actually specify.
 * `fill 4.4` reproduces today's silhouette exactly, with a number that finally means what it says.
 */
const PILL_W = 2.4
const PILL_H = 2.6

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
  pillW = PILL_W,
  pillH = PILL_H,
  pillStroke = true,
  s,
}: {
  style: WheelStyle
  bodyBottom: number
  pillW?: number
  pillH?: number
  /** False drops the redundant outline, so the path width *is* the painted width. */
  pillStroke?: boolean
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
          x={x - pillW / 2}
          y={bodyBottom}
          width={pillW}
          height={pillH}
          rx={Math.min(pillStroke ? 1 : 2, pillW / 2)}
          {...(pillStroke ? s : { stroke: 'none' })}
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
  pillW,
  pillStroke,
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { wheels?: WheelStyle; pillW?: number; pillStroke?: boolean }) {
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
      <Wheels
        style={wheels}
        bodyBottom={DECK_TOP + DECK_HEIGHT}
        pillW={pillW}
        pillStroke={pillStroke}
        s={s}
      />
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
  topGap = MINI_TOP_GAP,
  wheels = 'pill',
  pillW,
  pillStroke,
  size = 18,
  strokeWidth = 2,
}: GlyphProps & {
  line?: number
  lineY?: number
  topGap?: number
  wheels?: WheelStyle
  pillW?: number
  pillStroke?: boolean
}) {
  const s = stroke(strokeWidth)
  return (
    <Frame size={size}>
      {/* Filled: an outlined 1.8-high box has no interior left at a 2 px stroke. */}
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x={BODY_X} y={MINI_TOP} width={BODY_W} height={MINI_HEIGHT} rx={BODY_RX} {...s} />
      <rect x={WIN_X} y={MINI_TOP + topGap} width={WIN_W} height={MINI_BAND} rx={WIN_RX} {...s} />
      {line ? <path d={`M${12 - line / 2} ${lineY}h${line}`} {...s} /> : null}
      <Wheels
        style={wheels}
        bodyBottom={MINI_TOP + MINI_HEIGHT}
        pillW={pillW}
        pillStroke={pillStroke}
        s={s}
      />
    </Frame>
  )
}

/** Both vehicles side by side, so a shared change is judged on the family rather than on one drawing. */
function Pair({
  pillW,
  miniPillW,
  pillStroke,
  size = 18,
}: GlyphProps & { pillW?: number; miniPillW?: number; pillStroke?: boolean }) {
  return (
    <span className="flex items-end gap-1">
      <Decker pillW={pillW} pillStroke={pillStroke} size={size} />
      <Minibus topGap={3.27} pillW={miniPillW ?? pillW} pillStroke={pillStroke} size={size} />
    </span>
  )
}

export const DeckerD1c = (p: GlyphProps) => <Decker {...p} />
export const DeckerD1cStroke = (p: GlyphProps) => <Decker wheels="stroke" {...p} />
export const MinibusM = (p: GlyphProps) => <Minibus {...p} />
export const MinibusMStroke = (p: GlyphProps) => <Minibus wheels="stroke" {...p} />

/**
 * **Roof-to-glass on the minibus: 3.0, or the decker's own 3.27?**
 *
 * 3.27 is not a nearby number, it is *the decker's gap* — so the roof-to-glass distance becomes identical on
 * both vehicles, which is true of the real things and means one constant retunes both glyphs. The cost is
 * 0.27 off the clear lower face (3.20 → 2.93), which nothing now occupies.
 */
export const MINI_TOP_GAP_STUDY = [
  {
    id: 'tg30',
    label: 'roof-to-glass 3.0',
    Glyph: (p: GlyphProps) => <Minibus topGap={3.0} {...p} />,
  },
  {
    id: 'tg327',
    label: "roof-to-glass 3.27 — the decker's gap",
    Glyph: (p: GlyphProps) => <Minibus topGap={3.27} {...p} />,
  },
] as const

/**
 * **The tyre pill's width**, swept against the rule proposed above (one stroke = 2.0). Height is held at 2.6
 * throughout, because head-on a tyre shows its tread and should read taller than wide — thinning it is what
 * makes that ratio appear rather than a separate change.
 *
 * The last two cells are the question underneath: should the smaller vehicle get **smaller wheels**? True of
 * the real things, and unlike a face detail it cannot compete with the one-pane-against-two-slots difference,
 * because it happens below the body rather than on it.
 */
/**
 * The pill sweep, rebuilt once the stroke was measured. **Every label is the PAINTED width**, which is the
 * only number that describes what a rider sees.
 *
 * The first three keep the outline, so painted = path + 2 and the shipping value is the 4.4 at the top. The
 * rest drop it (`pillStroke: false`), where painted = path — and `fill 4.4` is today's silhouette exactly,
 * which is what makes the row a fair comparison rather than a redesign.
 *
 * The old sweep asked the wrong question: it moved the path between 2.4 and 1.8, i.e. the painted width
 * between 4.4 and 3.8, a 14 % change dressed up as a 25 % one.
 */
export const PILL_STUDY = [
  {
    id: 'p44',
    label: 'painted 4.4 — ships today (stroke + fill)',
    Glyph: (p: GlyphProps) => <Pair pillW={2.4} {...p} />,
  },
  {
    id: 'p40',
    label: 'painted 4.0 (stroke + fill, path 2.0)',
    Glyph: (p: GlyphProps) => <Pair pillW={2.0} {...p} />,
  },
  {
    id: 'f44',
    label: 'painted 4.4 — fill only, same silhouette',
    Glyph: (p: GlyphProps) => <Pair pillW={4.4} pillStroke={false} {...p} />,
  },
  {
    id: 'f36',
    label: 'painted 3.6 — fill only',
    Glyph: (p: GlyphProps) => <Pair pillW={3.6} pillStroke={false} {...p} />,
  },
  {
    id: 'f30',
    label: 'painted 3.0 — fill only',
    Glyph: (p: GlyphProps) => <Pair pillW={3.0} pillStroke={false} {...p} />,
  },
  {
    id: 'f26',
    label: 'painted 2.6 — fill only, one stroke wider than tall',
    Glyph: (p: GlyphProps) => <Pair pillW={2.6} pillStroke={false} {...p} />,
  },
] as const

export const DECKERS = [
  { id: 'D0', label: 'D0 — ships today', Glyph: DeckerD0, primary: false },
  { id: 'D1c', label: 'D1c — settled', Glyph: DeckerD1c, primary: true },
] as const

export const MINIBUSES = [
  { id: 'M', label: 'M — window 4.4, empty face', Glyph: MinibusM, primary: true },
] as const
