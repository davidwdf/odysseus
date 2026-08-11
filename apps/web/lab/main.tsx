import { createRoot } from 'react-dom/client'
import '../src/index.css'
import '../src/tokens.css'
import { applyMode, currentMode } from '../src/lib/appearance'
import { RailLab } from './RailLab'

// The lab's entry. Deliberately NOT `<StrictMode>`: the app runs in it, and it is worth being able to
// switch between the two, but a double-invoked layout effect makes a "did that animation fire once?"
// question harder to answer by eye. Turn it on if you want to confirm the FLIP is idempotent.
applyMode(currentMode())

const root = document.getElementById('root')
if (!root) throw new Error('lab/index.html is missing #root')
createRoot(root).render(<RailLab />)
