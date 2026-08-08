import { t } from '@nextbus/i18n'
import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { useLocale } from '../providers/LocaleProvider'

/**
 * A bottom sheet you can drag — the DOM twin of `apps/mobile/components/BottomSheet.tsx`.
 *
 * ## This replaces a `<dialog>` that argued for itself at length, and the argument was half right
 *
 * `RouteFactSheet` and `RouteStopSheet` were centred modal dialogs, justified by everything a `<dialog>`
 * buys — focus trapping, `Escape`, an inert backdrop — and by ADR-095 decision 8's refusal to dismiss on a
 * backdrop click. ADR-100 moves the sheet from idiom to identity: a thumb reaches the bottom of a phone,
 * and the app's sheets slide up from it.
 *
 * **So the `<dialog>` stays and only its shape changes.** It is a full-viewport transparent box now, with
 * the panel docked to the bottom edge inside it — which keeps every accessibility property the old
 * argument was really about and gives up none of them. That is the whole trick, and it is why this is not
 * a trade.
 *
 * ## This restyles ONE dialog, not the element
 *
 * Worth stating because the reskin looks invasive and is not: every class here is on this component's own
 * `<dialog>` instance, and `index.css` carries **no bare `dialog` selector at all**. A later confirmation
 * dialog or a detail modal would be its own component over the same `showModal()` primitive, keeping the UA
 * defaults this one overrides — centred, `fit-content`, and `overflow: auto` so a long body scrolls. None of
 * those defaults have been taken away from it. The `overflow-hidden` below is scoped to the one dialog whose
 * panel deliberately hangs past the bottom edge, and is the reason it needs it.
 *
 * ## The scrim is a real `<button>`, which is also not a suppression
 *
 * ADR-095 declined tap-to-dismiss because an `onClick` on the `<dialog>` itself is a handler on a
 * non-interactive element with no keyboard equivalent, and Biome's `useKeyWithClickEvents` says so. The
 * answer is not to suppress the rule but to make the scrim *actually* interactive: a `<button>` sibling of
 * the panel, with the dim on it rather than on `::backdrop`. It gets keyboard activation for free, and it
 * is `tabIndex={-1}` because `Escape` and the close control are the paths a keyboard should use — the
 * button exists for a thumb.
 *
 * ## The motion, and the one number that is ours
 *
 * Entrance: 330 ms to 7 px past rest, then 180 ms back — a constant overshoot rather than an easing curve
 * with overshoot in it, which is what the RN sheet does and what keeps a tall sheet and a short one feeling
 * the same. Exit: 220 ms. Drag: dismiss past 90 px or above 850 px·s⁻¹, with an upward rubber band of
 * `-√(-dy)·2.5` so the sheet resists being thrown at the ceiling.
 *
 * The 320 px underlap is the RN trick ported verbatim: the panel hangs below the viewport bottom and pads
 * itself by the same amount, so a rubber-banded upward drag never bares the scrim beneath it.
 */
export function BottomSheet({
  titleId,
  header,
  children,
  onClose,
}: {
  /** The heading's id, wired to `aria-labelledby` — a modal dialog with no name announces nothing. */
  titleId: string
  header: ReactNode
  /** Given `close`, exactly as the RN sheet gives it, so an action can dismiss after doing its work. */
  children: ReactNode | ((close: () => void) => ReactNode)
  onClose: () => void
}) {
  const locale = useLocale()
  const dialog = useRef<HTMLDialogElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const scrim = useRef<HTMLButtonElement | null>(null)
  const drag = useRef<{ startY: number; lastY: number; lastT: number; velocity: number } | null>(
    null,
  )
  const closing = useRef(false)

  /** Slide out, then tell the caller — the RN sheet's order, and the reason the caller sees no flash. */
  const requestClose = useCallback(() => {
    if (closing.current) return
    closing.current = true
    const node = panel.current
    if (node !== null) {
      dropEntrance(node)
      node.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.32, 0, 0.67, 0)`
      node.style.transform = `translate3d(0, ${node.offsetHeight}px, 0)`
    }
    if (scrim.current !== null) {
      scrim.current.style.transition = `opacity ${EXIT_MS}ms linear`
      scrim.current.style.opacity = '0'
    }
    setTimeout(() => {
      dialog.current?.close()
      onClose()
    }, EXIT_MS)
  }, [onClose])

  useEffect(() => {
    // Capture the control that opened the sheet and restore focus to it on unmount: React tears the
    // `<dialog>` out of the document when the state clears, which skips the browser's own restore step.
    const opener = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => opener?.focus()
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // A press on the header's own close control must not start a drag.
    if ((event.target as HTMLElement).closest('button, a[href]') !== null) return
    const node = panel.current
    if (node === null) return
    dropEntrance(node)
    node.style.transition = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    const node = panel.current
    if (state === null || node === null) return
    const dy = event.clientY - state.startY
    const dt = event.timeStamp - state.lastT
    if (dt > 0) state.velocity = ((event.clientY - state.lastY) / dt) * 1000
    state.lastY = event.clientY
    state.lastT = event.timeStamp
    // Downward is free travel; upward resists, so the sheet cannot be thrown at the ceiling.
    const offset = dy >= 0 ? dy : -Math.sqrt(-dy) * RUBBER
    node.style.transform = `translate3d(0, ${offset}px, 0)`
    if (scrim.current !== null && dy > 0) {
      scrim.current.style.opacity = `${Math.max(0, 1 - dy / node.offsetHeight)}`
    }
  }

  const onPointerUp = () => {
    const state = drag.current
    const node = panel.current
    drag.current = null
    if (state === null || node === null) return
    const dy = state.lastY - state.startY
    if (dy > DISMISS_PX || state.velocity > DISMISS_VELOCITY) {
      requestClose()
      return
    }
    node.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`
    node.style.transform = 'translate3d(0, 0, 0)'
    if (scrim.current !== null) scrim.current.style.opacity = '1'
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
      // A full-viewport transparent box: the panel inside it is what a rider sees. `backdrop:bg-transparent`
      // because the dim is the scrim button below, which a thumb can actually press.
      //
      // **`overflow-hidden` is load-bearing, not tidiness.** The UA stylesheet gives `dialog` an
      // `overflow: auto`, and the panel deliberately hangs `UNDERLAP` px below the bottom edge — so the
      // dialog was a scroll container with 320 px of scrollable content in it. A mouse wheel scrolled *the
      // dialog*, dragging the panel up and exposing the underlap padding as a screenful of empty sheet.
      // Desktop-only, because a touch drag is handled by the pointer handlers below and never reaches a
      // scroller. Reported by the owner; the panel's own body keeps its `overflow-y-auto`, so the content
      // that is *meant* to scroll still does.
      className="m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 backdrop:bg-transparent"
    >
      <button
        ref={scrim}
        type="button"
        tabIndex={-1}
        aria-label={t(locale, 'back')}
        onClick={requestClose}
        className="sheet-scrim absolute inset-0 border-0 bg-black/45"
      />
      <div
        ref={panel}
        className="sheet-panel absolute inset-x-0 rounded-t-sheet border border-border bg-surface"
        // The underlap: the panel hangs below the viewport and pads itself by the same amount, so an
        // upward rubber-band never reveals the scrim under its bottom edge. `apps/mobile` does this with
        // the same constant.
        style={{
          bottom: -UNDERLAP,
          paddingBottom: `calc(${UNDERLAP}px + env(safe-area-inset-bottom, 0px) + 10px)`,
        }}
      >
        {/* The grab area: the handle and the header both drag, which is the RN `GestureDetector`'s scope. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="cursor-grab touch-none select-none px-5 pt-3 active:cursor-grabbing"
        >
          <span aria-hidden className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border" />
          {header}
        </div>
        <div className="px-2 pt-1">
          {typeof children === 'function' ? children(requestClose) : children}
        </div>
      </div>
    </dialog>
  )
}

/** One full-width action row — the DOM twin of the RN `SheetAction`. */
export function SheetAction({
  icon: Icon,
  label,
  filled = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  /** A saved favourite fills its star, exactly as the RN row does. */
  filled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left text-body text-text hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <Icon
        size={20}
        aria-hidden
        className="shrink-0 text-accent"
        fill={filled ? 'currentColor' : 'none'}
      />
      <span className="flex-1">{label}</span>
    </button>
  )
}

/**
 * Cancel the entrance keyframes before writing a transform by hand.
 *
 * **Not a tidy-up — the exit is invisible without it.** `.sheet-panel` runs `sheet-in` with
 * `animation-fill-mode: both`, so when the entrance finishes it *keeps* applying `transform: none` from its
 * final keyframe. A filled animation lives in the animation origin of the cascade, which outranks inline
 * style, so `node.style.transform = 'translate3d(0, …)'` computed to the identity matrix and the panel sat
 * still for `EXIT_MS` and then blinked out of existence.
 *
 * The drag path never showed it because `onPointerDown` was already cancelling — which is exactly why this
 * is one function called from both places rather than a line copied into the second. Found by dismissing a
 * sheet in a browser; no unit test could have seen it, because jsdom runs no animations, and the
 * `getAnimations` call is optional-chained for that same reason.
 */
function dropEntrance(node: HTMLElement): void {
  for (const animation of node.getAnimations?.() ?? []) animation.cancel()
}

/** `apps/mobile/components/BottomSheet.tsx`'s constants, value for value. */
const UNDERLAP = 320
const DISMISS_PX = 90
const DISMISS_VELOCITY = 850
const RUBBER = 2.5
const SETTLE_MS = 180
const EXIT_MS = 220
