# NextBus HK (working title)

A fast, beautiful, mobile-first app for **Hong Kong bus arrival times** — responsive web/PWA
today, iOS & Android from the same codebase tomorrow.

> **The full plan lives in [`docs/`](./docs/README.md).** Start there.

- **What & why:** [Vision & Scope](./docs/01-vision-and-scope.md)
- **The data:** [Data Sources](./docs/02-data-sources.md)
- **How it's built:** [Architecture](./docs/03-architecture.md) · [Frontend & Design](./docs/04-frontend-and-design.md) · [Monorepo & Tooling](./docs/05-monorepo-and-tooling.md)
- **Where it's going:** [Roadmap](./docs/06-roadmap.md) · [Backlog](./docs/07-backlog.md)
- **Decisions (and why):** [Decision Log](./docs/08-decision-log.md)

## Stack at a glance
- **Client:** Expo (React Native + React Native for Web) → PWA first, native later. NativeWind
  (Tailwind) + react-native-reusables + Reanimated/Moti/Skia. TanStack Query + Zustand.
- **Backend/edge:** Cloudflare Workers / Pages / KV / R2 / Durable Objects / D1 / Cron.
- **Data:** Open, keyless HK Transport Department / KMB / Citybus APIs, normalized into one model.
- **Monorepo:** pnpm + Turborepo.

## Contributing
Documentation in `docs/` is the source of truth and must stay in sync with the code. A
pre-commit check (the `check-docs` skill + a hook — see
[ADR-013](./docs/08-decision-log.md#adr-013--pre-commit-documentation-freshness-check-skill--hook))
reminds you to update docs when you change code.
