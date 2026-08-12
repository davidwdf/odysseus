/**
 * Glyph proposals for the rail's bus token — **candidates, not components** (ADR-112).
 *
 * They live in `lab/` on purpose. `apps/web/src/components/BusGlyph.tsx` is the one that ships; everything
 * here is a drawing to be looked at and mostly thrown away, and the dev-pages gate's one rule is that
 * `src/` may never import from `lab/`. When one of these wins, it is **copied** into `src/` (and its RN
 * twin), not imported from here.
 *
 * ## Corner radii: is there a Lucide rule, and can the windows be tighter?
 *
 * **There is a rule, and it is a two-value system rather than a formula.** Counted across the installed
 * `lucide-react` set: `rx="2"` appears **260** times, `rx="1"` **111**, and the rest are either fully-round
 * pills (`7`/`9`/`10`) or a handful of one-offs (`1.5`, `2.5`, `3`). So Lucide's convention is *2 for an
 * outer shape, 1 for an inner detail* — nothing derived from the gap between them.
 *
 * Measured against that, `BusGlyph` today is **already on the rule for its windows** (`rx=1`, the inner
 * value) and **off it for its body** (`rx=2.5` where Lucide would use 2). `docs/09` §8 pins the 24 px grid,
 * the round caps/joins and the 2 px stroke, and says nothing about radius — so the 2.5 was never a decision.
 * `D1b-r20` below is the version that is on-rule everywhere, and it is worth a look for that reason alone.
 *
 * **The owner's proposed rule** — *"a tighter radius that is the difference of the bus body radius minus the
 * space between the bus sides and windows"* — is the standard **concentric** construction, and it is
 * perfectly adjustable. Worked out here it gives `2.5 − 3 = −0.5`, which clamps to **0**: the padding is
 * wider than the outer radius, so concentricity says *square*. The padding is near-uniform, which is what
 * makes the rule meaningful at all — 3.0 horizontally against 3.53 (D1b) or 3.27 (D1c) vertically.
 *
 * ⚠️ **And the reason the answer matters less than it looks:** `stroke-linejoin="round"` on a 2 px stroke
 * rounds a square corner by roughly half the stroke width, so `rx=0` **renders as about a 1 px visual
 * radius** — which is close to what `rx=1` already draws. The concentric rule and the current value very
 * nearly converge, and the `RADIUS_STUDY` row exists to show whether the remaining difference is visible at
 * all. That floor is a property of the stroke, not of the path: below about `rx=1` the geometry stops being
 * what decides the look.
 */

interface GlyphProps {
  size?: number
  strokeWidth?: number
}

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
/** The gap between a body side and a window side — the input to the concentric rule. */
export const SIDE_INSET = WIN_X - BODY_X
/** What concentricity gives for a body radius, clamped at square. */
export const concentricWinRx = (bodyRx: number) => Math.max(0, bodyRx - SIDE_INSET)

/* ────────────────────────────────────────────────────────────────────────── deckers */

/**
 * A decker at D1's height, parameterised on window height, window radius and body radius.
 *
 * The rhythm is **derived, not typed in**: three equal gaps around two bands, `g = (17 − 2·band) / 3` —
 * which is why *"are they computationally padded perfectly already?"* is yes, and why a taller window can
 * only come out of the gaps. Every D1 variant shares one body height (17.0), so nothing in this series is
 * taller or shorter than another: only the glass changes.
 */
function Decker({
  band,
  winRx = 1,
  bodyRx = 2.5,
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { band: number; winRx?: number; bodyRx?: number }) {
  const s = stroke(strokeWidth)
  const TOP = 2.2
  const HEIGHT = 17
  const gap = (HEIGHT - 2 * band) / 3
  const rx = Math.min(winRx, band / 2)
  return (
    <Frame size={size}>
      <rect x={BODY_X} y={TOP} width={BODY_W} height={HEIGHT} rx={bodyRx} {...s} />
      <rect x={WIN_X} y={TOP + gap} width={WIN_W} height={band} rx={rx} {...s} />
      <rect x={WIN_X} y={TOP + gap * 2 + band} width={WIN_W} height={band} rx={rx} {...s} />
      <Tyres s={s} />
    </Frame>
  )
}

/** **D0 — the shipping decker, unchanged.** Body 14 × 15.5 from y=3. The reference. */
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

export const DeckerD1 = (p: GlyphProps) => <Decker band={2.8} {...p} />
/** **D1b — bands 3.2, gaps 3.53.** One of the owner's two picks. */
export const DeckerD1b = (p: GlyphProps) => <Decker band={3.2} {...p} />
/** **D1c — bands 3.6, gaps 3.27.** The owner's other pick. */
export const DeckerD1c = (p: GlyphProps) => <Decker band={3.6} {...p} />
/**
 * **D1d — bands 4.0, gaps 3.00.** *"seems a bit too tall"* — worth knowing the **body is identical** to
 * D1/D1b/D1c at 17.0, so what reads as a taller bus is taller *glass*: at 4.0 the bands are wider than the
 * 3.00 gap that separates them, so the deck split stops looking like a split.
 */
export const DeckerD1d = (p: GlyphProps) => <Decker band={4.0} {...p} />

/* ───────────────────────────────────────────────────────────────────────── minibuses */

/**
 * The minibus, parameterised on window height, **where the window sits**, and the two radii.
 *
 * Body **14 wide, matching the decker**, window **8 wide, matching its bands**. `topGap` is the roof-to-glass
 * distance: the even-rhythm value centres the window, and the owner has asked for M3n's higher placement
 * instead — a light bus's screen does sit high, and the sign box above it needs the room.
 */
function Minibus({
  band,
  topGap,
  winRx = 1,
  bodyRx = 2.2,
  size = 18,
  strokeWidth = 2,
}: GlyphProps & { band: number; topGap: number; winRx?: number; bodyRx?: number }) {
  const s = stroke(strokeWidth)
  const TOP = 6.6
  const HEIGHT = 12.6
  const rx = Math.min(winRx, band / 2)
  return (
    <Frame size={size}>
      {/* Filled, because an outlined 1.8-high box has no interior left at a 2 px stroke — which is exactly
          why M2 and M3 were indistinguishable. Centred on the body's centre line (x=12). */}
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x={BODY_X} y={TOP} width={BODY_W} height={HEIGHT} rx={bodyRx} {...s} />
      <rect x={WIN_X} y={TOP + topGap} width={WIN_W} height={band} rx={rx} {...s} />
      <Tyres s={s} />
    </Frame>
  )
}

/**
 * **M3n — the round-one drawing, kept as the reference for *placement*.** Narrow body (12) and a wider
 * window (8.4), both of which the owner asked to change — but its window sat **high** (3.0 below the roof)
 * and that is the part being restored.
 */
export function MinibusM3n({ size = 18, strokeWidth = 2 }: GlyphProps) {
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

/** **M7 — the ask: M6's proportions with M3n's high window.** `topGap` 3.0, exactly M3n's. */
export const MinibusM7 = (p: GlyphProps) => <Minibus band={3.4} topGap={3.0} {...p} />
/**
 * **M7b — the same, on a family rule rather than a copied number.** `topGap` 3.27 is **D1c's gap**, so the
 * roof-to-glass distance is identical on both vehicles — which is physically true of the real things and
 * means one number moves both glyphs if the rhythm is ever retuned.
 */
export const MinibusM7b = (p: GlyphProps) => <Minibus band={3.4} topGap={3.27} {...p} />
/** **M7c — high window, taller glass (3.8).** Closest to a real light bus's proportionally bigger screen. */
export const MinibusM7c = (p: GlyphProps) => <Minibus band={3.8} topGap={3.0} {...p} />
/** **M6 — the centred window, kept so the change is visible rather than asserted.** */
export const MinibusM6 = (p: GlyphProps) => <Minibus band={3.4} topGap={4.6} {...p} />

/* ──────────────────────────────────────────────────────────────────── the radius study */

/**
 * The radius sweep, on the owner's two picks. `rx=0` is what their concentric rule gives (`2.5 − 3`,
 * clamped); `rx=1` is Lucide's inner-detail value and what ships today; `band/2` is a full pill. `r20` is
 * the one that puts the **body** on Lucide's outer value of 2 as well, with the window then concentric to it
 * (`2 − 3`, still square).
 */
export const RADIUS_STUDY = [
  {
    id: 'D1b-r0',
    label: 'D1b · win rx 0 (concentric)',
    Glyph: (p: GlyphProps) => <Decker band={3.2} winRx={0} {...p} />,
  },
  {
    id: 'D1b-r05',
    label: 'D1b · win rx 0.5',
    Glyph: (p: GlyphProps) => <Decker band={3.2} winRx={0.5} {...p} />,
  },
  {
    id: 'D1b-r1',
    label: 'D1b · win rx 1 (Lucide, ships)',
    Glyph: (p: GlyphProps) => <Decker band={3.2} winRx={1} {...p} />,
  },
  {
    id: 'D1b-r16',
    label: 'D1b · win rx 1.6 (pill)',
    Glyph: (p: GlyphProps) => <Decker band={3.2} winRx={1.6} {...p} />,
  },
  {
    id: 'D1b-r20',
    label: 'D1b · body rx 2 + win rx 0',
    Glyph: (p: GlyphProps) => <Decker band={3.2} bodyRx={2} winRx={0} {...p} />,
  },
  {
    id: 'D1c-r0',
    label: 'D1c · win rx 0 (concentric)',
    Glyph: (p: GlyphProps) => <Decker band={3.6} winRx={0} {...p} />,
  },
  {
    id: 'D1c-r05',
    label: 'D1c · win rx 0.5',
    Glyph: (p: GlyphProps) => <Decker band={3.6} winRx={0.5} {...p} />,
  },
  {
    id: 'D1c-r1',
    label: 'D1c · win rx 1 (Lucide, ships)',
    Glyph: (p: GlyphProps) => <Decker band={3.6} winRx={1} {...p} />,
  },
  {
    id: 'D1c-r18',
    label: 'D1c · win rx 1.8 (pill)',
    Glyph: (p: GlyphProps) => <Decker band={3.6} winRx={1.8} {...p} />,
  },
  {
    id: 'D1c-r20',
    label: 'D1c · body rx 2 + win rx 0',
    Glyph: (p: GlyphProps) => <Decker band={3.6} bodyRx={2} winRx={0} {...p} />,
  },
  {
    id: 'M7-r0',
    label: 'M7 · win rx 0 (concentric)',
    Glyph: (p: GlyphProps) => <Minibus band={3.4} topGap={3} winRx={0} {...p} />,
  },
  {
    id: 'M7-r1',
    label: 'M7 · win rx 1 (ships)',
    Glyph: (p: GlyphProps) => <Minibus band={3.4} topGap={3} winRx={1} {...p} />,
  },
] as const

export const DECKERS = [
  { id: 'D0', label: 'D0 — shipping (h 15.5)', Glyph: DeckerD0, primary: false },
  { id: 'D1', label: 'D1 — bands 2.8, gap 3.80', Glyph: DeckerD1, primary: false },
  { id: 'D1b', label: 'D1b — bands 3.2, gap 3.53', Glyph: DeckerD1b, primary: true },
  { id: 'D1c', label: 'D1c — bands 3.6, gap 3.27', Glyph: DeckerD1c, primary: false },
  { id: 'D1d', label: 'D1d — bands 4.0, gap 3.00', Glyph: DeckerD1d, primary: false },
] as const

export const MINIBUSES = [
  { id: 'M3n', label: 'M3n — round one (body 12)', Glyph: MinibusM3n, primary: false },
  { id: 'M6', label: 'M6 — window centred', Glyph: MinibusM6, primary: false },
  { id: 'M7', label: 'M7 — high window (top 3.0)', Glyph: MinibusM7, primary: true },
  { id: 'M7b', label: 'M7b — high, D1c’s gap (3.27)', Glyph: MinibusM7b, primary: false },
  { id: 'M7c', label: 'M7c — high, glass 3.8', Glyph: MinibusM7c, primary: false },
] as const
