import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * **A sheet's scrolling body, which fades where its content passes under the top edge.**
 *
 * A sheet's content starts flush against the handle above it, so a row scrolled halfway out of view is cut
 * off by a hard line and reads as a row that ends there. The fade says *there is more above*, and it says
 * it only when that is true: at rest the fade is 0 px tall and the top row is drawn exactly as it would be
 * without this component. That is the whole behaviour, and it is why the state is a boolean rather than a
 * scroll offset — "at the top" is the one distinction a rider can make, the same reading
 * `DraggableSheet`'s `onContentScroll` doc makes about zero.
 *
 * ## It is one component because the rule is one rule
 *
 * Both of the app's sheets scroll — the route detail's `DraggableSheet` and the `BottomSheet` a fact pill
 * opens — and they sit on **different backgrounds** (`bg-bg` and `bg-surface`). A gradient overlay in the
 * host's own colour would therefore be two declarations that can disagree, which is exactly the shape
 * ADR-082 and ADR-058 are about. So the fade is a **mask on the scroller**: it fades the content itself
 * rather than veiling it in a colour, so it is correct on any background and in either theme with nothing
 * to keep in sync. `.sheet-scroll` in `index.css` holds the mask and the one length; this file holds only
 * *when* it applies.
 *
 * ## Why `data-scrolled` and not a style written per scroll event
 *
 * The mask length is a CSS transition over a registered `--sheet-fade`, so the only style mutation is at
 * the crossing — two per scroll excursion, not one per frame. Painting a mask on a 40-row scroller is the
 * expensive part; re-rasterizing it on every scroll event is how that becomes jank on a phone.
 * `setScrolled` with an unchanged value is a React bail-out, so a flick through a long list re-renders this
 * component **once**, and `children` keeps its element identity so the list itself is not reconciled.
 */
export function SheetScroll({
  className,
  onScroll,
  children,
}: {
  /** The scroll container's own layout classes — this component adds the fade and nothing else. */
  className: string
  /** The content's scroll offset in px, whenever it changes. Passed through, exactly as before. */
  onScroll?: (scrollTop: number) => void
  children: ReactNode
}) {
  const [scrolled, setScrolled] = useState(false)
  return (
    <div
      className={`sheet-scroll ${className}`}
      data-scrolled={scrolled}
      onScroll={(event) => {
        const { scrollTop } = event.currentTarget
        setScrolled(scrollTop > 0)
        onScroll?.(scrollTop)
      }}
    >
      {children}
    </div>
  )
}
