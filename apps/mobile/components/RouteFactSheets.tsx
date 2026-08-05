import type {
  ConcessionClass,
  Locale,
  RouteFactSheetKind,
  RouteFactSheetView,
  RouteStatKind,
} from '@nextbus/core'
import { type LocalizedString, t } from '@nextbus/i18n'
import { Accessibility, Baby, Clock, type LucideIcon, MapPin, Ruler } from 'lucide-react-native'
import { ScrollView, useWindowDimensions, View } from 'react-native'
import { BottomSheet } from './BottomSheet'
import { Icon } from './Icon'
import { Text } from './Text'

/** Which badge opened the sheet: fare / frequency / service hours, or the stop-count badge
 *  (`stops`) → a whole-route overview (stops · journey · distance). */
export type FactKind = RouteFactSheetKind

/**
 * The tap-to-expand detail behind a `RouteMeta` badge (ADR-044): the fare-stage timeline +
 * concession estimates, the per-day-type frequency breakdown, or the first/last service hours.
 *
 * **A pure projection of `routeFactSheet` since WP6-6c.** It used to derive eight things — the stages, the
 * concession figures and whether the legend appeared at all, the `~` on an estimate, the band headways, the
 * fallbacks when the dataset has no pattern table, and the day-name join for an unnamed mask. All eight are
 * `@nextbus/core`'s now, with 15 corpus cases, which is what let this file finally join
 * `check-no-derivation`'s `POLICED` list: it was the one route surface still absent from it.
 *
 * What stays here is the four glyph tables and the four titles — *which concept a glyph denotes* is identity
 * and *the set* is idiom (ADR-075), and a static heading is not composed with any datum.
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
  const { height } = useWindowDimensions()
  return (
    <BottomSheet
      closeLabel={t(locale, 'back')}
      onClose={onClose}
      header={
        <Text variant="h3" className="text-text">
          {t(locale, TITLE[sheet.kind])}
        </Text>
      }
    >
      {/* Cap the body and let it scroll — a weekday+Sat+Sun frequency table can be tall. The
          drag handle lives above this (its own gesture), so this scroll doesn't fight dismiss. */}
      <ScrollView style={{ maxHeight: height * 0.62 }} showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-1 pb-3">
          {sheet.kind === 'fare' ? (
            <FareBody sheet={sheet} locale={locale} />
          ) : sheet.kind === 'freq' ? (
            <FreqBody sheet={sheet} locale={locale} />
          ) : sheet.kind === 'hours' ? (
            <HoursBody sheet={sheet} locale={locale} />
          ) : (
            <OverviewBody sheet={sheet} locale={locale} />
          )}
        </View>
      </ScrollView>
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

/** Which glyph denotes each whole-route figure, and each concession class. Identity; the *set* is idiom. */
const STAT_GLYPH: Record<RouteStatKind, LucideIcon> = {
  stops: MapPin,
  journey: Clock,
  distance: Ruler,
}
const CONCESSION_GLYPH: Record<ConcessionClass, LucideIcon> = {
  child: Baby,
  elderly: Accessibility,
}
/** The label and the honesty note for each whole-route figure. */
const STAT_LABEL = {
  stops: 'stopsOnRoute',
  journey: 'overviewJourney',
  distance: 'overviewDistance',
} as const
const STAT_NOTE = { journey: 'overviewJourneyNote', distance: 'overviewDistanceNote' } as const
/** …and for each concession class. */
const CONCESSION_LABEL = { child: 'fareChild', elderly: 'fareElderly' } as const
const CONCESSION_NOTE = { child: 'fareChildNote', elderly: 'fareElderlyNote' } as const

/** Whole-route stats behind the stop-count badge: stops · full journey time · route distance.
 *  Origin/destination are deliberately omitted — they already head the screen. */
function OverviewBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'stops' }>
  locale: Locale
}) {
  return (
    <View className="gap-3.5">
      {sheet.stats.map((stat) => (
        <StatRow
          key={stat.stat}
          icon={STAT_GLYPH[stat.stat]}
          label={t(locale, STAT_LABEL[stat.stat])}
          value={stat.value}
          // The caveat is shown where the **kernel** marks the figure an estimate (`stat.estimate`) — the
          // route distance is a straight line through the stops and the journey time is upstream's own
          // origin→terminus timing, and a rider is told so (ADR-008). The `!== 'stops'` only narrows the
          // note lookup, which carries a sentence for the journey and the distance and none for the count.
          {...(stat.estimate && stat.stat !== 'stops'
            ? { note: t(locale, STAT_NOTE[stat.stat]) }
            : {})}
        />
      ))}
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
  label: LocalizedString
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
 * carries the adult fare and — on the same line — the child and elderly/disabled estimates, with the
 * legend and disclaimer below (ADR-044). Concessions are policy-derived, never route data.
 */
function FareBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'fare' }>
  locale: Locale
}) {
  return (
    <View className="gap-4">
      <Text variant="caption" className="text-subtle">
        {t(locale, 'fareSectionalNote')}
      </Text>

      <View>
        {sheet.stages.map((stage, i) => (
          <View key={stage.fromSeq} className="flex-row gap-3">
            <View className="items-center" style={{ width: 12 }}>
              <View
                className="rounded-full bg-accent"
                style={{ width: 10, height: 10, marginTop: 5 }}
              />
              {i < sheet.stages.length - 1 ? <View className="w-0.5 flex-1 bg-border" /> : null}
            </View>
            <View className="flex-1 pb-4">
              {/* Fares on one line — adult, then the estimates at near-equal prominence, widely
                  spaced so each reads as its own figure. */}
              <View className="flex-row items-center gap-5">
                <Text variant="body" weight="medium" tabular className="text-text">
                  {stage.fare}
                </Text>
                {stage.concessions.map((figure) => (
                  <ConcessionFare
                    key={figure.class}
                    icon={CONCESSION_GLYPH[figure.class]}
                    value={figure.fare}
                  />
                ))}
              </View>
              {/* Boarding stop for this price + how many stops the price covers. */}
              <View className="mt-0.5 flex-row items-baseline justify-between gap-2">
                <Text variant="caption" className="flex-1 text-muted" numberOfLines={2}>
                  {stage.boardingStop}
                </Text>
                <Text variant="caption" tabular className="shrink-0 text-subtle">
                  {stage.covers}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Legend + estimate disclaimer, for exactly the classes that appear above. */}
      {sheet.concessions.length > 0 ? (
        <View className="gap-3 border-border border-t pt-4">
          <Text variant="label" className="text-text">
            {t(locale, 'concessionsTitle')}
          </Text>
          {sheet.concessions.map((klass) => (
            <ConcessionLegend
              key={klass}
              icon={CONCESSION_GLYPH[klass]}
              label={t(locale, CONCESSION_LABEL[klass])}
              note={t(locale, CONCESSION_NOTE[klass])}
            />
          ))}
          <Text variant="caption" className="text-subtle">
            {t(locale, 'concessionsNote')}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/** A single concession estimate on a timeline stage: its icon + the "~$X" figure — and the `~` is the
 *  model's, because a mark that says "estimate" is content rather than decoration (ADR-008). */
function ConcessionFare({ icon, value }: { icon: LucideIcon; value: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon icon={icon} tone="muted" size={16} />
      <Text variant="body" tabular className="text-muted">
        {value}
      </Text>
    </View>
  )
}

/** A legend row keying a concession icon to its passenger class + how the estimate is derived. */
function ConcessionLegend({
  icon,
  label,
  note,
}: {
  icon: LucideIcon
  label: LocalizedString
  note: LocalizedString
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
function FreqBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'freq' }>
  locale: Locale
}) {
  return (
    <View className="gap-4">
      <Text variant="caption" className="text-subtle">
        {t(locale, 'freqNote')}
      </Text>
      {sheet.days.map((day) => (
        <View key={day.day} className="gap-1.5">
          <Text variant="label" className="text-text">
            {day.day}
          </Text>
          {day.bands.map((band) => (
            <View key={band.hours} className="flex-row items-baseline justify-between gap-3 py-0.5">
              <Text variant="caption" tabular className="text-muted">
                {band.hours}
              </Text>
              <Text variant="caption" tabular className="text-text">
                {band.headway}
              </Text>
            </View>
          ))}
        </View>
      ))}
      {sheet.headway ? (
        <Text variant="body" tabular className="text-text">
          {sheet.headway}
        </Text>
      ) : null}
    </View>
  )
}

/** First/last departure per day-type — the true edges the coarse hours span is drawn from. */
function HoursBody({
  sheet,
  locale,
}: {
  sheet: Extract<RouteFactSheetView, { kind: 'hours' }>
  locale: Locale
}) {
  return (
    <View className="gap-3">
      {sheet.days.map((day) => (
        <View key={day.day} className="flex-row items-center justify-between gap-3">
          <Text variant="body" className="text-text">
            {day.day}
          </Text>
          <View className="flex-row gap-5">
            <LabeledTime label={t(locale, 'firstBus')} time={day.first} />
            <LabeledTime label={t(locale, 'lastBus')} time={day.last} />
          </View>
        </View>
      ))}
      {sheet.span ? (
        <Text variant="body" tabular className="text-text">
          {sheet.span}
        </Text>
      ) : null}
    </View>
  )
}

/** A small stacked label + 24h time (e.g. "First / 05:35"). */
function LabeledTime({ label, time }: { label: LocalizedString; time: string }) {
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
