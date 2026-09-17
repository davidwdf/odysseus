import type { RouteDetailView } from '@nextbus/core'
import { ArrowLeft, ChevronUp, Clock, MapPin, RotateCw, Ruler } from 'lucide-react'
import { useRef, useState } from 'react'
import { JourneyLines } from '../src/components/JourneyLines'
import { RouteChip } from '../src/components/RouteChip'
import { useFlip, useHeightFlip } from '../src/hooks/useFlip'
import { RouteContextCard } from '../src/screens/route/RouteContextCard'

/**
 * **The route header lab — the settled shapes, the open question, and one glyph.**
 *
 * Round 1 of this page compared three whole headers and the owner settled three things from it: expanded,
 * the glass should **encompass the back control and the badge** rather than run underneath a separate
 * floating lens; collapsed, the badge should be **bigger**; and the Messages island should be **compact** —
 * less padding, a slightly smaller name, still semibold. Section 1 is those, built.
 *
 * What is still open is the **from/to block**, so section 2 is six of them side by side over the same two
 * names: what ships today, the gutter elbow from round 1, the owner's A and B, and two of mine. They are
 * deliberately rendered in one shared card shell, because the question is about the block and a comparison
 * that also changes the frame answers a different one.
 *
 * Section 3 is the direction-swap glyph, which is lucide's `GitCompareArrows` — two **circles** joined by
 * arrows. If the terminus square wins upstairs, that glyph is the last circle left claiming to be a
 * terminus, so it gets a square-noded twin here to be looked at beside the original.
 *
 * **Everything here except section 1's reference column is lab-local.** ADR-112's rule: the lab imports
 * `src/`, `src/` never imports the lab, and a layout nobody has chosen is not a `variant` prop.
 */
export function HeaderLab() {
  const [collapsed, setCollapsed] = useState(false)
  const [circular, setCircular] = useState(false)
  const [long, setLong] = useState(true)
  /** Section 3's glyph, in place: every direction control on this page follows this switch. */
  const [squareSwap, setSquareSwap] = useState(false)

  const header: RouteDetailView['header'] = {
    operator: 'KMB',
    routeNo: '68X',
    origin: long ? 'Yuen Long (Tin Yiu Estate)' : 'Yuen Long',
    destination: circular
      ? 'Circular via Tai Kok Tsui'
      : long
        ? 'Jordan (Kwun Chung Street)'
        : 'Jordan',
    circular,
    label: 'Yuen Long → Jordan',
    collapsedLabel: '→ Jordan',
    ...(circular ? {} : { reverseId: 'kmb+68X+2' }),
  }

  swapShape = squareSwap ? 'square' : 'round'

  return (
    <div className="min-h-screen bg-surface-2 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Toggle on={collapsed} onChange={setCollapsed} label="collapsed" />
        <Toggle on={circular} onChange={setCircular} label="circular route" />
        <Toggle on={long} onChange={setLong} label="long names" />
        <Toggle on={squareSwap} onChange={setSquareSwap} label="square swap glyph" />
      </div>

      <h2 className="m-0 mb-2 text-h3 font-semibold text-text">1 · The card</h2>
      <p className="m-0 mb-3 max-w-[820px] text-caption text-subtle">
        Left: what ships. Right: the settled shape — one glass surface around the back control and
        the badge when open, and a compact island under a bigger badge when collapsed. Press{' '}
        <em>collapsed</em> to move between them; the height is animated, not cut.
      </p>
      <div className="mb-8 flex flex-wrap gap-4">
        <Frame id="A" caption="A — shipping (RouteContextCard)">
          <RouteContextCard
            header={header}
            collapsed={collapsed}
            facts={<FactsStrip />}
            expandLabel="Show route details"
            collapseLabel="Hide route details"
            onCollapse={() => setCollapsed(true)}
            onExpand={() => setCollapsed(false)}
            journey={
              <JourneyLines
                origin={header.origin}
                destination={header.destination}
                circular={header.circular}
                nonce={0}
              />
            }
            swap={header.circular ? undefined : <SwapStub />}
          />
        </Frame>
        <Frame id="S" caption="S — settled: enclosing card · compact island" lens={false}>
          <SettledHeader header={header} collapsed={collapsed} />
        </Frame>
      </div>

      <h2 className="m-0 mb-2 text-h3 font-semibold text-text">2 · The from/to block</h2>
      <p className="m-0 mb-3 max-w-[820px] text-caption text-subtle">
        One shell, six blocks, the same two names. 0 and 1 are where we have been; A and B are
        yours; C and D are mine.
      </p>
      <div className="mb-8 flex flex-wrap gap-4">
        {JOURNEYS.map((variant) => (
          <JourneyTile key={variant.id} variant={variant} header={header} />
        ))}
      </div>

      <h2 className="m-0 mb-2 text-h3 font-semibold text-text">3 · The swap glyph</h2>
      <p className="m-0 mb-3 max-w-[820px] text-caption text-subtle">
        lucide's <code>git-compare-arrows</code>, and the same glyph with its two circles redrawn as
        squares — so the control agrees with the terminus marker beside it.
      </p>
      <div data-swaps className="flex flex-wrap items-center gap-6">
        {([18, 20, 24, 40] as const).map((size) => (
          <div key={size} className="flex items-center gap-3">
            <SwapControl size={size} shape="round" />
            <SwapControl size={size} shape="square" />
            <span className="text-caption text-subtle">{size}px</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Which node shape every in-place direction control on this page draws, set by the toggle.
 *
 * A module variable rather than a context or a prop chain, and only because this is a lab: the control
 * appears inside the *real* `RouteContextCard` too, which takes the element as a `swap` prop and has no
 * opinion about its glyph. Threading a context through it to answer a question about an icon would be
 * building the thing before choosing it.
 */
let swapShape: 'round' | 'square' = 'round'

// ── the shell ──────────────────────────────────────────────────────────────────────────────────

/** The stand-in basemap's street lines — a value each, so the key is the line rather than its index. */
const STREET_LINES = [42, 84, 126, 168, 210, 252, 294, 336, 378]

/** A phone-width slab of "map" for the glass to sit on — the card is transparent, so a flat page lies. */
function Frame({
  id,
  caption,
  lens = true,
  children,
}: {
  id: string
  caption: string
  /** Draw the floating back lens behind the card. Off where the card is meant to *contain* it. */
  lens?: boolean
  children: React.ReactNode
}) {
  return (
    <div data-frame={id} className="w-[390px]">
      <p className="m-0 mb-2 text-caption text-subtle">{caption}</p>
      {/* `transform` rather than `position: relative` alone: variant A is the **real** card, which is
          `position: fixed`, and only a transformed ancestor makes a fixed child stay inside this box. */}
      <div
        className="relative h-[300px] overflow-hidden rounded-xl border border-border"
        style={{ transform: 'translateZ(0)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-surface-2 via-surface to-surface-2" />
        <div className="absolute inset-0">
          {STREET_LINES.map((top) => (
            <div key={top} className="absolute h-px w-full bg-border" style={{ top }} />
          ))}
        </div>
        {lens ? (
          <div className="absolute top-3 left-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface/70 text-text">
            <ArrowLeft size={22} aria-hidden />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  )
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`rounded-full border border-border px-3 py-1 text-caption ${
        on ? 'bg-accent text-accent-contrast' : 'bg-surface text-muted'
      }`}
    >
      {label}
    </button>
  )
}

/** The facts strip's shape, not its logic — three pills is what the screen renders for a KMB route. */
function FactsStrip({ align = 'center' }: { align?: 'center' | 'start' }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        align === 'start' ? 'justify-start' : 'justify-center'
      }`}
    >
      {[
        { glyph: MapPin, value: '34 stops' },
        { glyph: Clock, value: '68 min', note: 'approx.' },
        { glyph: Ruler, value: '26.4 km' },
      ].map((fact) => (
        <span
          key={fact.value}
          className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5"
        >
          <fact.glyph size={13} aria-hidden className="text-subtle" />
          <span className="text-caption font-medium text-muted tabular-nums">{fact.value}</span>
          {fact.note ? (
            <>
              <span className="text-caption text-subtle">·</span>
              <span className="text-caption text-subtle">{fact.note}</span>
            </>
          ) : null}
        </span>
      ))}
    </div>
  )
}

/** The direction control's box, so the layouts are judged with the space it takes. */
function SwapStub({ shape }: { shape?: 'round' | 'square' }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text">
      <SwapGlyph size={18} shape={shape ?? swapShape} />
    </span>
  )
}

// ── 1 · the settled card ───────────────────────────────────────────────────────────────────────

/**
 * **The settled shape**, built from the owner's three decisions.
 *
 * · **Open, the glass encloses the back control and the badge.** Today the expanded card slides *under* a
 *   separately floating lens, and the badge is centred largely to push the destination clear of it — two
 *   glass objects overlapping, with the layout arranged around the overlap. One surface removes the
 *   problem instead of accommodating it: back at the left, badge centred, collapse at the right, all on
 *   one row of one pane. **The consequence to notice before shipping:** the screen's own `<BackButton />`
 *   must not draw while this is open, or there are two.
 * · **Collapsed, the badge is bigger** — `lg` rather than `md`. It is the only identity left on screen at
 *   that size, and the island's whole argument is that the number is the subject.
 * · **The island is compact**: `px-3 py-1` against the round-1 mockup's `px-4 pt-3.5 pb-2`, and the name
 *   at `text-label` (14 px) semibold rather than `text-body` (16). Measured, that is 46 px against the
 *   round-1 island's 68 and today's pill's 46 — the treatment stops costing anything at all.
 */
function SettledHeader({
  header,
  collapsed,
}: {
  header: RouteDetailView['header']
  collapsed: boolean
}) {
  const card = useRef<HTMLDivElement | null>(null)
  const badge = useRef<HTMLSpanElement | null>(null)
  useFlip(badge, collapsed ? 'island' : 'card')
  useHeightFlip(card, collapsed ? 'island' : 'card')

  if (collapsed) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center">
        <span className="relative z-10">
          <RouteChip
            operator={header.operator}
            routeNo={header.routeNo}
            size="lg"
            chipRef={badge}
          />
        </span>
        {/* The lap is 10 px of a 34 px badge — enough that the two read as one object, shallow enough
            that the name never has to make room for it. */}
        <div className="-mt-2.5 glass-pane pointer-events-auto flex max-w-[calc(100%-96px)] items-center gap-1.5 rounded-pill border border-border px-3 pt-3 pb-1">
          {header.circular ? (
            <RotateCw size={12} aria-hidden className="shrink-0 text-subtle" />
          ) : (
            <ArrowRightGlyph />
          )}
          <span className="truncate text-label font-semibold text-text">{header.destination}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-20">
      <div
        ref={card}
        className="glass-pane pointer-events-auto flex w-full flex-col gap-2 overflow-hidden rounded-sheet border border-border px-2 pt-2 pb-1"
      >
        {/* One row, three things, one pane: the back control is *inside* the card now rather than a
            second piece of glass on top of it. */}
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-text"
          >
            <ArrowLeft size={22} aria-hidden />
          </button>
          <span className="flex flex-1 justify-center">
            <RouteChip
              operator={header.operator}
              routeNo={header.routeNo}
              size="lg"
              chipRef={badge}
            />
          </span>
          <button
            type="button"
            aria-label="Hide route details"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-subtle"
          >
            <ChevronUp size={18} aria-hidden />
          </button>
        </div>
        <div className="flex w-full items-center gap-2 px-1">
          <div className="min-w-0 flex-1">
            <JourneyBlock variant={SETTLED_JOURNEY} header={header} />
          </div>
          {header.circular ? null : <SwapStub />}
        </div>
        <div className="flex w-full justify-start px-1 pb-1">
          <FactsStrip align="start" />
        </div>
      </div>
    </div>
  )
}

/** The pill's direction mark, sized for a 14 px name. */
function ArrowRightGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <path
        d="M1 6 H9 M6 3 L9.5 6 L6 9"
        className="stroke-subtle"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

// ── 2 · the from/to block ──────────────────────────────────────────────────────────────────────

type JourneyVariant = {
  id: string
  caption: string
  note: string
}

const JOURNEYS: JourneyVariant[] = [
  { id: '0', caption: '0 — today', note: 'Centred, with a ↓ inside the destination line.' },
  {
    id: '1',
    caption: '1 — gutter elbow',
    note: 'Round 1: square, rail, elbow pointing at the name.',
  },
  {
    id: 'A',
    caption: 'A — origin, then an elbow',
    note: 'Yours: origin on its own line; the arrow turns under it and points at the destination.',
  },
  {
    id: 'B',
    caption: 'B — two termini and a rail',
    note: 'Yours: the schematic in miniature — a square each end, the route line between, one double chevron.',
  },
  {
    id: 'C',
    caption: 'C — the journey as a bar',
    note: 'Mine: the rail laid horizontally, so both names get the card’s full width instead of sharing it.',
  },
  {
    id: 'D',
    caption: 'D — destination first',
    note: 'Mine: no glyph at all. The destination leads, the origin is a “from …” line under it — which is what the collapsed pill already says.',
  },
]

/**
 * Which block the settled card is drawn with, until the owner picks one. `B` — the two-terminus rail —
 * is a placeholder here, not a decision: section 2 is the decision.
 */
const SETTLED_JOURNEY: JourneyVariant = { id: 'B', caption: '', note: '' }

function JourneyTile({
  variant,
  header,
}: {
  variant: JourneyVariant
  header: RouteDetailView['header']
}) {
  return (
    <div data-journey={variant.id} className="w-[390px]">
      <p className="m-0 mb-2 text-caption text-subtle">{variant.caption}</p>
      <div className="rounded-xl border border-border bg-gradient-to-br from-surface-2 via-surface to-surface-2 p-3">
        <div className="glass-pane flex items-center gap-2 rounded-sheet border border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <JourneyBlock variant={variant} header={header} />
          </div>
          {header.circular ? null : <SwapStub />}
        </div>
      </div>
      <p className="m-0 mt-2 h-10 text-caption text-subtle">{variant.note}</p>
    </div>
  )
}

function JourneyBlock({
  variant,
  header,
}: {
  variant: JourneyVariant
  header: RouteDetailView['header']
}) {
  const origin = <span className="block truncate text-label text-muted">{header.origin}</span>
  const destination = (
    <span className="block truncate text-h3 font-semibold text-text">{header.destination}</span>
  )

  if (variant.id === '0') {
    return (
      <span className="flex flex-col items-center gap-0.5">
        <span className="block max-w-full truncate text-label text-muted">{header.origin}</span>
        <span className="flex max-w-full items-center gap-1.5">
          <ArrowDownGlyph />
          <span className="truncate text-h3 font-semibold text-text">{header.destination}</span>
        </span>
      </span>
    )
  }

  if (variant.id === '1') {
    return (
      <div className="flex items-center gap-1.5">
        <GutterElbow circular={header.circular} />
        <div className="min-w-0 flex-1">
          {origin}
          {destination}
        </div>
      </div>
    )
  }

  // A — the origin has the line to itself; the arrow turns beneath it and points at the destination.
  if (variant.id === 'A') {
    return (
      <div className="min-w-0">
        {origin}
        <div className="flex min-w-0 items-center gap-1.5">
          <CornerArrow />
          {destination}
        </div>
      </div>
    )
  }

  // B — the schematic in miniature: a terminus square at each end of a rail, one double chevron on it.
  // The two lines get **10 px of extra leading here and nowhere else**: the rail needs a span between its
  // nodes long enough for a chevron to sit in, and at the natural line spacing the glyph lands on top of
  // both squares. That is the honest cost of this variant and it is why it is worth seeing beside the
  // others rather than described.
  if (variant.id === 'B') {
    return (
      <div className="flex min-w-0 items-start gap-2">
        <MiniRail circular={header.circular} />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {origin}
          {destination}
        </div>
      </div>
    )
  }

  // C — the rail laid horizontally above the two names, which then get the whole width each.
  if (variant.id === 'C') {
    return (
      <div className="min-w-0">
        <div className="relative flex h-3 w-full items-center">
          <JourneyBar circular={header.circular} />
          {header.circular ? null : <JourneyBarMarks />}
        </div>
        <div className="mt-1 flex min-w-0 items-baseline gap-3">
          <span className="min-w-0 max-w-[45%] shrink truncate text-label text-muted">
            {header.origin}
          </span>
          <span className="min-w-0 flex-1 truncate text-right text-h3 font-semibold text-text">
            {header.destination}
          </span>
        </div>
      </div>
    )
  }

  // D — words instead of a glyph, and the destination leads.
  return (
    <div className="min-w-0">
      {destination}
      <span className="block truncate text-label text-muted">
        {header.circular ? 'circular route' : `from ${header.origin}`}
      </span>
    </div>
  )
}

/** Today's mark: a downward arrow that sits inside the destination line. */
function ArrowDownGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <path
        d="M7 2 V11 M3.5 7.5 L7 11 L10.5 7.5"
        className="stroke-subtle"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

/**
 * Round 1's gutter: a terminus square over the origin, the route line down, an elbow that turns and
 * points at the destination's name.
 */
function GutterElbow({ circular }: { circular: boolean }) {
  if (circular) {
    return (
      <span className="flex w-5 shrink-0 items-center justify-center">
        <RotateCw size={15} aria-hidden className="text-route" />
      </span>
    )
  }
  return (
    <svg
      width={20}
      height={GUTTER_H}
      viewBox={`0 0 20 ${GUTTER_H}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={`M6 ${SQ_CY + 5} V${DEST_CY} H14`}
        className="stroke-route-soft"
        strokeWidth={3}
        fill="none"
      />
      <path
        d={`M13 ${DEST_CY - 5} L19.5 ${DEST_CY} L13 ${DEST_CY + 5} Z`}
        className="fill-route-soft"
      />
      <rect
        x={1.75}
        y={SQ_CY - 4.25}
        width={8.5}
        height={8.5}
        className="fill-surface stroke-route"
        strokeWidth={1.5}
      />
    </svg>
  )
}

/** A — the corner arrow, sitting at the head of the destination's own line. */
function CornerArrow() {
  return (
    <svg width="17" height="18" viewBox="0 0 17 18" aria-hidden="true" className="shrink-0">
      {/* Starts above the line box, so it reads as coming down from the origin above it. */}
      <path d="M4 0 V10 H11" className="stroke-route-soft" strokeWidth={3} fill="none" />
      <path d="M10 5 L16.5 10 L10 15 Z" className="fill-route-soft" />
    </svg>
  )
}

/**
 * B — the schematic, one column wide: a terminus square at each end, the route line between them, and a
 * single double chevron at its midpoint. The same three marks `RouteStopRow` draws, at header scale.
 *
 * The chevron is drawn **on** the line here rather than cut *out* of it. On the schematic the notch is
 * painted in the row's own background (ADR-161); this line sits on glass, which has no background colour
 * to paint with, so the mark is positive — `route` against the `route-soft` line.
 */
function MiniRail({ circular }: { circular: boolean }) {
  if (circular) {
    return (
      <span className="flex h-[50px] w-4 shrink-0 items-center justify-center">
        <RotateCw size={15} aria-hidden className="text-route" />
      </span>
    )
  }
  return (
    <svg
      width={13}
      height={RAIL_H}
      viewBox={`0 0 13 ${RAIL_H}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={`M6.5 ${RAIL_TOP} V${RAIL_BOTTOM}`}
        className="stroke-route-soft"
        strokeWidth={3.5}
        fill="none"
      />
      <g
        className="stroke-route"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d={`M3.9 ${RAIL_MID - 4.2} 6.5 ${RAIL_MID - 1.6} 9.1 ${RAIL_MID - 4.2}`} />
        <path d={`M3.9 ${RAIL_MID + 1.2} 6.5 ${RAIL_MID + 3.8} 9.1 ${RAIL_MID + 1.2}`} />
      </g>
      <rect
        x={2.25}
        y={RAIL_TOP - 4.25}
        width={8.5}
        height={8.5}
        className="fill-surface stroke-route"
        strokeWidth={1.5}
      />
      <rect
        x={2.25}
        y={RAIL_BOTTOM - 4.25}
        width={8.5}
        height={8.5}
        className="fill-surface stroke-route"
        strokeWidth={1.5}
      />
    </svg>
  )
}

/** C — the same rail, laid on its side over the two names. */
function JourneyBar({ circular }: { circular: boolean }) {
  if (circular) {
    return (
      <span className="flex h-3 items-center gap-1.5 text-route">
        <RotateCw size={13} aria-hidden />
        <span className="h-[3px] flex-1 bg-route-soft" />
      </span>
    )
  }
  return (
    <svg
      height={11}
      width="100%"
      viewBox="0 0 100 11"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block"
    >
      {/* `preserveAspectRatio="none"` would stretch the squares with the box, so only the LINE is drawn in
          this stretched space; the nodes and the chevron are drawn by `JourneyBarMarks` on top of it in
          real pixels. A square that is 40 px wide and 8 tall is not a terminus. */}
      <path
        d="M0 5.5 H100"
        className="stroke-route-soft"
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** C's fixed-size marks: a terminus at each end, the pair of chevrons in the middle, all in real pixels. */
function JourneyBarMarks() {
  return (
    <>
      <TerminusSquare className="-translate-y-1/2 absolute top-1/2 left-0" />
      <TerminusSquare className="-translate-y-1/2 absolute top-1/2 right-0" />
      <svg
        width="11"
        height="10"
        viewBox="0 0 11 10"
        aria-hidden="true"
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2"
      >
        <g
          className="stroke-route"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <path d="M1.2 2.2 4 5 1.2 7.8" />
          <path d="M6.5 2.2 9.3 5 6.5 7.8" />
        </g>
      </svg>
    </>
  )
}

/** The rail's terminus node, at header size: filled `surface`, stroked `route`, 1.5 px, 9 px square. */
function TerminusSquare({
  className = '',
  style,
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <rect
        x="0.75"
        y="0.75"
        width="7.5"
        height="7.5"
        className="fill-surface stroke-route"
        strokeWidth="1.5"
      />
    </svg>
  )
}

// ── 3 · the swap glyph ─────────────────────────────────────────────────────────────────────────

/**
 * lucide's `git-compare-arrows`, and the same drawing with its two circles redrawn as squares.
 *
 * The arms are lucide's own paths, untouched — what changes is the two nodes, from `r: 3` circles to
 * 6 px squares on the same centres, so the glyph still reads as one icon from that family. Rounded joins
 * rather than the rail's sharp corners: every other arm in this glyph is round-joined, and a mitred
 * square beside them looks like a different icon rather than the same one.
 */
function SwapGlyph({ size, shape }: { size: number; shape: 'round' | 'square' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shape === 'round' ? (
        <>
          <circle cx="5" cy="6" r="3" />
          <circle cx="19" cy="18" r="3" />
        </>
      ) : (
        <>
          <rect x="2" y="3" width="6" height="6" />
          <rect x="16" y="15" width="6" height="6" />
        </>
      )}
      <path d="M12 6h5a2 2 0 0 1 2 2v7" />
      <path d="m15 9-3-3 3-3" />
      <path d="M12 18H7a2 2 0 0 1-2-2V9" />
      <path d="m9 15 3 3-3 3" />
    </svg>
  )
}

function SwapControl({ size, shape }: { size: number; shape: 'round' | 'square' }) {
  return (
    <span
      className="flex items-center justify-center rounded-full border border-border bg-surface-2 text-text"
      style={{ width: Math.max(36, size + 18), height: Math.max(36, size + 18) }}
    >
      <SwapGlyph size={size} shape={shape} />
    </span>
  )
}

// ── geometry ───────────────────────────────────────────────────────────────────────────────────

/**
 * The gutter's geometry, against the two lines it runs beside: the origin is `text-label` at 14/20, so
 * its centre is 10, and the destination is `text-h3` at 18/24 below it, so its centre is 20 + 12.
 */
const ORIGIN_LINE_H = 20
const DEST_LINE_H = 24
const SQ_CY = ORIGIN_LINE_H / 2
const DEST_CY = ORIGIN_LINE_H + DEST_LINE_H / 2
const GUTTER_H = ORIGIN_LINE_H + DEST_LINE_H

/**
 * B's rail, which is taller than the gutter because its two lines are 6 px further apart — see the
 * variant. Node centres are the two lines' own centres, and the chevron sits exactly between them.
 */
const B_LEADING = 10
const RAIL_TOP = ORIGIN_LINE_H / 2
const RAIL_BOTTOM = ORIGIN_LINE_H + B_LEADING + DEST_LINE_H / 2
const RAIL_MID = (RAIL_TOP + RAIL_BOTTOM) / 2
const RAIL_H = ORIGIN_LINE_H + B_LEADING + DEST_LINE_H
