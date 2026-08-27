import type { RailBus, RouteStopRowView } from '@nextbus/core'
import { routeMarkers } from '@nextbus/core'
import { useEffect, useRef, useState } from 'react'
import { RailBusToken } from '../src/components/RailBusToken'
import { RouteStopRow } from '../src/components/RouteStopRow'
import { useRailFlip } from '../src/hooks/useRailFlip'

/**
 * **The rail motion lab — local-only scaffolding, never committed** (see the repo's `info/exclude`).
 *
 * It exists to answer the one question about ADR-110 that no test and no headless browser can: *does the
 * bus move nicely?* The automation tab is always `visibilityState: "hidden"` and a hidden tab produces no
 * frames, so `document.timeline` never advances there and every animation sits frozen at its first
 * keyframe. The travel was verified structurally — keyframes read back at `translateY(−104px)` against a
 * measured layout delta of −104 px — but structure is not feel.
 *
 * What it drives is the **real** components: `RouteStopRow`, `RailBusToken` and `useRailFlip`, unchanged,
 * against hand-written `RouteStopRowView`s. There is no `DataSource`, no query client and no router, which
 * is the point — a bus advances because a timer says so, on a rail whose row heights you can change from
 * the panel while it moves.
 */
export function RailLab() {
  const [running, setRunning] = useState(true)
  const [intervalMs, setIntervalMs] = useState(5000)
  /** The lead bus's target stop, and whether it is standing at it or still on the way. */
  const [tick, setTick] = useState(0)
  /** A second bus, four stops behind, so phase and independence are both visible. */
  const [twoBuses, setTwoBuses] = useState(true)
  /** Give every third row an arrivals line, so the rail's rows are not all the same height. */
  const [ragged, setRagged] = useState(true)
  /** The reflow that broke the old measurement: add a line to a row *above* the bus while it sits still. */
  const [reflowed, setReflowed] = useState(false)
  const [savedStops, setSavedStops] = useState(true)
  /** How many buses are on the rail at all — 0 is what a route out of service looks like. */
  const [onRail, setOnRail] = useState(2)
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound')

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setTick((t) => t + 1), intervalMs)
    return () => window.clearInterval(timer)
  }, [running, intervalMs])

  /*
    A bus's journey, as the kernel would describe it: it approaches a stop on the segment, then stands at
    it, then approaches the next. Two ticks per stop, which is what makes the two kinds of move visible
    separately — the half-row hop from a segment onto the node above it, and the full-row hop onto the next
    segment. `railBus` only ever emits `from: toIndex − 1`, so this is the whole vocabulary.
  */
  const busAt = (t: number): RailBus => {
    // A positive modulo, because JS's `%` keeps the sign of its left operand — the trailing bus is
    // `tick - 7`, and a negative stop index owns no row, so it simply would not be drawn.
    const beats = 2 * STOPS
    const phase = ((t % beats) + beats) % beats
    const target = Math.floor(phase / 2)
    const atStop = phase % 2 === 1
    if (atStop || target === 0) {
      return { kind: 'node', index: target, label: `Bus at ${NAMES[target] ?? 'stop'}` }
    }
    return {
      kind: 'segment',
      from: target - 1,
      to: target,
      label: `Bus approaching ${NAMES[target] ?? 'stop'}`,
    }
  }

  const wanted = twoBuses ? onRail : Math.min(onRail, 1)
  const buses: RailBus[] = [busAt(tick), busAt(tick - 7)].slice(0, wanted)

  // The screen's own grouping, copied so the lab exercises the same shape: a bus AT node N belongs to row
  // N, a bus on the segment INTO node N belongs to row N−1.
  const byRow = new Map<number, ReturnType<typeof token>[]>()
  function token(bus: RailBus, ordinal: number) {
    return (
      <RailBusToken
        key={ordinal}
        ordinal={ordinal}
        bus={bus}
        // The token wears the shape of the node it is standing at, exactly as the screen does — which
        // is the whole reason this lab drives the real components. A bus on the SEGMENT between two
        // stops is at no stop, so it stays a disc.
        shape={bus.kind === 'node' ? (NODE_KINDS[bus.index] ?? 'stop') : 'stop'}
      />
    )
  }
  buses.forEach((bus, ordinal) => {
    const owner = bus.kind === 'node' ? bus.index : bus.from
    const carried = byRow.get(owner)
    if (carried === undefined) byRow.set(owner, [token(bus, ordinal)])
    else carried.push(token(bus, ordinal))
  })

  const list = useRef<HTMLDivElement | null>(null)
  const ghosts = useRef<HTMLDivElement | null>(null)
  // Keyed on the direction, exactly as the screen keys it on the payload's route id: a flip is a different
  // set of buses, not a bus that moved, so nothing should slide across it.
  useRailFlip(list, ghosts, direction)

  const rows = Array.from({ length: STOPS }, (_, i) => stopRow(i, { ragged, reflowed, savedStops }))

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <Panel
        running={running}
        setRunning={setRunning}
        intervalMs={intervalMs}
        setIntervalMs={setIntervalMs}
        twoBuses={twoBuses}
        setTwoBuses={setTwoBuses}
        ragged={ragged}
        setRagged={setRagged}
        reflowed={reflowed}
        setReflowed={setReflowed}
        savedStops={savedStops}
        setSavedStops={setSavedStops}
        direction={direction}
        setDirection={setDirection}
        step={() => setTick((t) => t + 1)}
        back={() => setTick((t) => t - 1)}
        jump={() => setTick((t) => t + 12)}
        onRail={onRail}
        setOnRail={setOnRail}
        buses={buses}
      />
      <div ref={list} className="relative mt-2">
        {rows.map((row, index) => (
          <RouteStopRow
            key={`${row.seq}-${row.stopId}`}
            row={row}
            index={index}
            animateIn={false}
            tokens={byRow.get(index)}
            onPress={() => {}}
            onMenu={() => {}}
            kind={NODE_KINDS[index] ?? 'stop'}
            registerRow={() => {}}
          />
        ))}
        <div
          ref={ghosts}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
        />
      </div>
    </main>
  )
}

// ── the controls ───────────────────────────────────────────────────────────────────────────────

function Panel(props: {
  running: boolean
  setRunning: (v: boolean) => void
  intervalMs: number
  setIntervalMs: (v: number) => void
  twoBuses: boolean
  setTwoBuses: (v: boolean) => void
  ragged: boolean
  setRagged: (v: boolean) => void
  reflowed: boolean
  setReflowed: (v: boolean) => void
  savedStops: boolean
  setSavedStops: (v: boolean) => void
  direction: 'outbound' | 'inbound'
  setDirection: (v: 'outbound' | 'inbound') => void
  step: () => void
  back: () => void
  jump: () => void
  onRail: number
  setOnRail: (v: number) => void
  buses: RailBus[]
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur">
      <p className="m-0 mb-2 text-label font-semibold text-text">Rail motion lab — not committed</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => props.setRunning(!props.running)} lit={props.running}>
          {props.running ? 'Pause' : 'Play'}
        </Button>
        <Button onClick={props.back}>← step</Button>
        <Button onClick={props.step}>step →</Button>
        <Button onClick={props.jump}>jump 6 stops</Button>
        <label className="flex items-center gap-1 text-caption text-muted">
          every
          <select
            value={props.intervalMs}
            onChange={(e) => props.setIntervalMs(Number(e.target.value))}
            className="rounded-sm border border-border bg-bg px-1 py-0.5 text-caption text-text"
          >
            {[1000, 2000, 3000, 5000, 8000].map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000}s
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() =>
            props.setDirection(props.direction === 'outbound' ? 'inbound' : 'outbound')
          }
        >
          flip direction ({props.direction})
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => props.setTwoBuses(!props.twoBuses)} lit={props.twoBuses}>
          two buses
        </Button>
        <Button onClick={() => props.setRagged(!props.ragged)} lit={props.ragged}>
          ragged row heights
        </Button>
        <Button onClick={() => props.setReflowed(!props.reflowed)} lit={props.reflowed}>
          reflow rows above
        </Button>
        <Button onClick={() => props.setSavedStops(!props.savedStops)} lit={props.savedStops}>
          saved stars
        </Button>
        {/* The two pops, on demand: 2 → 1 → 0 draws buses off the rail one at a time, 0 → 2 draws them on. */}
        <Button onClick={() => props.setOnRail(props.onRail === 0 ? 2 : props.onRail - 1)}>
          {props.onRail === 0 ? 'send buses out' : 'take one off the rail'}
        </Button>
      </div>
      <p className="m-0 mt-2 text-caption text-subtle tabular-nums">
        {props.buses
          .map((b) => (b.kind === 'node' ? `at ${b.index}` : `${b.from}→${b.to}`))
          .join('  ·  ')}
        {'  ·  '}
        <span className="text-muted">
          “reflow rows above” adds a line to rows 0–2 without touching the bus: the old overlay left
          it behind, CSS cannot.
        </span>
      </p>
    </div>
  )
}

function Button({
  onClick,
  lit,
  children,
}: {
  onClick: () => void
  lit?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-pill border px-3 py-1 text-caption ${
        lit
          ? 'border-accent bg-accent text-accent-contrast'
          : 'border-border bg-surface-2 text-text'
      }`}
    >
      {children}
    </button>
  )
}

// ── the mock rail ──────────────────────────────────────────────────────────────────────────────

const NAMES = [
  'Sau Mau Ping (Central)',
  'Hiu Lai Court',
  'Sau Ming Road',
  'On Tak Road',
  'Ping Tin Estate',
  'Choi Ha Road',
  'Kwun Tong Road',
  'Ngau Tau Kok Station BBI',
  'Telford Gardens',
  'Kowloon Bay',
  'Choi Hung Road',
  'Prince Edward Road East',
  'Argyle Street',
  'Nathan Road BBI',
  'Jordan Road',
  'Canton Road',
  'Star Ferry, Harbour City',
]
const STOPS = NAMES.length

/**
 * What glyph each row's node gets, from the **same kernel rule the screen and the map use** —
 * `routeMarkers`, called without a line because only `kind` is wanted here.
 *
 * Two of the names above carry `BBI` on purpose, so the lab shows all three shapes rather than a
 * column of circles. That is the point of driving the real rule instead of hard-coding: when the rule
 * changes — a fourth kind, a different test for an interchange — this page changes with it, and a lab
 * that had to be edited to keep up is a lab that quietly stops being true.
 *
 * The coordinates are filler. `kind` reads only the index and the name, and giving it a real geometry
 * would imply this page had one.
 */
const NODE_KINDS = routeMarkers(
  NAMES.map((name, i) => ({ name, location: { lat: 22.3 + i * 0.001, lng: 114.17 } })),
).map((m) => m.kind)

/** One row, with just enough shape to be the real component's input. */
function stopRow(
  i: number,
  opts: { ragged: boolean; reflowed: boolean; savedStops: boolean },
): RouteStopRowView {
  // A row with an arrivals line is ~80 px and one without is `min-h-16`'s 64 — which is the height
  // difference the old measurement had to keep noticing, and the one `calc(50%…)` absorbs for free.
  const hasArrivals = (opts.ragged ? i % 3 === 0 : true) || (opts.reflowed && i < 3)
  const minutes = 2 + ((i * 5) % 17)
  return {
    seq: i + 1,
    stopId: `LAB:${i}`,
    name: { label: NAMES[i] ?? `Stop ${i + 1}`, ...(i % 4 === 0 ? { code: `ST${100 + i}` } : {}) },
    arrivals: hasArrivals
      ? [
          {
            iso: `2026-08-09T00:${String(10 + i).padStart(2, '0')}:00Z`,
            label:
              minutes === 0
                ? { kind: 'due' as const, label: 'Due' }
                : { kind: 'mins' as const, value: minutes, unit: 'min' },
            urgency:
              minutes <= 1
                ? ('due' as const)
                : minutes <= 5
                  ? ('soon' as const)
                  : ('normal' as const),
            stale: false,
          },
        ]
      : [],
    fareLabel: `$${(13.4 - i * 0.5).toFixed(1)}`,
    here: i === 4,
    first: i === 0,
    last: i === STOPS - 1,
    saved: opts.savedStops && (i === 6 || i === 12),
  }
}
