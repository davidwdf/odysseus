import { type Mode, resolveMode, themeColor, themes } from '@nextbus/ui'
import { useEffect, useState } from 'react'
import { usePreferences } from './preferences'

/**
 * Appearance for the DOM renderer: the persisted preference plus the OS scheme, resolved to a mode and
 * applied to the document.
 *
 * The **rule** is shared — `resolveMode(appearance, systemIsDark)` in `@nextbus/ui`, the same call
 * `apps/mobile/lib/useTheme.ts` makes — and the **mechanism** is each platform's own, which is exactly
 * the split ADR-075 draws. There, NativeWind's `vars(themes[mode])` injects the token values onto a
 * `<View>`; here the values are already in `tokens.css` under `:root` and `.dark`, so applying a mode is
 * one class on `<html>`. Neither app has an opinion about the other's mechanism, and there is one
 * declaration of what `auto` means.
 *
 * The class goes on `<html>` rather than on the app root so the very first paint carries it: `index.css`
 * paints `body` with `bg-bg`, and a `.dark` applied after hydration is a visible flash of the wrong
 * theme. `main.tsx` therefore calls `applyMode` *before* `createRoot().render`.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Does the OS ask for dark right now?
 *
 * `matchMedia` is guarded rather than assumed: it is absent in some embedded WebViews (and in jsdom, which
 * is why the suite stubs it explicitly rather than letting this fallback stand in for the real path).
 * Absence resolves **light**, which is the safe direction — `auto` then means light, and the rider can
 * still choose dark, whereas a crash here would take the whole shell down over a preference.
 */
export function systemPrefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DARK_QUERY).matches
}

/** The mode the stored preference resolves to at this instant — what the pre-render bootstrap needs. */
export function currentMode(): Mode {
  return resolveMode(usePreferences.getState().appearance, systemPrefersDark())
}

/**
 * Put a mode on the document.
 *
 * `theme-color` is **created here rather than declared in `index.html`**, and follows the mode. A literal
 * in the HTML would be a fourth copy of the ink value (the token, the generated CSS, the manifest); this
 * way the browser chrome and the page background are the same token by construction, and they track a
 * mode switch instead of being pinned to the dark one. The manifest still carries a static
 * `theme_color`, because that is what an installed launcher reads before any script runs.
 */
export function applyMode(mode: Mode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', themeColor(themes[mode], '--bg'))
}

/**
 * Keep the document in step with the preference and with the OS.
 *
 * Both inputs can move while the app is open — the rider picks *Dark* in Settings, or macOS flips at
 * sunset with the preference on `auto` — so the media query is subscribed to rather than read once.
 * Returns the active mode for anything that needs it as a value.
 */
export function useAppearance(): Mode {
  const appearance = usePreferences((s) => s.appearance)
  const [systemIsDark, setSystemIsDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    media.addEventListener('change', onChange)
    // Re-read on mount: the OS can have changed between the module-scope bootstrap and here.
    setSystemIsDark(media.matches)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const mode = resolveMode(appearance, systemIsDark)
  useEffect(() => {
    applyMode(mode)
  }, [mode])
  return mode
}
