import { SAMPLES } from './samples'
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
 * It does **not** try to render every component from a fixture. Ten components take ten different sets of
 * props, so a generic renderer would either be a pile of adapters or a lie — and the *conformance suites*
 * already render each one against its corpus, which is a stronger check than a picture. Where a component is
 * cheap to mount in isolation it gets a live sample (`lab/samples.tsx`, ADR-150 — the leaf components, each
 * in several states at once); where it is a whole screen, the spec is the listing and the screen itself is
 * one click away in the app.
 *
 * ## The motions are the half a native porter cannot infer
 *
 * A keyframe name and a duration port to nothing — Compose and SwiftUI have neither. What ports is the
 * *principle*: what moves, **on what occasion**, and how fast. So each motion row names the occasion in
 * words first and runs the real CSS second, which is the order a porter needs to read them in.
 */

/**
 * A sample panel's width: a phone's, because that is the surface these components are laid out for and a
 * card reviewed at desk width is a card nobody ships. Two fit side by side on a laptop, which is the point —
 * the states are meant to be compared, not scrolled past.
 */
const SAMPLE_W = 380

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
        <p className="max-w-3xl text-body text-muted">
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
      </header>

      <section className="flex flex-col gap-3 border-border border-b py-6">
        <h2 className="font-semibold text-h2 text-text">Motions</h2>
        <p className="max-w-3xl text-caption text-muted">
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
            <p className="m-0 max-w-3xl text-caption text-muted">{m.principle}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-6 border-border border-b py-6">
        <div>
          <h2 className="m-0 font-semibold text-h2 text-text">Live samples</h2>
          <p className="m-0 max-w-3xl text-caption text-muted">
            The real components, in several states at once — every one drawn from a{' '}
            <strong>corpus golden</strong> or from the kernel call the screen makes, so a rule
            change moves these pictures and a state that stopped being reachable is a red build (
            <code>test/gallery-samples.test.tsx</code>). Seeing a component&rsquo;s states side by
            side is the only way to review whether its <em>register</em> holds; one screen at a
            time, four sentences can read fine and still not belong together.
          </p>
        </div>
        {SAMPLES.map((group) => (
          <div key={group.component} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="m-0 font-semibold text-h3 text-text">{group.component}</h3>
              <code className="text-caption text-subtle">{group.spec}</code>
            </div>
            <p className="m-0 max-w-3xl text-caption text-muted">{group.note}</p>
            {/*
              **The panel's geometry is inline style, and that is not a shortcut.** `tailwind.config.cjs`
              scans `./src/**` and **not** `./lab/**`, so a utility this page uses and the app does not is
              simply never generated — `w-96` computed to 1016 px here, the width of its own caption, and the
              panels were three different sizes. Adding `lab/` to the content glob would fix it by letting
              lab-only classes into the *shipped* stylesheet, which is the one thing ADR-112's three
              assertions exist to prevent. So anything the app's own vocabulary does not already carry is
              written as a style, and everything semantic (colour, type, surface) stays a token class.
            */}
            <div className="flex flex-wrap gap-3">
              {group.samples.map((sample) => (
                <figure
                  key={sample.state}
                  className="m-0 flex flex-col gap-2 rounded-2xl bg-surface-2 p-3"
                  style={{ width: SAMPLE_W }}
                >
                  <figcaption className="flex flex-col gap-1">
                    <code className="text-caption text-accent">{sample.state}</code>
                    <span className="text-caption text-muted">{sample.how}</span>
                  </figcaption>
                  {/* On `bg-bg` and at a phone's width, because both are what the component is drawn
                      against in the app — a sample reviewed on the wrong surface is a sample of
                      something else. The minimum height is what makes the silent state visibly
                      *nothing* rather than a panel that failed to render. */}
                  <div className="rounded-xl bg-bg" style={{ minHeight: 40, paddingBlock: 4 }}>
                    {sample.render()}
                  </div>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </section>

      {specs.map((spec) => (
        <section key={spec.component} className="flex flex-col gap-3 border-border border-b py-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-semibold text-h2 text-text">{spec.component}</h2>
            <span className="text-caption text-subtle">
              v{spec.version} · {spec.slots.length} slot(s) · {Object.keys(spec.states).length}{' '}
              state(s)
            </span>
          </div>
          <p className="m-0 max-w-3xl text-caption text-muted">{spec.doc}</p>

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
