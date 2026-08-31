import type { ConcessionClass, Locale, RouteFactSheetView, RouteStatKind } from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { Baby, Clock, type LucideIcon, MapPin, Ruler } from 'lucide-react'
import { JoyYouCard } from '../icons'
import { BottomSheet } from './BottomSheet'

/**
 * The detail behind a static-fact pill (ADR-044) — the DOM twin of
 * `apps/mobile/components/RouteFactSheets.tsx`, and a pure projection of `routeFactSheet`.
 *
 * The **content** is the kernel's: the fare stages and where you board for each, the concession estimates
 * with the `~` that marks them as estimates, the band headways, the per-day-type hours, the whole-route
 * figures and which of them are guesses (WP6-6c). What is this file's is the four glyph tables — *which
 * concept each glyph denotes* is identity and *the set* is idiom (ADR-075) — and the container.
 *
 * ## The container is the shared `BottomSheet`
 *
 * This file used to carry its own centred `<dialog>` and argue for it at length — focus trapping, `Escape`,
 * an inert backdrop, and no dismiss-on-backdrop-click because an `onClick` on a `<dialog>` is a handler on a
 * non-interactive element. ADR-100 moves the sheet to the identity side and `components/BottomSheet.tsx` is
 * the twin of `apps/mobile`'s, with the two-stage entrance and drag-to-dismiss.
 *
 * **Every property that old argument was really about survives**, which is why this is not a trade: the
 * container is still a `<dialog>` opened with `showModal()`, so focus trapping, `Escape` and inertness come
 * along unchanged. The backdrop objection is answered rather than suppressed — the dim is a real `<button>`
 * sibling of the panel, so it has keyboard activation by construction and Biome's `useKeyWithClickEvents`
 * has nothing to say about it.
 */
export function RouteFactSheet({
  sheet,
  locale,
  onClose,
}: {
  sheet: RouteFactSheetView
  locale: Locale
  onClose: () => void
}) {
  // The `showModal()` call, the focus capture and the focus-restore-on-unmount all moved into
  // `BottomSheet` — they were identical in both sheets, and the restore in particular is the kind of thing
  // that is right in one copy and forgotten in the second.
  return (
    <BottomSheet
      titleId={TITLE_ID}
      onClose={onClose}
      header={
        <h2 id={TITLE_ID} className="m-0 pb-2 text-h3 font-semibold text-text">
          {t(locale, TITLE[sheet.kind])}
        </h2>
      }
    >
      <div className="max-h-[62vh] overflow-y-auto px-3 pt-1 pb-4">
        {sheet.kind === 'fare' ? (
          <FareBody sheet={sheet} locale={locale} />
        ) : sheet.kind === 'freq' ? (
          <FreqBody sheet={sheet} locale={locale} />
        ) : sheet.kind === 'hours' ? (
          <HoursBody sheet={sheet} locale={locale} />
        ) : (
          <OverviewBody sheet={sheet} locale={locale} />
        )}
      </div>
    </BottomSheet>
  )
}

/** Each sheet's heading. Static chrome, so it is a catalogue read rather than an injected label. */
const TITLE = {
  fare: 'fareTitle',
  freq: 'freqTitle',
  hours: 'hoursTitle',
  stops: 'overviewTitle',
} as const

/** The heading's id, wired to the dialog's `aria-labelledby`. Static because only one sheet is ever open. */
const TITLE_ID = 'route-fact-sheet-title'

/** Which glyph denotes each concept — the same four concepts the RN sheet draws, from the web icon set. */
const STAT_GLYPH: Record<RouteStatKind, LucideIcon> = {
  stops: MapPin,
  journey: Clock,
  distance: Ruler,
}
/**
 * `elderly` is drawn as the **card**, not as lucide's `Accessibility`, which is what it used to be.
 * That glyph is a wheelchair, and it names the smaller half of who the Scheme is for — most
 * beneficiaries are 60+ rather than disabled, so it told them the figure beside it was not theirs.
 * See `icons/index.ts`.
 */
const CONCESSION_GLYPH: Record<ConcessionClass, LucideIcon> = {
  child: Baby,
  elderly: JoyYouCard,
}
const STAT_LABEL = {
  stops: 'stopsOnRoute',
  journey: 'overviewJourney',
  distance: 'overviewDistance',
} as const
const STAT_NOTE = { journey: 'overviewJourneyNote', distance: 'overviewDistanceNote' } as const
const CONCESSION_LABEL = { child: 'fareChild', elderly: 'fareElderly' } as const
const CONCESSION_NOTE = { child: 'fareChildNote', elderly: 'fareElderlyNote' } as const

function OverviewBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'stops' }>
  locale: Locale
}) {
  return (
    <div className="flex flex-col gap-4">
      {sheet.stats.map((stat) => {
        const Glyph = STAT_GLYPH[stat.stat]
        return (
          <div key={stat.stat} className="flex items-start gap-3">
            <Glyph size={18} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body text-text">{t(locale, STAT_LABEL[stat.stat])}</span>
                <span className="text-body font-medium text-text tabular-nums">{stat.value}</span>
              </div>
              {/* Shown where the kernel marks the figure an estimate (`stat.estimate`, ADR-008); the
                  `!== 'stops'` only narrows the note lookup, which has a sentence for journey and distance. */}
              {stat.estimate && stat.stat !== 'stops' ? (
                <p className="m-0 text-caption text-subtle">{t(locale, STAT_NOTE[stat.stat])}</p>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FareBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'fare' }>
  locale: Locale
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-caption text-subtle">{t(locale, 'fareSectionalNote')}</p>

      <div>
        {sheet.stages.map((stage, i) => (
          <div key={stage.fromSeq} className="flex gap-3">
            {/* The timeline's own rail: a dot per price, a connector to the next. */}
            <span className="flex w-3 shrink-0 flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
              {i < sheet.stages.length - 1 ? <span className="w-0.5 flex-1 bg-border" /> : null}
            </span>
            <div className="min-w-0 flex-1 pb-4">
              <div className="flex items-center gap-5">
                <span className="text-body font-medium text-text tabular-nums">{stage.fare}</span>
                {stage.concessions.map((figure) => {
                  const Glyph = CONCESSION_GLYPH[figure.class]
                  return (
                    <span key={figure.class} className="flex items-center gap-1.5">
                      <Glyph size={16} className="shrink-0 text-muted" aria-hidden />
                      <span className="text-body text-muted tabular-nums">{figure.fare}</span>
                    </span>
                  )
                })}
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 text-caption text-muted">{stage.boardingStop}</span>
                <span className="shrink-0 text-caption text-subtle tabular-nums">
                  {stage.covers}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The legend, for exactly the classes that appear above — never one that does not. */}
      {sheet.concessions.length > 0 ? (
        <div className="flex flex-col gap-3 border-border border-t pt-4">
          <p className="m-0 text-label text-text">{t(locale, 'concessionsTitle')}</p>
          {sheet.concessions.map((klass) => {
            const Glyph = CONCESSION_GLYPH[klass]
            return (
              <div key={klass} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Glyph size={20} className="text-text" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-body text-text">{t(locale, CONCESSION_LABEL[klass])}</p>
                  <p className="m-0 text-caption text-subtle">
                    {t(locale, CONCESSION_NOTE[klass])}
                  </p>
                </div>
              </div>
            )
          })}
          <p className="m-0 text-caption text-subtle">{t(locale, 'concessionsNote')}</p>
        </div>
      ) : null}
    </div>
  )
}

function FreqBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'freq' }>
  locale: Locale
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-caption text-subtle">{t(locale, 'freqNote')}</p>
      {sheet.days.map((day) => (
        <div key={day.day} className="flex flex-col gap-1.5">
          <p className="m-0 text-label text-text">{day.day}</p>
          {day.bands.map((band) => (
            <div key={band.hours} className="flex items-baseline justify-between gap-3 py-0.5">
              <span className="text-caption text-muted tabular-nums">{band.hours}</span>
              <span className="text-caption text-text tabular-nums">{band.headway}</span>
            </div>
          ))}
        </div>
      ))}
      {sheet.headway ? (
        <p className="m-0 text-body text-text tabular-nums">{sheet.headway}</p>
      ) : null}
    </div>
  )
}

function HoursBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'hours' }>
  locale: Locale
}) {
  return (
    <div className="flex flex-col gap-3">
      {sheet.days.map((day) => (
        <div key={day.day} className="flex items-center justify-between gap-3">
          <span className="text-body text-text">{day.day}</span>
          <span className="flex gap-5">
            <LabelledTime label={t(locale, 'firstBus')} time={day.first} />
            <LabelledTime label={t(locale, 'lastBus')} time={day.last} />
          </span>
        </div>
      ))}
      {sheet.span ? <p className="m-0 text-body text-text tabular-nums">{sheet.span}</p> : null}
    </div>
  )
}

/** A small stacked label + 24h time (e.g. "First / 05:35"). */
function LabelledTime({ label, time }: { label: string; time: string }) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-caption text-subtle">{label}</span>
      <span className="text-body text-text tabular-nums">{time}</span>
    </span>
  )
}
