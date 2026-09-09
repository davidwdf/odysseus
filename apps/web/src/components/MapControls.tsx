import { LocateFixed, type LucideIcon } from 'lucide-react'

/**
 * **The one control a route map actually needs**, floating over its bottom-right corner.
 *
 * Deliberately not zoom: a rider on a phone pinches, and a pair of `+`/`−` buttons is desktop
 * furniture costing two more targets in the corner where the sheet's own handle already competes for
 * the thumb. What a touch map cannot do by gesture is **find me**, so that is what is here.
 *
 * ## There were two, and *show the whole route* was cut
 *
 * It re-framed the line after the rider had panned away. Built in ADR-158, dropped in ADR-162 on the
 * owner's *"I'm not sure how useful it is?"* — and the doubt was right twice over. A rider who pans a
 * map is looking at something, so a button offering to undo that answers a question few of them
 * asked; it earned its place mostly by being the obvious second thing to put in a corner with room.
 * And it stopped making sense once the screen began **opening focused on a stop**, because then there
 * is no framed overview to go *back* to.
 *
 * `onLocate` appears only when a fix exists: a control that cannot do its job is worse than an absent
 * one, because pressing it teaches nothing about why nothing happened.
 */
export function MapControls({
  onLocate,
  locateLabel,
  bottom,
}: {
  onLocate?: (() => void) | undefined
  locateLabel: string
  /** Clearance for whatever is covering the map's bottom edge — the sheet. In CSS pixels. */
  bottom: number
}) {
  if (!onLocate) return null
  return (
    <div
      className="pointer-events-none absolute right-3 z-10 flex flex-col gap-2"
      style={{ bottom: bottom + 12, transition: 'bottom 500ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      {/* `LocateFixed` — the crosshair-with-a-dot a rider has met in every map app they have used, and
          the same glyph Nearby already uses for the same act. */}
      {onLocate ? (
        <ControlButton label={locateLabel} icon={LocateFixed} onPress={onLocate} />
      ) : null}
    </div>
  )
}

function ControlButton({
  label,
  icon: Glyph,
  onPress,
}: {
  label: string
  icon: LucideIcon
  onPress: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="glass-pane pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-border text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-70"
    >
      <Glyph size={20} aria-hidden />
    </button>
  )
}
