// **A bare "Favourites" heading is a claim about the rider's own list. This screen made it out of our
// silence** — the same defect ADR-124 closed on Nearby, one screen over, and the one this file pins.
//
// Favourites has no `noService` sentence to get wrong, so the false state is quieter and worse: with every
// query parked, `cards` is `[]`, `loading` was false (it read `isLoading`, which is `isPending &&
// isFetching`, and nothing is fetching) and `failure` was undefined (nothing had reached `error` yet), so
// the screen fell through to its list arm and drew **the title and nothing else** — which is exactly the
// `mustNot` its spec's `failed` state already carries: *"a heading with an empty list, which reads as 'you
// have nothing saved'"*. For a list the rider curated by hand, that is the app forgetting their work.
//
// The parking gate that is still live after ADR-124 is the focus one: `retryer.canContinue()` ANDs
// `focusManager.isFocused()`, so a retry scheduled while `document.visibilityState === 'hidden'` waits for
// `visibilitychange`. That is deliberate — parking a retry in a tab nobody is looking at is right — so the
// screen has to be honest about it: branch on `isPending` (**status alone**), and let the skeleton be the
// fallback, because the wait is real.
//
// WHY THIS FILE IS SEPARATE FROM `favourites-states.test.tsx`. That suite builds its own `QueryClient` with
// `retry: false` against a visible jsdom document, so neither pause gate is reachable in it (ADR-124's own
// warning: *a suite that configures away the environment cannot see an environmental defect*). This one
// mounts the app's real `QueryProvider` and nothing else, the way `nearby-offline.test.tsx` does.
//
// WHAT IS DIFFERENT HERE, AND IT IS THE INTERESTING PART: this screen fans out **one query per saved pole**,
// so "we have no answer" is an aggregate. The spec answers it — `loading` is *"no card has arrived yet"*, and
// *"a card that has arrived is drawn immediately rather than held for its siblings"* — so the rule is per
// screen, not per query: something still pending **and** nothing to show is the skeleton; a card that
// resolved is drawn even while its siblings are parked. The last two tests are that pair.

import { CLIENT_POLICY_DEFAULTS, favouritesView, type Locale, type StopDetail } from '@nextbus/core'
import corpus from '@nextbus/core/spec/favourites.spec.json'
import { t } from '@nextbus/i18n'
import { onlineManager, type QueryClient, useQueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryProvider } from '../src/providers/QueryProvider'

const LOCALE: Locale = 'en'

interface CorpusCase {
  name: string
  args: { saved: string[]; places: StopDetail[]; locale: Locale; now: string }
}

const CASES = corpus.groups.favouritesView.cases as unknown as CorpusCase[]

function caseNamed(name: string): CorpusCase {
  const found = CASES.find((c) => c.name === name)
  if (!found) throw new Error(`the favouritesView corpus case \`${name}\` moved`)
  return found
}

/** The corpus states an absent optional as JSON `null`; TypeScript's absent value is `undefined`. */
function fromCorpus<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === null ? undefined : v)) as T
}

// Two saved poles of two *different* places, one of which resolves — the corpus's own case for a partial
// screen, so the "some parked, some answered" test below is driven by the same bytes as the kernel suite.
const PARTIAL = caseNamed('a-place-whose-query-has-not-resolved-is-absent')
const RESOLVED_PLACE = fromCorpus<StopDetail[]>(PARTIAL.args.places)[0] as StopDetail
/** Which pole id the resolving place answers to — the first saved key's stop, per the corpus case. */
const RESOLVES = 'CTB:001992'

/** The heading the resolved card draws, computed through the kernel rather than written out. */
const CARD_HEADING = (() => {
  const cards = favouritesView(
    { saved: PARTIAL.args.saved, places: [RESOLVED_PLACE] },
    { locale: LOCALE, now: Date.parse(PARTIAL.args.now), policy: CLIENT_POLICY_DEFAULTS },
  )
  const label = cards[0]?.name.label
  if (!label) throw new Error('the favouritesView corpus case produces no card')
  return label
})()

let stop: (id: string) => Promise<StopDetail> = () => Promise.reject(new Error('no fixture set'))

vi.mock('../src/hooks/useClientPolicy', () => ({
  useClientPolicy: () => ({ policy: CLIENT_POLICY_DEFAULTS, source: 'defaults' }),
}))
vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getStop: (id: string) => stop(id),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

const { Favourites } = await import('../src/screens/Favourites')
const { usePreferences } = await import('../src/lib/preferences')

let container: HTMLElement
let root: Root | null = null
let client: QueryClient | null = null

/** Renders nothing; exists so a test can invalidate the screen's own queries from outside it. */
function Grab() {
  client = useQueryClient()
  return null
}

function text(): string[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  let node = walker.nextNode()
  while (node) {
    const value = (node.textContent ?? '').trim()
    if (value) out.push(value)
    node = walker.nextNode()
  }
  return out
}

/**
 * Whether the skeleton is on screen.
 *
 * **An element, not a word, and that is what makes this suite able to see the defect at all**: the loading
 * state on this screen has no text, so "the title and nothing else" is *also* what the honest wait looks
 * like textually. The two states are told apart only by the pulsing block — the same condition
 * `favourites-states.test.tsx` waits on.
 */
function skeleton(): boolean {
  return container.querySelector('.animate-pulse') !== null
}

function mount() {
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <QueryProvider>
          <Grab />
          <Favourites />
        </QueryProvider>
      </MemoryRouter>,
    )
  })
}

/** Real time in 50 ms slices, flushing React between each — see `query-failure-state.test.tsx`. */
async function tick(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 50) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
}

/** Tick until `phrase` is on screen, and fail naming what was there instead. */
async function tickUntil(phrase: string, maxMs = 3_000) {
  for (let elapsed = 0; elapsed < maxMs; elapsed += 50) {
    if (text().includes(phrase)) return
    await tick(50)
  }
  throw new Error(`never rendered ${JSON.stringify(phrase)} — text: ${JSON.stringify(text())}`)
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  localStorage.clear()
  client = null
  stop = () => Promise.reject(new Error('no fixture set'))
  usePreferences.setState({ favoriteRoutes: [...PARTIAL.args.saved] })
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  usePreferences.setState({ favoriteRoutes: [] })
  // Module singletons shared by every suite in this process — put them back, or the next file starts
  // offline in a hidden tab. See `query-failure-state.test.tsx` on why `setOnline` and not an event.
  setVisibility('visible')
  act(() => {
    onlineManager.setOnline(true)
  })
})

const OFFLINE = () => Promise.reject(new TypeError('Failed to fetch'))
// The catalogue keys keep their `favorites` spelling (CLAUDE.md rule 5: code is exempt); the *strings*
// they resolve to are the British ones a rider reads.
const TITLE = t(LOCALE, 'tabFavorites')
const EMPTY_TITLE = t(LOCALE, 'favoritesEmpty')

describe('Favourites never renders a rider’s list as empty out of its own silence', () => {
  it('says the list is empty only when the rider really has saved nothing', async () => {
    // The control that makes every assertion below mean something: the empty state is still reachable, and
    // it is still what a rider with nothing saved sees — words, not a bare heading.
    usePreferences.setState({ favoriteRoutes: [] })
    mount()
    await tick(200)
    expect(text()).toContain(EMPTY_TITLE)
  })

  it('does not, while a hidden document has the retries parked', async () => {
    // **The regression.** Every query fails its first attempt and parks its retry behind the focus gate, so
    // `isLoading` is false (nothing is fetching), `isError` is false (no query has given up) and `cards` is
    // empty — the three conditions that used to leave the screen as its own title. The wait is real, so the
    // skeleton is the honest arm.
    setVisibility('hidden')
    stop = OFFLINE
    mount()
    await tick(1_500)
    // **The state itself, asserted first, so this test cannot pass vacuously.** Both queries sit at
    // `{status: 'pending', fetchStatus: 'paused', fetchFailureCount: 1}` — one attempt made, the retry parked
    // behind the focus gate — which is precisely the state `isLoading` calls false. If that gate ever stopped
    // parking (a library change, or a jsdom that reports the document visible) the queries would settle on
    // `error`, the screen would honestly show the reason, and the assertions below would still hold while
    // measuring nothing.
    const parked = client
      ?.getQueryCache()
      .findAll({ queryKey: ['stop'] })
      .map((q) => `${q.state.status}/${q.state.fetchStatus}/${q.state.fetchFailureCount}`)
    expect(parked).toEqual(['pending/paused/1', 'pending/paused/1'])
    // **The remaining assertion is an element, not a word**, and the reason is worth stating because the
    // first draft of this test got it wrong: the loading state has no words, so `text()` is `['Favourites']`
    // either way — before the fix and after it.
    expect(skeleton(), 'the screen is its title and nothing else').toBe(true)
    // The spec's `title` slot is invariant across every state, this one included.
    expect(text()).toContain(TITLE)
    // And the screen must never borrow the *other* empty state's words: nothing has been un-saved.
    expect(text()).not.toContain(EMPTY_TITLE)
    expect(text()).not.toContain('Failed to fetch')
  })

  it('says why, once the queries have actually given up', async () => {
    // The other half of the pair, and the state the spec calls `failed`: visible document, retries run and
    // are exhausted, so there is a reason and the rider gets it verbatim. `networkMode: 'always'` is what
    // makes an offline device reach it at all (ADR-124).
    stop = OFFLINE
    mount()
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    await tickUntil('Failed to fetch')
    expect(skeleton(), 'the skeleton outlived the failure').toBe(false)
  })

  it('draws a card that arrived while its siblings are still parked', async () => {
    // The aggregate rule, from the spec's `loading` state: *"a card that has arrived is drawn immediately
    // rather than held for its siblings"*. One pole answers, the other's retry is parked in a hidden tab —
    // the partial list is what the rider gets, not a skeleton over the top of it.
    //
    // **This is the guard against over-fixing**, and it is why the screen's `loading` is `nothingToShow &&
    // some(isPending)` rather than `some(isPending)`: dropping either half turns one parked sibling into a
    // skeleton over a list that had already arrived, which is a rider losing a card they could read.
    setVisibility('hidden')
    stop = (id) => (id === RESOLVES ? Promise.resolve(RESOLVED_PLACE) : OFFLINE())
    mount()
    await tickUntil(CARD_HEADING)
    expect(skeleton(), 'one answered card was hidden behind its siblings’ skeleton').toBe(false)
  })

  it('keeps the last known cards when a refresh fails, rather than replacing them with the reason', async () => {
    // ADR-058's `offline` state, which this screen's spec states as *"the last known cards, aged and marked
    // stale"* and *"never a blank list"*. `networkMode: 'always'` makes a failed refresh common where a
    // paused one used to hide it, so the error arm has to fire **only when there is nothing else to show**.
    stop = () => Promise.resolve(RESOLVED_PLACE)
    mount()
    await tickUntil(CARD_HEADING)

    stop = OFFLINE
    await act(async () => {
      await client?.invalidateQueries({ queryKey: ['stop'] })
    })
    await tick(2_000)

    expect(text()).toContain(CARD_HEADING)
    expect(text()).not.toContain('Failed to fetch')
  })
})
