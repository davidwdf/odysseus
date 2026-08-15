import type { FeedNotice as FeedNoticeView, Locale, OperatorId } from '@nextbus/core'
import { CLIENT_POLICY_DEFAULTS, feedNotice } from '@nextbus/core'
import { OPERATOR_ACCENT } from '@nextbus/ui'
import { MapPin as MapPinIcon, Star } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { BearingArrow } from '../src/components/BearingArrow'
import { BottomSheet, SheetAction } from '../src/components/BottomSheet'
import { BusGlyph } from '../src/components/BusGlyph'
import { DirectionSwapIcon } from '../src/components/DirectionSwapIcon'
import { EtaBadge } from '../src/components/EtaBadge'
import { FeedNotice } from '../src/components/FeedNotice'
import { FilterChips } from '../src/components/FilterChips'
import { JourneyLines } from '../src/components/JourneyLines'
import { MapAttribution, MiniMap } from '../src/components/MiniMap'
import { PlaceRow } from '../src/components/PlaceRow'
import { RAIL_WIDTH, RailBusToken } from '../src/components/RailBusToken'
import { RemarkTag } from '../src/components/RemarkTag'
import { RouteChip } from '../src/components/RouteChip'
import { RouteFactSheet } from '../src/components/RouteFactSheet'
import { RouteKeypad } from '../src/components/RouteKeypad'
import { ArrivalSlot, RouteStopRow } from '../src/components/RouteStopRow'
import { RouteStopSheet } from '../src/components/RouteStopSheet'
import { SaveStar } from '../src/components/SaveStar'
import { SlideNumber } from '../src/components/SlideNumber'
import { StopCard } from '../src/components/StopCard'
import { StopName } from '../src/components/StopName'
import {
  buses,
  card,
  cardRow,
  cardRowWhere,
  chips,
  factSheet,
  favouriteCard,
  keypad,
  labelParts,
  mergedPins,
  place,
  placePins,
  placeRow,
  query,
  readout,
  remark,
  routeHeader,
  stopBoard,
  stopName,
  stopRow,
  stopRowWhere,
  stopRowWithArrivals,
  vehicle,
} from './goldens'

/**
 * **The gallery's live samples: every component this renderer has, each in its states, side by side**
 * (ADR-150, extended to the whole set at the owner's request — *"find all the components, both primitive
 * and multi-part … render each one in each state so I can review individual parts and see the complex
 * parts too"*).
 *
 * ## Why the states come from the corpus and the kernel, never from a hand-written object
 *
 * A sample is only worth reviewing if it is the thing the app draws. Every panel below is either a **corpus
 * golden** — the exact `expect` a conformance suite replays — or the output of the **kernel call the screen
 * makes, with the inputs written beside it. So a rule change moves these pictures, and a state that stopped
 * being reachable takes its case name with it: `caseNamed` throws rather than rendering something
 * plausible, and `test/gallery-samples.test.tsx` runs every sample so that throw is a red build rather than
 * a blank panel somebody finds later. `lab/goldens.ts` is where that access lives, and its docblock states
 * the handful of places a sweep (the compass octants, the operator liveries) is read off a token table
 * rather than a corpus, which is the only sanctioned exception.
 *
 * ## What "several states" is for
 *
 * The owner's ask, and it is the review that a page of prose cannot support: *is this set of sentences
 * consistent?* A notice you meet one screen at a time reads fine four different ways. Seen together, the
 * register has to hold — which is exactly the `docs/07` row about reviewing the app's error and placeholder
 * texts **as a set**. The same is true of the leaf components: three tones of urgency are a *scale*, and a
 * scale can only be judged against itself.
 *
 * ## The three tiers, and why the page is grouped by them
 *
 * `tier` splits the listing into what a reviewer actually reviews differently:
 *
 *  · **`leaf`** — a glyph, a chip, a figure. It takes a handful of props, it has no state of its own, and
 *    it is the level a native porter re-draws first. Every one of its states fits in one panel.
 *  · **`composed`** — a card, a row, a keypad. It is a projection of a *view* the kernel derived, so its
 *    states are the arms of that view and the corpus enumerates them.
 *  · **`overlay`** — a sheet. It takes over the screen, so it is behind a trigger rather than open: a page
 *    of eleven modal dialogs is a page you cannot read. Tapping the trigger mounts the real component,
 *    `showModal()` and all.
 *
 * ## What is deliberately not here
 *
 * Whole screens. A screen takes a router, a query client and a location fix; mounting eight of those here
 * would be a second app, and the *screen* specs in the listing below already enumerate their states with
 * the conformance suites measuring both renderers against them. The components are what a porter copies;
 * the screens are one click away in the running app.
 */

/** One reviewable state of one component. */
export interface Sample {
  /** The spec state (or kernel arm) this is — the name to look up in the listing below. */
  state: string
  /** How the app gets here, in one line: the inputs, not the styling. */
  how: string
  /**
   * What this panel is expected to draw, where that is not "some words".
   *
   * Declared rather than inferred, because on the page the failure modes are indistinguishable: a glyph
   * that rendered, a glyph that threw, and a state whose whole correctness is drawing nothing all leave an
   * empty box. Splitting them lets the gate assert the *stronger* thing in each case — `no-text` must draw
   * an element and no words, `nothing` must draw neither — so "drew a picture", "drew nothing on purpose"
   * and "blew up" stop being one observation. See `test/gallery-samples.test.tsx`.
   *
   * It was one boolean for a day, and a boolean could not tell a bare `BusGlyph` from the `SaveStar` whose
   * `hideWhenEmpty` correctly renders `null` — which the gate caught by demanding an element from a panel
   * that must not have one.
   */
  draws?: 'no-text' | 'nothing'
  render: () => ReactNode
}

export interface SampleGroup {
  component: string
  /** Where the declaration lives, so a reviewer can go from a picture to the contract. */
  spec: string
  /** Which review this component belongs to — see the docblock above. */
  tier: 'leaf' | 'composed' | 'overlay'
  note: string
  samples: readonly Sample[]
}

/** The catalogue locale every panel is composed in — the corpus goldens' own. */
const LOCALE: Locale = 'en'

// ── lab-only layout ────────────────────────────────────────────────────────────────────────────
//
// **Inline style, and that is not a shortcut.** `tailwind.config.cjs` scans `./src/**` and NOT `./lab/**`,
// so a utility this page uses and the app does not is simply never generated — the panels were three
// different widths before ADR-150 noticed. Adding `lab/` to the content glob would fix it by letting
// lab-only classes into the *shipped* stylesheet, which is the one thing ADR-112's assertions exist to
// prevent. So anything the app's own vocabulary does not already carry is written as a style, and
// everything semantic (colour, type, surface) stays a token class.

function Row({
  children,
  gap = 12,
  align = 'center',
}: {
  children: ReactNode
  gap?: number
  align?: 'center' | 'baseline' | 'stretch'
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: align, gap, minWidth: 0 }}>
      {children}
    </div>
  )
}

function Stack({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0 }}>{children}</div>
  )
}

/** A lab-only word beside a picture — never part of the component under review. */
function Caption({ children }: { children: ReactNode }) {
  return <span className="text-caption text-subtle">{children}</span>
}

/** One labelled cell in a sweep, so eight arrows are eight comparable things rather than a smear. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        minWidth: 44,
      }}
    >
      {children}
      <Caption>{label}</Caption>
    </span>
  )
}

/**
 * A lab control. Deliberately **not** one of the app's own buttons: a trigger that looked like a shipping
 * control would be the first thing a reviewer mistook for one of the components under review.
 */
function LabButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-pill border border-border bg-surface-2 px-3 py-1 text-caption text-text"
    >
      {children}
    </button>
  )
}

/**
 * Mounts an overlay on demand.
 *
 * Closed by default, and that is the whole point of the `overlay` tier: `BottomSheet` calls `showModal()`
 * in a mount effect, so a page that rendered eleven of them open would be a page with eleven modal dialogs
 * fighting over the focus trap. It also keeps the gate honest — the sample under test is the trigger, and
 * jsdom is never asked to run `showModal`, which it does not implement.
 */
function Overlay({ label, sheet }: { label: string; sheet: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <LabButton onClick={() => setOpen(true)}>{label}</LabButton>
      {open ? sheet(() => setOpen(false)) : null}
    </>
  )
}

/** Steps a value so a change-driven animation can be watched rather than described. */
function Ticker({
  values,
  children,
}: {
  values: readonly string[]
  children: (value: string) => ReactNode
}) {
  const [i, setI] = useState(0)
  const value = values[i % values.length] ?? ''
  return (
    <Row gap={8}>
      {children(value)}
      <LabButton onClick={() => setI((n) => n + 1)}>next value</LabButton>
    </Row>
  )
}

/** Bumps a nonce, which is how both flip animations are armed. */
function Nonce({ label, children }: { label: string; children: (nonce: number) => ReactNode }) {
  const [nonce, setNonce] = useState(0)
  return (
    <Row gap={8}>
      {children(nonce)}
      <LabButton onClick={() => setNonce((n) => n + 1)}>{label}</LabButton>
    </Row>
  )
}

/** A route schematic row needs a positioning context for the bus tokens that ride it. */
function Rail({ children }: { children: ReactNode }) {
  return <div style={{ position: 'relative' }}>{children}</div>
}

const noop = () => {}

// ── FeedNotice ─────────────────────────────────────────────────────────────────────────────────

/** A board's clock and a viewing clock, fixed so the samples are the same picture every load. */
const BOARD_ISO = '2026-08-13T21:34:00+08:00'
const NOW = Date.parse('2026-08-13T21:34:30+08:00')
const SIX_MINUTES_LATER = Date.parse('2026-08-13T21:40:00+08:00')

/**
 * Every arm of `feedNotice`, from the kernel itself.
 *
 * A `Record` keyed by the union rather than an array, so **a fifth kind is a typecheck failure here** —
 * the gallery's own version of the totality a `oneOf` slot has in the spec. A picture that silently stopped
 * covering a state would be the exact drift this page exists to prevent.
 */
const FEED_NOTICE_STATES: Record<FeedNoticeView['kind'], Sample> = {
  none: {
    state: 'none — the ordinary case',
    how: 'The newest board on screen is 30 s old, the platform has a network, the last request answered. Renders nothing at all.',
    draws: 'nothing',
    render: () => (
      <FeedNotice
        notice={feedNotice({
          lastUpdatedIso: BOARD_ISO,
          now: NOW,
          online: true,
          trouble: 'none',
          staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
        })}
      />
    ),
  },
  lastUpdated: {
    state: 'lastUpdated',
    how: `The newest board is 6 min old — past the served staleAfterMs (${CLIENT_POLICY_DEFAULTS.staleAfterMs / 1000} s) — and nothing newer has arrived. The time is the operator's own clock, absolute rather than "6 minutes ago".`,
    render: () => (
      <FeedNotice
        notice={feedNotice({
          lastUpdatedIso: BOARD_ISO,
          now: SIX_MINUTES_LATER,
          online: true,
          trouble: 'none',
          staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
        })}
      />
    ),
  },
  offline: {
    state: 'offline',
    how: 'The platform reports no network. It outranks the two below it: no network explains old data, so a rider is told the cause once, not the symptom twice.',
    render: () => (
      <FeedNotice
        notice={feedNotice({
          lastUpdatedIso: BOARD_ISO,
          now: SIX_MINUTES_LATER,
          online: false,
          trouble: 'none',
          staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
        })}
      />
    ),
  },
  unreachable: {
    state: 'unreachable',
    how: 'Our own edge answered with a failure, or the request never arrived — with a network the platform believes in, which is also the captive-portal case. An UPSTREAM board refusing is never routed here; the card says that itself.',
    render: () => (
      <FeedNotice
        notice={feedNotice({
          lastUpdatedIso: BOARD_ISO,
          now: NOW,
          online: true,
          trouble: 'unreachable',
          staleAfterMs: CLIENT_POLICY_DEFAULTS.staleAfterMs,
        })}
      />
    ),
  },
}

// ── the registry ───────────────────────────────────────────────────────────────────────────────

/** Every operator that has a livery — the token table's own keys, so a fifth appears the day it lands. */
const OPERATORS = Object.keys(OPERATOR_ACCENT) as OperatorId[]

/** The eight bearings `bearingOctantDeg` quantises to. Geometry, not a decision — see `goldens.ts`. */
const OCTANTS = [0, 45, 90, 135, 180, 225, 270, 315]

const LEAVES: readonly SampleGroup[] = [
  {
    component: 'BusGlyph',
    tier: 'leaf',
    spec: 'apps/web/src/components/BusGlyph.tsx — geometry, pinned by nothing but the eye (ADR-132)',
    note: 'The app’s own front-view glyphs, because Lucide has neither a double-decker nor a light bus. The two share a width, a window width and a ground line and differ in height and glass — so height and band count are what the eye compares, which is the difference that has to survive at 16 px.',
    samples: [
      {
        state: 'bus — the double-decker',
        how: '`routeVehicle` answers `bus` for KMB, and for any operator nobody has heard of. Drawn at 18, 24 and 48 px so the 2 px stroke can be judged at the size it actually ships as well as one you can see.',
        draws: 'no-text',
        render: () => (
          <Row gap={16}>
            {[18, 24, 48].map((size) => (
              <span key={size} className="text-text">
                <BusGlyph vehicle={vehicle('kmb-runs-a-bus')} size={size} />
              </span>
            ))}
          </Row>
        ),
      },
      {
        state: 'minibus — the light bus',
        how: '`routeVehicle` answers `minibus` for GMB and only GMB. One taller pane instead of two bands, plus the destination sign box no decker carries, and a deliberately empty lower face — anything under the glass makes it read as a two-band vehicle again.',
        draws: 'no-text',
        render: () => (
          <Row gap={16}>
            {[18, 24, 48].map((size) => (
              <span key={size} className="text-text">
                <BusGlyph vehicle={vehicle('gmb-runs-a-minibus')} size={size} />
              </span>
            ))}
          </Row>
        ),
      },
      {
        state: 'the two side by side, at token size',
        how: 'Both vehicles at the 16 px the rail token draws them at, on the accent disc they ride. This is the only comparison that matters: if they are not tellable apart here, they are not tellable apart anywhere in the app.',
        draws: 'no-text',
        render: () => (
          <Row gap={16}>
            {(['bus', 'minibus'] as const).map((v) => (
              <span
                key={v}
                className="bg-accent text-accent-contrast"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                }}
              >
                <BusGlyph vehicle={v} size={16} />
              </span>
            ))}
          </Row>
        ),
      },
    ],
  },
  {
    component: 'RouteChip',
    tier: 'leaf',
    spec: 'a slot in stop-row.spec.json and place-row.spec.json; the colours are @nextbus/ui’s generated tables',
    note: 'The one sanctioned use of an operator accent as a *background* (docs/09 §2). Both colour tables are generated, so this chip and the RN chip cannot disagree about what KMB red is. **The pairing is what to check here, not the hue** — and this panel is what caught LWB’s gold sitting under white at 2.16:1, four waves after CTB’s yellow was fixed to dark ink and LWB was not (ADR-155). Both light accents take `#0F172A` now, and `test/search-contrast.test.ts` measures every pair so a fifth operator cannot arrive unmeasured.',
    samples: [
      {
        state: 'every livery, side by side',
        how: 'The operator set is `OPERATOR_ACCENT`’s own keys — the same four `OperatorId` admits — so a fifth operator appears here the day its colours land. The numbers are illustrative; the colours are not. Read the two *light* accents first: gold 8.28:1 and yellow 11.13:1, against KMB’s 4.96 and GMB’s 4.71, which are the two within a nudge of failing.',
        render: () => (
          <Row gap={8}>
            {OPERATORS.map((operator) => (
              <Cell key={operator} label={operator}>
                <RouteChip operator={operator} routeNo="969X" />
              </Cell>
            ))}
          </Row>
        ),
      },
      {
        state: 'as a card draws it',
        how: 'The route numbers off a `stopCardView` golden — one, two and three characters, which is what the 44 px minimum width exists for: a chip that shrank to its content would make a column of route numbers ragged.',
        render: () => (
          <Row gap={8}>
            {[0, 1, 2].map((i) => {
              const row = cardRow('the-urgency-bands-at-every-boundary', i)
              return <RouteChip key={row.routeId} operator={row.operator} routeNo={row.routeNo} />
            })}
          </Row>
        ),
      },
    ],
  },
  {
    component: 'StopName',
    tier: 'leaf',
    spec: 'a slot in stop-row.spec.json, place-row.spec.json and route-detail.spec.json',
    note: 'The name proper with the operator’s own pole code a step smaller and muted (ADR-034). Which part is the code — and that the code comes off *before* title-casing — is `displayName`’s rule in the kernel; this component only draws the split.',
    samples: [
      {
        state: 'an ALL-CAPS name with a pole code',
        how: 'The KMB feed publishes names in caps. `displayName` title-cases what is left after the code is split off, which is why the code survives as `ST935` rather than becoming `St935`.',
        render: () => <StopName name={stopName('an-all-caps-kmb-name-with-a-pole-code')} />,
      },
      {
        state: 'a name with no code',
        how: 'The common case — nothing to split, nothing muted after the name.',
        render: () => <StopName name={stopName('a-name-with-no-code-yields-no-code')} />,
      },
      {
        state: 'a CJK name',
        how: 'No Latin to case, and the whole reason title-casing is a kernel rule rather than a CSS `text-transform`: the browser would have nothing to do here and something wrong to do above.',
        render: () => <StopName name={stopName('a-cjk-name-has-no-latin-to-case')} />,
      },
      {
        state: 'a circular marker is not a pole code',
        how: 'The word `CIRCULAR` sits where a code would and is not one — the case that stops a naive split putting a service note in the muted slot.',
        render: () => <StopName name={stopName('a-circular-marker-is-not-a-pole-code')} />,
      },
      {
        state: 'emphasis — the rider’s own stop',
        how: 'The boarding row on the route schematic, in the accent. The RN row emphasises `here` in three places (background, rail node, name) and the web had only two until WP6-7b — so the stop a rider is looking for was the least legible one.',
        render: () => (
          <Stack gap={4}>
            <StopName name={stopName('an-all-caps-kmb-name-with-a-pole-code')} />
            <StopName name={stopName('an-all-caps-kmb-name-with-a-pole-code')} emphasis />
          </Stack>
        ),
      },
    ],
  },
  {
    component: 'EtaBadge',
    tier: 'leaf',
    spec: 'a slot in stop-row.spec.json — the readout on a card’s right-hand side',
    note: 'The widest-reached ETA renderer in the app: tabular figures, urgency colour, no client-side countdown, and **nothing at all about staleness** (ADR-123). Two staleness treatments were built here and withdrawn — a fade and a muted `~` — because `isStale` reads one `dataTimestamp` per *board*, so a per-figure cue draws one fact 78 times down a screen. The screen says it once instead (`FeedNotice`).',
    samples: [
      {
        state: 'mins — a fresh reading three minutes out',
        how: '`etaReadout`’s ordinary answer. The number and the unit are separate nodes so only the number moves as the value changes, which is what keeps the width from jumping.',
        render: () => {
          const r = readout('a-fresh-reading-three-minutes-out')
          return <EtaBadge label={r.label} urgency={r.urgency} />
        },
      },
      {
        state: 'the three urgency bands together',
        how: 'One reading at each band the served `ClientPolicy` defines — due, soon, normal, and the `none` a card with no reading gets — taken by *band* from the golden that walks every boundary, never by index (the card is capped at `maxRows`). The thresholds are `etaUrgency`’s and neither renderer sees them; this table only decides what `soon` looks like.',
        render: () => (
          <Row gap={16}>
            {(['due', 'soon', 'normal', 'none'] as const).map((urgency) => {
              const row = cardRowWhere('the-urgency-bands-at-every-boundary', urgency)
              return (
                <Cell key={urgency} label={urgency}>
                  <EtaBadge label={row.label} urgency={row.urgency} />
                </Cell>
              )
            })}
          </Row>
        ),
      },
      {
        state: 'due — the word, never “0 min”',
        how: 'Inside the minute. A rider reading a zero would think they had missed it, so the badge says the word and never fabricates a sub-minute number (ADR-008).',
        render: () => <EtaBadge label={labelParts('due-en')} urgency="due" />,
      },
      {
        state: 'due, in Traditional Chinese',
        how: 'The same arm with the catalogue’s own word. The label is composed by the kernel and handed over whole — a renderer that built “Due” itself would be a second catalogue.',
        render: () => <EtaBadge label={labelParts('due-zh-hans')} urgency="due" />,
      },
      {
        state: 'departed — an em dash',
        how: 'The board answered and its last arrival is already past. The reading exists and names a moment gone, so it is a dash rather than a blank; inventing “gone” would be a claim the feed did not make.',
        render: () => {
          const r = readout('an-empty-arrivals-array-is-departed-and-not-urgent')
          return <EtaBadge label={r.label} urgency={r.urgency} />
        },
      },
      {
        state: 'headway — the published timetable',
        how: 'No live reading at all, but a frequency upstream publishes — small and muted rather than a figure, because it is the *Static* honesty tier and must not read as a bus that has been seen. Taken from the `placeDetailView` case that reaches it.',
        render: () => {
          const row = placeRow('a-route-with-no-reading-falls-back-to-its-timetable')
          return row.readout.kind === 'headway' ? (
            <EtaBadge label={{ kind: 'headway', text: row.readout.text }} urgency="none" />
          ) : (
            /* Unreachable while the case holds; loud rather than silently blank if it stops holding. */
            <span className="text-caption text-danger">
              the timetable case no longer falls back
            </span>
          )
        },
      },
      {
        state: 'nothing to say at all',
        how: 'Neither a reading nor a published frequency — a saved route whose line is quiet. Still a row, because a card with a name and nothing under it cannot be told from a favourite key that no longer resolves (`stop-row.spec.json`’s oldest `mustNot`).',
        render: () => {
          const row = favouriteCard('a-saved-route-with-no-reading-is-still-a-row').rows[0]
          if (!row) throw new Error('the favourites case no longer has a row to draw')
          return <EtaBadge label={row.label} urgency={row.urgency} />
        },
      },
    ],
  },
  {
    component: 'RemarkTag',
    tier: 'leaf',
    spec: 'a slot in stop-row.spec.json and place-row.spec.json',
    note: 'An operator remark, already reduced to one locale and classified by `remarkView`. **All three classes render in the same subtle tone** (ADR-036): the honesty cue is in the word "Scheduled", never a colour. The kind→tone table is kept rather than collapsed, because it is the record of that decision.',
    samples: [
      {
        state: 'scheduled — the class the edge served',
        how: 'The server sent a kind and it is used as given. This is the remark that matters most: it says a time is a timetable rather than a sighting.',
        render: () => {
          const r = remark('a-served-kind-is-used-as-given')
          return r ? <RemarkTag remark={r} /> : null
        },
      },
      {
        state: 'lastBus — classified on the client',
        how: 'No kind on the wire, so `classifyRemark` — the same function the edge calls — runs here instead. One rule, two callers.',
        render: () => {
          const r = remark('no-served-kind-falls-back-to-the-same-function-the-edge-calls')
          return r ? <RemarkTag remark={r} /> : null
        },
      },
      {
        state: 'the same remark in Chinese',
        how: 'The feeds really do send an empty `en` with a populated `zh-Hant`, so the locale that has the text is the locale that shows it.',
        render: () => {
          const r = remark('the-same-blank-remark-shows-in-chinese')
          return r ? <RemarkTag remark={r} /> : null
        },
      },
      {
        state: 'none — blank in this locale is absent',
        how: 'An empty string in the reader’s language counts as no remark, so the caller renders nothing. Shown as a panel rather than omitted, because "absent" is a state a reviewer needs to see is deliberate.',
        draws: 'nothing',
        render: () => {
          const r = remark('blank-in-this-locale-is-absent')
          return r ? <RemarkTag remark={r} /> : null
        },
      },
    ],
  },
  {
    component: 'BearingArrow',
    tier: 'leaf',
    spec: 'a slot in stop-row.spec.json — the compass cue beside a place’s caption',
    note: 'Rotated by `bearingOctantDeg` — **the same function `formatBearing` uses to choose its word** — so the needle and the label beside it cannot point and say different things. Both renderers had their own `Math.round(deg / 45) * 45` before WP4-1.',
    samples: [
      {
        state: 'the eight octants',
        how: 'The quantisation itself: any bearing lands on one of these eight. Read off `bearingOctantDeg` rather than a corpus, because it is the function’s own geometry — 0° is North and up.',
        render: () => (
          <Row gap={8}>
            {OCTANTS.map((deg) => (
              <Cell key={deg} label={`${deg}°`}>
                <BearingArrow bearingDeg={deg} size={20} />
              </Cell>
            ))}
          </Row>
        ),
      },
      {
        state: 'as a card draws it',
        how: 'Real bearings off three goldens, at the 13 px the card uses, each beside the caption `formatBearing` gave it — 225° lands on an octant, 167° and 148° are quantised to 180° and 135°. Three *different* cases on purpose: the first draft picked two cards that happened to share a bearing, so the panel demonstrated the rounding by drawing the same arrow twice.',
        render: () => (
          <Stack gap={4}>
            {[
              card('the-urgency-bands-at-every-boundary'),
              card('one-line-at-two-kerbs-is-one-row-and-the-count-stays-in-lines'),
              favouriteCard('two-saved-poles-of-one-place-are-one-card'),
            ].map((view) =>
              view.bearingDeg === undefined ? null : (
                <Row key={view.stopId} gap={4}>
                  <BearingArrow bearingDeg={view.bearingDeg} />
                  <Caption>
                    {view.bearingDeg}° · {view.caption}
                  </Caption>
                </Row>
              ),
            )}
          </Stack>
        ),
      },
    ],
  },
  {
    component: 'SlideNumber',
    tier: 'leaf',
    spec: 'apps/web/src/components/SlideNumber.tsx — motion, and a load-bearing DOM property',
    note: '**At rest it is a single text node, and that is the property to protect.** A conformance projection reads text by presence rather than visibility (ADR-097), so a readout that kept both values mounted would make every screen carrying an arrival project two figures for one bus, permanently. The animation machinery mounts only mid-transition — a 260 ms window no suite can reach.',
    samples: [
      {
        state: 'at rest — one text node',
        how: 'Nothing has changed, so there is no grid, no outgoing copy and no timer. This is the state the app is in essentially all of the time.',
        render: () => <SlideNumber value="12" className="text-h2 font-semibold tabular-nums" />,
      },
      {
        state: 'a change — only the characters that changed move',
        how: '`52 min` → `51 min` slides the 2 and leaves the 5 and the unit still. Tap through: the two-to-one-digit step (`10` → `9`) is the one that used to clip, before the sizer became an inline grid.',
        render: () => (
          <Ticker values={['52', '51', '50', '10', '9', '8']}>
            {(value) => (
              <Row gap={2} align="baseline">
                <SlideNumber value={value} className="text-h2 font-semibold tabular-nums" />
                <span className="text-caption text-muted">min</span>
              </Row>
            )}
          </Ticker>
        ),
      },
    ],
  },
  {
    component: 'DirectionSwapIcon',
    tier: 'leaf',
    spec: 'apps/web/src/components/DirectionSwapIcon.tsx — the twin of the RN glyph (ADR-046)',
    note: 'Lucide’s `git-compare-arrows`: two nodes with arrows flowing between them, so the end dots visibly orbit and swap. A plain `⇄` is point-symmetric with nothing to track, and its spin reads as a wobble. **The rotation accumulates rather than toggling** — three flips turn three half-turns the same way, where `deg % 360` would make the second spin backwards.',
    samples: [
      {
        state: 'at rest',
        how: 'The glyph as it sits in the route header’s direction control, before anything has been tapped.',
        draws: 'no-text',
        render: () => (
          <span className="text-text">
            <DirectionSwapIcon nonce={0} size={24} />
          </span>
        ),
      },
      {
        state: 'each flip is a half-turn, anticlockwise',
        how: 'Tap repeatedly. It must keep turning the same way — the accumulation is the bug this component was rewritten to fix. Under `prefers-reduced-motion` the CSS snaps to the new angle instead, with no `matchMedia` here.',
        render: () => (
          <Nonce label="flip">
            {(nonce) => (
              <span className="text-text">
                <DirectionSwapIcon nonce={nonce} size={24} />
              </span>
            )}
          </Nonce>
        ),
      },
    ],
  },
  {
    component: 'SaveStar',
    tier: 'leaf',
    spec: 'place-row.spec.json’s `saved` slot — and the indicator half of ADR-032',
    note: 'The route-at-stop favourite. **The key is the member pole, never the place** — `formatFavoriteRouteKey(stopId, routeId)` over e.g. `KMB:ST141`, because a `P:` place id churns whenever the clustering is re-tuned and would orphan a saved favourite. `aria-pressed` rather than a checkbox role, and no text node: a word here would appear in every Place-row projection on one renderer only.',
    samples: [
      {
        state: 'tap to toggle — the real store',
        how: 'This is the shipping component with no seam, so it reads and writes the real `nextbus.preferences` blob. The ids are lab-only (`LAB:…`), which `favouritesView` drops as unresolvable — so toggling here cannot put a phantom card on the Favourites tab.',
        render: () => (
          <Row gap={8}>
            <SaveStar stopId="LAB:POLE" routeId="LAB:1:outbound:1" />
            <Caption>a Route-detail sheet’s star: always drawn, filled when saved</Caption>
          </Row>
        ),
      },
      {
        state: 'hideWhenEmpty — the Place row’s indicator',
        how: 'Renders nothing until the route is saved, exactly as on native: an unsaved row stays uncluttered and the affordance that *creates* a favourite is the route schematic’s sheet. Toggle the star above with the same lab id to make this one appear.',
        draws: 'nothing',
        render: () => <SaveStar stopId="LAB:POLE" routeId="LAB:1:outbound:1" hideWhenEmpty />,
      },
    ],
  },
]

const COMPOSED: readonly SampleGroup[] = [
  {
    component: 'FeedNotice',
    tier: 'composed',
    spec: 'packages/contract/src/ui/feed-notice.ts — a slot in all four screen specs, not a spec of its own',
    note: 'One line per screen, above the readings, in the muted token and never a warning colour: nothing is wrong with the rider’s stop. The four states are exclusive by construction — the kernel applies a precedence (offline → unreachable → lastUpdated → none) because each earlier one explains the later ones (ADR-133, ADR-150).',
    samples: [
      FEED_NOTICE_STATES.lastUpdated,
      FEED_NOTICE_STATES.offline,
      FEED_NOTICE_STATES.unreachable,
      FEED_NOTICE_STATES.none,
    ],
  },
  {
    component: 'StopCard',
    tier: 'composed',
    spec: 'packages/contract/ui/stop-row.spec.json',
    note: 'The compact card Nearby and Favourites are lists of. Every sample is a corpus golden — the same bytes both renderers’ conformance suites replay. It is the first spec with zero `knownDefect`s, and both bugs it was measured on were closed **by fixing the producer, not the card** (ADR-090).',
    samples: [
      {
        state: 'content',
        how: 'A place whose boards all answered: `stopCardView` over a merged five-pole place, capped at the served `maxRows` with the honest count of what is hidden — never a silent filter (ADR-008).',
        render: () => (
          <StopCard view={card('a-card-with-every-board-answering-is-complete')} locale={LOCALE} />
        ),
      },
      {
        state: 'urgency bands',
        how: 'One card carrying a reading at every boundary of the served bands — due, soon, normal — so the three tones can be compared against each other rather than one screen at a time. The thresholds are the edge’s (`ClientPolicy`), never a literal in a component.',
        render: () => (
          <StopCard view={card('the-urgency-bands-at-every-boundary')} locale={LOCALE} />
        ),
      },
      {
        state: 'incomplete',
        how: 'One kerb of the place refused us. The rows are unchanged and the card says so — “no buses” and “nobody would tell us” are different facts (ADR-073, ADR-077).',
        render: () => (
          <StopCard
            view={card('one-refusing-kerb-makes-the-card-incomplete-without-changing-its-rows')}
            locale={LOCALE}
          />
        ),
      },
      {
        state: 'empty',
        how: 'A place with no live readings at all, which still says how many routes serve it.',
        render: () => (
          <StopCard
            view={card('a-place-with-no-live-readings-still-says-how-many-routes-it-has')}
            locale={LOCALE}
          />
        ),
      },
      {
        state: 'departed',
        how: 'A board that answered with no arrivals: an em dash, because the reading exists and names a moment already past. Inventing “gone” would be a claim the feed did not make.',
        render: () => (
          <StopCard
            view={card('a-reading-with-no-arrivals-is-departed-not-absent')}
            locale={LOCALE}
          />
        ),
      },
      {
        state: 'remarked',
        how: 'An operator remark beside a destination becomes its own line — the wording carries the honesty cue, never a colour (ADR-036).',
        render: () => (
          <StopCard
            view={card('a-remark-beside-a-destination-becomes-its-own-line')}
            locale={LOCALE}
          />
        ),
      },
      {
        state: 'a saved card, from the Favourites tab',
        how: 'The same component over `favouritesView`’s output rather than `stopCardView`’s — two saved poles of one place fold into one card, which is the whole reason Favourites is a kernel function and not a filter over a list.',
        render: () => (
          <StopCard
            view={favouriteCard('two-saved-poles-of-one-place-are-one-card')}
            locale={LOCALE}
          />
        ),
      },
    ],
  },
  {
    component: 'PlaceRow',
    tier: 'composed',
    spec: 'packages/contract/ui/place-row.spec.json',
    note: 'The row Place detail lists under each kerb. Its right-hand side is a three-way readout, and each arm below is a different corpus case — two of the three were declared and never projected until WP6-3b, which an injected defect proved by passing.',
    samples: [
      {
        state: 'readout · live minutes',
        how: 'An arrival five minutes out, under a served policy that moves the imminence band. The tone is the band’s, never a literal in the component.',
        render: () => <PlaceRow row={placeRow('a-served-policy-moves-the-imminence-band')} />,
      },
      {
        state: 'readout · due',
        how: 'Inside the minute: the word, not “0 min”. A rider reading a zero would think they had missed it (ADR-008).',
        render: () => <PlaceRow row={placeRow('an-arrival-inside-the-minute-reads-due')} />,
      },
      {
        state: 'readout · timetable',
        how: 'No live reading, but a published frequency — the arm that says a quiet route is not a broken one.',
        render: () => (
          <PlaceRow row={placeRow('a-route-with-no-reading-falls-back-to-its-timetable')} />
        ),
      },
      {
        state: 'readout · departed',
        how: 'The board answered and its last arrival is past: a dash.',
        render: () => <PlaceRow row={placeRow('a-lone-stop-is-one-flat-list')} />,
      },
      {
        state: 'remarked',
        how: 'A remark rides the row under its destination, verbatim.',
        render: () => <PlaceRow row={placeRow('a-remark-rides-the-row')} />,
      },
      {
        state: 'a whole kerb’s worth, in order',
        how: 'The rows of one merged place under its first boarding point — the level the screen actually stacks them at, so the vertical rhythm and the readout column can be judged rather than one row at a time.',
        render: () => (
          <Stack gap={0}>
            {(() => {
              const view = place('a-merged-place-groups-its-rows-under-each-kerb')
              const rows = view.groups[0]?.rows ?? view.rows
              return rows.map((row) => <PlaceRow key={`${row.stopId}/${row.routeId}`} row={row} />)
            })()}
          </Stack>
        ),
      },
    ],
  },
  {
    component: 'ArrivalSlot',
    tier: 'composed',
    spec: 'exported from RouteStopRow.tsx — one renderer of a route arrival, not two (ADR-115)',
    note: 'The schematic’s own readout, sized for a row that carries up to three of them on one line rather than a card’s right-hand side. **The text nodes are identical to `EtaBadge`’s**, which is what the spec pins; the sizes are the row’s business. Exported so the action sheet shows the same times the row behind it does — a stop’s *name* was once written twice eleven lines apart, and a time would be worse.',
    samples: [
      {
        state: 'first slot, and the ones behind it',
        how: 'The soonest arrival is the row’s figure and takes the urgency tone; the rest are muted and small. Three readings from one `routeStopBoard` golden.',
        render: () => (
          <Row gap={12} align="baseline">
            {stopBoard('a-pole-board-answers-for-the-route-the-rider-tapped').arrivals.map(
              (arrival, i) => (
                <ArrivalSlot key={arrival.iso} arrival={arrival} first={i === 0} />
              ),
            )}
          </Row>
        ),
      },
      {
        state: 'a stale board dims every slot together',
        how: 'Staleness is the *board’s*, not a reading’s, so both slots dim as one — and it dims rather than recolours, because colour alone is what ADR-008 forbids. The value itself does not move: a reading only changes when a fresh one arrives.',
        render: () => (
          <Row gap={12} align="baseline">
            {stopBoard('a-stale-board-dims-every-slot-together').arrivals.map((arrival, i) => (
              <ArrivalSlot key={arrival.iso} arrival={arrival} first={i === 0} />
            ))}
          </Row>
        ),
      },
      {
        state: 'the four arms on one line',
        how: 'A figure, the word inside the minute, a published headway and the dash — the whole vocabulary of a slot, side by side, which is the only way to check that they read as one scale.',
        render: () => (
          <Row gap={16} align="baseline">
            {(
              [
                { key: 'mins', label: labelParts('mins-120s-en'), urgency: 'normal' as const },
                { key: 'due', label: labelParts('due-en'), urgency: 'due' as const },
                {
                  key: 'headway',
                  label: { kind: 'headway' as const, text: 'every 10 – 15 min' },
                  urgency: 'none' as const,
                },
                {
                  key: 'departed',
                  label: labelParts('departed-carries-no-label'),
                  urgency: 'none' as const,
                },
              ] as const
            ).map((arm) => (
              <Cell key={arm.key} label={arm.key}>
                <ArrivalSlot
                  arrival={{ iso: arm.key, label: arm.label, urgency: arm.urgency, stale: false }}
                  first
                />
              </Cell>
            ))}
          </Row>
        ),
      },
    ],
  },
  {
    component: 'RailBusToken',
    tier: 'composed',
    spec: 'route-detail.spec.json’s bus slot — position is the kernel’s, geometry is CSS (ADR-110)',
    note: '**`role="img"` with the kernel’s own `RailBus.label`** — a disc with a glyph in it is nothing to a screen reader without one, and the honest fix was to name it rather than exempt it (ADR-093). Where it sits is two constant CSS expressions against its own row, never a measured offset: nothing is measured, so nothing can go stale. Three idle clocks — a ±0.5 px bob, a ±6° rock and a 6 % squash — anchored to the *document* timeline, so a token that moves between rows does not restart mid-bounce.',
    samples: [
      {
        state: 'at a node — standing at a stop',
        how: '`railBus` puts the bus on the node it is reaching when it is a minute away. `top: 13px` — the node centre less half a token.',
        draws: 'no-text',
        render: () => {
          const bus = buses('a-bus-a-minute-away-stands-on-the-node-it-is-reaching')[0]
          if (!bus) throw new Error('the node case no longer puts a bus on the rail')
          return (
            <div style={{ position: 'relative', height: 64, width: RAIL_WIDTH }}>
              <RailBusToken bus={bus} ordinal={0} />
            </div>
          )
        },
      },
      {
        state: 'on the segment — between two stops',
        how: 'Drawn at `calc(50% + 13px)` in the row *behind* its target, because the midpoint of two adjacent nodes is exactly half a row below the first. `railBus` only ever emits `from: to − 1`, so there is no third case.',
        draws: 'no-text',
        render: () => {
          const bus = buses('a-bus-mid-route-rides-the-segment-leading-into-its-stop')[0]
          if (!bus) throw new Error('the segment case no longer puts a bus on the rail')
          return (
            <div style={{ position: 'relative', height: 64, width: RAIL_WIDTH }}>
              <RailBusToken bus={bus} ordinal={0} />
            </div>
          )
        },
      },
      {
        state: 'a minibus on the rail',
        how: 'The same token with `routeVehicle`’s other answer — the glyph is the kernel’s word, never this component’s guess. Watch the two bob together: they share a clock read off the document timeline, so they cannot drift out of phase.',
        draws: 'no-text',
        render: () => {
          const bus = buses('a-bus-a-minute-away-stands-on-the-node-it-is-reaching')[0]
          if (!bus) throw new Error('the node case no longer puts a bus on the rail')
          return (
            <div style={{ position: 'relative', height: 64, width: RAIL_WIDTH * 2 }}>
              <RailBusToken bus={bus} ordinal={0} vehicle={vehicle('kmb-runs-a-bus')} />
              <span style={{ position: 'absolute', left: RAIL_WIDTH, top: 0, width: RAIL_WIDTH }}>
                <RailBusToken bus={bus} ordinal={1} vehicle={vehicle('gmb-runs-a-minibus')} />
              </span>
            </div>
          )
        },
      },
    ],
  },
  {
    component: 'RouteStopRow',
    tier: 'composed',
    spec: 'packages/contract/ui/route-detail.spec.json',
    note: 'One stop on the vertical schematic, and **the whole row is one `<button>`** — the RN row is a single `Pressable`, so a nested control for the fare or the star would be a tap target inside a tap target (ADR-024). The bus tokens are the button’s *siblings*, never its children: a labelled `role="img"` inside a button is folded into that button’s accessible name, which turned “Nathan Road · 3 min” into “Nathan Road · 3 min · Bus approaching Nathan Road”.',
    samples: [
      {
        state: 'first — the origin row',
        how: 'The rail draws no connector above it. A route whose last row drew one below would dangle a line into the page and nothing would fail, which is why `first`/`last` are the kernel’s flags rather than an index comparison.',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRowWhere('a-saved-route-stars-only-the-pole-it-was-saved-at', 'first')}
              index={0}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'last — the terminus',
        how: 'The other end of the same rule, and the row that carries no fare: you cannot board at the terminus.',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRowWhere('a-saved-route-stars-only-the-pole-it-was-saved-at', 'last')}
              index={4}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'here — the rider’s own boarding stop',
        how: 'Opened from a stop, so that row is emphasised and scrolled to. Three cues, not one: the row background, the rail node and the name — the web had only two until WP6-7b.',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRowWhere('a-route-opened-from-a-stop-anchors-that-row', 'here')}
              index={1}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'saved — the star on the node’s corner',
        how: 'This route saved at *this* pole (ADR-042). `routeDetailView` computes it from the same `savedRouteKeys` the sheet reads, so the node and the sheet cannot disagree.',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRowWhere('a-saved-route-stars-only-the-pole-it-was-saved-at', 'saved')}
              index={1}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'a stale board dims every slot on the row together',
        how: 'Staleness belongs to the board, so the whole line dims as one rather than per figure — the row-level version of the decision `EtaBadge` refuses to make at all (ADR-123).',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRowWithArrivals('a-stale-board-dims-every-slot-on-its-row-together')}
              index={2}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'departed — a row with nothing on it',
        how: 'A reading that is not an arrival leaves the row with no figure at all. Compare it against `waiting` below: they must not look the same, which is what `arrivalsPending` exists for.',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRow(
                'a-departed-reading-is-not-an-arrival-and-leaves-its-row-with-nothing',
                1,
              )}
              index={1}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'incomplete — the kerb that refused, beside its last time',
        how: 'A live round asks each of a route’s 13–41 poles separately, so one board can refuse while the rest answer. `retainFailedPoles` keeps its previous times rather than blanking it — so the honest render is the ageing figure **and** the sentence (ADR-073, ADR-116).',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRowWhere(
                'a-kerb-that-refused-keeps-its-last-time-and-says-why-beside-it',
                'incomplete',
              )}
              index={2}
              animateIn={false}
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'waiting — the round has not answered yet',
        how: '`arrivalsPending` reserves the arrivals line’s height and changes no word on screen. "Have we asked yet" is a fact about this fetch rather than about the route, which is why it is a boolean from the screen and not a field the kernel derives.',
        render: () => (
          <Rail>
            <RouteStopRow
              row={stopRow(
                'a-departed-reading-is-not-an-arrival-and-leaves-its-row-with-nothing',
                1,
              )}
              index={1}
              animateIn={false}
              arrivalsPending
              tokens={null}
              onPress={noop}
              registerRow={noop}
            />
          </Rail>
        ),
      },
      {
        state: 'carrying a bus',
        how: 'The token as the row actually holds it — a sibling of the button, riding this row’s own box. Its order is the kernel’s (`view.buses`), so a row given two of them must not re-order them.',
        render: () => {
          const bus = buses('a-bus-mid-route-rides-the-segment-leading-into-its-stop')[0]
          if (!bus) throw new Error('the segment case no longer puts a bus on the rail')
          return (
            <Rail>
              <RouteStopRow
                row={stopRowWithArrivals('a-saved-route-stars-only-the-pole-it-was-saved-at')}
                index={1}
                animateIn={false}
                tokens={<RailBusToken bus={bus} ordinal={0} />}
                onPress={noop}
                registerRow={noop}
              />
            </Rail>
          )
        },
      },
      {
        state: 'a run of rows — the rail as a rail',
        how: 'Five consecutive rows of one route, which is the only way to review the gutter: the 2 px line, the numbered nodes and the ragged heights a row with and without arrivals gives it.',
        render: () => (
          <Rail>
            {[0, 1, 2, 3, 4].map((i) => (
              <RouteStopRow
                key={i}
                row={stopRow('a-saved-route-stars-only-the-pole-it-was-saved-at', i)}
                index={i}
                animateIn={false}
                tokens={null}
                onPress={noop}
                registerRow={noop}
              />
            ))}
          </Rail>
        ),
      },
    ],
  },
  {
    component: 'JourneyLines',
    tier: 'composed',
    spec: 'route-detail.spec.json’s header slot; the motion is ADR-046 read through ADR-100',
    note: '**The old destination *is* the new origin**, so on a flip it rises from the destination slot into the origin slot, shrinking and fading to muted, while the old origin slides out and the new destination rises in — 380 ms, the same three moves on both renderers. `nonce` *arms* the swap; the names changing *fires* it, because the reverse payload lands a tick after the tap and animating on the tap would run the whole thing against the still-current names and then jump.',
    samples: [
      {
        state: 'at rest — two lines in flow',
        how: 'No layers and no animation machinery at all, the same discipline `SlideNumber` keeps and for the same reason: a header that kept both journeys mounted would project four lines for one route.',
        render: () => {
          const header = routeHeader('a-bidirectional-route-carries-the-id-its-toggle-navigates-to')
          return (
            <span className="text-h3 font-semibold text-text">
              <JourneyLines
                origin={header.origin}
                destination={header.destination}
                circular={header.circular}
                nonce={0}
              />
            </span>
          )
        },
      },
      {
        state: 'circular — the loop glyph',
        how: 'A circular service heads its own loop line and offers no direction toggle. The glyph is the only difference, and it belongs to the destination line rather than sitting outside the box — which is why it hands over on a flip rather than riding along.',
        render: () => {
          const header = routeHeader(
            'a-circular-route-heads-its-own-loop-line-and-offers-no-toggle',
          )
          return (
            <span className="text-h3 font-semibold text-text">
              <JourneyLines
                origin={header.origin}
                destination={header.destination}
                circular={header.circular}
                nonce={0}
              />
            </span>
          )
        },
      },
      {
        state: 'the swap — tap to flip',
        how: 'The two headers of one bidirectional route, alternated. **Reduced motion is checked in JS here, not only in CSS**: a swap puts four lines in the tree at once, so killing the keyframes would leave two origins and two destinations stacked for 380 ms — a rider who asked for less motion never enters the state at all.',
        render: () => {
          const outbound = routeHeader(
            'a-bidirectional-route-carries-the-id-its-toggle-navigates-to',
          )
          return (
            <Nonce label="flip direction">
              {(nonce) => (
                <span
                  className="text-h3 font-semibold text-text"
                  style={{ display: 'inline-block', minWidth: 240 }}
                >
                  <JourneyLines
                    origin={nonce % 2 === 0 ? outbound.origin : outbound.destination}
                    destination={nonce % 2 === 0 ? outbound.destination : outbound.origin}
                    circular={outbound.circular}
                    nonce={nonce}
                  />
                </span>
              )}
            </Nonce>
          )
        },
      },
    ],
  },
  {
    component: 'FilterChips',
    tier: 'composed',
    spec: 'packages/contract/ui/search.spec.json',
    note: '**The set is `searchView`’s and so is each chip’s pressed state** (ADR-091): which operator chips exist comes from the index, so a fifth operator appears the day its adapter lands, and `active` is a field of the view rather than this component’s memory of what was tapped. All it decides is what a pressed chip looks like. `aria-pressed` rather than a visual-only fill — colour alone is the thing ADR-008 forbids for exactly this reason.',
    samples: [
      {
        state: 'the operator chips come from the index',
        how: 'Two operators in the fixture index, so two operator chips, sorted so the row does not reorder itself as the dataset is rebuilt. The category chips follow.',
        render: () => (
          <FilterChips chips={chips('the-operator-chips-come-from-the-index')} onToggle={noop} />
        ),
      },
      {
        state: 'a category filter on',
        how: 'One chip pressed. It narrows the keypad and the list *together* — the invariant that makes a dimmed key honest — which is why this row and `RouteKeypad` below come from the same case.',
        render: () => (
          <FilterChips
            chips={chips('a-category-filter-narrows-the-keypad-and-the-list-together')}
            onToggle={noop}
          />
        ),
      },
      {
        state: 'an operator filter on',
        how: 'The same mechanism on the other half of the row, so a reviewer can check that the two kinds of chip are indistinguishable when pressed — they filter different things and are the same control.',
        render: () => (
          <FilterChips chips={chips('an-operator-filter-does-the-same')} onToggle={noop} />
        ),
      },
      {
        state: 'stops mode offers no category chips',
        how: 'A category is a property of a route, so searching stops leaves only the operator chips. The row shrinks rather than dimming — a chip that cannot mean anything is not a chip that is off.',
        render: () => (
          <FilterChips chips={chips('stops-mode-offers-no-category-chips')} onToggle={noop} />
        ),
      },
    ],
  },
  {
    component: 'RouteKeypad',
    tier: 'composed',
    spec: 'packages/contract/ui/search.spec.json',
    note: '**It decides nothing at all** — not even which keys are live. `searchView.keypad` arrives with the ten digits in keyboard order, each carrying whether pressing it can lead anywhere, and only the letters that continue the current prefix. So a key drawn live and a row the list can reach are one question answered once, and a dimmed key is honest: no route number in the rider’s current filter continues this way. A disabled key is **present but inert** rather than hidden — a shrinking grid would move the keys under a thumb between taps.',
    samples: [
      {
        state: 'nothing typed — every digit live',
        how: 'The empty screen. No prefix, so nothing narrows and the letter row is absent (no letter can be the *first* character of a route number).',
        render: () => (
          <RouteKeypad
            keypad={keypad('no-query-and-no-history-is-the-empty-screen')}
            value={query('no-query-and-no-history-is-the-empty-screen')}
            onChange={noop}
          />
        ),
      },
      {
        state: 'a prefix narrows the pad',
        how: 'One digit typed, and only the digits that can continue it stay live. Taps are inert here on purpose: the pad’s state is the golden’s, and a keypad that let you type would be showing an answer to a different question.',
        render: () => (
          <RouteKeypad
            keypad={keypad('a-route-query-narrows-to-its-matches')}
            value={query('a-route-query-narrows-to-its-matches')}
            onChange={noop}
          />
        ),
      },
      {
        state: 'a category filter darkens it further',
        how: 'The `Night` chip on and a digit typed: the pad narrows with the list, and the letter row goes with it. This is the state the whole design exists for — a dark pad here is a true statement, not a broken one.',
        render: () => (
          <RouteKeypad
            keypad={keypad('a-category-filter-narrows-the-keypad-and-the-list-together')}
            value={query('a-category-filter-narrows-the-keypad-and-the-list-together')}
            onChange={noop}
          />
        ),
      },
    ],
  },
  {
    component: 'MiniMap',
    tier: 'composed',
    spec: 'packages/contract/ui/place-detail.spec.json',
    note: '**It decides nothing about which dots exist or what they are called** — it is handed `PlaceDetailView.pins`, already folded by coordinate, labelled with the printed code its heading uses, and coloured by its own pole operator (ADR-087). The projection and framing rule are `@nextbus/core/mercator`’s. Tiles are the Lands Department’s, proxied and cached by our own Worker (ADR-049) — **so these panels need `pnpm dev:edge` running**, and the credit below each map is a licence obligation rather than decoration.',
    samples: [
      {
        state: 'a lone stop — one pin',
        how: 'One pole, so `grouped` is false: a bigger dot, no label chip, nothing tappable. Framing is the same `fitZoom` rule one pin and five pins share.',
        render: () => (
          <MiniMap pins={placePins('a-lone-stop-is-one-flat-list')} grouped={false} height={150} />
        ),
      },
      {
        state: 'a merged place — grouped, labelled dots',
        how: 'Three pins for a five-pole place, because two of the poles share a coordinate and fold into one dot labelled with both codes. `grouped` is a field of the *view*, never derived from `pins.length > 1` — a place whose every pole shares one coordinate folds to a single pin and still needs its code chip.',
        render: () => (
          <MiniMap
            pins={placePins('a-merged-place-groups-its-rows-under-each-kerb')}
            grouped
            label="Tin Shui Wai Park"
            height={150}
          />
        ),
      },
      {
        state: 'one kerb scrolled to — the rest dim',
        how: '`activeId` emphasises the dot the list is scrolled to and dims the others. A folded dot is active when **any** of its poles is — otherwise it goes dim exactly when the rider scrolls to one of the kerbs it stands for, which made the label appear to swap rather than highlight (ADR-086).',
        render: () => {
          const pins = placePins('a-merged-place-groups-its-rows-under-each-kerb')
          const active = pins[1]?.ids[0]
          return <MiniMap pins={pins} grouped activeId={active} height={150} />
        },
      },
      {
        state: 'two operators at one coordinate — the neutral pin',
        how: '`mergeCoincidentPins` keeps an operator only when every folded pole agrees. A KMB pole and a Citybus pole at one point have no single brand colour, and picking the first would state something the data does not.',
        render: () => (
          <MiniMap
            pins={mergedPins('two-operators-at-one-coordinate-leave-the-pin-neutral')}
            grouped
            height={150}
          />
        ),
      },
      {
        state: 'poles a metre apart keep their own pins',
        how: 'Exact coordinate equality is the fold rule, deliberately — "published at the same point" is a fact every renderer agrees on, where "close enough at this zoom" is a different answer per viewport. Two dots that nearly touch is the correct picture.',
        render: () => (
          <MiniMap
            pins={mergedPins('poles-a-metre-apart-keep-their-own-pins')}
            grouped
            height={150}
          />
        ),
      },
    ],
  },
  {
    component: 'MapAttribution',
    tier: 'composed',
    spec: 'an asserted slot in place-detail.spec.json — and a licence obligation (ADR-049)',
    note: 'The Lands Department’s terms make **both** the logo and the copyright notice required, **on the map face**. That is why it is a required member of the `TileSource` port rather than a component’s decoration, and why the notice is a real link and not plain text — the mistake the old OSM attribution made.',
    samples: [
      {
        state: 'over a map',
        how: 'Where it actually sits: bottom-right, on a translucent plate so it reads over any tile in either appearance. The words come from the catalogue through `localeRecord`, so both apps credit identically.',
        render: () => (
          <MiniMap pins={placePins('a-lone-stop-is-one-flat-list')} grouped={false} height={120} />
        ),
      },
      {
        state: 'on its own',
        how: 'The component alone, against the app surface, so the plate’s contrast and the 9 px notice can be checked without a map under them.',
        render: () => (
          <div style={{ position: 'relative', height: 40 }} className="bg-surface-2">
            <MapAttribution />
          </div>
        ),
      },
    ],
  },
]

const OVERLAYS: readonly SampleGroup[] = [
  {
    component: 'BottomSheet · SheetAction',
    tier: 'overlay',
    spec: 'apps/web/src/components/BottomSheet.tsx — the container both sheets share (ADR-100)',
    note: 'A `<dialog>` opened with `showModal()`, restyled to a full-viewport transparent box with the panel docked to the bottom edge — so focus trapping, `Escape` and an inert backdrop all survive, and a thumb still reaches it. **The scrim is a real `<button>`**, which is how tap-to-dismiss gets keyboard activation instead of a suppressed lint rule. Entrance: 330 ms to 7 px past rest, then 180 ms back. Drag to dismiss past 90 px or 850 px·s⁻¹, with a `-√(-dy)·2.5` rubber band upward.',
    samples: [
      {
        state: 'the sheet — open it, then drag it away',
        how: 'The real container with two actions in it. Worth doing three things: drag it down slowly past 90 px, throw it, and drag it *up* to feel the rubber band and confirm the 320 px underlap never bares the scrim.',
        render: () => (
          <Overlay
            label="open the sheet"
            sheet={(close) => (
              <BottomSheet
                titleId="lab-sheet-title"
                onClose={close}
                header={
                  <h2 id="lab-sheet-title" className="m-0 text-h3 font-semibold text-text">
                    {stopName('an-all-caps-kmb-name-with-a-pole-code').label}
                  </h2>
                }
              >
                {(dismiss) => (
                  <>
                    <SheetAction icon={Star} label="Add favourite" onClick={dismiss} />
                    <SheetAction icon={MapPinIcon} label="Open the stop" onClick={dismiss} />
                  </>
                )}
              </BottomSheet>
            )}
          />
        ),
      },
      {
        state: 'SheetAction — filled and hollow',
        how: 'The row on its own, both ways round: a saved favourite fills its star, exactly as the RN row does. 52 px minimum height, icon in the accent, label taking the rest.',
        render: () => (
          <Stack gap={0}>
            <SheetAction icon={Star} label="Remove favourite" filled onClick={noop} />
            <SheetAction icon={Star} label="Add favourite" onClick={noop} />
            <SheetAction icon={MapPinIcon} label="Open the stop" onClick={noop} />
          </Stack>
        ),
      },
    ],
  },
  {
    component: 'RouteFactSheet',
    tier: 'overlay',
    spec: 'packages/contract/ui/route-detail.spec.json — a pure projection of `routeFactSheet`',
    note: 'The detail behind a static-fact pill (ADR-044). **The content is entirely the kernel’s** — the fare stages and where you board for each, the concession estimates with the `~` that marks them as estimates, the band headways, the per-day-type hours, and which whole-route figures are guesses. What is this file’s is four glyph tables (*which* concept a glyph denotes is identity; the *set* is idiom) and the container.',
    samples: [
      {
        state: 'fare — the timeline steps down',
        how: 'Dearest first, which is the order sectional fares step down in, each stage naming where you board for it. Both concession estimates or neither: a legend keyed to figures that are not on screen is worse than none.',
        render: () => (
          <Overlay
            label="fare"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet(
                  'the-fare-timeline-steps-down-and-names-where-you-board-for-each-price',
                )}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'fare — one stage for the whole route',
        how: 'A route whose per-stop fares are unreadable falls back to the figure the pill showed. Drawn exactly as any other stage — the sheet is deliberately silent about *why* there is only one, because "we cannot describe this route’s sections" is not something a rider can act on.',
        render: () => (
          <Overlay
            label="fare · fallback"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet(
                  'a-route-whose-fares-are-not-numbers-opens-with-the-fare-the-pill-showed',
                )}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'fare — nothing priceable anywhere',
        how: 'No readable per-stop fare *and* no whole-route fare to fall back to. No stage and no legend, rather than an invented one.',
        render: () => (
          <Overlay
            label="fare · empty"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet(
                  'a-route-with-no-fare-anywhere-says-nothing-rather-than-inventing-a-stage',
                )}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'freq — the coarse pill broken into bands',
        how: 'Per day type, per hour band. The pill above says "every 10 – 25 min"; this is where that range came from.',
        render: () => (
          <Overlay
            label="frequency"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet('the-frequency-sheet-breaks-the-coarse-pill-into-its-own-bands')}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'freq — neither a table nor a range',
        how: 'The empty arm. Worth opening beside the one above: an empty sheet has to read as "we do not have this" rather than as a sheet that failed to load.',
        render: () => (
          <Overlay
            label="frequency · empty"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet('with-neither-a-table-nor-a-range-the-frequency-sheet-is-empty')}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'hours — each day type its own first and last',
        how: 'The named day types the dataset carries. A mask that names none falls back to the generic word rather than printing a bitfield.',
        render: () => (
          <Overlay
            label="hours"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet('the-hours-sheet-gives-each-day-type-its-own-first-and-last')}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'hours — an unnamed mask named by its days',
        how: 'The kernel joins the subset of day names itself, separator and all — the RN sheet did that with a `.map().filter().join(" · ")`, which is three renderer decisions for one answer (ADR-054).',
        render: () => (
          <Overlay
            label="hours · unnamed mask"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet('an-unnamed-day-mask-is-named-by-the-days-it-runs')}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'stops — the overview, guesses marked',
        how: 'Stop count, journey time and distance, with `estimate` deciding which carry a `~`. The stop count is exact and the other two are not, and the sheet says so rather than presenting three equal figures.',
        render: () => (
          <Overlay
            label="overview"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet('the-overview-states-the-stop-count-the-journey-and-the-distance')}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
      {
        state: 'stops — a figure the dataset does not carry',
        how: 'The journey time is simply omitted rather than shown as a dash. A missing whole-route fact is not a fact with an unknown value.',
        render: () => (
          <Overlay
            label="overview · partial"
            sheet={(close) => (
              <RouteFactSheet
                sheet={factSheet('the-overview-omits-a-journey-time-the-dataset-does-not-carry')}
                locale={LOCALE}
                onClose={close}
              />
            )}
          />
        ),
      },
    ],
  },
  {
    component: 'RouteStopSheet',
    tier: 'overlay',
    spec: 'route-detail.spec.json declares the interaction; the sheet’s own content is asserted directly',
    note: '**The affordance that creates a favourite**, and the one `apps/web` did not have until WP6-7b: `toggleFavoriteRoute` had zero callers here, so the Favourites tab rendered a curated list a web-only rider could never add to. A tap on a stop row opens this rather than navigating — `conformStates` asserts text and nesting and **never interaction destinations**, so a declared interaction going somewhere else was invisible to the whole spec apparatus. Its times are `ArrivalSlot`’s, so the sheet and the row behind it read a time the same way.',
    samples: [
      {
        state: 'content — the two actions and this route’s times here',
        how: 'The tapped stop leads, because it is what the rider just touched; the route context is demoted to a quiet line, since the header behind the sheet is already liveried. The name is the **row’s own** — on native it used to be a second spelling of `displayName` eleven lines away.',
        render: () => (
          <Overlay
            label="open the stop sheet"
            sheet={(close) => (
              <RouteStopSheet
                row={stopRowWhere('a-saved-route-stars-only-the-pole-it-was-saved-at', 'saved')}
                routeId="KMB:264X:outbound:1"
                routeNo="264X"
                destination="Central"
                locale={LOCALE}
                arrivals={stopBoard('a-pole-board-answers-for-the-route-the-rider-tapped').arrivals}
                incomplete={false}
                loading={false}
                onClose={close}
                onViewStop={close}
              />
            )}
          />
        ),
      },
      {
        state: 'loading — the board is on its way',
        how: 'Its own arm, because "waiting" must never render as "nothing due". `routeStopBoard`’s `nothing-has-been-fetched-yet` case is the empty payload behind it.',
        render: () => (
          <Overlay
            label="stop sheet · loading"
            sheet={(close) => (
              <RouteStopSheet
                row={stopRowWhere('a-saved-route-stars-only-the-pole-it-was-saved-at', 'first')}
                routeId="KMB:264X:outbound:1"
                routeNo="264X"
                destination="Central"
                locale={LOCALE}
                arrivals={stopBoard('nothing-has-been-fetched-yet').arrivals}
                incomplete={false}
                loading
                onClose={close}
                onViewStop={close}
              />
            )}
          />
        ),
      },
      {
        state: 'incomplete — this kerb did not answer',
        how: 'Not the same as nothing being due (ADR-077). The golden is the `routeStopBoard` case that distinguishes them, and the sheet has to say which one this is.',
        render: () => (
          <Overlay
            label="stop sheet · incomplete"
            sheet={(close) => {
              const board = stopBoard(
                'a-pole-whose-board-did-not-answer-is-incomplete-rather-than-empty',
              )
              return (
                <RouteStopSheet
                  row={stopRowWhere('a-saved-route-stars-only-the-pole-it-was-saved-at', 'first')}
                  routeId="KMB:264X:outbound:1"
                  routeNo="264X"
                  destination="Central"
                  locale={LOCALE}
                  arrivals={board.arrivals}
                  incomplete={board.incomplete}
                  loading={false}
                  onClose={close}
                  onViewStop={close}
                />
              )
            }}
          />
        ),
      },
      {
        state: 'no route number — the quiet line drops',
        how: 'The route chip is optional on this sheet, and its absence must not leave a gap where a chip was. Reached from a context that has the row but not the number.',
        render: () => (
          <Overlay
            label="stop sheet · no route number"
            sheet={(close) => (
              <RouteStopSheet
                row={stopRowWhere('a-route-opened-from-a-stop-anchors-that-row', 'here')}
                routeId="KMB:264X:outbound:1"
                destination="Central"
                locale={LOCALE}
                arrivals={
                  stopBoard('a-single-reading-answers-the-question-that-was-asked').arrivals
                }
                incomplete={false}
                loading={false}
                onClose={close}
                onViewStop={close}
              />
            )}
          />
        ),
      },
    ],
  },
]

export const SAMPLES: readonly SampleGroup[] = [...LEAVES, ...COMPOSED, ...OVERLAYS]
