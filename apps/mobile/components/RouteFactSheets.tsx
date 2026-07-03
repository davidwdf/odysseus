import {
  estimateChildFare,
  estimateElderlyFare,
  type FreqPattern,
  fareStages,
  formatDistance,
  formatFare,
  formatHeadway,
  formatJourney,
  formatServiceHours,
  formatStopCount,
  type Locale,
  type RouteServiceInfo,
} from '@nextbus/core'
import { t } from '@nextbus/i18n'
import { Accessibility, Baby, Clock, type LucideIcon, MapPin, Ruler } from 'lucide-react-native'
import { ScrollView, useWindowDimensions, View } from 'react-native'
import { BottomSheet } from './BottomSheet'
import { Icon } from './Icon'
import { Text } from './Text'

/** Which badge opened the sheet: fare / frequency / service hours, or the stop-count badge
 *  (`stops`) → a whole-route overview (stops · journey · distance). */
export type FactKind = 'fare' | 'freq' | 'hours' | 'stops'

/** A single stop as the fact sheets need it — sequence, display name, boarding fare. */
export interface FactStop {
  seq: number
  name: string
  fare?: string
}

/**
 * The tap-to-expand detail behind a `RouteMeta` badge (ADR-044): the fare-stage timeline +
 * concession estimates, the per-day-type frequency breakdown, or the first/last service hours.
 * A thin `BottomSheet` wrapper switching on `kind`; all three read the same route facts the
 * strip already has. Rendered as a screen-level overlay by the route detail (like the stop
 * action sheet), never from inside the scroll content.
 */
export function RouteFactSheet({
  kind,
  service,
  stops,
  distanceM,
  locale,
  onClose,
}: {
  kind: FactKind
  service?: RouteServiceInfo
  stops: FactStop[]
  /** Straight-line-through-stops route distance (metres) for the overview sheet; 0 hides it. */
  distanceM?: number
  locale: Locale
  onClose: () => void
}) {
  const { height } = useWindowDimensions()
  const title = t(
    locale,
    kind === 'fare'
      ? 'fareTitle'
      : kind === 'freq'
        ? 'freqTitle'
        : kind === 'hours'
          ? 'hoursTitle'
          : 'overviewTitle',
  )
  return (
    <BottomSheet
      closeLabel={t(locale, 'back')}
      onClose={onClose}
      header={
        <Text variant="h3" className="text-text">
          {title}
        </Text>
      }
    >
      {/* Cap the body and let it scroll — a weekday+Sat+Sun frequency table can be tall. The
          drag handle lives above this (its own gesture), so this scroll doesn't fight dismiss. */}
      <ScrollView style={{ maxHeight: height * 0.62 }} showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-1 pb-3">
          {kind === 'fare' ? (
            <FareBody stops={stops} locale={locale} />
          ) : kind === 'freq' ? (
            <FreqBody service={service} locale={locale} />
          ) : kind === 'hours' ? (
            <HoursBody service={service} locale={locale} />
          ) : (
            <OverviewBody
              stopCount={stops.length}
              journeyMin={service?.journeyMin}
              distanceM={distanceM ?? 0}
              locale={locale}
            />
          )}
        </View>
      </ScrollView>
    </BottomSheet>
  )
}

/** Whole-route stats behind the stop-count badge: stops · full journey time · route distance.
 *  Journey time is real (dataset `jt`); distance is a straight-line-through-stops estimate — both
 *  shown plainly as the Static tier, distance explicitly approximate (ADR-044). Origin/destination
 *  are deliberately omitted — they already head the screen. */
function OverviewBody({
  stopCount,
  journeyMin,
  distanceM,
  locale,
}: {
  stopCount: number
  journeyMin?: number
  distanceM: number
  locale: Locale
}) {
  return (
    <View className="gap-3.5">
      <StatRow icon={MapPin} label={t(locale, 'stopsOnRoute')} value={String(stopCount)} />
      {journeyMin ? (
        <StatRow
          icon={Clock}
          label={t(locale, 'overviewJourney')}
          value={formatJourney(journeyMin, locale)}
          note={t(locale, 'overviewJourneyNote')}
        />
      ) : null}
      {distanceM > 0 ? (
        <StatRow
          icon={Ruler}
          label={t(locale, 'overviewDistance')}
          value={`~${formatDistance(distanceM)}`}
          note={t(locale, 'overviewDistanceNote')}
        />
      ) : null}
    </View>
  )
}

/** One overview stat: leading icon, label, right-aligned value, and an optional honesty note. */
function StatRow({
  icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon
  label: string
  value: string
  note?: string
}) {
  return (
    <View className="flex-row items-start gap-3">
      <View style={{ marginTop: 2 }}>
        <Icon icon={icon} tone="subtle" size={18} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-baseline justify-between gap-3">
          <Text variant="body" className="text-text">
            {label}
          </Text>
          <Text variant="body" weight="medium" tabular className="text-text">
            {value}
          </Text>
        </View>
        {note ? (
          <Text variant="caption" className="text-subtle">
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/**
 * Fare-stage timeline: where the sectional fare steps down, dearest (origin) first. Each stage row
 * carries the adult fare and — on the same line — the child (`Baby`) and elderly/disabled
 * (`Accessibility`) estimates, closed by an `Info` glyph → the concession legend + disclaimer below
 * (ADR-044). Concessions are policy-derived, never route data — always shown as labelled estimates.
 */
function FareBody({ stops, locale }: { stops: FactStop[]; locale: Locale }) {
  const fares = stops.map((s) => s.fare)
  const stages = fareStages(fares)
  const nameForSeq = (seq: number) => stops.find((s) => s.seq === seq)?.name ?? ''
  const hasConcessions = stages.some(
    (st) => estimateChildFare(st.fare) && estimateElderlyFare(st.fare),
  )

  return (
    <View className="gap-4">
      <Text variant="caption" className="text-subtle">
        {t(locale, 'fareSectionalNote')}
      </Text>

      <View>
        {stages.map((st, i) => {
          const child = estimateChildFare(st.fare)
          const elderly = estimateElderlyFare(st.fare)
          return (
            <View key={st.fromSeq} className="flex-row gap-3">
              <View className="items-center" style={{ width: 12 }}>
                <View
                  className="rounded-full bg-accent"
                  style={{ width: 10, height: 10, marginTop: 5 }}
                />
                {i < stages.length - 1 ? <View className="w-0.5 flex-1 bg-border" /> : null}
              </View>
              <View className="flex-1 pb-4">
                {/* Fares on one line — adult, then the child & elderly estimates at near-equal
                    prominence, widely spaced so each reads as its own figure. */}
                <View className="flex-row items-center gap-5">
                  <Text variant="body" weight="medium" tabular className="text-text">
                    {formatFare(st.fare)}
                  </Text>
                  {child && elderly ? (
                    <>
                      <ConcessionFare icon={Baby} value={child} />
                      <ConcessionFare icon={Accessibility} value={elderly} />
                    </>
                  ) : null}
                </View>
                {/* Boarding stop for this price + how many stops the price covers. */}
                <View className="mt-0.5 flex-row items-baseline justify-between gap-2">
                  <Text variant="caption" className="flex-1 text-muted" numberOfLines={2}>
                    {nameForSeq(st.fromSeq)}
                  </Text>
                  <Text variant="caption" tabular className="shrink-0 text-subtle">
                    {formatStopCount(st.toSeq - st.fromSeq + 1, locale)}
                  </Text>
                </View>
              </View>
            </View>
          )
        })}
      </View>

      {/* Legend + estimate disclaimer — what the icons mean and why they carry the info marker. */}
      {hasConcessions ? (
        <View className="gap-3 border-border border-t pt-4">
          <Text variant="label" className="text-text">
            {t(locale, 'concessionsTitle')}
          </Text>
          <ConcessionLegend
            icon={Baby}
            label={t(locale, 'fareChild')}
            note={t(locale, 'fareChildNote')}
          />
          <ConcessionLegend
            icon={Accessibility}
            label={t(locale, 'fareElderly')}
            note={t(locale, 'fareElderlyNote')}
          />
          <Text variant="caption" className="text-subtle">
            {t(locale, 'concessionsNote')}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/** A single concession estimate on a timeline stage: its icon + the "~$X" figure. Rendered at
 *  body size (near the adult fare's prominence), just a step quieter in tone since it's an estimate. */
function ConcessionFare({ icon, value }: { icon: LucideIcon; value: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon icon={icon} tone="muted" size={16} />
      <Text variant="body" tabular className="text-muted">
        ~{formatFare(value)}
      </Text>
    </View>
  )
}

/** A legend row keying a concession icon to its passenger class + how the estimate is derived. The
 *  icon sits in a filled disc so it reads as a prominent key, matching the glyph used on the timeline. */
function ConcessionLegend({
  icon,
  label,
  note,
}: {
  icon: LucideIcon
  label: string
  note: string
}) {
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="items-center justify-center rounded-full bg-surface-2"
        style={{ width: 36, height: 36 }}
      >
        <Icon icon={icon} tone="text" size={20} />
      </View>
      <View className="flex-1">
        <Text variant="body" className="text-text">
          {label}
        </Text>
        <Text variant="caption" className="text-subtle">
          {note}
        </Text>
      </View>
    </View>
  )
}

/** Per-day-type frequency breakdown (the peak/off-peak bands behind the coarse badge range). */
function FreqBody({ service, locale }: { service?: RouteServiceInfo; locale: Locale }) {
  const patterns = service?.patterns
  return (
    <View className="gap-4">
      <Text variant="caption" className="text-subtle">
        {t(locale, 'freqNote')}
      </Text>
      {patterns?.length ? (
        patterns.map((p) => (
          <View key={p.dayType + p.first} className="gap-1.5">
            <Text variant="label" className="text-text">
              {dayLabel(p, locale)}
            </Text>
            {p.bands.map((b) => (
              <View key={b.start} className="flex-row items-baseline justify-between gap-3 py-0.5">
                <Text variant="caption" tabular className="text-muted">
                  {formatServiceHours({ start: b.start, end: b.end })}
                </Text>
                <Text variant="caption" tabular className="text-text">
                  {formatHeadway({ min: b.headwayMin, max: b.headwayMin }, locale)}
                </Text>
              </View>
            ))}
          </View>
        ))
      ) : service?.headway ? (
        <Text variant="body" tabular className="text-text">
          {formatHeadway(service.headway, locale)}
        </Text>
      ) : null}
    </View>
  )
}

/** First/last departure per day-type — the true edges the coarse hours span is drawn from. */
function HoursBody({ service, locale }: { service?: RouteServiceInfo; locale: Locale }) {
  const patterns = service?.patterns
  return (
    <View className="gap-3">
      {patterns?.length ? (
        patterns.map((p) => (
          <View key={p.dayType + p.first} className="flex-row items-center justify-between gap-3">
            <Text variant="body" className="text-text">
              {dayLabel(p, locale)}
            </Text>
            <View className="flex-row gap-5">
              <LabeledTime label={t(locale, 'firstBus')} time={p.first} />
              <LabeledTime label={t(locale, 'lastBus')} time={p.last} />
            </View>
          </View>
        ))
      ) : service?.hours ? (
        <Text variant="body" tabular className="text-text">
          {formatServiceHours(service.hours)}
        </Text>
      ) : null}
    </View>
  )
}

/** A small stacked label + 24h time (e.g. "First / 05:35"). */
function LabeledTime({ label, time }: { label: string; time: string }) {
  return (
    <View className="items-end">
      <Text variant="caption" className="text-subtle">
        {label}
      </Text>
      <Text variant="body" tabular className="text-text">
        {time}
      </Text>
    </View>
  )
}

/** Friendly day-type name; for the uncommon `other` mix, the exact running days from the mask. */
function dayLabel(p: FreqPattern, locale: Locale): string {
  switch (p.dayType) {
    case 'weekday':
      return t(locale, 'dayWeekday')
    case 'saturday':
      return t(locale, 'daySaturday')
    case 'sunday':
      return t(locale, 'daySunday')
    case 'daily':
      return t(locale, 'dayDaily')
    default: {
      const names = t(locale, 'daysShort').split(',')
      const on = p.days.map((d, i) => (d ? names[i] : null)).filter(Boolean)
      return on.length ? on.join(' · ') : t(locale, 'dayOther')
    }
  }
}
