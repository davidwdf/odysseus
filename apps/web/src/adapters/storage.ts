import type { KeyValueStore } from '@nextbus/ports'

/**
 * `localStorage` as `KeyValueStore`.
 *
 * Every method is wrapped, because `localStorage` **throws** rather than returning null in two
 * ordinary situations: Safari private browsing (quota 0, so `setItem` throws `QuotaExceededError`) and
 * a partitioned third-party context. The port's contract is that a failed write means "the preference
 * did not stick this time", never an interrupted rider — so a rejection here would be wrong, and a
 * throw would be worse.
 */
export const localStorageStore: KeyValueStore = {
  async get(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Deliberately swallowed — see above. The in-memory value is still correct.
    }
  },
  async remove(key) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Same.
    }
  },
}
