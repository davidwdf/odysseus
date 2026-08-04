# CLAUDE.md — read this before doing any work

This is the agent onboarding guide for **NextBus HK**, a fast, mobile-first Hong Kong bus
arrival-times app. Its job is to make sure every agent works the same way and we stay on the
same page. **Read this, then skim [`docs/README.md`](./docs/README.md).**

## What this is
A pnpm + Turborepo monorepo. One Expo codebase ships a PWA now and iOS/Android later; a Cloudflare
Worker is the edge data layer. HK bus open-data APIs (keyless) are normalized into one model.

The **plan is the source of truth** and lives in [`docs/`](./docs/README.md):
- New here? Read `docs/01` (vision) → `docs/03` (architecture) → `docs/08` (decision log) → `docs/10` (run it).
- Theme/design system: `docs/09`. Data sources: `docs/02`.

## Run it (always the same commands, from the repo root)
```bash
pnpm install            # first time
pnpm dev                # EVERYTHING: edge worker + Expo, concurrently (the IDE run command)
pnpm dev:edge           # just the Cloudflare Worker  → http://localhost:8787
pnpm dev:mobile         # just Expo (press w = web/PWA, i = iOS, a = Android)
pnpm dev:web            # Expo straight to web/PWA
pnpm dev:dom            # apps/web — the Vite + React DOM renderer (WP4-1)  → http://localhost:8082
pnpm typecheck          # tsc --noEmit across all packages — MUST pass before commit
pnpm test               # vitest in every package that has tests (apps/edge runs inside workerd with
                        # simulated KV/R2) — and then the whole `pnpm boundaries` chain
pnpm boundaries         # the gate chain: layer rules + each check-*.mjs and its --selftest
pnpm lint               # Biome
pnpm format             # Biome --write
                        # …CI runs typecheck · lint · test · `wrangler deploy --dry-run` ·
                        # `git diff --exit-code` on a CLEAN CHECKOUT (.github/workflows/ci.yml)

pnpm --filter @nextbus/contract openapi:emit   # regenerate packages/contract/openapi.json (ADR-052)
pnpm --filter @nextbus/contract asyncapi:emit  # …and asyncapi.json — the /v1/live frames (ADR-056)
pnpm --filter @nextbus/contract ui:emit        # …and ui/<component>.spec.json — the component specs
                        # (ADR-083); each is validated on emit, and a stale copy is a red build
pnpm --filter @nextbus/contract native:emit    # …and README.md + native/{ios,android} — it prints the
                        # path/schema/corpus COUNTS, so it goes stale on any wire or corpus change too
                        # …all FOUR are committed + gated: `pnpm test` fails if any is stale
pnpm dataset:build      # fetch + normalize + cluster the static dataset → apps/edge/.dataset/<hash>/
pnpm dataset:publish    # …then write the shards to KV/R2 and flip `build:current` (ADR-055)
pnpm dataset:publish --local          # …into the Miniflare state `wrangler dev` uses — exercises the KV path
pnpm --filter @nextbus/mobile build:web   # expo export + Workbox service worker → apps/mobile/dist
pnpm --filter @nextbus/web build:web      # vite build  + the SAME service-worker policy → apps/web/dist
                        # …one declaration of it, in scripts/pwa/ (ADR-082). Serve the two apps on
                        # DIFFERENT ports — a service worker's scope is the origin, so the first
                        # navigation after switching apps on one port comes from the other app's cache
```
Full guide incl. deploy: [`docs/10`](./docs/10-scaffold-and-running.md).

## Repo map
```
apps/mobile          Expo app (iOS/Android/Web-PWA)
apps/web             Vite + plain React DOM — the renderer that REPLACES the Expo PWA (ADR-075).
                     Since WP6-0 it is a whole shell: react-router over a declared destination set
                     (`src/shell/destinations.ts`), a persisted query cache, a locale override, an
                     appearance store, a service worker and an installable manifest (ADR-082) —
                     with exactly ONE ported screen, Nearby, rendered from the identical
                     `packages/core` functions. The other seven destinations render a placeholder
                     naming the work package that ports them. It derives nothing, and a gate
                     enforces that (ADR-068/069)
apps/edge            Cloudflare Worker (ETA proxy, /v1/nearby, /v1/etas/:id and /v1/etas?ids=… — the
                     batch one round of a live subscription is fetched in, ADR-079 — /v1/tiles,
                     /v1/health; reads precomputed dataset shards from KV/R2 — ADR-055; and /v1/live,
                     the ETA socket served by the sharded, hibernating `EtaHub` DO — ADR-056)
packages/contract    Zod schemas = the ONE declaration of every wire shape → OpenAPI 3.1 (ADR-052)
                     + the /v1/live frames → AsyncAPI 3.0 (`asyncapi.json`, ADR-056)
                     + `src/ui/` → `ui/<component>.spec.json`, the component specs both renderers are
                     measured against (ADR-083). Emitted, committed, drift-gated like the other two
packages/ui-spec     the component-spec FORMAT (a Zod schema) + the conformance walker. NO NextBus
                     vocabulary — two gates enforce that (`layers.json` gives it `use: []`, and
                     `check-no-domain-vocabulary.mjs` scans for the words an import graph cannot see).
                     The first thing a second app would copy; extracted on demand, not now (ADR-075 d7)
packages/core        canonical types (`z.infer` of contract, `import type` only) · DataSource · ETA helpers
                     · `live.ts` = the live-protocol rules (frame reducer, diff, cadence, shard, socket URL)
packages/data-normalize  KMB + Citybus adapters (upstream → canonical)
packages/api-client  EdgeClient (the v1 DataSource) · `watch()` = the live frame protocol over a
                     pluggable transport in `src/live/` (poll emulator = the DEFAULT · memory fake ·
                     WebSocket) · `src/endpoint.ts` = the ONE declaration of where the API is
                     (`DEFAULT_API_URL`), with the socket URL derived from it · the location controller
packages/ports       the 7 type-only platform interfaces — `KeyValueStore` · `LocationProvider` ·
                     `LocaleProvider` · `LinkOpener` · `Clock` · `TileSource` · `LiveTransport` (new
                     in Wave 5). `ls packages/ports/src` IS the iOS/Android porting checklist
                     (ADR-051); the package imports nothing and emits no JS
packages/i18n        en / zh-Hant / zh-Hans UI strings
packages/ui          NativeWind preset + themes + tokens
packages/tsconfig    shared TS configs
scripts/pwa          the Workbox caching policy + the assertions over the emitted `sw.js` — ONE
                     declaration, read by both apps' `build:web` (ADR-082). It is ADR-058 in data,
                     so a second copy could disagree about what a rider sees with no network
```

## Golden rules (don't break these)
1. **Internal packages are source-only** (`main → src/index.ts`); there is **no build step**.
   Metro/esbuild transpile the TS. So `typecheck` is just `tsc --noEmit` per package. Import via
   `@nextbus/*`.
2. **All data goes through the `DataSource` seam** (`@nextbus/core` → `@nextbus/api-client`). UI
   and screens NEVER call upstream HK APIs directly. Swapping the v1 client for the v2 socket
   engine must not touch the UI. See `docs/03`, ADR-004. **Two gates enforce this, not one:**
   `pnpm boundaries` checks the import graph, and `check-view-transport-free` checks the *source*
   for a `fetch(`, a `new WebSocket`, a `ws://` literal or a `/v1/` path in a view — because a URL
   literal imports nothing and the import graph cannot see it (ADR-056).
3. **ETAs are approximations — never fake precision** (ADR-008). No client-side per-second
   countdown. Update the value only when fresh data arrives; use tabular figures; show
   "Arriving/Due" under a minute; indicate staleness. Use the helpers in `@nextbus/core/eta`.
4. **Styling = semantic tokens only** — NativeWind in `apps/mobile`, plain Tailwind 3.4 in
   `apps/web`; **both consume the same generated `@nextbus/ui/preset`**, so a token exists once. Use `bg-bg`, `text-text`, `text-muted`,
   `text-accent`, `bg-positive`, etc. — never raw hex in components. Themes (incl. liveries) are
   value-swaps in `@nextbus/ui` (`docs/09`, ADR-015). **Radix/shadcn are web-only — do NOT use
   them.** For RN primitives use **react-native-reusables** (copy-in, NativeWind-based).
5. **Bilingual is core.** UI strings live in `@nextbus/i18n` (en / zh-Hant / zh-Hans). All bus
   data names are `I18nText` from the canonical model. Never hard-code English labels. Screens read
   the active locale via **`useLocale()`** (device-detected through `expo-localization` +
   `resolveLocale`, with a manual-override hook) — never hard-code a locale constant in a screen.
   **English prose and user-facing `en` strings use British English (Oxford `-ize` spelling)**
   (ADR-031): write `colour`/`centre`/`grey`/`favourite`/`behaviour`/`licence` (noun); keep the
   `-ize`/`-ization` ending (`normalize`, `optimize`, `memoize`) — that's Oxford British, not US, and
   matches `@nextbus/data-normalize`. **Code is exempt:** identifiers, props, CSS/Tailwind keywords
   (`color`, `text-center`, `bg-gray-*`), upstream API fields, and route/file names keep their existing
   spelling (e.g. the `favorites` store key stays — only its UI *label* is "Favourites").
6. **Pin SDK-aligned dependency versions — don't guess.** Expo packages are version-aligned to the
   SDK (e.g. `expo-router@56.x`). For RN-ecosystem libs, read the versions from
   `expo@<ver>/bundledNativeModules.json` (we did this for the scaffold). Tailwind stays on **3.4**
   (NativeWind), TypeScript on **5.9** for shared packages. `esbuild` is pinned repo-wide via
   `pnpm.overrides` — `.npmrc` sets `node-linker=hoisted`, so two versions fight over the single
   hoisted platform binary and `wrangler dev` dies with *"Host version does not match binary version"*.
7. **Docs are the source of truth and must stay in sync.** A commit that stages code without `docs/`
   changes must either update the relevant doc (and add an ADR in `docs/08` for any new cross-cutting
   decision) or — if truly no doc change is needed — include `[docs-ok]` in the commit message. Don't
   reach for `--no-verify`. **Know what enforces it: CI, per commit** (WP5-8, ADR-078).
   `scripts/precommit-docs-check.mjs` holds the rule once and applies it two ways — as a **Claude Code
   `PreToolUse` hook** over the *index* while you work (`.claude/settings.json`; note this is not a git
   hook, so a `git commit` outside Claude Code is unaffected), and as
   `--range <base>..<head>` over every commit in a pull request, which is the step `ci.yml` runs. A range
   naming no commits **fails**, so it cannot pass vacuously. `[docs-ok]` in the *message* is the only
   bypass CI honours — `--no-verify` skips a hook, not a review — and it is permanent and visible in
   `git log`, so use it with the reason in the body. `pnpm test` runs the gate's `--selftest`; check a
   branch by hand with `pnpm check:docs-freshness` (`origin/main..HEAD`).

## Definition of done (for any change)
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm lint` clean (or justified).
- [ ] If you changed behaviour, you ran it: worker via `curl`, app via `pnpm dev:web`.
- [ ] Docs updated (or `[docs-ok]`); new decisions recorded as an ADR in `docs/08`.
- [ ] No raw hex / no English-only strings / no direct upstream calls from UI.

## How to verify a change
- **Edge:** `pnpm dev:edge`, then `curl "http://localhost:8787/v1/eta/kmb/<stopId>/<route>/1"` or
  `curl "http://localhost:8787/v1/nearby?lat=22.3193&lng=114.1694"`. `curl .../v1/health` tells you
  which dataset tier you're on — **`"dataset":"kv"` with `datasetBuildsThisIsolate: 0`** is the
  production invariant (ADR-055); `"inline"` means it's building the 8.3 MB dataset per isolate.
- **The live socket:** `pnpm dev:edge`, then open `/v1/live?targets=<percent-encoded canonical id>` with a
  WebSocket client (Node 22 has a global `WebSocket`). **Percent-encode it** — a place id contains `+`, which
  a query string decodes as a space. Expect `snapshot` → `status{live}` → a `delta` only when something
  changed. Note `wrangler dev` will pick **8788** if 8787 is busy.
- **Tests:** `pnpm --filter @nextbus/edge test` runs inside workerd with simulated KV/R2, so the
  coalescer, the shard read path and the Durable Object's caps are exercised for real, not mocked.
- **App:** `pnpm dev:web` and open `http://localhost:8081`.
- **Types/bundle:** `pnpm typecheck`; `pnpm --filter @nextbus/edge exec wrangler deploy --dry-run`.

## Current status
**The living status/handoff doc is [`docs/11`](./docs/11-status.md) — read it to resume.** Summary:
Nearby, Stop detail, Route detail, Favourites and Search are live across KMB/CTB/GMB. The work plan
is [`docs/proposals/03`](./docs/proposals/03-clean-separation-and-phase2-plan.md); **Wave 0 WP0-1…4
are done** — the static dataset is precomputed daily into KV/R2 and the Worker only reads shards
(ADR-055), the basemap is the Lands Department's behind a `TileSource` seam (ADR-049), the PWA has a
service worker and a persisted query cache (ADR-058), and live ETAs are coalesced per pole at a 30 s
TTL (ADR-057). **Waves 1–5 are done**: the wire contract and the id grammar (ADR-051/052/059/060),
the kernel's domain rules under corpus (ADR-062…066), the native artefacts (ADR-067), the second
renderer (ADR-068/069) and — as of 2026-07-30 — the **live protocol** (ADR-056), and **Wave 6 has
started**: its first row **WP6-0 is done** (ADR-082) — `apps/web` is now a plain-React *shell* (router over
a declared destination set, persisted query cache, locale override, appearance, service worker, manifest)
with **one ported screen**, and the Workbox policy is one declaration serving both PWAs. **WP6-1 is done
too** (ADR-083): the first component spec exists as *data* — `packages/ui-spec` is the format and
`packages/contract/ui/stop-row.spec.json` the instance — and **both renderers drive it with neither component
changed**. Five words (`field`/`message`/`literal`/`each`/`oneOf`), `when` as a truthiness path, no expression
language, and every state declaring what enforces it. **WP6-2 is done too** (ADR-084): Nearby has a **screen
spec** — nine states, eight of them with their own declared projection, both renderers driven through every
one — which needed two more format words: a state that declares *what it shows* (a screen's states are
branches over an async status, not fields of a view model) and a slot that *references another spec* (so "a
list of these cards" is checked, not restated). `apps/web`'s Nearby is now the shipping web Nearby, taps and
all. **WP6-3 (Place detail) is next.** `watch()` is a real
frame protocol whose default engine is a poll emulator and whose other engine is a sharded,
hibernating `EtaHub` Durable Object on `/v1/live`. An adversarial review over that finished diff
confirmed **13 findings and all 13 are fixed on the branch** — read ADR-056 decisions 13–19 before
changing live behaviour. **WP5-4, WP5-5 and WP5-6 are done as of 2026-08-03** (ADR-073/074/076):
`coalesce` no longer takes a `fallback`, so an upstream outage is no longer "no buses" on the arrivals
path — `/v1/etas/:id` answers `{ etas, failed }` (**breaking**, `CONTRACT_VERSION` 2.0.0) and one kernel
rule, `retainFailedPoles`, is what both engines apply to it; a shared corpus
(`packages/core/fixtures/live-rounds.json`) drives those rules through the **real** `EtaHub` over a real
socket as well as through the poll emulator; and the socket is selected by
`EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT`, **default still `poll`**. **WP5-13 followed**
(ADR-077): `/v1/nearby` and `/v1/stop` carry `failed` too, the two kernel merge helpers now *take* the
failure set so a stale list cannot outlive its round, and a card says *"Live times unavailable"* from
`StopCardView.incomplete` in both renderers. **Wave 5 is now closed — all 15 rows, ADRs 073–081, merged as
PR #21:** WP5-7 added the batch `/v1/etas?ids=…` and made both Nearby renderers live subscribers (ADR-079),
WP5-8 made CI enforce rule 7 **per commit over a PR's range** (ADR-078), WP5-12 tells two poles a metre
apart apart — by side, then by the pole's own name, then *"check the sign"* (ADR-080) — and WP5-14 put
`failed` on the frames, so an outage marker survives a live round and a recovery clears it within one
(ADR-081). **WP0-5 (deploy + custom domain) is not done** and needs a real domain plus
Cloudflare credentials — though CI now runs on every PR. Roadmap/backlog: `docs/06`, `docs/07`.
Cloudflare agent skills are installed — prefer the `cloudflare` / `wrangler` / `durable-objects`
skills for edge work.
