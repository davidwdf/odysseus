// The DOM renderer's half of WP5-7: `useLiveNearby` is hand-copied per renderer, so it is tested per
// renderer.
//
// WHY THIS FILE AND NOT "IT IS THE SAME CODE"
// It is *deliberately* the same code and that is exactly why it needs its own suite. ADR-068/069 put the
// rules in `@nextbus/core` and left the `useQuery`/`useEffect` wiring per renderer, because
// `packages/api-client` may not import React (`layers.json` gives the `client` layer `"npm": []`). Every
// asymmetry this app has caught over two waves has been of one shape: something wired in one shell and
// merely *documented* in the other. A hand-copied hook is the most likely place for the next one.
//
// The properties asserted are the two that a screenshot cannot see and that a copy error would produce:
// the subscription is opened once and does not resubscribe on its own output (the storm), and the merge
// replaces the readings while leaving the document — `distanceM`, `routeCount`, `stop` — alone.

import type { DataSource, Eta, EtaListener, NearbyStop, WatchTarget } from '@nextbus/core'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveNearby } from '../src/hooks/useLiveNearby'

const HERE = { lat: 22.3193, lng: 114.1694 }
const PLACE_A = 'P:KMB:AA+CTB:AB'
const POLE_A = 'KMB:AA'
const PLACE_B = 'KMB:BB'

const reading = (stopId: string): Eta => ({
  routeId: 'KMB:1:outbound:1',
  stopId,
  operator: 'KMB',
  arrivals: ['2026-07-30T10:04:00+08:00'],
  dataTimestamp: '2026-07-30T09:59:30+08:00',
  observedAt: '2026-07-30T01:59:30.000Z',
})

const CARDS: NearbyStop[] = [
  {
    stop: {
      id: PLACE_A,
      name: { en: 'Belair Gardens', 'zh-Hant': '海燕花園', 'zh-Hans': '海燕花园' },
      location: HERE,
      sources: [
        { operator: 'KMB', operatorStopId: 'AA' },
        { operator: 'CTB', operatorStopId: 'AB' },
      ],
    },
    distanceM: 42,
    etas: [],
    routeCount: 9,
  },
  {
    stop: {
      id: PLACE_B,
      name: { en: 'Tai Chung Kiu Road', 'zh-Hant': '大涌橋路', 'zh-Hans': '大涌桥路' },
      location: { lat: 22.32, lng: 114.17 },
      sources: [{ operator: 'KMB', operatorStopId: 'BB' }],
    },
    distanceM: 130,
    etas: [],
    routeCount: 3,
  },
]

function recordingSource() {
  const subscriptions: WatchTarget[][] = []
  let live: EtaListener | null = null
  let released = 0
  return {
    subscriptions,
    released: () => released,
    /**
     * Deliver one round and let React and react-query settle.
     *
     * The timer advance is required rather than defensive: react-query notifies its observers on a
     * `setTimeout(…, 0)` and this file runs on fake timers (the hook owns a clock), so without it the
     * cache updates and no component ever hears — which reads as a broken merge.
     */
    deliver: async (etas: Eta[]) => {
      if (live === null) throw new Error('deliver: no live listener — the subscription is not open')
      await act(async () => {
        live?.(etas)
        await vi.advanceTimersByTimeAsync(0)
      })
    },
    source: {
      watch(targets: WatchTarget[], onUpdate: EtaListener) {
        subscriptions.push(targets)
        live = onUpdate
        return {
          unsubscribe() {
            released += 1
            live = null
          },
        }
      },
    } as unknown as DataSource,
  }
}

function Rows({ source }: { source: DataSource }) {
  const query = useQuery({
    queryKey: ['nearby', HERE.lat, HERE.lng],
    queryFn: async () => CARDS,
  })
  useLiveNearby(HERE, query.data?.map((stop) => stop.stop.id) ?? [], {
    source,
    enabled: query.isSuccess,
  })
  return (
    <ul>
      {(query.data ?? []).map((card) => (
        <li key={card.stop.id}>
          {`${card.stop.id}|${card.distanceM}|${card.routeCount}|${card.etas
            .map((e) => e.stopId)
            .join('+')}`}
        </li>
      ))}
    </ul>
  )
}

let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-07-30T02:00:00.000Z'))
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  vi.useRealTimers()
})

async function mount(source: DataSource): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(host)
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <Rows source={source} />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return host
}

const lines = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('li')].map((li) => li.textContent ?? '')

describe('apps/web Nearby holds one subscription', () => {
  it('subscribes once, naming the place ids the cards carry', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    expect(fake.subscriptions.length).toBe(1)
    expect(fake.subscriptions[0]?.map((t) => t.stopId)).toEqual([PLACE_A, PLACE_B])
  })

  it('does not resubscribe when its own readings land', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    await fake.deliver([reading(POLE_A)])
    await fake.deliver([reading(POLE_A), reading(PLACE_B)])
    await fake.deliver([reading(POLE_A)])
    expect(fake.subscriptions.length).toBe(1)
    expect(fake.released()).toBe(0)
  })

  it('releases the subscription on unmount', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    await act(async () => root?.unmount())
    root = null
    expect(fake.released()).toBe(1)
  })

  it('merges readings onto the right card and keeps every other field', async () => {
    const fake = recordingSource()
    const host = await mount(fake.source)
    expect(lines(host)).toEqual([`${PLACE_A}|42|9|`, `${PLACE_B}|130|3|`])
    // Stamped with a **pole** of the merged place, which is the only spelling the wire uses. Compared
    // directly against the card's `P:` id it would match nothing — the defect `memberStopIds` prevents.
    await fake.deliver([reading(POLE_A)])
    expect(lines(host)).toEqual([`${PLACE_A}|42|9|${POLE_A}`, `${PLACE_B}|130|3|`])
  })
})
