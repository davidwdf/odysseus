import { describe, expect, it } from 'vitest'
import { splitStopCode, titleCaseName } from './stopName'

describe('splitStopCode', () => {
  it('splits a trailing parenthesised operator code', () => {
    expect(splitStopCode('CITY ONE STATION (ST311)')).toEqual({
      label: 'CITY ONE STATION',
      code: 'ST311',
    })
  })

  it('tolerates whitespace around the code', () => {
    expect(splitStopCode('FOO BAR (ST311)  ')).toEqual({ label: 'FOO BAR', code: 'ST311' })
  })

  it('returns the whole name when there is no trailing code', () => {
    expect(splitStopCode('CHOI HUNG ESTATE')).toEqual({ label: 'CHOI HUNG ESTATE' })
  })

  it('does not treat a mid-name parenthetical as a code', () => {
    expect(splitStopCode('FOO (NORTH) BAR')).toEqual({ label: 'FOO (NORTH) BAR' })
  })
})

describe('titleCaseName', () => {
  it('title-cases an ALL-CAPS English name', () => {
    expect(titleCaseName('CHOI HUNG ESTATE')).toBe('Choi Hung Estate')
  })

  it('keeps known HK transit acronyms upper-cased', () => {
    expect(titleCaseName('MTR KOWLOON STATION')).toBe('MTR Kowloon Station')
    expect(titleCaseName('KMB DEPOT')).toBe('KMB Depot')
  })

  it('lower-cases genuine minor words inside a title', () => {
    expect(titleCaseName('UNIVERSITY OF HONG KONG')).toBe('University of Hong Kong')
  })

  // The reason this file exists: "On" is the romanised syllable 安, not the
  // English preposition, so it must title-case like any other place-name word.
  it('capitalises "On" as a place-name syllable mid-name', () => {
    expect(titleCaseName('LOK ON PAI')).toBe('Lok On Pai')
    expect(titleCaseName('TSZ ON COURT')).toBe('Tsz On Court')
    expect(titleCaseName('HING ON STREET')).toBe('Hing On Street')
  })

  it('capitalises a leading minor word (first word is never minor)', () => {
    expect(titleCaseName('ON TAI ESTATE')).toBe('On Tai Estate')
    expect(titleCaseName('THE PEAK')).toBe('The Peak')
  })

  it('leaves names that already contain lower-case unchanged', () => {
    expect(titleCaseName('Choi Hung Estate')).toBe('Choi Hung Estate')
  })

  it('leaves CJK names (no Latin letters) unchanged', () => {
    expect(titleCaseName('彩虹邨')).toBe('彩虹邨')
  })

  it('handles apostrophes within a word', () => {
    expect(titleCaseName("ST JOHN'S")).toBe("St John's")
  })
})
