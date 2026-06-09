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
  `hkbus/hk-bus-crawling` for prior art (verify licence).

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
  *Automatic* "before X" behaviour requires a **hook** (the harness runs hooks, not the model). So
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
- **Why:** Semantic tokens mean no component hard-codes a colour, so a theme — including each livery —
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
  a favourite toggle) → `/route/[id]` (ordered stops). **Favourites** + a persisted **locale override** are
  added to the existing Zustand store ([ADR-018](#adr-018--two-axis-theme-livery--appearance-with-persistence));
  the Settings language picker drives `LocaleProvider`.
- **Why:** Canonical ids end at the seam — the app never speaks operator-native ids, so a v2 engine can
  swap in unchanged ([ADR-004](#adr-004--phased-hybrid-data-layer-behind-a-datasource-interface)). One
  shared memoized index keeps stop/route/nearby cheap. Favourites reuse the theme persistence pattern, so
  no new storage machinery.
- **Consequences:** Discovered + fixed an etabus quirk — **3 concurrent bulk fetches 403 the odd one out**;
  `fetchKmbStatic` now fetches the small `route` list solo, then the `stop`+`route-stop` pair (≤2 concurrent),
  with a backoff retry, and `getKmbIndex` no longer caches a rejected build. KMB-only (CTB stop crawl is the
  Citybus follow-up). Verified end-to-end in-browser against live data; typecheck 7/7.

## ADR-021 — Citybus (and KMB) static data from the hkbus consolidated dataset
- **Context:** Adding Citybus to nearby/stop/route needs a CTB stop index (coords + route-stops). The
  official CTB ETA API has **no bulk stop or route-stop endpoint** (verified: `/stop` and `/route-stop`
  both 422 without an id/route) — building the index from it means ~6,800 calls (1 route list + ~806
  route-stop + ~6,000 per-stop). That's infeasible at request time *and* can't run in a Worker cron (the
  ~1,000-subrequest cap is why hk-bus-crawling runs as an external GitHub Action).
- **Decision:** Source the static layer for **both KMB and CTB** from the **hkbus/hk-bus-crawling**
  consolidated dataset (`hkbus.github.io/hk-bus-crawling/routeFareList.min.json`, ~8 MB, daily-updated) in a
  **single fetch**, memoized per isolate (`apps/edge/src/static-index.ts`), parsed into a multi-operator
  canonical index (`packages/data-normalize/src/dataset.ts`). Live ETAs still come **direct from the official
  KMB/CTB ETA APIs**. Attribute *Transport Department / KMB / Citybus via DATA.GOV.HK; consolidation via
  hkbus/hk-bus-crawling*.
- **Why this over the alternatives:**
  - *Own CTB API crawl*: same underlying data, but ~6,800 calls + needs an external runner — deferred to a
    backlog item (self-reliance), not a now-need.
  - *Official GTFS*: investigated and rejected as a substitute — GTFS stop-ids ≠ ETA stop-ids (verified: CTB
    ETA id `002403` = GTFS `3044`), so GTFS can't be called against the live ETA API and would still require
    crawling CTB + fuzzy name/coord matching (`matchGtfs.py`). GTFS is a *backbone/merge* aid, not a CTB source.
  - The consolidated set is the same official data, pre-crawled; reuse is intended (gh-pages + published
    `hk-bus-eta` packages); GPL-v2 covers their crawler *code*, not the data output.
- **Key data findings (encoded in `dataset.ts`):**
  - `routeList[*].stops[co]` are the **raw, directly-ETA-callable** operator stop ids (verified
    `/eta/CTB/001027/1` returns route-1 ETAs) — used as-is; canonical id `= <OP>:<rawId>`.
  - `stopMap` is a **broad spatial cluster** for hkbus's own UX and is **wrong for ETA resolution** (the
    clustered id returns no ETAs), so we **ignore it**. Same-kerb KMB↔CTB merge is deferred (backlog) — it
    needs our own coordinate clustering. So a shared kerb currently shows as separate KMB and CTB stops.
  - Names carry only `en` + `zh` (Traditional); we map `zh` → both zh-Hant and **zh-Hans (fallback)**. Live
    ETA text still has all three from the operator APIs. True Simplified static names → backlog.
- **Consequences:** `/v1/nearby`, `/v1/stop`, `/v1/route` are now **multi-operator** (KMB + CTB) off one
  shared index; the edge KMB-only index (`kmb-index.ts`) is replaced by `static-index.ts`. `kmb-static.ts`
  (the official KMB bulk crawl) stays in `data-normalize` for the future own-crawl. Runtime now depends on
  the hkbus gh-pages artifact; backlog adds KV/R2 caching for resilience and an own-crawl for self-reliance.

## ADR-022 — Same-kerb stop-merge: our own conservative landmark+distance clustering
- **Context:** A KMB stop and a CTB stop on the same pavement are two separate canonical stops (distinct
  operator ids, distinct ETA feeds). Pre-merge, nearby showed them as two cards and neither stop-detail
  listed the other operator's routes. ADR-021 established we **can't** use the dataset's `stopMap` for this
  (it over-clusters and its ids don't resolve ETAs), so the merge needs our own clustering.
- **Decision:** Cluster co-located stops from **different** operators into a `Place`
  (`packages/data-normalize/src/dataset.ts` → `buildPlaces`), built once with the index (memoized per
  isolate). A pair merges iff it is **cross-operator**, within **`MERGE_RADIUS_M` = 30 m**, **and** their
  **landmark names match**. Greedy nearest-first pairing with a spatial grid (O(n·k)); each stop joins at
  most one place — preserving the invariant **≤ 1 member per operator** (two same-operator stops that close
  are opposite-direction kerbs and must stay distinct).
- **Why landmark, not full-name, matching:** the operators name the same kerb differently — KMB as
  `LANDMARK (CW112)`, CTB as `Landmark, Road` (e.g. `怡和大廈 (CW112)` vs `怡和大廈, 干諾道中`). Full-string
  equality almost never matches; both *lead* with the shared landmark, so we match on the name head before
  the first `,`/`(` separator, in English **or** Chinese. This is deliberately conservative — verified it
  merges "Jardine House" (KMB+CTB, 10.5 m apart) while **not** merging the genuinely-distinct "Alexandra
  House" (CTB) and "The Landmark" (KMB) that sit only 10.8 m apart. We'd rather under-merge than over-merge.
- **Representation (no new wire type):** a merged place reuses the canonical `Stop` shape — its `sources[]`
  carries every member operator's id (the field was always defined for this). Place id is **self-describing**:
  `P:<memberId>+<memberId>` (members sorted), so the edge resolves members from the id alone — robust for
  Favorites that persist a place id across dataset rebuilds (if a place dissolves, the inner ids still
  resolve as single stops). `/v1/nearby` collapses hits sharing a place; `/v1/stop` and `/v1/etas` resolve a
  `P:` id to both members and fan ETAs out per operator (still direct from the official APIs).
- **App:** `StopCard` already renders a per-ETA operator chip, so a merged card/stop shows mixed KMB(red)+
  CTB(yellow) chips with no component change. The only change is stop-detail's `dedupeRoutes` key, now
  including `operator` so joint-numbered services (e.g. KMB-680X and CTB-680X) stay distinct rows.
- **Consequences:** retires the "shared kerb shows twice" limitation from ADR-021. Tunable knobs
  (`MERGE_RADIUS_M`, landmark matcher) live in one place. Still v1-conservative: stops whose landmark
  strings differ (e.g. KMB stop-code-only names) won't merge — acceptable, and improvable later (token
  overlap, or the own-crawl's first-party coordinates) without changing the seam.

## ADR-023 — ETA lists are de-duplicated once, server-side (canonical API)
- **Context:** A stop is indexed **per direction** (and per operator service-type), but the upstream
  KMB/CTB ETA feed returns **every direction of a route in a single response** (verified: `/eta/{stop}/E42/1`
  returns both bounds; `/eta/{stop}/E42/2` → `[]`). So fetching a stop's routes once-per-ref re-fetches the
  same response and emits each arrival **two+ times, identically** — the "two A41, same time" bug seen on the
  Nearby card. The fix had initially been patched ad-hoc per call site (nearby, then the Favorites card),
  while `/v1/etas` (used by `watch()`/polling) wasn't deduped at all — exactly the inconsistency to avoid.
- **Decision:** De-duplicate **once, at a single server seam.** `dedupeEtas` (one definition, in
  `@nextbus/core/eta`) collapses an `Eta[]` to **one rider line per `operator|routeNo|bound`**, keeping the
  soonest. Every endpoint that returns an `Eta[]` flows through `stopArrivals` (`apps/edge/src/stop-route.ts`),
  which (a) dedupes the **upstream calls** by `(route, serviceType)` and (b) applies `dedupeEtas`, soonest
  first. `/v1/nearby` and `/v1/etas` both use it. **Contract:** any `Eta[]` the API returns is rider-deduped
  and ordered — the frontend trusts it and never re-dedupes.
- **Why server-side, not in the client DataSource:** the edge worker *is* the API; per ADR-004 the v1 client
  is swappable for the v2 socket engine without touching the UI, so canonical data must come from the server,
  not be re-derived in each client. It also avoids shipping duplicate-laden payloads and re-running the
  redundant upstream fetches.
- **Scope note:** `/v1/stop` deliberately still returns the **full route list** (all variants) with each
  route's ETA — that's a navigable list, and its rider-level collapse is the screen's `dedupeRoutes` (keyed
  by `operator|routeNo|bound`). The Favorites card derives an arrivals *summary* from `/v1/stop` and so reuses
  the same shared `dedupeEtas`; a future cleanup is to store the stop name in the Favorites store so that card
  can read the already-canonical `/v1/etas` directly.

## ADR-024 — Stop-card navigation: stop vs. route are distinct tap targets
- **Context:** The Nearby/Favorites `StopCard` was a single tap target → Stop detail, but its rows *look*
  like per-route links, so tapping "A41" surprised users by opening the stop's full (longer) route list.
  Two distinct rider needs: **(1)** open the **stop** (the next bus of each route), and **(2)** open a
  **route** to see its **multiple upcoming arrivals at this stop**.
- **Decision:** In `StopCard`, the **stop name** and **each route row** are **sibling** tap targets (never
  nested — nested interactive elements are invalid HTML on web, which RN-web flagged). Name → `/stop/:id`;
  route row → `/route/:routeId?stop=:stopId`. Stop detail's route rows pass the same `?stop=` context.
- **Route-at-stop view:** `/route/[id]` reads the optional `?stop=` and, when present, shows an **"arrivals
  here"** card — the route's next few arrivals at that stop (live `arrivals[]` via `getEtas(stopId,[routeId])`,
  soonest urgency-coloured) — and **highlights** that stop in the ordered list. A merged place id (`P:a+b`)
  matches either member. Without `?stop=` the screen is just the route + its stops (unchanged).
- **Consequences:** the route row is the shortcut riders expect, and the stop drill-down stays one tap away.
  New i18n `arrivalsHere`. Future polish: a chevron/affordance hint on the stop-name header.

## ADR-025 — Iconography: Lucide via an `<Icon>` primitive on the token system
- **Context:** `docs/09` §8 mandates a single Lucide line-icon set, but v1 shipped none — the favourite
  control was a text "Save" pill and the tab bar was label-only. We needed icons that follow the active
  livery/appearance like the rest of the system, with **no raw hex** (golden rule #4).
- **Decision:** Adopt **`lucide-react-native`** (peer dep **`react-native-svg@15.15.4`**, pinned to the
  Expo SDK per golden rule #6; both render on web through RN-web). All icons go through one primitive,
  **`apps/mobile/components/Icon.tsx`**: `<Icon icon={Star} tone="accent" />`. `tone` is a semantic role
  (`text`/`muted`/`subtle`/`accent`/`accent-contrast`/`positive`/`warning`/`danger`) resolved to an
  `rgb()` via **`useTheme().color()`** — the same `themeColor()` seam the tab bar already uses, so icons
  re-skin with the theme. An explicit `color` override exists for the two value-driven cases (operator
  accent; the nav-resolved tab tint) — used sparingly, like operator accents.
- **Applied:** favourite **star** (`SaveButton`, fills with accent when saved; 44px round, labelled for
  SR), **tab-bar icons** (MapPin/Route/Star/Settings), an optional leading `icon` on `Button`
  (the location-prime CTA gets `LocateFixed`), and a `ChevronRight` affordance on the stop heading.
  Workbench gains an **ICONS** gallery (sample glyphs + every tone).
- **Consequences:** decorative icons stay unlabeled (the wrapping pressable carries the
  `accessibilityLabel`); status icons remain paired with text/colour (never colour-alone, §8). Retires
  the "Save pill" / "label-only tabs" / "favourite control is text" limitations. Bundle cost is modest
  (tree-shaken per-glyph imports). Number-flip / freshness-pulse motion is still the separate motion slice.

## ADR-026 — Nearby is a flat list, not cards; surface distance + walk time
- **Context:** The Nearby home rendered each stop as an elevated `Card`. The boxes-in-a-scroll look fought
  the "**data is the hero, UI gets out of the way**" philosophy (§1): heavy chrome, few stops per screen.
  Separately, `NearbyStop.distanceM` was already returned by `/v1/nearby` but **never shown**.
- **Decision:** Replace `StopCard` with a flat **`StopRow`** (`apps/mobile/components/StopRow.tsx`):
  full-bleed, no surface/shadow, stops separated by a single `border-border` hairline. The heading is
  name (`h3`) + a `MapPin` + "**{distance} · {walk} min walk**" caption + a `ChevronRight`; route rows sit
  beneath. Heading and route rows stay **sibling** tap targets (ADR-024 carries over). Nearby sorts by
  `distanceM` ascending. `distanceM` is **optional** on `StopRow` so **Favorites** reuses the same row
  (distance is meaningless there → the line is hidden); `StopCard` is **deleted**.
- **Distance honesty (ADR-008 applied to geography):** new pure helpers in **`@nextbus/core/geo`** —
  `formatDistance` (metres rounded to the nearest 10, km to one decimal), `walkMinutes`
  (≈80 m/min, floor 1), `formatWalk` (localized "min walk" label, like `formatRelative`). Straight-line
  distance is an estimate, so we round rather than imply precision.
- **Consequences:** lighter, denser, more legible home; the distance we already had is now useful. A
  bolder **"departure board" mode** (one ETA-sorted stream, ideal for the Split-Flap/Dot-Matrix liveries)
  is parked as a follow-up. Loading skeletons updated to flat rows.

## ADR-027 — Floating tab bar; content scrolls underneath
- **Context:** The tab bar was a solid bottom-anchored strip with a top hairline. We wanted a more
  **immersive, layered** feel (a new design principle, §1): navigation that **floats** over the content
  with content **scrolling beneath** it. A first attempt also surfaced a real bug — adding `paddingTop`/
  extra `paddingBottom` to `tabBarStyle` shrinks the **item** area (the bar is a flex column: 28px icon
  block + label), which squeezed the label box to ~5px and clipped descenders.
- **Decision:** Make the bar a **floating pill** — `position: 'absolute'`, side + bottom margins,
  `borderRadius` 24, a **full hairline border** (defines it on dark, where shadows read poorly — §4) plus
  the **`e3` shadow on light**. Because `position:absolute` removes it from layout flow, content now
  scrolls under it; each tab scroll view reserves bottom space so the last item still clears the bar.
- **Geometry in one place:** **`apps/mobile/lib/tabBarLayout.ts`** — `useTabBarLayout()` derives the bar's
  `bottom` offset from the **safe-area inset** (`max(insets.bottom, gap)`, so it clears the home indicator
  and never hugs the edge) and exposes a `contentInset` (`bottom + height + gap`) that Nearby/Favorites/
  Settings apply as scroll `paddingBottom`. The bar and the screens read the **same** source, so they
  can't drift. Label clipping fixed by sizing the bar from item needs (not bar padding) + explicit
  `lineHeight: 16`. **Vertical centring:** React Navigation forces the tab item to
  `justify-content: flex-start`, so any bar height beyond the icon+label stack dumps as a bottom gap and the
  tabs read **top-heavy**. `TAB_BAR_HEIGHT` is therefore set **snug** (54) around the ~42px stack + the
  item's default 5px padding, leaving no slack to mis-distribute — the content centres on its own.
- **Safe area, overall:** top inset is handled per-screen (`paddingTop: insets.top`); the bottom inset is
  now owned by `useTabBarLayout` for tab screens. Verified in mobile-emulation (light + dark): pill floats
  with margins, labels uncl­ipped, content scrolls under and the last row clears the bar at scroll end.
- **Consequences:** new design principle "layered & immersive" (§1). Centred placeholder screens
  (Routes/ComingSoon, the Nearby prime/empty states) need no inset — the bar simply hovers over empty
  space. Detail screens (`/stop`, `/route`) are outside the `(tabs)` group, so they're unaffected.

## ADR-028 — Liquid-glass material + Ink livery
- **Context:** With the floating, scroll-under tab bar (ADR-027), the obvious next step is a **liquid-glass**
  material so the content passing beneath the chrome shows through, blurred — the Apple "Liquid Glass"
  idiom. Separately, `BRAND.ink` (`#111827`) was only an app-icon constant; we wanted an **Ink** colour
  identity that pairs with the glass.
- **Material decision:** a **`GlassView`** primitive (`apps/mobile/components/GlassView.tsx`) on
  **`expo-blur`** (`~56.0.3`, SDK-pinned). Chosen over `expo-glass-effect` (Apple's *true* Liquid Glass)
  as the **base** because the latter is **iOS-26-only**, and we're web-first (PWA) + Android; `expo-blur`'s
  `BlurView` renders on web (CSS `backdrop-filter`), iOS and Android alike. `GlassView` = a clipped rounded
  pane with `BlurView` (tint follows `useTheme` appearance) + a translucent `bg-surface/55` body (so labels
  stay legible) + a hairline rim. Because the body tints toward `--surface`, **each livery colours its own
  glass**. iOS-26 true Liquid Glass is a **drop-in enhancement** behind `isLiquidGlassAvailable()` (same
  API, richer material) — deliberately deferred, not blocked.
- **Applied:** the floating tab bar's `tabBarBackground` is a `GlassView` (the bar surface is transparent;
  the glass *is* the surface). Workbench gains a **GLASS** section (a pane over route chips, so the blur
  is visible).
- **Ink livery:** new `ink` entry in `themes.ts` + `LIVERIES` + i18n `liveryInk`. **Light** = ink-on-paper
  (ink `#111827` *is* the accent on a white page); **dark** = deep ink surfaces (`BRAND.ink` promoted to
  `--surface`) with a cool **indigo** accent (`#818CF8`) that reads against near-black. Status/contrast
  tokens untouched (ADR-015 rule), so honesty + AA hold. The glass tab bar then frosts toward ink.
- **Consequences:** `GlassView` is reusable for future sheets/headers/FAB. Blur has a GPU cost — keep it to
  chrome, not long lists. **Verified in-browser (web):** Ink livery (light + dark) + the tab bar and the
  workbench pane show real backdrop blur of the content behind. Native (iOS/Android) blur + the iOS-26
  liquid-glass upgrade remain to be verified on device.
- **Refraction on web (addendum):** the web glass does **true optical refraction** — the backdrop is *bent*,
  not just blurred. A first attempt generated the displacement map on a **canvas** (per-pixel SDF +
  finite-difference normals); it worked but read **pixelated**, and high-contrast content scrolling under the
  tab bar showed a "white box" artifact at chip edges. Rewrote it as a faithful **port of
  nikdelvin/liquid-glass** (`apps/mobile/lib/liquidGlass.ts`), which is cleaner because the displacement map
  is a **pure vector SVG**, not a raster:
  - **Map** (`getDisplacementMap`): a neutral-grey base (`#808080` = no displacement), then X (red) and Y
    (green) linear gradients screen-blended for the displacement field, then a **blurred neutral
    rounded-rect painted over the centre** — masking the middle back to neutral so only a *soft* `depth`-wide
    rim refracts. Vector gradients + blur ⇒ smooth, no pixelation, no hard edge.
  - **Filter** (`getDisplacementFilter`): embeds that map as a `feImage`, then three `feDisplacementMap`
    passes at `strength + chroma*2 / +chroma / +0`, split per-channel by `feColorMatrix` and recombined with
    `feBlend screen` (chromatic aberration; `chroma=0` ⇒ no fringe). `color-interpolation-filters="sRGB"`.
  - **Application:** the whole filter is a **data-URI SVG** referenced from
    `backdrop-filter: blur(b/2) url('data:…#displace') blur(b) brightness(1.05) saturate(1.4)` (no DOM
    `<filter>` element, so react-native-svg + the per-instance/app-root filter machinery were removed).
    Re-derived from the measured size on `onLayout`, so it always fits the element. **Rim light:** rather
    than the reference's uniform `inset 0 0 4px` glow (which reads as a heavy all-around border, glaring on
    dark), a **thin, top-weighted** highlight (`inset 0 1px 0.5px rgba(255,255,255,top)`) + a faint bottom
    shadow — glass is lit from above, so the bright edge sits on top, not as a centred ring; `top` alpha is
    **theme-aware** (≈0.22 dark / 0.42 light) since a white edge is high-contrast on a dark surface.
  `GlassView` props now mirror the reference: `depth` (rim width), `strength` (bend), `blur` (frosting),
  `chroma`. The **tab bar** uses `strength 45 · depth 8 · blur 5` (frosted + subtle bend — fixes the white
  box); the **lens** uses a wider rim + chroma. **Browser support:** SVG `backdrop-filter` is
  **Chromium-only** — Safari & Firefox fall back to a frosted `blur()`; **native** keeps `expo-blur`.
  Refraction never touches the glass's own children, so labels stay crisp. **Verified in Chrome (Ink, light
  + dark):** bus chips scroll under the tab bar with a clean frosted transition (no white box, no
  pixelation); the workbench lens magnifies the chips behind it. Still the seam for iOS-26 true Liquid Glass.

## ADR-029 — Collapse to a single "Ink" theme (light/dark/auto); retire the livery axis
- **Context:** [ADR-018](#adr-018--two-axis-theme-livery--appearance-with-persistence) shipped a two-axis
  theme — **livery** (Classic/KMB/Citybus/CMB/Dot-Matrix/Split-Flap) × **appearance** (auto/light/dark).
  In practice the liveries were scope/clutter we didn't want yet, and the default dark scheme (a deep-ink
  bg with an **indigo** accent, from the Ink livery in [ADR-028](#adr-028--liquid-glass-material--ink-livery))
  didn't feel right.
- **Decision:** Drop the livery axis **for now**. One theme — **Ink** — in **light / dark**, chosen via the
  **appearance** preference (auto follows the OS). Ink is a **monochrome "ink & paper"** system: the
  `accent` is the *ink* (`#111827`) on light — a near-black mark on a white page — and **inverts to *paper***
  (a soft off-white `#E2E8F0`) on dark. No coloured wayfinding accent in either mode. **Operator** colours
  (RouteChip) and **status** colours (positive/warning/danger) are untouched, so data meaning is unaffected;
  contrast stays AA both ways.
- **Dark redesign:** replaced the old slate-blue dark (`--bg 2 6 23`, blue accent) with a cohesive ink ramp
  — `--bg 13 17 28`, `--surface 22 27 41`, `--surface-2 32 38 54`, `--border 44 51 67`, paper text
  `244 246 250`, and the **paper accent** `226 232 240` (active states read as white-on-ink, mirroring the
  black-on-white of light).
- **Implementation:** `themes` is now `Record<Mode, ThemeVars>` (`{ light, dark }`) — `livery()` helper,
  `LiveryId`, `LIVERIES`, `LiveryMeta`, `DISPLAY_LIVERIES` removed from `@nextbus/ui`. `useTheme` resolves
  `themes[mode]`. `preferences` drops `livery`/`setLivery` (persisted blobs with a stale `livery` key are
  ignored on rehydration). Settings drops the **Theme** section (keeps Language + Appearance); the Workbench
  drops its livery picker. i18n `settingsTheme` + `livery*` keys removed. `global.css` `:root`/`.dark`
  resynced to the Ink palette.
- **Consequences:** supersedes ADR-018's livery axis and the *Ink-livery* part of ADR-028 (the glass
  material + ink-tint option still stand). Re-introducing liveries later is a localized change (restore the
  map + picker). The `BRAND.ink` token and the `bg-ink` glass tint remain.

## ADR-030 — Route view as a vertical schematic line-strip with two-state bus tokens
- **Status:** **Implemented** for KMB/LWB (verified end-to-end in-browser against live data). Built on the
  route-detail slice ([ADR-020](#adr-020--slice-2-stoproute-detail--favorites--canonical-id-reconciliation)).
- **Context:** Idea raised: when viewing a route, render the ordered stops as a **vertical "timeline"**
  (subway-style line strip) with little **bus icons that travel between stops** to show where buses are.
  This is the backlog's *"subway-style line strip"* ([docs/07](./07-backlog.md) → Live map & motion) — and
  is **distinct** from the map view's *"Uber-style moving bus icons"* (geographic, MapLibre, Phase 2). The
  strip is cheaper than a map and usually **more legible for a single line** ("where is it on the line").
  The hazard: animating a bus along the line *on a client clock* would be the spatial twin of the fake
  per-second countdown that [ADR-008](#adr-008--etas-are-approximations-no-client-side-fake-countdown)
  forbids.
- **Options for positioning a bus (we worked down from precise to schematic):**
  - (A) **Interpolated position** = `(S − T)/S` along the segment, where `T` is the live remaining time
    and `S` the segment travel time. `S` from a **trailing-bus probe** (the bus behind still reports ETAs
    at stops the lead bus has passed) or cross-stop ETA deltas; fallback **assume S = 2 min**; else
    midpoint. Rejected as **false precision** — the schematic has no room to show it, and it dragged in
    segment-time estimation, vehicle-identity inference, and schedule/historical data we don't have.
  - (B) **Two-state position (chosen).** A bus is either **at its upcoming stop** (when that arrival is
    **under a minute** — i.e. `isDue`) or at the **midpoint of the segment** between the stop it just left
    and the stop it's approaching. No interpolation, no `S`, no 2-min constant.
- **Decision:**
  1. **Vertical schematic line-strip** as the route-detail presentation — schematic, **not** geographic
     (real metro maps aren't to scale either), so segments are drawn at uniform visual length.
  2. **Drop-off segment detection** locates each bus *reliably without a vehicle id*: a bus that has passed
     stop *N* **disappears from stop *N*'s ETA list**, so walking the ordered stops, the **first** stop
     still showing an arrival is the bus's *upcoming* stop and the one before it is the *stop it just left*.
  3. **Two-state token position** (Option B): at-stop when `isDue` (reuses
     `ETA_DUE_UNDER_SEC = 60` / `etaView().isDue` from `@nextbus/core/eta`), else segment **midpoint**.
  4. **Snap/tween on update only.** A token changes lane (midpoint ↔ stop, or to the next segment) **only
     when fresh data flips `isDue` or the drop-off segment changes** — never on a wall clock. A one-shot
     ease to the new lane is fine; continuous between-poll motion is not.
  5. **MVP is stop-centric** — render a token in the segment leading into each stop that has an imminent
     arrival; **defer per-bus identity** (one token gliding the whole line) as a later enhancement.
- **Why:** Position becomes a **spatial rendering of the real ETA value**, updated on the same trigger as
  the number-flip — honest by construction (there is nothing continuous to fake). Choosing the two-state
  model **deletes the hardest dependencies** (segment-time `S`, trailing-bus probe for positioning, the
  2-min constant, schedule/historical data, vehicle-identity inference). Reusing the `isDue` threshold ties
  the at-stop trigger to the same honesty rule that drives the "Arriving" label, so the strip and the badges
  stay consistent.
- **Data shape (the prerequisite — now built):** `RouteDetail.stops[]` gained a per-stop `eta: Eta | null`
  (`packages/core/src/types.ts`) so a route view has the arrivals it needs in one payload. The worker fills
  it from KMB's **`route-eta/{route}/{serviceType}`** endpoint — **every stop's ETA along the whole route in
  ONE upstream call** (`fetchKmbRouteEta` in `@nextbus/data-normalize`); `/v1/route/:id` dropped from a 1 h
  to an **8 s** cache TTL now that it carries live data. CTB has **no bulk route-eta** ([ADR-021](#adr-021--citybus-and-kmb-static-data-from-the-hkbus-consolidated-dataset)),
  so it stays static-only (null ETAs) until the own-crawl. The position inference lives in a pure
  `inferBusMarkers(soonest[], now)` in `@nextbus/core` (`route-position.ts`).
- **Two route-eta realities** discovered while wiring it: (1) route-eta rows **carry no stop id** — only a
  per-direction `seq` — so the worker maps `seq` → its own ordered stop and stamps the canonical stop id
  back on; (2) the feed lists *just-departed* times, so the screen and the marker inference both use each
  stop's **soonest _upcoming_** arrival (a stale time would mislabel which segment a bus is in).
- **Route-page redesign shipped with it** (the screen is now the strip): the card list is gone; a **fixed
  glass header** carries a floating **liquid-glass lens back button** + the **RouteChip as the title** + the
  origin → destination as subtext (content scrolls underneath, per [ADR-027](#adr-027--floating-tab-bar-content-scrolls-underneath)/[ADR-028](#adr-028--liquid-glass-material--ink-livery));
  each stop shows up to **3 upcoming times**; the **stop sequence number sits in its rail node**; opening
  the route from a stop **auto-scrolls** to that stop. (The header and motion were then reworked — see the
  presentation pass below — so some specifics here were superseded.)
- **Presentation & motion pass** (follow-up polish, shipped): the rail is now animated and the chrome
  refined —
  - **Custom front-view double-decker glyph** (`BusGlyph`, a Lucide-style line icon — Lucide has none): two
    glazed window bands whose gap *is* the deck split (no divider), a **2px stroke** to match the Lucide set,
    over **solid front-view tyre pills** (a deliberate break from Lucide's stroke-only rule — too small to
    outline at 2px; see docs/09 §9). It rides a **stationary** accent disc; only the glyph animates — a gentle
    eased **bob** with a ~4× slower side-to-side **rock** and a small **squash on impact**, all declarative
    reanimated `withTiming`s on an ease-in-out curve (native-driven, **no JS clock**). This idle motion is
    decorative (signals *buses move*, never an ETA — ADR-008); separately, **bus tokens tween along the rail**
    (`withTiming`) when the inferred position changes on real data (the honest on-update ease, never a clock
    crawl).
  - **Gradient "imprecision band"** on the rail (react-native-svg vertical gradient, accent fading out above
    and below the token) communicates that the position is approximate — longer/softer for a bus mid-segment
    (less certain) than one arriving at a stop.
  - **Per-stop times animate** (`EtaTimes`): slots **slide over** when the soonest passes (Reanimated layout
    transition) and a value change does an **odometer slide of only the characters that changed** (common
    prefix/suffix held static — "52 min"→"51 min" slides just the "2"→"1"; "1 min"→"Soon" slides the whole
    thing). Always-visible resting state (animations layered on, never required for legibility).
  - **Names title-cased** for display (`titleCaseName`, minor words like "of"/"the" kept lower-case mid-title)
    with the **operator stop code split out** smaller/muted (`splitStopCode`); names **wrap to two lines**;
    the **sequence number sits in the rail node**, top-aligned to the name.
  - **"Due" wording + colour** softened app-wide via `@nextbus/core/eta`: the sub-minute label is now the
    shorter **"Soon"** (即將) and renders **positive/green**, not danger/red (also in `EtaBadge`, so Nearby /
    Stop detail match). Still no fabricated number under a minute (ADR-008 intact).
  - **Collapsing header** (`RouteHeader`): a **centred** badge over a centred `A → B` line; on scroll the
    badge **shrinks in place** (stays centred) and the gap tightens — it never slides to a corner. The back
    lens is pinned evenly in the top-left corner. `A → B` marquees back and forth (and on tap) if it
    overflows. Rows are variable-height (wrapping), so **node centres are measured** and bus positions +
    auto-scroll derive from those (auto-scroll fires once the first and last rows are measured, so it isn't
    clamped to a still-growing list).
- **Consequences:** No-subsequent-bus / sparse-service degrades naturally — a stop with no imminent arrival
  simply has no token approaching it; nothing is fabricated. The KMB ETA feed has **no vehicle id**, so the
  deferred identity-tracking enhancement would have to *infer* identity by matching arrival timestamps across
  consecutive stops (fuzzy under bunching) — explicitly out of scope for the MVP. Bus tokens are keyed by
  **ordinal** (buses keep order along the line), so most refreshes tween smoothly; a bus entering at the
  origin or leaving at the terminus is a fade, not a glide.

## ADR-033 — Route header: no bar background; title morphs into a pill beside the back lens
- **Status:** **Implemented** (KMB/LWB, verified in-browser). Refines the collapsing header from
  [ADR-030](#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)'s presentation pass.
- **Context:** ADR-030's header was a **full-width glass bar** that the badge + `A → B` line shrank within
  (staying centred). We wanted the chrome to feel lighter and more "floating": no bar fill behind the back
  button and title, with the title **resolving into a pill** on scroll rather than just shrinking in place.
- **Decision:**
  1. **No bar background.** The header container is transparent (`pointerEvents="box-none"`, so content
     scrolls under the empty regions); only the back lens and the collapsed pill carry glass. Drops the
     `bg-bg/80` full-width fill.
  2. **Two end-states across the collapse** (`scrollY` 0 → `COLLAPSE`):
     - **Expanded:** a big **centred badge** (`RouteChip` scaled ~1.45) over a centred, full-width `A → B`.
     - **Collapsed:** a glass **pill to the right of the back lens** (sharing its row/height) holding the
       badge inline with `A → B`.
  3. **The badge is a single morphing element** — it translates + scales from big-centre into the pill
     (scaling is centre-anchored, so translating its centre to each target keeps it put). The **route label
     cross-fades** between an expanded centred-below instance and a collapsed inline instance (expanded fades
     out early, inline fades in late, so they never overlap; the travelling badge bridges the gap). The pill
     glass fades in over the same range. When `A → B` overflows it does a **single** marquee round-trip —
     auto-played once when it first appears, and again on each tap — then **rests at the start** (no continuous
     loop), verified by sampling `translateX` (`0 → −overflow → 0`, then static).
  4. **Frosted glass, not the `lens` magnifier, for chrome over scrolling content.** Because the header now
     has no background, high-contrast stop text scrolls **under** the back lens and pill. The `lens` material
     (chroma + strong displacement, no frost — [ADR-028](#adr-028--liquid-glass-material--ink-livery)) shreds
     that moving text into rainbow chromatic fringing (the same class of artifact ADR-028 fixed on the tab
     bar). So both the back lens and the pill use the **same frosted, zero-chroma** glass as the floating tab
     bar (`strength 45 · depth 8 · blur 5`, tint `bg-surface/60`, bordered) — one shared material across all
     chrome — and their **height = `TAB_BAR_HEIGHT`** (the back lens is a 54 px circle, the pill a 54 px
     lozenge), so the top and bottom chrome read as a set. Content behind is softly frosted; the pill's own
     label stays legible.
- **Why:** Lighter, more immersive chrome (the "layered & immersive" principle, docs/09 §1) consistent with
  the floating tab bar; the morphing badge gives a single continuous focal point while the label hand-off
  stays clean. The frosted material is the only glass that reads correctly over moving content.
- **Fade-opacity must ride on the glass element itself (backdrop-filter isolation):** the pill fades in via
  an animated `opacity`. A first cut animated a **wrapper** `Animated.View` around the `GlassView` — and the
  blur visibly **dropped out mid-scroll, snapping back at rest**. Cause: on web, an ancestor with `opacity < 1`
  forms an isolated compositing group, so the descendant's `backdrop-filter` has no page backdrop to sample
  (blur gone); at `opacity: 1` exactly there's no isolation (blur returns) — hence the flicker tied to scroll.
  Fix: drive the fade opacity on the **same element** that carries the `backdrop-filter`, with no opacity
  ancestor between it and the page. So **`GlassView`'s root is now an `Animated.View`** (props widened to
  `AnimatedProps<ViewProps>`) and `RouteHeader` passes the animated opacity straight into the pill's
  `GlassView style` — verified via DOM that the pill carries its own opacity and has zero opacity-<1
  ancestors, with the blur present across the whole fade.
- **…and the pill is conditionally mounted (backdrop-filter compositing drop):** a *second*, distinct
  Chromium bug remained — after the pill's own opacity cycles **1 → 0 → 1** (scroll to collapsed, back to the
  top, then collapse again) the blur turns **transparent** even though the computed `backdrop-filter` is still
  present, `opacity` is `1`, and there's no isolating ancestor (DOM-confirmed). The compositor silently drops
  the backdrop layer once opacity hits 0 and doesn't rebuild it; a **fresh** element always composites (the
  refresh/autoscroll case worked, a reused element after a cycle didn't). Fix: **mount the pill only while
  collapsed** (`pillMounted`, toggled by a `useAnimatedReaction` on `scrollY > PILL_APPEAR`) so each collapse
  is a brand-new `GlassView` — verified the element count cycles `0→1→0→1` with the filter freshly applied each
  time. The back lens is unaffected (its opacity never changes). *Caveat: the broken state couldn't be
  reproduced in the headless automation harness — the fix is reasoned from the DOM signature + the reported
  fresh-vs-reused behaviour, to be confirmed on-device.*
- **…and switching `GlassView`'s root to `Animated.View` needs a NativeWind interop:** Reanimated's
  `Animated.View` is not NativeWind-aware, so after the root change `className` was **silently dropped** — the
  hairline border vanished and the back lens's icon lost its `items-center justify-center` (it floated to the
  top-left of the now-larger 54 px circle). Fix: register `cssInterop(Animated.View, { className: 'style' })`
  once in `GlassView`, restoring `className` for every caller (the `bordered` border, the back lens, the
  workbench panes). Verified it does **not** disturb Reanimated — the badge morph, marquee, and bus-token
  tweens (all `Animated.View` + animated `style`, no `className`) still run.
- **Consequences:** `RouteHeader` no longer renders a full-width `GlassView`; `expandedHeaderH`/
  `collapsedHeaderH`/`COLLAPSE` exports (consumed by `route/[id].tsx` for the top spacer + auto-scroll) are
  unchanged in shape (`EXP_H` trimmed 150 → 132). `GlassView`'s root is now an `Animated.View` (+ the
  `cssInterop` registration above) — a reusable win: any `GlassView` can be driven by a Reanimated style
  without the isolation trap, and `className` keeps working. Supersedes ADR-030's *centred-shrink-in-place*
  header. Tradeoff of "no background": stop text is faintly visible in the transparent gaps beside the pill
  while scrolling — accepted per the design intent; a subtle top scrim is the fallback if it ever reads as
  cluttered.

## ADR-032 — Favourites are **route-at-stop** pairs, not bare routes
- **Status:** **Proposed / not yet built.** Design settled; implementation is a near-term follow-up (see [docs/11](./11-status.md)).
- **Context:** Favourites today are **stop-only** — `favorites: string[]` of canonical stop ids
  (`apps/mobile/lib/preferences.ts`); `SaveButton` toggles a stop and the Favourites tab lists saved stops.
  Designing the route-detail header raised the question of a favourite **route**, partly for header symmetry
  (a back-lens sits top-left with nothing top-right). Weighing it surfaced a sharper idea the user has found
  genuinely useful in another app: favouriting a **route at a specific stop** — "the 6 from City One Station"
  — so the next arrivals of the line you ride, at the kerb you catch it from, are glanceable.
- **Options:**
  - (A) **Favourite a bare route** (e.g. `KMB:6:outbound:1`). A *navigation bookmark* — tapping it opens the
    schematic. But a route serves dozens of stops in both bounds, so it never answers "when's *my* bus?"; you
    still scroll to find your stop. Its main pull was header symmetry — a weak reason to add an entity.
  - (B) **Favourite a route-at-a-stop pair** (chosen). The atomic unit of a commute — a specific line at a
    specific kerb. On the Favourites tab it renders the **next arrivals directly**, zero navigation. This is
    the "open it every morning" feature.
- **Decision:** Lead with **(B) the route-at-stop pair** as the favourite primitive. **Defer the bare-route
  favourite** — it's only navigation and the pair subsumes the daily use case; it can be added later as a
  second tier if asked. Specifics:
  1. **Store:** a separate list in the Zustand prefs store — don't co-mingle with stop ids (different
     entities, rendered differently). Recommended key shape: a flat **`favoriteRoutes: string[]`** of
     `"${stopId}|${routeId}"` keys (mirrors the existing `favorites: string[]` and the **self-describing-id**
     precedent of [ADR-022](#adr-022--same-kerb-stop-merge-our-own-conservative-landmarkdistance-clustering)'s
     `P:<id>+<id>`, so a key still resolves after a dataset rebuild). A `{ stopId, routeId }` struct array is
     the alternative — confirm at build time. The persisted `favorites` key and `toggleFavorite` symbol stay
     ([ADR-031](#adr-031--british-english-oxford--ize-spelling-for-all-prose--user-facing-strings) — code is exempt).
  2. **The star = the pair, everywhere.** The route screen is always reached **from a stop** (`route/[id].tsx`
     carries the `?stop=` "here" context), so a **top-right glass-lens star** in the route header favourites
     *this route at the stop you came from* — giving the header symmetry **and** the useful primitive with one
     consistent meaning. Mirror it as a **per-route-row star** in Stop detail.
  3. **Favourites tab** groups saved pairs **under their stop heading**, showing just the starred lines and
     their next arrivals — reusing the existing **`StopRow`** (its `etas` array is already filterable, so pass
     only the favourited routes' ETAs). Fetch per pair via `getEtas(stopId, [routeId])` /
     `WatchTarget { stopId, routeIds }` — the seam already models the pair.
- **Why:** The pair is the genuinely useful unit *and* the natural-fit primitive — the `DataSource` already
  exposes it (`getEtas(stopId, routeIds?)`, `WatchTarget`, `StopDetail.routes[]`), so it's not the harder
  option. Favourites stop being a list of places to navigate to and become a **dashboard of the buses you
  actually take**. Symmetry is preserved without letting it drive the data model toward the weaker bare-route
  entity.
- **Consequences:** Store gains a route-at-stop list (+ a toggle); a `SaveRouteButton` (reuse the star) lands
  **top-right in the route header** and **per-row in Stop detail**; the Favourites tab gains a pairs section
  grouped by stop. New i18n keys for the route-save label. Bare-route favourites and cross-device sync of
  favourites remain backlog ([docs/07](./07-backlog.md) — "Accounts + cross-device sync").

## ADR-031 — British English (Oxford `-ize` spelling) for all prose & user-facing strings
- **Context:** Spelling had drifted — the codebase already used British forms (`colour`, `centre`, `grey`,
  `cancelled`, `labelled`) in most comments, but a handful of US spellings had crept into docs and one
  user-facing string (`tabFavorites: 'Favorites'`). We want one consistent, documented standard so it
  stops being a judgement call per edit.
- **Options:** (1) US English (matches some library/CSS keywords); (2) British English with `-ise`
  endings; (3) **British English with Oxford `-ize` endings**.
- **Decision:** **British English, Oxford spelling** for all English prose (docs, comments) and all
  **user-facing strings** (`@nextbus/i18n` `en`). Concretely:
  - **Fix the clear Americanisms:** `colour` (not color), `centre`, `grey`, `favourite`, `behaviour`,
    `honour`, `licence` (noun) / `license` (verb), doubled-l before suffixes (`labelling`, `cancelled`,
    `travelled`), `-yse` (`analyse`, `paralyse`), `catalogue`, `dialogue`.
  - **Keep the `-ize`/`-ization` ending** (`normalize`, `organize`, `optimize`, `realize`, `memoize`):
    this is **Oxford British spelling**, not an Americanism, and it already matches the package name
    **`@nextbus/data-normalize`** and the whole codebase. `-ise` is also acceptable but `-ize` is the
    house default, so terms tied to code stay unchanged.
  - **Code is exempt.** Identifiers, props, CSS/Tailwind keywords (`color`, `text-center`, `bg-gray-*`),
    upstream API field names, package names, and route/file names follow their own ecosystem conventions —
    e.g. the persisted `favorites` store key, `toggleFavorite`, the `app/(tabs)/favorites.tsx` route, and
    the `color` prop on `<Icon>` stay as-is (renaming the store key would orphan persisted data). The UI
    *label* is "Favourites"; the *code symbol* remains `favorites`. That split is intentional.
- **Why:** British English fits a Hong Kong audience and our existing tone; Oxford `-ize` avoids a churny,
  error-prone rename of `normalize`-family terms that are baked into the package name and APIs. Exempting
  code keeps us from breaking keywords, persisted keys, and third-party field names.
- **Consequences:** Recorded the rule in **CLAUDE.md** (golden rule #5, alongside the bilingual rule) so
  every agent applies it by default. Initial sweep updated `docs/02/04/07/08/09/11`, `@nextbus/i18n`
  (`Favourites`), and three prose comments (`SaveButton`, `datasource`, `StopRow`). Chinese strings are
  unaffected.

## ADR-034 — Nearby shows "→ destination" per route; one `StopName` for title-cased names app-wide
- **Status:** **Implemented** (KMB/LWB, verified in-browser).
- **Context:** Two related polish items on Nearby. (1) A nearby `StopRow` route row showed only the
  **route chip + operator remark + ETA** — it never said *where the bus is going*, so "[6] … 3 min" left
  the rider to recall the destination. (2) Stop names were rendered **inconsistently**: the route
  schematic ([ADR-030](#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens))
  title-cased the name and split off the muted operator code (`titleCaseName` + `splitStopCode`), but the
  Nearby/Favourites `StopRow` heading and the Stop-detail header still printed the raw ALL-CAPS upstream
  name (`CITY ONE STATION (ST311)`). We wanted **one** stop-name presentation everywhere.
- **Decision:**
  1. **"→ destination" on every flat ETA row.** The destination belongs to the *route*, but Nearby only
     has `NearbyStop.etas` (`Eta[]`), not the full `Route`. Rather than ship route objects to the client,
     add an **optional `destination?: I18nText` to the canonical `Eta`** and **server-populate it at the
     shared `stopArrivals` seam** (from `index.routeMeta`) — so **both** `Eta[]` endpoints (`/v1/nearby`,
     `/v1/etas`) carry it, and the frontend never re-derives it. Optional because not every path supplies a
     route meta. `StopRow`'s route row now reads `[chip] → {titleCaseName(dest)} … [EtaBadge]`, falling back
     to the operator remark when a feed omits the destination.
  2. **A single `StopName` component** (`apps/mobile/components/StopName.tsx`) is now the only way to render
     a stop name: title-cased label + smaller/muted operator code, with `variant`/`emphasis`/`numberOfLines`
     props. `StopRow` heading and the route schematic row both use it (the schematic's inline copy is
     retired). The **Stop-detail native header** title-cases the label too (`titleCaseName(splitStopCode…)`),
     dropping the code — a native header can't render the two-tone muted code. Stop-detail route rows
     title-case their `→ destination` as well, so destinations read consistently across screens.
- **Why:** Destination is the single most useful disambiguator on a route row (which way is this 6 going?),
  and the `DataSource` already had the data server-side — stamping the `Eta` keeps the UI dumb and consistent
  with ADR-008's "display never re-computes data" stance. Centralising name presentation in `StopName` stops
  the title-case/code-split logic drifting between screens (it had already diverged once).
- **Consequences:** `Eta` gains an optional field (backward-compatible; ignored by paths that don't set it).
  `stopArrivals` does one `routeMeta` lookup per deduped ETA. New shared `StopName` consumed by `StopRow`,
  `route/[id].tsx`, and (label-only) `stop/[id].tsx`; the dev `workbench` `StopRow` inherits the new look for
  free. CJK names pass through `titleCaseName` unchanged.
- **Minor-word handling:** `titleCaseName` keeps a small set of English minor words lower-case mid-title
  (`of`, `the`, `and`, `to`, `at`, `in`, `for`, `by`) so `UNIVERSITY OF HONG KONG` → "University of Hong
  Kong". **`on` is deliberately *not* in that set:** in HK stop names it's almost always the romanised
  syllable 安 (On Tai, Tsz On, Hing On, Lok On Pai…), not the English preposition, so it title-cases like
  any other place-name word. The first word of a title is never treated as minor. `titleCaseName` /
  `splitStopCode` are covered by `apps/mobile/lib/stopName.test.ts` (Vitest — the repo's first first-party
  test; `pnpm --filter @nextbus/mobile test`).

## ADR-035 — Elevation is two channels: opaque (shadow↔lighten) and glass (defocus-led)
- **Status:** **Implemented** (verified in-browser, both modes). Documents shipped behaviour (`ELEVATION` +
  `Card`, `GlassView`) and pins two rules: *no-glass-on-glass* (already practised; now explicit) and a
  *light-only cast shadow on floating glass* — shipped via `GlassView`'s `elevated` prop (web), turned on for
  the route-header back-lens + pill. Light lifts the chrome off the content; dark stays rim+border (no haze).
- **Context:** We have **two** ways a surface reads as "raised", and they resolve the light/dark asymmetry
  differently. The asymmetry: elevation is a lighting metaphor with two cues — a surface **casts a shadow**
  and **catches more light**. On **light** the shadow has a bright field to darken (high contrast) while
  extra lightness has no headroom (already near-white); on **dark** it inverts — a drop shadow has almost no
  contrast budget against a near-black field (reads as muddy haze), while *lightening* the surface has lots
  of headroom. So opaque elevation must **swap its primary cue between themes**, but it wasn't written down
  *why*, and glass (the floating chrome) was being reasoned about as if it obeyed the same rules. It doesn't.
- **Decision:**
  1. **Opaque elevation (`ELEVATION` tokens, applied by `Card`/tab bar):** on **light**, drop shadow
     (`e1–e3`); on **dark**, **`surface`/`surface-2` lightening + a hairline `border`** instead — the border
     restores the *edge/silhouette* cue the shadow used to draw, the lighter surface restores the *lift* cue.
     Two substitutions, not one. (This is the existing `tokens.ts` recipe + the dark branch in `Card`.)
  2. **Glass is a distinct elevation channel, reserved for top-of-stack chrome (≈`e3`)** — the floating tab
     bar, the route-header back-lens + pill. Its primary depth cue is the **blurred/refracted backdrop**
     (depth-of-field: defocus = "behind glass" = a nearer plane), which is **theme-neutral** — it does not
     swap budgets between light and dark. That is *why* glass survives dark mode where opaque shadow fails,
     and why `GlassView` carries **no drop shadow**. On dark, refraction quietens (dark-on-dark has less
     contrast to bend), so glass leans on its **tint floor** (`bg-surface/55–60` over a darker `bg` =
     the dark-mode "raise = lighten" move, for free) and its **rim-light**. The rim-light values already
     encode the per-channel budget: white top highlight strong on light / faint on dark (`0.42`↔`0.12`),
     dark bottom inset shadow faint on light / *stronger* on dark (`0.06`↔`0.16`) — the dark cue regains
     contrast precisely because the tint lightened the body.
  3. **Two rules fall out.** (a) **Never stack glass on glass** — two translucent layers compound blur +
     tint, muddy legibility, and destroy the single clean "near plane"; glass marks *the* top, anything above
     it must be opaque. (b) **A faint cast shadow on floating glass is light-only, never dark** — on light the
     blur + border may under-lift chrome off scrolling content, so a soft cast shadow is permissible; on dark
     it would only add haze, so it stays off. Shipped as `GlassView`'s opt-in **`elevated`** prop: web-only
     (appended to the existing rim-light `boxShadow`, gated on `!isDark`), on the route-header lens + pill.
     The floating tab bar already lifts on light via `ELEVATION.e3` on its container (native-safe; ADR-027).
- **Why:** The reasoning, not just the values, is the asset — the next agent tuning a surface needs to know
  that "shadows read poorly on dark" is a *consequence* of the contrast-budget swap, and that glass opts out
  of that swap by leading with defocus. Writing it down stops glass from being "fixed" with a dark drop
  shadow, and stops opaque dark cards from losing their defining border.
- **Consequences:** No code change required for (1)/(2)/3a — they describe shipped behaviour. 3b's light cast
  shadow joins the backlog alongside the `prefers-reduced-transparency` opaque fallback (docs/09 §"Glass").
  `bg-ink/55` (fixed-dark glass) deliberately **opts out** of the dark lightening cue — fine for a recessive
  pane or the workbench showcase, but not for live floating chrome. See docs/09 §4 + §"Glass legibility".
