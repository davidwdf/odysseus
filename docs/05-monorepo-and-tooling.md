# 05 — Monorepo & Tooling

## Manager & orchestrator
- **pnpm workspaces** — fast, disk-efficient, strict dependency resolution.
- **Turborepo** — task graph + caching so `build`/`lint`/`test`/`typecheck` only re-run what changed.

## Repo layout

```
/
├─ apps/
│  ├─ mobile/            # Expo app → iOS, Android, Web/PWA (the single client)
│  ├─ edge/             # Cloudflare Workers project (wrangler): API, LandsD tile proxy, sockets/DOs
│  │                    #   scripts/  → the daily dataset build + publish (node, not the Worker)
│  └─ web-landing/      # (backlog) optional static marketing page (Next.js/Astro)
│
├─ packages/
│  ├─ core/             # canonical types + DataSource interface + the domain rules (pure TS):
│  │                    #   ETA/units, geo, ids, route position, search, stop-name display.
│  │                    #   Each module is pinned by a language-neutral spec/<module>.spec.json
│  ├─ api-client/       # typed client for the edge API + the watch()/socket client
│  ├─ data-normalize/   # crawl + GTFS + KMB/CTB normalization + stop-merging + the dataset
│  │                    #   shard derivations (used by the daily build *and* the Worker)
│  ├─ ui/               # design system: NativeWind preset, tokens, shared components
│  ├─ i18n/             # translations: en, zh-Hant, zh-Hans (all v1)
│  └─ tsconfig/         # shared TS / lint / format config
│
├─ docs/                # this folder — the plan & source of truth
├─ .github/workflows/   # dataset.yml — the daily dataset build. The only workflow so far.
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

### Dependency direction (keep it acyclic)
```
apps/mobile  ─▶ packages/{ui, api-client, core, i18n}
apps/edge    ─▶ packages/{core, data-normalize}
packages/api-client ─▶ packages/core
packages/data-normalize ─▶ packages/core
```
`core` is the shared contract (types + `DataSource`) both the client and the edge depend on,
so the API can never drift from what the app expects.

## Language & quality tools
- **TypeScript** everywhere, `strict: true`, shared base config in `packages/tsconfig`.
- **Biome** (decided) — single fast tool for lint + format; fits the "fast" ethos, minimal config,
  and covers the key React-hooks lint rules. ESLint + Prettier stays as a fallback if we ever need a
  plugin Biome lacks. (See [ADR-012](./08-decision-log.md).)
- **Vitest** for unit tests (core logic, normalization, ETA formatting). `apps/edge` runs its suite
  **inside real workerd** via `@cloudflare/vitest-pool-workers`, so the specs exercise genuine KV/R2
  bindings and `caches.default` rather than doubles — that's what makes the WP0-1 acceptance gate
  (`test/dataset-kv.test.ts`: sweep every endpoint against a seeded build, assert
  `datasetBuildsThisIsolate` stays 0) worth anything. `pnpm test` → `turbo run test`; the edge suite
  alone is `pnpm --filter @nextbus/edge test`. **Playwright** for web e2e; **Maestro** for native
  e2e (later).
- **Not every `test` script is Vitest — some *are* the gate.** `packages/contract`'s `test` runs
  `check-openapi-current.mjs` **and `check-native-guide.mjs`** (see *Publishing for a native repo*
  below), and `packages/i18n`'s runs `check-i18n.mts` (locale parity, the ICU
  subset, and drift of the generated `.strings`/`.stringsdict`/`strings.xml`, plus a `--selftest`
  that watches each of them fail). Both are plain Node under `tsx`, adding no dependency. This is
  deliberate: a generator's drift gate belongs where it will be executed, which is `turbo run test`.
  (This bullet used to say *"there is no PR/push CI workflow in this repo"* — that stopped being true in
  Wave 5. `.github/workflows/ci.yml` runs typecheck · lint · test · `wrangler deploy --dry-run` ·
  `git diff --exit-code` on a clean checkout for every PR; its **deploy job** is the part still inert,
  behind `DEPLOY_ARMED`. The reasoning above is unaffected and the fact was wrong, so the fact is
  corrected rather than the conclusion.) Until Wave 3, `packages/i18n`
  had no `test` script at all and was therefore in no turbo target.
- **Zod** for runtime validation of upstream API responses → fail loudly when an operator
  changes their schema.

### Writing a test or a gate here: what the harnesses require

Everything in this section was established by reading the scripts and by watching them fail, and none of
it was written down before — so a session that needs it re-derives it. It is here rather than in a
handoff note because it is a property of the tooling, not of any one wave.

**The gate chain.** `pnpm test` is `turbo run test && pnpm run boundaries`, and `boundaries` runs, in
order: `boundaries:check` → `boundaries:selftest` → `check:no-adhoc-id-parsing` →
`check:vm-no-styling:selftest` → `check:vm-no-styling` → `check:no-raw-colours` →
`check:view-transport-free:selftest` → `check:view-transport-free` → `check:one-endpoint:selftest` →
`check:one-endpoint` → `check:docs-freshness:selftest`. Several packages' own `test` scripts *are* gates
too (above), and `packages/core`'s runs `check-spec-coverage.mjs` twice — `--selftest` first, then live.

**One gate in that chain runs only its selftest, and that is not an omission.**
`check:docs-freshness` (ADR-078) needs a *commit range*, and there is no canonical one locally — on `main`
`origin/main..HEAD` is empty, and an empty range is a failure by design. So the chain runs the selftest
(whose last control applies the real rule to the last 20 commits of the current branch, and which **fails
on a shallow clone** rather than quietly examining one), while the live range runs in `ci.yml` with the
range computed from the event. Check a branch by hand with `pnpm check:docs-freshness`.

**Every `scripts/check-*.mjs` shares one shape, and a new one should copy it.** A `POLICED` list of
directories, a `PATTERNS` list of `{ id, re, hint }`, an `ALLOWLIST` whose entries name the **one rule**
they exempt, a `--selftest` that runs each pattern against a synthetic fixture *plus at least one
control that must produce no findings*, and a guard that fails when the check matched **no files at all**.
Four properties are load-bearing and each was learned from a gate that had passed while looking at
nothing (the repo has hit that eight times):

- **A stale allowlist entry fails as loudly as a violation.** That is what keeps the list shrinking.
- **An allowlist entry must name its `pattern.id`.** Before Wave 5's review the matcher compared file and
  snippet only, so an entry granted for a URL template exempted a `fetch(` sharing that line.
- **Comments are stripped; string literals are not.** A path or a host inside a string *is* the
  violation, so blanking literals would leave nothing to find — but a gate that flagged its own
  documentation gets switched off within a week, so prose is exempt.
- **`pnpm boundaries`' own `bannedSyntax` half has no comment stripper.** It matches raw source lines, so
  a file in `packages/core` cannot even *spell* `Date.now(` or `Math.random(` in a comment. That is why
  `live.ts` and `policy.ts` describe those forms in circumlocutions.

One gate departs from the shape on purpose. `precommit-docs-check.mjs` (ADR-078) polices **commits**
rather than files, so it has no `POLICED` list, no `PATTERNS` and — deliberately — **no `ALLOWLIST`**: its
escape hatch is `[docs-ok]` in a commit message, which is per commit, permanent, and visible in `git log`
without a second file to rot. It keeps the two properties that matter: controls that must produce no
findings (four of its eight rule scenarios), and a hard failure when it examined nothing.

| Script | Polices | Bans |
|---|---|---|
| `scripts/boundaries/check.mjs` | every layer's `dirs` in `layers.json` | cross-layer imports (via dependency-cruiser + biome), plus each layer's `deniedGlobals` / `bannedSyntax` |
| `check-view-transport-free.mjs` | `apps/mobile/{app,components,lib,providers}/`, `apps/web/src/` — **test files included** | `new WebSocket`, `WebSocket(`, `wss?://`, `fetch(`, `/v1/` |
| `check-one-endpoint-declaration.mjs` | `apps/`, `packages/` — test files excluded | the literal `localhost:8787`; an env read of `*_API_URL` on a line that does not reach `DEFAULT_API_URL` |
| `check-no-raw-colours.mjs` | `apps/mobile/{app,components,lib,providers}/`, `apps/web/src/`, `packages/ui/src/` | hex literals, `rgb(`/`hsl(` with digits |
| `check-no-adhoc-id-parsing.mjs` | the whole repo | `.split(':')`, `.split('+')`, `.split('\|')`, `.startsWith('P:')` |
| `check-spec-coverage.mjs` | `packages/core/{src,spec}` | a `@spec` tag with no corpus group and a corpus group with no tag, **both directions**, plus `REQUIRED_ROWS` |
| `apps/web/scripts/check-no-derivation.mjs` | `apps/web/src/{components,screens}/` only — `adapters/` is exempt | the renderer computing anything the kernel should |
| `precommit-docs-check.mjs` | **commits, not files** — the index in hook mode, each commit in `--range` mode | a commit changing `apps`/`packages`/`scripts` or any `.ts`/`.js` file with no `docs/`, `*.md` or `README` change and no `[docs-ok]` |

**Two layer facts that decide where a test can live.** `layers.json` gives `server` the dirs
`["apps/edge"]` — **including `apps/edge/test/`** — and `use: [contract, kernel, ports, adapters]`, so an
edge test may not import `@nextbus/api-client` (it is not even a dependency of `@nextbus/edge`, so `tsc`
refuses first). By contrast `client`'s dir is `packages/api-client/src` only, so
`packages/api-client/test/**` is the `from` of no rule at all. And a directory absent from `layers.json`
is the `from` of **no** rule — the `view` layer's own comment warns about this, which is why `apps/web`
was listed before it held a file.

**Sharing a fixture across packages** goes through `@nextbus/core`'s export map — `./spec/*` for the
`@spec` corpora, `./fixtures/*` for anything else (ADR-074) — and then **must** be declared as a turbo
`inputs` glob in every package whose `test` reads it (ADR-070), or that suite replays a stale pass when
the fixture changes. `packages/api-client/turbo.json` and `apps/edge/turbo.json` show the shape.

**`apps/edge`'s suite runs in real workerd, and five things will bite.**
1. **`resetEtaCache()` before every round.** `coalesce` holds a pole for 30 s per isolate, so without it
   round two re-reads round one's board and every change assertion reports silence.
2. **`caches.default` is not reset between tests *or* files.** Two cases asking the same URL have the
   second answered from the first, so give each one a distinguishing query parameter (`?case=…`) or an
   odd `radius`. The Worker reads only the parameters it declares, so this changes the cache key alone.
3. **`resetShards()` between rows.** A Durable Object's name is a function of the target set (D4), so two
   cases watching one stop deliberately land on the same object, and the pool resets neither instances
   nor their storage between `it()` blocks.
4. **`runDurableObjectAlarm` ignores the scheduled time** — it fires whatever is armed, immediately. So
   it proves what a round *does*, never *when*; assert cadence by reading the alarm the round installed.
   And the **first** round self-fires, because `subscribe()` pulls the alarm forward to now for a target
   the shard has never polled.
5. **A socket comes off a 101 as `res.webSocket`, and the listener must be attached before
   `ws.accept()`** — the shard sends its snapshot inside the same `fetch` that produced the response.

Two more, cheap to know and expensive to discover: the upstream `fetch` stub must **throw** on an
unrecognised URL (every suite here does, and the one that did not could reach the live internet); and
`/v1/stop/:id` builds its rows from the place's **static** route list, so a stubbed board serving a route
number the dataset does not list at that pole lands on no row — unlike `/v1/etas/:id`, which publishes
whatever the board says.

**`packages/core` holds 100% coverage on statements, branches, functions and lines**, and the threshold
really does catch things: a comparator reached only by sorting two or more elements is invisible to a
corpus of one-element cases, which is how ADR-077's failure ordering came to need a row. Reach for a new
row before reaching for the threshold.

### Dependency overrides
`.npmrc` sets `node-linker=hoisted` (Metro expects a flat, npm-like `node_modules`). One
consequence is that there is only ever **one** copy of a platform binary on disk, so two packages
wanting different versions of the same native tool collide outright. That happened with esbuild:
wrangler pins an exact version, vitest wants a newer one, and whichever lost produced
`Host version does not match binary version`. Root `package.json` therefore carries
`pnpm.overrides.esbuild = "0.27.3"`. Any future clash of this shape belongs in the same place —
don't work around it per package.

## CI/CD (GitHub Actions)
- **`dataset.yml` (the one that exists):** daily at 19:00 UTC (03:00 HKT) plus `workflow_dispatch`.
  Installs, runs `pnpm typecheck` and `pnpm test`, then `pnpm dataset:publish` — build the shards,
  write them all, flip `build:current` last (ADR-055, `docs/03`). Finally — when the `EDGE_URL`
  repo variable is set — it curls the deployed Worker's `/v1/health` and fails the run unless it
  reports `"dataset":"kv"` and `"datasetBuildsThisIsolate":0`. Concurrency group `dataset-publish`,
  never cancelled in progress: two publishes at once would interleave shard writes and race the
  pointer flip. Needs the `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets. **The scheduled
  run is skipped unless the `DATASET_PUBLISH_ARMED` repo variable is `true`** — WP0-5 hasn't created
  the KV namespace yet, and a cron that fails every night is a cron everyone learns to ignore. A
  manual `workflow_dispatch` always runs, and a preflight step names whatever is missing rather than
  letting it surface as a wrangler error mid-publish. Full inventory: `docs/10`.
- **`ci.yml` (the one that gates every PR):** `pnpm typecheck` · `pnpm lint` · `pnpm test` ·
  **docs freshness per commit** (`precommit-docs-check.mjs --range`, ADR-078) · `wrangler deploy
  --dry-run` · `git diff --exit-code`, all on a **clean checkout** with `fetch-depth: 0` — which is
  required rather than convenient, because the docs step needs `<base sha>..HEAD` to resolve and its
  selftest's live control refuses a shallow clone. It is deliberately *not* `turbo run … ` over only the
  affected packages: `origin/main` was merged red once because turbo replayed a cached pass from another
  worktree (ADR-070), which is the whole reason this file runs the root scripts on a fresh clone.
- **Web/PWA deploy (still to build):** `pnpm --filter @nextbus/mobile build:web` → deploy `dist/` to
  **Cloudflare Pages** on merge to `main`. `EXPO_PUBLIC_API_URL` must be the deployed Worker: it is
  baked into the bundle *and* into the service worker's runtime-caching routes.
- **Edge deploy (still to build):** **Wrangler** deploy of `apps/edge` Workers + DOs on merge to
  `main` (preview deployments per PR). No cron trigger — the dataset job replaced it.
- **Native builds:** ~~EAS Build + EAS Submit; EAS Update for OTA~~ — **superseded by
  [ADR-075](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)**
  (2026-08-03). iOS and Android are hand-written in **separate repos** with their own store pipelines,
  consuming this repo's published contract; there is no EAS and no OTA. This monorepo's build surface
  is the Worker plus the web app. See [roadmap](./06-roadmap.md) Phase 3.
- **Env/secrets:** Cloudflare secrets via GitHub OIDC; no keys needed for the *public*
  HK data APIs, which keeps secrets minimal.

## Publishing for a native repo (WP3-3, ADR-067)
`packages/contract/README.md` is the entry point for someone starting an iOS or Android repo: which
artefacts to consume, how to generate models, what they will get wrong if they guess, how to wire the
fixture corpus into XCTest/JUnit, and what is **not** guaranteed. Read it before answering a porter's
question — it is written for them, not as an inventory of this repo.

Three things about how it is maintained, because they are unusual:

- **`openapi.json`'s `info.description` is canonical for wire conventions**, and the README
  *transcludes* it into a generated region rather than restating it. Edit
  `packages/contract/src/openapi.ts` and re-emit; editing the README's copy is a red build. The
  document is canonical because a native repo may only ever receive the document — through a
  generator pipeline or an artefact store — and must still be told the rules.
- **Every figure the README quotes is counted, not written** (endpoint and schema counts, corpus
  totals, token and string counts). `pnpm --filter @nextbus/contract native:emit` refills the
  generated regions; `check-native-guide.mjs` fails on a stale one, **and on any repo path the README
  cites that no longer exists**. That second check exists because ADR-060 carried a wrong corpus
  figure for two waves and nothing could see it.
- **The two conformance templates in `packages/contract/native/` have never been compiled**, and say
  so in a banner, as do WP3-1's `packages/ui/generated/NextBusTokens.swift` and `.kt`. There is no
  Swift or Kotlin toolchain here and no gate that could add one. Do not remove those banners without
  a toolchain that makes them false.

## Versioning & conventions
- **Changesets** for package versioning (internal, mostly).
- **Conventional Commits** + PR template; small, reviewable PRs.
- Branch off `main`; deploy previews per PR.

## Local dev
- `pnpm dev` → runs Expo (web by default) + a local Wrangler dev server for `apps/edge`.
- `pnpm dev:edge` needs **no remote state**: with no KV/R2 bindings the Worker falls back to
  building the index in-request and reports `dataset: "inline"` on `/v1/health` (`docs/03`).
- `pnpm dataset:build` → shards into `apps/edge/.dataset/<hash>/`, nothing published.
  `pnpm dataset:publish` → the same build, uploaded (`--local` writes into the Miniflare state
  `wrangler dev` uses; `--force` republishes when upstream is unchanged). Both root scripts proxy
  to `apps/edge`.
- `pnpm --filter @nextbus/mobile build:web` → the production PWA (`expo export -p web` + Workbox).
