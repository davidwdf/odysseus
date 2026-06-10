# Project Documentation — NextBus HK (working title)

A fast, beautiful, mobile-first app for **Hong Kong bus arrival times**.

This folder is the single source of truth for *what we're building and why*. Read in
order, or jump to what you need:

| # | Doc | What's in it |
|---|-----|--------------|
| 01 | [Vision & Scope](./01-vision-and-scope.md) | What the product is, goals, non-goals, v1 scope, core principles |
| 02 | [Data Sources](./02-data-sources.md) | The HK open-data APIs, their quirks, and our canonical data model |
| 03 | [Architecture](./03-architecture.md) | Cloudflare stack, the phased hybrid data layer, sockets, caching |
| 04 | [Frontend & Design](./04-frontend-and-design.md) | Expo/React Native + Web, PWA-first, animations, design system, the "feel" |
| 05 | [Monorepo & Tooling](./05-monorepo-and-tooling.md) | Repo layout, packages, build tools, CI/CD |
| 06 | [Roadmap](./06-roadmap.md) | Phased delivery plan, milestones |
| 07 | [Backlog](./07-backlog.md) | Additional operators + future features (parked, not forgotten) |
| 08 | [Decision Log](./08-decision-log.md) | Every key decision with rationale (ADR-style) |
| 09 | [Theme & Design System](./09-theme.md) | Tokens, palettes, type scale, livery-theme layering |
| 10 | [Scaffold & Running It](./10-scaffold-and-running.md) | The actual monorepo skeleton + how to install/run/deploy |
| 11 | [Status & Where to Continue](./11-status.md) | **Living handoff** — what's done, what's next (read to resume) |

### Research & proposals (2026-06-09)
- [`research/`](./research/README.md) — deep dive into **all HK bus open data** (by provider + availability matrix), our feature inventory & gaps, competitive analysis, and data-display ideas.
- [`proposals/`](./proposals/README.md) — **fast & fun wins** and bigger bets derived from the research.

## The 60-second summary

- **One codebase, three targets.** Expo (React Native + React Native for Web) ships an
  installable **PWA first**, then iOS/Android apps later **from the same code** — no rewrite.
- **Open data, no API keys.** Every HK bus operator publishes free real-time arrival APIs.
  We normalize them into one canonical model.
- **Cloudflare edge stack.** Compute runs close to Hong Kong and to the upstream APIs, which
  is the biggest latency lever there is.
- **Phased hybrid data layer.** v1 = edge proxy + cache (simple, cheap, fast). v2 = our own
  normalization engine + Durable Objects + WebSockets to *push* updates to watched stops —
  swapped in behind a stable interface so the apps barely change.
- **Honest ETAs.** Arrival times are approximations; we never fake a per-second countdown.
  We update on real data and show freshness.
- **v1 operators:** KMB/LWB + Citybus (covers the large majority of riders). Everything else
  is in the [backlog](./07-backlog.md).
