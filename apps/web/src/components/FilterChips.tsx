import type { SearchChip } from '@nextbus/core'

/**
 * The filter chip row — the DOM twin of `apps/mobile/components/FilterChips.tsx`.
 *
 * **The set is `searchView`'s and so is each chip's pressed state** (ADR-091): which operator chips exist
 * comes from the index, so a fifth operator appears the day its adapter lands, and `active` is a field of the
 * view rather than this component's own memory of what was tapped. All this decides is what a pressed chip
 * looks like.
 *
 * `aria-pressed` rather than a `role="checkbox"` or a visual-only fill: a chip is a toggle whose state has to
 * be announced, and colour alone is the thing ADR-008 forbids for exactly this reason.
 */
export function FilterChips({
  chips,
  onToggle,
}: {
  chips: readonly SearchChip[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-pressed={chip.active}
          onClick={() => onToggle(chip.key)}
          className={`shrink-0 whitespace-nowrap rounded-pill border px-3 py-1.5 text-label focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
            chip.active
              ? 'border-transparent bg-text text-bg'
              : 'border-border bg-surface text-text active:opacity-60'
          }`}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
