import type { Locale, LocationMark } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { MAP_COLOR } from '@nextbus/ui'

/**
 * **The rider's own position on the map** — a dart where a heading is known, a dot where it is not
 * (`docs/proposals/06 §6b`, `location-mark.ts`).
 *
 * Which of the two to draw is a kernel decision and is not re-taken here; this turns that answer into
 * pixels. The distinction it must preserve is the whole point of the rule: **a dart is a direction
 * claim**, and one drawn because a default said north is the same class of lie as a client-side
 * countdown — worse in one way, because a rider working out which way to walk acts on it at once.
 *
 * Not a `<button>`, unlike the stop markers: this is not a control. It carries a `role="img"` and an
 * accessible name for the same reason the bus token does — a graphic with neither says nothing to a
 * screen reader and nothing to a projection either (ADR-093).
 */
export function riderMarkElement(mark: LocationMark, locale: Locale): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', t(locale, mark.kind === 'dart' ? 'riderHereFacing' : 'riderHere'))
  el.className = 'pointer-events-none block leading-none'
  el.innerHTML = mark.kind === 'dart' ? dart(mark.bearing) : dot()
  return el
}

/**
 * The dot: a filled disc with a halo, which is the mark every map a rider has ever used draws for
 * *"you are here"*. Familiarity is the feature — it is not worth spending novelty on.
 */
function dot(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="6.5" fill="${MAP_COLOR.rider}" stroke="${MAP_COLOR.riderHalo}" stroke-width="2.5" />
  </svg>`
}

/**
 * The dart: the same disc with a wedge on it, **rotated to the heading**.
 *
 * A wedge attached to the dot rather than an arrow replacing it, deliberately. The dot is the part we
 * are sure of — the position — and the wedge is the part we are less sure of, so a rider who has
 * learnt to look for the disc still finds it, and the direction reads as an addition to the claim
 * rather than a different claim. It is also what fails gracefully: when a compass drops out mid-walk,
 * the wedge disappears and the dot stays exactly where it was, instead of the mark changing shape
 * entirely and pulling the eye.
 */
function dart(bearing: number): string {
  return `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" style="transform: rotate(${bearing}deg)">
    <path d="M13 1.5 L18.4 9.2 L13 7.1 L7.6 9.2 Z" fill="${MAP_COLOR.rider}" stroke="${MAP_COLOR.riderHalo}" stroke-width="1.6" stroke-linejoin="round" />
    <circle cx="13" cy="13" r="6" fill="${MAP_COLOR.rider}" stroke="${MAP_COLOR.riderHalo}" stroke-width="2.5" />
  </svg>`
}
