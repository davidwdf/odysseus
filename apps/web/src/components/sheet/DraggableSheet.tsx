import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  DEFAULT_DETENT,
  type Detent,
  dragVelocity,
  ROUTE_DETENTS,
  resist,
  resolveDetent,
  settleDetent,
  stepDetent,
} from './detents'

/**
 * **A sheet that rests at named heights and can be dragged between them** — the round-2 mockup's grab
 * handle, as a component with no NextBus vocabulary in it.
 *
 * It knows about detents, a handle, a drag and a scroll container. It does not know about routes,
 * stops or maps: what it holds is `children`. That is deliberate and is the shape the owner asked for
 * — a screen assembled from parts rather than one file that does everything — and it is what would let
 * this move to a shared component library without a rewrite.
 *
 * ## Height is a fraction, never a pixel
 *
 * Everything in `detents.ts` is a fraction of the container, because a sheet that stores pixels is a
 * sheet that is wrong after a rotation, a keyboard, or a mobile browser's chrome bar sliding away. The
 * pixels only exist for the duration of one drag.
 *
 * ## Why the drag is on the handle and the wheel is not chained
 *
 * The sheet moves by its handle. Scrolling the list inside it scrolls the list, and does **not** raise
 * the sheet first — the Apple-Maps behaviour, which round 3 had as a toggle and which is a real
 * decision rather than a detail: chaining makes every flick of a long list a potential resize, and
 * this list is 40 rows long. `onDetentChange` is reported so a screen can react (collapsing a header,
 * padding a camera); the sheet itself is the only thing that moves it.
 */
export function DraggableSheet({
  children,
  detents = ROUTE_DETENTS,
  initial = DEFAULT_DETENT,
  onDetentChange,
  label,
}: {
  children: ReactNode
  detents?: readonly Detent[]
  /** Which detent to open at, by name. Falls back to the first if the name is not among them. */
  initial?: string
  /** Called whenever the sheet settles, and once on mount. A screen's hook for reacting to the shape. */
  onDetentChange?: (detent: Detent) => void
  /** The sheet's accessible name — it is a region, and an unnamed one is announced as nothing. */
  label: string
}) {
  const resolved = resolveDetent(detents, initial)
  const [detent, setDetent] = useState<Detent>(resolved)
  /** Non-null only while a finger is down. The one place pixels exist. */
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const host = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{
    startY: number
    startFraction: number
    lastY: number
    lastAt: number
  } | null>(null)
  const headingId = useId()

  const report = useRef(onDetentChange)
  report.current = onDetentChange
  // Once on mount, so a screen never has to guess where the sheet opened.
  // Once, when the sheet opens — so a screen never has to guess where it started. Keyed on the
  // detent's NAME rather than the object: `resolveDetent` builds a fresh one every render, and
  // depending on that would announce the same position on every keystroke of the page.
  useEffect(() => {
    report.current?.(resolveDetent(detents, initial))
  }, [detents, initial])

  const fraction = dragFraction ?? detent.fraction

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const height = host.current?.parentElement?.clientHeight ?? window.innerHeight
      drag.current = {
        startY: e.clientY,
        startFraction: detent.fraction,
        lastY: e.clientY,
        lastAt: e.timeStamp,
      }
      // Capture so a fast drag that leaves the handle keeps delivering — and so the pointer-up lands
      // here rather than on whatever is underneath. (A hit-test on `pointerup` is what the route
      // mockup needed for its markers; a handle wants the opposite, which is the capture.)
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragFraction(detent.fraction)
      void height
    },
    [detent],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const state = drag.current
      if (!state) return
      const height = host.current?.parentElement?.clientHeight ?? window.innerHeight
      // Up is negative in screen space and up means *bigger*, hence the sign.
      const moved = (state.startY - e.clientY) / height
      state.lastY = e.clientY
      state.lastAt = e.timeStamp
      setDragFraction(resist(state.startFraction + moved, detents))
    },
    [detents],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const state = drag.current
      if (!state) return
      drag.current = null
      const height = host.current?.parentElement?.clientHeight ?? window.innerHeight
      const velocity = dragVelocity(state.lastY - e.clientY, height, e.timeStamp - state.lastAt)
      const settled = settleDetent(dragFraction ?? detent.fraction, velocity, detents, detent.name)
      setDragFraction(null)
      setDetent(settled)
      report.current?.(settled)
    },
    [detents, detent, dragFraction],
  )

  return (
    <section
      ref={host}
      aria-labelledby={headingId}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-xl border-border border-t bg-bg"
      style={{
        height: `${fraction * 100}%`,
        // No transition **while dragging** — the sheet must track the finger exactly — and one on
        // release, which is what turns a snap into a settle.
        transition: dragFraction === null ? 'height 260ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
      }}
    >
      <h2 id={headingId} className="sr-only">
        {label}
      </h2>
      {/*
        The handle. A `<button>` because it is operable — and operable by keyboard, which a bare drag
        target is not: arrow keys move it a detent at a time, which is the whole of this component's
        keyboard story and is why it is not a `<div>` with a pointer listener.
      */}
      <button
        type="button"
        aria-label={label}
        className="flex w-full shrink-0 cursor-grab touch-none items-center justify-center border-0 bg-transparent py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : null
          if (step === null) return
          e.preventDefault()
          const next = stepDetent(detents, detent.name, step)
          setDetent(next)
          report.current?.(next)
        }}
      >
        <span aria-hidden="true" className="block h-1 w-9 rounded-pill bg-border" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  )
}
