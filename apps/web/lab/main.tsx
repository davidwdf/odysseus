import { createRoot } from 'react-dom/client'
import '../src/index.css'
import '../src/tokens.css'
import { applyMode, currentMode } from '../src/lib/appearance'
import { Gallery } from './Gallery'
import { GlyphLab } from './GlyphLab'
import { RailLab } from './RailLab'

// The lab's entry. Deliberately NOT `<StrictMode>`: the app runs in it, and it is worth being able to
// switch between the two, but a double-invoked layout effect makes a "did that animation fire once?"
// question harder to answer by eye. Turn it on if you want to confirm the FLIP is idempotent.
applyMode(currentMode())

/**
 * There is more than one lab now, so the hash picks. A hash rather than a route because the lab is served
 * by `vite dev` as a plain file and has no router — adding one would be the first step toward this page
 * having an architecture, which is the thing ADR-112 is trying to avoid.
 */
const LABS = {
  '#rail': { title: 'Rail motion', render: () => <RailLab /> },
  '#glyphs': { title: 'Bus glyphs', render: () => <GlyphLab /> },
  '#gallery': { title: 'Design system', render: () => <Gallery /> },
} as const

type LabKey = keyof typeof LABS

function currentLab(): LabKey {
  const hash = window.location.hash as LabKey
  return hash in LABS ? hash : '#rail'
}

function Switcher() {
  const key = currentLab()
  return (
    <>
      <nav className="flex gap-2 bg-surface-2 px-4 py-2">
        {(Object.keys(LABS) as LabKey[]).map((k) => (
          <a
            key={k}
            href={k}
            className={`rounded-full px-3 py-1 text-caption ${
              k === key ? 'bg-accent text-accent-contrast' : 'text-muted'
            }`}
          >
            {LABS[k].title}
          </a>
        ))}
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
