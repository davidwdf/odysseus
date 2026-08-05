// A minimal stand-in for `react-native-reanimated`, aliased in `vitest.config.ts`.
//
// WHY THIS FILE EXISTS AT ALL
// Reanimated cannot load outside Metro: `src/specs/NativeReanimatedModule.ts` evaluates
// `TurboModuleRegistry.get('ReanimatedModule')` at import time and there is no registry here, so **importing
// any screen that animates dies at import** — which vitest counts as a failed *file* rather than failed
// tests. That is the exact vacuous-pass shape WP6-0's parity suite hit, so it is worth naming: a suite that
// fails to load reports nothing about the renderer, and a suite that never loaded reports nothing at all.
//
// The package ships `mock.js` for this and it does not work in reanimated 4: its entry `require`s
// `./src/mock` with no extension (unresolvable to a `.ts` by node), and `src/mock.ts` itself pulls in the
// same native spec chain. So this is hand-written, and deliberately the smallest thing the screens under test
// actually import — measured, not guessed:
//
//   grep -rn "from 'react-native-reanimated'" apps/mobile
//
// WHAT SUBSTITUTING IT DOES AND DOES NOT COST
// Everything here is **motion**, which ADR-075 puts on the *idiom* side of the invariant line — the
// conformance suites assert the text a screen shows, and `place-detail.spec.json` says as much in its
// `reducedMotion` and `idiom` blocks. What these suites therefore cannot see is a collapse curve, a
// picture-in-picture crop or a scroll-spy highlight. What they can see, and could not before, is every string
// the screen draws in each of the spec's states — which is the half that had no coverage at all.
//
// The shims are *inert* rather than approximate on purpose. `useAnimatedStyle` returning `{}` means the tree
// renders at its resting geometry, which is the state a spec describes; a fake interpolation would invite
// somebody to trust it.

import { type ComponentType, createElement, forwardRef, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

/** A shared value is a plain mutable box. The screens read and write `.value`; nothing here reacts to it. */
export function useSharedValue<T>(initial: T): { value: T } {
  return { value: initial }
}

/** A scroll handler that is never called: the tree is read at rest, so no offset is ever delivered. */
export function useAnimatedScrollHandler(): () => void {
  return () => {}
}

/** No worklet runs, so no reaction fires. A screen whose *content* depended on one would be a finding. */
export function useAnimatedReaction(): void {}

/** Resting geometry. See the note above on why this is inert rather than approximate. */
export function useAnimatedStyle(): Record<string, never> {
  return {}
}

export function interpolate(_value: number, _input: readonly number[], output: readonly number[]) {
  // The value at rest — the first output stop, which is the expanded/full state every spec describes.
  return output[0] ?? 0
}

export function interpolateColor(
  _value: number,
  _input: readonly number[],
  output: readonly (string | number)[],
) {
  return output[0] ?? 'transparent'
}

export function runOnJS<A extends unknown[], R>(fn: (...args: A) => R) {
  return fn
}

export function withTiming<T>(to: T): T {
  return to
}
export function withDelay<T>(_ms: number, animation: T): T {
  return animation
}
export function withRepeat<T>(animation: T): T {
  return animation
}
export function withSequence<T>(...animations: T[]): T | undefined {
  return animations[0]
}
export function cancelAnimation(): void {}

/**
 * `false`, and that is the honest default rather than a convenience: the suites read a tree at rest, so
 * whether a *transition* would have been animated is invisible to them either way. What the spec asserts
 * about reduced motion is that the **content is identical** with it on or off, which holds by construction
 * here — nothing in this shim animates at all.
 */
export function useReducedMotion(): boolean {
  return false
}

export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' } as const
export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => t,
  quad: (t: number) => t,
  sin: (t: number) => t,
  bezier: () => (t: number) => t,
  in: (fn: (t: number) => number) => fn,
  out: (fn: (t: number) => number) => fn,
  inOut: (fn: (t: number) => number) => fn,
}

/** Entering/exiting animations are props the plain views below simply ignore. */
export const FadeIn = { duration: () => FadeIn, delay: () => FadeIn }
export const FadeOut = { duration: () => FadeOut, delay: () => FadeOut }
/**
 * The layout transition `EtaTimes` uses so a bus keeps its slot when a round refreshes.
 *
 * Added for WP6-6b's route-detail suites, and it is the same argument as everything else here: the
 * *reordering* is what the layout transition animates, and which slot a reading is in is the model's (each
 * arrival carries its own `iso` as the key). A shim that pretended to animate would invite someone to trust it.
 */
export const LinearTransition = { duration: () => LinearTransition, delay: () => LinearTransition }

export type SharedValue<T> = { value: T }
export type AnimatedStyle = Record<string, unknown>

/** `Animated.View` / `Animated.ScrollView` as the plain components, with the animation props dropped. */
const plain = <P extends object>(Component: ComponentType<P>) =>
  forwardRef<unknown, P & { entering?: unknown; exiting?: unknown; children?: ReactNode }>(
    ({ entering: _entering, exiting: _exiting, ...props }, ref) =>
      createElement(Component as ComponentType<Record<string, unknown>>, {
        ...(props as Record<string, unknown>),
        ref,
      }),
  )

const Animated = {
  View: plain(View),
  ScrollView: plain(ScrollView),
  Text: plain(View),
  createAnimatedComponent: plain,
}

export default Animated
