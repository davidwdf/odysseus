// Search's results list keeps its place — the offset a native navigation stack gives away free, and the
// last piece of this screen an unmount used to throw away (ADR-109).
//
// WHAT MAKES THIS TESTABLE AT ALL, AND WHAT DOES NOT
// jsdom runs no layout: every element reports `scrollHeight` and `clientHeight` as 0, so nothing is ever
// scrollable and the restore would never fire. Those two properties are stubbed on the prototype for the
// duration of this file — a declaration that says "the list is 5 000 px of content in a 500 px box" — and
// nothing else is. `scrollTop` in particular is jsdom's own: it stores what you assign and reads it back,
// which is exactly the quantity under test.
//
// The stub is also a control. `unscrollable()` sets the two equal, which is the honest model of a screen
// whose results have not landed yet, and the third test below is entirely about what the hook must NOT do
// in that state.
//
// THE ROUTER IS REAL AND SO IS THE HISTORY. `createMemoryRouter` is the same data router the shell builds
// (ADR-101), and `navigate(-1)` is a real POP, which is the only way to exercise the thing that matters:
// react-router hands back the *same* `location.key` for an entry a rider returns to, and that key is the
// identity the offset is stored against.

import type { SearchIndex } from '@nextbus/core'
import corpus from '@nextbus/core/spec/search.spec.json'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SCROLL_OFFSETS,
  readScrollOffset,
  SCROLL_OFFSETS_STORAGE_KEY,
  writeScrollOffset,
} from '../src/lib/scrollOffsets'

// ── the one seam ───────────────────────────────────────────────────────────────────────────────

interface CorpusCase {
  name: string
  args: { index: SearchIndex }
}
const CASES = corpus.groups.searchView.cases as unknown as CorpusCase[]
const FIXTURE = CASES.find((c) => c.name === 'a-route-query-narrows-to-its-matches')
if (!FIXTURE) throw new Error('the searchView corpus case this suite scrolls through moved')
const INDEX: SearchIndex = FIXTURE.args.index

vi.mock('../src/adapters/datasource', () => ({
  dataSource: {
    getSearchIndex: () => Promise.resolve(INDEX),
    getClientPolicy: () => Promise.resolve(undefined),
  },
}))

// ── the layout jsdom does not have ─────────────────────────────────────────────────────────────

const layout = { scrollHeight: 5000, clientHeight: 500 }
function scrollable(): void {
  layout.scrollHeight = 5000
  layout.clientHeight = 500
}
function unscrollable(): void {
  layout.scrollHeight = 0
  layout.clientHeight = 0
}

beforeEach(() => {
  for (const [property, read] of [
    ['scrollHeight', () => layout.scrollHeight],
    ['clientHeight', () => layout.clientHeight],
  ] as const) {
    Object.defineProperty(window.HTMLElement.prototype, property, {
      configurable: true,
      get: read,
    })
  }
  scrollable()
  window.sessionStorage.clear()
  document.body.innerHTML = '<div id="host"></div>'
  const found = document.getElementById('host')
  if (!found) throw new Error('unreachable: the host div was just written')
  host = found
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  for (const property of ['scrollHeight', 'clientHeight']) {
    // biome-ignore lint/performance/noDelete: restoring the prototype is the point — a stubbed accessor left behind would leak into every later suite in this worker
    delete (window.HTMLElement.prototype as unknown as Record<string, unknown>)[property]
  }
  vi.restoreAllMocks()
})

// ── the harness ────────────────────────────────────────────────────────────────────────────────

let host: HTMLElement
let root: Root | null = null
let router: ReturnType<typeof createMemoryRouter>

/**
 * The shell's shape, minus everything this file is not about: two destinations, one of which is Search.
 *
 * `Search` is imported at module scope rather than per test — unlike `search-states.test.tsx`, this suite
 * *wants* `useSearchIndex`'s module memo to persist, because a rider returning to Search with the index
 * already in hand is precisely the journey under test and the reason the restore lands before the first
 * paint rather than a frame later.
 */
async function mountAt(path: string): Promise<void> {
  const { Search } = await import('../src/screens/Search')
  router = createMemoryRouter(
    [
      { path: '/search', element: <Search /> },
      { path: '/stop/:id', element: <p>a place</p> },
    ],
    { initialEntries: [path] },
  )
  root = createRoot(host)
  act(() => {
    root?.render(<RouterProvider router={router} />)
  })
  await settle()
}

/** Wait — bounded — until the index has arrived and the skeleton has gone. */
async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!host.querySelector('.animate-pulse')) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error('the screen never left its loading state')
}

async function go(to: string | number): Promise<void> {
  await act(async () => {
    await router.navigate(to as string)
  })
  if (host.querySelector('.animate-pulse')) await settle()
}

/** The results list — the element whose offset is the subject. */
function list(): HTMLElement {
  const found = host.querySelector('.overflow-y-auto')
  if (!(found instanceof window.HTMLElement)) throw new Error('the results list is not in the tree')
  return found
}

/** Every offset currently stored, whatever the entry keys happen to be. */
function storedOffsets(): number[] {
  const raw = window.sessionStorage.getItem(SCROLL_OFFSETS_STORAGE_KEY)
  return raw === null ? [] : Object.values(JSON.parse(raw) as Record<string, number>)
}

// ── the claims ─────────────────────────────────────────────────────────────────────────────────

describe('Search keeps its place in the results', () => {
  it('restores the offset when the rider comes back to the same entry', async () => {
    await mountAt('/search?q=1')
    list().scrollTop = 420

    await go('/stop/KMB%3A1')
    expect(host.querySelector('.overflow-y-auto')).toBeNull() // the screen really did unmount
    await go(-1)

    expect(list().scrollTop).toBe(420)
  })

  it('does not carry one entry’s offset into another', async () => {
    await mountAt('/search?q=1')
    list().scrollTop = 420
    await go('/stop/KMB%3A1')

    // A second search reached from somewhere else is a new history entry with its own key, so it owes the
    // rider nothing — the stored offset belongs to the entry behind, and stays there.
    await go('/search?q=2')

    expect(list().scrollTop).toBe(0)
    expect(storedOffsets()).toContain(420)
  })

  it('leaves the list alone when the query changes under it', async () => {
    await mountAt('/search?q=1')
    list().scrollTop = 420

    // Typing rewrites the URL in place (ADR-102's `replace: true`), and react-router keeps the screen —
    // and therefore the scrolling element — mounted across it. The new entry has no stored offset, and
    // the right answer is to touch nothing: the browser clamps the offset against the narrower result set
    // by itself, which is what the RN list does too. A hook that scrolled to the top here would be
    // yanking the list out from under a rider mid-keystroke.
    await go('/search?q=2')

    expect(list().scrollTop).toBe(420)
  })

  it('keeps a saved offset it never managed to apply, rather than writing 0 over it', async () => {
    // The load-bearing case, and the one that makes the hook safe under `<StrictMode>`: a mount that ends
    // before the list has anything to scroll must not treat its own 0 as the rider's answer.
    await mountAt('/search?q=1')
    list().scrollTop = 420
    await go('/stop/KMB%3A1')

    unscrollable()
    await go(-1)
    expect(list().scrollTop).toBe(0) // nothing to apply it to yet
    await go('/stop/KMB%3A1') // …and away again before the results land

    expect(storedOffsets()).toContain(420)
    expect(storedOffsets()).not.toContain(0)

    scrollable()
    await go(-1)
    expect(list().scrollTop).toBe(420)
  })

  it('saves on pagehide, which is the only save a reload gets', async () => {
    await mountAt('/search?q=1')
    list().scrollTop = 260

    // No React cleanup runs when a document goes away, so without this listener the one navigation that
    // most looks like it should restore — refresh the page you are on — is the one that would not.
    act(() => {
      window.dispatchEvent(new window.Event('pagehide'))
    })

    expect(storedOffsets()).toContain(260)
  })
})

describe('the offset store', () => {
  it('reads back what it wrote, and nothing for an entry it has never seen', () => {
    writeScrollOffset('abc', 128)
    expect(readScrollOffset('abc')).toBe(128)
    expect(readScrollOffset('def')).toBeNull()
  })

  it('drops the oldest entries past the cap and keeps the newest', () => {
    for (let i = 0; i < MAX_SCROLL_OFFSETS + 10; i += 1) writeScrollOffset(`key-${i}`, i)
    expect(readScrollOffset('key-0')).toBeNull()
    expect(readScrollOffset('key-9')).toBeNull()
    expect(readScrollOffset('key-10')).toBe(10)
    expect(readScrollOffset(`key-${MAX_SCROLL_OFFSETS + 9}`)).toBe(MAX_SCROLL_OFFSETS + 9)
    expect(
      Object.keys(JSON.parse(window.sessionStorage.getItem(SCROLL_OFFSETS_STORAGE_KEY) ?? '{}'))
        .length,
    ).toBe(MAX_SCROLL_OFFSETS)
  })

  it('rewriting an entry keeps it, rather than ageing it out', () => {
    // The `delete` before the re-add: without it a key rewritten on every scroll would keep its original
    // insertion position and be trimmed away while newer, less-used entries survived.
    writeScrollOffset('old', 1)
    for (let i = 0; i < MAX_SCROLL_OFFSETS - 1; i += 1) writeScrollOffset(`filler-${i}`, i)
    writeScrollOffset('old', 2)
    writeScrollOffset('one-more', 0)
    expect(readScrollOffset('old')).toBe(2)
  })

  it('treats a corrupt blob as no blob', () => {
    window.sessionStorage.setItem(SCROLL_OFFSETS_STORAGE_KEY, '{"a":')
    expect(readScrollOffset('a')).toBeNull()
    window.sessionStorage.setItem(SCROLL_OFFSETS_STORAGE_KEY, '["a"]')
    expect(readScrollOffset('0')).toBeNull()
  })
})
