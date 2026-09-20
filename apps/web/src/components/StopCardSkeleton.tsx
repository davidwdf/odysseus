/**
 * **A `StopCard`-shaped wait**, sized to the boxes the content will occupy — the treatment Route detail
 * got in WP6-8a (`RouteStopRow`'s `arrivalsPending`) and the two screens that wait longest never did.
 *
 * The owner's original ask was about the route schematic: *"times should arrive into skeletons, not into
 * empty space — a delay makes the whole list jump as each row's readout appears."* Nearby and Favourites
 * have the same defect and a worse case of it. Favourites fans out **one query per saved pole**, so its
 * cards arrive one at a time; Nearby's list arrives after a location fix *and* a round trip. Both stood in
 * for a card with a couple of grey bars of arbitrary size, so the list jumped twice — once when the
 * skeleton was replaced, and again as each row's readout landed.
 *
 * ## Every measurement here is the real component's, and that is the whole point of the file
 *
 * A skeleton that is merely *grey and roughly card-sized* still moves the layout when it is replaced. So
 * each bar is the line box of the thing it stands in for, read off `StopCard`:
 *
 * | Bar | Stands in for | Box |
 * |---|---|---|
 * | name | `StopName`'s `<h3 className="text-h3">` | 24 px — `text-h3` is 18/24 |
 * | caption | the `text-caption` line under it, with its glyph | 16 px — `text-caption` is 12/16 |
 * | chip | `RouteChip` at `md` — `min-w-[44px] px-2 py-1 text-label` | 28 px tall (20 line + 8 padding), 44 wide |
 * | readout | `EtaBadge`'s figure, `text-h2` | 28 px — `text-h2` is 22/28 |
 *
 * and the row keeps `StopCard`'s own `py-1.5`, so a skeleton row and a real row are the same 40 px.
 *
 * ## Two things it deliberately is not
 *
 * **It is not drawn when a round has answered with nothing.** *"No bus due"* and *"we have not asked yet"*
 * are different facts, and one placeholder for both is the conflation ADR-073 spent a wave separating and
 * ADR-124 fixed twice. Both callers mount this only in their `isPending` arm, never in their empty one.
 *
 * **It is `aria-hidden` and wordless.** The conformance walker reads *presence*, not visibility, so a
 * labelled placeholder would project into every state that mounts before its data — the trap
 * `RouteStopRow`'s skeleton note records. A screen reader is told the screen is busy by the screen's own
 * copy ("Locating…"), which is content and stays outside this component.
 */
export function StopCardSkeleton({
  rows = 3,
  caption = true,
}: {
  /** How many route rows to stand in for. Nearby's stops carry several; a saved place often carries one. */
  rows?: number
  /** Whether to reserve the caption line. Absent on a card whose place has no bearing or distance. */
  caption?: boolean
}) {
  return (
    <section className="animate-pulse px-4 py-4" aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* `text-h3`'s line box, at the width a Hong Kong stop name usually runs to. */}
          <div className="h-6 w-2/3 rounded-sm bg-surface-2" />
          {caption ? <div className="mt-0.5 h-4 w-40 rounded-sm bg-surface-2" /> : null}
        </div>
        {/* The chevron's own box, so the heading row does not re-flow when it appears. */}
        <div className="mt-0.5 h-5 w-5 shrink-0 rounded-sm bg-surface-2" />
      </div>
      <div className="mt-2">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity to key on.
          <div key={i} className="flex items-center justify-between gap-3 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {/* `RouteChip` at `md`: 44 × 28, `rounded-md`. */}
              <div className="h-7 w-11 shrink-0 rounded-md bg-surface-2" />
              {/* The destination line. Varied widths, because a column of identical bars reads as a
                  loading *graphic* rather than as the list that is coming. */}
              <div
                className="h-5 rounded-sm bg-surface-2"
                style={{ width: `${[72, 58, 65, 50][i % 4]}%` }}
              />
            </div>
            {/* `EtaBadge`'s figure box — this is the one that matters most, because it is what fixes the
                right-hand column's x-position before any number exists. */}
            <div className="h-7 w-12 shrink-0 rounded-sm bg-surface-2" />
          </div>
        ))}
      </div>
    </section>
  )
}
