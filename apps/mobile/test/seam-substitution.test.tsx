// @vitest-environment jsdom
import { createLiveEtaController, createMemoryTransport, EdgeClient } from '@nextbus/api-client'
import {
  applyLiveEtasToStopDetail,
  type DataSource,
  dedupeRoutes,
  type Eta,
  type EtaListener,
  etaReadout,
  resolveClientPolicy,
  type ServerFrame,
  type StopDetail,
  type Subscription,
  type WatchTarget,
} from '@nextbus/core'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { View } from 'react-native'
import { describe, expect, it } from 'vitest'
import { EtaBadge } from '../components/EtaBadge'
import { Text } from '../components/Text'
import { useLiveEtas } from '../lib/useLiveEtas'

// **WP5-2: ADR-004 converted from an aspiration into something that runs.**
//
// The row's own acceptance was *"substitute a `FakeSocketDataSource`; `git diff --stat` shows zero lines
// changed under `apps/mobile/app/**` and `components/**`"*. That measurement is vacuous by construction: the
// diff is zero **because nobody edits a screen while running a test**, and it was zero on the day the row was
// written for a second reason — `watch()` had no callers at all, so there was no path from the seam to a
// screen to leave unchanged. WP5-0 built the path (`lib/useLiveEtas.ts`); this asserts the property the diff
// was standing in for: *feed the identical readings through two completely different engines and the rider
// sees the same thing.*
//
// Two data sources, sharing nothing below the seam:
//
//   · `EdgeClient` with a stubbed `fetch` — the **poll emulator**, which issues real `/v1/stop/:id` and
//     `/v1/etas/:id` requests, synthesizes a `snapshot` from the second, and is what ships today.
//   · `FakeSocketDataSource` — a hand-written `DataSource` whose `watch()` is a `createMemoryTransport`
//     replaying the frames a shard would push. No HTTP for the readings at all.
//
// Both assertions matter and they are different: the **rendered text** is what a rider gets, and the
// **query-cache payload** is what ADR-058 persists and what every other consumer of that key would read.
// Comparing only the first would miss a merge that dropped `stop`/`members` while the two rows happened to
// render the same; comparing only the second would miss a component that ignored a field.
//
// What this does not cover, stated rather than implied: iOS/Android *native* rendering (nothing in a JS test
// can), and the screen's layout, which `stoprow-projection.test.tsx` covers for the Nearby card. What it does
// cover is the data path a screen is made of — seam → controller → transport → reducer → query cache →
// kernel merge → the real `EtaBadge`.

const STOP_ID = 'KMB:A'
const ROUTE_1 = 'KMB:1:outbound:1'
const ROUTE_6 = 'KMB:6:outbound:1'
/** Fixed, because `etaReadout` takes `now` explicitly — the kernel never reads a clock. */
const NOW = Date.parse('2026-07-30T02:00:00.000Z')
const POLICY = resolveClientPolicy(undefined)

const i18n = (en: string) => ({ en, 'zh-Hant': en, 'zh-Hans': en })

/** The stop as `/v1/stop/:id` serves it: two routes, **no** live readings. Those arrive by subscription. */
const STOP_DETAIL: StopDetail = {
  stop: {
    id: STOP_ID,
    name: i18n('Belair Gardens'),
    location: { lat: 22.3874, lng: 114.1836 },
    sources: [{ operator: 'KMB', operatorStopId: 'A' }],
  },
  members: [
    { id: STOP_ID, name: i18n('Belair Gardens'), location: { lat: 22.3874, lng: 114.1836 } },
  ],
  routes: [
    {
      route: {
        id: ROUTE_1,
        operator: 'KMB',
        routeNo: '1',
        bound: 'outbound',
        serviceType: '1',
        origin: i18n('Sha Tin'),
        destination: i18n('Kowloon'),
      },
      eta: null,
      stopId: STOP_ID,
    },
    {
      route: {
        id: ROUTE_6,
        operator: 'KMB',
        routeNo: '6',
        bound: 'outbound',
        serviceType: '1',
        origin: i18n('Sha Tin'),
        destination: i18n('Tsim Sha Tsui'),
      },
      eta: null,
      stopId: STOP_ID,
    },
  ],
}

/** One live reading, for route 1 only — so the other row must render as "no reading", not as a stale value. */
const LIVE_ETAS: Eta[] = [
  {
    routeId: ROUTE_1,
    stopId: STOP_ID,
    operator: 'KMB',
    arrivals: ['2026-07-30T10:04:00+08:00'],
    dataTimestamp: '2026-07-30T09:59:30+08:00',
    observedAt: '2026-07-30T01:59:30.000Z',
  },
]

// ── The two data sources ───────────────────────────────────────────────────────────────────────

/** `EdgeClient` over a `fetch` that serves the fixture. The default engine: the poll emulator. */
function pollingDataSource(): DataSource {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    // `/v1/etas?ids=…` answers an `EtaBatch` since WP5-7 — one entry per requested id, each an
    // `EtaReport` (`{ etas }` with `failed` **absent**, the shape the Worker serves when every board
    // answered, ADR-073) plus the id it answers for. Spelled here rather than wrapped in a helper because
    // this fixture's whole job is to be what the real endpoint returns: a stub still serving a bare array,
    // or one that omitted `id`, would keep this suite green against a client that had stopped reading the
    // field, and the symptom would be every row rendering "—" on the real app.
    const isBatch = url.includes('/v1/etas?ids=')
    const body = isBatch
      ? {
          reports: new URL(url).searchParams.getAll('ids').map((id) => ({ id, etas: LIVE_ETAS })),
        }
      : STOP_DETAIL
    if (!isBatch && !url.includes('/v1/stop/')) {
      // A fixture that answered an endpoint the screen does not use would hide a screen that started
      // using one. Same discipline as the edge suites, which throw on an unexpected URL.
      throw new Error(`unexpected request: ${url}`)
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return new EdgeClient({ baseUrl: 'http://localhost:8787', fetchImpl })
}

/**
 * A `DataSource` whose `watch()` is a scripted socket — WP5-2's `FakeSocketDataSource`.
 *
 * The frames are written by hand rather than recorded from the poll emulator: a script derived from the
 * thing it is being compared with would make the comparison an engine agreeing with itself.
 *
 * Every method the screen does not call throws. A fake that quietly answered `getNearby` would let a screen
 * grow a second dependency without this test noticing, which is the whole class of drift being measured.
 */
function fakeSocketDataSource(): DataSource {
  const script: ServerFrame[] = [
    {
      type: 'snapshot',
      seq: 1,
      at: '2026-07-30T02:00:00.000Z',
      targets: [{ stopId: STOP_ID }],
      etas: LIVE_ETAS,
    },
    { type: 'status', at: '2026-07-30T02:00:00.000Z', state: 'live' },
  ]
  const unsupported = (name: string) => () => {
    throw new Error(`FakeSocketDataSource.${name} is not part of the path under test`)
  }
  return {
    getStop: async (stopId: string) => {
      if (stopId !== STOP_ID) throw new Error(`unexpected stop: ${stopId}`)
      return STOP_DETAIL
    },
    watch(targets: WatchTarget[], onUpdate: EtaListener): Subscription {
      const controller = createLiveEtaController({
        transport: createMemoryTransport(script),
        targets,
        emit: ({ etas }) => onUpdate([...etas]),
      })
      controller.start()
      return { unsubscribe: () => controller.stop() }
    },
    getNearby: unsupported('getNearby'),
    getRoute: unsupported('getRoute'),
    // Unsupported for the same reason as the rest: this fake exists to prove the Place screen reaches the
    // seam and nothing else, and a route watch is a different screen's subscription (ADR-116). If one ever
    // appeared on this path, this is what would say so.
    watchRoute: unsupported('watchRoute'),
    getEtas: unsupported('getEtas'),
    // Unsupported on purpose, and it is the *proof* rather than a stub: this fake drives the screen from
    // a scripted socket, so if the seam were leaking an HTTP call the batch endpoint would be reached and
    // this would throw. The poll emulator is the only thing that calls it.
    getEtasBatch: unsupported('getEtasBatch'),
    getSearchIndex: unsupported('getSearchIndex'),
    getClientPolicy: unsupported('getClientPolicy'),
  }
}

// ── The path under test ────────────────────────────────────────────────────────────────────────

/**
 * The live-fed card path, with the screen's own three lines: the query, the subscription, and a readout per
 * row. Deliberately the *data* path and not the whole Place screen — the screen's chrome needs a
 * `LocaleProvider`, a theme store and AsyncStorage-backed favourites, none of which any transport can reach,
 * and mounting them here would test jsdom rather than the seam.
 */
function StopRows({ id, source }: { id: string; source: DataSource }) {
  const query = useQuery({ queryKey: ['stop', id], queryFn: () => source.getStop(id) })
  useLiveEtas(id, { source, enabled: query.isSuccess })
  const rows = query.data ? dedupeRoutes(query.data.routes) : []
  return (
    <View>
      <Text variant="body">{query.data?.stop.name.en ?? ''}</Text>
      {rows.map((row) => {
        const readout = row.eta ? etaReadout(row.eta, 'en', NOW, POLICY) : undefined
        return (
          <View key={row.route.id}>
            <Text variant="body">{row.route.routeNo}</Text>
            {readout ? (
              <EtaBadge label={readout.label} urgency={readout.urgency} stale={readout.stale} />
            ) : (
              <Text variant="h3">—</Text>
            )}
          </View>
        )
      })}
    </View>
  )
}

/** Visible text in document order — the same walker `stoprow-projection.test.tsx` uses, and the same
 *  reason it is duplicated: it is the specification each renderer is measured against. */
function renderedText(container: HTMLElement): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const text = (node.textContent ?? '').trim()
    if (text) out.push(text)
    node = walker.nextNode()
  }
  return out
}

/** Mount against one data source, let the fetch and the first frame land, and read the screen back. */
async function renderAgainst(source: DataSource): Promise<{ text: string[]; cached?: StopDetail }> {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <StopRows id={STOP_ID} source={source} />
      </QueryClientProvider>,
    )
  })
  // Two settles: the first resolves `getStop`, which flips `isSuccess` and starts the subscription; the
  // second lets the first frame arrive and be merged.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const text = renderedText(host)
  const cached = queryClient.getQueryData<StopDetail>(['stop', STOP_ID])
  await act(async () => {
    root.unmount()
  })
  return { text, cached }
}

describe('the DataSource seam: two engines, one screen', () => {
  it('renders identically against the poll emulator and against a scripted socket', async () => {
    const polling = await renderAgainst(pollingDataSource())
    const socket = await renderAgainst(fakeSocketDataSource())

    // The anti-vacuous control, and it is not decoration: without it, a subscription that never delivered
    // anything would render `— —` through both engines and this test would pass while proving nothing. The
    // literal is hand-written — route 1 has a live reading four minutes out, route 6 has none and says so
    // rather than showing a stale value.
    expect(polling.text).toEqual(['Belair Gardens', '1', '4', 'min', '6', '—'])
    // The property WP5-2 is for.
    expect(socket.text).toEqual(polling.text)
    // …and the payload behind it, which is what ADR-058 persists under this key and what any other consumer
    // of `['stop', id]` would read. A merge that dropped `stop` or `members` would pass the text assertion.
    expect(socket.cached).toEqual(polling.cached)
    expect(socket.cached).toEqual(applyLiveEtasToStopDetail(STOP_DETAIL, LIVE_ETAS))
  })

  it('leaves the non-ETA half of the payload exactly as fetched', async () => {
    const { cached } = await renderAgainst(fakeSocketDataSource())
    // The specific regression: an earlier sketch of the merge replaced the whole `StopDetail` with the frame
    // payload, which renders as a screen with no name and no map pins. Asserted on the fields the screen
    // reads rather than on the whole object, so the reason survives a fixture change.
    expect(cached?.stop).toEqual(STOP_DETAIL.stop)
    expect(cached?.members).toEqual(STOP_DETAIL.members)
    expect(cached?.routes.map((r) => r.route)).toEqual(STOP_DETAIL.routes.map((r) => r.route))
    expect(cached?.routes.map((r) => r.stopId)).toEqual([STOP_ID, STOP_ID])
  })

  it('releases the subscription when the screen goes away', async () => {
    // A screen that unmounts must stop its engine, or a rider who opens six stops leaves six pollers behind.
    // Asserted through the seam rather than through a transport, because that is where a screen touches it.
    let released = false
    const source: DataSource = {
      ...fakeSocketDataSource(),
      watch: () => ({
        unsubscribe() {
          released = true
        },
      }),
    }
    await renderAgainst(source)
    expect(released).toBe(true)
  })
})
