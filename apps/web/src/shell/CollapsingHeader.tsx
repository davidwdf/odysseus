import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * The collapsing header — the DOM twin of `apps/mobile/components/CollapsingHeader.tsx`, and shared by
 * Route detail and Place detail exactly as the RN one is.
 *
 * ADR-033's point is that both screens are thin wrappers over one component, *"same motion, same glass, so
 * the two screens feel like one family"*. `apps/web` had neither: a static header in flow that scrolled
 * away, on both screens. ADR-100 moves the collapsing header from idiom to identity, and this is it.
 *
 * ## What it does
 *
 * At rest the badge is centred and scaled 1.45×, with the label centred below it. As the rider scrolls, the
 * badge travels to the left and back to 1×, the expanded label fades out, and a glass pill fades in behind
 * a smaller label beside the badge — so the screen keeps its identity in the corner of the eye without
 * holding a third of the viewport.
 *
 * ## Two states, where the RN one scrubs — and that is the honest difference
 *
 * `apps/mobile` interpolates every value against `scrollY` continuously, so its header tracks a finger.
 * This is a **two-state CSS transition** toggled by an `IntersectionObserver` on a sentinel with
 * `rootMargin: -96px`, which is the RN `COLLAPSE` constant — so both renderers change state at the same
 * scroll depth even though one arrives there by scrubbing and the other by transitioning.
 *
 * The reasons are not aesthetic. A scroll handler on the document runs per frame on the main thread and is
 * exactly the shape ADR-043's reverted stack got wrong; an observer fires twice per journey. And CSS
 * transitions honour `prefers-reduced-motion` through one query, where a scrub has to be re-implemented to
 * respect it.
 *
 * **The upgrade path is written down rather than left implicit:** `animation-timeline: scroll()` would give
 * a true scrub declaratively, with no JS at all, and is the right answer the day Firefox ships it — today
 * it would leave Firefox stuck in the expanded state, which is worse than a transition everywhere.
 */
export function CollapsingHeader({
  badge,
  label,
  collapsedLabel,
  expandedHeight,
  labelExpandedTop,
  labelExpandedSize,
  labelCollapsedSize,
  trailing,
}: {
  /** The identity element that survives the collapse — a route chip, a pin. */
  badge: ReactNode
  /** What the expanded header shows — a from/to card on a route, a name on a place. */
  label: ReactNode
  /**
   * What replaces it once collapsed — `collapsedLabel` on the RN component, which is a *different string*
   * rather than the same one shrunk (`→ Destination`, not the whole journey).
   *
   * **Swapped, not cross-faded, and that is deliberate.** A cross-fade needs both in the tree at once, and
   * a conformance projection reads text by presence rather than visibility — the same trap the FAQ turns
   * on. Two labels mounted together would make the header project both on every screen, so the expanded
   * one leaves as the collapsed one arrives. The badge, the bar and the height still animate; only the
   * words swap.
   */
  collapsedLabel?: ReactNode
  /** `expH` on the RN component: 168 for a route, 118 for a place. */
  expandedHeight: number
  /** `labelExpTop`: where the expanded label's baseline sits. */
  labelExpandedTop: number
  labelExpandedSize: number
  labelCollapsedSize: number
  /** Anything pinned to the right of the collapsed bar — the direction toggle, on Route detail. */
  trailing?: ReactNode
}) {
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const node = sentinel.current
    // **Degrades rather than crashes where the API is absent**, which is jsdom and was every conformance
    // suite the moment this component landed — twenty tests, all `ReferenceError`. The guard is not a test
    // accommodation though, and it would be wrong to fix this by stubbing the suites alone: an environment
    // without `IntersectionObserver` should get the header at its expanded size, which is exactly what the
    // screen showed before this component existed. A missing browser API is a reason to show less motion,
    // never a reason to show no header.
    if (node === null || typeof IntersectionObserver === 'undefined') return
    // `isIntersecting` is a boolean the browser computes, so this component compares nothing and computes
    // nothing — which is what keeps a scroll-driven header out of `check-no-derivation`'s way honestly
    // rather than by exemption.
    //
    // **Default margins, and the sentinel does the work by sitting `COLLAPSE` px down the page** (see the
    // markup). The first version used `rootMargin: '-96px'` on a sentinel at the very top, reasoning that
    // it would shrink the root until the crossing point — and it collapses the header *immediately*
    // instead, because an element at y=0 is already outside a root whose top edge has been pushed to 96.
    // Caught on the first browser pass, which is the only place it could have been: jsdom has no
    // `IntersectionObserver` at all, so no suite can see this either way.
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(entry !== undefined && !entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      {/* A zero-height marker `COLLAPSE` px down the page: while it is on screen the header is expanded,
          and the moment it scrolls off the top the header collapses. The wrapper is `h-0` so none of this
          takes any layout — the room the fixed header needs is the spacer at the bottom of this fragment. */}
      <div aria-hidden className="relative h-0">
        <div ref={sentinel} className="absolute h-0 w-0" style={{ top: COLLAPSE }} />
      </div>
      <header
        data-collapsed={collapsed ? 'true' : 'false'}
        className="collapsing-header fixed inset-x-0 top-0 z-10"
        style={{
          height: `calc(env(safe-area-inset-top, 0px) + ${expandedHeight}px)`,
          // Custom properties rather than conditional classes: the two states differ only in numbers, and
          // Tailwind cannot express `env()` arithmetic at build time anyway.
          ['--ch-label-top' as string]: `calc(env(safe-area-inset-top, 0px) + ${labelExpandedTop}px)`,
          ['--ch-label-size' as string]: `${labelExpandedSize}px`,
          ['--ch-label-size-collapsed' as string]: `${labelCollapsedSize}px`,
        }}
      >
        {/* The glass bar the collapsed state settles into — invisible at rest. */}
        <div className="ch-pill glass-pane" />
        <div className="ch-badge">{badge}</div>
        <div className="ch-label">
          {collapsed && collapsedLabel !== undefined ? collapsedLabel : label}
        </div>
        {trailing ? <div className="ch-trailing">{trailing}</div> : null}
      </header>
      {/* The room the fixed header would otherwise take out of the flow. */}
      <div
        aria-hidden
        style={{ height: `calc(env(safe-area-inset-top, 0px) + ${expandedHeight}px)` }}
      />
    </>
  )
}

/**
 * How far a rider scrolls before the header is fully collapsed — `COLLAPSE` on the RN component.
 *
 * Exported because Route detail's `scroll-margin-top` has to clear the *collapsed* bar when the boarding
 * row is scrolled to, and two numbers that must agree should be one.
 */
export const COLLAPSE = 96
