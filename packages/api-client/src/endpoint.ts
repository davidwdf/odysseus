// Where the API is, and where the socket is — derived from one string, in one place.
//
// WHY A MODULE FOR TWO LINES OF STRING WORK
// Because there were four copies of the answer. `http://localhost:8787` was written out at
// `apps/mobile/lib/datasource.ts`, `apps/mobile/lib/tileSource.ts`, `apps/mobile/scripts/build-web.mjs`
// and `apps/web/src/adapters/datasource.ts` — three build systems, two variable names
// (`EXPO_PUBLIC_API_URL`, `VITE_API_URL`), no single declaration and no gate. Everything else in this
// repo has one declaration and a drift check; the one value that has to change on the day we get a
// real domain did not. Wave 5 would have made it five copies, because a socket needs the same host.
//
// The **read** of the environment variable stays in each app shell, and that is deliberate rather than
// a leftover: `process.env.EXPO_PUBLIC_*` and `import.meta.env.VITE_*` are inlined at build time by
// two different bundlers, so the read cannot be hoisted into a shared module without one of them
// seeing a dynamic property access and baking in nothing. One line per renderer, and it is the only
// line in either app's data layer that legitimately differs.
//
// WHAT THIS DOES NOT DO
// It does not validate. A base URL that is not a URL at all is passed through with the path appended,
// for the reason `liveSocketUrl` states in the kernel: the input is a configured environment variable,
// and turning a visible misconfiguration into a thrown error at first paint — or worse, into an
// invented URL — makes the failure harder to read, not easier.

import { liveSocketUrl } from '@nextbus/core'

/**
 * The local edge Worker, which is what `pnpm dev:edge` serves.
 *
 * Exported so the four sites that used to spell it out read it from here instead. It is a *default*,
 * not a fallback with a policy attached: in any real build `EXPO_PUBLIC_API_URL` / `VITE_API_URL` is
 * set, and `apps/mobile/scripts/build-web.mjs` bakes the value it used into the service worker's
 * runtime-caching routes, so a build that silently fell back to localhost would produce a PWA whose
 * caches match nothing. Keeping the default visible in one place is what lets a gate — or a reader —
 * find every consumer of it.
 */
export const DEFAULT_API_URL = 'http://localhost:8787'

/** Where this client talks. Both absolute, both without a trailing slash. */
export interface Endpoints {
  /** The HTTP origin + optional base path, e.g. `https://api.nextbus.hk`. Paths are appended raw. */
  apiUrl: string
  /** The live socket, e.g. `wss://api.nextbus.hk/v1/live` — derived, not configured (D5). */
  socketUrl: string
}

/**
 * Both endpoints from the one configured string.
 *
 * The socket URL is **derived** rather than configured, which is the whole point of D5: dropping in a
 * real domain stays one variable per renderer instead of two, and the `https:`→`wss:` half of the
 * derivation — the one that ships a rider's location in cleartext when it is forgotten, works
 * perfectly against `http://localhost:8787`, and shows no symptom — is a corpus-pinned kernel rule
 * (`liveSocketUrl`, `packages/core/spec/live.spec.json`) rather than three lines written three times.
 *
 * `socketUrlOverride` is the escape hatch for the one case derivation cannot cover: a socket tier on a
 * different host. It is passed through untouched apart from the trailing-slash strip, so a `wss://…`
 * value arrives intact. Nothing reads it from the environment yet — `EXPO_PUBLIC_LIVE_URL` /
 * `VITE_LIVE_URL` are the intended spellings and wiring them is the env-var row of this wave.
 *
 * **The trailing-slash strip is restated here, and that is a known seam.** `liveSocketUrl` strips
 * `/+$` internally because it must be self-contained to be corpus-pinned and hand-portable; the API
 * URL needs the same normalisation, and the kernel does not export it on its own. Two lines, one
 * regex, the same shape — but it is a restatement, and if a third caller ever needs it the honest fix
 * is a `normalizeApiBaseUrl` export in `packages/core/src/live.ts` with rows of its own rather than a
 * third copy here. (`EdgeClient` used to strip exactly *one* trailing slash, so `http://host//` gave
 * it `http://host/` and every path double-slashed; that copy is gone.)
 */
export function resolveEndpoints(baseUrl?: string, socketUrlOverride?: string): Endpoints {
  const apiUrl = trimTrailingSlashes(baseUrl ?? DEFAULT_API_URL)
  return {
    apiUrl,
    // No second fallback here on purpose. An empty base is a legal configuration — it means
    // "same origin, relative paths", which is what a PWA served by the Worker itself would use — and
    // `liveSocketUrl('')` gives `/v1/live`, a relative socket URL every browser resolves against the
    // page. Substituting the localhost default for it would silently point a deployed build at the
    // developer's machine, which is the failure mode a default is supposed to prevent.
    socketUrl: socketUrlOverride ? trimTrailingSlashes(socketUrlOverride) : liveSocketUrl(apiUrl),
  }
}

/** Every trailing slash, not just the last — see the note in `resolveEndpoints`. */
function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}
