import type { ReactNode } from 'react'

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
      {onRecentre ? (
        <ControlButton label={recentreLabel} onPress={onRecentre}>
          {/* A route folded into a frame: corners plus the line they contain. Says "fit the route",
              where a crosshair would say "centre on a point". */}
          <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
          <path d="M8 16c0-4 8-4 8-8" />
        </ControlButton>
      ) : null}
      {onLocate ? (
        <ControlButton label={locateLabel} onPress={onLocate}>
          {/* The universal locate mark — a crosshair with a dot. Worth not inventing: a rider has met
              this glyph in every map app they have ever used. */}
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </ControlButton>
      ) : null}
    </div>
  )
}

function ControlButton({
  label,
  onPress,
  children,
}: {
  label: string
  onPress: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="glass-pane pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-border text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus active:opacity-70"
    >
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  )
}
