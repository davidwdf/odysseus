/**
 * The lab shell's one shared number.
 *
 * Its own module because `main.tsx` draws the tab bar and `Components.tsx` sticks its sidebar under it, and
 * `main.tsx` already imports `Components` — declaring it in either would be an import cycle, and one of the
 * two would end up guessing the other's height. A file with one constant in it is the cheap answer.
 *
 * **A constant rather than a measurement**, deliberately: the alternative is a `ResizeObserver` in the lab's
 * shell to answer a question that has one answer. What makes the constant *true* is that the bar is
 * `flex-wrap: nowrap` with `overflow-x: auto` — one row at every width, so a narrow window scrolls it
 * sideways instead of growing it.
 */
export const NAV_H = 44
