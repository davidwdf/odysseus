import type { Locale, OperatorId } from '@nextbus/core'
import { type LocalizedString, type PlainMessageKey, t } from '@nextbus/i18n'

/**
 * A bus operator's name, in the reader's language.
 *
 * There were two copies of this before, both English-only: an `OPERATOR_LABEL` map in
 * `app/stop/[id].tsx` commented "brand names, locale-neutral", and the search screen's operator
 * filter chips, which used the raw `OperatorId` as its own label. So a Chinese reader saw "Citybus"
 * inside an otherwise Chinese "served by" sentence, and "KMB" on a filter chip. Every one of these
 * operators publishes a Chinese name; the copy now lives in the catalogue with the rest.
 */
const OPERATOR_KEY: Record<OperatorId, PlainMessageKey> = {
  KMB: 'operatorKmb',
  LWB: 'operatorLwb',
  CTB: 'operatorCtb',
  GMB: 'operatorGmb',
}

/**
 * Falls back to the raw code for an operator we have no copy for. ADR-052 treats `operator` as an
 * open vocabulary, so a code like `NLB` will reach a screen before its name does — and showing
 * `NLB` beats showing nothing. That fallback is the one place a raw upstream string is branded as a
 * `LocalizedString`, which is why the cast is here, once, with this comment on it rather than
 * scattered across call sites.
 */
export function operatorName(operator: OperatorId, locale: Locale): LocalizedString {
  const key = OPERATOR_KEY[operator]
  return key ? t(locale, key) : (operator as LocalizedString)
}
