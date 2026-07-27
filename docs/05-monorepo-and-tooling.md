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
│  ├─ core/             # canonical types + DataSource interface + ETA/units logic (pure TS)
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
- **Zod** for runtime validation of upstream API responses → fail loudly when an operator
  changes their schema.

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
  pointer flip. Needs the `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets.
- **PR checks (still to build — WP0-5):** `turbo run typecheck lint test build` (cached, only
  affected packages).
- **Web/PWA deploy (still to build):** `pnpm --filter @nextbus/mobile build:web` → deploy `dist/` to
  **Cloudflare Pages** on merge to `main`. `EXPO_PUBLIC_API_URL` must be the deployed Worker: it is
  baked into the bundle *and* into the service worker's runtime-caching routes.
- **Edge deploy (still to build):** **Wrangler** deploy of `apps/edge` Workers + DOs on merge to
  `main` (preview deployments per PR). No cron trigger — the dataset job replaced it.
- **Native builds:** **EAS Build** + **EAS Submit** (Phase 3); **EAS Update** for OTA.
- **Env/secrets:** Cloudflare + EAS secrets via GitHub OIDC; no keys needed for the *public*
  HK data APIs, which keeps secrets minimal.

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
