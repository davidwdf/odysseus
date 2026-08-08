import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { readScrollOffset, writeScrollOffset } from '../lib/scrollOffsets'

/**
 * Put a scrolling element back where the rider left it when they come back to it — the DOM answer to what a
 * native navigation stack gives away free.
 *
 * ## Why this exists rather than `<ScrollRestoration>`
 *
 * `docs/07` filed this as small, on the grounds that react-router's own `<ScrollRestoration>` became
 * available when the shell became a data router (ADR-101). **That was wrong, and the reason is worth
 * keeping:** `<ScrollRestoration>` restores `window.scrollY`, and the screen that needs restoring does not
 * scroll the window at all. Search is `h-dvh` with an inner `overflow-y-auto` list, because that is what
 * pins the keypad to the bottom — a *document* that scrolled would take the pad with it, which is the bug
 * that fix removed. The document's scroll offset on that screen is always 0, so the component that restores
 * it restores nothing. react-router has no vocabulary for an element's scroll offset, so this is ours.
 *
 * ## The history entry, not the URL, is the identity
 *
 * The offset is stored against `useLocation().key` — react-router's per-history-entry id, which it keeps in
 * `history.state` and hands back unchanged on a POP. That is what makes "come back to it" mean *this* visit
 * rather than *any* visit to the same URL: two entries that happen to share a URL keep their own offsets,
 * and a rider who reaches `/search?q=8` a second time from somewhere else starts at the top.
 *
 * It also gets the interaction with ADR-102 right for free. Every keystroke on Search rewrites the URL with
 * `replace: true`, and a replace **mints a new key** — so a changed query is a new entry with nothing stored
 * against it, and this hook leaves the list exactly where the browser put it instead of dragging a stale
 * offset across a different set of results.
 *
 * ## Restoring is not "set `scrollTop` on mount"
 *
 * Assigning `scrollTop` to an element that has nothing to scroll silently clamps to 0, and the value is
 * gone. On a POP back into Search the list is usually populated in the very first commit — `useSearchIndex`
 * memoizes the index for the session — but "usually" is not a contract: a rider who arrives with a cold
 * memo gets a skeleton first. So the offset is held **pending** until a render in which the element is
 * genuinely scrollable, and applied then; a mount that never gets there keeps it pending rather than
 * writing 0 over it on the way out.
 *
 * That last clause is also what makes the hook safe under `<StrictMode>`, which mounts, unmounts and mounts
 * again: the throwaway unmount cannot erase a saved offset it never managed to apply.
 */
export function useScrollRestoration<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const { key } = useLocation()
  /** The offset this history entry is owed and has not been given yet — `null` once there is nothing owed. */
  const pending = useRef<number | null>(null)

  /**
   * Read on the way in, write on the way out — and the way out is what does the saving.
   *
   * A `useLayoutEffect` cleanup runs while the element is still in the document, which is the whole reason
   * it is this hook's save point: React detaches a removed subtree *after* running its destructors, and a
   * detached element reports `scrollTop` 0 because it has no layout box. There is no scroll listener,
   * deliberately — the offset is only ever read at the two instants it is needed, so an inner list that a
   * rider flings does not write to storage sixty times a second.
   */
  useLayoutEffect(() => {
    const saved = readScrollOffset(key)
    pending.current = saved !== null && saved > 0 ? saved : null
    return () => {
      // Never applied means never earned: writing here would replace a real offset with the 0 of a list
      // that never got the chance to scroll.
      if (pending.current !== null) return
      const el = ref.current
      if (el !== null) writeScrollOffset(key, el.scrollTop)
    }
  }, [key])

  /**
   * Apply, on the first render in which there is something to apply it to.
   *
   * No dependency array: this must get a look at *every* commit, because the render that turns a skeleton
   * into a list is not distinguishable from here. `pending` is what bounds it — one attempt against real
   * content and the hook is done, so a saved offset that is longer than the new content clamps once and
   * never fights the rider for the scrollbar afterwards.
   */
  useLayoutEffect(() => {
    const want = pending.current
    const el = ref.current
    if (want === null || el === null) return
    // Nothing to scroll yet: a skeleton, an empty result set, or a list whose content has not landed.
    if (el.scrollHeight <= el.clientHeight) return
    el.scrollTop = want
    pending.current = null
  })

  /**
   * A reload or a closed tab runs no React cleanup, so the save point above never fires — `pagehide` is the
   * event that covers both, and the bfcache restore that follows a back gesture on iOS Safari.
   *
   * Worth having rather than nice to have: `sessionStorage` and the entry's key both survive a reload
   * (react-router reads the key back out of `history.state`), so without this the one navigation that
   * *looks* most like it should restore — refresh the page you are on — is the one that would not.
   */
  useEffect(() => {
    const save = () => {
      const el = ref.current
      if (el !== null && pending.current === null) writeScrollOffset(key, el.scrollTop)
    }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [key])

  return ref
}
