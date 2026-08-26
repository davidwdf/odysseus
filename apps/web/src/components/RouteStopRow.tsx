import type { EtaUrgency, RouteStopArrival, RouteStopRowView, StopMarkerKind } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { Star } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useLocale } from '../providers/LocaleProvider'
import { NODE, NODE_CENTRE, NODE_TOP, RAIL_WIDTH } from './RailBusToken'
import { SlideNumber } from './SlideNumber'
import { StopName } from './StopName'

/**
 * One stop on the route schematic — the DOM twin of the `RouteStopRow` inside
 * `apps/mobile/app/route/[id].tsx`, and a pure projection of `RouteStopRowView`.
 *
 * The rail is a fixed gutter with a 2 px line behind a numbered node, and `first`/`last` decide which
 * connectors it draws — the kernel's flags, because a route whose last row drew a connector below it would
 * dangle a line into the page and nothing would fail. The saved-stop star sits on the node's corner, as it
 * does on the RN rail.
 *
 * **The whole row is one `<button>`**, which the spec's `sibling-not-nested` check requires and HTML would
 * otherwise forbid: the RN row is a single `Pressable`, so a DOM row with a nested control for the fare or
 * the star would be a tap target inside a tap target (ADR-024).
 */
export function RouteStopRow({
  row,
  index,
  animateIn,
  arrivalsPending = false,
  tokens,
  kind,
  onPress,
  onMenu,
  registerRow,
}: {
  /**
   * What this stop is — from `routeMarkers`, the same call that shapes the map's markers. Passed in
   * rather than derived here so the list and the map cannot disagree: "the first stop is a terminus"
   * is a domain rule (ADR-068), and a row deciding it for itself is the second spelling that drifts.
   */
  kind: StopMarkerKind
  row: RouteStopRowView
  /**
   * The route's live round has not answered yet, so a row with no arrivals is **waiting** rather than
   * quiet. Only ever used to reserve the arrivals line's height; it never changes a word on screen, which
   * is why it is a boolean from the screen rather than anything the kernel derives — "have we asked yet"
   * is a fact about this fetch, not about the route.
   */
  arrivalsPending?: boolean
  /** Position in the list — what `RailBus`'s `index`/`from`/`to` name, and the cascade's per-row delay. */
  index: number
  /**
   * Play the staggered fade-and-rise entrance. True on a direction flip, false on a first load — where the
   * screen has its own reveal and a second one on top of it would read as a stutter (ADR-046).
   */
  animateIn: boolean
  /**
   * The buses this row carries — a bus **at** its node, and a bus on the segment leading into the *next*
   * row's node, which is half of this row below its own top.
   *
   * They ride against this row's own box rather than in an overlay over the list, which is what deletes the
   * measurement (ADR-110): where a bus sits is two constant CSS expressions, so a reflow moves the row and
   * its bus together and neither can go stale. Handed in already built, because their **order** is the
   * kernel's and belongs to the screen that reads `view.buses` — a row given two of them must not put them
   * in an order of its own.
   */
  tokens: ReactNode
  /**
   * The row itself was tapped. Since §8d that **focuses the stop on the map** and does nothing else —
   * it used to open the action sheet, which is now `onMenu`'s job. The swap is the whole of WP M7d:
   * a tap that moves the map is worth a permanent control beside it, which it was not when the map
   * was a decorative band (`docs/proposals/06 §8d`).
   */
  onPress: (row: RouteStopRowView, index: number) => void
  /** The `⋯` was tapped — open the actions for this stop. */
  onMenu: (row: RouteStopRowView) => void
  /** Reports this row's element so the reveal can scroll to it — geometry, not a decision. */
  registerRow: (index: number, el: HTMLElement | null) => void
}) {
  const { here, first, last } = row
  const locale = useLocale()
  // **Read once, at mount** — `useState`'s initial value is ignored on every later render, which is exactly
  // what the RN row gets from `useSharedValue(animateIn ? 0 : 1)` plus an effect with empty deps.
  //
  // Not a micro-optimisation. The nonce advances on the *tap*, and the reverse payload lands a tick later,
  // so for that tick the rows still on screen are the current direction's — and adding an animation class to
  // a mounted element *starts* it. Without this the outbound list blinks out and back in before the inbound
  // list arrives. A flip animates the rows that mount fresh because of it, and nothing else.
  const [rise] = useState(animateIn)
  return (
    /*
      A wrapper, and the bus tokens are the button's **siblings** rather than its children — the one
      structural consequence of placing the rail in CSS.

      `RailBusToken` is a `role="img"` with an `aria-label`, and a labelled graphic inside a button is folded
      into that button's accessible name: measured in Chrome's accessibility tree, a nested token turned
      *"Nathan Road · 3 min"* into *"Nathan Road · 3 min · Bus approaching Nathan Road"*. `pointer-events:
      none` does not exempt it, and no suite here would have caught it — the projection reads text nodes and
      token labels in two separate passes, so both stay identical while every row with a bus beside it starts
      announcing that bus twice.

      The wrapper's height **is** the button's — one full-width in-flow child, no margins — which is what
      keeps `calc(50% + 13px)` resolving against the row's own box. It is not interactive, so the spec's
      `sibling-not-nested` check and the interactive count are untouched. And the flip cascade's transform
      stays on the button, so a token does not ride it, which is `apps/mobile`'s behaviour too: its tokens are
      placed from `onLayout` values, and a transform does not move those.
    */
    <div className="relative">
      <button
        type="button"
        ref={(el) => registerRow(index, el)}
        onClick={() => onPress(row, index)}
        // The cascade's per-row beat, capped so a 60-stop route does not drag for two seconds — the delay
        // `apps/mobile` applies with `withDelay(Math.min(index, 10) * 26, …)`, value for value.
        style={
          rise ? { animationDelay: `${Math.min(index, CASCADE_CAP) * CASCADE_STEP}ms` } : undefined
        }
        // `scroll-mt` is the whole of this renderer's auto-scroll: `scrollIntoView` then lands the boarding row
        // below the sticky header without this screen computing an offset, and honours the rider's
        // reduced-motion setting without owning that decision either (ADR-045 is idiom). 7rem clears the
        // header — measured in a browser at 112 px, where 5rem left the anchored row half under it.
        // **No divider, and `min-h-16` in its place.** The RN schematic has no rules between stops at all —
        // the rail *is* the separator — and the 1 px border here was doing two jobs, one of which was holding
        // the row's rhythm: without a minimum a stop with no arrivals line collapses to about 52 px where the
        // RN row is a flat 64 (`minHeight: 64`).
        //
        // The two backgrounds are mutually exclusive rather than layered. They were `bg-transparent` in the
        // static list and `bg-surface-2` appended conditionally — two unvariant `background-color` utilities
        // of equal specificity, so the winner was whichever Tailwind happened to emit last, and it was the
        // transparent one. That is why the rider's boarding stop had no lighter background.
        className={`relative flex min-h-16 w-full scroll-mt-28 gap-0 border-0 px-0 py-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
          here ? 'bg-surface-2' : 'bg-transparent'
        } ${rise ? 'row-rise' : ''}`}
      >
        {/* The rail gutter: a continuous line behind a top-aligned node. */}
        <span className="relative shrink-0" style={{ width: RAIL_WIDTH }}>
          {!first ? (
            <span
              className="absolute bg-border"
              style={{ top: 0, height: NODE_CENTRE, width: 2, left: RAIL_WIDTH / 2 - 1 }}
            />
          ) : null}
          {!last ? (
            <span
              className="absolute bg-border"
              style={{ top: NODE_CENTRE, bottom: 0, width: 2, left: RAIL_WIDTH / 2 - 1 }}
            />
          ) : null}
          {/*
            **The node's SHAPE is the same vocabulary the map uses** — a square for a terminus, a
            hexagon for a bus-bus interchange, a circle for every other stop — and it is the *same
            answer*, not a matching one: `routeMarkers` is called once on the screen and its result
            feeds both the map's markers and this. A rider who sees a hexagon on the map and scrolls to
            find a circle in the list would be looking at two claims about one stop.

            Drawn as an SVG behind the number rather than as a CSS shape, because a border has to
            follow the outline: `rounded-full` gives a circle for free and `clip-path` would give a
            hexagon with its border clipped off. One `<path>` per kind, filled and stroked, is the same
            technique the map marker uses and keeps the two files' geometry legibly related.
          */}
          <span
            className="absolute flex items-center justify-center text-caption tabular-nums"
            style={{ top: NODE_TOP, left: (RAIL_WIDTH - NODE) / 2, width: NODE, height: NODE }}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={`absolute inset-0 h-full w-full ${
                here ? 'fill-accent stroke-accent' : 'fill-surface stroke-border'
              }`}
              strokeWidth={2}
            >
              <path d={NODE_SHAPE[kind]} />
            </svg>
            <span className={`relative ${here ? 'text-accent-contrast' : 'text-subtle'}`}>
              {row.seq}
            </span>
          </span>
          {row.saved ? (
            // Drawn on the node's corner, and — as on the RN rail — the node itself is unchanged, so a saved
            // stop still scans as an ordinary sequence node with a flag on it (ADR-042).
            //
            // **Two stars, not one**: a slightly larger `--surface` one behind the accent one, which is what
            // gives the flag its outline and makes it read as a bordered sticker over the rail rather than a
            // disc floating on it. The RN overlay does the same with `BADGE = 15`, and draws it *after* the
            // bus tokens for a stated reason — a passing bus must not hide a rider's favourite. `z-10` is
            // this renderer's equivalent, since the star lives inside the row rather than in an overlay pass.
            <span
              className="pointer-events-none absolute z-10 flex items-center justify-center"
              style={{
                top: NODE_TOP - 6,
                left: (RAIL_WIDTH - NODE) / 2 + NODE - 9,
                width: 15,
                height: 15,
              }}
            >
              <Star size={15} className="absolute fill-surface text-surface" aria-hidden />
              <Star size={11} className="absolute fill-accent text-accent" aria-hidden />
            </span>
          ) : null}
        </span>

        <span className="min-w-0 flex-1 pt-3 pr-4 pb-4">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 flex-1">
              <StopName name={row.name} emphasis={here} />
            </span>
            {row.fareLabel ? (
              <span className="shrink-0 text-caption text-subtle tabular-nums">
                {row.fareLabel}
              </span>
            ) : null}
          </span>
          {row.arrivals.length > 0 ? (
            <span className="mt-1 flex flex-wrap items-baseline gap-x-3">
              {row.arrivals.map((arrival, slot) => (
                // Keyed on the arrival's own timestamp, which is why the model carries it: a bus keeps its slot
                // when the round refreshes rather than the third time sliding into the first slot's box.
                <ArrivalSlot key={arrival.iso} arrival={arrival} first={slot === 0} />
              ))}
            </span>
          ) : arrivalsPending ? (
            // **The times are coming; hold their place.** A route watch resolves every pole server-side and
            // answers in one round (ADR-116), so on a slow round all 34 rows gain an arrivals line at the
            // same instant and the whole schematic jumps — the rail, every bus token's row, and the reveal
            // of the originating stop all move together. Reserving the line is the fix; the skeleton is what
            // makes the reservation legible rather than a mysterious gap.
            //
            // **It is deliberately not shown when a round has answered with nothing.** "No bus due" and
            // "we have not asked yet" are different facts, and drawing the same placeholder for both is the
            // exact conflation ADR-073 and ADR-124 exist to prevent — this is `null` again the moment the
            // round lands, whether or not it brought a time.
            //
            // `aria-hidden` and no text: a skeleton is a layout promise, not content. The conformance
            // walker reads presence, so a labelled placeholder would project into every state that mounts
            // before its data (the trap ADR-123 and the FAQ both hit).
            <span aria-hidden className="mt-1 flex items-baseline gap-x-3">
              {/* Sized to what they stand in for — the first slot is `text-body font-semibold` and the
                  rest are `text-caption`, so the widths differ and a row of identical bars would settle
                  to the wrong height. */}
              <span className="h-[1.125rem] w-12 rounded bg-surface-2" />
              <span className="h-[0.875rem] w-10 rounded bg-surface-2" />
            </span>
          ) : null}
          {row.incomplete ? (
            // **Why a row says this and the screen does not.** A live route watch asks each pole separately, so
            // one kerb can refuse while the other forty answer (ADR-116) — and `liveArrivals`, which is the
            // screen-level sentence, cannot express that without lying in one direction or the other. The same
            // words a card uses for the same fact (ADR-077), in the same muted label as every other secondary
            // line here, because it is an explanation and not an alarm.
            //
            // **Beside the times rather than instead of them**, which is not a layout choice: a refused pole
            // keeps its *previous* readings (`retainFailedPoles`, ADR-073), so the honest render is the ageing
            // time and the reason it is not moving. Drawing only the time hides the outage; drawing only the
            // sentence throws away the rider's last known bus.
            <span className="mt-1 block text-label text-muted">{t(locale, 'etasUnavailable')}</span>
          ) : null}
        </span>
      </button>
      {/*
        **The permanent `⋯`, and a SIBLING of the row rather than a child of it** (ADR-024's rule, and
        what the spec's `sibling-not-nested` check enforces): a button inside a button is invalid HTML
        and folds into one control for a screen reader, which is how the star beside a stop row had to
        be built too.

        Absolutely positioned so it costs the row no layout — the row's own box is unchanged, which
        matters because `RailBusToken` is placed against it with constant CSS expressions and any
        change to the row's height would move every bus on the schematic (ADR-110).

        Round 1 rejected this as "repeated menu icons" and round 5 accepted it, because everything
        around it changed: once the map is the point of the screen, a tap that focuses it is worth a
        permanent control, and the actions need somewhere to go.
      */}
      <button
        type="button"
        onClick={() => onMenu(row)}
        aria-label={t(locale, 'routeStopActions', { stop: row.name.label })}
        className="absolute top-0 right-0 flex h-16 w-11 items-center justify-center border-0 bg-transparent text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {/*
          **Three drawn dots, not the character `⋯`** — and that is a conformance decision, not a
          styling one. The walker reads TEXT NODES and sees presence rather than visibility (ADR-097),
          so a literal `⋯` lands in every state's projection as a stray glyph after the stop's
          sequence number. It cannot be declared away either: the RN row has no such control, and a
          slot the other renderer cannot produce is a red build there or a fake `knownDefect`.

          Drawn, it is a control with **no text** — which is exactly what the saved-state star on
          `PlaceRow` is, and it is `idiom` for the same stated reason: no slot can declare it, so each
          renderer draws it its own way. The button still carries its accessible name, so a screen
          reader loses nothing and the count of tap targets is unchanged.
        */}
        <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true" fill="currentColor">
          <circle cx="2" cy="2" r="1.6" />
          <circle cx="8" cy="2" r="1.6" />
          <circle cx="14" cy="2" r="1.6" />
        </svg>
      </button>
      {tokens}
    </div>
  )
}

/**
 * Urgency → tone, the DOM's own table. A deliberate duplicate of the RN row's, and the correct kind: both map
 * a kernel *name* to their platform's colour system, which is what a native client will also do. What must
 * never be duplicated is the number that decides which name (ADR-053) — that is `etaUrgency`'s, and neither
 * renderer sees it.
 */
const TONE: Record<EtaUrgency, string> = {
  due: 'text-positive',
  soon: 'text-warning',
  normal: 'text-text',
  none: 'text-muted',
}

/**
 * One arrival on a stop row: the figure and its unit, the status word, or a dash.
 *
 * Written here rather than reusing `EtaBadge` because that component is sized for a card's right-hand side
 * (an `h2` figure), and a schematic row carries up to three of them on one line. The **text nodes are
 * identical** either way, which is what the spec pins; the sizes are this row's business.
 *
 * Staleness dims and does not recolour (ADR-008: never colour alone) — and the value itself does not move,
 * because a reading only changes when a fresh one arrives.
 *
 * **Exported for the action sheet** (ADR-115), which shows this route's times at one stop when the route view
 * has none of its own. Not for reuse in general: it is exported so there is exactly ONE renderer of a route
 * arrival rather than a third copy of the same three arms. The sheet's own docblock records what nearly
 * happened when a stop's *name* was written twice eleven lines apart; a time is worse.
 */
export function ArrivalSlot({ arrival, first }: { arrival: RouteStopArrival; first: boolean }) {
  const { label } = arrival
  const tone = first ? (TONE[arrival.urgency] ?? TONE.none) : 'text-muted'
  const size = first ? 'text-body font-semibold' : 'text-caption'
  return (
    <span className="flex items-baseline gap-1">
      {label.kind === 'mins' ? (
        <>
          {/* `String(...)` because a schematic arrival carries its minutes as a number where the card's
              `EtaLabelParts` carries a string — the odometer diffs characters, so it takes the rendered
              form rather than the value's own type. */}
          <SlideNumber value={String(label.value)} className={`tabular-nums ${size} ${tone}`} />
          <span className={`${first ? 'text-caption' : 'text-caption'} text-muted`}>
            {label.unit}
          </span>
        </>
      ) : label.kind === 'due' ? (
        <SlideNumber value={label.label} className={`tabular-nums ${size} ${tone}`} />
      ) : label.kind === 'headway' ? (
        <span className="text-caption text-subtle">{label.text}</span>
      ) : (
        <span className={`tabular-nums ${size} ${tone}`}>—</span>
      )}
    </span>
  )
}

/**
 * The rail node's outline, per kind, on a 24×24 grid — the list's half of the map's shape vocabulary
 * (`routeMarkerElement.ts` draws the same three at marker sizes).
 *
 * Inset by 1 so a 2 px stroke sits inside the box rather than being clipped by the viewBox, which is
 * why none of these starts at 0.
 */
const NODE_SHAPE: Record<StopMarkerKind, string> = {
  terminus: 'M2 2 h20 v20 h-20 Z',
  interchange: 'M7 1.5 h10 l5 10.5 -5 10.5 h-10 l-5 -10.5 Z',
  stop: 'M12 1.5 a10.5 10.5 0 1 0 0.01 0 Z',
}

/** The flip cascade's beat and its cap — `apps/mobile`'s `Math.min(index, 10) * 26`, value for value. */
const CASCADE_STEP = 26
const CASCADE_CAP = 10
