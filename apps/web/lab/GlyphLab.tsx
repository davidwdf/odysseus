/**
 * The glyph lab — a page for looking at bus silhouettes at the size they are actually seen.
 *
 * Asked for by the owner: *"please spin up a simple page for me to review the different designs and put
 * the current big bus glyph there as well so I can compare them."* So the shipping decker (D0) is on every
 * row, and everything is measured against it rather than against an idea of it.
 *
 * ## Why the rows are in this order
 *
 * The **token row is first and the enlarged row is last**, which is the opposite of how a glyph is usually
 * presented. A silhouette that only works at 96 px is not a glyph, it is an illustration — the token draws
 * at `24 × 0.66 ≈ 16 px` on the rail, inside an accent circle, in motion. So the first thing on the page is
 * the real thing at real size, and the blow-up is for diagnosing *why* something failed rather than for
 * deciding whether it did.
 *
 * The **motion row matters more than it looks**: the bounce squashes 6 % anchored at the wheels, and the
 * owner's reason for wanting a taller decker is that the squash visibly compresses the current one. That is
 * only judgeable while it is running, so the token row runs the real `.bus-bob` / `.bus-rock` /
 * `.bus-squash` classes from `src/index.css` — the same three nested spans `RailBusToken` uses, in the same
 * order (bob outermost, rock inside it, squash innermost; that order is load-bearing and documented there).
 */

import { useState } from 'react'
import { BusGlyph } from '../src/components/BusGlyph'
import { DECKERS, MINIBUSES } from './glyphs'

/** `RailBusToken`'s own numbers, so the token row is the real size and not an approximation of it. */
const TOKEN = 24
const GLYPH = TOKEN * 0.66

type Variant = { id: string; label: string; Glyph: (p: { size?: number }) => React.ReactElement }

/** The rail token, markup for markup — including the nested-span order the real one documents. */
function Token({ Glyph, moving }: { Glyph: Variant['Glyph']; moving: boolean }) {
  return (
    <span
      className="flex items-center justify-center rounded-full bg-accent"
      style={{ width: TOKEN, height: TOKEN }}
    >
      <span className={moving ? 'bus-bob flex' : 'flex'}>
        <span className={moving ? 'bus-rock flex' : 'flex'}>
          <span className={`${moving ? 'bus-squash ' : ''}flex text-accent-contrast`}>
            <Glyph size={GLYPH} />
          </span>
        </span>
      </span>
    </span>
  )
}

function Cell({
  variant,
  moving,
  size,
  showLabel = true,
}: {
  variant: Variant
  moving: boolean
  size?: number
  showLabel?: boolean
}) {
  const { label, Glyph } = variant
  return (
    <div className="flex w-32 shrink-0 flex-col items-center gap-2">
      {size === undefined ? (
        <Token Glyph={Glyph} moving={moving} />
      ) : (
        <span className="flex text-text">
          <Glyph size={size} />
        </span>
      )}
      {showLabel ? (
        <span className="text-center text-caption text-muted leading-tight">{label}</span>
      ) : null}
    </div>
  )
}

function Row({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-border border-b py-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-h2 text-text">{title}</h2>
        {note ? <p className="max-w-2xl text-caption text-muted">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </section>
  )
}

const SHIPPING: Variant = { id: 'ship', label: 'shipping BusGlyph', Glyph: BusGlyph }
const ALL: readonly Variant[] = [SHIPPING, ...DECKERS, ...MINIBUSES]

export function GlyphLab() {
  const [moving, setMoving] = useState(true)
  const [onSurface, setOnSurface] = useState(false)

  return (
    <div className={`min-h-dvh ${onSurface ? 'bg-surface' : 'bg-bg'} px-6 pb-24`}>
      <header className="flex flex-col gap-3 py-6">
        <h1 className="font-bold text-h1 text-text">Bus glyphs</h1>
        <p className="max-w-2xl text-body text-muted">
          Round five. The minibus window is <strong>4.4</strong>, the decker is <strong>D1c</strong>
          , and both radii are Lucide's (body <code>rx=2</code>, windows <code>rx=1</code>). The
          open question is
          <strong>headlights</strong>, drawn Lucide's own way — a zero-length path (
          <code>M8 16.6h.01</code>) that a round linecap paints as a dot exactly one stroke wide.
          They <strong>fit the minibus</strong> (3.20 of clear lower face against the 2.00 a dot
          needs) and <strong>do not fit D1c</strong> (1.27) — <code>D1c!</code> shows the collision.
          <code>D1s</code> shifts both bands up (gaps 2.6/2.6/4.6) to make room, giving up the even
          rhythm to get it.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setMoving((m) => !m)}
            className="rounded-full bg-surface-2 px-4 py-2 text-caption text-text"
          >
            {moving ? 'Pause the bounce' : 'Run the bounce'}
          </button>
          <button
            type="button"
            onClick={() => setOnSurface((v) => !v)}
            className="rounded-full bg-surface-2 px-4 py-2 text-caption text-text"
          >
            {onSurface ? 'On --bg' : 'On --surface'}
          </button>
        </div>
      </header>

      <Row
        title="At token size, in the circle, moving"
        note="24 px token, 16 px glyph — the real thing. The bounce is the real .bus-bob / .bus-rock / .bus-squash, so the 6 % squash at the wheels is the one that decides whether the decker needs to be taller."
      >
        {ALL.map((v) => (
          <Cell key={v.id} variant={v} moving={moving} />
        ))}
      </Row>

      <Row
        title="Decker against minibus, side by side"
        note="The family question: if headlights land on the minibus only, they become a distinguishing mark rather than a shared detail. This is the pairing that has to work: if the two are not instantly different at 16 px the drawing has failed however it reads alone. They share a ground line, so height is what the eye catches — and as the minibus glass grows it gains a second difference, one big pane against the decker's two slots."
      >
        {/* Every decker against the leading minibus, and every minibus against the leading decker. The
            full cross-product was 20 cells and unreadable; what is being judged is one variant at a time
            against a fixed partner, which is what these two runs give. */}
        {[
          ...DECKERS.map((d) => [d, MINIBUSES.find((m) => m.primary)] as const),
          ...MINIBUSES.filter((m) => !m.primary).map(
            (m) => [DECKERS.find((d) => d.primary), m] as const,
          ),
        ].map(([d, m]) =>
          d && m ? (
            <div
              key={`${d.id}-${m.id}`}
              className="flex flex-col items-center gap-2 rounded-lg bg-surface-2 p-3"
            >
              <div className="flex items-end gap-2">
                <Token Glyph={d.Glyph} moving={moving} />
                <Token Glyph={m.Glyph} moving={moving} />
              </div>
              <span className="text-caption text-muted">
                {d.id} · {m.id}
              </span>
            </div>
          ) : null,
        )}
      </Row>

      <Row
        title="Bare, at 16 / 18 / 24 px"
        note="No circle, no motion, on the text colour — where the outline either survives the stroke weight or does not. The 2 px stroke is a fixed cost, so a 2 px-high detail has no interior left at 16 px; that is why some sign boxes are filled rather than outlined."
      >
        {ALL.map((v) => (
          <div key={v.id} className="flex w-32 shrink-0 flex-col items-center gap-2">
            <div className="flex items-end gap-3 text-text">
              <v.Glyph size={16} />
              <v.Glyph size={18} />
              <v.Glyph size={24} />
            </div>
            <span className="text-center text-caption text-muted leading-tight">{v.label}</span>
          </div>
        ))}
      </Row>

      <Row
        title="Enlarged — for diagnosing, not deciding"
        note="96 px. Use this to work out why something failed above, never to pick a winner: a silhouette that only reads here is an illustration, not a glyph."
      >
        {ALL.map((v) => (
          <Cell key={v.id} variant={v} moving={false} size={96} />
        ))}
      </Row>
    </div>
  )
}
