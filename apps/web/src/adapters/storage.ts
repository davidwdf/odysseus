import type { KeyValueStore } from '@nextbus/ports'

/**
 * `localStorage`, wrapped so it cannot throw.
 *
 * Every method needs the guard, because `localStorage` **throws** rather than returning null in two
 * ordinary situations: Safari private browsing (quota 0, so `setItem` throws `QuotaExceededError`) and
 * a partitioned third-party context. A failed write means "the preference did not stick this time"; it
 * is never a broken screen, and it must never be an unhandled rejection either.
 *
 * **`setItem` returns whether the bytes landed, and one caller must not ignore it** (ADR-125). The
 * preferences store advances its merge ancestor to "the last state this writer put on disk" — so a
 * *swallowed* write that still moved the ancestor would leave it naming something the disk does not
 * hold, which is precisely the precondition violation `mergeSavedKeys` cannot survive: this writer's own
 * addition becomes indistinguishable from the other writer's deletion, and the next merge deletes a
 * rider's favourite. Swallowing the throw is still right; **swallowing the fact of it was not.** Callers
 * with nothing to reconcile (the query persister, `localStorageStore`) may keep ignoring the result.
 *
 * This is the **synchronous** shape, which three consumers need and the async port cannot give them:
 * zustand's `persist` (a sync storage is what lets the appearance be known *before* the first paint
 * rather than flashing the wrong theme and correcting it), TanStack Query's sync persister, and
 * `localStorageStore` below. One try/catch, three callers — the alternative was these four lines copied
 * into each.
 */
export const safeLocalStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  /** `true` if the bytes landed. See the note above: one caller reconciles against disk and needs this. */
  setItem(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(key, value)
      return true
    } catch {
      // The throw is deliberately swallowed — see above; the in-memory value is still correct and no
      // screen breaks. What is *reported* is that the disk did not take it.
      return false
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Same.
    }
  },
}

/**
 * `sessionStorage`, wrapped the same way and for the same two reasons — plus a third that only applies
 * here: **it is deliberately the storage that dies with the tab.**
 *
 * The one consumer is `useScrollRestoration`, and where a rider was in a list is a fact about *this*
 * visit. Putting it in `localStorage` would restore a scroll offset from yesterday against results that
 * have since changed, which is the same "stale tail" argument that kept the search query out of the
 * persisted preferences (ADR-102). A history entry's key does not survive a closed tab either, so a
 * longer-lived store would only ever accumulate offsets nothing can ever read back.
 */
export const safeSessionStorage = {
  getItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      // Deliberately swallowed — as above. A lost scroll offset is a rider landing at the top of a list.
    }
  },
}

/**
 * The same storage as `KeyValueStore` — the async port that `@nextbus/api-client`'s location controller
 * takes. Both halves of the port's contract are already satisfied above: a rejection here would be
 * wrong, and a throw would be worse.
 */
export const localStorageStore: KeyValueStore = {
  async get(key) {
    return safeLocalStorage.getItem(key)
  },
  async set(key, value) {
    safeLocalStorage.setItem(key, value)
  },
  async remove(key) {
    safeLocalStorage.removeItem(key)
  },
}
