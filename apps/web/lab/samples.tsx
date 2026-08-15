import type { FeedNotice as FeedNoticeView, PlaceRouteRow, StopCardView } from '@nextbus/core'
import { CLIENT_POLICY_DEFAULTS, feedNotice } from '@nextbus/core'
import stopCardCorpus from '@nextbus/core/spec/stop-card.spec.json'
import stopDetailCorpus from '@nextbus/core/spec/stop-detail.spec.json'
import type { ReactNode } from 'react'
import { FeedNotice } from '../src/components/FeedNotice'
import { PlaceRow } from '../src/components/PlaceRow'
import { StopCard } from '../src/components/StopCard'

/**
 * **The gallery's live samples: one component, several states, side by side** (ADR-134's *"still owed"*,
 * paid by ADR-150's own review request).
 *
 * ## Why the states come from the corpus and the kernel, never from a hand-written object
 *
 * A sample is only worth reviewing if it is the thing the app draws. Every card below is either a **corpus
 * golden** — the exact `expect` a conformance suite replays, converted `null` → `undefined` at the boundary
 * the way `corpus.ts` does — or the output of the **kernel call the screen makes**, with the inputs written
 * beside it. So a rule change moves these pictures, and a state that stopped being reachable takes its case
 * name with it: `caseNamed` throws rather than rendering something plausible, and
 * `test/gallery-samples.test.tsx` runs every sample so that throw is a red build rather than a blank panel
 * somebody finds later.
 *
 * ## What "several states" is for
 *
 * The owner's ask, and it is the review that a page of prose cannot support: *is this set of sentences
 * consistent?* A notice you meet one screen at a time reads fine four different ways. Seen together, the
 * register has to hold — which is exactly the `docs/07` row about reviewing the app's error and placeholder
 * texts **as a set**.
 *
 * ## What is deliberately not here
 *
 * Whole screens. Ten components take ten sets of props and a screen takes a router, a query client and a
 * location fix; mounting those here would be a second app. The leaf components are the ones a native porter
 * copies, and the screens are one click away in the running app.
 */

/** One reviewable state of one component. */
export interface Sample {
  /** The spec state (or kernel arm) this is — the name to look up in the listing below. */
  state: string
  /** How the app gets here, in one line: the inputs, not the styling. */
  how: string
  render: () => ReactNode
}

export interface SampleGroup {
  component: string
  /** Where the declaration lives, so a reviewer can go from a picture to the contract. */
  spec: string
  note: string
  samples: readonly Sample[]
}

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

interface CorpusCase {
  name: string
  expect: unknown
}

/** Throws rather than rendering a plausible substitute: a renamed case must be loud. */
function caseNamed(cases: readonly CorpusCase[], name: string): CorpusCase {
  const found = cases.find((c) => c.name === name)
  if (!found)
    throw new Error(`the corpus case \`${name}\` moved — the gallery sample points at nothing`)
  return found
}

const STOP_CARD_CASES = stopCardCorpus.groups.stopCardView.cases as unknown as CorpusCase[]
const PLACE_CASES = stopDetailCorpus.groups.placeDetailView.cases as unknown as CorpusCase[]

function card(name: string): StopCardView {
  return fromCorpus<StopCardView>(caseNamed(STOP_CARD_CASES, name).expect)
}

/**
 * The first row of a place case, flat list or first kerb — the level a `PlaceRow` is drawn at.
 *
 * `placeDetailView` puts rows in exactly one of `rows` and `groups`, never both (a corpus property), so
 * looking in both is reading the shape rather than guessing at it.
 */
function placeRow(name: string, index = 0): PlaceRouteRow {
  const expect = fromCorpus<{
    rows: PlaceRouteRow[]
    groups: { rows: PlaceRouteRow[] }[]
  }>(caseNamed(PLACE_CASES, name).expect)
  const rows = expect.rows.length > 0 ? expect.rows : (expect.groups[0]?.rows ?? [])
  const row = rows[index]
  if (!row) throw new Error(`the corpus case \`${name}\` no longer has a row ${index} to draw`)
  return row
}

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

export const SAMPLES: readonly SampleGroup[] = [
  {
    component: 'FeedNotice',
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
    component: 'StopRow',
    spec: 'packages/contract/ui/stop-row.spec.json',
    note: 'The compact card Nearby and Favourites are lists of. Every sample is a corpus golden — the same bytes both renderers’ conformance suites replay.',
    samples: [
      {
        state: 'content',
        how: 'A place whose boards all answered: `stopCardView` over a merged five-pole place, capped at the served `maxRows` with the honest count of what is hidden — never a silent filter (ADR-008).',
        render: () => (
          <StopCard view={card('a-card-with-every-board-answering-is-complete')} locale="en" />
        ),
      },
      {
        state: 'urgency bands',
        how: 'One card carrying a reading at every boundary of the served bands — due, soon, normal — so the three tones can be compared against each other rather than one screen at a time. The thresholds are the edge’s (`ClientPolicy`), never a literal in a component.',
        render: () => <StopCard view={card('the-urgency-bands-at-every-boundary')} locale="en" />,
      },
      {
        state: 'incomplete',
        how: 'One kerb of the place refused us. The rows are unchanged and the card says so — “no buses” and “nobody would tell us” are different facts (ADR-073, ADR-077).',
        render: () => (
          <StopCard
            view={card('one-refusing-kerb-makes-the-card-incomplete-without-changing-its-rows')}
            locale="en"
          />
        ),
      },
      {
        state: 'empty',
        how: 'A place with no live readings at all, which still says how many routes serve it.',
        render: () => (
          <StopCard
            view={card('a-place-with-no-live-readings-still-says-how-many-routes-it-has')}
            locale="en"
          />
        ),
      },
      {
        state: 'departed',
        how: 'A board that answered with no arrivals: an em dash, because the reading exists and names a moment already past. Inventing “gone” would be a claim the feed did not make.',
        render: () => (
          <StopCard view={card('a-reading-with-no-arrivals-is-departed-not-absent')} locale="en" />
        ),
      },
      {
        state: 'remarked',
        how: 'An operator remark beside a destination becomes its own line — the wording carries the honesty cue, never a colour (ADR-036).',
        render: () => (
          <StopCard view={card('a-remark-beside-a-destination-becomes-its-own-line')} locale="en" />
        ),
      },
    ],
  },
  {
    component: 'PlaceRow',
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
    ],
  },
]
