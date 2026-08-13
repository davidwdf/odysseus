import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'

// WP0-2 acceptance: no request to `tile.openstreetmap.org` from a production build, and the
// tile proxy turns LandsD's `private` cache-control into something a shared cache will hold.

const LANDSD = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz'

let upstream: string[]
/** The init the last LandsD fetch carried — the deadline assertion reads it. */
let upstreamInit: RequestInit | undefined
const realFetch = globalThis.fetch

beforeEach(() => {
  upstream = []
  upstreamInit = undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(LANDSD)) {
      upstream.push(url)
      upstreamInit = init
      // Mimic the real headers, including the `private` we deliberately override.
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'private, must-revalidate, max-age=43200',
          etag: '0xDEADBEEF',
        },
      })
    }
    return realFetch(input, init)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

async function get(path: string): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request(`https://edge.test${path}`), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('/v1/tiles', () => {
  it('serves the basemap from LandsD, publicly cacheable', async () => {
    const res = await get('/v1/tiles/basemap/16/53550/28598.png')
    expect(res.status).toBe(200)
    expect(upstream).toEqual([`${LANDSD}/basemap/WGS84/16/53550/28598.png`])
    expect(res.headers.get('content-type')).toBe('image/png')
    // The point of the proxy: `private` upstream becomes `public` for us.
    expect(res.headers.get('cache-control')).toMatch(/^public, max-age=43200/)
    expect(res.headers.get('x-tile-source')).toBe('landsd')
    // The fetch carries `fetchUpstream`'s deadline (ADR-139) — this was the Worker's one upstream
    // call with none, and a wedged connection held an outgoing-connection slot indefinitely.
    expect(upstreamInit?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps each UI locale to its LandsD label layer', async () => {
    await get('/v1/tiles/label/en/16/53550/28598.png')
    await get('/v1/tiles/label/tc/16/53550/28598.png')
    await get('/v1/tiles/label/sc/16/53550/28598.png')
    expect(upstream).toEqual([
      `${LANDSD}/label/hk/en/WGS84/16/53550/28598.png`,
      `${LANDSD}/label/hk/tc/WGS84/16/53550/28598.png`,
      `${LANDSD}/label/hk/sc/WGS84/16/53550/28598.png`,
    ])
  })

  it('rejects out-of-range coordinates without calling upstream', async () => {
    // Basemap starts at z10; z21 is past the ceiling; x must be < 2^z.
    for (const path of [
      '/v1/tiles/basemap/9/300/200.png',
      '/v1/tiles/basemap/21/1/1.png',
      '/v1/tiles/basemap/2/9/1.png',
      '/v1/tiles/label/de/16/53550/28598.png',
    ]) {
      expect((await get(path)).status).toBe(400)
    }
    expect(upstream).toHaveLength(0)
  })

  it('never reaches openstreetmap.org', async () => {
    await get('/v1/tiles/basemap/17/53550/28598.png')
    await get('/v1/tiles/label/tc/17/53550/28598.png')
    expect(upstream.some((u) => u.includes('openstreetmap'))).toBe(false)
  })
})
