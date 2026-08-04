// @vitest-environment jsdom
//
// The React Native screen's conformance suite: **the same published spec the DOM screen drives** (WP6-2,
// ADR-084) — `packages/contract/ui/nearby.spec.json`, one file, two renderers, nine states.
//
// WHY BOTH SIDES OF THIS EXIST
// ADR-069's honest gap was a projection suite on one renderer and none on the other, and the asymmetry
// pointed the wrong way: `apps/mobile` is the app riders use today. The same asymmetry would have opened
// again here — a screen spec driven only by the app that has not shipped — so this file is the RN half, and
// it is the one that measures the *reference implementation* against the specification extracted from it.
//
// THE SEAMS ARE MOCKED; THE SCREEN AND THE QUERY ARE REAL. Four seams (`useLocation`, `useLiveNearby`,
// `useClientPolicy`, the `DataSource`) plus two platform modules the screen reaches for and jsdom has no
// answer for (`expo-router`'s navigation, the safe-area insets). TanStack Query is deliberately **not**
// mocked: `loading`, `failed` and `content` *are* its states.
//
// The fixtures come from the corpus — `stop-card.spec.json`'s `nearbyView` group supplies both the
// `NearbyStop[]` the data source returns and the `StopCardView[]` the screen must draw, with `now` pinned to
// the case's own clock — so this suite's golden and the DOM suite's are the same bytes.

import nearbySpec from '@nextbus/contract/ui/nearby.spec.json'
import stopRowSpec from '@nextbus/contract/ui/stop-row.spec.json'
import {
  CLIENT_POLICY_DEFAULTS,
  type Locale,
  type NearbyStop,
  type StopCardView,
} from '@nextbus/core'
import corpus from '@nextbus/core/spec/stop-card.spec.json'
import { CATALOGUE, type MessageKey, t } from '@nextbus/i18n'
import type { LocationState } from '@nextbus/ports'
import { conformStates, type RenderedTree, type StatefulHarness } from '@nextbus/ui-spec'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LOCALE: Locale = 'en'

const NEARBY_CASES = corpus.groups.nearbyView.cases
const found = {
  withStops: NEARBY_CASES.find((c) => c.args.stops.length > 0),
  withoutStops: NEARBY_CASES.find((c) => c.args.stops.length === 0),
}
if (!found.withStops || !found.withoutStops) throw new Error('the nearbyView corpus group moved')
// Re-bound after the guard rather than narrowed through it: `apps/mobile` resolves **TypeScript 6.0.3**
// while every other package is on 5.9.3 (ADR-069's incidental finding), and 6.0 does not carry the
// narrowing from a module-level throw into a nested closure. Two `const`s cost nothing and compile on both.
const WITH_STOPS = found.withStops
const WITHOUT_STOPS = found.withoutStops

const NOW = Date.parse(WITH_STOPS.args.now)

function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

let locationState: LocationState = { status: 'loading' }
let nearby: () => Promise<NearbyStop[]> = () => Promise.resolve([])

vi.mock('../lib/useLocation', () => ({
  useLocation: () => ({ state: locationState, request: () => {} }),
}))
vi.mock('../lib/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../lib/useLiveNearby', () => ({ useLiveNearby: () => ({ now: NOW }) }))
vi.mock('../lib/datasource', () => ({
  dataSource: { getNearby: () => nearby(), getClientPolicy: () => Promise.resolve(undefined) },
}))
// The two platform modules. `expo-router` cannot load outside Metro and the safe-area context needs a
// provider that has nothing to do with what is under test; both are replaced with the smallest thing the
// screen actually uses. Navigation *destinations* are asserted from the spec, not from here.
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// `useLocale` reaches `expo-localization`, which loads `expo-modules-core`, which references `__DEV__` — a
// Metro global that does not exist here. Pinning the locale is the right answer rather than defining the
// global: the corpus fixtures are `en`, so a locale this suite did not control would silently compare an
// English projection against a Chinese render. What `useLocale` *resolves* is `resolveLocale`'s job and is
// tested where that lives; the DOM suite reaches the same pinned value through the provider's own fallback.
vi.mock('../providers/LocaleProvider', () => ({ useLocale: () => 'en' }))

const Nearby = (await import('../app/(tabs)/index')).default

let container: HTMLElement
let root: Root | null = null

/** `react-native-web` renders a `Pressable` as `div[role="button"]`, where the DOM app writes `<button>`. */
const INTERACTIVE = '[role="button"], button, a[href]'

function readTree(host: HTMLElement): RenderedTree {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const text: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) text.push(value)
    node = walker.nextNode()
  }
  const interactive = [...host.querySelectorAll(INTERACTIVE)]
  return {
    text,
    interactive: interactive.length,
    nestedInteractive: interactive.filter((el) => el.parentElement?.closest(INTERACTIVE)).length,
  }
}

function translate(key: string, args?: Record<string, unknown>): string {
  if (!(key in CATALOGUE)) {
    throw new Error(`the spec names message \`${key}\`, which is not in @nextbus/i18n's catalogue`)
  }
  const read = t as unknown as (
    locale: Locale,
    key: MessageKey,
    args?: Record<string, unknown>,
  ) => string
  return read(LOCALE, key as MessageKey, args)
}

function mount(): RenderedTree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  act(() => {
    root?.render(
      <QueryClientProvider client={client}>
        <Nearby />
      </QueryClientProvider>,
    )
  })
  return readTree(container)
}

/** Mount, then wait — bounded — until the screen has left its loading branch. See the DOM suite's note. */
async function mountSettled(): Promise<RenderedTree> {
  mount()
  const locating = translate('locating')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tree = readTree(container)
    if (!tree.text.includes(locating)) return tree
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(
    `the screen never left its loading state — text: ${JSON.stringify(readTree(container).text)}`,
  )
}

const READY = { status: 'ready', lat: 22.38, lng: 114.19, stale: false } as const
const FETCH_FAILURE = 'nearby: 502 upstream'

async function fixture(state: string): Promise<{ view: unknown; tree: RenderedTree } | null> {
  const cards = fromCorpus<StopCardView[]>(WITH_STOPS.expect)
  switch (state) {
    case 'undetermined':
      locationState = { status: 'undetermined' }
      return { view: {}, tree: mount() }
    case 'denied':
      // `canAskAgain: false` is the case a native build answers with "open Settings" instead of "retry" —
      // and it cannot be observed here, because under `react-native-web` `Platform.OS` is `web`. The spec's
      // `retry` slot carries that divergence as an invariant so it is visible rather than discovered.
      locationState = { status: 'denied', canAskAgain: false }
      return { view: {}, tree: mount() }
    case 'locationError':
      locationState = { status: 'error', message: 'no fix available' }
      return { view: { error: 'no fix available' }, tree: mount() }
    case 'loading':
      locationState = { status: 'loading' }
      return { view: {}, tree: mount() }
    case 'content':
      locationState = READY
      nearby = () => Promise.resolve(fromCorpus<NearbyStop[]>(WITH_STOPS.args.stops))
      return { view: { cards }, tree: await mountSettled() }
    case 'stale':
      locationState = { ...READY, stale: true }
      nearby = () => Promise.resolve(fromCorpus<NearbyStop[]>(WITH_STOPS.args.stops))
      return { view: { cards }, tree: await mountSettled() }
    case 'empty':
      locationState = READY
      nearby = () => Promise.resolve(fromCorpus<NearbyStop[]>(WITHOUT_STOPS.args.stops))
      return { view: { cards: [] }, tree: await mountSettled() }
    case 'failed':
      locationState = READY
      nearby = () => Promise.reject(new Error(FETCH_FAILURE))
      return { view: { error: FETCH_FAILURE }, tree: await mountSettled() }
    default:
      return null
  }
}

beforeEach(() => {
  locationState = { status: 'loading' }
  nearby = () => Promise.resolve([])
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('apps/mobile conforms to Nearby’s published spec, state by state', () => {
  it('has the states the spec declares, and the corpus cases each is driven from', () => {
    expect(nearbySpec.component).toBe('Nearby')
    expect(Object.keys(nearbySpec.states).length).toBeGreaterThanOrEqual(8)
    expect(NEARBY_CASES.length).toBeGreaterThanOrEqual(3)
  })

  for (const state of Object.keys(nearbySpec.states)) {
    it(`in ${state}`, async () => {
      const rendered = await fixture(state)
      const harness: StatefulHarness = {
        render: () => rendered?.tree ?? { text: [], interactive: 0, nestedInteractive: 0 },
        translate,
        renderState: (asked) => (asked === state ? rendered : null),
      }
      const findings = conformStates(nearbySpec, harness, { StopRow: stopRowSpec }).filter(
        (f) => !f.message.includes('cannot be put into it') || f.message.includes(`\`${state}\``),
      )
      expect(findings).toEqual([])
    })
  }
})
