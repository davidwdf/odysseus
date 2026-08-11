// `useLiveRoute` tags each round with the route it came from — the one frame a screen would otherwise get wrong.
//
// WHY THIS IS ITS OWN FILE, AND NOT A CASE IN `route-live-times.test.tsx`
// The hazard is a **single pre-effect frame**. The hook drops its round in an effect, and an effect runs after
// paint, so when a rider flips direction (or navigates Back) the route id and the payload change one commit
// before the drop. Driving that through the screen cannot observe it — by the time anything can be read the
// effect has run — so the assertion lives where the frame is visible: on the hook's own return value, one
// render after the route changed and before its effects settle. What it protects is real: without the tag,
// that frame merges the previous route's round into the new route's document, filtering every reading out as
// another route's (a screen of blank rows) and applying the old route's `failed` to kerbs on a route nothing
// asked about.

import type { DataSource, Eta, EtaFailure } from '@nextbus/core'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLiveRoute } from '../src/hooks/useLiveRoute'

const ROUTE_A = 'CTB:91:outbound:1'
const ROUTE_B = 'CTB:91:inbound:1'

function reading(routeId: string): Eta {
  return {
    routeId,
    stopId: 'CTB:001028',
    operator: 'CTB',
    arrivals: ['2026-08-11T22:35:00+08:00'],
    dataTimestamp: '2026-08-11T22:29:12+08:00',
    observedAt: '2026-08-11T14:29:20.000Z',
  }
}

/** A `DataSource` stub that is only ever asked to watch a route — the one method this hook calls. */
function recordingSource() {
  const opened: { routeId: string; listener: (etas: Eta[], failed?: EtaFailure[]) => void }[] = []
  const source = {
    watchRoute: (routeId: string, listener: (etas: Eta[], failed?: EtaFailure[]) => void) => {
      opened.push({ routeId, listener })
      return { unsubscribe: () => {} }
    },
  } as unknown as DataSource
  return { opened, source }
}

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.getElementById('host')
  if (!host) throw new Error('unreachable: the host div was just written')
  container = host
  root = null
})

describe('useLiveRoute', () => {
  it('tags a round with the route it was watching when it arrived', () => {
    const { opened, source } = recordingSource()
    let latest: ReturnType<typeof useLiveRoute> | undefined

    function Probe({ routeId }: { routeId: string }) {
      latest = useLiveRoute(routeId, { source, wanted: true })
      return null
    }

    root = createRoot(container)
    act(() => {
      root?.render(<Probe routeId={ROUTE_A} />)
    })
    act(() => {
      opened[0]?.listener([reading(ROUTE_A)], [])
    })
    expect(latest?.round?.routeId, 'the round is not tagged at all').toBe(ROUTE_A)

    // The direction toggle: the same component, a different route id. Whatever the hook is still holding is
    // route A's — so a consumer comparing the tag against the payload it is rendering will not merge it.
    act(() => {
      root?.render(<Probe routeId={ROUTE_B} />)
    })
    expect(
      latest?.round?.routeId ?? ROUTE_A,
      'a round survived onto another route untagged',
    ).not.toBe(ROUTE_B)
  })
})
