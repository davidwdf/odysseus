import type { KeyValueStore } from '@nextbus/ports'

/**
 * `localStorage`, wrapped so it cannot throw.
 *
 * Every method needs the guard, because `localStorage` **throws** rather than returning null in two
 * ordinary situations: Safari private browsing (quota 0, so `setItem` throws `QuotaExceededError`) and
 * a partitioned third-party context. A failed write means "the preference did not stick this time"; it
 * is never a broken screen, and it must never be an unhandled rejection either.
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
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Deliberately swallowed — see above. The in-memory value is still correct.
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
