import { t } from '@nextbus/i18n'
import { ELEVATION, GLASS_RIM, webBoxShadow } from '@nextbus/ui'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useNavigationType } from 'react-router'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { CONTENT_INSET_TOP } from './layout'

/** The RN app's `GLASS_BUTTON_SIZE`. Circular, so the radius is half of it. */
const SIZE = 48

/**
 * Back, for the destinations that are pushed rather than switched to — **a floating glass lens fixed to
 * the top, the same control `apps/mobile` draws** (`components/GlassIconButton.tsx`).
 *
 * ## What changed, and why the old version was not merely a different look
 *
 * This used to be a labelled pill in the document flow: an arrow, the word "Back", a border, sitting
 * inside each screen's header. Two consequences, and the second is the one that mattered — it **scrolled
 * away**. On four screens a rider who had scrolled had no way back except the browser's own chrome, which
 * an installed PWA does not have. The RN control never scrolls away, because it floats.
 *
 * So it is `position: fixed` now, icon-only, glass, and 48 px — `GLASS_BUTTON_SIZE`, comfortably over the
 * 44 px minimum ADR-075 puts on the identity side even though the glyph inside is 22.
 *
 * ## The safe-area inset is not optional here
 *
 * `index.html` opts into `viewport-fit=cover` and a translucent status bar, and until this commit
 * **nothing on the web side read `env(safe-area-inset-top)`** — which the parity audit raised as an amber
 * and which a control fixed to the top turns into a blocker: on an installed iOS PWA it would sit under
 * the clock. `apps/mobile` gets this free from `useSafeAreaInsets().top`; the DOM has to ask.
 *
 * ## Its name is an attribute now, which changes what a test can see
 *
 * Icon-only means there is no text node, so the word "Back" is an `aria-label` rather than content. Every
 * conformance driver already discarded that word as chrome noise, so no projection moves; what did move is
 * `shell.test.tsx`'s "every pushed destination gives a way back", which now reads the accessible name
 * instead of the rendered text. That is a better assertion than the one it replaces — it is what a screen
 * reader is offered rather than what a sighted rider happens to see.
 *
 * `useNavigationType()` still distinguishes the two behaviours: `PUSH` means this app put the entry there
 * and a pop returns inside it; `POP` or `REPLACE` means a cold arrival from a bookmark or a shared link,
 * so the control goes *up* to Nearby rather than out of the app.
 */
export function BackButton() {
  const locale = useLocale()
  const navigate = useNavigate()
  const mode = useAppearance()
  const cameFromInsideTheApp = useNavigationType() === 'PUSH'
  return (
    <button
      type="button"
      aria-label={t(locale, 'back')}
      onClick={() => (cameFromInsideTheApp ? navigate(-1) : navigate('/'))}
      className="glass-pane fixed left-3 z-20 flex items-center justify-center rounded-full border border-border text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      style={{
        top: `calc(${CONTENT_INSET_TOP} + 12px)`,
        width: SIZE,
        height: SIZE,
        // ADR-035: a drop shadow has almost no contrast budget on a near-black field, so dark leans on the
        // rim and the border alone — the same branch the tab bar and `elevationStyle` make.
        boxShadow: webBoxShadow(
          mode === 'dark'
            ? [GLASS_RIM.top.dark, GLASS_RIM.bottom.dark]
            : [GLASS_RIM.top.light, GLASS_RIM.bottom.light, ELEVATION.e3],
        ),
      }}
    >
      <ArrowLeft aria-hidden width={22} height={22} />
    </button>
  )
}
