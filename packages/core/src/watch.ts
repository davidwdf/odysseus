import { etaView, type FeedNotice, type FeedTrouble, feedNotice, remarkView } from './eta'
import { walkMinutes } from './geo'
import { CLIENT_POLICY_DEFAULTS } from './policy'
import { type RouteStopArrival, routeStopBoard, routeStopEta } from './route-detail'
import { displayName, type StopCardName } from './stop-card'
import type { EtaReport, I18nText, Locale, OperatorId, ResolvedClientPolicy } from './types'

/**
 * **Watch a stop** — what the floating pill and its card are made of (`proposals/07`).
 *
 * A watch is *a favourite you are using right now*: the same route-at-stop pair a favourite is keyed on
 * (`formatFavoriteRouteKey`, ADR-042), pointed at the same narrowed live target the wire already
 * describes — `watch([{ stopId, routeIds: [routeId] }])` — and drawn somewhere that **outlives the screen
 * that created it**. So there is no new data shape here and no new id grammar; what is new is that one
 * reading is now drawn by an element with no screen of its own.
 *
 * That last part is the reason this module exists rather than a `useWatch` hook in each renderer. A
 * floating board has to answer, on its own, every question a screen answers: which arm it is in, whether
 * its figure is a sighting or a timetable, what its freshness sentence says, and whether it should be
 * there at all. Those are exactly the decisions ADR-068/069 keep out of views, and `check-no-derivation`
 * will hold both renderers to it.
 *
 * ## Three rules the design rounds settled, written here because a renderer must not re-decide them
 *
 *  1. **A sentence never lands in the figure slot.** In the *board failed* and *offline* arms the pill has
 *     something to say and no figure to say it with; putting the sentence where the figure goes squeezed
 *     the stop's name to *"Nathan Roa…"*, and the stop's name is **what you are watching**. So the readout
 *     goes absent and {@link WatchView.note} carries the sentence on the line below, where the destination
 *     usually is (`proposals/07` §4b).
 *  2. **No stop count.** *"2 stops away"* was drawn, liked, and withdrawn: HK stop spacing runs from about
 *     one minute to ten, so a count of stops is not a duration, and beside a figure that *is* one it will
 *     be read as one (§4c). Nothing in this view reports distance in stops.
 *  3. **The arms are ordered, and the order is ADR-088's**: pending → unavailable → reading → noService.
 *     A board on its way must never render as *nothing due*, and a board that refused us is not an empty
 *     one (ADR-073/077).
 *
 * ## What is deliberately *not* here
 *
 * **Where the pill is drawn.** The owner's answer is that it floats above Route detail's map sheet and is
 * covered by modal action sheets — that is z-order and layout, which is each renderer's, from one shared
 * constant (`shell/layout.ts`). A kernel that returned a position would be deciding idiom.
 */

/**
 * The persisted watch — what a rider made, as it is written to `nextbus.preferences`.
 *
 * **The labels are captured, not looked up.** A pill has to draw on the first frame of any screen, with no
 * fetch and possibly with no network at all, so the names travel with the watch. They are `I18nText`
 * because the rider may change language while watching (CLAUDE.md rule 5), and they are *stale by design*:
 * a stop renamed upstream keeps the name the rider saw until they make the watch again. That is the honest
 * trade for a pill that never renders empty.
 */
export interface WatchRecord {
  /** The **raw** pole id — the key a favourite is saved under (ADR-042), and the live target's `stopId`. */
  poleId: string
  routeId: string
  /** The printed route number, as the badge draws it. */
  routeNo: string
  operator: OperatorId
  /** The pole's name as the rider saw it, upstream punctuation and all — `displayName` splits it here. */
  stop: I18nText
  /** Where this route is going, so two directions at one kerb can be told apart. */
  destination: I18nText
  /**
   * The pole's disambiguation line where the creating screen had one — *"Stand B · towards Mong Kok"*
   * (ADR-080). Optional because a single-pole stop has nothing to disambiguate from.
   */
  stand?: I18nText
  /** When the rider started watching. Never displayed; kept so a watch can be aged in a log or a test. */
  startedIso: string
  /**
   * When the **rider** last touched it — created it, opened the card, or acted on it.
   *
   * Rider activity, emphatically not data activity: a watch holds an open subscription, so a round landing
   * would refresh this every cadence and the watch would never expire at all. That is the bug this comment
   * exists to prevent, and it is the whole content of {@link watchExpired}.
   */
  touchedIso: string
}

/**
 * How long a watch outlives the rider's last touch — **90 minutes** (`proposals/07` §5.2, owner's pick).
 *
 * A watch is about a journey. Session-only loses it when an iOS PWA is backgrounded for a minute; forever
 * makes it a worse favourite; 90 minutes of *inactivity* is the shape of a trip plus a delay, after which
 * a pill on screen is chrome nobody asked for — and, less visibly, a subscription nobody asked for.
 */
export const WATCH_TTL_MS = 90 * 60 * 1000

/**
 * Has this watch outlived its rider's attention?
 *
 * **An unreadable `touchedIso` expires.** The alternative is a watch that can never be cleared by time,
 * held open by a timestamp nobody can parse — a stuck subscription and a pill that outlives its journey.
 * Losing a watch costs one tap; the other failure costs a rider their screen until they find the control.
 *
 * @spec watch#watchExpired
 */
export function watchExpired(
  watch: WatchRecord,
  now: number,
  ttlMs: number = WATCH_TTL_MS,
): boolean {
  const touched = Date.parse(watch.touchedIso)
  if (Number.isNaN(touched)) return true
  return now - touched > ttlMs
}

/** What the pill's figure slot shows — a reading, or a reason there is none. See rule 1 and rule 3. */
export type WatchReadout =
  /** No round has landed yet. A skeleton, never a dash: waiting is not an answer (ADR-088). */
  | { kind: 'pending' }
  /** Times, in board order. `lead` is the pill's figure; `rest` is what the card adds. */
  | { kind: 'reading'; lead: RouteStopArrival; rest: RouteStopArrival[] }
  /** This pole's board refused us. Not an empty board (ADR-073/077). */
  | { kind: 'unavailable' }
  /** We asked, we were answered, and nothing is due. The only arm that may say so. */
  | { kind: 'noService' }

/**
 * **The pill's second line, which always says exactly one thing.**
 *
 * `destination` is a kind rather than the absence of one, and that is deliberate on both sides of the
 * seam. For a renderer it removes a fallback: there is no *"if there is no note, show the destination
 * instead"* for two of them to implement differently. For a spec it is the difference between a
 * checkable claim and an unwritable one — `oneOf` over a discriminant that is sometimes `null` has no
 * case to select, and the format treats an unmatched value as a hard failure (by design).
 *
 * `tone` names a meaning and never a colour — the same split `etaUrgency` makes, so each renderer maps it
 * with its own tokens (ADR-053). `warn` is *something is wrong with the data*; `muted` is *this is true and
 * unremarkable*.
 */
export interface WatchSubLine {
  kind: 'destination' | 'offline' | 'unavailable' | 'noService' | 'scheduled'
  tone: 'warn' | 'muted'
}

/**
 * When to leave to catch the lead bus — `proposals/00`'s P13, which a watched stop is what finally makes
 * answerable.
 *
 * Minutes, both of them, because the inputs are minutes: `walkMinutes` is a straight-line estimate at a
 * fixed pace and the arrival is honest to the minute (ADR-008). `leaveInMin` is never negative — a bus that
 * cannot be caught produces no {@link WatchLeave} at all rather than a zero, so *leave now* means what it
 * says.
 */
export interface WatchLeave {
  walkMin: number
  leaveInMin: number
}

/** Everything the pill and its card draw, with nothing left for a renderer to decide. */
export interface WatchView {
  routeNo: string
  operator: OperatorId
  /** Split by `displayName`, so the pill and every stop card in the app spell one pole the same way. */
  stop: StopCardName
  /** The far end, in the rider's language — what `subLine.kind === 'destination'` draws. */
  destination: string
  /** ADR-080's *which kerb* sentence, or `null`. The card's line; never the pill's. */
  stand: string | null
  readout: WatchReadout
  subLine: WatchSubLine
  /** Every time this board carries, for the card. Empty in every arm but `reading`. */
  arrivals: RouteStopArrival[]
  /** The card's freshness sentence — `feedNotice`'s, exactly as four screens already say it (ADR-133). */
  notice: FeedNotice
  leave: WatchLeave | null
  /** The board this pill drew from, for the screen that wants to age it. `null` when it drew none. */
  lastUpdatedIso: string | null
  /**
   * The screen underneath is already showing this very board.
   *
   * Reported rather than acted on, because *what to do about it* is layout: hide, or shrink to a badge and
   * a figure. What must not happen is each renderer deciding **whether** it is redundant, which is a
   * comparison of ids and therefore a derivation (`check-no-derivation`).
   */
  redundant: boolean
}

/** What `watchView` needs: the watch, the round, the clock, and three facts about the platform. */
export interface WatchViewInput {
  watch: WatchRecord
  /** This pole's board from the live round, or `undefined` before the first frame has landed. */
  report: EtaReport | undefined
  now: number
  locale: Locale
  /** Whether the platform believes it has a network — handed in like a clock (ADR-051). */
  online: boolean
  /** How the last attempt on **our** edge failed. An upstream board's refusal is not one of these. */
  trouble: FeedTrouble
  /** Straight-line metres from the rider to the pole, where there is a fix. Absent = no fix. */
  distanceM?: number
  /** What the screen under the pill is already drawing, if it knows. */
  showing?: { poleId?: string; routeId?: string }
  policy?: ResolvedClientPolicy
}

/**
 * Compose the watch pill and its card.
 *
 * The joins are the point — every word below already exists and is already pinned by a corpus
 * (`routeStopBoard`, `routeStopEta`, `remarkView`, `feedNotice`, `walkMinutes`, `displayName`), and this
 * function's job is to put them in one order that both renderers and both future native suites share. It
 * derives no time and formats no figure of its own. That is ADR-054's rule: the words are injected, not
 * re-invented.
 *
 * **The sub-line's precedence, which is the only genuinely new decision here:** offline first, because a
 * rider whose network is gone needs to know that before anything else it might explain; then the board's
 * own refusal; then *nothing due*, which is only reachable once we have been answered; then the honesty
 * cue that the lead figure is a **timetable rather than a sighting**; and, when none of those is true, the
 * destination. A pill with room for one line must say the most actionable true thing, and this is that
 * order.

 * **The card says its own freshness sentence and not this one.** `subLine` is what the *collapsed* pill
 * carries; {@link WatchView.notice} is `feedNotice`'s, which every other board-bearing screen already
 * draws (ADR-133/150). Two spellings of *offline* would otherwise appear in one open card, which is the
 * per-screen duplication ADR-123 took out of the arrival rows.
 *
 * @spec watch#watchView
 */
export function watchView(input: WatchViewInput): WatchView {
  const policy = input.policy ?? CLIENT_POLICY_DEFAULTS
  const { watch, report, now, locale } = input

  const board = routeStopBoard(report, {
    poleId: watch.poleId,
    routeId: watch.routeId,
    now,
    locale,
    policy,
  })
  const eta = routeStopEta(report, { poleId: watch.poleId, routeId: watch.routeId })

  // ADR-088's order, and each arm is reached only when the one above it is ruled out.
  const readout: WatchReadout =
    report === undefined
      ? { kind: 'pending' }
      : board.incomplete
        ? { kind: 'unavailable' }
        : board.arrivals.length > 0
          ? // `as RouteStopArrival` is safe by the length test one line up, and the alternative — an
            // optional lead the renderer must null-check — would put the empty case back into the arm
            // whose whole purpose is that it has readings.
            {
              kind: 'reading',
              lead: board.arrivals[0] as RouteStopArrival,
              rest: board.arrivals.slice(1),
            }
          : { kind: 'noService' }

  const remark = remarkView(eta?.remark, locale, eta?.remarkKind)
  const subLine: WatchSubLine = !input.online
    ? { kind: 'offline', tone: 'warn' }
    : readout.kind === 'unavailable'
      ? { kind: 'unavailable', tone: 'warn' }
      : readout.kind === 'noService'
        ? { kind: 'noService', tone: 'muted' }
        : readout.kind === 'reading' && remark?.kind === 'scheduled'
          ? { kind: 'scheduled', tone: 'muted' }
          : { kind: 'destination', tone: 'muted' }

  const lastUpdatedIso = eta?.dataTimestamp ?? null

  return {
    routeNo: watch.routeNo,
    operator: watch.operator,
    stop: displayName(watch.stop[locale]),
    destination: watch.destination[locale],
    stand: watch.stand ? watch.stand[locale] : null,
    readout,
    subLine,
    arrivals: board.arrivals,
    notice: feedNotice({
      lastUpdatedIso,
      now,
      online: input.online,
      trouble: input.trouble,
      staleAfterMs: policy.staleAfterMs,
    }),
    leave: leaveFor(readout, input.distanceM, now),
    lastUpdatedIso,
    // A watch narrows to one route, so a screen showing the *place* is showing this board only if it is
    // showing this route too — but a screen that names no route (a place board) shows every route at that
    // pole, which includes this one. Hence: the pole must match, and the route must match *or be unstated*.
    redundant:
      input.showing?.poleId === watch.poleId &&
      (input.showing?.routeId === undefined || input.showing.routeId === watch.routeId),
  }
}

/**
 * *"Leave in N min"*, or nothing at all.
 *
 * Three ways to get nothing, and each is a refusal to fabricate: no fix (we do not know where the rider
 * is), no reading (there is nothing to leave *for*), and a bus that cannot be caught (see below — the one
 * that would otherwise tell a rider they can still make a bus already at the kerb).
 */
function leaveFor(
  readout: WatchReadout,
  distanceM: number | undefined,
  now: number,
): WatchLeave | null {
  if (distanceM === undefined || readout.kind !== 'reading') return null
  // `etaView` rather than arithmetic of our own: it is the function the printed figure is built from, so
  // the pill's "3 min" and this sentence's subtraction cannot disagree at a boundary — and it is where
  // an unreadable timestamp is already turned into `hasDeparted` rather than a NaN (ADR-142).
  // **No guard for an unreadable arrival, and that is a fact about the caller rather than an oversight.**
  // Every arrival in a `reading` came through `upcoming`, which drops anything `etaView` calls departed —
  // and an unparsable timestamp is exactly what ADR-142 makes departed. A `hasDeparted` arm here would be
  // dead code, and this repo has already paid for one of those (ADR-155's 87 % branch coverage).
  const { minutes } = etaView(readout.lead.iso, now)
  const walkMin = walkMinutes(distanceM)
  const leaveInMin = minutes - walkMin
  // **Negative means you cannot make this one, and the honest answer is silence.** Flooring at zero would
  // print *"leave now"* to a rider four minutes from a kerb the bus reaches in one — a false reassurance,
  // which is the same failure ADR-008 rules out for a fabricated countdown. Zero itself is kept and does
  // mean *leave now*: it is the case where the walk exactly fills the wait. `Due` and `departed` fall out
  // of this arithmetic rather than needing an arm of their own — their `minutes` is 0 and the walk floor
  // is 1, so the line is absent for both.
  return leaveInMin < 0 ? null : { walkMin, leaveInMin }
}
