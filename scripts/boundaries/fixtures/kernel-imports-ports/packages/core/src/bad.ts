import type { Clock } from '../../ports/src/index'

export const read = (c: Clock) => c.now()
