import type { Appearance } from '@nextbus/ui'
import { APPEARANCES } from '@nextbus/ui'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import '../src/tokens.css'
import { applyMode, currentMode, useAppearance } from '../src/lib/appearance'
import { usePreferences } from '../src/lib/preferences'
import { Components } from './Components'
import { NAV_H } from './chrome'
import { Gallery } from './Gallery'
import { GlyphLab } from './GlyphLab'
import { RailLab } from './RailLab'

// The lab's entry. Deliberately NOT `<StrictMode>`: the app runs in it, and it is worth being able to
// switch between the two, but a double-invoked layout effect makes a "did that animation fire once?"
// question harder to answer by eye. Turn it on if you want to confirm the FLIP is idempotent.
//
// `applyMode` before the first render, exactly as `src/main.tsx` does it: `index.css` paints `body` with
// `bg-bg`, so a `.dark` applied after hydration is a visible flash of the wrong theme.
applyMode(currentMode())

/**
 * There is more than one lab, so the hash picks — **first segment the lab, second whatever that lab makes
 * of it** (`#components/EtaBadge`). A hash rather than a route because the lab is served by `vite dev` as a
 * plain file and has no router; adding one would be the first step toward this page having an architecture,
 * which is the thing ADR-112 is trying to avoid.
 *
 * ## The order is the order you use them in
 *
 * Components first and by default, at the owner's ask, because that is what the lab is *for*: the contract
 * listing and the two motion rigs are things you go to on purpose. It used to open on `#rail`, which was
 * true when the rail rig was the only thing here.
 */
const LABS = {
  '#components': { title: 'Components', render: () => <Components /> },
  '#gallery': { title: 'Design system', render: () => <Gallery /> },
  '#rail': { title: 'Rail motion', render: () => <RailLab /> },
  '#glyphs': { title: 'Bus glyphs', render: () => <GlyphLab /> },
} as const

type LabKey = keyof typeof LABS

const DEFAULT_LAB: LabKey = '#components'

function currentLab(): LabKey {
  // Only the first segment picks the lab; `#components/EtaBadge` is still the Components tab, and the
  // second segment is that page's business (`lab/Components.tsx` reads it).
  const first = `#${window.location.hash.replace(/^#/, '').split('/')[0] ?? ''}` as LabKey
  return first in LABS ? first : DEFAULT_LAB
}

/**
 * Appearance, on every tab.
 *
 * **It writes the real preference** — `usePreferences.setAppearance`, the same store the Settings screen
 * writes and the same `resolveMode` rule both apps share — rather than a lab-local mode. A second notion of
 * what `auto` means, in the one page whose job is checking that things agree, would be the exact mistake
 * this repo keeps writing ADRs about. The consequence is honest and worth knowing: flipping it here flips
 * the app on this origin, because it is the same control.
 *
 * `useAppearance()` is what makes it take effect — the module-scope `applyMode` above runs once, and the
 * preference and the OS scheme can both move while the lab is open.
 */
function AppearanceControl() {
  useAppearance()
  const appearance = usePreferences((s) => s.appearance)
  const setAppearance = usePreferences((s) => s.setAppearance)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
      <span className="text-caption text-subtle">Appearance</span>
      <div
        className="bg-bg"
        style={{
          display: 'flex',
          gap: 2,
          padding: 2,
          // `rgb(var(--border))` rather than a `border-border` class plus a `border` utility: the class
          // sets a colour and the width would have to come from somewhere the app already uses. Reading
          // the token is not restating it.
          border: '1px solid rgb(var(--border))',
          borderRadius: 999,
        }}
      >
        {/* `APPEARANCES` from `@nextbus/ui`, never a literal array: it is the one declaration of the set
            AND its order (WP6-7), and the Settings screen offers exactly these three. */}
        {APPEARANCES.map((option: Appearance) => (
          <button
            key={option}
            type="button"
            aria-pressed={appearance === option}
            onClick={() => setAppearance(option)}
            className={`text-caption ${
              appearance === option ? 'bg-accent text-accent-contrast' : 'text-muted'
            }`}
            style={{
              border: 0,
              borderRadius: 999,
              padding: '3px 11px',
              background: appearance === option ? undefined : 'transparent',
              textTransform: 'capitalize',
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

function Switcher() {
  const key = currentLab()
  return (
    <>
      <nav
        className="border-border border-b bg-surface-2"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          boxSizing: 'border-box',
          height: NAV_H,
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 16px',
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          {(Object.keys(LABS) as LabKey[]).map((k) => (
            <a
              key={k}
              href={k}
              className={`rounded-full px-3 py-1 text-caption ${
                k === key ? 'bg-accent text-accent-contrast' : 'text-muted'
              }`}
              style={{ textDecoration: 'none' }}
            >
              {LABS[k].title}
            </a>
          ))}
        </div>
        <AppearanceControl />
      </nav>
      {LABS[key].render()}
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('lab/index.html is missing #root')
const react = createRoot(root)
const draw = () => react.render(<Switcher />)
window.addEventListener('hashchange', draw)
draw()
