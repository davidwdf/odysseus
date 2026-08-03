/** @vitest-environment jsdom */
// WP5-7's client half: Nearby holds one subscription, and the two ways that goes wrong.
//
// WHY THESE THREE PROPERTIES AND NOT A RENDER SNAPSHOT
// What a Nearby card *shows* is `nearbyView`'s, pinned by `packages/core/spec/stop-card.spec.json` and
// rendered by two renderers from that one answer — asserting it again here would be testing the kernel
// through a DOM. What is genuinely new and genuinely fragile is the *subscription lifecycle*, and it has
// two failure modes that a screenshot cannot see:
//
//  1. **The storm.** The effect depends on the target set. A `WatchTarget[]` built per render is a new
//     array every time; the listener writes into the query cache, which re-renders the screen, which
//     builds a new array — and `subscribe` fires a round *immediately*. An array dependency therefore
//     resubscribes on its own output, unboundedly, one HTTP request per turn. `liveTargetsKey` is the fix
//     and this file is the proof it works, because nothing else would catch it: the screen renders
//     correctly the whole time it is melting the network.
//  2. **The merge that eats the document.** `applyLiveEtasToNearby` must replace `etas` and leave
//     `distanceM`, `routeCount` and `stop` alone. Its Place-screen twin dropped `stop` and `members` in an
//     early sketch, which renders as a screen with no name and no map pins — the same shape one list over.
//
// The clock is the third, and it is asserted by `live-clock.test.tsx` for the Place screen's hook. The
// difference here is that Nearby had **no** clock at all before this — no `refetchInterval`, no interval
// anywhere — so its minutes never aged and the staleness cue could not fire. That is asserted below too.

import type {
  DataSource,
  Eta,
  EtaFailure,
  EtaListener,
  NearbyStop,
  WatchTarget,
} from '@nextbus/core'
import { CLIENT_POLICY_DEFAULTS } from '@nextbus/core'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from '../components/Text'
import { useLiveNearby } from '../lib/useLiveNearby'

const HERE = { lat: 22.3193, lng: 114.1694 }
const ELSEWHERE = { lat: 22.32, lng: 114.17 }
const PLACE_A = 'P:KMB:AA+CTB:AB'
const POLE_A = 'KMB:AA'
const PLACE_B = 'KMB:BB'
const ROUTE_1 = 'KMB:1:outbound:1'

const reading = (stopId: string, hhmm: string): Eta => ({
  routeId: ROUTE_1,
  stopId,
  operator: 'KMB',
  arrivals: [`2026-07-30T${hhmm}:00+08:00`],
  dataTimestamp: '2026-07-30T09:59:30+08:00',
  observedAt: '2026-07-30T01:59:30.000Z',
})

/** Two cards as `/v1/nearby` serves them — every field the screen reads, so a lost one is visible. */
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
      location: ELSEWHERE,
      sources: [{ operator: 'KMB', operatorStopId: 'BB' }],
    },
    distanceM: 130,
    etas: [],
    routeCount: 3,
  },
]

/**
 * A source whose `watch()` records every subscription and hands back a listener to fire by hand.
 *
 * By hand, deliberately: the whole subject is *when* a subscription is opened and closed, so a fake that
 * delivered on a timer would make the storm assertion a race. `subscriptions` is the count that matters.
 */
function recordingSource() {
  const subscriptions: WatchTarget[][] = []
  let live: EtaListener | null = null
  let released = 0
  return {
    subscriptions,
    released: () => released,
    /**
     * Deliver one round to the current listener and let React and react-query settle.
     *
     * The `advanceTimersByTimeAsync` is not decoration: react-query's `notifyManager` schedules its
     * observer notifications on a `setTimeout(…, 0)`, and this file runs on fake timers (it has to — the
     * hook's own clock is under test), so without it `setQueryData` updates the cache and **no component
     * ever hears about it**. That looks exactly like a broken merge, which is a full half-hour of
     * looking at the wrong file.
     */
    deliver: async (etas: Eta[], failed?: EtaFailure[]) => {
      if (live === null) throw new Error('deliver: no live listener — the subscription is not open')
      await act(async () => {
        live?.(etas, failed)
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

/** The screen's three lines: the query, the subscription, and the readings it renders. */
function NearbyRows({ at, source }: { at: { lat: number; lng: number }; source: DataSource }) {
  const query = useQuery({
    queryKey: ['nearby', at.lat, at.lng],
    queryFn: async () => CARDS,
  })
  const { now } = useLiveNearby(at, query.data?.map((stop) => stop.stop.id) ?? [], {
    source,
    enabled: query.isSuccess,
  })
  return (
    <View>
      <Text variant="body">{`now=${now > 0 ? 'set' : 'unset'}`}</Text>
      {(query.data ?? []).map((card) => (
        <Text key={card.stop.id} variant="body">
          {`${card.stop.id}|${card.distanceM}|${card.routeCount}|${card.etas
            .map((e) => e.stopId)
            .join('+')}|${(card.failed ?? []).map((f) => f.stopId).join('+')}`}
        </Text>
      ))}
    </View>
  )
}

function visibleText(host: HTMLElement): string[] {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const text = (node.textContent ?? '').trim()
    if (text) out.push(text)
    node = walker.nextNode()
  }
  return out
}

let root: ReturnType<typeof createRoot> | null = null
let client: QueryClient | null = null

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-07-30T02:00:00.000Z'))
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  client = null
  vi.useRealTimers()
})

async function mount(source: DataSource, at = HERE): Promise<HTMLElement> {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(host)
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client as QueryClient}>
        <NearbyRows at={at} source={source} />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return host
}

describe('Nearby holds ONE subscription for the whole list', () => {
  it('subscribes once for every card, naming the place ids the cards carry', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    expect(fake.subscriptions.length).toBe(1)
    expect(fake.subscriptions[0]?.map((t) => t.stopId)).toEqual([PLACE_A, PLACE_B])
    // Place ids, not pole ids: a place is one target and one board fan-out, and
    // `applyLiveEtasToNearby` maps a pole-stamped reading back to its card through `memberStopIds`.
    expect(fake.subscriptions[0]?.some((t) => t.stopId === POLE_A)).toBe(false)
  })

  it('does NOT resubscribe when its own readings land — the storm', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    expect(fake.subscriptions.length).toBe(1)

    // Three rounds, each one changing the cache and therefore re-rendering the screen. With the effect
    // keyed on the target array this is where it runs away: every render builds a new array, every new
    // array resubscribes, and every `subscribe` fires a round at once.
    await fake.deliver([reading(POLE_A, '10:04')])
    await fake.deliver([reading(POLE_A, '10:06')])
    await fake.deliver([reading(POLE_A, '10:08')])
    expect(fake.subscriptions.length).toBe(1)
    expect(fake.released()).toBe(0)
  })

  it('resubscribes exactly once when the fix moves to another cell, and releases the old one', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    // A remounted screen at a different cell — which is what a new fix produces, since the query key is
    // `['nearby', lat, lng]` and the coordinates are already snapped to a 25 m grid.
    await act(async () => root?.unmount())
    root = null
    await mount(fake.source, ELSEWHERE)
    expect(fake.subscriptions.length).toBe(2)
    expect(fake.released()).toBe(1)
  })

  it('releases the subscription on unmount', async () => {
    const fake = recordingSource()
    await mount(fake.source)
    await act(async () => root?.unmount())
    root = null
    expect(fake.released()).toBe(1)
  })

  it('does not subscribe at all when nothing on screen is watchable', async () => {
    // `liveTargetsKey` runs over the **accepted** set, so a list of ids that do not parse produces an
    // empty key — the condition for not opening anything. Reachable in practice: a persisted list from a
    // pre-ADR-062 id scheme rehydrates as `success` and enables the subscription.
    const fake = recordingSource()
    document.body.innerHTML = '<div id="host"></div>'
    const host = document.getElementById('host')
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(host as HTMLElement)
    await act(async () => {
      root?.render(
        <QueryClientProvider client={client as QueryClient}>
          <UnwatchableRows source={fake.source} />
        </QueryClientProvider>,
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fake.subscriptions.length).toBe(0)
  })
})

function UnwatchableRows({ source }: { source: DataSource }) {
  const { now } = useLiveNearby(HERE, ['not-an-id', 'also-not-one'], { source })
  return <Text variant="body">{`now=${now > 0 ? 'set' : 'unset'}`}</Text>
}

describe('the merge keeps the document and replaces only the readings', () => {
  it('leaves distanceM, routeCount and the stop alone', async () => {
    const fake = recordingSource()
    const host = await mount(fake.source)
    expect(visibleText(host)).toEqual(['now=set', `${PLACE_A}|42|9||`, `${PLACE_B}|130|3||`])

    // A reading stamped with a **pole** of the merged place — the only spelling the wire uses — must land
    // on that place's card. Compared directly against the card's `P:` id it would match nothing, which is
    // the defect `memberStopIds` exists to prevent and which would render as an empty card for ever.
    await fake.deliver([reading(POLE_A, '10:04')])
    expect(visibleText(host)).toEqual([
      'now=set',
      `${PLACE_A}|42|9|${POLE_A}|`,
      `${PLACE_B}|130|3||`,
    ])
  })

  it('blanks a card whose reading is gone rather than leaving the last one showing', async () => {
    const fake = recordingSource()
    const host = await mount(fake.source)
    await fake.deliver([reading(POLE_A, '10:04')])
    expect(visibleText(host)).toContain(`${PLACE_A}|42|9|${POLE_A}|`)
    // The session's list is the complete current set, not a patch — so a departed bus disappears. That is
    // `gone`'s honesty rule (ADR-008) reaching the card, and the opposite of the stale-list hazard
    // ADR-077 closed.
    await fake.deliver([])
    expect(visibleText(host)).toContain(`${PLACE_A}|42|9||`)
  })
})

describe('the clock Nearby never had', () => {
  it('advances on the served cadence, so a reading can age', async () => {
    // The screen's `now` came from `Date.now()` in the render body and nothing re-rendered it: no
    // `refetchInterval` (this screen had none, ever — `git log -S` finds no such line), no interval in
    // `useClientPolicy`, and `useLocation` is one-shot. So `etaReadout(...).stale` could not fire. The
    // hook now owns the tick, which is why it returns `now` rather than leaving a screen to remember.
    const fake = recordingSource()
    let seen: number[] = []
    function Clock() {
      const { now } = useLiveNearby(HERE, [PLACE_A], { source: fake.source })
      seen.push(now)
      return <Text variant="body">{String(now)}</Text>
    }
    document.body.innerHTML = '<div id="host"></div>'
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(document.getElementById('host') as HTMLElement)
    await act(async () => {
      root?.render(
        <QueryClientProvider client={client as QueryClient}>
          <Clock />
        </QueryClientProvider>,
      )
    })
    seen = []
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CLIENT_POLICY_DEFAULTS.refreshAfterMs)
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBeGreaterThan(Date.parse('2026-07-30T02:00:00.000Z'))
  })
})

describe('a card can say "we could not ask" on the live path, not only at first paint', () => {
  const refusing: EtaFailure = {
    stopId: POLE_A,
    error: { code: 'upstream_unavailable', message: 'KMB stop-ETA 502', retryable: true },
  }

  it("carries the round's failure set onto the right card, and clears it on recovery", async () => {
    // **The acceptance of WP5-14** (ADR-081). This shipped the other way for one wave: the merge was
    // called with no failure set, so the marker a rider got from `/v1/nearby` cleared on the first live
    // round and a card at a refusing place read as a quiet stop. The frames carry `failed` now, so the
    // hook has something to pass.
    const fake = recordingSource()
    const host = await mount(fake.source)

    // An outage: the kerb's own readings are retained by `retainFailedPoles` upstream of here, and the
    // round names the kerb. Attributed through `memberStopIds`, so a **pole** id lands on the card for the
    // merged place it belongs to — and on that card only.
    await fake.deliver([reading(POLE_A, '10:04')], [refusing])
    expect(visibleText(host)).toEqual([
      'now=set',
      `${PLACE_A}|42|9|${POLE_A}|${POLE_A}`,
      `${PLACE_B}|130|3||`,
    ])

    // Recovery, within one round. The set is replaced and never merged, so an absent argument clears it —
    // the direction ADR-077 chose precisely so a stale claim cannot survive its own outage.
    await fake.deliver([reading(POLE_A, '10:06')])
    expect(visibleText(host)).toEqual([
      'now=set',
      `${PLACE_A}|42|9|${POLE_A}|`,
      `${PLACE_B}|130|3||`,
    ])
  })

  it('marks a card whose kerb refused before any reading ever arrived', async () => {
    // The narrow case that made this a row of its own rather than a nicety: `retainFailedPoles` cannot
    // resurrect, so a kerb refusing on the very first round contributes no readings at all. Without the
    // failure set on the frame that card is empty and silent — indistinguishable from a stop with no buses
    // due, which is the exact defect ADR-073 exists to prevent, one screen over.
    const fake = recordingSource()
    const host = await mount(fake.source)
    await fake.deliver([], [refusing])
    expect(visibleText(host)).toEqual([
      'now=set',
      `${PLACE_A}|42|9||${POLE_A}`,
      `${PLACE_B}|130|3||`,
    ])
  })

  it('an empty failure set and an absent one are the same thing', async () => {
    // On the wire the field is omitted when empty; a fake transport, a generated client or a JSON
    // round-trip may materialise `[]`. A card that flipped on the difference would light up every place in
    // the app the day some producer stopped omitting it — `StopCardView.incomplete` reads length, never
    // presence, for exactly this reason (ADR-077 decision 4).
    const fake = recordingSource()
    const host = await mount(fake.source)
    await fake.deliver([reading(POLE_A, '10:04')], [])
    const withEmpty = visibleText(host)
    await fake.deliver([reading(POLE_A, '10:04')], undefined)
    expect(visibleText(host)).toEqual(withEmpty)
  })
})
