import type { RouteDetailView } from '@nextbus/core'
import { ArrowRight, ChevronUp, Clock, MapPin, RotateCw, Ruler } from 'lucide-react'
import { useRef, useState } from 'react'
import { JourneyLines } from '../src/components/JourneyLines'
import { RouteChip } from '../src/components/RouteChip'
import { useFlip, useHeightFlip } from '../src/hooks/useFlip'
import { RouteContextCard } from '../src/screens/route/RouteContextCard'

/**
 * **The route header lab — three layouts of the same facts, side by side.**
 *
 * ADR-156 settled the route header on round 4's floating context card, and the owner has two questions
 * about it that no test can answer and that a screenshot of one layout cannot either: *is the from/to
 * block making good use of the space, and is it clear which way the bus is going?* Both are comparative,
 * so this page puts the shipping card next to two answers to them and lets the same names, the same
 * badge and the same collapse run through all three.
 *
 * · **A — shipping.** The real `RouteContextCard` and the real `JourneyLines`, imported unchanged. So the
 *   collapse here is the collapse, including the height animation `useHeightFlip` added, and this lab is
 *   also where that gets watched: a headless browser produces no frames, so *does it still cut?* is a
 *   question only an eye in a real tab can answer.
 * · **B — left-aligned, with a gutter rail.** The two names share a left edge and the direction is drawn
 *   rather than glyphed: a dot at the origin, the route line between, an arrowhead at the destination —
 *   the schematic's own vocabulary (ADR-161), one column wide.
 * · **C — the Messages header.** The owner's third idea, kept deliberately away from the app: the badge
 *   centred with a glass pill below it holding where the bus is going, the badge overlapping the pill's
 *   top edge, the way iOS Messages stacks an avatar over a name.
 *
 * **B and C are lab-local components on purpose.** Neither is a `variant` prop on the shipping card,
 * because a prop is a promise: it has to be typed, spec'd, kept working and eventually removed. A layout
 * nobody has chosen yet belongs in the room where ADR-112 says the lab lives — this file imports from
 * `src/`, and nothing in `src/` imports from here.
 */
export function HeaderLab() {
  const [collapsed, setCollapsed] = useState(false)
  const [circular, setCircular] = useState(false)
  const [long, setLong] = useState(true)
  /** The island's badge at the chip's two sizes — Messages' avatar is prominent, and a route number may
   *  want to be too. The one thing about this treatment that is purely taste, so it is a switch. */
  const [bigBadge, setBigBadge] = useState(false)

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

  return (
    <div className="min-h-screen bg-surface-2 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Toggle on={collapsed} onChange={setCollapsed} label="collapsed" />
        <Toggle on={circular} onChange={setCircular} label="circular route" />
        <Toggle on={long} onChange={setLong} label="long names" />
        <Toggle on={bigBadge} onChange={setBigBadge} label="island: big badge" />
        <p className="m-0 text-caption text-subtle">
          Press <em>collapsed</em> repeatedly — the box's height is animated now, not cut.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <Frame caption="A — shipping (RouteContextCard)">
          {/* The real card is `fixed`, so it needs the frame to be the containing block for it: a
              `transform` establishes one, which is why the frame carries `translate-x-0`. */}
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

        <Frame caption="B — proposed expanded · today's collapsed pill">
          <ProposedHeader header={header} collapsed={collapsed} collapsedAs="pill" />
        </Frame>

        <Frame caption="C — proposed expanded · Messages island collapsed">
          <ProposedHeader
            header={header}
            collapsed={collapsed}
            collapsedAs="island"
            islandBadge={bigBadge ? 'lg' : 'md'}
          />
        </Frame>
      </div>
    </div>
  )
}

/** The stand-in basemap's street lines — a value each, so the key is the line rather than its index. */
const STREET_LINES = [42, 84, 126, 168, 210, 252, 294, 336, 378]

/** A phone-width slab of "map" for the glass to sit on — the card is transparent, so a flat page lies. */
function Frame({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="w-[390px]">
      <p className="m-0 mb-2 text-caption text-subtle">{caption}</p>
      {/* `transform` rather than `position: relative` alone: variant A is the **real** card, which is
          `position: fixed`, and only a transformed ancestor makes a fixed child stay inside this box. */}
      <div
        className="relative h-[420px] overflow-hidden rounded-xl border border-border"
        style={{ transform: 'translateZ(0)' }}
      >
        {/* Stand-in for the basemap: enough tonal variation that a glass pane reads as glass. */}
        <div className="absolute inset-0 bg-gradient-to-br from-surface-2 via-surface to-surface-2" />
        <div className="absolute inset-0">
          {STREET_LINES.map((top) => (
            <div key={top} className="absolute h-px w-full bg-border" style={{ top }} />
          ))}
        </div>
        {/* The back lens's footprint, so a layout can be judged against the thing it has to clear. */}
        <div className="absolute top-3 left-3 h-12 w-12 rounded-full border border-border bg-surface/70" />
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
function SwapStub() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 text-text">
      <RotateCw size={16} aria-hidden />
    </span>
  )
}

/**
 * **B — the names share a left edge, and the direction is a rail rather than a glyph.**
 *
 * Three things change from the shipping card, and each answers one half of the owner's question:
 *
 *  1. **Both lines start at the same x.** Centred, a short origin over a long destination is a ragged
 *     column and the eye has to re-find the start of the second line; ragged text also wastes the
 *     difference between the two lengths, which on HK names is most of a phone's width.
 *  2. **The 36 px spacer opposite the swap control goes.** It existed to keep centred text optically
 *     centred against the control. Left-aligned text does not need balancing, so the block gets that
 *     width back — with the swap still at the right edge, where the pill's chevron is.
 *  3. **The arrow becomes a gutter rail.** In the shipping card an `ArrowDown` sits *inside* the
 *     destination line, immediately left of the name, where it reads as a bullet rather than as a
 *     direction. A dot, a line and an arrowhead down the left of both lines is the same claim in the
 *     schematic's own vocabulary (ADR-161), and it says which line is the start.
 */
function ProposedHeader({
  header,
  collapsed,
  collapsedAs,
  islandBadge = 'md',
}: {
  header: RouteDetailView['header']
  collapsed: boolean
  /** Which collapsed treatment to compare: today's left-anchored pill, or the Messages island. */
  collapsedAs: 'pill' | 'island'
  islandBadge?: 'md' | 'lg'
}) {
  const card = useRef<HTMLDivElement | null>(null)
  const badge = useRef<HTMLSpanElement | null>(null)
  // The real hooks, so the prototype's motion is the app's motion rather than an impression of it.
  useFlip(badge, collapsed ? 'collapsed' : 'card')
  useHeightFlip(card, collapsed ? 'collapsed' : 'card')

  if (collapsed && collapsedAs === 'island')
    return <Island header={header} badge={badge} size={islandBadge} />

  return (
    <div
      className="pointer-events-none absolute right-3 z-20"
      style={{
        top: 12,
        left: collapsed ? 72 : 12,
        transition: 'left 500ms cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      <div
        ref={card}
        className={`glass-pane pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-pill border border-border ${
          collapsed ? 'gap-0 px-3 py-2' : 'gap-2 px-3 pt-3 pb-1'
        }`}
      >
        {collapsed ? (
          <div className="flex w-full items-center gap-2">
            <RouteChip operator={header.operator} routeNo={header.routeNo} chipRef={badge} />
            {header.circular ? null : (
              <ArrowRight size={14} aria-hidden className="shrink-0 text-subtle" />
            )}
            <span className="min-w-0 flex-1 truncate font-semibold text-body text-text">
              {header.destination}
            </span>
          </div>
        ) : (
          <>
            <div
              className="grid w-full items-center gap-2"
              style={{ gridTemplateColumns: '48px 1fr 48px' }}
            >
              <span aria-hidden />
              <span className="flex justify-center">
                <RouteChip
                  operator={header.operator}
                  routeNo={header.routeNo}
                  size="lg"
                  chipRef={badge}
                />
              </span>
              <span className="flex justify-end text-subtle">
                <ChevronUp size={18} aria-hidden />
              </span>
            </div>
            <div className="flex w-full items-center gap-2">
              <div className="flex min-w-0 flex-1 gap-2.5">
                {header.circular ? (
                  <span className="flex w-3 shrink-0 items-center justify-center">
                    <RotateCw size={14} aria-hidden className="text-route" />
                  </span>
                ) : (
                  <Gutter />
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="m-0 truncate text-label font-normal text-muted">{header.origin}</p>
                  <p className="m-0 truncate text-title font-semibold text-text">
                    {header.destination}
                  </p>
                </div>
              </div>
              <span className="flex shrink-0 justify-end">
                {header.circular ? null : <SwapStub />}
              </span>
            </div>
            {/* Left-aligned too: the shipping card centres the strip because the journey above it is
                centred, and the note in `RouteContextCard` says exactly that. Change the axis of the
                journey and the strip has to follow, or the card has two axes. */}
            <div className="flex w-full justify-start">
              <FactsStrip align="start" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The rail, one column wide: a hollow node at the origin, the route line, an arrowhead at the
 * destination. Hollow above and solid below for the schematic's own reason — a stop you have left and a
 * stop you are heading for are drawn differently there too.
 */
function Gutter() {
  return (
    <span aria-hidden className="relative flex w-3 shrink-0 flex-col items-center">
      <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full border-2 border-route-soft bg-bg" />
      <span className="w-1 flex-1 bg-route-soft" />
      <span className="-mt-px flex shrink-0 flex-col items-center">
        <span className="h-2 w-1 bg-route" />
        <svg width="11" height="7" viewBox="0 0 11 7" aria-hidden="true">
          <path d="M0.5 0 L5.5 6 L10.5 0 Z" className="fill-route" />
        </svg>
      </span>
    </span>
  )
}

/**
 * **The Messages island — the COLLAPSED state.**
 *
 * The owner's idea, corrected: the badge-over-pill stack is what a collapsed header should be, not an
 * expanded one. That reading is the better one for a reason worth writing down — the collapsed header's
 * whole job is *identity plus destination*, which is exactly the two things a Messages header carries
 * (who, and nothing else). The expanded card has four jobs and no room to be an island.
 *
 * It also fixes what the expanded version of this could not do: a centred island **clears the floating
 * back lens by construction**, so the collapsed pill no longer has to start 72 px in, and it takes the
 * width its text needs instead of the width that is left.
 *
 * `useFlip` still owns the badge, so the number travels from the expanded card's centre to here — a
 * shorter, almost purely vertical move, which is the one thing this treatment makes *easier* to animate
 * than today's leftward pill.
 */
function Island({
  header,
  badge,
  size,
}: {
  header: RouteDetailView['header']
  badge: React.RefObject<HTMLSpanElement | null>
  size: 'md' | 'lg'
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center">
      <span className="relative z-10">
        <RouteChip
          operator={header.operator}
          routeNo={header.routeNo}
          size={size}
          chipRef={badge}
        />
      </span>
      {/* The overlap is one number: the badge laps 12 px over the pill's top edge, and the pill's own
          `pt` puts its text clear of it. */}
      <div className="glass-pane pointer-events-auto -mt-3 flex max-w-[calc(100%-96px)] items-center gap-1.5 rounded-pill border border-border px-4 pt-3.5 pb-2">
        {header.circular ? (
          <RotateCw size={13} aria-hidden className="shrink-0 text-subtle" />
        ) : (
          <ArrowRight size={13} aria-hidden className="shrink-0 text-subtle" />
        )}
        <span className="truncate font-semibold text-body text-text">{header.destination}</span>
      </div>
    </div>
  )
}
