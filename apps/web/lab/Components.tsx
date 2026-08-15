import { themes } from '@nextbus/ui'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { NAV_H } from './chrome'
import type { Sample, SampleGroup } from './samples'
import { SAMPLES } from './samples'

/**
 * **The component browser** — every component this renderer has, one tap away, in its states.
 *
 * It was one flat scroll for a day and the owner's verdict on that is the reason this file exists:
 * *"This is helpful, but now it's very cluttered."* Ninety-four panels down a single page is a listing you
 * can prove things about and cannot actually use — the coverage was the point and the *reading* of it was
 * an afterthought. So the sample data is unchanged (`lab/samples.tsx` is still the one declaration) and
 * everything here is about getting to one component quickly and comparing it against itself.
 *
 * ## Four levers, each answering a different kind of clutter
 *
 *  · **A sidebar that selects rather than only scrolls.** Clicking a component shows *that component*, which
 *    is the Storybook affordance and the biggest single declutter: one component's states, at a phone's
 *    width, with nothing else on screen. **All components** is still there for the sweep, and it is not the
 *    default — the sweep is the rarer job.
 *  · **A filter over names *and state names*.** Typing `stale` finds `RouteStopRow` and `ArrivalSlot`,
 *    because the thing you remember about a component is usually the state you saw it in.
 *  · **Notes off.** Each group carries a paragraph and each panel a sentence; they are why the panels are
 *    trustworthy and they are also most of the ink. Off by one tap, so the page becomes pictures.
 *  · **Compare light + dark**, which is not a convenience — it earned its keep on the first run. Seeing one
 *    component's states side by side had already shown that `StopName`'s `emphasis` barely registers in
 *    dark; seeing one *state's* two appearances side by side showed the worse half, which is that in light
 *    `--accent` and `--text` are **the same value** and the prop does nothing at all. Same move, one axis
 *    over, and the axis a single-appearance page cannot have.
 *
 * ## Compare is `themes[mode]` inline, and that is deliberately the RN mechanism
 *
 * `tokens.css` puts the light values on `:root` and the dark ones under `.dark`, so a light subtree inside a
 * dark document has nothing to inherit — there is no `.light` class, and writing one here would be a second
 * copy of thirteen colour values in a file no gate reads. So each pane sets the token vars **inline from
 * `@nextbus/ui`'s `themes`**, which is byte-for-byte what `apps/mobile` does with NativeWind's
 * `vars(themes[mode])`. One declaration, two platforms, and now a third caller.
 *
 * The `.dark` class still goes on the dark pane, because a handful of rules in `index.css` are keyed to it
 * rather than to a token (the basemap inversion is the only one that reaches a component here). The light
 * pane cancels that with `lab-pane-light`, declared in `lab/index.html` — lab-only by construction, so
 * [ADR-112](../../docs/08-decision-log.md)'s rule that nothing lab-shaped enters the shipped stylesheet
 * holds.
 *
 * ## Selection lives in the hash, so a panel is a link
 *
 * `#components/EtaBadge`. `main.tsx` reads the first segment to pick the lab and this reads the second, so
 * a review comment can point at a component rather than at a page and a scroll position. The slug is the
 * group's first name — `BottomSheet · SheetAction` is `BottomSheet` — which is the same split
 * `test/gallery-covers-components.test.ts` makes when it checks the group covers both.
 */

/**
 * The three tiers the sample groups are read in, and what distinguishes them for a *reviewer*.
 *
 * Not a taxonomy for its own sake: each tier is a different question. A leaf is judged as a scale (are the
 * three urgency tones one family?), a composed component as a projection (does every arm of the view get
 * drawn?), and an overlay as an interruption (does it take the screen without taking the focus?). The
 * `tier` field lives on the group in `lab/samples.tsx`, so a new component picks its own and this table
 * only names them.
 */
export const TIERS = [
  {
    key: 'leaf' as const,
    title: 'Primitives',
    blurb:
      'A glyph, a chip, a figure — a handful of props, no state of its own, and the level a native porter re-draws first. Every state fits in one panel, which is what makes a scale reviewable: three tones of urgency can only be judged against each other.',
  },
  {
    key: 'composed' as const,
    title: 'Composed',
    blurb:
      'A card, a row, a keypad, a map. Each is a pure projection of a view the kernel derived, so its states are the arms of that view and the corpus enumerates them — a panel here with no corpus case behind it would be a state the app cannot actually reach.',
  },
  {
    key: 'overlay' as const,
    title: 'Overlays',
    blurb:
      'Sheets. They take over the screen, so they sit behind a trigger and mount for real when you tap — `showModal()`, focus trap, drag-to-dismiss and all. Open two in a row to check they feel like one component rather than two.',
  },
]

/**
 * A sample panel's width: a phone's, because that is the surface these components are laid out for and a
 * card reviewed at desk width is a card nobody ships.
 */
const SAMPLE_W = 380
const SIDEBAR_W = 236

/** The group's address — its first name, so `BottomSheet · SheetAction` is reachable as `BottomSheet`. */
export function slugOf(group: SampleGroup): string {
  return group.component.split('·')[0]?.trim() ?? group.component
}

/** The component named by the hash's second segment, or `''` for the sweep. */
function useSelection(): string {
  const [selection, setSelection] = useState(() => readSelection())
  useEffect(() => {
    const onHash = () => setSelection(readSelection())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return selection
}

function readSelection(): string {
  return decodeURIComponent(window.location.hash.split('/')[1] ?? '')
}

export function Components() {
  const selection = useSelection()
  const [filter, setFilter] = useState('')
  const [notes, setNotes] = useState(true)
  const [compare, setCompare] = useState(false)
  const content = useRef<HTMLDivElement>(null)

  /**
   * The filter matches a component's name **or any of its state names**, because what a reviewer
   * remembers about a component is usually the state they saw it in — `stale` should find `RouteStopRow`
   * and `ArrivalSlot`, neither of which has the word in its name.
   */
  const matching = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (needle === '') return SAMPLES
    return SAMPLES.filter(
      (group) =>
        group.component.toLowerCase().includes(needle) ||
        group.samples.some((sample) => sample.state.toLowerCase().includes(needle)),
    )
  }, [filter])

  const chosen = matching.find((group) => slugOf(group) === selection)
  const shown = chosen ? [chosen] : matching

  // Selecting a component from halfway down the sweep would otherwise leave the reader at that scroll
  // offset in a page one component long — i.e. below its end, looking at nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scroll is *because* the selection moved
  useEffect(() => {
    content.current?.scrollTo?.(0, 0)
    window.scrollTo(0, 0)
  }, [selection])

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }} className="min-h-dvh bg-bg">
      <Sidebar
        groups={matching}
        selection={selection}
        filter={filter}
        onFilter={setFilter}
        total={SAMPLES.length}
      />
      <div ref={content} style={{ flex: 1, minWidth: 0, padding: '16px 24px 96px' }}>
        <Toolbar
          notes={notes}
          onNotes={setNotes}
          compare={compare}
          onCompare={setCompare}
          shown={shown}
          chosen={chosen}
          filter={filter}
        />
        {shown.length === 0 ? (
          <p className="lab-prose text-body text-muted">
            Nothing matches <code className="text-text">{filter}</code>.
          </p>
        ) : null}
        {chosen ? (
          <Group group={chosen} notes={notes} compare={compare} heading={false} />
        ) : (
          TIERS.map((tier) => {
            const groups = shown.filter((g) => g.tier === tier.key)
            if (groups.length === 0) return null
            return (
              <section key={tier.key} style={{ marginTop: 28 }}>
                <div
                  className="border-border border-t"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    gap: 12,
                    paddingTop: 14,
                  }}
                >
                  <h2 className="m-0 font-semibold text-h2 text-text">{tier.title}</h2>
                  <span className="text-caption text-subtle">
                    {groups.length} component(s) ·{' '}
                    {groups.reduce((n, g) => n + g.samples.length, 0)} state(s)
                  </span>
                </div>
                {notes ? (
                  <p className="lab-prose m-0 text-caption text-muted" style={{ marginTop: 6 }}>
                    {tier.blurb}
                  </p>
                ) : null}
                {groups.map((group) => (
                  <Group key={group.component} group={group} notes={notes} compare={compare} />
                ))}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── the sidebar ────────────────────────────────────────────────────────────────────────────────

function Sidebar({
  groups,
  selection,
  filter,
  onFilter,
  total,
}: {
  groups: readonly SampleGroup[]
  selection: string
  filter: string
  onFilter: (value: string) => void
  total: number
}) {
  return (
    <nav
      className="lab-sidebar bg-surface"
      style={{
        // Under the tab bar, not behind it — `NAV_H` is `lab/chrome.ts`'s one declaration rather than a
        // guess at the same number.
        position: 'sticky',
        top: NAV_H,
        width: SIDEBAR_W,
        flex: `0 0 ${SIDEBAR_W}px`,
        height: `calc(100dvh - ${NAV_H}px)`,
        overflowY: 'auto',
        padding: '12px 10px 24px',
      }}
    >
      {/* A plain input rather than one of the app's controls: the lab's own chrome must never be mistaken
          for a component under review, which is the same reason `LabButton` in `samples.tsx` is not a
          shipping button.

          **A real `<label>` rather than a hint inside the box**, and the gate is what asked for it:
          `layers.json` bans a literal `placeholder` attribute anywhere under `apps/web`, because React
          Native types that prop `string` — so a literal there is legal TypeScript that ships English to a
          Chinese UI. The rule is aimed at the app and it is right about this file too: a hint that vanishes
          the moment you type is a label you cannot re-read, which is an accessibility anti-pattern before
          it is a translation one. (The rule scans *source text*, so quoting it here would trip it — which
          is itself worth knowing before writing a comment about any banned pattern.) */}
      <label
        className="text-caption text-subtle"
        style={{ display: 'block', padding: '0 2px 4px' }}
      >
        Filter — name or state
        <input
          type="search"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          className="rounded-lg border border-border bg-bg text-caption text-text"
          style={{ width: '100%', padding: '7px 9px', boxSizing: 'border-box', marginTop: 3 }}
        />
      </label>
      <Entry href="#components" active={selection === ''} label="All components" count={total} />
      {TIERS.map((tier) => {
        const inTier = groups.filter((g) => g.tier === tier.key)
        if (inTier.length === 0) return null
        return (
          <div key={tier.key} style={{ marginTop: 14 }}>
            <div
              className="text-caption text-subtle"
              style={{ textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 8px 4px' }}
            >
              {tier.title}
            </div>
            {inTier.map((group) => (
              <Entry
                key={group.component}
                href={`#components/${encodeURIComponent(slugOf(group))}`}
                active={selection === slugOf(group)}
                label={group.component}
                count={group.samples.length}
              />
            ))}
          </div>
        )
      })}
    </nav>
  )
}

function Entry({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number
}) {
  return (
    <a
      href={href}
      className={`text-caption ${active ? 'bg-accent text-accent-contrast' : 'text-text'}`}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        alignItems: 'center',
        padding: '5px 8px',
        borderRadius: 7,
        marginTop: 2,
        textDecoration: 'none',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span className={active ? '' : 'text-subtle'} style={{ flex: '0 0 auto' }}>
        {count}
      </span>
    </a>
  )
}

// ── the toolbar ────────────────────────────────────────────────────────────────────────────────

function Toolbar({
  notes,
  onNotes,
  compare,
  onCompare,
  shown,
  chosen,
  filter,
}: {
  notes: boolean
  onNotes: (value: boolean) => void
  compare: boolean
  onCompare: (value: boolean) => void
  shown: readonly SampleGroup[]
  chosen: SampleGroup | undefined
  filter: string
}) {
  const panels = shown.reduce((n, g) => n + g.samples.length, 0)
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 4,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 className="m-0 font-bold text-h1 text-text">{chosen?.component ?? 'Components'}</h1>
        <p className="m-0 text-caption text-subtle">
          {chosen ? (
            <>
              {panels} state(s) · <code>{chosen.spec}</code>
            </>
          ) : (
            <>
              {shown.length} component(s) · {panels} panel(s)
              {filter ? ` matching “${filter}”` : ''} · every one a corpus golden or the kernel call
              the screen makes
            </>
          )}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Toggle on={notes} onClick={() => onNotes(!notes)}>
          Notes
        </Toggle>
        <Toggle on={compare} onClick={() => onCompare(!compare)}>
          Light + dark
        </Toggle>
      </div>
    </div>
  )
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-pill border text-caption ${
        on
          ? 'border-transparent bg-accent text-accent-contrast'
          : 'border-border bg-surface text-text'
      }`}
      style={{ padding: '4px 12px' }}
    >
      {children}
    </button>
  )
}

// ── one component ──────────────────────────────────────────────────────────────────────────────

function Group({
  group,
  notes,
  compare,
  heading = true,
}: {
  group: SampleGroup
  notes: boolean
  compare: boolean
  /**
   * Off when this group *is* the page: the toolbar already carries the name and the spec, and printing
   * both put the component's name on screen twice, eight pixels apart.
   */
  heading?: boolean
}) {
  return (
    <div style={{ marginTop: heading ? 20 : 8 }}>
      {heading ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
          <h3 className="m-0 font-semibold text-h3 text-text">
            <a
              href={`#components/${encodeURIComponent(slugOf(group))}`}
              className="text-text"
              style={{ textDecoration: 'none' }}
            >
              {group.component}
            </a>
          </h3>
          <code className="text-caption text-subtle">{group.spec}</code>
        </div>
      ) : null}
      {notes ? (
        <p className="lab-prose m-0 text-caption text-muted" style={{ marginTop: 4 }}>
          {group.note}
        </p>
      ) : null}
      {/*
        **The panel's geometry is inline style, and that is not a shortcut.** `tailwind.config.cjs`
        scans `./src/**` and **not** `./lab/**`, so a utility this page uses and the app does not is
        simply never generated — `w-96` computed to 1016 px here, the width of its own caption, and the
        panels were three different sizes. Adding `lab/` to the content glob would fix it by letting
        lab-only classes into the *shipped* stylesheet, which is the one thing ADR-112's three
        assertions exist to prevent. So anything the app's own vocabulary does not already carry is
        written as a style, and everything semantic (colour, type, surface) stays a token class.
      */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
        {group.samples.map((sample) => (
          <figure
            key={sample.state}
            className="m-0 rounded-2xl bg-surface-2"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              width: compare ? SAMPLE_W * 2 + 12 : SAMPLE_W,
            }}
          >
            <figcaption style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <code className="text-caption text-accent">{sample.state}</code>
              {notes ? <span className="text-caption text-muted">{sample.how}</span> : null}
            </figcaption>
            <Stage sample={sample} compare={compare} />
          </figure>
        ))}
      </div>
    </div>
  )
}

/**
 * Where the component is actually drawn — on `bg-bg`, because that is what it is drawn against in the
 * app, and a sample reviewed on the wrong surface is a sample of something else.
 */
function Stage({ sample, compare }: { sample: Sample; compare: boolean }) {
  if (!compare)
    return (
      <div className="rounded-xl bg-bg" style={{ minHeight: 40, paddingBlock: 4 }}>
        {sample.render()}
      </div>
    )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Pane mode="light" sample={sample} />
      <Pane mode="dark" sample={sample} />
    </div>
  )
}

function Pane({ mode, sample }: { mode: 'light' | 'dark'; sample: Sample }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        // The token values, inline, from the ONE declaration — the same `themes[mode]` object
        // `apps/mobile` hands to NativeWind's `vars()`. The `.dark` class rides along because a few
        // rules in `index.css` key off it rather than off a token; `lab-pane-light` (declared in
        // `lab/index.html`, never in the shipped stylesheet) cancels those for the light pane.
        className={`rounded-xl bg-bg ${mode === 'dark' ? 'dark' : 'lab-pane-light'}`}
        style={{
          ...(themes[mode] as CSSProperties),
          minHeight: 40,
          paddingBlock: 4,
        }}
      >
        {sample.render()}
      </div>
      <div
        className={mode === 'dark' ? 'dark' : 'lab-pane-light'}
        style={{ ...(themes[mode] as CSSProperties) }}
      >
        <span className="text-caption text-subtle">{mode}</span>
      </div>
    </div>
  )
}
