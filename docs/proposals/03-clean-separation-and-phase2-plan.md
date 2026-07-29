# 02 — Clean separation, native readiness & Phase 2

> **Status:** proposal / work plan. Drafted 2026-07-26 from a three-architecture bake-off
> (contract-first · server-heavy · strictly-layered), judged on three lenses
> (pragmatism · native-fitness · enforceability). The three lenses picked **three different
> winners**, which is the most useful signal in the exercise: each architecture is right about a
> different axis. This document takes the pragmatic spine, the enforceability engine, and the
> server-heavy principle — and explicitly drops the parts each got wrong.

## Thesis

The valuable logic is already server-side; the gap is that **domain rules leak into React Native
screen files**, where hand-written Swift and Kotlin clients will silently re-derive and diverge from
them. The fix is not a big-bang rewrite. It is: (1) make the wire a **generated contract** rather
than prose, (2) shrink the client-portable surface to a small, **deterministic, budget-capped**
kernel pinned by language-neutral fixtures, (3) push everything else **into the Worker**, and
(4) enforce all of it **mechanically**, because this repo will be worked by many agents and
boundaries held up by documentation do not survive that. Launch is never blocked by any of it.

## The three-way split, and what we take

| Lens | Winner | What we take | What we drop |
|---|---|---|---|
| Pragmatism | Contract-first | The **spine**: additive, zero-diff, keeps v1 wire, keeps TanStack Query, keeps the JSX | Premature Swift/Kotlin codegen CI |
| Native-fitness | Server-heavy | The **principle**: server owns content/order/text — elimination, not mitigation | The `/v2` view-model tier + 4-screen rewrite gating launch |
| Enforceability | Strictly-layered | The **engine**: `layers.json`, determinism lint, zero-emit proof, self-test | The repo-wide `core → domain` rename |

Two disqualifiers worth recording. The server-heavy `/v2` tier makes every copy tweak, cap change
and reordering a Worker deploy — unacceptable for a codebase whose UI is iterated live and hourly —
and it admits offline *regresses* first. The strictly-layered plan opens with a repo-wide import
codemod that serialises every other work package behind one conflict-generating PR and buys a native
client nothing. Both were rejected on execution risk, not on ideas.

### ⚠️ Correction to all three proposals (verified)

All three assumed pnpm's isolated `node_modules` makes an undeclared import unresolvable.
**`.npmrc` sets `node-linker=hoisted`** (required for Metro), so undeclared dependencies *do*
resolve today and that enforcement leg **does not exist**. Consequently the remaining mechanisms are
load-bearing rather than belt-and-braces. Related, also verified: `packages/tsconfig/base.json` sets
no `types` field and `@types/node` is hoisted into the root, so `setInterval`/`fetch`/`process`
**currently typecheck inside `packages/core`** — `"types": []` genuinely bites.

## Target architecture

```
                    ┌─────────────────────────────────────────┐
   generated  ◀─────│  packages/contract   Zod → OpenAPI 3.1  │  source of truth for the wire
   clients          │  + id grammar (ABNF) + fixture corpora  │
                    └────────────────┬────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐          ┌────────▼─────────┐        ┌─────────▼──────────┐
│ packages/core  │          │  packages/ports  │        │ packages/i18n · ui │
│ pure kernel    │          │  type-only       │        │ ICU · DTCG tokens  │
│ deterministic  │          │  platform seams  │        │ → CSS/Swift/Kotlin │
│ LOC-budgeted   │          └────────┬─────────┘        └─────────┬──────────┘
└───────┬────────┘                   │                            │
        │        ┌───────────────────┴────────────────┐           │
        │        │                                    │           │
┌───────▼────────▼──────────┐              ┌──────────▼───────────▼─────────┐
│ apps/edge  (the Worker)   │              │ view layers                    │
│ + src/derive/  server-only│─── wire ────▶│ apps/mobile (RN, today)        │
│ owns content·order·text   │              │ apps/web    (DOM, later)       │
│ packages/data-normalize   │              │ iOS Swift · Android Kotlin     │
└───────────────────────────┘              └────────────────────────────────┘
```

| Layer | Location | Owns | May import | May **not** import |
|---|---|---|---|---|
| Contract | `packages/contract` | Wire schemas, id grammar, fixtures | *(nothing)* | everything |
| Kernel | `packages/core` | Pure deterministic domain rules | `contract` (types only) | react, react-native, ports, i18n, ui, node globals |
| Ports | `packages/ports` | Type-only platform seams | *(nothing)* | everything — **declaration-only** |
| Tokens/i18n | `packages/ui`, `packages/i18n` | Design tokens, ICU messages | `core` (types) | react, react-native |
| Server derive | `apps/edge/src/derive/`, `packages/data-normalize` | Derivations too heavy or too churn-prone for clients | `core`, `contract` | react, react-native, `ports` |
| View | `apps/mobile`, `apps/web`, native repos | Layout, colour, motion, interaction | all of the above | each other |

**`packages/core` is narrowed in place — no rename.** It is the ring that gets hand-written twice
more, so it is the one thing we cap and police.

Server-only derivation lives **inside `apps/edge`**, not a package. That is deliberate: clients
cannot reach it by construction, no boundary rule required, and it is one fewer package.

### Enforcement (the pnpm leg is void — these are the real gates)

| # | Mechanism | Catches |
|---|---|---|
| 1 | **`layers.json`** as single source generating the dependency-cruiser ruleset **and** the `biome.json` overrides block, drift-gated with `git diff --exit-code` | The two configs silently disagreeing; adding a package without a matrix edit |
| 2 | `"types": []` in `contract`/`core`/`ports` tsconfigs | `Date`, `setInterval`, `fetch`, `process` leaking into the kernel (**verified reachable today**) |
| 3 | Biome `noRestrictedGlobals` on `core`: ban `Date`, `Math.random`, `Intl`, `fetch`, `crypto`, `localStorage` | Non-determinism — the precondition that makes fixtures byte-reproducible in Swift. Clock is always a `now: number` param |
| 4 | `tsc -p packages/ports --outDir /tmp/ports-emit`, fail on any non-empty `.js` | `ports` acquiring a runtime value; proves interface-only at compiler level |
| 5 | `boundaries:selftest` — one deliberate-violation fixture **per rule**, generated from `layers.json`, including a **transitive** two-hop case | The harness rotting into a vacuous pass. Biome's `noRestrictedImports` is textual and blind to two-hop reachability |
| 6 | `check-core-budget.mjs` — hard non-comment LOC cap on `packages/core`, breachable only by ADR | The hand-ported surface quietly growing |
| 7 | Biome **pinned** at `2.4.16` | An upgrade silently changing pattern semantics |

Rule paths for Biome 2.4.16: `noUndeclaredDependencies` is under `correctness/`, `noImportCycles`
under `suspicious/`. Verify before generating the overrides block.

**Do not add tsconfig project references.** `composite` requires declaration emit, which is
incompatible with the source-only rule (golden rule 1). Recorded in ADR-051 so a future agent does
not "helpfully" add them.

## The contracts

| Contract | Form | Source of truth | Consumers | How drift is prevented |
|---|---|---|---|---|
| **Wire API** | OpenAPI 3.1, generated from Zod | `packages/contract/src/wire/` | web · iOS · Android · worker | Emit-drift gate; response-conformance test via `@cloudflare/vitest-pool-workers` parsing every response; `oasdiff` breaking-change gate behind a label + ADR |
| **Id grammar** | ABNF + one parser + corpus | `packages/contract/src/ids/` | all | `check-no-adhoc-id-parsing.mjs` with an allowlist seeded at the 6 known sites that **must reach zero** |
| **Domain rules** | Pure TS + language-neutral JSON fixtures | `packages/core` | all (hand-ported) | LOC budget; `@spec` tag ↔ corpus cross-check; determinism lint; branch-coverage threshold satisfiable only by corpus-driven tests |
| **Design tokens** | DTCG JSON → CSS vars · Swift · Kotlin | `packages/ui/tokens.json` | all | Codegen output committed + `git diff --exit-code` |
| **i18n** | ICU messages → TS · `.strings` · `strings.xml` | `packages/i18n` | all | Key-parity across en/zh-Hant/zh-Hans + `LocalizedString` branded type |
| **Client policy** | Served at runtime, not compiled in | Worker | all | Resolves the live 3-way cap disagreement (below) |
| **Live protocol** | AsyncAPI 3.0 frames | `packages/contract/src/live/` | all | Poll-as-emulator emits real frames; parity test vs a fake transport |

### Wire details a native developer will otherwise guess wrong

Write these into the schema descriptions, not just prose:

- **Timestamps:** fixed ISO-8601 `+08:00` profile.
- **`HH:mm` past-midnight quirk:** `"25:35"` means 01:35 next day (`FreqBand`, `hours`).
- **Fare:** decimal *string* — compare numerically, display verbatim. Never parse to float.
- **Absent vs `null`:** state the convention explicitly per field.
- **Closed enums carry `x-unknown-tolerant: true`** (`OperatorId`, `Bound`, `ServiceDayType`,
  `Locale`) so generators emit Swift `case unknown(String)` / Kotlin fallbacks. **Gate it:** a CI
  test decodes a payload containing `"operator":"NLB"` and asserts it does not throw. Without this,
  shipping a fourth operator bricks decoding on every deployed phone.
- **Error taxonomy:** `{code, message, retryable}` with
  `code ∈ {not_found, bad_request, upstream_unavailable, upstream_timeout, internal}`. An iOS Widget
  holding a deleted favourite must distinguish "prune permanently" from "retry next refresh" — without
  `retryable` it retries forever.
- **Batch ETAs move to POST.** Place ids are ~90 chars and contain `+`; both
  `URLComponents(queryItems:)` and OkHttp's `addQueryParameter` silently convert `+` to a space.
  Server validates keys and returns 400 naming the offending index, so a native client fails loudly
  on its first call instead of rendering an empty Favourites tab.
- **Locale as a URL path segment**, not `Accept-Language` — correct CDN cache key with no `Vary`, and
  trivial URL construction from Swift/Kotlin.

### The line (ADR-053)

> **The server owns content, order, grouping, counts and text. The client owns layout, colour,
> motion and interaction.**

Mechanical brake: no wire field name or literal may match
`/#[0-9a-f]{3,8}|px$|fontSize|fontWeight|margin/`. Accents cross the wire as **semantic tokens**
(`accent: AccentToken`), never hex, so each platform maps to its own colour system. ETAs cross as
`arrivalsEpochMs` **plus** resolved text, so a native client can format with its own platform
formatter under Dynamic Type and VoiceOver.

**Verified live bug this resolves:** arrival caps disagree three ways today —
`app/route/[id].tsx:63` `.slice(0, 3)`, `app/(tabs)/favorites.tsx:148` `.slice(0, 4)`,
`components/StopRow.tsx:17` `MAX_ROWS = 6`. A served `ClientPolicy`
(`dueUnderSec`, `warnUnderSec`, `staleAfterMs`, `refreshAfterMs`, `maxArrivals`, `maxRows`) makes
ADR-008's honesty thresholds one edge deploy instead of three store releases.

## What stays platform-specific — do not over-abstract

| Concern | Port | Web | iOS | Android |
|---|---|---|---|---|
| Storage | `KeyValueStore` | `localStorage`/IDB | `UserDefaults` | `DataStore` |
| Location | `LocationProvider` | `navigator.geolocation` | `CoreLocation` | `FusedLocation` |
| Locale detect | `LocaleProvider` | `navigator.languages` | `Locale.preferred` | `LocaleList` |
| External links | `LinkOpener` | `window.open` | `UIApplication.open` | `Intent` |
| Clock | `Clock` | injected `now` everywhere — never `Date.now()` inside `core` | | |
| Tiles | `TileSource` | see launch blocker WP0-2 | | |

`ls packages/ports/src` **is** the iOS/Android porting checklist. That is the cheapest useful
artefact in this plan. `apps/mobile/lib/useLocation.ts` already models the right shape (a
discriminated union, no Expo types leaking) — mirror it for the other three.

Everything else stays native: view layer, navigation, motion, gestures, haptics, widgets.

## Work packages

Sized S (hours) · M (a day or few) · L (a slice). **"Parallel-safe" means no file overlap with
others in the same wave** — this matters because agents will be fanned across them.

### Wave 0 — Launch (does **not** depend on any refactor; all parallel-safe)

> **Status 2026-07-27: WP0-1 · WP0-2 · WP0-3 · WP0-4 are done and verified** on branch
> `hosting-cost-and-pwa-split` (ADR-055, ADR-049, ADR-058, ADR-057 respectively; see
> [`docs/11`](../11-status.md) for what was and wasn't verified). **WP0-5 is not started** — it needs a
> real domain and Cloudflare credentials, neither of which exists yet. Two notes on what actually
> happened versus what was written here: WP2-6 (`snapFix`) had to land early, because WP0-3's offline
> acceptance is unreachable while the Nearby query key jitters with the raw GPS fix; and the ADR
> numbering below skipped to 057/058 for the two work packages this plan hadn't reserved ADRs for.

| ID | Title | Scope | Acceptance | Size |
|---|---|---|---|---|
| **WP0-1** | Precompute → KV/R2 | External GitHub Action does the 8.3 MB fetch + normalize + ADR-042 clustering. Content-addressed: R2 `builds/<hash>/`, KV `place:<hash>:<id>`, single mutable `build:current` flipped only after every key lands | `GET /v1/health` exposes `datasetBuildsThisIsolate`; CI asserts it stays **0** across a full endpoint sweep. Partial crawl can never be served; rollback is a one-key write | L |
| **WP0-2** | Basemap → LandsD | Implement the **already-decided** [ADR-049](../08-decision-log.md) (LandsD basemap, Worker-cached raster, labels as a per-locale overlay): replace `tile.openstreetmap.org` at `components/MiniMap.tsx:26` behind the `TileSource` port. Includes the two compliance fixes plus the mandatory logo + copyright notice from [proposal 02](./02-basemap-and-street-imagery.md) | No request to `tile.openstreetmap.org` from a production build; LandsD logo + notice on the map face | M |
| **WP0-3** | Service worker | Workbox precache of the static export + runtime cache for `/v1/index`; add `@tanstack/query-persist-client` | Cold offline load renders Nearby + search from cache. Closes the `docs/03` claim vs `docs/11:243` reality | M |
| **WP0-4** | Per-pole ETA coalescer + TTL | Refactor `memberEtaLists()` in `apps/edge/src/stop-route.ts`; lift ETA TTL 8s → 30s | Counting fetch-mock: `/v1/nearby` at a 20-pole coordinate issues **exactly** distinct-pole-count upstream calls; two concurrent requests for one pole issue **one**. (At 8s the hit rate is ~0% — misses/s cap at `hot_keys ÷ TTL` and never binds; 30s matches upstream's ~1/min refresh) | M |
| **WP0-5** | Deploy + CI | `.github/workflows/`: typecheck, lint, `wrangler deploy`, `expo export -p web` → Pages. Custom domain | Green CI on main; app reachable on a real domain | M |

### Wave 1 — Contract foundation (WP1-1 first, then parallel)

> **Status 2026-07-28: Wave 1 is COMPLETE — WP1-1 … WP1-5 all landed and verified** (ADR-051, ADR-052,
> ADR-059, ADR-060). WP1-2…5 were built by four agents in parallel worktrees and integrated one at a
> time. Four corrections to what is written below, recorded because the plan was wrong in ways worth
> knowing:
> **(1)** WP1-2's parser could **not** live in `packages/contract` — `packages/core/src/eta.ts` needs it,
> and ADR-052's type-only gate forbids a runtime `core → contract` edge. Parser in `core`, ABNF + corpus
> in `contract`. **(2)** There were **12** ad-hoc id-parsing sites, not 8; the four extras were in
> `apps/edge/src/{dataset,search-index,stop-route}.ts` and `data-normalize/src/shards.ts`, and the line
> numbers listed below had already drifted. The allowlist is now empty. **(3)** WP1-1 as sketched would
> have made zod a *runtime* dependency of the package every screen imports; it is `import type` only, so
> zod never enters the client bundle. **(4)** WP1-4 came in at **216 lines against the ~150 budget**,
> which by the risk table below is the trigger to simplify rather than grow.
> Two real bugs fell out of the work: `formatClock` consulted the device timezone and host ICU, and
> `inferBusMarkers` could drop an approaching bus from the route view entirely. Both fixed; six further
> defects are recorded as `knownDefect` corpus rows.

| ID | Title | Scope | Acceptance | Depends |
|---|---|---|---|---|
| **WP1-1** | `packages/contract` | Transcribe today's types to Zod with **no shape changes**; `packages/core/src/types.ts` becomes `z.infer` re-exports | **Zero diff in `apps/mobile/**` and `apps/edge/**`.** OpenAPI 3.1 emits; drift-gated | — |
| **WP1-2** | Id grammar | ABNF + single parser for `KMB:1:outbound:1`, `P:<a>+<b>`, `GMB:{no}:{bound}:{gtfsId}`; corpus incl. a raw id containing a literal `\|` | `check-no-adhoc-id-parsing.mjs` allowlist seeded at the **8 verified sites** below, CI fails if it grows, and it must reach **zero** | WP1-1 |
| **WP1-3** | `packages/ports` | The 6 type-only interfaces above | `tsc --outDir /tmp` emits no non-empty `.js` | — |
| **WP1-4** | Enforcement engine | `layers.json` → dependency-cruiser + biome overrides; `"types": []`; `noRestrictedGlobals`; per-rule + transitive self-test fixtures; pin Biome | `pnpm boundaries:selftest` fails on every injected violation, direct and transitive | — |
| **WP1-5** | Fixture harness | `@spec` JSDoc tag + `check-spec-coverage.mjs` (every tagged export has a non-empty corpus **and** every corpus is referenced); branch-coverage threshold on `core` | Named boundary rows present: 119/120/121s at `toIndex 0`, a 4-member place, an id with a literal `\|`, empty `en` on a circular route | WP1-1 |

**The 8 ad-hoc id-parsing sites** (verified 2026-07-26) that WP1-2's allowlist must drain to zero:
`app/search.tsx:163` · `app/stop/[id].tsx:285`, `:292`, `:293`, `:312` · `app/route/[id].tsx:58`
(`startsWith('P:')` + `.slice(2).split('+')`) · `components/StopRow.tsx:20` ·
**`packages/core/src/eta.ts:111`** — note the last one is already inside the "clean" kernel, so even
`core` parses ids ad hoc today.

### Wave 2 — Domain extraction (all parallel-safe: one module each, parity-guarded)

**Method, applied to every WP in this wave:** *copy* into `packages/core`, land a parity test
asserting the new function ≡ the old one over the full corpus, and **the parity test dies in the same
PR as the last `apps/mobile` copy.** This is what makes these safely parallel despite near-zero
existing test coverage.

| ID | Moves | From | Size |
|---|---|---|---|
| **WP2-1** | `splitStopCode`, `titleCaseName`, `isCircular`, `stripCircular` | `apps/mobile/lib/stopName.ts` (brings the app's only test file) | S |
| **WP2-2** | `dedupeRoutes`, `operatorsOf`, the 3-tier pole-ordering comparator | `app/stop/[id].tsx:86`, `:97`, `:123-149` | M |
| **WP2-3** | `isOriginStop`, `upcoming`, circular-route naming, the 120 s origin-bus suppression | `app/route/[id].tsx:55`, `:62`, `:194-214` | M |
| **WP2-4** | Web-Mercator tile math (`lngToWorldX`, `latToWorldY`, `fitZoom`) | `components/MiniMap.tsx:50-71` | S |
| **WP2-5** | `favoriteRouteKey` + parser **+ a migration** tested against real captured preference blobs | `lib/preferences.ts:20` | M |
| **WP2-6** | `snapFix` — grid-snap the GPS fix (25 m nearby / 50 m elsewhere) before it leaves the device | new; privacy control **and** the thing that makes `/v1/nearby` edge-cacheable | S |
| **WP2-7** | Search index: content-hash version (replacing `${routes.length}.${stops.length}`), ETag/`If-None-Match`, precomputed zero-padded `sortKey` (`10A`→`0010A`), range scans replacing the trie | `apps/edge/src/search-index.ts`, `packages/core/src/search.ts`. **Rationale to preserve:** `localeCompare(numeric:true)` has no faithful Swift/Kotlin equivalent, so a client-side trie guarantees three divergent sort orders | L |
| **WP2-8** | **Error taxonomy.** `{error}` → `{code, message, retryable}` with `code ∈ {not_found, bad_request, upstream_unavailable, upstream_timeout, internal}`, plus the status codes that go with it — a malformed id currently returns **502** where **400** is correct. **Added 2026-07-28:** this was specified in *The contracts* section from the start but no work package ever owned it, so it would not have happened. It is one job, not two: `502` reads as *retryable*, so an iOS Widget holding a deleted or malformed favourite retries forever — the status code and the taxonomy are the same defect. Ship it **additively** per ADR-052 §5 (serve `code`/`retryable` alongside `error`, let clients migrate, then retire `error`) | Conformance test asserts the taxonomy on every error path; a Widget can distinguish prune-permanently from retry-later | M |
| **WP2-9** | **Split `RouteServiceInfo` by fidelity.** `/v1/route/:id` carries `patterns`; `/v1/stop/:id` omits it (the summary tier — duplicating it was 54 MB of an 82 MB build, ADR-055), but both satisfy the same optional-`patterns` schema, so a native client cannot tell *"this route has no frequency table"* from *"you asked the endpoint that doesn't send it"*. Two named schemas, or an explicit tier discriminator. **Added 2026-07-28** — recorded in ADR-052 as a known wrong-but-faithful transcription, owned by nobody until now | The two tiers are distinguishable from the OpenAPI document alone | S |

⚠️ **WP2-5 is a known-broken-scheme migration, not a move.** The favourite id scheme must be fixed
before ADR-032 ships; shipping the `P:` → pole-id change without a migration loses users' favourites
silently.

### Wave 3 — Native enablement

> **Status 2026-07-29: Wave 3 is COMPLETE — WP3-1 … WP3-4 all landed and verified** (ADR-053, ADR-054,
> ADR-067). WP3-1/3-2/3-4 were built by three agents in parallel worktrees and integrated one at a time;
> **WP3-3 ran last on purpose**, so it published a contract that already contained the other three's changes
> (`/v1/policy`, `remarkKind`, and the generated token and string artefacts). Ten corrections to what is written below, recorded because the plan was wrong in
> ways worth knowing:
> **(1)** WP3-4's acceptance cell says *"ADR-051 line stated"* — it means **ADR-053**; ADR-051 is layered
> package boundaries. **(2) ADR-053 and ADR-054 were unwritten gaps** in the decision log, *already
> forward-referenced from ADR-052 and ADR-064 as though they existed* — two dangling links on `main`. They
> are filled rather than renumbered. **(3)** `packages/ui/tokens.json`, named here as the source of truth,
> **did not exist** — WP3-1 was greenfield, and the values were hand-maintained in **four** places.
> **(4) A generator cannot live in `packages/ui/src` or `packages/i18n/src`** — both are in the `tokens`
> layer with a closed-world `"npm": []`. Both packages were done with **zero new dependencies** (plain Node
> emitters; `Intl.PluralRules` instead of an ICU runtime), so no carve-out was needed. **(5) The line numbers
> here had drifted again** — `OPERATOR_LABEL` is at `app/stop/[id].tsx:55` not `:50`, `favorites.tsx:154` not
> `:148`, `StopRow.tsx:22` not `:17`. Derive site lists by grep. **(6) The three-way cap disagreement changed
> shape:** Wave 2 hoisted `route/[id].tsx`'s `.slice(0, 3)` into `core` as a corpus-pinned constant, so
> `maxArrivals` had to replace *a kernel constant plus two literals* and reparameterise 8 corpus rows.
> **(7) WP3-3's blocking open question is already closed** — ADR-060's format convergence settled it, and the
> id corpus moved to `packages/core/spec/ids.spec.json` (the ABNF stays in `contract`). **(8) ADR-060's
> figure of "36 groups, 274 cases" is stale** — reality is 11 corpora / 66 groups / ~515 cases; fix it if
> WP3-3 quotes it. **(9) There is no PR/push CI workflow at all**, so the *"`git diff --exit-code` in CI"*
> acceptance wording describes something that does not exist — every gate is wired into a package `test`
> script instead, and that is stated in ADR-054 so nobody trusts absent enforcement.
> Two real bugs fell out of the work: **Favourites never rendered its "+N more" affordance** (it pre-sliced
> to 4, so `total − shown` was `4 − 4`), and **three separate gates were vacuous or nearly so** — a turbo
> cache replaying a check whose input lay outside the package hash, a `.gitignore` rule that would have
> excluded the artefacts a drift gate compares, and new literal rules firing on a stale `dist/` bundle.
> Also worth knowing: WP3-1's **Swift and Kotlin output has never been compiled** — no compiler exists here,
> so compiling it is WP3-3's first job, not an inherited claim.
> **(10) Every hand-written count of the corpus in this repo was wrong.** The brief said 10 files / 66 groups
> / ~515 cases, this plan implied another figure, and ADR-060 recorded *"36 groups, 274 cases"* — three
> different wrong numbers for one artefact, in a wave whose entire subject is generated output drifting from
> its declaration. The real figure is **11 corpora / 65 groups / 510 cases / 4 `knownDefect`**. The durable
> fix is not the correction: it is that **no document states the figure by hand any more** — WP3-3's gate
> regenerates it, and also rejects a cited path that is missing *or* gitignored.

| ID | Title | Acceptance | Depends |
|---|---|---|---|
| **WP3-1** | Token codegen: `tokens.json` (DTCG) → CSS vars + Swift + Kotlin. Restructure `ELEVATION`'s RN-shaped `.ios`/`.android` to be platform-neutral at source | Generated output committed; `git diff --exit-code` in CI | — |
| **WP3-2** | i18n → ICU; `.strings`/`strings.xml` generators; `LocalizedString` brand so a hard-coded English literal (e.g. the `OPERATOR_LABEL` map at `app/stop/[id].tsx:50`) is a **compile error** | Key parity across 3 locales; brand enforced at the display boundary | WP1-1 |
| **WP3-3** | Publish `contract/openapi.json` + `contract/README.md` written as *"how an iOS or Android repo consumes this"*; ship the fixture-consuming XCTest/JUnit conformance file **inside** the generated scaffold | A native repo starts life with the corpus wired in — the only real mitigation for corpus rot | WP1-1, WP1-5 |
| **WP3-4** | Move to the edge, incrementally: `displayName`, `code`, `remarkKind`, fares, `sortKey`, `refreshAfterMs`, `ClientPolicy` | `check-vm-no-styling.mjs` green; ADR-051 line stated | WP2-* |

**Descoped until a native repo exists:** generating and compiling `NextBusKit` on a macOS runner and
a kotlinx client on a JVM runner. Keep only the two cheap halves — the unknown-enum smoke test and
the in-scaffold conformance file. Building release artefacts for two repos that do not exist is the
one piece of astronautics in the bake-off.

### Wave 4 — Proof

| ID | Title | Acceptance |
|---|---|---|
| **WP4-0** | *(added 2026-07-29, ✅ done)* Hoist Nearby's six client-side derivations into `packages/core` so "derived output" is a thing that exists | `stop-card` corpus green; parity with the old `.tsx` proven over real `/v1/nearby` rows; `apps/web` present in `layers.json` + `check-no-raw-colours` before it has a file |
| **WP4-1** | `apps/web` — Vite + React DOM rendering **one** screen (Nearby) from the identical extracted `core` functions | CI asserts its derived output is **byte-identical** to the RN golden; *lines of new logic outside `.tsx` and adapters: zero* |

**Correction, 2026-07-29 — WP4-1 as written could not be satisfied, and WP4-0 is why** (ADR-068). Both
halves of its acceptance presupposed an artefact that did not exist: there was no *derived output*, because
no client view-model layer existed and this plan deliberately **rejects** a served `/v2` view-model tier
(see the table at the top). Six derivations were living inside `apps/mobile`'s components, reachable only by
rendering — the list's order, the `maxRows` cap and its "+N more" count, the caption's parts and its two
separators, destination-else-remark as the headline, the route-number fallback, and the stop-name split. So
"*lines of new logic outside `.tsx` and adapters: zero*" was unachievable: a second renderer had to
re-implement each one, and **a re-implementation would have passed a byte-identity check on the day it was
written while proving the opposite of this plan's thesis.** Three further notes for whoever does WP4-1:
`vite` is already hoisted at **8.0.16** as vitest's peer, so pin that exact version (golden rule 6);
`packages/ui`'s token emitter writes only one web CSS target and needs a second; and `packages/ports` is
declared but unadopted, so this is its first real consumer — decide whether `useLocation`'s permission
state machine moves behind `LocationProvider` or gets duplicated.

This is the cheapest empirical test of the whole thesis, and it is simultaneously the dress rehearsal
for both the DOM rewrite and the native ports. Everything else in this plan makes unfalsifiable
claims about what Swift will need; this one is testable now.

### Wave 5 — Phase 2 (DO + WebSockets)

| ID | Title | Acceptance | Depends |
|---|---|---|---|
| **WP5-1** | AsyncAPI frames + poll-as-emulator: refactor the `watch()` shim to emit real `Snapshot`/`Delta`/`Status` frames | Scenario-matrix test: byte-identical listener output from the poll emulator and a `MemoryTransport` fake | WP1-1 |
| **WP5-2** | Seam proof | Substitute a `FakeSocketDataSource`; `git diff --stat` shows **zero** lines changed under `apps/mobile/app/**` and `components/**`. Converts ADR-004 from aspiration to gate — note `watch()` has **no callers today** | WP5-1 |
| **WP5-3** | Sharded `EtaHub` DO (not one DO per stop) with WebSocket Hibernation and **adaptive alarm cadence** | Hibernation verified; alarm cadence ~45–60 s baseline | **WP0-1** (hard) |

**WP0-1 is a hard prerequisite for WP5-3.** DO instances are 128 MB each; N instances each parsing an
8.3 MB dataset (≈20 MB heap measured) is not survivable.

## Phase 2 cost model

Measured/verified inputs: Workers Paid $5/mo, 10M req + 30M CPU-ms included, then $0.30/M and
$0.02/M. Waiting on `fetch()`/KV does **not** count as CPU; **Cache API hits still count as billable
requests**. DO: 1M req/mo included then $0.15/M, WS **messages count 20:1**, alarms count as
requests, 400k GB-s included, hibernated objects accrue **no** duration.

| DAU | Polling (today, 20 s) | DO + WS @15 s alarm | DO + WS @60 s alarm |
|---|---|---|---|
| 1k | $5 (0.9M req) | $5 | $5 |
| 10k | $5 (9M req) | ~$8 | $5 |
| 100k | ~$29 (90M req → $24 over) | ~$35–45 | **~$12** |

**Polling cost scales with active user-minutes; DO cost scales with hot-stop-minutes × alarm
cadence.** So the naive 10–15 s alarm from `docs/03` makes DO *more* expensive than polling — it
burns 4× the requests to deliver identical data, because `docs/01` and ADR-008 already concede
upstream refreshes only ~1/min. **Align alarms to ~45–60 s and DO wins decisively at scale.**
Crossover lands around 40–45k DAU.

**Decide Phase 2 on UX, not cost** — battery (one socket vs 180 wakeups/hour), server-controlled
cadence, and the foundation for Phase 3 push.

### Honest performance ranking

1. **WP0-1 precompute → KV** — removes a ~310 ms cold path (measured: 67 ms `JSON.parse` alone on an
   M-series Mac, ~20 MB heap) and the hard dependency on `data.hkbus.app`. Biggest real win.
2. **WP0-3 service worker** — biggest *perceived* win; nothing exists today.
3. **WP0-4 nearby fan-out** — 70–100 upstream calls per request, throttled by a 6-simultaneous-connection
   ceiling. Slowest endpoint.
4. **WP5-3 DO + WebSockets** — real, but capped by upstream's ~1-min refresh.

DO+WS is fourth. Do not let it jump the queue.

## Risks & residual unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| **Near-zero test coverage** (`lib/stopName.test.ts` is the *only* test in `apps/mobile`) — every "mechanical, zero-behaviour-change" claim is unverified | **High** | Wave 2's copy-then-parity-then-delete method; fixture corpora land in WP1-5 *before* extraction; `pnpm dev:web` eyeball per WP |
| Corpus rot — fixtures exist but cover nothing interesting | High | Named required boundary rows (WP1-5); `@spec` ↔ corpus cross-check; branch-coverage gate; in-scaffold conformance file (WP3-3) |
| Codegen becomes stale scaffolding | Medium | Every generator's output is committed and `git diff --exit-code` gated — a stale generator is a red CI, not a silent rot |
| Kernel grows until hand-porting is infeasible | Medium | `check-core-budget.mjs`; growth costs an ADR |
| Boundary harness rots into a vacuous pass | Medium | Per-rule **and** transitive self-test fixtures; Biome pinned |
| `layers.json` meta-generator is over-engineering for ~10k LOC | Low–Med | Accepted: it replaces two hand-maintained configs that will disagree. Revisit if it exceeds ~150 lines |
| Native clients want a different information architecture (CarPlay, Live Activity, Widgets) | Medium | Keep the **data** endpoints first-class and conformance-tested, not "legacy" — never force a native client through a view-model shape to stay in contract |
| Place ids persisted today resurface in Widgets/Siri/App Shortcuts and break silently months later | Medium | Id grammar + durability rule in ADR-052; WP2-5 migration |
| Cache-key growth from locale-in-path × snapped fix | Low | Measure post-launch; `snapFix` (WP2-6) is the counterweight |

**Unverified assumption, flagged:** the ~500-hot-stop figure in the cost model is an estimate, not a
measurement. Instrument it before committing to WP5-3.

## ADRs to write

**Latest existing is ADR-050** (ADR-049 and ADR-050 were taken by the basemap/street-imagery
decisions in [proposal 02](./02-basemap-and-street-imagery.md) on this branch), so this plan's ADRs
start at 051.

| ADR | Subject |
|---|---|
| **051** | Layered package boundaries enforced by `layers.json`; `core` narrowed **in place** (no rename); tsconfig project references deliberately rejected (`composite` breaks source-only) |
| **052** | The wire contract: Zod → OpenAPI 3.1, canonical id grammar, unknown-tolerant enums, error taxonomy, id durability |
| **053** | Server owns content · order · text; client owns layout · colour · motion (+ the `check-vm-no-styling` brake) |
| **054** | Design tokens and i18n as generated cross-platform artefacts |
| **055** | Content-addressed precompute to KV/R2; the dataset leaves the request path |
| **056** | Phase 2 live protocol: AsyncAPI frames, sharded `EtaHub`, adaptive alarm cadence (and why cost does not justify the DO) |

## Sequence

```
Wave 0 ────────────────▶ LAUNCH ◀── not blocked by anything below
   │
   ├─ Wave 1 (contract + enforcement)
   │     └─ Wave 2 (extraction, parallel, parity-guarded)
   │           ├─ Wave 3 (native enablement)
   │           └─ Wave 4 (apps/web proof) ──▶ decide the DOM rewrite on evidence
   │
   └─ WP0-1 ─────────────────────────────────▶ Wave 5 (DO + WebSockets)
```

Wave 0 ships the product. Waves 1–2 can start in parallel with Wave 0 (no file overlap: Wave 0 is
`apps/edge` + build config, Wave 2 is `packages/core` + screen internals). Wave 4 is the gate for
deciding the DOM rewrite with evidence rather than conviction. Phase 2 waits for WP0-1 and for a
measurement of hot-stop concurrency.
