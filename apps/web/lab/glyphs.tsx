/**
 * Glyph proposals for the rail's bus token — **candidates, not components** (ADR-112).
 *
 * They live in `lab/` on purpose. `apps/web/src/components/BusGlyph.tsx` is the one that ships; everything
 * here is a drawing to be looked at and mostly thrown away, and the dev-pages gate's one rule is that
 * `src/` may never import from `lab/`. When one of these wins, it is **copied** into `src/` (and its RN
 * twin), not imported from here.
 *
 * ## Round two — the owner picked D1 and M2/M3, with three changes
 *
 * *"Bus D1 looks great. Can we keep that height and also test slightly taller windows on it? Or are they
 * computationally padded perfectly already?"* — **They are.** D1's body is 17.0 with two 2.8-high bands, and
 * the three gaps are 3.8 / 3.8 / 3.8 exactly. So there is no slack to take up: a taller window can only come
 * out of the gaps, and the D1b–D1d series below spends it deliberately rather than by accident.
 *
 * *"M2 and M3 look the same as the thick lines result in no outline"* — correct, and it is arithmetic rather
 * than rendering: a 1.8-high box drawn with a 2 px stroke has **less than zero** interior. M2 is dropped;
 * the filled sign is the only honest way to draw one that small.
 *
 * *"make the minibus icon the same width as the double decker — the double is 56 px wide and the mini is
 * 50"* — measured at the lab's 96 px, the decker body is **56 px** (14 × 4) and the minibus was **48 px**
 * (12 × 4). Both are 14 now. The window follows: it was 8.4 wide against the decker's 8, so it now matches
 * at 8 — which is the same fix seen from the other end, since a narrower window in a wider body is what the
 * owner asked for twice.
 *
 * **The trade that buys, stated once.** A real light bus *is* narrower — 2.0 m against 2.5 m — so equal
 * width is a deliberate departure from the proportions round one leaned on. It is the right one here: the
 * token is a fixed 24 px circle, and a narrower glyph inside it reads as *smaller drawing* rather than
 * *smaller vehicle*. All the meaning now rides on **height** (12.6 against 17.0) and the roof sign, which
 * are the two things that survive at 16 px anyway.
 *
 * Everything keeps `BusGlyph`'s DNA: a 24 px grid, 2 px stroke, round caps and joins, `currentColor`
 * throughout, and solid pill tyres peeking below the body on a shared ground line at y=19.2.
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

/** Both tyres, on the ground line every glyph here shares. */
function Tyres({ s }: { s: ReturnType<typeof stroke> }) {
  return (
    <>
      <rect x="6.4" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
      <rect x="15.2" y="19.2" width="2.4" height="2.6" rx="1" {...s} fill="currentColor" />
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────────── deckers */

/**
 * A decker at D1's height with a chosen window height — the whole D1 series is this one function.
 *
 * The rhythm is **derived, not typed in**: three equal gaps around two bands, `g = (17 − 2·band) / 3`. That
 * is what "computationally padded" means here, and writing it as arithmetic rather than as four sets of
 * hand-placed coordinates is what stops a later tweak quietly breaking the evenness.
 */
function DeckerAtBand({ band, size = 18, strokeWidth = 2 }: GlyphProps & { band: number }) {
  const s = stroke(strokeWidth)
  const TOP = 2.2
  const HEIGHT = 17
  const gap = (HEIGHT - 2 * band) / 3
  const rx = Math.min(1, band / 2)
  return (
    <Frame size={size}>
      <rect x="5" y={TOP} width="14" height={HEIGHT} rx="2.5" {...s} />
      <rect x="8" y={TOP + gap} width="8" height={band} rx={rx} {...s} />
      <rect x="8" y={TOP + gap * 2 + band} width="8" height={band} rx={rx} {...s} />
      <Tyres s={s} />
    </Frame>
  )
}

/** **D0 — the shipping decker, unchanged.** Body 14 × 15.5 from y=3. Kept as the reference. */
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

/** **D1 — the owner's pick.** Body 14 × 17.0, bands 2.8, gaps 3.8 / 3.8 / 3.8. */
export const DeckerD1 = (p: GlyphProps) => <DeckerAtBand band={2.8} {...p} />
/** **D1b — bands 3.2.** Gaps fall to 3.53; the glazed interior goes 0.8 → 1.2, half again as much glass. */
export const DeckerD1b = (p: GlyphProps) => <DeckerAtBand band={3.2} {...p} />
/** **D1c — bands 3.6.** Gaps 3.27, interior 1.6 — twice D1's glass, and the roof starts to look thin. */
export const DeckerD1c = (p: GlyphProps) => <DeckerAtBand band={3.6} {...p} />
/**
 * **D1d — bands 4.0.** The only one whose arithmetic lands clean: gaps are exactly 3.0 and the interior is
 * exactly 2.0, i.e. the glass is finally as thick as the stroke around it. Watch the deck split, which is
 * the *gap* and is now narrower than the bands it separates.
 */
export const DeckerD1d = (p: GlyphProps) => <DeckerAtBand band={4.0} {...p} />

/* ───────────────────────────────────────────────────────────────────────── minibuses */

/**
 * The minibus, parameterised on window height. Same construction rule as the decker — even rhythm, derived:
 * two gaps around one band, `g = (12.6 − band) / 2`.
 *
 * Body **14 wide, matching the decker**, and the window **8 wide, matching the decker's bands**. What is
 * left to tell them apart is height (12.6 against 17.0) and the roof sign, which is the point.
 */
function MinibusAtBand({ band, size = 18, strokeWidth = 2 }: GlyphProps & { band: number }) {
  const s = stroke(strokeWidth)
  const TOP = 6.6
  const HEIGHT = 12.6
  const gap = (HEIGHT - band) / 2
  const rx = Math.min(1.1, band / 2)
  return (
    <Frame size={size}>
      {/* The sign box, filled — an outlined 1.8-high box has no interior left at a 2 px stroke, which is
          exactly why M2 and M3 were indistinguishable. Centred on the body's own centre line (x=12). */}
      <rect x="8.8" y="4.6" width="6.4" height="1.8" rx="0.8" {...s} fill="currentColor" />
      <rect x="5" y={TOP} width="14" height={HEIGHT} rx="2.2" {...s} />
      <rect x="8" y={TOP + gap} width="8" height={band} rx={rx} {...s} />
      <Tyres s={s} />
    </Frame>
  )
}

/**
 * **M3n — the previous pick, kept as the "before".** Narrow body (12) and a wider window (8.4), which is
 * the combination the owner asked to change. Here so the change is visible rather than asserted.
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

/** **M6 — the asked-for one.** Body 14 (matches the decker), window 8 (matches its bands), 3.4 high. */
export const MinibusM6 = (p: GlyphProps) => <MinibusAtBand band={3.4} {...p} />
/** **M6b — window 3.0.** The decker's band height plus a little; the most "family" of the three. */
export const MinibusM6b = (p: GlyphProps) => <MinibusAtBand band={3.0} {...p} />
/** **M6c — window 3.8.** A light bus's screen really is proportionally bigger; this is that, at 14 wide. */
export const MinibusM6c = (p: GlyphProps) => <MinibusAtBand band={3.8} {...p} />

/** `primary` marks the leading candidate on each side — the pairing row uses it to stay readable. */
export const DECKERS = [
  { id: 'D0', label: 'D0 — shipping (h 15.5)', Glyph: DeckerD0, primary: false },
  { id: 'D1', label: 'D1 — bands 2.8, gap 3.80', Glyph: DeckerD1, primary: true },
  { id: 'D1b', label: 'D1b — bands 3.2, gap 3.53', Glyph: DeckerD1b, primary: false },
  { id: 'D1c', label: 'D1c — bands 3.6, gap 3.27', Glyph: DeckerD1c, primary: false },
  { id: 'D1d', label: 'D1d — bands 4.0, gap 3.00', Glyph: DeckerD1d, primary: false },
] as const

export const MINIBUSES = [
  { id: 'M3n', label: 'M3n — before (body 12, win 8.4)', Glyph: MinibusM3n, primary: false },
  { id: 'M6', label: 'M6 — body 14, win 8 × 3.4', Glyph: MinibusM6, primary: true },
  { id: 'M6b', label: 'M6b — body 14, win 8 × 3.0', Glyph: MinibusM6b, primary: false },
  { id: 'M6c', label: 'M6c — body 14, win 8 × 3.8', Glyph: MinibusM6c, primary: false },
] as const
