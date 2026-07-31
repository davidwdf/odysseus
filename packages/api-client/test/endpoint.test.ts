// One declaration of where the API is, and one derivation of the socket URL from it.
//
// The rule itself — `http:`→`ws:`, `https:`→`wss:` — is a corpus-pinned kernel function
// (`live#liveSocketUrl`, 11 rows), so this suite does not re-test it. What it tests is the *wrapping*:
// that the default is the one constant, that the override is honoured, and that a base URL and the
// socket URL derived from it cannot disagree about trailing slashes — which is the drift that made
// `EdgeClient`'s inline `.replace(/\/$/, '')` worth deleting.

import { describe, expect, it } from 'vitest'
import { DEFAULT_API_URL, resolveEndpoints } from '../src'

describe('resolveEndpoints', () => {
  it('defaults to the local edge Worker, in one place', () => {
    // The literal that used to be spelled out at four sites in three build systems.
    expect(DEFAULT_API_URL).toBe('http://localhost:8787')
    expect(resolveEndpoints()).toEqual({
      apiUrl: 'http://localhost:8787',
      socketUrl: 'ws://localhost:8787/v1/live',
    })
  })

  it('upgrades the scheme with the host', () => {
    // The half of this that matters: forgetting `https:`→`wss:` ships a rider's location in cleartext,
    // works perfectly in dev, and shows no symptom.
    expect(resolveEndpoints('https://api.nextbus.hk')).toEqual({
      apiUrl: 'https://api.nextbus.hk',
      socketUrl: 'wss://api.nextbus.hk/v1/live',
    })
  })

  it('strips every trailing slash from both, not just the last', () => {
    // `EdgeClient` used to strip exactly one, so a configured `http://host//` double-slashed every path —
    // and some routers treat `//v1/live` as a different path, which nobody would look at twice in an
    // env file.
    expect(resolveEndpoints('http://localhost:8787///')).toEqual({
      apiUrl: 'http://localhost:8787',
      socketUrl: 'ws://localhost:8787/v1/live',
    })
  })

  it('keeps a base path', () => {
    expect(resolveEndpoints('https://example.test/edge/')).toEqual({
      apiUrl: 'https://example.test/edge',
      socketUrl: 'wss://example.test/edge/v1/live',
    })
  })

  it('passes an explicit socket URL through untouched', () => {
    // D5's escape hatch: a socket tier on another host, which derivation cannot cover.
    expect(resolveEndpoints('https://api.nextbus.hk', 'wss://live.nextbus.hk/v1/live/')).toEqual({
      apiUrl: 'https://api.nextbus.hk',
      socketUrl: 'wss://live.nextbus.hk/v1/live',
    })
  })

  it('treats an empty base as same-origin rather than substituting the default', () => {
    // A PWA served by the Worker itself is a legal configuration, and `/v1/live` is a relative socket URL
    // every browser resolves against the page. Substituting `localhost:8787` here would point a deployed
    // build at the developer's machine — the failure a default is supposed to prevent.
    expect(resolveEndpoints('')).toEqual({ apiUrl: '', socketUrl: '/v1/live' })
  })
})
