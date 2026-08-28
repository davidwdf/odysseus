/**
 * **The fare for the stretch of route you are looking at**, pinned to the top of the list while that
 * stretch is on screen.
 *
 * A Hong Kong route is priced in stages, so the per-row fare said the same figure on nearly every row
 * — the same `$6.7` forty times — while competing with the stop's name for the one edge the `⋯` also
 * wants. Said once per stage it becomes information again: the header changes exactly where a rider's
 * cost changes, and that is the only place the number is news.
 *
 * ## `position: sticky`, not a scroll listener
 *
 * The obvious implementation is to track the topmost visible row and read its fare. This does the same
 * thing with none of it: each stage header sticks to the top of the scroller until the next one pushes
 * it out, which is the browser doing the arithmetic. No listener, no measurement to go stale, nothing
 * to recompute on a reflow — and it degrades correctly, because a browser without sticky simply shows
 * the headers in place.
 *
 * Where a stage *starts* is the kernel's (`fareStageStarts`): a comparison between adjacent rows is a
 * claim about the route, and a missing fare in the middle is a gap rather than a change.
 */
export function FareStage({ fare, label }: { fare: string; label: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-bg/95 px-4 py-1 backdrop-blur-sm">
      <span className="text-caption text-subtle">{label}</span>
      <span className="text-caption font-semibold text-text tabular-nums">{fare}</span>
    </div>
  )
}
