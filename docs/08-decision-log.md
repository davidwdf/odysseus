# 08 — Decision Log (ADRs)

Every significant decision, the options we weighed, **what we discussed, and why we chose**.
Format per entry: *Context → Options → Decision → Why → Consequences*. Newest decisions get the
next number; we don't delete superseded ones, we mark them `Superseded by ADR-NNN`.

> **When to add/update an ADR:** any time a decision here changes, or a new cross-cutting choice
> is made. The pre-commit docs check (ADR-013) exists to remind us.

---

## ADR-001 — Monorepo with pnpm + Turborepo
- **Context:** Web, native, edge backend, and shared logic should evolve together without drift.
- **Options:** Polyrepo; Nx; pnpm + Turborepo.
- **Decision:** Single monorepo, **pnpm workspaces + Turborepo**.
- **Why:** Shared types/`DataSource` contract live in one place so client and edge can't drift;
  Turborepo caching keeps CI fast; pnpm is lean. Nx was heavier than we need.
- **Consequences:** One repo, one CI; packages depend acyclically on `core`.

## ADR-002 — Expo (RN + RN-for-Web), PWA-first, native later, OTA
- **Context:** User wants responsive web *now*, iOS/Android *under consideration*, lots of
  delightful animation, and to move fast. A concern was raised: with native apps, **users may
  not have the latest version**, which argued for a PWA-first approach.
- **Options:** (A) PWA-only (e.g. Next.js); (B) **Expo** RN + RN-Web, one codebase; (C) fully
  native Swift/Kotlin + separate web.
- **Decision:** **(B) Expo**, and we **ship the installable PWA first**, then enable iOS/Android
  from the *same* codebase later. Use **EAS Update (OTA)** to keep installed apps current.
- **Why (the discussion):**
  - The "users on stale versions" worry is exactly what **OTA updates** solve — JS/asset changes
    land on next launch with no store review. And since we ship the **PWA first**, v1 is
    literally always-latest web. So the concern that pushed toward PWA is *resolved within Expo*,
    not by abandoning native.
  - **Animations:** RN does delightful micro-interactions very well via **Reanimated** (UI-thread
    worklets, 60/120fps, web implementation), **Moti**, **Gesture Handler**, **Skia** (web via
    WASM), **Lottie** — and on native adds **haptics**, which the web can't match. ~95% of motion
    is shared; the last ~5% may need a platform branch.
  - **AI coding reducing native duplication:** discussed and acknowledged — AI does lower the cost
    of parallel native code. But the duplication tax is mostly *not* typing: two runtimes, two
    crash/perf dashboards, two store pipelines, dependency drift, double QA. AI shrinks but
    doesn't erase that, and AI accelerates the single-codebase path too. So one codebase still wins.
  - Pure PWA forever loses iOS push + background location — both valuable for a transit app.
  - SEO was explicitly *not* a concern, removing the main reason to prefer Next.js for web.
- **Consequences:** Expo Router app targets web/iOS/Android. Web ships as PWA in Phase 1; native
  in Phase 3. A small platform-branch budget for the ~5% of motion that differs.

## ADR-003 — Cloudflare stack for hosting & infra
- **Context:** Must be very fast for HK users, cheap, and **support sockets** for pushing live
  updates to watched stops/routes. User also raised running their own normalization + a
  Redis-like fast store.
- **Options:** Cloudflare (Workers/Pages/KV/R2/Durable Objects/D1/Cron); Fly.io (`hkg`) +
  Node/Socket.IO + Redis; Vercel + a 3rd-party realtime service.
- **Decision:** **Cloudflare stack.**
- **Why:** It uniquely gives **edge-close compute** (HK PoP — the biggest latency lever) **and**
  **stateful WebSockets via Durable Objects** without operating servers — matching "fast + cheap
  + sockets." Fly.io is a fine classic alternative (a server you fully control) but is more ops.
  "Where Redis goes": **KV** (cache) + **Durable Objects** (pub/sub + connection state); add
  **Upstash Redis** only if we ever need true Redis semantics.
- **Consequences:** Wrangler-based deploys; learn the DO programming model; secrets minimal
  (public HK APIs need no keys).

## ADR-004 — Phased hybrid data layer behind a `DataSource` interface
- **Context:** "Very little delay to fetch latest times" + wanting sockets. But upstream ETAs are
  **pull-only, ~1-min refresh** — there is no upstream push.
- **Options:** (1) Edge proxy + short cache, client polls; (2) Own normalization engine + Redis +
  WebSocket push; (3) Hybrid/phased.
- **Decision:** **(3) Phased hybrid.** v1 = Option 1 (edge proxy + cache + client-side render of
  cached data). v2 = Option 2 (normalization engine + Durable Objects + WebSocket push) for
  **watched stops & favorites**. Both sit behind one `DataSource.watch()` interface.
- **Why:** Ship fast and cheap first; add real push exactly where it matters, without changing the
  apps. We can never be fresher than upstream's ~1 min, so sockets buy *liveness, battery, and
  server-controlled cadence*, not sub-minute data.
- **Consequences:** `watch()` is a polling shim in v1, a WebSocket subscription in v2.

## ADR-005 — Canonical normalized data model (GTFS-backbone + per-operator crawl)
- **Context:** Operators use incompatible route/stop IDs; "nearby" needs a unified physical-stop view.
- **Decision:** Normalize all data into one canonical model; seed static data from **GTFS** +
  routes/fares, map to each operator's realtime IDs; **merge stops into `Place`s** by proximity +
  name. Normalization runs in the **daily crawl pipeline**, never at request time.
- **Why:** Adding an operator becomes "write an adapter"; merging offline keeps user latency at zero.
- **Consequences:** Stop-merging needs tuning + a manual-override table; reference
  `hkbus/hk-bus-crawling` for prior art (verify license).

## ADR-006 — v1 operators: KMB/LWB + Citybus only
- **Context:** Each operator is extra normalization + edge cases.
- **Decision:** v1 = **KMB/LWB + Citybus**; everything else → [backlog](./07-backlog.md).
- **Why:** Together they cover the large majority of franchised-bus ridership; fastest path to a
  trustworthy MVP. (User explicitly asked to document the rest in the backlog.)
- **Consequences:** NLB, MTR Bus, GMB, LRT tracked in backlog as adapter tasks.

## ADR-007 — "Nearby" computed on-device
- **Context:** Nearby is the hero feature and must feel instant.
- **Decision:** Ship the canonical stop list to the device; compute nearby **locally** (distance /
  geohash). Only hit the network for live ETAs of nearby routes.
- **Why:** Tens of thousands of stops is small enough for on-device query → instant + offline; no
  server round-trip to *find* stops.
- **Consequences:** Static dataset must stay compact and versioned for cheap on-device caching.

## ADR-008 — ETAs are approximations; no client-side fake countdown
- **Context:** User pushback: a per-second client countdown is misleading — a "10 min" wait can
  become "9 min" in 30s or in 3 min depending on traffic. Faking a smooth countdown lies.
- **Decision:** **Do not decrement ETAs on a client timer.** Show the source value (relative
  minutes and/or absolute clock time), update only on **real new data**, show an **"updated Ns
  ago"** freshness chip, flag stale data, use **"Due/Arriving"** under a minute, and animate the
  **change** (number-flip) rather than a clock.
- **Why:** Trust. Honesty about data quality is a core principle.
- **Consequences:** ETA component is driven by data events, not timers; "live feel" comes from
  push (v2) + change animations + freshness UI.

## ADR-009 — NativeWind for the cross-platform design system
- **Context:** Need one design system across RN + Web. Priorities (from discussion): great
  performance **and** something implementable reliably to reduce bugs.
- **Options:** Tamagui; **NativeWind** (Tailwind for RN + Web); Restyle/Dripsy.
- **Decision:** **NativeWind** + **react-native-reusables** (accessible shadcn-style primitives),
  with **Reanimated/Moti/Skia** for motion.
- **Why (the discussion):** Tamagui wins *on paper* — its compiler gives the best raw web perf and
  its sub-theme system is elegant for many themes. But the perf-critical path here (animation) runs
  through Reanimated regardless, so for a lists/text/map app Tamagui's edge is barely perceptible.
  Against that, the team weighted **implementation reliability**: Tailwind is far more reliably
  authored (fewer bugs, faster iteration, simpler build) than Tamagui's larger API + compiler
  config. Livery theming is fully achievable with a CSS-variable token system (see
  [ADR-015](#adr-015--theme--design-system-token-architecture--livery-themes) and [docs/09](./09-theme.md)).
- **Consequences:** Themes are CSS-variable / NativeWind `vars()` token sets, not Tamagui
  sub-themes. If we ever hit a wall NativeWind can't clear, Tamagui remains the documented fallback.

## ADR-010 — Client state: TanStack Query + Zustand
- **Decision:** **TanStack Query** for server state (cache/dedupe/refresh; v2 socket pushes into
  its cache); **Zustand** for light local UI state; **MMKV/IndexedDB** for offline persistence.
- **Why:** Mature, small, work on RN + Web; clean fit with the `DataSource` + `watch()` model.

## ADR-011 — Maps via MapLibre (tentative, Phase 1.5)
- **Decision:** **MapLibre GL** (open-source) for the map view, tiles via MapTiler or self-hosted.
- **Why:** Avoids Google Maps fees/licensing; works RN + Web. Nearby launches as a **list** first;
  map follows.
- **Status:** Tentative — confirm tile provider + cost before committing.

## ADR-012 — Lint/format: Biome
- **Decision:** **Biome** (one fast tool for lint + format). _(User deferred the choice; decided here.)_
- **Why:** Speed fits the project ethos, one tool instead of two, minimal config, and it covers the
  critical React-hooks lint rules (`useExhaustiveDependencies`, `useHookAtTopLevel`).
- **Consequences:** ESLint + Prettier remains a documented fallback if we ever need a plugin Biome
  lacks (e.g. a niche RN/a11y rule); we can add ESLint for just that rule set without dropping Biome.

## ADR-013 — Pre-commit documentation-freshness check (skill + hook)
- **Context:** User wants documentation to stay in sync with the code and to be **automatically
  reminded before commits** if docs may be stale.
- **Discussion:** In Claude Code, a *skill* is invoked on demand — it does **not** auto-trigger.
  *Automatic* "before X" behavior requires a **hook** (the harness runs hooks, not the model). So
  the right design is **both**: a hook that fires the check, and a skill that does the intelligent
  review/update.
- **Decision:**
  1. **Skill** `check-docs` (`.claude/skills/check-docs/`) — reviews the staged diff against
     `docs/` and updates the relevant docs (or concludes none are needed).
  2. **PreToolUse hook** (`.claude/settings.json`, matcher `Bash`) running
     `scripts/precommit-docs-check.mjs` — on a `git commit` with staged code changes but no `docs/`
     changes, it **blocks and reminds** to run `check-docs`. Bypass with `[docs-ok]` in the commit
     message (the skill adds this when no doc change is needed) or `--no-verify`.
- **Why:** Keeps docs honest as the project evolves; the hook guarantees the prompt, the skill
  provides the judgment.
- **Consequences:** A git-native shared hook for non-Claude contributors is in the
  [backlog](./07-backlog.md). If the block becomes noisy, switch the hook to non-blocking (reminder-only).

## ADR-014 — Localize EN / 繁體中文 / 简体中文 from v1
- **Context:** The earlier plan deferred Simplified Chinese to the backlog. User pointed out that
  the upstream bus data already comes with Simplified labels.
- **Discussion:** Confirmed — the operator APIs return `name_en` / `name_tc` (Traditional) /
  `name_sc` (Simplified) for every route, stop, and destination, so localized **data** is free.
  The only added cost is translating our own **UI chrome** strings, which is incremental because
  the i18n system is built from day one regardless. Including Simplified also broadens reach to
  mainland visitors.
- **Decision:** Ship **EN / 繁體中文 / 简体中文** in v1. Traditional Chinese remains the primary HK form.
- **Why:** Near-zero marginal cost for real reach + inclusivity gains; cheaper to include now than
  to retrofit. Supersedes the v1-scope language line in [ADR-006](#adr-006--v1-operators-kmblwb--citybus-only)/[01](./01-vision-and-scope.md).
- **Consequences:** `packages/i18n` ships three UI string files; the canonical model stores all
  three name variants (no optional `zh-Hans`). Additional tourist languages (e.g. 日本語/한국어),
  UI-chrome only, stay in the [backlog](./07-backlog.md).

## ADR-015 — Theme & design system (token architecture + livery themes)
- **Context:** User asked to plan the theme. Needs: light/dark (outdoor day & night), bilingual CJK
  typography, sparing operator accents, the **livery-theme** fun feature, performant + accessible.
- **Decision:** A **3-layer token system** — *primitive* palette → *semantic* tokens (the only thing
  components reference) → *theme* (a set of values for the semantic tokens). Themes are
  **CSS-variable / NativeWind `vars()` sets swapped at runtime**. Type: **Inter** (Latin) +
  **Noto Sans HK / SC** (CJK; system PingFang HK first for speed), with **tabular figures** for ETAs.
  Slate neutrals + status colors + operator accents used sparingly; **Lucide** icons; motion via
  **Reanimated** with a **reduced-motion** downgrade. Full spec: **[docs/09](./09-theme.md)**.
- **Why:** Semantic tokens mean no component hard-codes a color, so a theme — including each livery —
  is just a value swap with **zero component churn**. Tabular figures stop ETA digits from jiggling
  on update, which is what makes the honest number-flip ([ADR-008](#adr-008--etas-are-approximations-no-client-side-fake-countdown)) feel clean.
- **Consequences:** Liveries remap only **accent / surface-tint / display-font** tokens — never
  status or contrast tokens — so legibility and ETA honesty stay constant across every skin.

## ADR-016 — Slice 1: server-side `/v1/nearby` (on-device index deferred)
- **Context:** [ADR-007](#adr-007--nearby-computed-on-device) targets *on-device* nearby. To ship
  Slice 1 quickly and keep the app simple, we compute nearby in the Worker for now.
- **Decision:** `/v1/nearby` runs in the edge Worker — it memoizes the KMB static index (built from
  KMB's bulk `stop` + `route-stop` endpoints) and fetches **bounded** live ETAs (≤ 6 stops × 6
  routes), returning `NearbyStop[]`. **Citybus nearby is a follow-up** (no bulk stop endpoint — needs
  a per-route crawl).
- **Why:** fastest path to a live screen and fewer client round-trips. `DataSource.getNearby` is
  unchanged, so moving to the on-device index later is transparent to the app.
- **Consequences:** not offline yet; the daily-crawl → KV/R2 dataset + on-device nearby (ADR-007)
  remain the target. The per-isolate memo of the index is a stopgap until that dataset store exists.

## ADR-017 — Design-system realization: fonts, `<Text>` scale, elevation, themed nav chrome
- **Context:** [ADR-015](#adr-015--theme--design-system-token-architecture--livery-themes) + [docs/09](./09-theme.md)
  fully *specified* the system, but the running app under-realized it: Inter was never loaded (system-font
  fallback), the named type scale lived only in the doc (components hand-picked raw Tailwind sizes), the
  tab bar used React Navigation defaults, and elevation tokens didn't exist. The aesthetic was documented
  but not visible.
- **Decision:** (1) **Load Inter** as discrete weight cuts via `@expo-google-fonts/inter` + `expo-font`,
  gating the splash on load (`expo-splash-screen`). (2) Add a **`<Text>` typography primitive** (in
  `apps/mobile/components`) driven by a `TYPE_SCALE` token (`packages/ui/src/typography.ts`): `variant`
  carries size + line-height + the correct Inter cut, `tabular` gives fixed-width ETA digits; colour/layout
  stay semantic-token classNames. The scale is also exposed as `text-display/h1/h2/h3/body/label/caption`
  utilities in the preset. (3) Add **elevation tokens** (`ELEVATION` e0–e3, iOS shadow + Android elevation)
  consumed by a `Card` primitive that shadows on light and lifts with `surface-2` + border on dark. (4)
  **Theme the nav chrome**: the tab bar reads resolved tokens via a new `useTheme()` hook + `themeColor()`
  resolver (React Navigation takes colour values, not classes). `packages/ui` stays RN-free (data only);
  RN primitives live in `apps/mobile`.
- **Why:** A type *role* per call site (not ad-hoc `text-2xl`) is what actually enforces consistency;
  one `useTheme()` hook is also the seam where the livery override (docs/09 §7) lands without touching
  layouts. On native, `fontFamily` is single-valued, so mapping weight → exact Inter cut is more reliable
  than weight synthesis; CJK falls back to the OS face (PingFang/Noto) per spec.
- **Consequences:** Inter ships in the bundle (verified via `expo export --platform web`). `expo-font`,
  `expo-splash-screen`, `@expo-google-fonts/inter` added to `apps/mobile`. Liveries are wired but not yet
  user-selectable (now done — [ADR-018](#adr-018--two-axis-theme-livery--appearance-with-persistence));
  bundled Noto CJK fallback + the number-flip/split-flap animation remain polish-slice work.

## ADR-018 — Two-axis theme (livery × appearance) with persistence
- **Context:** [ADR-015](#adr-015--theme--design-system-token-architecture--livery-themes) framed liveries
  as one selectable skin. We want two *independent* user controls: a **livery** (colour identity) and an
  **appearance** (auto/light/dark), and every livery must look right in both light and dark.
- **Decision:** Restructure `themes` to a **livery × mode matrix** (`themes[livery][mode]`) where each of
  the six liveries (Classic / KMB / Citybus / CMB Nostalgia / Dot-Matrix / Split-Flap) ships **both light
  and dark** ThemeVars; liveries still remap only accent / surface-tint / display tokens. Two persisted
  axes live in a **Zustand store** (`apps/mobile/lib/preferences.ts`, [ADR-010](#adr-010--client-state-tanstack-query--zustand))
  backed by **AsyncStorage** (localStorage on web): `livery` + `appearance` (`auto` follows the OS scheme via
  `resolveMode()`). `useTheme()` resolves the pair to the active ThemeVars; the **Settings screen** exposes a
  segmented appearance control + a livery list. The splash is held until the store rehydrates, so there's no
  wrong-theme flash.
- **Why:** Appearance and brand identity are orthogonal — a user may want KMB red *and* dark mode. A matrix
  keeps the "theme = value swap, zero component churn" property (verified live: switching livery/appearance
  re-skins the tab bar, cards, accents, and surface tint instantly). Zustand was already the chosen client-
  state lib; this is its first persisted use and the pattern favorites will reuse.
- **Consequences:** `zustand` + `@react-native-async-storage/async-storage` added to `apps/mobile`. New i18n
  keys (appearance + livery labels) in all three locales. Dot-Matrix/Split-Flap now have light variants
  (daytime / paper-board) in addition to their canonical dark looks. Auto-theme-by-operator (docs/09 §7,
  optional) and the display-livery character treatments remain future work.

## ADR-019 — CJK: use the platform font; do **not** bundle Noto (v1)
- **Context:** [docs/09 §3](./09-theme.md) floated bundling **Noto Sans HK / SC** as a cross-platform CJK
  fallback. We evaluated actually doing it.
- **Decision:** **Ship no bundled CJK webfont in v1.** Latin/UI uses bundled **Inter**; CJK renders in the
  **platform face** (PingFang HK on iOS/macOS, system Noto on Android, JhengHei/YaHei et al. on Windows web).
- **Why:** (1) **Size** — Noto Sans HK is ~7 MB/weight and SC ~10 MB/weight; even 400+700 of both is ~34 MB,
  a serious regression for a fast-first PWA. (2) **Coverage risk** — HK stop names use rare characters
  (e.g. 鰂/茘/氹) that a cheap ~1–2 MB *subset* would drop, while full coverage means the multi-MB download.
  (3) **Low payoff on native** — iOS PingFang is excellent and Android's system CJK *is* Noto; RN's
  single-valued `fontFamily` can't force a bundled CJK face per-glyph in mixed strings anyway. So bundling
  would only affect web cross-browser consistency, at a cost out of proportion to the benefit.
- **Consequences:** Zero CJK font weight in the bundle; full glyph coverage everywhere via the OS. The
  preset's `fontFamily` fallback chain still *names* Noto so a future opt-in (web-only, lazy `unicode-range`,
  or a curated HKSCS subset) is a small change. Revisit only if cross-browser web CJK proves visibly off.

## ADR-020 — Slice 2: Stop/Route detail + Favorites + canonical id reconciliation
- **Context:** Slice 2 needs Stop detail, Route detail and Favorites. The `DataSource` already declared
  `getStop`/`getRoute`/`getEtas` but the worker had no `/v1/stop` or `/v1/route`, and `getEtas` sent a
  **canonical** id (`KMB:<stop>`) to the operator-native `/v1/eta/:co/:stop/:route` route — a dead mismatch
  flagged in [docs/11](./11-status.md).
- **Decision:** (1) **Extend the KMB static index** (`packages/data-normalize`) with `stopById`, route
  metadata (origin/destination from the bulk `route` endpoint) and ordered `routeToStops` (using `seq`).
  (2) **Add worker endpoints** `/v1/stop/:id` → `StopDetail`, `/v1/route/:id` → `RouteDetail`, and a
  canonical `/v1/etas/:id[?routes=]` → `Eta[]`; the index is memoized once and **shared** across nearby /
  stop / route (`apps/edge/src/kmb-index.ts`). (3) **Reconcile `getEtas`** to call `/v1/etas/:id`; the
  lower-level `/v1/eta/:co/:stop/:route` stays for debugging. (4) **App:** tappable `StopCard` →
  `/stop/[id]` (live ETAs via `refetchInterval`, rider-duplicate route variants collapsed by route+bound,
  a favorite toggle) → `/route/[id]` (ordered stops). **Favorites** + a persisted **locale override** are
  added to the existing Zustand store ([ADR-018](#adr-018--two-axis-theme-livery--appearance-with-persistence));
  the Settings language picker drives `LocaleProvider`.
- **Why:** Canonical ids end at the seam — the app never speaks operator-native ids, so a v2 engine can
  swap in unchanged ([ADR-004](#adr-004--phased-hybrid-data-layer-behind-a-datasource-interface)). One
  shared memoized index keeps stop/route/nearby cheap. Favorites reuse the theme persistence pattern, so
  no new storage machinery.
- **Consequences:** Discovered + fixed an etabus quirk — **3 concurrent bulk fetches 403 the odd one out**;
  `fetchKmbStatic` now fetches the small `route` list solo, then the `stop`+`route-stop` pair (≤2 concurrent),
  with a backoff retry, and `getKmbIndex` no longer caches a rejected build. KMB-only (CTB stop crawl is the
  Citybus follow-up). Verified end-to-end in-browser against live data; typecheck 7/7.
