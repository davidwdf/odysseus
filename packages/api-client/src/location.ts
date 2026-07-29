// The rider-facing location state machine: permission, then a fix, with a remembered fix underneath it.
//
// WHY THIS IS HERE AND NOT IN A COMPONENT
// `packages/ports`' `LocationProvider` has exactly three methods, and its own doc names the three
// things that sit *on top* of it and must not be added to it: grid-snapping every coordinate, keeping
// the last fix so a cold offline launch paints, and deliberately having no `watch()`. Until WP4-1 all
// three lived inside `apps/mobile/lib/useLocation.ts` — recorded in ADR-051 as *"conflates the port
// with shared logic"* — which meant a second renderer had to reimplement the state machine, not just
// the adapter. Three platforms, three subtly different answers to "what does a rider see while the
// GPS warms up", is exactly the drift Wave 4 exists to disprove.
//
// WHY THE `client` LAYER
// It is the only layer that may compose `kernel` and `ports` (`layers.json`): the kernel may not
// import a port at all, and the view is what we are trying to keep thin. The package's name says
// "api-client", which is narrower than what it now holds — that is an honest mismatch, and the
// alternative (a package per shared concern) buys a layer edit and a `package.json` for one file.
//
// WHY IT EMITS RATHER THAN RETURNS
// The interesting behaviour is a *sequence*: `loading` → the remembered cell (`stale: true`, so the
// screen can say so) → the live cell. Returning one state would collapse the middle step, and the
// middle step is the entire reason the remembered fix exists. Each platform wraps this in ten lines of
// its own framework — a `useState` here, an `@Published` there — and holds no rules of its own.

import { type Fix, snapFix } from '@nextbus/core'
import type { KeyValueStore, LocationProvider, LocationState } from '@nextbus/ports'

/** Where the remembered fix lives. One key, so a native port cannot invent a second spelling. */
export const LAST_FIX_KEY = 'nextbus.lastFix.v1'

export interface LocationController {
  /**
   * Mount. Checks the existing permission **without ever prompting** — an unexplained OS dialogue on
   * first launch is the easiest way to lose location access permanently — and paints the remembered
   * cell before the live one when we already have permission.
   */
  start(): Promise<void>
  /** Prompt for permission, then fetch. Only ever from an explicit rider action. */
  request(): Promise<void>
}

export interface LocationControllerDeps {
  provider: LocationProvider
  store: KeyValueStore
  /** Called on every state transition, in order. */
  emit(state: LocationState): void
  /**
   * Whether the caller still cares. A screen that unmounted mid-flight passes `false` and no further
   * state is emitted — the `active` flag `useLocation` kept, hoisted so every platform gets it rather
   * than each remembering to write it.
   */
  alive?(): boolean
}

export function createLocationController(deps: LocationControllerDeps): LocationController {
  const alive = () => deps.alive?.() ?? true
  const emit = (state: LocationState) => {
    if (alive()) deps.emit(state)
  }

  /** The remembered cell, or `null`. A malformed or unreadable value is `null`, never a throw: this
   *  runs on the path that exists *because* something else already failed. */
  const readLastFix = async (): Promise<Fix | null> => {
    try {
      const raw = await deps.store.get(LAST_FIX_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<Fix>
      if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null
      return { lat: parsed.lat, lng: parsed.lng }
    } catch {
      return null
    }
  }

  /**
   * @param showLoading pass `false` when a remembered fix has already been painted. React batches
   * updates within one continuation, so a `loading` emitted here would coalesce with that paint and
   * the rider would see the spinner anyway — which defeats the whole point of keeping the last fix.
   * (Found on React 19 in `apps/mobile`; it is a property of any batching renderer, so it is stated
   * here rather than remembered per platform.)
   */
  const fetchFix = async (showLoading = true) => {
    if (showLoading) emit({ status: 'loading' })
    try {
      const raw = await deps.provider.currentFix()
      // **Snapping is mandatory, not optional** (`snapFix`, ADR-058 / WP2-6): 25 m cells are what make
      // the coordinate private, the edge response cacheable and an offline replay hit the same key.
      const fix = snapFix(raw)
      emit({ status: 'ready', ...fix })
      // Fire-and-forget: a rider whose storage is full still gets their arrivals.
      void deps.store.set(LAST_FIX_KEY, JSON.stringify(fix)).catch(() => {})
    } catch (err) {
      // No GPS and no network — routine on a desktop PWA, and the case the remembered fix exists for.
      const last = await readLastFix()
      if (last) emit({ status: 'ready', ...last, stale: true })
      else emit({ status: 'error', message: (err as Error).message })
    }
  }

  return {
    async start() {
      try {
        const permission = await deps.provider.permission()
        if (!alive()) return
        if (permission.status === 'granted') {
          // Paint the last cell first so the list can come from cache while the GPS warms up. When it
          // is the same cell the query key does not move at all and there is no second render.
          const last = await readLastFix()
          if (last) emit({ status: 'ready', ...last, stale: true })
          await fetchFix(!last)
        } else if (permission.status === 'denied') {
          emit({ status: 'denied', canAskAgain: permission.canAskAgain })
        } else {
          emit({ status: 'undetermined' })
        }
      } catch (err) {
        emit({ status: 'error', message: (err as Error).message })
      }
    },

    async request() {
      emit({ status: 'loading' })
      try {
        const permission = await deps.provider.requestPermission()
        if (permission.status === 'granted') await fetchFix()
        else if (permission.status === 'denied')
          emit({ status: 'denied', canAskAgain: permission.canAskAgain })
        // `undetermined` after an explicit request means the platform dismissed the dialogue without
        // an answer. Re-emitting `undetermined` returns the screen to its priming state, which is the
        // honest reading: nothing was decided, so ask again when the rider is ready.
        else emit({ status: 'undetermined' })
      } catch (err) {
        emit({ status: 'error', message: (err as Error).message })
      }
    },
  }
}
