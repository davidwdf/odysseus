import { t } from '@nextbus/i18n'
import { ELEVATION, GLASS_RIM, webBoxShadow } from '@nextbus/ui'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useNavigationType } from 'react-router'
import { useAppearance } from '../lib/appearance'
import { useLocale } from '../providers/LocaleProvider'
import { CONTENT_INSET_TOP } from './layout'

/** The RN app's `GLASS_BUTTON_SIZE`. Circular, so the radius is half of it. */
export const BACK_LENS_SIZE = 48
const SIZE = BACK_LENS_SIZE

/** The inset from the left edge — `left-3`, spelled as a number so a neighbour can clear it. */
export const BACK_LENS_INSET = 12

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
 * ## `flat` is a material, not a second control (ADR-170)
 *
 * Route detail's context card encloses this control when it is open: the card's first row **is** this
 * button's box, so the glass runs under the arrow rather than beside it. Two panes of glass stacked read
 * as two objects, so `flat` takes this one's glass, border and shadow off — and nothing else. Same
 * position, same size, same navigation rule, same accessible name, same component.
 *
 * That is deliberately the whole of it. The alternative the owner rejected was a back control **inside**
 * the card, which would have been a second button with its own copy of the `PUSH`/`POP` decision below,
 * and two of those is how they get out of step. There is one back button on every pushed screen, and on
 * this one it changes clothes.
 *
 * `useNavigationType()` still distinguishes the two behaviours: `PUSH` means this app put the entry there
 * and a pop returns inside it; `POP` or `REPLACE` means a cold arrival from a bookmark or a shared link,
 * so the control goes *up* to Nearby rather than out of the app.
 */
export function BackButton({ flat = false }: { flat?: boolean }) {
  const locale = useLocale()
  const navigate = useNavigate()
  const mode = useAppearance()
  const cameFromInsideTheApp = useNavigationType() === 'PUSH'
  return (
    <button
      type="button"
      aria-label={t(locale, 'back')}
      onClick={() => (cameFromInsideTheApp ? navigate(-1) : navigate('/'))}
      className={`fixed left-3 z-30 flex items-center justify-center rounded-full text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
        flat ? '' : 'glass-pane border border-border'
      }`}
      style={{
        top: `calc(${CONTENT_INSET_TOP} + 12px)`,
        width: SIZE,
        height: SIZE,
        // ADR-035: a drop shadow has almost no contrast budget on a near-black field, so dark leans on the
        // rim and the border alone — the same branch the tab bar and `elevationStyle` make.
        ...(flat
          ? {}
          : {
              boxShadow: webBoxShadow(
                mode === 'dark'
                  ? [GLASS_RIM.top.dark, GLASS_RIM.bottom.dark]
                  : [GLASS_RIM.top.light, GLASS_RIM.bottom.light, ELEVATION.e3],
              ),
            }),
      }}
    >
      <ArrowLeft aria-hidden width={22} height={22} />
    </button>
  )
}
