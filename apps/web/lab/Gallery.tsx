import specs from './specIndex'

/**
 * The design-system gallery — **enumerated from the published component specs, not hand-listed** (ADR-134).
 *
 * Asked for by the owner: a listing of the design-system components *"as that will make it easier to build a
 * corresponding page for our eventual native apps"*, extended to cover *"some of the motions to help
 * understand the underlying principles about how it's designed and translate that to the appropriate styles
 * for the operating system it's on."*
 *
 * ## Why it reads the specs rather than a list
 *
 * A hand-maintained gallery drifts, and a drifted gallery is worse than none: a native porter checking their
 * own screen against it would be checking against something stale. So the page is built from
 * `packages/contract/ui/*.spec.json` — the same ten files a Swift or Kotlin repo vendors — and
 * `apps/web/test/gallery-covers-specs.test.ts` fails the build if a spec has no entry here. **A component
 * with a published spec and no gallery row is a red build.**
 *
 * ## What it shows, and what it deliberately does not
 *
 * Each spec's **slots** (what must appear) and **states** (what each one must and must not show, and what
 * enforces it) are printed from the spec itself. That is the part a porter needs and the part that cannot go
 * stale.
 *
 * It draws **no components at all**, and that is the split this page was reorganised around. It listed the
 * specs *and* mounted every component for one day, and the owner's verdict was *"very cluttered"* — two
 * different jobs sharing one scroll. `lab/Components.tsx` (the **Components** tab, and the lab's default
 * now) is the place a component is looked at; this is the place its *contract* is read. So a reader here is
 * asking "what does the published spec require, and what holds it?", and one tab over is the picture.
 *
 * Where a component is a whole *screen*, this listing is still all there is: a screen takes a router, a
 * query client and a location fix, and the screen itself is one click away in the app.
 *
 * ## The motions are the half a native porter cannot infer
 *
 * A keyframe name and a duration port to nothing — Compose and SwiftUI have neither. What ports is the
 * *principle*: what moves, **on what occasion**, and how fast. So each motion row names the occasion in
 * words first and runs the real CSS second, which is the order a porter needs to read them in.
 */

/** The app's named animations, with the one thing a port actually needs: the occasion. */
const MOTIONS = [
  {
    name: 'bus-bob / bus-rock / bus-squash',
    occasion: 'A bus token exists on the rail. Idle, continuous, never triggered.',
    principle:
      'Three clocks on one glyph: a ±0.5 px bob at 550 ms, a ±6° lean at 2200 ms (≈4× slower, so they never sync), and a 6 % squash anchored at the wheels sharing the bob’s clock. Phase is read off the document timeline, not the element’s age, so a token that moves between rows does not restart mid-bounce.',
    demo: 'bus',
  },
  {
    name: 'row-rise',
    occasion: 'A direction flip re-mounts the schematic’s rows. Never on first load.',
    principle:
      'A 26 ms per-row cascade capped at ten rows, so a 60-stop route does not drag for two seconds. Read once at mount: adding the class to a mounted element would start it mid-list.',
    demo: 'row',
  },
  {
    name: 'odo-in / odo-out',
    occasion: 'An arrival figure changes value. Never on mount.',
    principle:
      'Only the characters that changed slide — "52 min" → "51 min" moves the 2 and leaves the 5 and the unit still. 260 ms, ease-in-out quad, rise of 0.85em so one rule serves a 22 px figure and a 12 px one. At rest it must be a single text node.',
    demo: 'odo',
  },
  {
    name: 'jl-origin-out / jl-rise / jl-glyph-out / jl-dest-in',
    occasion: 'The rider swaps direction. The screen stays mounted across the URL change.',
    principle:
      'The old destination rises into the origin slot and shrinks, the old origin slides out, the new destination rises in — 380 ms, with the glyph’s 460 ms half-turn behind it. A URL change is not a reason for no motion.',
    demo: null,
  },
  {
    name: 'sheet-in / scrim-in',
    occasion: 'A bottom sheet opens.',
    principle:
      'The panel drops from the bottom edge with the scrim fading under it. `animation-fill-mode: both` is the trap: a finished animation keeps applying its transform and outranks inline style, so the exit has to drop the entrance class rather than set a transform.',
    demo: null,
  },
]

function Slots({ slots, depth = 0 }: { slots: readonly SpecSlot[]; depth?: number }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {slots.map((slot) => (
        <li key={slot.name} style={{ paddingLeft: depth * 16 }}>
          <code className="text-caption text-text">{slot.name}</code>
          {slot.when ? <span className="text-caption text-subtle"> when {slot.when}</span> : null}
          {slot.each ? <span className="text-caption text-subtle"> each {slot.each}</span> : null}
          {slot.oneOf ? (
            <span className="text-caption text-subtle"> oneOf {slot.oneOf}</span>
          ) : null}
          {slot.of ? <Slots slots={slot.of} depth={depth + 1} /> : null}
          {slot.cases
            ? Object.entries(slot.cases).map(([k, v]) => (
                <div key={k} style={{ paddingLeft: (depth + 1) * 16 }}>
                  <span className="text-caption text-subtle">{k}:</span>
                  <Slots slots={v} depth={depth + 2} />
                </div>
              ))
            : null}
        </li>
      ))}
    </ul>
  )
}

interface SpecSlot {
  name: string
  when?: string
  each?: string
  oneOf?: string
  of?: readonly SpecSlot[]
  cases?: Record<string, readonly SpecSlot[]>
}

/** How a state is held — the field a porter must read before copying anything. */
function enforcement(state: Record<string, unknown>): { label: string; tone: string } {
  const e = (state.enforcement ?? {}) as Record<string, unknown>
  if ('knownDefect' in e) return { label: 'knownDefect', tone: 'text-danger' }
  if ('unenforced' in e) return { label: 'unenforced', tone: 'text-warning' }
  if ('by' in e) return { label: `by ${String(e.by)}`, tone: 'text-muted' }
  if ('shows' in e) return { label: 'projected', tone: 'text-positive' }
  return { label: 'projected', tone: 'text-positive' }
}

export function Gallery() {
  return (
    <div className="min-h-dvh bg-bg px-6 pb-24">
      <header className="flex flex-col gap-3 py-6">
        <h1 className="font-bold text-h1 text-text">Design system</h1>
        <p className="lab-prose text-body text-muted">
          Enumerated from <code>packages/contract/ui/*.spec.json</code> — the same ten files a
          native repo vendors — so this page cannot drift from what is published. A component with a
          spec and no row here is a <strong>red build</strong> (
          <code>test/gallery-covers-specs.test.ts</code>). Each state shows <em>what holds it</em>,
          which is the field to read before copying anything:{' '}
          <span className="text-positive">projected</span> is checked by the walker,{' '}
          <span className="text-warning">unenforced</span> is honest prose, and{' '}
          <span className="text-danger">knownDefect</span> is a target no renderer meets yet — never
          behaviour to copy.
        </p>
        <p className="lab-prose m-0 text-caption text-subtle">
          The <strong>pictures</strong> are on the Components tab — this page is the contract, and
          the two shared one scroll until they were split. Most of what <code>src/components/</code>{' '}
          holds has no spec at all, so this listing is the smaller half.
        </p>
        {/* A jump list rather than a sidebar: ten sections is a page you skim, where ninety-four
            panels is a page you navigate. Anchors are the spec's own `component`, so a link into
            this page survives a reorder of `specIndex.ts`. */}
        <div className="flex flex-wrap gap-2">
          <a
            href="#components"
            className="rounded-pill border border-border bg-surface-2 px-3 py-1 text-caption text-text"
          >
            ← Components
          </a>
          {specs.map((spec) => (
            <a
              key={spec.component}
              href={`#gallery/${spec.component}`}
              onClick={(event) => {
                // The hash is the *lab router's*, so letting the browser navigate would swap the page
                // out from under the anchor. Scroll by hand and leave the address bar alone.
                event.preventDefault()
                document
                  .getElementById(`spec-${spec.component}`)
                  ?.scrollIntoView({ block: 'start' })
              }}
              className="rounded-pill border border-border bg-surface px-3 py-1 text-caption text-text"
            >
              {spec.component}
            </a>
          ))}
        </div>
      </header>

      <section className="flex flex-col gap-3 border-border border-b py-6">
        <h2 className="font-semibold text-h2 text-text">Motions</h2>
        <p className="lab-prose text-caption text-muted">
          A keyframe name and a duration port to nothing — Compose and SwiftUI have neither. What
          ports is the <strong>occasion</strong> and the principle, so those come first and the CSS
          runs second.
        </p>
        {MOTIONS.map((m) => (
          <div key={m.name} className="flex flex-col gap-1 rounded-lg bg-surface-2 p-3">
            <code className="text-caption text-accent">{m.name}</code>
            <p className="m-0 text-caption text-text">
              <strong>On:</strong> {m.occasion}
            </p>
            <p className="lab-prose m-0 text-caption text-muted">{m.principle}</p>
          </div>
        ))}
      </section>

      {specs.map((spec) => (
        <section
          key={spec.component}
          id={`spec-${spec.component}`}
          className="flex flex-col gap-3 border-border border-b py-6"
        >
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-semibold text-h2 text-text">{spec.component}</h2>
            <span className="text-caption text-subtle">
              v{spec.version} · {spec.slots.length} slot(s) · {Object.keys(spec.states).length}{' '}
              state(s)
            </span>
          </div>
          <p className="lab-prose m-0 text-caption text-muted">{spec.doc}</p>

          <div className="flex flex-wrap gap-8">
            <div className="min-w-64">
              <h3 className="m-0 font-semibold text-label text-text">Slots</h3>
              <Slots slots={spec.slots as readonly SpecSlot[]} />
            </div>
            <div className="min-w-96 flex-1">
              <h3 className="m-0 font-semibold text-label text-text">States</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {Object.entries(spec.states).map(([name, state]) => {
                  const e = enforcement(state as Record<string, unknown>)
                  return (
                    <li key={name} className="flex flex-col">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <code className="text-caption text-text">{name}</code>
                        <span className={`text-caption ${e.tone}`}>{e.label}</span>
                      </span>
                      <span className="text-caption text-muted">
                        must: {(state as { must?: string }).must ?? '—'}
                      </span>
                      {(state as { mustNot?: string }).mustNot ? (
                        <span className="text-caption text-subtle">
                          must not: {(state as { mustNot?: string }).mustNot}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
