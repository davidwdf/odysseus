import { beforeEach, describe, expect, it, vi } from 'vitest'
import { coalesce, ETA_TTL_SEC, resetEtaCache } from '../src/eta-cache'

beforeEach(() => resetEtaCache())

describe('coalesce', () => {
  it('runs the producer once for concurrent callers of the same key', async () => {
    const produce = vi.fn(async () => ['a'])
    const [x, y] = await Promise.all([coalesce('k', produce, []), coalesce('k', produce, [])])
    expect(produce).toHaveBeenCalledTimes(1)
    expect(x).toEqual(['a'])
    expect(y).toBe(x)
  })

  it('keeps distinct keys independent', async () => {
    const produce = vi.fn(async () => ['a'])
    await Promise.all([coalesce('k1', produce, []), coalesce('k2', produce, [])])
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure — it resolves to the fallback and lets the next caller retry', async () => {
    const produce = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('upstream 502'))
      .mockResolvedValueOnce(['ok'])
    expect(await coalesce('k', produce, [])).toEqual([])
    expect(await coalesce('k', produce, [])).toEqual(['ok'])
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('is the 30 s TTL the plan calls for', () => {
    // Upstream refreshes ~1/min, so at the previous 8 s the hit rate was ~0% (WP0-4).
    expect(ETA_TTL_SEC).toBe(30)
  })
})
