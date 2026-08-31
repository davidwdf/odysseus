import { LocateFixed, type LucideIcon, Maximize } from 'lucide-react'

/**
 * **The two controls a route map actually needs**, floating over its bottom-right corner.
 *
 * Deliberately two, and deliberately not zoom. A rider on a phone pinches; a pair of `+`/`−` buttons
 * is desktop furniture that costs two more targets in the one corner where the sheet's own handle is
 * already competing for the thumb. What a touch map cannot do by gesture is *go back to where it
 * started* and *find me* — so those are the two here.
 *
 * Each appears only when it can act. `onRecentre` is absent until the rider has moved the camera, and
 * `onLocate` until a fix exists: a control that cannot do its job is worse than an absent one, because
 * pressing it teaches nothing about why nothing happened.
 */
export function MapControls({
  onRecentre,
  recentreLabel,
  onLocate,
  locateLabel,
  bottom,
}: {
  onRecentre?: (() => void) | undefined
  recentreLabel: string
  onLocate?: (() => void) | undefined
  locateLabel: string
  /** Clearance for whatever is covering the map's bottom edge — the sheet. In CSS pixels. */
  bottom: number
}) {
  if (!onRecentre && !onLocate) return null
  return (
    <div
      className="pointer-events-none absolute right-3 z-10 flex flex-col gap-2"
      style={{ bottom: bottom + 12, transition: 'bottom 500ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      {/* `Maximize` — four corner brackets, the universal "fit to view". It was a hand-drawn glyph:
          the same brackets with a curved line inside them meaning "the route", which the owner read as
          *"the button with the squiggle in the brackets"* and could not act on. The lesson is in
          `icons/index.ts`: a glyph drawn outside the icon set is a glyph nothing keeps to the set's
          shapes, and two marks in a 20 px square is one more than it holds. */}
      {onRecentre ? (
        <ControlButton label={recentreLabel} icon={Maximize} onPress={onRecentre} />
      ) : null}
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
