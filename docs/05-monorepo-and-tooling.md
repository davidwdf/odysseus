# 05 — Monorepo & Tooling

## Manager & orchestrator
- **pnpm workspaces** — fast, disk-efficient, strict dependency resolution.
- **Turborepo** — task graph + caching so `build`/`lint`/`test`/`typecheck` only re-run what changed.

## Repo layout

```
/
├─ apps/
│  ├─ mobile/            # Expo app → iOS, Android, Web/PWA (the single client)
│  ├─ edge/             # Cloudflare Workers project (wrangler): API, sockets/DOs, crawl cron
│  └─ web-landing/      # (backlog) optional static marketing page (Next.js/Astro)
│
├─ packages/
│  ├─ core/             # canonical types + DataSource interface + ETA/units logic (pure TS)
│  ├─ api-client/       # typed client for the edge API + the watch()/socket client
│  ├─ data-normalize/   # crawl + GTFS + KMB/CTB normalization + stop-merging (used by edge cron)
│  ├─ ui/               # design system: NativeWind preset, tokens, shared components
│  ├─ i18n/             # translations: en, zh-Hant, zh-Hans (all v1)
│  └─ tsconfig/         # shared TS / lint / format config
│
├─ docs/                # this folder — the plan & source of truth
├─ .github/workflows/   # CI
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
- **Vitest** for unit tests (core logic, normalization, ETA formatting); **Playwright** for
  web e2e; **Maestro** for native e2e (later).
- **Zod** for runtime validation of upstream API responses → fail loudly when an operator
  changes their schema.

## CI/CD (GitHub Actions)
- **PR checks:** `turbo run typecheck lint test build` (cached, only affected packages).
- **Web/PWA deploy:** build Expo web → deploy to **Cloudflare Pages** on merge to `main`.
- **Edge deploy:** **Wrangler** deploy of `apps/edge` Workers + DOs + cron on merge to `main`
  (preview deployments per PR).
- **Native builds:** **EAS Build** + **EAS Submit** (Phase 3); **EAS Update** for OTA.
- **Env/secrets:** Cloudflare + EAS secrets via GitHub OIDC; no keys needed for the *public*
  HK data APIs, which keeps secrets minimal.

## Versioning & conventions
- **Changesets** for package versioning (internal, mostly).
- **Conventional Commits** + PR template; small, reviewable PRs.
- Branch off `main`; deploy previews per PR.

## Local dev
- `pnpm dev` → runs Expo (web by default) + a local Wrangler dev server for `apps/edge`.
- Seed/cached static dataset committed as a small fixture so the app runs without hitting
  upstream during development.
