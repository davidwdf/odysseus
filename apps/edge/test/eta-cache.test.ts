import { beforeEach, describe, expect, it, vi } from 'vitest'
import { coalesce, ETA_TTL_SEC, resetEtaCache } from '../src/eta-cache'

beforeEach(() => resetEtaCache())

describe('coalesce', () => {
  it('runs the producer once for concurrent callers of the same key', async () => {
    const produce = vi.fn(async () => ['a'])
    const [x, y] = await Promise.all([coalesce('k', produce), coalesce('k', produce)])
    expect(produce).toHaveBeenCalledTimes(1)
    expect(x).toEqual(['a'])
    expect(y).toBe(x)
  })

  it('keeps distinct keys independent', async () => {
    const produce = vi.fn(async () => ['a'])
    await Promise.all([coalesce('k1', produce), coalesce('k2', produce)])
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('rejects rather than resolving to a fallback — the caller decides what a failure means', async () => {
    // **This assertion is the inverse of the one it replaces**, and the inversion is ADR-073. The old
    // signature took a `fallback` and every ETA call site passed `[]`, so a refused upstream board
    // arrived at `stopEtas` as an ordinary empty list: `/v1/etas/:id` served `200 []` during an outage
    // and both live engines reported every reading `gone`. A cache had decided what a failure meant on
    // its callers' behalf, one layer below the two places that enforce "a failed round is not a
    // departure". `memberEtaLists` now records which pole refused; `routeDetail` still degrades, and
    // says so at its own call site where a reader can see it.
    const produce = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('upstream 502'))
      .mockResolvedValueOnce(['ok'])
    await expect(coalesce('k', produce)).rejects.toThrow('upstream 502')
    // Not cached: the entry is evicted, so the next caller inside the same TTL retries rather than
    // being handed the failure for 30 s.
    expect(await coalesce('k', produce)).toEqual(['ok'])
    expect(produce).toHaveBeenCalledTimes(2)
  })

  it('shares one rejection with every concurrent caller, and none of them is unhandled', async () => {
    // The stored promise carries its own `catch` so a round in which nobody awaited a failed key does
    // not surface as an unhandled rejection — which workerd logs, and which reads exactly like a bug of
    // ours. That handler must not consume the rejection for the real callers, which is what this
    // asserts: both of them see it.
    const produce = vi.fn<() => Promise<string[]>>().mockRejectedValue(new Error('upstream 502'))
    const results = await Promise.allSettled([coalesce('k', produce), coalesce('k', produce)])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('is the 30 s TTL the plan calls for', () => {
    // Upstream refreshes ~1/min, so at the previous 8 s the hit rate was ~0% (WP0-4).
    expect(ETA_TTL_SEC).toBe(30)
  })
})
