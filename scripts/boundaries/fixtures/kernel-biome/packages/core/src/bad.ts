import { tokens } from '@nextbus/ui'

export const load = () => fetch('https://data.etabus.gov.hk')
export const cached = () => localStorage.getItem('etas')
export const theme = tokens
