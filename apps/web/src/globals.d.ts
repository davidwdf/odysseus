/**
 * Build-time globals, substituted by vite's `define` (WP6-7).
 *
 * Declared rather than left implicit so that a missing `define` is a **typecheck failure** instead of a
 * `ReferenceError` at first render. That is the whole argument for a `define` over a `VITE_*` env var
 * here: an unset env var is `undefined`, the About screen prints nothing where a build identifier should
 * be, and the result is indistinguishable from a rider running an old build.
 *
 * Both `vite.config.ts` and `vitest.config.ts` supply it, from the same source — this package's own
 * `version`. The suite needs it because the screen reads it at render time.
 */
declare const __APP_VERSION__: string
