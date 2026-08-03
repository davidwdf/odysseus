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
| **Live protocol** | AsyncAPI 3.0 frames | `packages/contract/src/wire/live.ts` (**corrected** — one module beside every other wire shape, not a `src/live/` directory: the frames share the schema registry) | all | Poll-as-emulator emits real frames; scenario matrix vs a fake transport; `asyncapi.json` staleness + a dialect gate. **Not a codegen input** — see ADR-056 |

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
| **WP4-1** | *(✅ done 2026-07-29 — ADR-069)* `apps/web` — Vite + React DOM rendering **one** screen (Nearby) from the identical extracted `core` functions | CI asserts its derived output is **byte-identical** to the RN golden; *lines of new logic outside `.tsx` and adapters: zero* |

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

**All three were answered in WP4-1** (ADR-069): vite is pinned at `8.0.16` and `@vitejs/plugin-react`
went to `6.0.4`, the first line declaring vite 8; the emitter gained a second target rather than a copy,
so `check-tokens-current` gates it by construction; and the state machine **moved** — it is
`createLocationController` in `packages/api-client`, which `apps/mobile` now consumes too, leaving each
app a three-method adapter and the same ten-line hook. Wave 4's payoff was not the port but what it
found in the *existing* app: a caption whose deliberate double separator the DOM silently collapsed, and
a "+N more" count hidden whenever it could not be tapped. Neither was reachable by reading the code.

This is the cheapest empirical test of the whole thesis, and it is simultaneously the dress rehearsal
for both the DOM rewrite and the native ports. Everything else in this plan makes unfalsifiable
claims about what Swift will need; this one is testable now.

### Wave 5 — Phase 2 (DO + WebSockets)

> **Status 2026-07-31: Wave 5 is COMPLETE bar the deployment — WP5-0 … WP5-3 landed and verified**
> ([ADR-056](../08-decision-log.md#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)).
> Built sequentially by four agents in **one** workspace rather than in parallel worktrees — the pieces are
> disjoint by package, so sequencing cost wall-clock and nothing else, and the local `main` these worktrees
> are cut from is at *"Initial commit"*, a hazard Wave 3 already paid for in a milder form. Then an
> adversarial review ran over the finished diff and 13 of its 25 candidates survived a skeptic, so the wave
> is 25 commits rather than ten. Thirteen corrections to what is written below, recorded because the plan
> was wrong in ways worth knowing:
> **(1) WP5-2's acceptance was vacuous, and its own row says so.** *"`git diff --stat` shows zero lines
> changed under `apps/mobile/app/**`"* is zero **by construction**, because nothing under those paths reached
> `watch()` at all — the row notes *"`watch()` has no callers today"* and no work package fixed it. That is
> exactly WP4-0's shape one wave later: an acceptance presupposing an artefact that does not exist. The
> prerequisite is **WP5-0** below, which is not in this plan.
> **(2) WP5-1's "byte-identical listener output" is unachievable as written**, and the row does not mention
> the reason: the poll emulator's order is whatever `/v1/etas` returned, while a delta protocol's order is
> history-dependent. It needs a **canonical order in the kernel** — `(stopId, routeId)`, code-point — which
> is the load-bearing design decision of the whole wave and is not in the row. With it, reversing a
> transport's own ordering changes nothing (17/17 matrix rows still pass); without it no implementation could
> pass.
> **(3) The cost argument in *"Phase 2 cost model"* below does not survive sharding** and must not be used to
> justify the cadence — see the correction under that heading. The cadence is 45–60 s because of a
> *measurement of upstream*, which holds at any scale.
> **(4) `docs/03`'s Phase 2 sketch was contradicted by shipped code**, not just by this plan: it described one
> Durable Object per stop on a 10–15 s alarm. Rewritten to what exists, ceiling reminder and diagram intact.
> **(5) The module map's `packages/contract/src/live/` is wrong** — the frames are one module,
> `src/wire/live.ts`, beside every other wire shape, because they share the schema registry and the `wire/`
> conventions. Likewise `packages/api-client/src/live.ts` is a **directory**, `src/live/`, holding four
> independent things (engine · poll · memory · socket) plus the controller.
> **(6) AsyncAPI is not the OpenAPI story again.** Its Schema Object is a superset of **draft-07, not
> 2020-12**; there is **no AsyncAPI→Swift generator in existence**; Kotlin generation cannot serialise; and
> `asyncapi diff` classifies a removed payload field as `unclassified`, so a gate failing on `breaking` would
> go green on a deleted field. It is a specification artefact with a validator — ADR-056 says so at length,
> and `packages/contract/README.md` §7 carries the register.
> **(7) Two defects shipped on `main` were found by building this, and both survived because no test spanned
> two implementations of one rule** — `Eta.stopId` served as the operator's raw id where the contract declares
> it canonical (so the kernel merge matched **nothing, always**: 8 live readings at a Mong Kok place became 0
> one second after paint), and the socket transport treating any `retryable: false` as terminal (so **one
> stale favourite killed live ETAs for every stop a rider had**). Both fixed. Neither was reachable by
> reading either side alone.
> **(8) `packages/api-client` had no `test` script at all**, so `turbo run test` skipped the package
> *silently* and `EdgeClient.watch()` had never been executed by anything. It has 47 tests now. Repo total
> **705 → 934** (core 738 · edge 93 · api-client 47 · mobile 36 · web 20, counted on a clean clone). The
> corpus figures are **not restated here** — Wave 3's own correction (10) established that no document states
> them by hand any more; the generated table in `packages/contract/README.md` §6 is where they live.
> **(9) `check-core-budget.mjs`, named in the risk table below, still does not exist**, so nothing mechanical
> stopped `packages/core/src/live.ts` at 691 lines (57% comment, in line with `eta.ts`'s proportions).
> **(10) The plan has no step for an adversarial review, and this wave shows it should.** Six read-only
> finders over the finished diff raised 28 candidates; three skeptics (one per area, batched — not a
> per-finding fan-out) judged 25 of them and **confirmed 13**. Every one of the 13 was in code that had
> passed `typecheck`, `test`, `lint`, `boundaries` and a `--dry-run` bundle. The species worth planning for:
> **three regressions arrived by *removing* a line** — the served cadence stopped being in force, a failed
> first load became permanent, and the freshness cue could never fire because `refetchInterval` was the
> screen's clock as well as its fetch. No gate in this repo can see a deletion whose loss is a *behaviour*,
> and the seam-substitution harness in particular cannot: it pins `now` to a constant so two engines can be
> compared byte for byte, which is exactly why the clock needed a test of its own.
> **(11) Wave 2's `dedupeRoutes` key was wrong, and Wave 5 is what made it visible.** A rider line was keyed
> `operator|routeNo|bound`, discarding the boarding point as noise. It is noise for KMB and Citybus and it is
> **identity for GMB**, where numbers repeat: two different number-20 services at Tai On Street, both
> circular so both "outbound", were rendered as one row — the second destination never shown, and where 20
> was a pole's only route the pole's whole group vanished from the list while its dot stayed on the map (21
> poles emptied in the 2026-07-27 build). The live merge is what forced it: with the surviving row chosen by
> *which row has a reading*, that row's destination, its map dot and its scroll target followed the sooner
> kerb and **moved as buses departed**. Fixed 2026-07-31 (owner's call, option A of three) — the key is now
> `operator|routeNo|bound|stopId`. The residual is a plan-level fact, not a bug: the model's unit of *an
> arrival* is (line, **place**) while its unit of *a row* is now (line, **pole**), and those must be the same
> unit. **WP5-9** owns closing it.
> **(12) Five of the wave's confirmed findings are latent only because WP5-6 has not shipped.** The socket
> engine cannot be selected without a source edit, so no rider is affected by any shard defect today — which
> is also why five of them could ship green. Whoever does WP5-6 is un-latching those five fixes, and should
> read `.context/wave5/review/VERDICTS-do.md` before assuming the shard is now sound.
> **(13) Three gates this wave shipped reported success while looking at less than they claimed** — the
> repo's sixth, seventh and eighth instance of that one failure. An allowlist matcher compared file and
> snippet but never `pattern.id`, and its selftest had never executed the matcher at all (sixteen green
> fixtures over code nothing ran); a policed directory that stopped existing dropped out in silence while the
> success line went on printing "5 policed dirs"; and `asyncapi.json`'s first paragraph claimed the two
> documents share `components.schemas` byte for byte, which was false for **34 of 34** schemas. All three
> fixed in `dc62352`. The pattern is now old enough that a new gate should be assumed vacuous until its
> selftest has been watched failing on the *matcher*, not only on the pattern.

| ID | Title | Acceptance | Depends |
|---|---|---|---|
| **WP5-0** | *(added 2026-07-30, ✅ done — not in the original plan)* Give `watch()` a real consumer: `apps/mobile/lib/useLiveEtas.ts` + Place detail's `refetchInterval` replaced by a subscription that writes through to the same query key | The screen's request log is one `/v1/stop/:id` on mount and then `/v1/etas/:id` at the cadence, driven in a browser; ADR-058's persisted cache still replays |
| **WP5-1** | *(✅ done)* AsyncAPI frames + poll-as-emulator: refactor the `watch()` shim to emit real `Snapshot`/`Delta`/`Status` frames | Scenario-matrix test: byte-identical listener output from the poll emulator and a `MemoryTransport` fake — **achievable only with correction (2)'s canonical order** | WP1-1 |
| **WP5-2** | *(✅ done, acceptance rewritten)* Seam proof | ~~`git diff --stat`~~ → `apps/mobile/test/seam-substitution.test.tsx` renders one screen from two data sources sharing nothing below the seam and asserts the rendered text **and** the cache payload, with a hand-written control so a subscription that delivered nothing cannot pass; plus `scripts/check-view-transport-free.mjs`, which states the property the diff was standing in for — a screen *cannot* reach a transport | WP5-0, WP5-1 |
| **WP5-3** | *(✅ done bar deployment)* Sharded `EtaHub` DO (not one DO per stop) with WebSocket Hibernation and **adaptive alarm cadence** | Hibernation's *consequence* verified on a cold instance (attachment + ramp recovered); its *policy* is not locally observable and the suite says so. Cadence 45→60 s, observed at +0/+45/+91 s against the live KMB feed | **WP0-1** (hard) |

**WP0-1 is a hard prerequisite for WP5-3.** DO instances are 128 MB each; N instances each parsing an
8.3 MB dataset (≈20 MB heap measured) is not survivable.

**Added 2026-07-30, extended 2026-07-31 — seven rows the wave found and deliberately did not do.** Each is a
named owner for something that would otherwise sit in ADR-056's prose, which is how WP2-8 and WP2-9 nearly
did not happen.

| ID | Title | Scope & why | Acceptance | Size |
|---|---|---|---|---|
| **WP5-4** | **Per-pole ETA failure reporting** — `coalesce` must not turn an outage into "no buses" *(✅ **done 2026-08-03** — [ADR-073](../08-decision-log.md#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire))* | `coalesce` resolves a *rejected* upstream call to `[]`, so `stopEtas` returns an empty list **successfully** and the shard's `diffEtas` reports every reading `gone`: *"a failed round is not a departure"* defeated one layer below where it is enforced. **Pre-existing and identical on HTTP**. The honest fix changes what `/v1/etas` and `/v1/nearby` can *say* (e.g. `{ etas, failed: string[] }`), so it needs an ADR of its own and must not ride along in a socket commit | ~~A stop whose upstream refuses is distinguishable from a stop with no buses, on both the HTTP and the socket path; the shard reports `retrying` and **no** `gone`~~ → **met on both paths, and the diagnosis moved one layer from where this row put it.** The bug was not that `coalesce` swallowed a rejection — it was that it **took a `fallback` at all**, so a *cache* decided what a failure meant for every caller, below both copies of the rule. The parameter is gone and each caller decides at its own call site (`routeDetail` still degrades to a static route view, and says so on the line). `failed` is keyed on the **pole**, not the place and not the route, because a place is N boarding points (ADR-042) and an upstream board call is per point — Citybus is per (pole, route), so a pole with one refusing route is named once and its answering routes are in `etas` as usual. `retainFailedPoles` in `packages/core` is the one rule both engines apply, 10 corpus rows, 3 of them named boundary rows. **The wire change is breaking, not additive, and that was the decision:** `/v1/etas/{id}` was a bare array, so `{ etas, failed }` is a type change — ADR-052 §5 breaking — and `CONTRACT_VERSION` is 2.0.0. The deprecation window §5 asks for is **empty because it is genuinely free today**: WP0-5 has not happened, `openapi.json` has never been published anywhere a generator could read it, and nothing outside this repo consumes the endpoint. It stops being free the day the Worker deploys. Three sub-decisions the row did not anticipate: `failed` is **omitted when empty** (asserted as a control, or the field becomes unreadable); `routes=` filters readings and **never** failures (a KMB board is one call for every route, so there is no per-route truth to filter by); and a partial answer is a **200**, because failing the request throws away the kerbs that did answer. `degraded` was considered as a fifth `LiveState` and deferred with reasons. **What is deliberately not done: `/v1/nearby` and `/v1/stop` do not carry `failed`** — the merge helpers spread the document, so an HTTP-fetched `failed` would outlive the outage it describes. **WP5-13** owns it, after WP5-7 | M |
| **WP5-5** | **Bind the two engines' failure semantics with a test, not a review** *(✅ **done 2026-08-03** — [ADR-074](../08-decision-log.md#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines))* | Two implementations of *"a failed round is not a departure"* and *"an unchanged round is silent"* exist (`live/poll.ts`, `eta-hub.ts`) and the scenario matrix drives the poll emulator against a **hand-written** script, never against the shard. Both of the wave's own defects survived this exact gap | ~~The matrix rows run against `EtaHub` through a real socket; a divergence in either rule fails~~ → **met, and the shape had to change once the constraint was measured.** `layers.json` gives `server` the dirs `["apps/edge"]` — **tests included** — and no `client`, and `@nextbus/api-client` is not even a dependency of `@nextbus/edge`, so an edge test cannot import a transport or the controller. What both sides may import is `@nextbus/core`, so the rows are **data**: `packages/core/fixtures/live-rounds.json`, 11 rows, one driver per package, the edge one opening a real socket to the real Durable Object inside workerd and reducing its frames with the kernel's own `applyLiveFrame`. **The assertion is not the frame transcript**, and the reason is structural rather than a shortcut: the shard answers a `subscribe` immediately from stored readings and only then polls, while the poll emulator has nothing to answer with until its first fetch returns — two correct engines, two different transcripts, no implementation able to make them equal. So a row declares one line per round: state, readings, **and the accepted target set**, which the old matrix deliberately omitted because adding it there would have asserted the *stale* echo (ADR-056 decision 17). The existing matrix stays, with a stated division of labour — frame rules there, round rules here. **The corpus found a defect in its own first draft**, not in the code: a row claimed a line the *answering* kerb had stopped listing should survive, and both engines correctly disagreed | M |
| **WP5-6** | **Make the socket engine selectable without a source edit** *(✅ **done 2026-08-03** — [ADR-076](../08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll))* | `/v1/live` ships **unreachable from a real build**: `EdgeClientOptions.liveUrl`/`.transport` are the plumbing, `EXPO_PUBLIC_LIVE_URL` / `VITE_LIVE_URL` and `…_LIVE_TRANSPORT` are the documented spellings, and nothing reads them. Note the deliberate absence of an `auto` value — it would imply a socket→poll fallback that does not exist | ~~Both app shells select `poll`\|`socket` from the environment; the default stays `poll`; docs/10's table loses its two "nothing yet" rows~~ → **met on all three.** The read stays per-renderer by necessity — babel-preset-expo's inliner visits only a literal `process.env.X` member expression, so a helper taking the variable's *name* compiles, runs in dev and bakes in `undefined` in a production bundle — while the *decision* is one declaration (`live/select.ts`), because two `=== 'socket'` comparisons is exactly the drift the one-declaration discipline exists for. `liveTransportFromEnv` returns `undefined` for the default rather than `createPollTransport`, so the **client** stays the one place that names it. An unrecognised value falls back to `poll` and warns once, naming the value and the two legal ones: throwing breaks first paint over an optional knob, and silent fallback is this repo's recurring "gate passing while looking at nothing". Two things measured rather than assumed: `build-web.mjs` needs no change (a WebSocket handshake never reaches a service worker's `fetch` handler, and it already spreads `...process.env`), and turbo needs no `env` array (framework inference already covers `VITE_*`/`EXPO_PUBLIC_*` — checked with `--dry=json`). **`socket` in `apps/web` is real configuration that changes nothing yet**, because no screen there calls `watch()` until WP5-7, and docs/10 says so rather than implying parity. The ADR lists the three things standing behind the five un-latched shard findings instead of asserting the shard is sound | S |
| **WP5-7** | **Batch `/v1/etas?ids=…`, then adopt live on Nearby** *(✅ **done 2026-08-03** — [ADR-079](../08-decision-log.md#adr-079--one-request-per-round-the-batch-eta-endpoint-and-nearby-as-a-live-adopter))* | Nearby is not the first adopter because its live target set is ≤6 places, so the poll emulator would issue 6 requests per window where the screen issues 1 — a real regression. `applyLiveEtasToNearby` is written and corpus-pinned with no consumer until this lands. Additive per ADR-052 §5 | ~~Nearby subscribes; request count per window does not increase~~ → **met, and the criterion had to be restated because the two renderers did not start from the same number.** Measured per window (30 s): `apps/web` was 1 (`/v1/nearby` on an interval) and is 1; **`apps/mobile` was 0** — it had no `refetchInterval` at all, so its arrivals never refreshed and its `Date.now()` never advanced, which also meant `etaReadout`'s staleness cue could never fire — and is now 1. So the honest statement is **≤ 1 request per window per Nearby screen, and the same number on both renderers**; mobile's 0 → 1 is a fix, and against that baseline *any* subscription "increases" the count. A second live defect fell out with it: a failed first load on either renderer was **permanent** (`retry: 1`, no interval, no pull-to-refresh on the error branch), now covered by the Place screen's conditional `refetchInterval`. **Additive held, and `CONTRACT_VERSION` did not move** — 7 → 8 paths, 36 → 38 schemas, with `/v1/etas/{id}` untouched — but the row did not anticipate that `WireParam` has to widen: **the parameter repeats rather than carrying a delimiter**, because `,` is a legal `idchar` and a query string decodes `%2C` before anything could split on it, so `?ids=A%2CB,C` and `?ids=A,B%2CC` arrive identical (verified, not assumed). `/v1/live?targets=` stays comma-separated and the inconsistency is recorded rather than propagated. Four more sub-decisions: the answer is **enveloped per id** (`{ reports: [{ id, etas, failed?, error? }] }`) because a flat list is *undecodable* — the target→pole map lives in the dataset and no client holds a copy; a per-id failure is an **entry with a `200`**, not a status, for ADR-073's own reason one level up; the cap is **12 on the wire** with a `400` over it rather than a truncation, and the client **chunks**; and there is **no `routes=`**, so `narrowEtasToRoutes` became a kernel rule the edge and the transport both call rather than a `.filter` written twice. The row also missed that a batch needs its own `LIST_CTB_BUDGET` — the third copy of `12` was avoided by hoisting `nearby.ts`' out. `liveTargetsKey` is in the kernel because an array in a hook's dependency list is a **request storm**: the subscription's own readings re-render the screen, and `subscribe` fires a round immediately. **What this deliberately does not close:** `StopCardView.incomplete` is now first-paint-only on Nearby (ADR-077 decision 2's rule), so a card at a place whose outage was already running when the screen opened reads as a quiet stop — **WP5-14** | M |
| **WP5-8** | **A `--range` mode for `scripts/precommit-docs-check.mjs`** *(✅ **done 2026-08-03** — [ADR-078](../08-decision-log.md#adr-078--rule-7-is-enforced-per-commit-over-a-range-and-an-empty-range-is-a-failure))* | The docs-freshness rule of CLAUDE.md rule 7 **has never been enforced anywhere**: the hook is not installed (`core.hooksPath` unset) and the script is a Claude Code `PreToolUse` hook that reads a tool-call payload on stdin and diffs the *index*, so in CI it exits 0 having checked nothing. `ci.yml` states that rather than shipping the green no-op | ~~One declaration of the rule, applied per commit over a PR's range in CI, with a selftest that watches it fail~~ → **met on all three.** The rule is `docsVerdict({ files, bypass })` and both modes call it — hook mode over the index with the bypass off the *command line*, `--range` over each commit's `diff-tree` with the bypass off its *message*; computing `bypass` in the caller is what keeps the predicate testable with neither git nor stdin. Four sub-decisions the row did not anticipate: **an empty range is a FAILURE** (a range naming no commits is this repo's recurring *gate looking at nothing*, in the one shape a commit-range check can take); **`--no-merges`**, because a merge diffs empty against its first parent and `pull_request` checks out a *synthetic* merge carrying the whole PR squashed — with the escaping case (an "evil merge") stated rather than left to be found; **`--root`** on `diff-tree`, without which a repository's initial commit passes unexamined (1 file with it, 0 without, measured here); and **a shallow clone fails the selftest's live control by name**, because `actions/checkout`'s default depth would have made it examine 1 commit, report "1 commit examined" and pass. **The measurement that made this an S:** the rule was run over all **51 non-merge commits in this repository's history and every one passes** (44 touch code, 12 claim `[docs-ok]`) — so no grandfathering, no `since:` date and no allowlist of historical shas. The selftest builds a real repository in `os.tmpdir()` with an explicit `cwd` on every git call, because this workspace shares a checkout with other sessions. The chain runs the selftest, `ci.yml` runs the range (and now needs `fetch-depth: 0` for two steps) | S |
| **WP5-9** | **One reading per boarding point — the canonical model is under-normalising** *(added 2026-07-31; ✅ **done 2026-07-31** — `etaBoardingKey` + `dedupeEtas` in `packages/core/src/eta.ts`, the same-pole line fallback in `applyLiveEtasToStopDetail`, `/v1/stop` attaching through it in `apps/edge/src/stop-route.ts`, and the card collapse in `stopCardView`; the owner's own framing: "we need to normalise the data to our own structure so we can understand what we're doing and consistently present it")* | `dedupeEtas` (`packages/core/src/eta.ts`) collapses on `operator\|routeNo\|bound`, so `/v1/etas/:id` returns at most one reading per line **per place** and discards the sibling pole's arrival — measured: GMB 68K had buses at both poles 11 s apart and we published one. Since correction (11) a row is per *pole*, so the second pole's row now reads "no reading right now" while a bus is genuinely due there. Upstream keeps the two distinct and we fuse them; the fix is `stopId` in the key (or dedupe per member before merging). It is a **wire change** — `/v1/etas/:id` and `/v1/stop/:id`'s embedded readings both grow — so it needs its own ADR, a payload-size check against the biggest interchange, and a look at whether `NearbyStop.etas`' `maxRows` cap still reads honestly when a line can appear twice. Nothing in Wave 5 depends on it | ~~A place with one line boarding at two poles publishes a reading for each; the live merge fills both rows; payload growth measured at the worst interchange~~ → **met on all three, and the measurement moved two of the three answers.** The key is `operator|routeNo|bound|stopId` (`etaBoardingKey`); variants at one pole still collapse. Driven against live feeds: of the **43** rider lines boarding at two poles of one place (37 places, build `1ccad7436a8df480`), upstream had a bus at both poles for **2** at 23:20 — 68K outbound and inbound at Fu Kin Street, three arrivals at each pole — and we published **one** reading for each pole where we had published one for the place. Watched in the browser: pre-fix the first kerb's 68K row showed the static band *"every 7 – 9 min"* while the second showed *3 min*; post-fix they read **9 min** and **4 min**. **Payload growth is not where the row expected it.** `/v1/etas` grows only where a shared line has two live readings (68K: 352 → 788 B) and is **unchanged at every one of the eight heaviest interchanges** — Victoria Park's 113 lines have no line at two poles — with a territory-wide ceiling of +43 readings ≈ +13 kB. The growth that does exist is on **`/v1/stop`**, from the variant fallback rather than from the pole: +0.5–2.8 % per place, **+942 B on Victoria Park's 58 kB**, +1.1 % over 13 sampled places. Nothing near ADR-055's 188 kB. **Two defects the row did not know about, both measured live and both fixed:** `/v1/stop` indexed readings by route id alone and so handed a reading off one pole to a row that departs from the other (`GMB:1A:outbound:2002355`'s row at `GMB:20001114` carrying a reading stamped `GMB:20009421`); and 2 of 2124 readings across 156 places name a service-type variant no row at their own pole lists, so a strict pair match would have dropped a real arrival at the kerb it was coming to. Both are closed by the edge calling **`applyLiveEtasToStopDetail`** instead of indexing its own rows — one rule for the HTTP payload and the live merge — with a same-pole line fallback built from `dedupeEtas`. **`maxRows`/`routeCount`: the card collapses to one row per line and the count stays in lines.** `routeCount` counts rider lines across every pole, so subtracting per-pole rows from it understates what is hidden: watched, with the collapse removed, the Fu Kin Street card printed 68K twice and said *"+0 more"* while 68S was hidden altogether, and at `maxRows: 2` the whole card was one number printed twice. A compact card has no kerb heading, so the kerb stays a Place-detail fact (residual: a rider who stars one line at *both* kerbs sees one row on Favourites — not a regression, and it needs a pole label the card does not have). Corpus +14 cases across three groups, one of them a new **named boundary row**; every new assertion watched failing first | M |
| **WP5-10** | **Label a pole heading by something that distinguishes it** *(added 2026-07-31; ✅ **done 2026-07-31** — `poleSideOctants` in `packages/core/src/stop-detail.ts`, 8 `poleSide*` keys in `@nextbus/i18n`, rendered by Place detail)* | The display cost correction (11) accepted: at Tin Shui Wai Park both members print the stop code **TN510**, so 269D now renders twice under headings that look identical. The heading is the wrong thing to fix by fusing two services; label it by the pole's own name or bearing (`bearingOctant` is already in the kernel and already renders the compass caption) | ~~Two poles of one place are distinguishable in the list without reading the routes under them~~ → **partly, and the shortfall is the data's not the label's.** Re-measured over `d598893de6add2e4`: **567** of 10 118 places print a duplicate pole heading — only 64 are stop-code collisions, **507** are poles with no printed code at all (two Citybus poles both reading just "Citybus"). The rule resolves **226** places by the bearing from the colliding poles' centroid, and **declines 345 groups** — 331 because the poles are under 10 m apart (49 of the 64 code collisions are at *exactly* 0.0 m), 14 because two of three colliding poles fall in one octant. **Tin Shui Wai Park itself is declined: its two TN510 poles are 1.11 m apart**, one coordinate grid step, so no compass word can send a rider to one rather than the other. Those pairs are one physical pole published under two upstream ids and the remedy is in `buildPlaces`, not the heading — see the new row below | S |
| **WP5-11** | **`buildPlaces` keeps one physical pole as two members** *(added 2026-07-31 by WP5-10's measurement; ✅ **done 2026-07-31** — `foldDuplicatePoles` + `SAME_POLE_MAX_SEPARATION_M` in `packages/data-normalize/src/dataset.ts`, `aliasIds` on the wire, `boardingPoleId` and `dedupeRoutes(routes, members)` in `packages/core/src/stop-detail.ts`)* | Same operator, same name, same printed stop code, coordinates identical or one grid step apart — and clustering keeps them as two members, so the Place screen renders two groups under one heading and (since correction 11) a line boarding at "both" gets two rows. **Measured 2026-07-31, and the measurement rewrote this row: there is no distance gap to threshold on.** Over `d598893de6add2e4`, the 516 member pairs sharing operator *and* full name within one place run continuously — 88 at 0–0.5 m, 11 at 0.5–2 m, 47 at 2–5 m, 109 at 5–10 m, 164 at 10–20 m, 71 at 20–31 m — and the genuine two-berth stands sit *inside* that continuum (TN507 **22.88 m**, TN581 **19.01 m**, ND126 **35.35 m**; Tin Shui Wai Park's TN510 pair is **1.11 m**). **Route-disjointness discriminates nothing** — it is the norm at every distance, 36 of 36 at 25–31 m — so do not build on it. The defensible scope is therefore only *same operator, same name in every locale, same printed code, within the coordinate quantisation floor (~2 m)* ≈ **99 of 516 pairs**, TN510 among them. Everything from 2 m up must stay two members. Note WP5-10's octant floor is 10 m for a different reason and the two thresholds must stay different: declining to name a compass side is weaker than asserting two poles are one. **The blocker that outranks the feature:** ADR-062 keys favourites on the *member pole* id precisely so clustering changes are survivable, so a merged-away id must still resolve through `alias:<hash>:<stopId>` — proven end to end against a rebuilt local dataset, not by reading the code. If that cannot be made safe, do not ship the merge: losing a rider's favourites silently is worse than two identical headings. It is a dataset change, so it moves the build hash and needs its own ADR | A place has one member per *indistinguishable* boarding point; the ~99 coincident pairs merge and TN507/TN581/ND126 provably do not; a favourite keyed on a merged-away pole still loads. **Not** "no place shows two identical headings" — that was the original wording and it is unachievable: the 2–10 m band is too far apart to merge and too close for a compass side, and 156 pairs stay ambiguous by design  → **met, and the specification held on every point.** Built and measured over `1ccad7436a8df480`: of the **464** clustered pole pairs sharing an operator and the same name in all three locales, the **85** at or under 2 m fold — **80 poles folded away across 75 places**, 30 of which fall to a single member — and every one of the other 379 stays two members. The quantisation argument is *confirmed* rather than assumed: those 85 pairs sit at exactly four separations (0.000 m ×75, 1.027–1.029 ×3, 1.112 ×4, 1.515 ×3) and the build contains **nothing** between 1.515 m and two grid steps, so the threshold's window is empty and its value changes no outcome. TN510 folds; **TN507, TN581 and ND126 are each still two members**, asserted in `apps/edge/test/pole-merge.test.ts` and re-checked through the running API. Route-disjointness was re-measured and is worse than useless: overlap occurs in every band including 8 pairs at 0–0.5 m. Duplicate pole headings fall **567 → 496 places**. **Favourites proved end to end, not read:** rebuilt, `dataset:publish --local`, then a favourite keyed on a merged-away pole (`KMB:FADDB1E247E62936|KMB:106:inbound:1`) rendered on the Favourites tab with a live 7-minute arrival. **The design the row assumed had to change in one place, and it was a defect, not a preference:** the wire keeps *raw* pole ids on route rows **and on every reading** — an alias is an addressable pole, not a spelling to be replaced — because `applyLiveEtasToStopDetail` matches `(row.stopId, routeId)`, so stamping a reading with the boarding point blanked every arrival at a folded pole on all three live paths. The fold is a display collapse only: `dedupeRoutes(routes, members)` keys on the boarding point and returns rows untouched, since a row's id is the key `SaveStar` persists. **Residual is WP5-12 below.** | M |
| **WP5-12** | **The 2–10 m residual: two poles a rider can be told nothing about** *(added 2026-07-31 by WP5-11's measurement; ✅ **done 2026-08-03** — [ADR-080](../08-decision-log.md#adr-080--what-tells-two-boarding-points-apart-in-the-order-the-data-can-support-it))* | What is left after WP5-11 folds the ≤2 m pairs and WP5-10 labels the ≥10 m ones: **141 member pairs in 115 places** that share an operator and a name in every locale and sit 2–10 m apart (measured post-fold over `1ccad7436a8df480`: 43 pairs in 2–5 m, 98 in 5–10 m; **0 remain at or under 2 m**). `poleSideOctants` declines them (a compass word at 3 m is fake precision), and `foldDuplicatePoles` declines them (2 m is one coordinate grid step; 3 m is two, and two poles 3 m apart may genuinely be two poles). The two rules are each right and the gap between them is real, so this needs a *third* kind of answer rather than a wider threshold on either — candidates: **a printed code upstream carries in one locale only** — the 14 pairs excluded at ≤2 m are all this shape and the deficiency runs the way round nobody expected: at Prince Edward Station both poles read `PRINCE EDWARD STATION, MONG KOK POLICE STATION` in *English* at the same coordinate while the Chinese reads `(MK356)` and `(MK357)`, so the code exists and only the English label lacks it, the route sets as a *tie-break* rather than as evidence, or accepting the duplicate heading and saying which pole a rider is closer to when they are located. Do not widen either threshold to close it | ~~A rider at one of the 115 places is given something true to choose with, or the app states plainly that there is nothing to choose between — never a word that flips on a one-grid-step coordinate nudge~~ → **met, on both branches — and this row was wrong about its own population, which is the finding.** The band reproduces exactly over build `ceb33eed99461e04` (141 pairs / 115 places; 43 at 2–5 m, 98 at 5–10 m, **0** at or under 2 m, so the fold's window really is empty), and the acceptance's prohibition was quantified rather than assumed: **one latitude grid step flips the octant in 27 of the 141 pairs (19 %)**. Neither threshold moved. **Two of this row's three candidate leads are dead, measured:** *a code in one locale only* resolves **0 of 141 by construction** — the band's own predicate is "identical name in every locale", so any code is identical on both poles, and the row conflated two disjoint sets; and *which pole a rider is closer to* is **34.4 % wrong for a rider standing at one of them** (97 of 282), because `SNAP_GRID_M` is 25 and the snap displaces the fix by a mean of 10.07 m — exceeding the whole pair separation in 224 of 282 — deterministically, so it is a stable lie rather than a flickering one. The *route sets* were confirmed useless rather than refuted (136 of 141 disjoint, as at every other distance) and are empty as a tie-break, since the route rows already print under each heading. **The answer was the shape the row did not list: the heading throws away the pole's own name.** Of the 258 groups the compass rule declines, **143 have member names that differ** — at Queen Mary Hospital two minibus poles 7.35 m apart both print bare `Minibus` while the wire has carried two different street descriptions all along — and the other **115** are the set proper, where the app now **says so plainly** (the acceptance's second branch). One kernel export, `poleDistinctions`, answers with at most one of: a compass side (byte-identical to `poleSideOctants`, asserted as a property, so the 226 groups that speak today are untouched), the pole's own name (compared through `poleNameKey`, **never bytes** — 21 groups differ only by case or punctuation width and a byte test would print the same words twice while claiming the ambiguity resolved), or *"Another stop a few steps away — check the sign"*. **Units are what make the mixed place honest**: a group is partitioned by complete linkage at the *same* 10 m — no third threshold — and the compass question re-asked about the units, so at Lok Hin Terrace two coincident poles share a side **and** say they are adjacent while the pole 50 m away gets its own side and is **not** called adjacent. Today all three are told nothing. The row's lead about a locale-only code turned out to be a **display** fix rather than a dataset one — `poleFlagCode` borrows a flag-shaped code across locales, resolving Prince Edward Station's `MK356`/`MK357`, gated on Latin-letters-then-digits because 12 of the 63 candidates are translated place phrases and 167 poles carry parentheticals that disagree across locales. Measured: zero new collisions, no sided group loses its side, 12 groups stop colliding. **No dataset rebuild** (every field is already on `StopDetailSchema`) and **no favourite moves** (a unit is a display concept; expressing it as a boarding-point remapping would re-break WP5-9). Honest cost: places carrying a cue go **226 → 464** of 10 115. **Still open and stated:** 54 poles in 22 groups are told nothing (Statue Square's four poles across 41 m), and ADR-072's both-kerbs favourite — which this row also owned — is explicitly declined here, because it needs a per-row kerb label a compact card refuses to print | M |
| **WP5-13** | **`/v1/nearby` and `/v1/stop/:id` cannot say "we could not ask"** *(added 2026-08-03 by WP5-4; ✅ **done 2026-08-03** — [ADR-077](../08-decision-log.md#adr-077--a-card-can-say-we-could-not-ask-and-a-failure-list-must-not-outlive-its-round))* | [ADR-073](../08-decision-log.md#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire) put per-pole failure on `/v1/etas/:id`, where both live engines read it. The other two reading-bearing endpoints share the *same producer* (`stopArrivals`), so the information exists and an optional `failed` field on `NearbyStopSchema` / `StopDetailSchema` is additive and free — and it is **not** free to make correct, which is why it was left out rather than shipped as drift: `applyLiveEtasToNearby` and `applyLiveEtasToStopDetail` spread the document they are handed, so a `failed` list fetched once over HTTP would survive every later live merge and a screen would keep saying "we could not reach this kerb" long after the socket recovered. The fix is to teach the two merge helpers about failures — a kernel change with corpus rows of its own — and then decide what a card *says*, which needs an i18n key and is the same product question ADR-056 decision 18 declined to answer for a refused target. **Sequence it after WP5-7**, so Nearby has a live subscription and the field lands with a reader | ~~A Nearby card and a Place screen's first paint are distinguishable from a stop with no buses; a `failed` list does not outlive the outage it describes across a live merge; whatever a rider is told has an i18n key rather than a hard-coded string~~ → **met on all three, and the sequencing argument in this row turned out to be wrong.** It said "after WP5-7, so the field lands with a reader" — but the reader was already there: `/v1/nearby` is fetched by a screen *today*, and the staleness hazard only exists on the live path WP5-7 will add. Doing it first means WP5-7 inherits a merge helper that already refuses to carry a stale failure list. The merge helpers **take** the failure set and destructure the old one out of the spread, so an absent argument clears the field — the fail-safe direction. A card gets a boolean (`StopCardView.incomplete`), not a count, because it prints no kerb heading; both renderers draw it from the kernel's answer and `check-no-derivation.mjs` keeps it that way. **One change nobody predicted:** `EtaFailure` on `detail.ts` closed an ESM cycle with `responses.ts`, so the whole error taxonomy moved to a new `wire/errors.ts` — and adding a second star export for it at the package index would have made `ERROR_CODES` *ambiguous*, which ESM resolves by excluding the name, silently. Caught by asserting the root exports at runtime. Verified against live data with the KMB upstream unroutable: the Citybus place in the same response kept its readings and reported nothing | M |
| **WP5-14** | **The frames do not carry `failed`, so a live card cannot say "we could not ask"** *(added 2026-08-03 by WP5-7)* | [ADR-077](../08-decision-log.md#adr-077--a-card-can-say-we-could-not-ask-and-a-failure-list-must-not-outlive-its-round) decision 2 named this as the fix and deferred it in one sentence: *"the frames carry no failure list, deliberately — so once a subscription takes over, its `status: retrying` is the authority and the HTTP-era list must go … the fix is frames that carry `failed`, which is a wire change to make **when a screen renders per-kerb failure**, because that is when the extra precision has a reader."* WP5-7 is that moment: Nearby subscribes, so `StopCardView.incomplete` is now **first-paint-only** there. Most of an outage is still honest without this — `retainFailedPoles` keeps a refusing kerb's readings and they visibly age on the operator's clock (ADR-008) — and the residual is precisely one case: **a pole that has never produced a reading retains nothing**, so a card at a place whose outage was already running when the screen opened reads as a quiet stop. The change is not additive-and-done: `SnapshotFrame` and `DeltaFrame` gain `failed?`, `LiveSession` has to hold it, `applyLiveFrame` has to decide what a delta with no `failed` *means* (unchanged, or empty — an absent optional cannot say both), `EtaHub.sendRound` has to send it, `asyncapi.json` re-emits, ADR-074's corpus grammar needs a column, and only then can `EtaListener` carry it. Both engines in one commit, or they diverge | A Nearby or Favourites card is distinguishable from a quiet stop **on the live path as well as the first paint**, on both engines, with the corpus asserting they agree; and a recovered kerb's marker clears within one round | M |


## Phase 2 cost model

Cited inputs — vendor-published rates, not measurements taken here (~~Measured/verified inputs~~;
re-verified against the Cloudflare pricing pages 2026-07-30, and several had moved since they were first
written): Workers Paid $5/mo, 10M req + 30M CPU-ms included, then $0.30/M and
$0.02/M. Waiting on `fetch()`/KV does **not** count as CPU; **Cache API hits still count as billable
requests**. DO: 1M req/mo included then $0.15/M, WS **messages count 20:1** (*incoming* only — outgoing are
free), alarms count as requests, 400k GB-s included **then $12.50/M GB-s**, hibernated objects accrue **no**
duration. Not in this list and dominant when unsharded: **each `setAlarm()` is billed as one row written**,
$1.00/M over 50M.

*Every cell below is superseded by the correction under this table. Kept rather than deleted because it is
cited elsewhere and the citations need somewhere to land.*

| DAU | Polling (stated "today, 20 s"; actually **30 s**) | DO + WS @15 s alarm (**UNVERIFIED**) | DO + WS @60 s alarm (**UNVERIFIED**) |
|---|---|---|---|
| 1k | $5 (0.9M req → 0.6M) | $5 | $5 |
| 10k | $5 (9M req → 6M) | ~$8 | $5 |
| 100k | ~$29 (90M req → 60M, $15 over not $24) | ~$35–45 | **~$12** |

**Polling cost scales with active user-minutes; DO cost scales with hot-stop-minutes × alarm
cadence.** So the naive 10–15 s alarm from `docs/03` makes DO *more* expensive than polling — it
burns 4× the requests to deliver identical data, because upstream refreshes only ~1/min — **a claim cited
here to `docs/01` and ADR-008, neither of which contains it.** **Align alarms to ~45–60 s and DO wins
decisively at scale.** Crossover lands around 40–45k DAU. *(The cadence conclusion survives; the argument
for it does not — read the correction.)*

> ⚠️ **Correction, 2026-07-30 (WP5-3 / [ADR-056](../08-decision-log.md#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)):
> the cadence conclusion above is right and every number supporting it is wrong.** Read the ADR's
> cadence section instead of this table.
> - **The cost argument does not survive sharding**, which is what this plan itself mandates. Once one
>   object serves many stops, a 15 s alarm costs ≈**$10/month per 1000 continuously-hot stops** more than a
>   60 s one — so cost would *not* decide the cadence. Unsharded, the expensive meter is `setAlarm`, billed
>   as **one row written** at $1.00/M (6.7× the request price), which this model does not have at all.
> - **The right argument is a measurement of upstream**, which holds at any scale: distinct
>   `data_timestamp` values arrive at a **mean 44.75 s** (28–60 s observed; n=4 intervals, one KMB route, one
>   off-peak morning — a *first* measurement). A 15 s alarm returns a byte-identical body ~2 ticks in 3, and
>   the CDN's `max-age=300` plus a **non-monotonic** `generated_timestamp` mean some of those ticks cannot
>   see a fresher value at all.
> - **"Polling (today, 20 s)" is false** — `CLIENT_POLICY_DEFAULTS.refreshAfterMs` is **30 s** (ADR-053), so
>   every request count in that column is 1.5× too high (100k DAU → 60M req, $15 over, not $24).
> - **"Crossover 40–45k DAU" is not reproducible**: ≈37k from this table's own inputs, ≈56k at the real
>   cadence, and it rests on an unstated *"10 active minutes per user per day"*. Derive it or drop it.
> - **All four DO cells are UNVERIFIED** — no working is shown, and they omit the $12.50/M GB-s duration
>   rate, `setAlarm` rows and connection requests. The heading **"Measured/verified inputs" overclaims**:
>   those are vendor-published rates (re-verified 2026-07-30; several moved when SQLite storage billing went
>   live in January 2026), not measurements taken here.
> - **The *"upstream refreshes ~1/min"* citation is empty.** `docs/01` contains no refresh figure and ADR-008
>   contains none either — it is about not faking a countdown. The real citation is the KMB vendor
>   specification (`docs/02:23-25`) plus the measurement above. `packages/core/src/policy.ts:39` cites the
>   same missing source for `staleAfterMs`.
> - **One meter that changes the design rather than the bill:** *outgoing* WebSocket messages — the entire
>   ETA fan-out — are **free**, incoming ones are billed 20:1, and hibernation auto-responses are free and do
>   not wake the object. So **reconnect churn, not message volume, is what a socket costs.**

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
measurement. Instrument it before committing to WP5-3. *(2026-07-30: still an estimate, and note the figure
"~500" appears nowhere in the cost-model section itself — that section states no hot-stop count at all, so
this flagged assumption is invisible at the point of use. WP5-3 shipped without it, on a cadence justified by
a measurement of **upstream** instead, which does not depend on concurrency. The number that now matters more
is sockets per shard: 64 × 8 shards = 512 concurrent live clients before a refusal — WP0-5's to revisit.)*

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
