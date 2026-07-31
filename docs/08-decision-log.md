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
  `apps/mobile/components`) driven by a `TYPE_SCALE` token (`packages/ui/src/typography.ts` — *since WP3-1
  the values live in `packages/ui/tokens.json` and `TYPE_SCALE` is generated into
  `src/tokens.generated.ts`; this file is deleted. Everything else here still stands*): `variant`
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
- **Status:** **Superseded in part by [ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant)** — the cross-operator *pair-only* merge and the "≤ 1 member per operator"
  invariant are replaced by direction-aware N-member clustering. The landmark matcher and the self-describing
  `P:` id *representation* below are retained.
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
- **Follow-up (2026-06-10):** two interaction tweaks. (1) **Tap the header → scroll to top:** a transparent
  press catcher over the collapsed-chrome band (above the pill/route/badge for hit-testing, below the back
  lens so Back still works) calls `onTitlePress` → `scrollRef.scrollTo({y:0})`. (2) The `A → B` marquee now
  **auto-loops continuously** (scroll to end, pause, return, pause, repeat) instead of one-shot-on-tap, and is
  non-interactive so its taps fall through to the catcher. Also: the back lens is now the shared
  `GlassIconButton`/`BackButton` (ADR-037), not an inline lens.
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
- **Status:** **Framework built; save UI pending.** The store + Favourites tab were migrated to the
  route-at-stop model on 2026-06-10 (stop-only favourites removed — see "Update" below); the per-route
  **star** that creates a pair is the remaining near-term follow-up (see [docs/11](./11-status.md)).
- **Context:** Favourites *were* **stop-only** — `favorites: string[]` of canonical stop ids
  (`apps/mobile/lib/preferences.ts`); a `SaveButton` toggled a stop and the Favourites tab listed saved stops.
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
     the alternative — confirm at build time. *(Built: a flat `favoriteRoutes: string[]` of
     `"${stopId}\|${routeId}"` keys, with `toggleFavoriteRoute(stopId, routeId)` and a `favoriteRouteKey`
     helper. The old `favorites`/`toggleFavorite` stop primitive was removed outright rather than kept for
     migration — stop favourites are not a shipping feature, so there was nothing to preserve.)*
     **Amended by [ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant):** the `stopId` in the key must be the **raw, operator-scoped *member* stop id**
     (e.g. `KMB:ST141`), **never** a `P:` place id. Place ids embed their member list, so direction-aware
     clustering churns them and would orphan favourites; the member id is app-stable and ties the favourite to
     the actual boarding pole. The Favourites tab derives its card grouping from the member's *current* place
     (`placeByStopId`) at render time.
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
- **Update (2026-06-10) — framework landed, save UI deferred:** stop-level favourites were **removed**: the
  `SaveButton` component is gone, the store now holds `favoriteRoutes` (keyed `"${stopId}|${routeId}"`) via
  `toggleFavoriteRoute`, and the Favourites tab now groups saved **pairs** under their stop heading (reusing
  `StopRow` with the `etas` filtered to the starred routes). No save control ships yet, so the list stays
  empty and the tab shows its empty state ("No saved routes yet") until the per-route star is built. In the
  same pass, **Stop detail dropped its `Card`** wrapper for the flat, hairline-divided route-row idiom used on
  Nearby (data-as-hero, [docs/09](./09-theme.md)) — the per-row star will slot into those rows.

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
     title-case their `→ destination` as well, so destinations read consistently across screens. The inline
     code is `verticalAlign:'middle'` so it sits centred within the line rather than on the name's baseline
     (effective on web/PWA; native falls back to baseline until RN supports inline-span vertical alignment).
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
  any other place-name word. The first word of a title is never treated as minor. Conversely an explicit
  `KEEP_UPPER` allowlist (operator/venue acronyms — `MTR`, `KMB`, …, `EKCC`) stays upper-cased: in an
  ALL-CAPS source there's no safe way to auto-distinguish an initialism (`EKCC`) from a real word that can
  also appear parenthesised (`(CIRCULAR)`), so codes are added explicitly as they surface — e.g. `EKCC` in a
  route endpoint's `… (EKCC)`, which the header label title-cases without splitting the code. `titleCaseName` /
  `splitStopCode` were the subject of the repo's first first-party test. Wave 2 (WP2-1) moved these rules
  into `@nextbus/core` (`src/stop-name.ts`) and promoted that test into the language-neutral corpus at
  `packages/core/spec/stop-name.spec.json`, so iOS and Android title-case identically instead of each
  re-deriving the "On" rule from scratch.

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

## ADR-036 — Surface fares, frequency, journey time & ETA remarks from data we already fetch
- **Status:** **Implemented** (verified against the live worker: `/v1/route/KMB:1:outbound:1` →
  `service {fareFull "6.7", journeyMin 45, headway 10–30, hours 05:35–23:40}` + per-stop fares; `/v1/nearby`
  + `/v1/stop` → per-route boarding fare). Proposals [`docs/proposals/00`](../docs/proposals/00-fast-and-fun-wins.md) P1–P3.
- **Context:** The research dive ([`docs/research`](../docs/research/README.md)) found the highest-leverage,
  lowest-cost win is data **we already download and discard**. The consolidated dataset is a *route-**fare**
  list*: its `RouteListEntry` carries `fares`/`faresHoliday` (sectional, HK$), `freq` (GTFS frequency bands),
  and `jt` (journey-time minutes) — but `data-normalize/dataset.ts`'s `RawRoute` parsed only
  `co/route/serviceType/bound/orig/dest/stops`. Separately, the live KMB/CTB ETA feeds' `rmk_*` were parsed
  into `Eta.remark` but **never rendered**. HK open data has **no fares-by-passenger-type, no live GPS, no
  route polylines** ([`docs/research/02`](../docs/research/02-data-availability-matrix.md)), so fares/freq/jt
  are the richest facts cheaply available, and they're the **Static** honesty tier — not live.
- **Decision:**
  1. **Parse the discarded fields.** `RawRoute` gains `fares`/`faresHoliday`/`freq`/`jt`. A new
     `RouteServiceInfo` (`@nextbus/core`) holds `fareFull`/`fareFullHoliday`/`journeyMin`/`headway{min,max}`/
     `hours{start,end}`, computed once at index build (`buildService` + `summarizeFreq`) and hung on
     `IndexRouteMeta.service`; raw sectional `fares` stay on the meta for per-stop lookup (`routeFareAtSeq`).
  2. **Fares are sectional** — `fares[seq-1]` is the **boarding** fare at that stop (the terminus has none);
     `fareFull` (= `fares[0]`) is the from-origin headline. The edge stamps the boarding fare onto each flat
     `Eta` (like `destination`) for Nearby/Favourites, onto each `StopDetail.routes[]`, and per
     `RouteDetail.stops[]`; `Route.service` rides on every route object.
  3. **Frequency/hours are a coarse, honest summary** — `headway` is the min–max minutes across all GTFS
     bands ("every 10–30 min"); `hours` is the earliest start → latest end across service patterns
     ("05:35–23:40"). No fake single figure; past-midnight bands wrap (2535 → 01:35). Day-type/public-holiday
     resolution is deferred (no calendar joined yet) — we show the standard fare and label a differing
     **holiday** full fare; most routes have none.
  4. **Surface remarks** — `Eta.remark` now renders as a small `RemarkTag`; `classifyRemark` tints a
     timetable-based **"Scheduled"** reading as lower-confidence (extends ADR-008). New primitives:
     `Fare`, `RemarkTag`, `RouteMeta` (a fare · journey · frequency · hours strip on route detail). On Stop
     detail, a route with no live ETA shows **"every N–M min"** instead of "—" so a stop never looks dead.
- **Why:** A tier jump in usefulness (fares are the #1 missing rider fact) for almost only UI cost — no new
  data source, no native build, seam untouched (`DataSource` unchanged; new fields are optional). Transit-data
  formatters (`formatFare`/`formatHeadway`/`formatJourney`/`formatServiceHours`) live in `@nextbus/core/eta`
  beside `formatRelative`, the established home for bus-data formatting (the locale only selects a unit word).
- **Consequences:** `RouteMeta` is placed as the **first child** of the route schematic's list so each stop
  row's measured `y` includes its height — the bus-token + auto-scroll math (`topSpacer + tops[i]`) stays
  correct. LWB-tagged ETAs (rare) still resolve no fare/destination (the static index folds LWB under `KMB`
  ids — pre-existing). **Follow-ups:** public-holiday calendar for holiday fares; the **section-fare picker**
  (tap board→alight — proposals P12); a frequency badge on Nearby's no-ETA routes (P2 extension).
- **Refinement (post-feedback):** fares were **too crowded on the single-line per-stop route rows**, so they're
  **dropped from Nearby + Stop-detail** and kept on **Route detail** (header strip + per-stop) — fare is one tap
  deeper (progressive disclosure). The edge still stamps `Eta.fare` (cheap; stays available for `/v1/etas`/future).
  ETA wording: **"Soon" → "Due"** (conventional countdown term, shorter); `EtaBadge` now renders the **minutes
  number prominent with a small, muted, pinned unit** (`etaLabelParts` in core) so only the number shifts as the
  value changes and it collapses to "Due" under a minute — concise without the width-jump. We **did not** adopt
  "m" for minutes: the app already uses "m" for **metres** (walk distance) and "min" for walk time, so "9 m"
  would clash and be internally inconsistent.
- **Refinement (route-detail design pass, post-feedback):** a round of UI feedback reshaped the route-detail
  presentation. Net changes:
  - **`EtaTimes` repeats the unit per slot** — "4 min  20 min  32 min" — *superseding* the earlier
    "unit once on the last value" call (it read as a single number with a trailing label, not three times).
    The emphasised first value + odometer animation are unchanged.
  - **`RouteMeta` is now a wrapping row of pills**, not a `·`-joined line. Full-round per docs/09 §4 (chips/pills
    = `full`); lighter icon (`tone="text"`) + muted value so the chips stay calm. Icons:
    `CreditCard`/`Repeat`/`ClockFading`/`MapPin`. The facts shown are **fare · frequency · hours · stop count**.
  - **Fare is framed high → low** ("$6.7 → $5.8", `formatFareRange`) since the origin fare is dearest and each
    later stage costs less — using the same arrow as the `A → B` route label. New core helpers `fareRange`
    (min/max across the sectional stop fares, keeping the upstream strings) and `formatStopCount` (route length).
  - **Whole-route journey time is hidden** — it's an origin→terminus figure with little relevance to a rider
    boarding mid-route. `formatJourney` + `service.journeyMin` are **kept** (one-line re-add) but not rendered.
  - **Range dashes are spaced** — `formatHeadway`/`formatServiceHours` emit "10 – 25" / "05:35 – 23:40"; the
    unspaced en dash fused with the digits and hurt legibility.
  - **Header spacing:** the expanded badge↔route gap was opened (`ROUTE_EXP_TOP`) and the header height trimmed
    (`EXP_H`) so the meta block's top gap matches its gap to the schematic.
  - **Origin bus token** is suppressed until the bus is ≤2 min from departing — a token permanently parked at
    the start is noise (the origin always reads as a bus "arriving").
  - **Per-stop row alignment:** the operator stop code stays **inline** at the end of the name (its last line),
    so as part of the text it wraps to a new line rather than overlapping the fare when the line is full
    (`min-w-0` on the name column lets it wrap on web, where flex children default to `min-width:auto`). The fare
    is rendered the **same way as the inline code** — a caption-size child with `verticalAlign:'middle'` inside a
    **body-size** line — so both centre against the same 16px line metrics and line up to the pixel; the row is
    top-aligned so that body line sits on the name's **first line**. (A standalone line-height-centred fare sat
    ~1px off the code's x-height middle — the two "middles" reference different things.)
- **Refinement (remark tone, post-feedback):** `RemarkTag` no longer tints the `scheduled` class
  `text-warning` (orange) — **all remark classes now render `text-subtle`**, the same muted tone as
  "KMB Cycle" and other info remarks. The orange read as an alert rather than a confidence cue, and the
  honesty signal is already carried by the operator's own wording ("Scheduled Bus" comes verbatim from
  the upstream `rmk_*` field — we never relabel it). `classifyRemark` is retained (it still distinguishes
  classes for future use), but the colour distinction is dropped.

## ADR-037 — Search: on-device index, a smart route keypad, and extensible filter chips
- **Status:** **Implemented** (verified against the live worker: `/v1/index` → 2002 routes + 8126 stops
  (1179 same-kerb places merged), ~2 MB; keypad/category logic validated against the real route numbers —
  79 night, 93 airport, 137 express; `next-after("")` = digits + valid start letters, `next-after(26)` =
  `0,1,3,4,5,7,8,9,M,X`). Replaces the empty Routes tab with a standalone **Search** page (it's a search
  surface, not a route list — see *Entry point* below) — proposals [`00`](../docs/proposals/00-fast-and-fun-wins.md) P6/P7/P8.
- **Context:** The Routes tab was a placeholder and search was the most glaring missing basic
  ([`research/04`](../docs/research/04-feature-gaps.md)). The static index (every KMB/CTB route + stop) is
  already built and memoized on the edge for Nearby/Stop/Route, so the data exists — we only lacked a way to
  query it. HK route numbers are short alphanumeric codes (`1A`, `N691`, `971P`, `269X`); riders enter them on
  a **keypad that lights only valid next keys** (the App1933/KMB-app idiom), whereas stops/places are prose and
  want a real text field. Filtering (operator, night, airport, express) is a long-standing want
  ([`research/06`](../docs/research/06-feature-improvement-ideas.md)) — but only KMB+CTB are in v1 scope, so a
  hard-coded "hide GMB/MTR" toggle would be dead UI today.
- **Decision:**
  1. **On-device search index (first realization of [ADR-007](#adr-007--nearby-computed-on-device)).** A new edge
     endpoint **`/v1/index`** ships a compact `SearchIndex` (`@nextbus/core/search`): routes **collapsed to one
     `RouteLite` per (operator, number, direction)** — riders search numbers, not service-type variants — and
     stops **pre-merged** so a same-kerb KMB+CTB place (`P:` id) appears once. Built off the shared memoized
     static index (`apps/edge/src/search-index.ts`), long edge TTL (6 h). The app fetches it through the
     `DataSource` seam (`getSearchIndex()`), caches it in AsyncStorage **stale-while-revalidate**
     (`apps/mobile/lib/searchIndex.ts`, `version` = `routes.stops` count tag), so search + keypad work
     instantly and offline. A true content hash for `version` is a follow-up.
  2. **Hybrid entry, one screen.** A **Routes / Stops** segment (each with an icon; no page-title header — the
     segment is the heading). Routes use a **smart keypad** (`RouteKeypad`): a prefix **trie** over every route
     number drives `nextValidChars` — digit keys 1–9/0, plus only the letters this dataset uses
     (`ABCDEFGHKMNPRSTWX`) in a **single horizontally-scrollable row above the pad** (keeps it compact so results
     keep the screen), each **enabled only when appending it still leads to a real route**, dead keys visibly
     dimmed. Stops use a normal `TextInput` (prose needs the OS keyboard), matching
     stop/place names across **all locales** (English or Chinese input both find a stop). All pure search/keypad
     logic lives in `@nextbus/core/search` (`buildRouteTrie`/`nextValidChars`/`searchRoutes`/`searchStops`/
     `routeCategories`) — platform-free + testable.
  3. **Extensible, data-driven filters.** `FilterChips` over two axes that AND together (OR within each):
     **operator** chips are **derived from the operators present in the index** — so GMB/MTR/NLB light up
     automatically the day those adapters land in `dataset.ts`, no UI change; **category** chips (Night `N…`,
     Airport `A/E/NA/S…`, Express `…X…`) are pure predicates on the route number (`routeCategories`). The active
     filter feeds **both** the keypad trie and the result list, so dimmed keys and results always agree. Stops
     tab shows operator chips only (categories are route attributes).
  4. **Recents.** Tapping a result records it in `preferences` (`recentRoutes`/`recentStops`, capped 8, persisted)
     and navigates to the existing `/route/:id` or `/stop/:id`. Recents show when the query is empty.
- **Why:** The keypad is the HK-native, thumb-first way to enter a route and needs the number set on-device for
  instant feedback — so it's the natural lever to start the on-device index (offline + [ADR-007]) rather than a
  per-keystroke server round-trip. Collapsing variants + pre-merging places keeps the payload ~2 MB (gzips
  small) and the results clean. Making operators data-driven means the filter system is built once and scales to
  every future operator without rework — the user's "filter in/out green minibus or MTR" works structurally the
  moment the data is in scope, instead of shipping two dead toggles now.
- **Consequences:** `DataSource` gains `getSearchIndex()` (optional-ish static data; v2 may bundle/push it
  instead of fetching). The index is **server-computed for now** (consistent with ADR-016/021); the eventual
  own-crawl → KV ([roadmap](./06-roadmap.md) step 1) writes the same shape. **Follow-ups:** a content-hash
  `version`; an omnibox that searches route **and** stop in one box ([research/06](../docs/research/06-feature-improvement-ideas.md));
  "routes to <place>" reverse search over origin/destination text; direction toggle on the route a result lands
  on (P11); operator-coloured filter chips. Stop results navigate to a single canonical/place id — a stop that
  isn't part of a merged place still shows only its own operator's routes (pre-existing, ADR-022 conservatism).
- **Entry point — its own page, not a tab (decided & built):** search is **not a bottom tab**. It's a
  standalone screen `app/search.tsx` (outside the `(tabs)` group, so it renders **with no tab bar** — which
  also lets the keypad pad to just the safe-area inset, reclaiming the tab-bar band the keypad was fighting),
  **pushed** from a **floating search button** that **shares the tab bar's row at the far right** (the bar
  fills the space to its left); the button is a **glass lens** — the shared `GlassIconButton`, the same
  material as the route-header back button. Search's header is the **standard back button** (`BackButton`, also
  `GlassIconButton`) to the **left of the Routes/Stops segment**, using the route header's exact corner spacing
  (16px). Tapping a result `push`es the detail screen on top, so **back returns to search with its query
  intact** (native stack behaviour). Chosen over a gesture-draggable bottom sheet: a pushed page gives the same
  space win and a cleaner result→back→search round-trip (a sheet isn't a navigation entry, making that
  round-trip the awkward part). The bottom tabs are now Nearby / Favourites / Settings.
- **Standard floating-chrome button (`GlassIconButton`):** the route-header back lens was extracted into a
  shared `GlassIconButton` (+ a `BackButton` wrapper); the route header, the search launcher, and the search
  back button all use it, so the glass treatment stays identical everywhere.
- **Keypad sizing + the horizontal-scroll rule:** the original full letters **grid** ate the screen; letters
  are now a single **horizontally-scrollable row above** a slightly tighter number pad, and are **filtered to
  the valid next letters** as you type (digits stay a fixed pad, dimmed when invalid). Horizontal rows (the
  letter row, the filter chips) follow a house rule: the scroller runs **edge-to-edge** with a default left
  inset, items overflow under the right edge, and a matching trailing inset appears once scrolled to the end.
- **Stop search field:** same footprint as the route number field; tapping anywhere in it (incl. the icon)
  focuses the input, and the **whole box border** lights as the focus state (the inner web input outline is
  suppressed) — not a separate inner ring.
- **Two-tap-while-focused (react-native-web gotcha):** with the Stops field focused, the *first* tap on an
  outside control (the segment, a filter chip) only **blurred** the input and was lost — RNW terminates the
  press responder on blur, so `onPress` never fires (the second tap then works). Reproduced on desktop, so it's
  not the mobile soft-keyboard. Fixes: the segment switches on **`onPressIn`** (press-down lands before the
  blur cancels it); scroll containers with tappable children carry **`keyboardShouldPersistTaps="handled"`**
  (the results list already did; added to the filter-chips scroller). Result rows sit inside the handled
  results `ScrollView`, so they were already one-tap. Verified in-browser.

## ADR-038 — "About the data" screen: open-data attribution & honesty notes
- **Status:** **Implemented** (proposals [`00`](../docs/proposals/00-fast-and-fun-wins.md) P10; typecheck 7/7,
  Biome clean for the new files).
- **Context:** data.gov.hk content is provided under the Government's open-data terms and **attribution is
  required before launch** ([docs/02 §Licensing](./02-data-sources.md)); until now nothing in the app credited
  the sources. It's also the natural home for the **honesty stance** the app already lives by (ADR-008 fresh-ETA
  promise, ADR-036 static fares/timings tier) — riders deserve a plain-language "where does this come from and
  how fresh is it" page.
- **Options:** (a) inline the attribution as a block at the bottom of **Settings**; (b) **dedicated pushed
  screens** linked from a Settings **About** section; (c) a modal/about-box.
- **Decision:** **(b)** — a new **About** section in Settings with two rows pushing two no-tab-bar screens
  (the shared **`BackButton`** glass lens, like `app/search.tsx`):
  1. **`app/about-data.tsx`** — attribution. **Full-width rows, no cards and no dividers** — rows are separated
     by whitespace (a soft press-highlight gives the tap affordance). A **Sources** group of **tappable link
     rows** — **DATA.GOV.HK** (the
     open-data portal), **KMB / LWB**, **Citybus** — each opening the source in a **new tab** (`openExternal`:
     `window.open(_blank, noopener)` on web, `Linking.openURL` on native) with a trailing **external-link icon**;
     a **Licence** link row to the **locale-aware data.gov.hk Terms and Conditions of Use**; and the app
     **version** (`expo-constants`).
  2. **`app/faq.tsx`** — an **accordion**, **collapsed by default** (so the page is a tidy list of questions,
     no dividers; tap a row to expand its answer, chevron flips, `LayoutAnimation` on native / no-op on web).
     Data-driven from an `ITEMS` array of i18n key pairs. It **owns the honesty/freshness notes** and a broader
     set of rider questions: freshness (~1-min ceiling + stale-greying), fares/timings being scheduled-not-live,
     **operator coverage** (KMB/LWB/CTB now; others planned), **why some stops list two companies** (same-kerb
     merge, ADR-022), **offline** (search works offline, live ETAs don't), **why there's no live bus map** (HK
     open data has no live GPS/polylines), and **what "Scheduled"/"Last bus" remarks mean** (ADR-036).
  All strings live in `@nextbus/i18n` across en/zh-Hant/zh-Hans.
- **Why:** The attribution + licence text is multi-paragraph; inlining it in Settings would clutter the clean
  option rows. **Full-width rows over cards** keep the long-form pages calm and let link rows read as a single
  tappable target. **Links over prose** for the sources — each row is a real portal, so make it openable (new
  tab so the PWA isn't navigated away). **Freshness → FAQ:** it's a "why" question, not an attribution fact, so
  it belongs in a growable FAQ rather than padding the credits page. A row→screen is the platform-standard
  "About" idiom and a stable place to grow (terms, privacy, credits, more FAQ) without touching the seam or any
  data path — it's pure chrome.
- **Consequences:** Settings gains an **About** section with **About the data** + **FAQ**; two new top-level
  routes `/about-data` and `/faq`; a small `lib/openExternal.ts` helper (reusable for any future outbound link).
  Fulfils the launch-blocking attribution requirement. **Follow-ups:** a real `app.json` version (currently
  `0.0.0`); an acknowledgements/credits line if we reuse hk-bus-crawling mappings (ADR-021, licence-permitting);
  more FAQ entries (coverage, offline, $2-scheme); a privacy note when one exists.

## ADR-039 — One back button everywhere: the floating glass `BackButton`
- **Status:** **Implemented** (typecheck 7/7; Biome clean for the touched files).
- **Context:** the glass back lens was the route header's signature control and was extracted into the shared
  `BackButton` (`GlassIconButton`) for reuse (ADR-037). In practice the screens had **drifted**: `app/faq.tsx`
  and `app/about-data.tsx` shipped a **bare `ChevronLeft` in a plain `Pressable`** (despite ADR-038 saying they
  used the shared lens), and **`app/stop/[id].tsx` used the platform's native `Stack.Screen` header** with the
  OS back arrow — three different back affordances against one design.
- **Decision:** the **floating glass `BackButton`** (the route-header lens) is the **only** back control across
  the app. Concretely:
  - `app/faq.tsx` + `app/about-data.tsx`: bare-icon pressable → shared `BackButton`, with the header row
    re-spaced to the reference (`flex-row items-center gap-3 px-4 pb-1 pt-4`, matching `app/search.tsx`).
  - `app/stop/[id].tsx`: native header **removed** (`headerShown: false`) and replaced by custom chrome — the
    glass `BackButton`, the two-tone `StopName` (ADR-034) as the title, and the trailing `SaveButton` (the
    favourite toggle that used to live in `headerRight`). Top inset now comes from `useSafeAreaInsets`.
- **Why:** consistency — a rider should meet the same back control on every screen, and the glass lens reads on
  any scrolling content beneath it (the reason it exists). Dropping the lone native header also removes the
  platform-header styling fork (`headerTintColor`/`headerTitleStyle`) and lets the stop title render the muted
  two-tone code the native title bar couldn't.
- **Consequences:** route detail keeps its bespoke **collapsing** `RouteHeader` (same lens, animated) — the
  standard is the *button*, not a single header layout. `app/workbench.tsx` keeps its hand-built glass replica
  (it's a `pointerEvents="none"` design-demo of the header chrome, not a live control). No data-path or seam
  changes — pure chrome.

## ADR-040 — Don't scrape App1933 for live electric / occupancy; curate or crowd-source instead
- **Status:** **Ruled out** (decision only; no code). Scopes [`docs/proposals/00`](../docs/proposals/00-fast-and-fun-wins.md) P15.
- **Context:** App1933 (KMB's own app) shows two live, per-departure signals our open data lacks: a **green-leaf
  electric-bus indicator** (the vehicle rostered to that trip is a battery-electric bus) and a **seat-occupancy /
  remaining-upper-deck-seats** display (a **SmarTone × KMB** deployment, announced **6 Sep 2023**, IoT door/upper-deck
  sensors → 5G → cloud ML, across **2,300+ buses**). The question was raised: should we **scrape** these to surface
  them ourselves? Re-verified the data landscape (June 2026): the public keyless ETA API still returns **times only** —
  `co, route, dir, service_type, seq, dest_*, eta_seq, eta, rmk_*, data_timestamp` — **no vehicle id, model, emission
  flag, or occupancy**, and there is **still no HK GTFS-Realtime / `VehiclePositions` feed**. Both signals exist only
  inside KMB's private app backend, off internal vehicle-roster + sensor data ([docs/02 §7–9, §11](./02-data-sources.md)).
- **Options:** (a) **reverse-engineer App1933's private backend** and re-serve its green-leaf / occupancy live;
  (b) **don't** — keep electric as a **hand-curated, dated route-level tag** (P15) and treat occupancy as **absent /
  crowd-source-only**; (c) wait for an official feed.
- **Decision:** **(b).** We will **not** scrape App1933's live signals. P15 ships only the **curated, clearly-dated
  "🌱 often electric" route tag** (Info honesty tier) + the static accessibility/$2-scheme notes; **occupancy is
  out-of-scope** as data (a future crowd-sourced "how full is it?" is the only honest path — [docs/06](./06-roadmap.md)).
  The legitimate, separate scrape — the **fan-wiki fleet data** behind the curated electric table (CC-BY-SA, attribute) —
  is unaffected and remains P15's source.
- **Why:** Four reasons compound against the live scrape, for a ⭐⭐ feature: **(1) ToS/licence** — the app backend is
  *not* open-licensed (unlike everything else we use, which is data.gov.hk open data), so pulling and re-publishing it
  is against KMB's terms; **(2) fragility** — private endpoints have no versioning/SLA and sit behind auth signing +
  TLS cert-pinning, so it's a permanent reverse-engineering treadmill; **(3) honesty (ADR-008)** — occupancy is a
  sensor-derived *estimate* and the leaf is a per-trip roster value we can't validate or refresh reliably, so re-serving
  it would fake a confidence we don't have; **(4) effort vs. payoff** — high, ongoing cost for a low-impact tag. The
  curated route tag delivers most of the delight (eco + bus-fan appeal) at near-zero risk.
- **Consequences:** P15 stays "best-effort, clearly-labelled Info tier", never live. We won't promise a live electric
  indicator or any occupancy figure — these are documented as "things KMB's app does that open data can't", to omit
  honestly. Revisit only if an **official** open feed exposes vehicle/emission/occupancy (none as of June 2026).

## ADR-041 — Stop detail: a collapsing header (shared with Route), a keyless static mini-map, and an enriched summary
- **Status:** **Built & in-app** (2026-06-10). Refines the Stop-detail screen (`apps/mobile/app/stop/[id].tsx`).
- **Context:** Stop detail was a back-lens + stop name over a flat route list (the just-landed no-card list). Three
  asks: (1) show **where the stop is** (we already carry `Stop.location` — the edge populates it); (2) bring the
  **route-header aesthetic + transition** ([ADR-033](#adr-033--route-header-no-bar-background-title-morphs-into-a-pill-beside-the-back-lens)) here so the two detail screens feel like one family; (3) **enrich** the page with the
  other facts we already hold.
- **Decisions:**
  1. **Shared `CollapsingHeader`.** ADR-033's route header was generalised into one `CollapsingHeader` component
     (badge morph + glass pill + marquee label + tap-to-top + back lens), parametrised by a `badge` node, a `label`
     string, label size/colour, and expanded height. **`RouteHeader`** (badge = route chip, label = `A → B`) and the
     new **`StopHeader`** (badge = a **`MapPin` glyph**, label = the stop name in `--text`) are now thin wrappers — same
     motion + frosted-not-lens glass, so Stop and Route collapse identically. The screen uses an `Animated.ScrollView`
     with a `scrollY` shared value and a top spacer of `expandedHeaderH(insetTop)`, mirroring the route screen.
  2. **Keyless static mini-map (`MiniMap`).** A small **non-interactive** map of the kerb, built **without a map
     library or API key**: we compute the Web-Mercator tile coords for the centre and lay raster tiles as plain
     `<Image>`s in a clipped viewport with a centre pin; tapping it hands off to the platform maps app
     (`openInMaps` → Apple Maps / `geo:` / Google Maps web — also keyless). Tiles are the **standard OpenStreetMap**
     raster set; **dark mode is derived from the same light tiles with a CSS-style `filter`** (`invert` + `hueRotate`
     180° + brightness/contrast trim) applied to a tiles-only layer — so the map keeps the familiar OSM look in both
     modes from one source. The filter shape is **platform-split**: react-native-web (0.21) has no `filter` handler so
     it needs the **CSS string** form (it passes strings straight to the DOM; the RN **array** form became an unusable
     object and silently no-op'd — that was the "filter not applying" bug); native RN takes the array. (We tried second
     dark tile sources —
     CARTO `dark_all` read too near-black, Esri's gray canvas dropped the OSM look — the filter on the preferred OSM
     tiles won.) The centre **pin uses a white halo behind a vivid fill** so it reads on any tile in either mode (a
     single themed pin washed out — `accent` is near-white in dark). Attribution ("© OpenStreetMap") is shown.
  3. **Enriched summary.** A one-line meta strip under the map — **"Served by {operators} · N routes · {distance} ·
     {walk}"** (distance/walk only when a location fix already exists; we **don't** prompt on this screen). Route rows
     gained the **boarding fare** ([ADR-036](#adr-036--surface-fares-frequency-journey-time--eta-remarks-from-data-we-already-fetch)) beneath the destination.
- **Why:** (1) one header implementation kills drift between the two screens and is the obvious home for the future
  route-at-stop star ([ADR-032](#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes)); (2) the `<Image>`-tile
  approach is genuinely trivial, dependency-free, and works on web **and** native today — it ships the map now without
  pre-empting the bigger interactive **MapLibre** map (roadmap) or its tile-source decision; (3) the enrichment is all
  data we already fetch (`Stop.sources`/route operators, `StopDetail.routes`, sectional fares) — no new calls.
- **Honesty / caveats (ADR-008):** the OSM public tile server is a **dev/keyless choice** — its tile-usage policy
  discourages heavy embedding, so a production/native build should repoint `MiniMap`'s `TILE_URL` at our **own tiles**
  (the own-crawl → R2 roadmap step) or a proper provider; `MiniMap` is the seam for that swap. Distance is
  straight-line (already rounded, never fake-precise).
- **Consequences:** New components `CollapsingHeader`, `StopHeader`, `MiniMap`; `RouteHeader` reduced to a wrapper
  (route screen unchanged). New `haversineMeters` in `@nextbus/core`, `openInMaps` in `lib/openExternal`, and i18n keys
  `servedBy` / `routesLabel` / `openInMaps`. The interactive map + dark tiles + the route-at-stop star remain
  follow-ups; this screen is explicitly a **first pass to iterate on**.

## ADR-042 — Direction-aware same-kerb clustering (N-member places); supersedes ADR-022's pair-merge + invariant
- **Status:** **Amended by [ADR-071](#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)
  (2026-07-31)** — a cluster's poles are now folded onto **boarding points**: where upstream published one
  physical pole under two stop ids, the cluster keeps **one member** and lists the other in its `aliasIds`.
  Members are no longer the same thing as clustered poles, though every clustered pole still resolves.
  **Built & verified — backend + place UI (2026-06-11), member-keyed favourites (2026-06-15).** Shipped:
  the quick-win direction gate, the full **N-member single-linkage clustering** (`buildPlaces`) with cluster-level
  vetoes + bearing-spread cap and same-operator members, the **per-place ETA fetch** (KMB `stop-eta` = 1 call/pole,
  CTB per-route to a budget, cross-member dedupe) with an honest `routeCount`, and the **mobile UI**: Nearby cards
  show the soonest few + "+N more" (true count, never a silent filter); a **Place detail** screen (renamed concept)
  groups routes under their pole, with a multi-pin `MiniMap`, a walk *range*, and route→stop→place navigation (`?pole`
  anchor). Name is chosen once in `buildPlaces`. Verified vs the snapshot + live APIs (Belair → 2 kerb-split places of
  5/4 poles; the four false merges stay split; ≈2,010 clusters / 5,461 stops). **Member-keyed favourites (2026-06-15,
  browser-verified):** all favourite keys are the **member pole id** (`favoriteRouteKey(memberStopId, routeId)`, never
  the churning `P:` place id). **Favouriting UI is a glass bottom sheet** (`components/BottomSheet.tsx` + `SheetAction`):
  tapping a stop on the **route schematic** opens it — a GlassView panel with a **draggable handle** (`Gesture.Pan`:
  drag down / fling to dismiss; drag up rubber-bands and springs back) and a **controlled slide-out** on every dismiss
  (scrim tap + drag, via a render-prop `close()`). Its header spells out *what* you'd save (route chip · → destination ·
  stop); the actions are **Favourite / Remove favourite** (this route at the tapped pole) + **View stop**. *(A glass
  save-star in the route header was prototyped then dropped — it didn't feel right; `CollapsingHeader` has no action slot.)* **Place detail** keeps a per-row `SaveStar` purely as a **saved-state
  indicator** (`hideWhenEmpty` — only a saved route shows a filled star; favouriting itself is the sheet). On the
  **route schematic** a favourited stop keeps its ordinary numbered rail node and gets a **small accent star badge**
  pinned to the node's top-right corner (`saved` prop on `RouteStopRow`; star on a surface disc so it reads as a sticker
  over the rail). *(An earlier build turned the whole node into a star that filled accent and swallowed the bus token's
  disc when a bus dwelt there; the bus-dwell choreography was overengineered for a rare transient state and was dropped
  in favour of the badge — saved stops now scan as ordinary sequence nodes, just flagged, and a passing bus rides over
  the badge like any other node.)* The
  **Favourites tab groups by place**: each saved pole resolves via `getStop` (the server promotes a member id to its
  place), keyed by the returned place id, so a multi-pole place shows once with its starred routes from every pole.
  Study + re-runnable scripts: `.context/stop-merge-study/`.
- **Context:** [ADR-022](#adr-022--same-kerb-stop-merge-our-own-conservative-landmarkdistance-clustering) merges only
  **cross-operator pairs** (one KMB + one CTB) within 30 m with a matching landmark name. Two limits surfaced in use:
  (1) **under-merge** — the Nearby list still shows several cards for what is really one or two physical kerbs
  (the user's Belair Garden example: **9 ingested stops** — ST141/142/143/511/512/513/514 + two CTB poles — render as
  6 cards, and the 6-card cap silently drops ST514); and (2) **a real false-merge bug** — the pair rule has no notion
  of *direction*, so it fuses opposite kerbs that share a landmark name. Auditing the shipped merge with a direction
  signal flagged **118 of 1,179 live merged pairs** as direction-divergent; sampling confirmed **≥4 genuine live false
  merges** (Causeway Centre, Ko Po Tsuen, HK Heritage Museum, Yuk Ming Court — one fuses the **same N691 route in
  opposite directions** onto one card). The fix needs a direction signal and N-member (not just pair) clustering.
- **The signal — mean travel bearing:** for each stop, the **direction buses actually move through it**, computed as
  the circular mean of each route's *previous→next* stop chord bearing along its sequence (the data is already in hand
  — `fetchConsolidatedIndex` already walks every route's stop sequence). Covers **9,304 of 9,305 stops** and separates
  kerbs cleanly (Belair: NE poles ~47–60° vs SW poles ~218–233°).
- **Options:**
  - (A) **Keep the conservative pair merge** — correct-but-incomplete; leaves both the under-merge and the live
    false merges in place.
  - (B) **Geometry-only N-member clustering** (distance + name, drop the per-operator cap) — collapses the cards but
    *worsens* the false-merge bug: with no direction gate it freely fuses opposite kerbs.
  - (C) **Direction-aware N-member clustering** (chosen) — distance + name **+ bearing gate + topology vetoes**.
- **Decision:** Cluster stops (KMB **and** CTB, same-operator members now allowed) by **single-linkage** where every
  linking edge satisfies **all** of: **≤ 30 m**, **landmark name match** (ADR-022's matcher, unchanged), **mean
  bearing within 45°**, and **two hard vetoes** — (1) the two stops are **never consecutive on any route**, and
  (2) **no single route+bound serves both** (kills circular/loop self-merges). Two corrections the verification forced:
  - **Cluster-level veto enforcement + a bearing-spread cap (~60°).** The one bad cluster in 30 sampled (East Point
    City) came from single-linkage *chaining* two stops whose **direct** edge the vetoes had rejected — so the vetoes
    must hold for **every pair in the final cluster**, not just each linking edge, and a cluster's total bearing spread
    is capped.
  - **Production bearing must be per-route with terminus handling.** Of 12 sampled live-merge suspects, 8 were
    **bearing artifacts** — terminus loops and right-turns where the single mean bearing is unreliable. The
    **decisive positive signal** for "same physical pole" is **a jointly-run KMB+CTB route listing both stop ids at the
    same sequence position**; use it to confirm cross-operator merges and to override a noisy bearing.
- **Identity & favourites — persist the member, never the place id:** the place id stays **self-describing**
  (`P:<memberId>+<memberId>...`, members sorted) and is used for **transient** request-time work only (Nearby grouping,
  ETA fan-out, `resolveMembers`). It is the **wrong persistence key**: it embeds the member list, so re-tuning the
  clustering churns the string and silently orphans anything stored under it. Therefore **favourites and recents key on
  the raw, operator-scoped *member* stop id** (e.g. `KMB:ST141`), with the route id (`"${memberStopId}|${routeId}"`).
  A route departs from exactly one member pole and the route id carries its operator, so the key is unambiguous **and
  more correct** post-clustering (a multi-pole cluster spreads routes across poles; the favourite pins to the actual
  boarding pole). **Display grouping is derived at render time** via `placeByStopId.get(memberId)` — merges/splits
  re-group the card without touching stored data. This **amends [ADR-032](#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes) point 1** (which had floated the
  place id as a possible key on the self-describing precedent) and removes the migration risk it noted.
- **Name once, in `buildPlaces`:** today three code paths pick a place's display name (Nearby names a card after the
  *closest* member — `nearby.ts`), so the same place can read differently per screen. Choose the name **once** when the
  place is built and carry it on the place. **Start by picking the richest member name** (fullest en+zh landmark head);
  iterate if it disappoints.
- **Query strategy & honest counts (settled 2026-06-11):** the upstream ETA APIs differ — **KMB has a per-stop
  endpoint** (`data.etabus.gov.hk/v1/transport/kmb/stop-eta/{stopId}`) that returns **all routes at a pole in one
  call** (verified live), but **Citybus has none** (its `stop-eta` URL 422s; only per-route `eta/CTB/{stop}/{route}`
  works). So: **switch the KMB live fetch to `stop-eta`** (1 call per KMB pole, any route count) and keep CTB per-route;
  **dedupe** so a route serving two poles is fetched and listed once (the user-preferred behaviour;
  [`dedupeEtas`](#adr-023--eta-lists-are-de-duplicated-once-server-side-canonical-api) already collapses
  `operator|route|bound`). **Both** the Place page and the compact Nearby card fetch **every** route at the place
  (KMB cheap, CTB per-route) so "the next few buses" are genuinely the soonest — a *capped* CTB fetch would silently
  mis-rank (we'd show "soonest of KMB + sampled CTB", not of all). A **per-place fetch budget** stays only as a guard
  for a pathological interchange; **honesty rule** (ADR-008): the **true route count is free from the static index**
  (no live call), so a card always shows the real total + a **"+N more"** affordance and never implies completeness —
  and if the guard ever trims CTB, the Place page (single place, on-demand) fills the rest without cross-card budget
  pressure.
- **Place detail (replaces "Stop detail"):** the detail screen becomes a **Place** view (a single stop = a one-pole
  place). Routes are **grouped under the pole they depart from**; the **mini-map shows a pin per pole** (built so
  flipping to centre-pin-only is a one-line change — the user expects to want that); a **walk *range*** ("4–6 min")
  when poles differ enough for the minutes to differ (never "4–4"), with each pole's own walk time inside its group.
  **Navigation:** tapping a stop on a route schematic resolves that stop to its place (`placeByStopId`) and opens
  **Place detail anchored on that pole** — not the bare stop.
- **Why:** restores direction-correctness (kills the live false merges) **and** delivers the collapse the user asked
  for. Dataset-wide the rule forms **1,987 clusters absorbing 5,471 of 9,305 stops → ~37% fewer Nearby cards**, stable
  to ±10% across radius/tolerance knobs; median cluster diameter 13 m; only ~1.9% geometrically risky. Adversarial
  check: **29 of 30 sampled clusters confirmed good**, including termini and bus-bus interchanges. The Belair example
  resolves to **exactly 2 cards** split by travel direction (NE: ST141/142/143 + CTB 001968; SW: ST511–514 + CTB
  001965). Re your **u-turn concern:** a bearing can be corrupted at a turnaround, but the failure is mostly *safe*
  (it splits a genuine same-kerb pair rather than fusing opposite ones), and the exact "next stop is across the road
  after a u-turn" case is blocked outright by the **consecutive veto**; any route that traverses both kerbs is blocked
  by the **shared route+bound veto** regardless of bearing.
- **Lifecycle (unchanged seam):** the merge stays a **pure function recomputed in `buildPlaces`** — no stored artifact;
  new/removed/moved upstream stops flow in for free on the next index rebuild. When the daily crawl
  ([docs/03](./03-architecture.md), [docs/11](./11-status.md)) is implemented it will run this **same** `buildPlaces`
  offline and write a versioned R2/KV snapshot — so building ADR-042 now works in both the live-recompute model and the
  future snapshot model with no rework.
- **Consequences / build checklist:**
  - **Supersedes ADR-022's pair-only merge and its "≤ 1 member per operator" invariant** (clusters may now hold
    multiple same-operator members). ADR-022's landmark matcher and self-describing-id *representation* are retained.
  - **Per-place ETA fetch** — ✅ done. `memberEtaLists`/`stopArrivals` now fetch KMB via `stop-eta` (1 call/pole)
    and CTB per-route to a per-place budget (`NEARBY_CTB_BUDGET` = 12; `DEFAULT_CTB_BUDGET` = 24 on the Place page),
    cross-member deduped; `placeRouteCount` gives the honest total. (Median **11** routes/card, p90 = 30 — KMB
    collapsing to 1 call/pole keeps this bounded.)
  - **Card UX for more routes** — ✅ done. `StopRow` shows the soonest ≤6 + a tappable **"+N more routes"**
    (`moreRoutes` i18n key; N from the honest `routeCount`) → opens the Place page. Place detail groups routes under
    their pole, multi-pin `MiniMap`, walk *range* (`formatWalkRange`), route→stop→place nav via `?pole`.
  - **Sequencing — quick win first:** ✅ **done** — the **bearing gate + joint-route positive signal** now run on
    the existing pair merge (`directionAgrees` in `dataset.ts`: reject a candidate whose stops' mean travel
    bearings disagree by >45°, unless a co-run KMB+CTB route lists both at the same sequence position; a missing
    bearing never rejects). *Then* land full N-member clustering with cluster-level vetoes, per-place caps,
    member-keyed favourites, and name-once.
  - **Docs to touch on implementation:** [docs/02](./02-data-sources.md) & [docs/03](./03-architecture.md) (drop the
    one-member-per-operator wording), [docs/07](./07-backlog.md) (move "better name matching" notes), and
    [docs/11](./11-status.md).
- **Open follow-ups (raised 2026-06-11):**
  1. **Same-name pole disambiguation.** ✅ **Answered 2026-07-31 by
     [ADR-071](#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)**, which measured
     the problem at **567 of 10 118 places** and split it in two: the pairs that are one pole published twice are
     folded onto one member, and the rest get a **compass side** on the heading where the poles are far enough
     apart for one to mean anything — 141 pairs at 2–10 m stay ambiguous by design (WP5-12).
     Within a multi-pole place the poles share a landmark name; the group label
     "KMB · ST141" reads as opaque at first — *but* `ST141`-style codes are **printed on KMB's physical stop flags
     and shown in KMB's own app**, so they are a real-world anchor, not an internal id: **keep them as the pole
     label.** (A "lead the group with its headline routes" tweak was tried 2026-06-15 and **reverted** — it didn't
     read more clearly and duplicated the route rows directly beneath the header.) **Card-level direction tag —
     shipped 2026-06-15 (compass octant).** A place's `meanBearingDeg` now rides on the wire `Stop` (`bearingDeg`,
     set only for merged places), and `formatBearing` (`@nextbus/core`) snaps it to a localized 8-point "-bound"
     label (en "Northeast-bound" / 中文 "東北行"), preceded by a **compass arrow** (`BearingArrow` — an `ArrowUp`
     rotated to the bearing, 0° = N = up, clockwise) so the direction reads without parsing the word; rendered on the
     Nearby card caption and the Place-detail summary. The two Belair cards now read **"↗ Northeast-bound …"**
     (bearing 54°) vs **"↙ Southwest-bound …"** (225°) — verified live via `/v1/nearby`. (Same pass: the "served by"
     operators comma-separate — "Citybus, KMB" — and `formatDistance` drops the space before the unit — "200m".)
     Data findings (`.context/stop-merge-study/towards-and-confidence.mjs`): a clean **"towards {place}" is NOT
     derivable** — the modal route *destination* covers only ~25% of a place's departures (median; ~10 distinct
     destinations/place), and the modal *next stop* only ~50%; a **coarse 4-region** "towards" concentrates better
     (median 70%) **but fails intra-region splits** — both Belair directions read "New Territories". Only the
     **place mean bearing → compass** is reliable and always separates siblings, which is why compass shipped; the
     friendlier **"towards {district}"** wording stays parked behind an **18-district
     gazetteer** (coordinate→district) to reach the desired "NNE towards Sha Tin" wording later.
  2. **Circular-route heading.** For loop routes (e.g. KMB **284**, a Sha Tin circular) the inbound/outbound bound +
     single destination don't convey *which way round* the bus is going — confusing in route rows and the schematic.
     Want a clearer heading cue for circulars ("via X" / direction-of-travel). Related to the bearing signal's
     terminus-loop artifacts noted above.
  3. **Cluster-review tooling + per-place confidence (confidence shipped 2026-06-15).** The grouping is good but not
     perfect (the wide-bearing-spread tail is dominated by termini/BBIs, where the loop geometry makes the bearing
     unreliable — mostly *correct* groupings we just can't auto-vouch for, plus a handful of genuine borderline
     non-terminus cases e.g. Cleverly Street). To optimise it deliberately we want a **one-off internal review UI** to
     eyeball clusters on a map and accept/split them. **Shipped now:** every `IndexPlace` carries a heuristic
     **`confidence` (0–100)** + `bearingSpreadDeg` so the review queue can sort worst-first (`placeConfidence` in
     `dataset.ts`: penalise bearing spread, diameter, member count; bonus for a joint-route same-pole proof; termini
     flagged for review). Distribution: **~1,689 high / 276 medium / 45 low** of ~2,010 places. **TODO:** build the
     review UI (one-off) and feed back any rule tweaks; the score is internal (never shown to riders) and tunable.
     **High-spread audit (2026-06-15):** of the **42** places with bearing spread ≥ 50°, **19 are termini/BBIs**
     (wide spread is expected loop-noise — trusted, not individually reviewed) and **23 are non-terminus** — those 23
     were adversarially verified from route direction/destination evidence. Result: **22 GOOD, 1 UNCERTAIN, 0
     opposite-direction fusions.** The wide spreads resolved to road curves, joint-route-proven same poles, or
     terminus loops. The one UNCERTAIN ("Hung Kiu, Tuen Mun Road", southbound) is a **distinct-location** question —
     two boarding spots ~42 m apart across a main road + parallel service road, but **same travel direction** (no
     wrong-ETA risk; at worst it should be two cards). So the clustering holds up at the risky tail; the residual is
     a few "should this be split into two same-direction cards" calls for the review UI, not direction errors.
     Artefacts: `.context/stop-merge-study/extract-high-spread.mjs`, `high-spread-review.json`, `high-spread-audit.md`.

## ADR-043 — A core navigation-animation system: cross-fade tabs, slide-and-reveal stack, web swipe-back
- **Status:** **Partially implemented (web PWA)** — typecheck 7/7, Biome clean. **Shipped on web:** tab cross-fade,
  a left-edge swipe-back gesture, reduced-motion support, and the two-step-reveal hook. **Tried and reverted:** a JS
  stack to get animated push + reveal-on-back on web — it animated beautifully but **broke scrolling** (and chrome,
  overlays) on react-native-web, so it's out. **On web today the down/back transition is an instant cut**; the slide
  + reveal is **native-only and deferred** (it's free on the native stack later). See the JS-stack post-mortem below.
- **Context:** navigation had no transitions — tabs cut instantly and detail pages popped in with no motion. We want
  one *core, rule-based* feel, set once and never re-tuned per page: (1) tab↔tab = quick cross-fade; (2) opening a
  sub/detail page = slide in from the right; (3) every back-able page = a left-to-right swipe-back gesture **and** a
  back animation where the top page slides off to the right, revealing the page beneath; (4) the route page should
  reveal in *two* beats — page transition first, then (once data lands) a smooth scroll to the originating stop.
  The hard constraint: **we ship the PWA now** (`Platform.OS === 'web'`, react-native-web), native later. We
  ground-truthed the platform behaviour against the *installed* `node_modules` + React Navigation docs and found:
  - Expo Router's default `<Stack>` is react-native-screens' **native** stack. On **web** it neither animates nor
    gestures — `NativeStackView.js` just toggles `display:flex/none` and `ScreenStack.web === View`. So
    `animation:'slide_from_right'` and `gestureEnabled` are **silent no-ops in the PWA**.
  - **Bottom Tabs `animation`** (`fade`/`shift`/`none`) is JS-driven and **does** animate on web — the one
    transition that behaves identically everywhere.
  - The **JS** stack (`@react-navigation/stack`, which expo-router *vendors*) **does** animate its cards on web
    (push *and* reveal-on-pop), via Reanimated. But its swipe-**gesture** is iOS-only — stubbed on web — so a web
    swipe-back must be hand-rolled regardless of navigator. `ExperimentalStack` is **not** a fix: it's a native
    screens stack that falls back to the (non-animating) standard `Stack` on web.
  - **JS-stack post-mortem (the deciding finding, learned by building it):** wrapping the root in the vendored JS
    `createStackNavigator` (via `withLayoutContext`) *did* give a gorgeous web push + reveal-on-back. But each screen
    is wrapped in the JS stack's `Card` (a `react-native-gesture-handler` `PanGestureHandler` + a transform-animated,
    frequently-re-rendering container), and on react-native-web that **breaks scrolling**: on every
    `Animated.ScrollView` + collapsing-header screen (route, stop) a wheel/touch scroll registers for a frame then
    **snaps back to 0** (verified live on both). It also (a) flashed the JS stack's default *light* `CardContainer`
    background in dark mode, (b) detached/froze off-screen cards (`detachInactiveScreens` defaults true on web),
    making the floating tab bar / back button vanish, and (c) clipped the bottom-sheet overlay via the card's
    `overflow:hidden`. `detachInactiveScreens={false}` only made it worse (unbounded scroller height, all history
    cards mounted). **Conclusion: the JS stack is unviable for this PWA** — a working scroll beats an animated push.
- **Decision:** keep Expo Router's **native `<Stack>`** (the proven baseline: scrolling, chrome, and overlays all
  work on web) and animate only what's safe and additive on web. All rules live in
  **`apps/mobile/lib/navTransitions.ts`** (single source of truth) + the two `_layout`s — never per page.
  1. **Root stack = native `<Stack>`** with `screenOptions` from `useRootStackScreenOptions()`:
     `{ headerShown:false, animation:'slide_from_right' }`. The `animation` is honoured on **native** (slide +
     reveal, free) and is a **no-op on web** (instant cut) — the accepted trade for a rock-solid PWA.
  2. **Tab cross-fade (1):** `animation:'fade'` on the `<Tabs>` `screenOptions` (not `shift` — a horizontal slide
     would fight the floating glass tab pill). This is the one transition that animates on web. The flash it
     originally showed (the bottom-tabs default *light* scene background bleeding through the fade) is fixed by
     painting the theme bg on both the tabs wrapper `View` and the per-screen `sceneStyle`.
  3. **Web swipe-back (3):** **`apps/mobile/components/WebSwipeBack.tsx`**, mounted once at the root — a left-edge
     `react-native-gesture-handler` `Pan` that calls `router.back()` past a distance/velocity threshold. Web-only
     (`Platform.OS !== 'web'` renders nothing); native keeps its own edge-swipe. A thin edge strip + `failOffsetY`
     keep it off vertical scrolling (confirmed: scroll still works with it mounted). On web the back itself is
     instant (no slide) until native lands.
  4. **Two-step reveal (4):** a shared **`usePageRevealReady()`** hook gates entrance work on the stack's opening
     `transitionEnd` (with a timer fallback for web / the initial route). `app/route/[id].tsx`'s auto-scroll waits on
     it *and* the row measurements, then scrolls — so on native the page slides in, then the scroll reads as a
     deliberate second beat. (Mechanism only; the web auto-scroll itself is a separate pre-existing bug — below.)
  5. **Reduced motion:** every rule honours OS / `prefers-reduced-motion` (docs/09 §5) — `useReducedMotion` collapses
     the cross-fade/slide to an instant cut and the route scroll to `animated:false`.
- **Why native `<Stack>` over the JS stack:** a PWA that doesn't scroll is broken; nice transitions don't redeem it.
  Native-stack web is a plain `display`-toggle — no gesture wrapper, no transform churn — so `Animated.ScrollView`,
  the floating chrome, and the bottom sheet all behave. We keep the genuinely-cross-platform win (tab cross-fade) and
  a functional swipe-back, and we get the real slide + reveal **for free on native** when we get there. No new
  dependency; `JsStack.tsx` was deleted.
- **Consequences / caveats:**
  - **No down/back slide on web — it's an instant cut.** This is the deliberate cost of unbreaking scroll. Native
    gets the slide + reveal from the same `animation` option. If a web push/back animation becomes a priority, the
    path is a *purely additive* per-screen Reanimated `entering`/`exiting` (no navigator swap) — push-in is reliable;
    reveal-on-pop is hard on web because native-stack hides the outgoing screen instantly. Tracked in docs/07.
  - The web swipe-back is instant (no animation) and threshold-triggered, not finger-following — a future polish.
  - **Pre-existing, separate issue (not from this change):** `app/route/[id].tsx`'s auto-scroll to the originating
    stop does **not** fire on web (reproduced with this work's gate *and* `animated` flag fully neutralised — it
    predates and is independent of the animation work). The two-step *mechanism* is in place; landing the scroll on
    web is tracked separately (that screen is active stop-merge/favourites WIP). See [docs/07](./07-backlog.md).
  - **`components/BottomSheet.tsx` (separate WIP component):** its slide-up entrance doesn't complete on web — the
    panel mounts but only its grab handle peeks (the `onPanelLayout`→`withTiming(0)` entrance appears not to run /
    gets cancelled on web, likely by the handle pan's `onBegin`→`cancelAnimation`). Reverting the JS stack removed
    the card-clipping that had hidden it entirely, but the entrance bug is in that component, not the nav system.

## ADR-044 — Route badges are tap-to-expand: fare-stage timeline, per-band frequency & hours, concession estimates
- **Status:** **Implemented** — typecheck 7/7, Biome clean, web bundles (3251 modules). Verified against the
  live worker: `/v1/route/KMB:1:outbound:1` → `service.patterns` = 3 day-types (weekday 8 bands / Saturday 10 /
  Sunday 8), each with `first`/`last` + a Sunday-first `days` mask, plus per-stop sectional `fare`. Extends
  ADR-036 (the static-facts strip) and follows the honesty tiers of ADR-008 / ADR-038. **The day-type labels
  (weekday/Sat/Sun) shipped** — the dataset's top-level `serviceDayMap` (GTFS service-id → 7-day run mask) turned
  the "stretch goal" into a join over data we already fetch, so ADR-036's day-type deferral is now lifted for
  frequency/hours. Remaining: an in-browser visual pass of the three sheets.
- **Context:** `RouteMeta` (route detail) shows four calm pills — **fare** (`$6.7 → $5.8`), **frequency**
  (`10 – 30 min`), **service hours** (`05:35 – 23:40`), **stop count** (`42 stops`) — but each compresses
  richer facts into one summary. Riders reasonably want the detail *behind* the summary: *where* does the fare
  step down, *why* is the frequency range so wide (peak vs off-peak), *when* is the first/last bus. The app
  already has a reusable `BottomSheet` (used for the stop-action sheet on this same screen), so tap-to-expand is
  cheap mechanically. The open question was per-badge: is there honest detail to reveal, and is the data present?
  Two investigations settled it — (1) the consolidated dataset's `freq` already carries **per-band** frequency
  we currently collapse in `summarizeFreq`; (2) **no** concessionary (child / elderly / PwD) fare exists
  anywhere upstream (GTFS, Routes-&-Fares, the consolidated dataset, operator APIs all carry adult fares only —
  confirmed in [`docs/research/02`](../docs/research/02-data-availability-matrix.md)).
- **Decision:**
  1. **Make the `RouteMeta` pills pressable** → each opens the shared `BottomSheet` with a titled body
     (`role="button"`, i18n labels, a subtle affordance since the pills currently read as static). One
     interaction pattern, reused per badge. **The header route chip is left alone** (its only useful reveal —
     direction — is being handled in a separate tab; a service-type sheet is too niche to earn the surface).
     *(Superseded below: the stop-count pill, initially a scroll-to-top affordance, now opens a route-overview
     sheet — see the refinement.)*
  2. **Fare → a fare-stage timeline.** Per-stop **sectional** fares already exist (`IndexRouteMeta.fares`,
     stamped per stop — ADR-036). The sheet shows only the **stage transition points** (where the boarding fare
     steps down), as a compact vertical rail reusing the schematic style — not all N stops. This is the
     data-ready, highest-value reveal; build it first.
  3. **Fare → concession *estimates*, clearly labelled.** Since no concessionary data exists upstream, we show a
     policy-derived **estimate** under an explicit "Estimated" heading + a shared disclaimer (*"Concessions are
     set by policy, not route data — figures are estimates."*): **child (3–11) ≈ half** each adult stage
     (rendered with a `~`); **elderly 65+/PwD** as the flat **$2 Scheme** rule (from **3 Apr 2026**: $2 for
     fares ≤$10, else 20% of fare; JoyYou/eligible Octopus, not cash) — **not** a per-stage figure, since it's a
     flat concession and per-stop numbers would misrepresent it. The rule (child multiplier + $2-scheme logic)
     lives in **one helper in `@nextbus/core`** (e.g. `estimateConcessions`), never hardcoded in the UI, so a
     policy change is a one-line edit. This is a deliberate, bounded exception to ADR-008's "never fake
     precision": the estimate is labelled, rule-based, and centralised — not dressed up as measured data.
  4. **Frequency & hours → enrich from data we already fetch.** `summarizeFreq` currently flattens the `freq`
     bands to a single `{min,max}` + `{start,end}`. Expose the bands instead: `RouteServiceInfo` gains an
     optional `bands: Array<{ start, end, headwayMin }>` so the **frequency sheet** shows the peak/off-peak
     breakdown that explains the wide range, and the **hours sheet** shows true **first / last** departure. No
     new upstream source — same daily `data.hkbus.app/routeFareList.min.json`; the change is in
     `data-normalize/dataset.ts` (`buildPatterns` groups the `freq` bands by day-type) — the edge passes
     `service` through wholesale, so **no edge change was needed**. **Day-type labels (weekday / Sat / Sun)
     shipped**: the dataset's top-level `serviceDayMap` maps each `freq` service id to a 7-day run mask
     `[Sun…Sat]`, so the join needs no new source (route 1 splits cleanly into `287`=Mon–Fri, `288`=Sat,
     `448`=Sun). Where several service ids share a day-type we keep the richest (most bands) as representative;
     an uncommon mask (e.g. Mon–Sat) falls to `other` and the UI renders the exact days from the mask. The coarse
     `headway`/`hours` badge summary (`summarizeFreq`) is unchanged, so pill and sheet agree.
- **Why:** A progressive-disclosure tier-jump for almost only UI cost. Fare detail and frequency/hours bands are
  already on-device (ADR-036) — we're revealing data we fetch and discard, exactly the ADR-036 thesis. The
  concession estimate is the one place we generate a figure; centralising it and labelling it keeps the honesty
  contract intact. The `DataSource` seam is untouched (new `RouteServiceInfo.bands` is optional).
- **Consequences / dependencies:**
  - **`BottomSheet` has a known web-entrance bug** (ADR-043 tail: the panel mounts but only the grab handle peeks
    on web). Since the PWA is the live target and every badge sheet depends on it, **fixing that entrance is a
    prerequisite** for the pressable-pill slice.
  - **Concession estimates are a maintenance surface** — the $2 Scheme *changed on 3 Apr 2026*; the single core
    helper is the mitigation. If the child half-fare rule ever varies by operator/route we'd have to revisit.
  - Slicing: (a) pressable-pill + sheet plumbing (incl. the web-entrance fix), (b) fare-stage timeline +
    concession estimates, (c) `summarizeFreq` → bands + frequency/hours sheets. Backlog: [`docs/07`](./07-backlog.md).
- **Refinement (concessions on the timeline, post-feedback):** the concession estimates moved *out* of a
  bottom-only block and *onto each fare stage* — every stage row now carries the adult fare plus a child
  (`Baby` glyph) and elderly/disabled (`Accessibility` glyph) estimate (`~$3.4` etc., `$`-prefixed to match the
  adult figure), each marked with a trailing `*`. The bottom section became a **legend**: the same two glyphs
  keyed to their passenger class + how the estimate is derived (child "roughly half the adult fare"; elderly the
  $2-Scheme note), closing with `* Concessions are set by policy, not route data — these figures are estimates.`
  The icon is the shared key between the per-stage figure and the legend; the `*` is the "these are estimates"
  pointer. Verified in-browser (`/route/KMB:1:outbound:1`): two stages ($6.7 / $5.8), child `~$3.4` / `~$2.9`,
  elderly `~$2.0` both (≤ $10 → flat $2). **The `BottomSheet` web entrance was fine in practice** — it slides up
  (just not instantly), so the ADR-043 "prerequisite" concern didn't materialise; no sheet fix was needed.
- **Refinement (stop-count → route-overview sheet, post-feedback):** the stop-count pill was initially a plain
  scroll-to-top affordance, but that read as dead next to three sheet-opening pills, and a jump-to-stop list was
  judged redundant (the screen *is* the stop list). So it now opens a **`Route overview` sheet** — three whole-route
  stats: **stops** (count), **full journey** (`service.journeyMin`, e.g. `~44 min` · end-to-end), and **distance**
  (`~8.0km`). Origin/destination are omitted (they already head the screen). **Journey time is resurfaced** here
  despite ADR-036 hiding it as a *badge* — the ADR-036 objection ("misleading beside a mid-route rider's ETA")
  doesn't apply in a sheet explicitly about the *whole route*; framed "typical end-to-end, scheduled not live".
  **Distance is a new `routeDistanceM` (core/geo)** — the sum of great-circle hops between stop coordinates; HK
  open data has no polylines, so it under-counts real road distance and is shown as an explicit `~` estimate with
  a note (same honesty tier as the concession figures). Sanity-checked: route 1 = 8.0 km straight-line over 25
  stops → ~11 km/h implied, plausible for a stop-heavy urban route. No new data/edge work — coordinates are
  already on-device.
- **Refinement (sheet polish, iterated over feedback):** (1) **Height-independent settle** — `Easing.back`'s
  overshoot is a *fraction of the travel*, so a tall sheet (starting further down) bounced visibly more than a
  short one. Replaced with a fixed **7px** overshoot via `withSequence` (slide to −7px, ease back to 0), so every
  sheet bounces the same tiny amount regardless of height; the drag-release settle is a plain ease-out (no bounce
  on a small drag). (2) **Stop-action sheet leads with the stop** — the schematic-tap sheet now makes the **stop**
  the `h3` title (with a `MapPin`); the route context is a muted subtitle. The bright livery `RouteChip` was
  dropped from that subtitle (it out-shouted the title, and the liveried chip is already large in the header
  behind) — the route number instead sits in a **plain muted pill** that keeps the livery chip's rounded *shape*
  (grammar consistency) but drops brand colour: fill = `--text-muted` (matching the subtitle text), number knocked
  out in `--surface`. (An operator-accent tint was tried and rejected — too dark and not clearly brand-related.)
  Save still pins route-at-stop (ADR-042); only the emphasis changed. (3) **Fare timeline** — child & elderly estimates sit on the adult fare's line at **near-equal
  prominence** (body size, `muted` tone, size-16 icons), widely spaced (`gap-5`) so each reads as its own figure;
  the **stop count moved down** beside the boarding-stop name (the price's start), leaving the top line to the
  fares; the per-stage marker was **removed** entirely (the `~` prefix + the legend already signal "estimate").
  Legend icons sit in a filled `bg-surface-2` disc (size 20, `text` tone) as a prominent key.

## ADR-045 — Stop detail mini-map: pinned, with brand-coloured labelled dots and a scroll-linked pole highlight
- **Status:** **Built & verified on web** (2026-07-03). Extends [ADR-041](#adr-041--stop-detail-a-collapsing-header-shared-with-route-a-keyless-static-mini-map-and-an-enriched-summary)'s
  `MiniMap` and the multi-pole layout from [ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant),
  in `apps/mobile/components/MiniMap.tsx` + `apps/mobile/app/stop/[id].tsx`.
- **Context:** For a multi-pole place the map dropped one plain red dot per pole (ADR-042) — no way to tell *which*
  dot is *which* pole, and the map (an ADR-041 scroll-away "hero") left the screen entirely once you scrolled into the
  route list. The ask was to make the map a **persistent, legible utility**: name the dots, colour them by operator,
  keep the map on screen, and tie it to the list.
- **Decisions:**
  1. **A full-width hero that shrinks into a right-aligned floating "PIP" on scroll.** At rest the map is a full-width
     hero card; as the header collapses (over `COLLAPSE`) it **shrinks to `SHRINK_FRAC` (~0.6) of its width and docks
     top-right**, floating over the list. **Height is constant** (`MAP_HEIGHT` 150). This **reverses ADR-041's
     scroll-away intent by design**; earlier cuts (a full-width *pinned bar*, then a fixed *corner card*) either had
     content disappear behind the bar or lost the hero — the hero→PIP shrink keeps both. **The shrink is a crop, not a
     scale:** a raster-tile map can't animate a non-uniform width without horizontal distortion (`scaleX`) or a
     per-frame tile recompute (animating layout `width` re-runs `fitZoom`/tile layout). So the map renders at the hero
     width and the right-aligned outer container **clips** it (`overflow: hidden`) as it narrows, while the inner map
     **slides left by half the cropped width** to stay centred — no distortion, no recompute. **Docking is
     platform-split (`StickyMap`):** the *vertical* pin uses CSS **`position: sticky`** on **web** (browser-composited,
     jitter-free — a `translateY`-follows-scroll approach *jittered* because the JS handler lags the compositor a
     frame) and a reanimated **`translateY`** clamp on **native**; the *width* crop is a reanimated interpolation (its
     slight web lag is confined to the one-off collapse, then static). **Trade-off:** the floating card overlaps the
     right edge (ETA column) of the rows behind it — the accepted cost of a PIP. `SHRINK_FRAC`/`PIP_MAX_WIDTH` (desktop
     cap) / `MAP_HEIGHT` are the knobs.
  2. **Brand-coloured, labelled, tappable dots.** Each dot is coloured by operator via `OPERATOR_ACCENT`
     (`@nextbus/ui`) — KMB red / CTB yellow / LWB orange — derived from the member id prefix (`m.id.split(':')[0]`),
     falling back to the default pin colour when unknown. A short **stop-code label** (from `splitStopCode(name).code`,
     e.g. `MK513`) sits in a legibility chip by each dot — **flipped above the dot when another pole sits directly
     below** within a chip's height (the along-the-kerb stack), so labels don't cover the next dot. The visible dot
     stays 14 px but its **touch target is a fixed 32 px box** (RN-web ignores `hitSlop`, and small dots were too easy
     to miss — you'd hit the map behind). `MiniMap` gained a `MapPoint[]` `points` type carrying `id`/`operator`/`label`
     (was bare `{lat,lng}`), plus `activeId` and `onPointPress`.
  3. **Scroll-linked highlight (scroll-spy).** Each pole group reports its content-offset top (`onLayout` →
     a `sectionOffsets` shared value); a `useAnimatedReaction` on `scrollY` picks the last group whose header has
     reached the top of the list (just under the pinned map) and highlights that dot (swelled + others dimmed), falling
     back to the first group so a dot is always lit. Cost stays on the UI thread — `runOnJS` fires only on a *change*.
     The scroll container carries **just enough tail padding** — `windowH − listTop − (last group's measured height)`
     — so the **last** group can scroll up to under the map (which is what lets tapping the final dot/header highlight
     it) **without** leaving a whole empty screen below it, and so it can't be scrolled entirely away.
  4. **Two-way tap link, animated.** Tapping a **dot** *or* its **list group header** scrolls that pole's group to the
     top and (via the spy) highlights it. Because **RN-web's `ScrollView.scrollTo()` is a no-op under reanimated v4**
     (the animated ref never reaches the DOM node — this also silently broke the ADR-033 header *tap-to-top* on web
     **and** the route screen's reveal-scroll), the shared **`useScrollToY`** hook sets the scrollable node's
     **`scrollTop` directly on web** — and animates it with a **rAF easeOutCubic tween** (RN-web's DOM
     `scrollTo({behavior:'smooth'})` is *also* a no-op here), honouring the OS **reduce-motion** setting; native keeps
     the imperative `scrollTo({animated})`. `stop/[id].tsx` (dot/header taps, `onTitlePress`) and **all three
     `scrollTo` sites in `route/[id].tsx`** route through it.
     *(A scroll-triggered solid header backdrop was tried and then **reverted** — once the map is a corner PIP rather
     than a full-width bar, the header can stay fully transparent per ADR-033, and the see-through floating look was
     preferred.)*
  5. **Sub-details above the map; a compass dial for the direction; inset dividers.** The meta strip (direction ·
     operators · route count · distance · walk) sits **above** the map so it tucks up behind the header as you scroll,
     rather than wedged between the map and the list (the map's native dock point adds the measured meta height,
     `metaH`; web pins via CSS sticky regardless). The travel-direction cue is a small **bearing glyph** rotated to the
     bus travel direction, **snapped to the nearest of the 8 compass points** so it agrees with `formatBearing`'s
     octant label (a slightly-off raw angle read as wrong). It's rendered **ringless** — an arrow *in a circle* read as
     the back button, so the ring (and its too-subtle north tick) was dropped. The glyph is **`Navigation2`** — a
     symmetric cone that points straight **north (up)** by default, so `GLYPH_NORTH_OFFSET` is 0. (Rejected en route:
     `ArrowUp`/a ring — back-button-y; `Navigation` — not true-north by default; `ArrowDownToDot` — liked the
     toward-a-point idea but the shape didn't land, needed a 180° offset.) Swapping the glyph is a two-line change
     (`GLYPH` + `GLYPH_NORTH_OFFSET`). It's rendered **inline inside the meta `Text`** (`BearingArrow inline` → an
     inline-block glyph that rides the first line), so when the strip wraps on a narrow screen the text flows *under*
     it rather than the glyph centring against the whole wrapped block. `vertical-align: middle` sits it on the taller
     line-box centre (reads as high), so a small `INLINE_NUDGE` (−1.5 px, tuned on a scratch `/compass-test` page
     across all 8 headings) and an `INLINE_GAP_TRIM` (−2 px) land it on the text's optical centre with the label
     tucked close. Snapping is global (also the Nearby `StopRow` arrow); the dial ring stays available via the
     `circle` prop but is unused. Section **dividers are inset to the content margin** (not full-bleed) so they line
     up with the text and the map card, and the map carries a small **bottom gap** before the first divider.
- **Why:** All of it is data we already hold (member `id`/`name`/`location` per ADR-042; the operator accents already
  used by `RouteChip`). Pinning + spy turn the map from decoration into a two-way index of the place's poles — the
  clearest way to disambiguate a same-kerb merge. The `DataSource` seam and `MiniMap`'s keyless-tile approach are
  untouched.
- **Consequences / caveats:**
  - **Label crowding** (poles sit ≤~30 m apart) is **mitigated** by the above/below stagger — clean for a straight
    kerb stack; a genuinely 2-D cluster could still overlap, where leader lines / numbered badges would be the next
    step.
  - The header stays **background-less** (ADR-033); with the map now a corner PIP (not a full-width bar), content
    scrolling under the transparent chrome reads as the intended floating look rather than the earlier "rows above the
    map" artifact.
  - Verified end-to-end on the PWA against a 3-pole KMB place: web-sticky pin (no jitter), staggered labels, 32 px tap
    targets, KMB-red dots (`#D7282F`, not the default), spy highlight, tap-to-scroll (smooth) from **both** the dot and
    the list header, the **last** group reaching the top, and trimmed tail padding. Cross-operator colour variation is
    the same code path (untested visually — no KMB+CTB merge to hand).

## ADR-046 — Route detail direction toggle: server-resolved reverse, an in-card from/to header, and a circular-route treatment
- **Status:** **Built & verified on web** (2026-07-04). Touches the `DataSource` seam (`@nextbus/core`), the edge
  (`apps/edge/src/stop-route.ts`), and the route screen + header (`apps/mobile/app/route/[id].tsx`,
  `components/RouteHeader.tsx`, `components/CollapsingHeader.tsx`, `components/DirectionSwapIcon.tsx`, `RouteMeta.tsx`,
  the stop-name display rules — `@nextbus/core`'s `src/stop-name.ts` since WP2-1 — and `@nextbus/i18n`).
- **Context:** Route detail showed a **single direction** with no way to see the return trip; the only place a
  "direction" hint lived was the dropped route-chip sheet idea (ADR-044 fork). Riders want to flip to the opposite
  direction in place. Two data realities shaped it: (a) the opposite bound is a *separate* canonical route id
  (`operator:no:bound:serviceType`) whose service-type variant the client can't safely guess; (b) ~102 routes are
  **circular** (loop back to origin) and ~284 more are one-way — neither has a reverse, and a circular route's first
  and last stops are *identical*, so naïve origin→destination shows a useless "A → A".
- **Decisions:**
  1. **The reverse is resolved server-side, not guessed.** `RouteDetail` gains an optional `reverse?: RouteRef`
     (`{ id, origin, destination }`). The edge's `findReverse` scans the static index for the same operator+number in
     the **opposite bound**, picks the representative service-type variant (the `preferServiceType` rule mirrored from
     the search index), and returns it **only when that id actually has a stop sequence** — so circular / one-way
     routes correctly carry **no** `reverse`, and the client never constructs an id that 404s. Flows cleanly through
     the `DataSource` seam (ADR-004); the client just calls `getRoute(reverse.id)`.
  2. **The "F" header layout — an in-card from/to block.** Below the morphing route chip sits a **from/to card**
     (origin over destination, full **first/last stop names** — richer than the route's abbreviated `orig`/`dest`),
     with the **reverse toggle *inside* the card** on its right. On scroll it condenses to the collapsed pill
     `→ destination` (matching the stop-card form). *Rejected en route, via interactive HTML mockups:* a segmented
     "Towards A / B" control (long HK names force marquee-in-a-tab-bar, reads as a filter), a maps-style from/to+swap
     (imports a "trip planner" mental model, heaviest chrome, worst collapse), and a **floating collapsed FAB** for
     reversing while scrolled (over-engineered — the toggle lives only in the card now). `CollapsingHeader` gained
     `collapsedLabel`, an `expandedSlot`, and an exported `Marquee` (with a `lineHeight` + `align` option) to support this.
  3. **Flip in place, no skeleton, no misleading anchor.** The flip is **local state** (`overrideId`), not a nav push,
     so Back exits the screen rather than un-flipping. `keepPreviousData` + a **prefetch** of `reverse.id` mean the
     first flip doesn't flash the loading skeleton — it swaps when ready (usually instant from cache). Once flipped the
     **here-anchor is dropped** (the reverse serves the opposite kerbs, so the boarding stop no longer applies) and the
     one-time auto-scroll is skipped. Favourites already key on `(stopId, routeId)` (ADR-032/042), so they re-key to
     the active direction for free.
  4. **Motion makes an instant, cached swap read as a deliberate flip.** A `swapNonce` bumps on each flip and drives:
     the toggle glyph (Lucide **`GitCompareArrows`**, chosen over a point-symmetric `⇄` whose spin is an ambiguous
     wobble — its two end-dots make the counter-clockwise half-turn legible); a **lyrics-style name swap**
     (Material shared-axis-Y — the old destination rises into the origin slot and shrinks to origin style, the old
     origin slides up and out, the new destination rises from the bottom), fired on the **name change** not the raw
     tap so it never animates stale text; a **staggered list cascade** on flip (rows fade+rise, delay capped); and
     **bus tokens that slide *down* from the first stop** on entry (start at the origin node, tween to position). All
     honour reduce-motion. Reanimated **layout animations were avoided** (flaky on web, our current target) in favour
     of shared-value + `useAnimatedStyle`.
  5. **Circular routes get their own treatment (no reverse).** Detected by the loop marker HK bakes into the
     destination name — `CIRCULAR` / `循環` / `循环` (`isCircular`/`stripCircular`, in `@nextbus/core` since WP2-1). Because a
     loop's first == last stop, the card switches to the route's own labels: the **boarding terminus** over
     **"Circular via <turnaround>"** (`circularVia` i18n; turnaround = destination with the marker stripped), the
     connector arrow becomes a **loop glyph**, and there's no toggle. A meta-strip "Circular" chip was built then
     **dropped** — non-interactive with nothing behind it, and the header already says it. Genuine **one-way** routes
     (racecourse specials) are *not* circular and keep the plain, no-toggle card.
- **Why:** the reverse is data we already hold; resolving it on the edge keeps the id/service-type logic where the full
  dataset lives and the UI honest to the `DataSource` seam. The header reuses `CollapsingHeader` so route and stop
  screens stay one family. The motion is the cheapest way to signal "this is now a different journey" when the payload
  is already cached (so nothing visibly "loads").
- **Consequences / caveats:**
  - New i18n: `reverseDirection`, `circularVia`. New dep-of-note: none (Lucide + reanimated already present).
  - The **collapsed pill uses the full destination stop name** (e.g. `→ Star Ferry, Harbour City`), which diverges
    slightly from the stop-card `→ Star Ferry` convention. Left as-is deliberately; switching just the pill to the
    clean route destination is a one-line change if we revisit.
  - Two multi-bound routes are *flagged* circular yet have a reverse; they'd show a toggle (harmless, negligible).
  - `biome.json` now ignores `**/.context` so the gitignored interactive mockups don't fail `pnpm lint`.
  - Verified on the PWA: KMB 1 (bidirectional — flip swaps the list + live ETAs + meta, first flip has no skeleton,
    all four animations play, Back exits) and KMB 10 (circular — loop glyph, "Circular via Tai Kok Tsui", no toggle).

## ADR-047 — Green Minibus (GMB): a third operator, keyed on `gtfsId`, with per-arrival live/scheduled honesty
- **Status:** **Built & verified end-to-end on the edge** (2026-07-09). Widens `OperatorId` in `@nextbus/core`; adds
  the `gmb` adapter (`packages/data-normalize/src/gmb.ts`) + dataset ingest (`dataset.ts`); wires the edge
  (`apps/edge/src/stop-route.ts`, `search-index.ts`, `index.ts`); touches UI tokens (`@nextbus/ui`),
  `apps/mobile/app/stop/[id].tsx`, `@nextbus/i18n`, and `classifyRemark` (`@nextbus/core/eta`).
- **Context:** GMB (green minibus) is a documented backlog operator (docs/07) and the first non-franchised operator we
  ship. Investigation established that (a) the consolidated dataset we already fetch (ADR-021) **already carries GMB** —
  1,149 route entries, 4,743 stops with coordinates, inline `freq`/`fares`, and each entry's globally-unique numeric
  GMB `route_id` in `gtfsId`; and (b) the live ETA host `data.etagmb.gov.hk` has a **batch stop board**
  (`/eta/stop/{id}`) like KMB, and **mixes live and timetable arrivals** (`remarks:"Scheduled"/未開出`). Two wrinkles
  differ from KMB/CTB: GMB **public numbers repeat across regions** (route "1" exists in HKI *and* NT — 145 such
  collisions), and its live board identifies routes by numeric `route_id` + `route_seq` (1/2), **not** public number.
- **Decisions:**
  1. **`gtfsId` is the GMB uniqueness key, folded into the canonical id's service-type slot.** Canonical GMB route ids
     are `GMB:{no}:{bound}:{gtfsId}` (e.g. `GMB:1:outbound:2006408`). `(gtfsId, bound)` is globally unique (verified: 0
     dupes), so this can't collide the way `GMB:1:outbound:1` would. The public number stays in slot 1 for display; the
     `gtfsId` doubles as the **live ETA route_id**. Ingest builds a `gmbCanonicalByLive` map (`${gtfsId}:${bound}` →
     canonical id) so the edge can resolve the live board's raw ids back to us.
  2. **`route_seq` 1 → outbound, 2 → inbound** (verified against both feeds). The edge maps each stop-board entry via
     that rule + `gmbCanonicalByLive`; entries whose route isn't in the index, or with no arrivals, are dropped.
  3. **Live-vs-scheduled honesty rides the existing remark path (ADR-008) — no new `Eta` flag.** GMB's per-arrival
     `remarks:"Scheduled"` flows through `optionalRemark` into `Eta.remark`; `classifyRemark` already tags it
     `scheduled` (via the English "Scheduled"; the Chinese `未開出`/`未开出` were added for robustness). The muted
     `RemarkTag` renders it. This is genuinely per-direction: at the Peak, route 1 outbound reads "Scheduled" while
     inbound is live tracked, and it flips at the other terminus.
  4. **GMB is one stop-board call per pole** (like KMB, not CTB's per-route fan-out), so it costs one subrequest per
     GMB member and needs no fan-out budget. It joins the KMB branch conceptually in `memberEtaLists`.
  5. **Two collapse scopes, because GMB numbers aren't network-unique.** GMB `route_code` is unique **only within a
     region** (HKI/KLN/NT); the same number in two regions is a different route, but within one region a number can have
     several `route_id`s that are just variants ("Normal Route" vs "Special Departure" — e.g. NT 803 has a 22-stop and a
     19-stop outbound). Region isn't in the dataset, so:
     - **Network-wide (search index):** key GMB on **number + direction + origin + destination** — the rider-facing
       identity. Cross-region routes differ in from/to and stay separate; same-route variants share from/to and collapse
       to one hit (representative = the fullest variant by stop count, tie-broken by id). KMB/CTB still collapse
       service-type variants by `(operator, no, bound)`.
     - **Per-stop (`dedupeEtas` in `@nextbus/core`; the stop screen's `dedupeRoutes`):** plain `operator|no|bound` for
       **all** operators — safe for GMB too, because a stop belongs to one region and codes are unique within a region,
       so two arrivals at a stop sharing number+direction are always variants of the same route (collapse, keep the
       sooner). *Corrects an earlier attempt to key these by the full `gtfsId` id — that surfaced the 803 variants as
       two rows, the opposite of what we want.*

     **Known v1 limitations:** a GMB number can still appear more than once in search across regions with no region label
     (a region/area tag is a follow-up); and the rare KLN/NT boundary case where two regions' same-numbered routes share
     one physical stop would over-collapse at that stop (same risk profile the app already accepts for dedupe).
  6. **Green accent `#00845C` (white text)** in `OPERATOR_ACCENT`; `OPERATOR_LABEL` shows "GMB" for now (a friendlier
     "Minibus" is a one-line swap). Filter chips, `RouteChip`, Nearby, fare/frequency sheets are all data-driven and
     needed no code change — GMB lit up automatically once ingested (ADR-037).
- **Consequences / notes:**
  - **`data.etagmb.gov.hk` 403s an empty User-Agent** (which the Workers runtime sends by default), unlike the KMB/CTB
    hosts. The `gmb` adapter sends an identifying `User-Agent`. This cost an hour of head-scratching — noted here so it
    doesn't again.
  - Same-kerb merging currently keeps GMB poles separate (no cross-operator GMB↔KMB/CTB joint-route proof exists); the
    bearing/name clustering still applies among GMB poles. GMB stop-merge edge cases are a known follow-up.
  - Route detail for GMB is **static-only** for now (no per-stop live ETAs), mirroring CTB (ADR-021) — the stop board
    and Nearby are fully live. GMB has **no bulk route-ETA endpoint** (the route-level `/eta/route-stop/{id}/{seq}` 500s);
    per-stop live would mean one call per stop (routes are short — median 10, p90 21 — and the host tolerates concurrent
    calls, so a bounded fan-out behind the 8s-cached `/v1/route` is feasible), deferred as too resource-heavy per request
    for now.
  - **GMB fares are shown at the route level only, not per stop.** Verified that GMB sectional/staged fares are **not in
    any open-data feed**: the consolidated dataset (0/1,149 route-dirs vary), the official TD Routes-and-Fares GeoJSON
    (0/1,160 — `fullFare` is one value repeated per stop), and the GMB API (no fare field at all) all carry a single
    flat fare; real en-route fare changes live only on the physical fare board. (Contrast: KMB 1,110/1,614 and CTB
    741/957 route-dirs *do* publish sectional fares, which we stamp per stop.) So ingest drops the flat per-stop `fares`
    array for GMB and keeps only `service.fareFull`; `routeFareAtSeq` returns nothing for GMB, so Nearby rows, stop-detail
    rows, and the route timeline show no per-stop GMB fare — only the route-level fact. A per-route fare-board scrape /
    region-aware sectional model is a follow-up.
  - Verified on the edge: `/v1/etas/GMB:20014489` (Peak Galleria) returns route 1 both directions with correct
    destinations, sectional fare ($11.8 outbound; none at the inbound terminus), and the live/Scheduled split;
    `/v1/nearby` near the Peak surfaces the GMB pole with live ETAs. The static index holds 1,149 GMB route-directions;
    the **search index collapses variants to 1,089 GMB hits** — NT 803's "Normal" (22-stop) and "Special" (19-stop)
    outbound fold to one hit (the fuller "Normal" wins), while route "1" in HKI vs NT stays as 4 distinct entries, and
    "803" vs "803K" stay separate. At Hin Keng (a stop both 803 variants leave from) `/v1/etas` returns a single 803
    outbound row (`dedupeEtas` collapse), keeping the sooner arrival.

## ADR-048 — PWA install metadata: web app manifest + iOS `apple-touch-icon` via a custom `+html`
- **Status:** **Icons/manifest/head built (2026-07-14); on-device install not yet verified.** Adds
  `apps/mobile/app/+html.tsx`, `apps/mobile/public/manifest.webmanifest`, and four generated icons in
  `apps/mobile/public/` (`apple-touch-icon.png` 180, `icon-192/512.png`, `icon-maskable-512.png`) from
  `scripts/gen-icons.mjs`. No app-logic or data changes.
- **Context:** We ship the installable PWA first (ADR-002), but nothing emitted install metadata. Expo's
  `web.output: "static"` + Metro only injects the tab **favicon** (`web.favicon`); it does **not** generate a
  web app manifest (that was a webpack-era feature). So there was no manifest and no `apple-touch-icon`.
  Symptom: iOS Safari "Add to Home Screen" showed a **screenshot of the page**, not our icon — because iOS
  uses `<link rel="apple-touch-icon">` (falling back to a page snapshot), and ignores `rel="icon"` there.
- **Decisions:**
  1. **Own the web `<head>` via expo-router's `app/+html.tsx`** — the supported hook for static head content.
     Inject `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `theme-color`, and the
     `apple-mobile-web-app-*` meta. The favicon stays auto-injected from `app.json` (not duplicated here).
  2. **`apple-touch-icon` is the load-bearing icon for iOS** (not the manifest). It's **180×180 and opaque**
     (full-bleed ink) — iOS renders transparency as black and applies its own rounded mask.
  3. **Manifest declares 192/512 "any" + a 512 "maskable"** icon. Maskable = the mark inside the ~66% safe
     zone on ink, so Android launcher crops don't clip it. Icons live in `public/` (copied to the web root by
     `expo export`), generated alongside the launcher assets in one script.
  4. **`display: standalone`, ink `background_color`/`theme_color` (#111827)**, portrait, `start_url: "/"`.
- **Deferred (needs a device + HTTPS):** actually installing over the cloudflared tunnel and confirming the
  home-screen icon renders, plus the standalone **status-bar style** (`black-translucent`) + safe-area handling.
  Install requires a secure origin, so it can't be checked on `localhost`.

## ADR-049 — The basemap is the HK Lands Department's, self-cached, with labels as a per-locale overlay
- **Status:** **Decided 2026-07-26, implemented 2026-07-27** (WP0-2). `apps/edge/src/tiles.ts` proxies and
  re-caches LandsD; `apps/mobile/lib/tileSource.ts` is the `TileSource` seam; `MiniMap` stacks the basemap
  and the per-locale label layer and carries the logo plus a linked notice. The two compliance fixes the
  migration was gated on turned out to be moot rather than done: `MiniMap` no longer credits OSM at all, and
  no longer hard-codes a tile URL. Dark mode still uses the CSS invert filter, now recorded as
  `TileSource.invertForDark` — a property of the *source*, not of the component. Supersedes the interim OSM
  raster choice inside
  [ADR-041](#adr-041--stop-detail-a-collapsing-header-shared-with-route-a-keyless-static-mini-map-and-an-enriched-summary) / [ADR-045](#adr-045--stop-detail-mini-map-pinned-with-brand-coloured-labelled-dots-and-a-scroll-linked-pole-highlight)
  (which never claimed to be production-ready). Full option comparison, costs and verbatim licence clauses:
  [`docs/proposals/02`](./proposals/02-basemap-and-street-imagery.md).
- **Context:** `MiniMap` drew **OpenStreetMap's public raster tiles**, which cannot ship. The OSMF Tile
  Usage Policy — **rewritten 2026-07-22, materially stricter** — now has a section headed *"Prohibited"*
  covering prefetching, and states that library-default User-Agents (i.e. React Native's `<Image>` on
  iOS/Android) *"will be blocked"*; proxying to fix the UA trips its separate anti-proxy clause. It also
  warns commercial/donation-seeking services that *"access may be withdrawn at any point"*. Separately we
  needed **real `zh-Hant`/`zh-Hans` map labels** — OSM's HK Chinese names are volunteer-contributed and
  uneven — and we wanted to stay **keyless** ([ADR-016](#adr-016--slice-1-server-side-v1nearby-on-device-index-deferred)).
- **Decisions:**
  1. **Adopt the HK Lands Department (LandsD) tiles** via the CSDI Portal — keyless, free, no billing
     account, explicitly licensed for commercial use. `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/WGS84/{z}/{x}/{y}.png`
     (z10–20). Authoritative HK geometry from the body that actually surveys the territory, so new
     footbridges, reclamation and estates appear well before OSM has them.
  2. **Labels are a separate overlay keyed on locale**, not part of the basemap:
     `.../xyz/label/hk/{lang}/WGS84/{z}/{x}/{y}.png` with `{lang}` = `en` | `tc` | `sc` — a 1:1 match for our
     three locales, so **`useLocale()` swaps one URL and the map relabels** with no restyling. This is the
     single strongest reason to prefer LandsD and it satisfies golden rule 5 (bilingual is core) for the map
     surface, which OSM never could.
  3. **The dense survey cartography is a feature, not a flaw.** Pedestrian footbridges, subways and
     landmark buildings are *exactly* what tells a rider which side of a road they're on — the hardest part
     of finding an HK stop. We accept a less "pretty" map in exchange for self-location utility. This
     reverses the concern raised in proposals/02 §4 and removes the dark-restyle spike from the critical path.
  4. **Cache tiles ourselves in the Worker.** The [CSDI T&C](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC)
     affirmatively grant *"download, distribute, reproduce … for both commercial and non-commercial
     purposes"* including *"digital copies and copies placed on other websites"*, and contain **no** caching,
     scraping or mirroring prohibition. Caching also **helps** us honour the one stated limit (*"shall not
     invoke the API with large amount of requests within a short period"*). Two implementation notes: their
     responses carry `Cache-Control: private`, which we must deliberately override for a Worker/CDN cache to
     store anything; and **no speculative territory-wide pre-warm** — demand-driven caching only, since a
     full pyramid crawl is precisely what that sentence forbids.
  5. **Attribution is a hard requirement, not best-effort.** The LandsD **logo on the map face**
     (28×28 px in their own reference sample) plus a *"Map from Lands Department"* / *"地圖由地政總署提供"*
     notice linking to their disclaimer. **Self-host a copy of the logo** — the asset URL is undocumented and
     could move. This extends the ADR-038 "About the data" sources list.
     **The credit anchors to the visible map, not to the map canvas** (fixed 2026-07-27). It lives in its own
     `MapAttribution` component, and any container that **crops** the map renders it *itself* and passes
     `deferAttribution` to `MiniMap`. This is not a style preference: ADR-045's hero→PIP shrink is a crop, so
     the inner canvas keeps its full width and slides left, and a credit pinned to that canvas's right edge is
     exactly what the crop discards — on a wide viewport, where `PIP_MAX_WIDTH` caps the PIP at 300 px, the
     entire chip was clipped away while the map stayed on screen. Anchoring it to the clipping container costs
     nothing per frame and leaves the at-rest appearance identical. **Any future map surface that scales,
     crops or transforms the map owes the same check.**
  6. **Stay on raster for now; vector is a later upgrade.** Raster reaches **z20** (our mini-map lives at
     z16–17) and needs no renderer change. The vector service exists (`/vt/basemap/...`, style is Mapbox GL
     spec v8, 813 layers) but documents only z9–15 and would need a scripted recolour for dark mode.
  7. **Keep Protomaps/PMTiles-on-R2 as the documented fallback**, not the primary. A measured **38 MB** for
     all of HK at z0–15, genuinely themeable, ~$0–5/month. Take it if we later need a real dark flavour or
     offline packs. Recorded so the fallback isn't re-researched from scratch.
  8. **Google Maps is rejected on architecture, not price.** Its ToS §3.2.3(a)/(b) prohibit caching and
     re-hosting tiles and imagery, and §3.2.3(e) bans Google imagery on the same screen as a non-Google map —
     which our Place-detail layout is. Deep links out remain fine (ADR-050).
- **Consequences:** the map becomes free, keyless, more accurate for HK, and properly trilingual, and we own
  the cache. We give up client-side theming until/unless we move to vector, so the existing
  `DARK_TILE_FILTER` CSS-invert hack stays for dark mode in the interim.
- **Do first, independent of the migration:** link the `© OpenStreetMap` credit to
  `openstreetmap.org/copyright` (currently plain text — an ODbL requirement) and move the hard-coded
  `TILE_URL` into config so the source can be repointed without an app release.

## ADR-050 — Stop imagery: Google Street View deep link now, HK Streetscape 360 as the inline target
- **Status:** **Decided 2026-07-26, not yet implemented.** Two-step: the deep link is unblocked; the inline
  panorama depends on one open question. See [`docs/proposals/02` §6](./proposals/02-basemap-and-street-imagery.md#6-street-level-imagery-compared).
- **Context:** HK stops are frequently one of several poles outside a mall exit or across a flyover, and
  neither a map pin nor a stop name reliably answers *"am I at the right pole?"*. A photo of the kerb does.
  We already carry `Stop.bearingDeg` ([ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant) follow-up), so we
  can aim a panorama the way the bus travels — the view that actually identifies the stop.
- **Decisions:**
  1. **Ship the keyless Google deep link first.** `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat}%2C{lng}&heading={bearingDeg}`
     — the Maps URLs API needs **no API key**, has no SKU, quota or billing account, and because Google
     renders the imagery in its own app the caching/attribution/no-mixing terms don't reach us. Slots in
     beside the existing "Open in Maps" hand-off (the ADR-045 pin action sheet). Hours of work, £0.
  2. **Target LandsD's own Streetscape 360 for inline imagery.** `https://data.map.gov.hk/api/3d-mms-data/{panorama}?key={key}`
     — HK government 360° street panoramas, **territory-wide since March 2025**, free API key from
     `3dmap@landsd.gov.hk`, published limits of 5 GB/s and 100 concurrent users. Under the same CSDI grant as
     ADR-049 it is very likely **cacheable**, which no Google product permits — the difference between a
     per-stop photo being free forever and being metered per view. It also sits on the same screen as our map
     without a licence conflict, which Street View Static cannot.
  3. **Reject the Street View Static API** for inline use. Caching/re-hosting imagery is prohibited outright
     (the much-cited "30-day rule" covers lat/lng values, not imagery — only `pano_ID` may be stored
     indefinitely), and showing it beside a non-Google map is separately banned.
  4. **Honesty applies to imagery too** ([ADR-008](#adr-008--etas-are-approximations-no-client-side-fake-countdown)): panoramas go stale —
     HK stops move for roadworks — and coverage is thin inside termini/BBIs. Label the capture date where the
     source gives us one, treat the photo as a **hint**, and keep the map plus stop name authoritative.
- **Open question blocking (2):** the docs don't describe a coordinate → panorama lookup (paths are said to be
  *"returned using the JavaScript SDK included in the demonstration code"*) and the format appears to be a
  bespoke `.pano`. **Whether a stop coordinate can be resolved to a panorama without running their JS SDK,
  and whether the format is renderable in React Native, decides this.** Ask when requesting the key. If the
  answer is no, decision (1) stands as the shipped feature and this becomes a watch item.

### Addendum 2026-07-28 — how the Streetscape key actually works (investigated, still blocked)

Prompted by "if I get permission, does that give me another token?". Investigated against the live service
rather than the docs. **The blocking open question above is unchanged** — this only settles the access model.

1. **Yes, it's a token — and no, it isn't a secret.** `?key=<uuid>`, or the same value as an
   `Ocp-Apim-Subscription-Key` header (Azure API Management sits underneath; a bare request returns APIM's
   stock `401 … missing subscription key`). But **LandsD publishes a live working key in its own public
   sample URL** on the Streetscape 360 API page — fetched with it and got `200` and 590 kB of JPEG — and the
   key is **not domain- or referer-restricted**: it returns `200` from plain server-side curl and from a
   spoofed `Origin`. A second working key is search-engine-indexed. Invalid keys *are* rejected, so it is
   enforced as an identifier; it is simply bound to nothing.
2. **Therefore: treat it as a public token, but still proxy it.** It goes in `wrangler secret put` and the
   panorama is fetched through the Worker — not into `EXPO_PUBLIC_*`. Not for confidentiality, which it
   doesn't have, but because (a) the tile seam already exists, (b) the CSDI grant permits caching, so the
   proxy buys a real cache, and (c) the key can't be scoped and rotation means emailing LandsD again, so
   keeping it out of a shipped bundle is cheap insurance. This would be the **first runtime secret the Worker
   has ever needed** — see [ADR-061](#adr-061--environments-and-configuration-topology-local--production-ephemeral-previews-and-no-staging-tier).
3. **There is no application process to fail.** No form, no vetting, no approval SLA, no terms to sign — the
   CSDI docs say only *"you can contact the organisation to get the API keys for free"*. So "getting
   permission" is not a gate on this ADR; the renderability question is.
4. **Licence is the ADR-049 grant, and it is generous.** The CSDI T&C define "Spatial Data" to include the
   API, grant commercial reproduction and redistribution free of charge, and contain **no anti-caching
   clause** — the opposite of Street View. Attribution to the Government + CSDI Portal is required. *Not
   confirmed:* whether the map-face logo requirement formally extends to panoramas (it's stated on the
   Topographic/Imagery pages, not restated on Streetscape). Assume it does.
5. **Confirmed unaffected:** ADR-049's basemap tier is genuinely keyless. See the tier table in
   [`docs/02`](./02-data-sources.md#map-tiles--street-imagery--hk-lands-department-adr-049-adr-050) — the key
   requirement is a property of `data.map.gov.hk` and `api.hkmapservice.gov.hk`, not of LandsD as a whole.
## ADR-051 — Layered package boundaries; `packages/ports` is declaration-only and imports nothing
- **Status:** **Decided and implemented 2026-07-27/28** — ports (WP1-3) *and* the enforcement engine (WP1-4).
  Implementation: `packages/ports/`, `layers.json`, `scripts/boundaries/`.
- **Context:** One Expo codebase ships the PWA today and iOS/Android later. The expensive failure is not a
  missing abstraction, it is a *wrong* one — over-abstracting the view layer, or under-declaring the handful of
  genuinely platform-bound seams so a native developer has to rediscover them by reading React Native code. The
  plan's claim is that **`ls packages/ports/src` should literally be the iOS/Android porting checklist**, which
  makes this a documentation deliverable as much as a code one: the doc comments carry more weight than the
  signatures.
- **Decision:**
  1. **Six ports, and no more:** `KeyValueStore`, `LocationProvider`, `LocaleProvider`, `LinkOpener`, `Clock`,
     `TileSource`. Everything else stays native — view layer, navigation, motion, gestures, haptics, widgets.
     Explicit non-goals are written into `packages/ports/src/index.ts` so the list can't quietly grow: no push,
     no background refresh, no location `watch()`, no timers in `Clock`, no `Intl` surface in `LocaleProvider`.
  2. **The package is declaration-only and imports nothing.** Enforced two ways, both demonstrated failing:
     `"types": []` in its tsconfig (a stray `typeof process.env` reference then fails with `TS2591`), and
     `packages/ports/scripts/check-type-only-contract.mjs`, wired as the package's `test`, which emits with tsc
     and fails if any module emits runtime code — it also fails if *nothing* is emitted, so it cannot pass
     vacuously.
  3. **Ports take domain types as type parameters instead of importing them.** `TileSource<LocaleId, ImageAsset>`
     is the precedent: importing `@nextbus/core` would break the zero-import rule, and re-declaring `Locale`
     would create exactly the second source of truth this package exists to prevent. The app instantiates
     `TileSource<Locale, ImageSourcePropType>`; iOS would use `TileSource<Locale, UIImage>`.
  4. **`TileSource`'s canonical home is `packages/ports`**, superseding the "lives in the app for now" note in
     [ADR-049](#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay).
     The LandsD *implementation* stays in `apps/mobile` — it carries a `require()`d logo asset and an
     `EXPO_PUBLIC_API_URL` read, which are platform concerns by definition.
     **The duplicate was closed immediately rather than documented** (`apps/mobile/lib/tileSource.ts` is now
     `export type TileSource = PortTileSource<Locale, ImageSourcePropType>`): the local copy was a faithful
     duplicate *that day*, and a duplicate nobody diffs is a divergence with a start date. Binding it makes the
     compiler check the equivalence — which is also how we know the port is faithful, since `landsdTileSource`
     typechecks against it unchanged.
  5. **The `Clock` port never enters `core`.** `packages/core` keeps taking an explicit `now: number` (as
     `eta.ts` already does throughout); only the view layer holds a `Clock` and calls `now()` once per render.
     The port exists to make the ban nameable, not because `() => number` needs an interface. WP1-4's
     `noRestrictedGlobals` will enforce the other half.
  6. **`LocaleProvider` returns the OS's raw ordered BCP-47 tags and nothing else.** Detection is platform;
     *resolution* is a shared rule with HK judgement in it (bare `zh` → Traditional), and that stays in
     `resolveLocale`. Splitting them is what stops three platforms inventing three answers for `zh-MO`.
  7. **Storage keys are a persistence contract with the rider's device**, not an implementation detail:
     versioned suffixes (`nextbus.*.vN`), and a scheme change needs a migration. This is the same lesson
     WP2-5's favourite-id migration exists to teach.
  8. **Nothing is wired to these interfaces yet** — deliberately. WP1-3 ships types and the checklist; adoption
     is Wave 2/3, one adapter at a time.
- **Findings recorded while writing them** (none fixed here; all are Wave 2/3 work):
  - **No `LinkOpener` value exists.** `openExternal`/`openInMaps` match the shape method-for-method, but the
    `Platform.OS` switch sits *inside* the functions rather than in an adapter. Introducing the value is what
    deletes those branches.
  - **`useLocation` conflates the port with the shared logic** — permission, fix, `snapFix` and the
    `nextbus.lastFix.v1` read/write are one hook. Nothing is wrong today; splitting it is a refactor.
  - **`openInMaps`/`openExternal` fail silently.** A blocked pop-up, or a device with no maps app, gives the
    rider no feedback at all. Noted in `link-opener.ts` as a known rough edge.
  - `getLocales()` + `resolveLocale` already match `LocaleProvider` exactly; that adapter is mechanical.
- **The enforcement engine (WP1-4).** `layers.json` is the **single declaration** of the layer graph;
  `pnpm boundaries:gen` regenerates both `.dependency-cruiser.json` and `biome.json`'s `overrides` block from
  it, and `pnpm boundaries:check` fails if either drifted. Edit the declaration, never the outputs.
  - **Eight layers, keyed by *policed directories* rather than by package** — so a package's own build scripts
    are Node tooling outside its layer. Without that, `packages/core/scripts/check-type-only-contract.mjs`
    importing `node:fs` would read as a kernel violation:
    `contract` → (nothing, + `zod`) · `ports` → (nothing) · `kernel` (`packages/core/src`) → `contract`
    **type-only** · `tokens` (`ui`, `i18n`) · `client` (`api-client`) · `adapters` (`data-normalize`) ·
    `server` (`apps/edge`) · `view` (`apps/mobile`, the only layer that may render).
  - **Two tools, because neither is sufficient.** dependency-cruiser resolves module paths, distinguishes
    `import type` (`tsPreCompilationDeps`) and — critically — computes **transitive reach**. Biome is textual,
    which is what catches platform globals that need no import at all, and it gives the in-editor signal.
    Both are **pinned exactly** (Biome `2.4.16`, dependency-cruiser `18.1.0`) so an upgrade cannot silently
    change pattern semantics. dependency-cruiser drags in no `esbuild`, so golden rule 6's hoisting trap and
    `wrangler dev` are unaffected.
  - **The type-only `core → contract` edge is covered by two checks that cover different halves, and deleting
    either leaves a hole.** dependency-cruiser is *syntactic and general* — it sees `import type` across every
    layer and module, but not what survives compilation. ADR-052's emit check is *semantic and narrow* — it
    reads the emitted JavaScript, but only for `core`, and only for `zod`/`@nextbus/contract`. Note also that
    `zod` sits in kernel's npm allowlist purely so the closed-world rule doesn't fire; the **type-only rule does
    the real work**, and the allowlist entry alone would pass a runtime import.
  - **Reach rules never target npm packages.** Reachability is type-blind, and `core` legitimately reaches
    `zod` through a legal type-only hop — so a transitive "kernel must not reach zod" rule would be a false
    positive by construction.
  - **The acceptance criterion is falsifiability, not passing.** `pnpm boundaries:selftest` injects **13**
    violations and every gate fires, including the two transitive cases that matter
    (`view → client → adapters`, and `core →(type-only)→ contract → apps/mobile`). Anti-vacuity is defended
    three ways: a **clean control** fixture (a rule that fired on everything would fail it), a guard that fails
    any cruise fixture reading zero modules, and `boundaries:check` printing modules-per-layer and failing if a
    layer whose directories exist contributes none.
  - **tsconfig project references stay rejected.** `composite` requires declaration emit, which contradicts
    golden rule 1 (source-only packages, no build step). `"types": []` on `contract`/`core`/`ports` gives the
    platform-global isolation we wanted from them without it. A future agent must not "helpfully" add them.
  - **A real hazard this surfaced, and fixed:** `formatClock` in the kernel used `toLocaleTimeString`, whose
    output depends on the host's ICU version **and the device's timezone** — so three platforms could render
    the same ISO string three different ways, and a rider abroad saw their own local time on a Hong Kong bus
    board. It is unportable by construction and no fixture corpus could have pinned it. It now computes
    `HH:mm` arithmetically from a fixed `HK_UTC_OFFSET_MS` (Hong Kong is UTC+8 year-round, no DST since 1979)
    and reads the result back with `getUTC*`, the only accessors that ignore the host zone. It slipped past the
    `Intl` denied-global because `toLocaleTimeString` is a *method*, not the global, so `layers.json` now also
    bans the `toLocale*` **pattern** in the kernel — watched firing. **Fixed while the function had zero
    callers**, which made it free; it is not dead code (`proposals/00` P5, the countdown⇄clock toggle, is built
    on it), so after P5 shipped this would have been a visible change to every arrival row.
  - **Known gaps, left visible rather than papered over:** ✅ **the first of these is closed as of
    2026-07-30** — a raw URL *literal* in a screen (`fetch('https://data.etabus.gov.hk…')`) was invisible to
    both tools, because `pnpm boundaries` checks the **import graph** and that line imports nothing, so golden
    rule 2 was encoded only as `view` ✗→ `adapters`. It is now
    `scripts/check-view-transport-free.mjs` in the `boundaries` chain: five source patterns (a constructed
    socket, the factory spelling, a `ws://` literal, `fetch(`, a `/v1/` path) over 74 files in five policed
    dirs, with seven pattern scenarios, **four allowlist cases** and the live tree as the last one — the
    allowlist cases exist because the review found the matcher exempting a *line* rather than a rule, over a
    selftest that had never executed it
    ([ADR-056](#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)).
    It took four waves and a work package that needed it to be true. Still open: `packages/ui/preset.js` and
    `global.css` sit outside the policed `src` directories and are unpoliced; and the full `Date`/`Intl` ban in
    the kernel still waits on Wave 2 moving time *formatting* out to the view layer (`eta.ts` legitimately does
    `new Date(iso).getTime()`).
  - **Budget: over, and recorded as over.** `layers.json` (70) + `generate.mjs` (146) = **216 lines against the
    plan's ~150** (+44%), of which ~37 lines are the determinism *policy* data (14 denied globals, 4 banned
    patterns) that Biome's JSON formatter expands one per line. It generates 759 lines of config, so the
    leverage is real, but per the plan's own risk row this is the trigger to **revisit rather than grow**: if
    it needs to expand again, collapse the generator instead.
  - **Manifest tidy-up noted:** `@nextbus/i18n` and `@nextbus/api-client` declare `@nextbus/core` as a runtime
    `dependency` but import only types from it. Harmless overstatement; worth correcting when their adapters land.

## ADR-052 — The wire contract: Zod is the single declaration, types erase, and the schema stays additive-safe
- **Status:** **Decided and implemented 2026-07-27** (WP1-1 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). `packages/contract` holds every
  wire shape, `packages/core`'s types are `z.infer` of them, `openapi.json` is emitted and committed, and three
  gates enforce the decisions below. **`apps/mobile` has a literally zero diff**, which was the acceptance
  criterion. Amends the plan's WP1-1 sketch in one respect — see decision (2).
- **Context:** The requirement driving this is **not** "add validation". It is: *a change we make to the system
  must reach every supported platform equivalently, and the data structures must still be adjustable later.*
  Those two pull against each other — the usual way to guarantee cross-platform agreement is to freeze the
  shape. Today one Expo codebase ships the PWA and will ship iOS/Android, so "equivalently" currently costs
  nothing; the moment a native repo exists, every shape is transcribed by a human in two more languages, and
  hand-transcription is where platforms silently diverge.
  There are three separable kinds of change, and only one of them is a schema problem:
  1. **Wire shapes** — generated everywhere from one declaration, so equivalence is by construction.
  2. **Domain rules** (`dedupeEtas`, honest-ETA thresholds, bearing labels) — cannot be generated; they get
     hand-ported, so their equivalence mechanism is the language-neutral fixture corpus (WP1-5), not the
     schema. A rule change edits the corpus and every platform's suite goes red until it is ported.
  3. **Tunable policy** (`maxArrivals`, `dueUnderSec`, `staleAfterMs`) — strongest case: serve it at runtime
     (ADR-053's `ClientPolicy`) and no platform holds the value, so a change is one edge deploy. Prefer this
     for anything that is a number rather than a behaviour. It also settles the live three-way disagreement
     between `app/route/[id].tsx` `.slice(0, 3)`, `favorites.tsx` `.slice(0, 4)` and `StopRow.tsx MAX_ROWS = 6`.
- **Decision:**
  1. **The Zod schemas in `packages/contract/src/wire/` are the single declaration of every wire shape.**
     `packages/core`'s canonical types become `z.infer` of them. One declaration cannot fall out of sync with
     itself, which is why this beat the alternative below.
  2. **`core` imports the schemas with `import type` only, so zod never enters a client's runtime graph.**
     This is the amendment to the plan: WP1-1 as written would have made zod a runtime dependency of the
     package every screen imports. Verified by spike before committing to it — `types.js` emits `export {};`,
     no emitted client file references zod, and renaming a schema field surfaces as a **typecheck error in
     `apps/mobile`**, not at runtime. Consequence worth stating plainly: the web client performs **no runtime
     validation at all**, so unknown-enum tolerance (4) is an obligation on *generated native decoders*, and
     nothing in the TS build can fail to remind us of it. It must be enforced at codegen in WP3-3.
     *Rejected alternative:* keep hand-written types in `core` and prove them equivalent to the schemas with a
     type-level `Equal<>` assertion. It reads well and costs no dependency, but it needs **two** declarations
     to agree, and its assertion file can silently under-cover a type added later — a gate with a hole in it
     is worse than no gate, because it is trusted.
  3. **Wire objects emit as *open* JSON Schema.** Zod reports `z.object()`'s key-stripping as
     `additionalProperties: false`; correct for a validator, wrong for a published contract, because a strict
     generated decoder then **rejects any payload containing a field it does not know**. Adding one optional
     field would break every already-installed copy of the app — a failure on phones we cannot update, for a
     change that is by construction backward-compatible. `WIRE_JSON_SCHEMA_OPTIONS` in
     `packages/contract/src/json-schema.ts` strips it. **This hook, not the schemas, is what makes the schema
     adjustable**, so it is documented there at length and must not be "tidied away". We keep `z.object()`
     rather than `z.looseObject()` because loose objects infer an index signature, and since `core`'s types are
     `z.infer` of these, every consumer would lose typo-checking on every wire shape. Strict where it buys type
     safety (TS), open where it buys forward compatibility (the wire).
  4. **Closed enums are marked `x-unknown-tolerant: true`** (`Locale`, `OperatorId`, `Bound`, and
     `ServiceDayType` when it lands) so generators emit `case unknown(String)` / Kotlin fallbacks. Without it,
     shipping a fourth operator bricks decoding on every deployed phone — a store release, at review speed,
     for what should be a data change.
  5. **Evolution policy.** Additive-optional is free (3) and ships without ceremony. Removal, rename and type
     change are breaking: they need the `oasdiff` gate, an ADR, and a deprecation window in which both shapes
     are served. `/v1` in the path leaves room for a `/v2` if that ever fails.
  6. **No `zod-to-openapi`.** OpenAPI 3.1's Schema Object *is* JSON Schema draft 2020-12, and Zod 4's built-in
     `z.toJSONSchema()` emits exactly that — one less generator to keep in step. Verified: `.meta({ id })`
     hoists a named shape into `$defs` with a `$ref` (so it becomes a reusable component, not the same object
     inlined nine times), custom `x-` keys survive the emit, and the `override` hook can open the objects.
- **The three gates** (all run by `pnpm test`, and each one was verified to *fail* on an injected violation —
  a gate nobody has watched fail is not known to work):
  1. **`packages/core/scripts/check-type-only-contract.mjs`** — emits `core` with tsc and reads the output:
     no emitted `.js` may reference zod or `@nextbus/contract`, and `types.js` must be an empty module. It
     asserts the property (nothing survives into the JavaScript) rather than a proxy for it (the source says
     `import type`), so a re-export chain or an accidental value import cannot slip past a grep. Note it needs
     `--removeComments`: without it the check fails on its own documentation, which names both forbidden
     strings in prose.
  2. **`apps/edge/test/wire-conformance.test.ts`** — parses every endpoint's real response through its
     published schema, inside workerd. Two assertions, and the second is the one that is easy to miss:
     the response must satisfy the schema, **and must carry nothing the schema doesn't describe**. `z.object()`
     *strips* unknown keys rather than rejecting them, so `parse()` alone would accept an undocumented field
     and silently discard it — drift in the direction that hurts most, because the data exists, the web app
     reads it, and no native client can see it. Endpoint ids are discovered from a live `/v1/nearby` response
     rather than hard-coded, so the test cannot drift away from the fixture.
  3. **`packages/contract/scripts/check-openapi-current.mjs`** — rebuilds the document and compares it to the
     committed `openapi.json`, so forgetting to re-emit is a red build rather than a native client generated
     from last month's contract. Compares parsed documents, not bytes, so formatting alone can't fail it.
     `openapi.json` is excluded from Biome (`biome.json`) — a generated artefact formatted by two tools with
     different opinions would be permanently dirty.
- **A real bug the conformance gate found on its first run** (fixed in the same branch, `apps/edge/src/index.ts`):
  `/v1/nearby` read its coordinates with `Number(url.searchParams.get('lat'))`, and **`Number(null)` is `0`, not
  `NaN`**. A request with *missing* lat/lng was therefore served as the coordinates 0, 0 — the Gulf of Guinea —
  returning an empty list with a **200** instead of the 400 the handler intended. Malformed values (`lat=abc`)
  were rejected all along; only absent ones slipped through. A client with a broken location permission got a
  confident "no stops near you" rather than an error it could report. This is the argument for the gate in
  miniature: the bug was invisible from the inside and obvious the moment something asserted the contract.
- **Consequences / notes for whoever touches this next:**
  - **`zod@4.4.3` is pinned exactly**, matching `@nextbus/data-normalize`. There are already **two** zod majors
    in the tree — v3.25.76 hoisted at the root by `@cloudflare/vitest-pool-workers` and `@expo/metro-runtime`,
    v4.4.3 nested under `data-normalize`. Any package using v4 features **must declare zod itself**, or
    `node_modules` resolution walks up to the root v3 and `.meta()` is not a function. Do **not** add a
    `pnpm.overrides` entry to force v4 repo-wide: those two dependencies expect v3, and golden rule 6 is the
    scar from exactly that fight over esbuild.
  - **Two shapes transcribe faithfully but are wrong, and are deliberately left wrong here** (WP1-1 is
    "no shape changes"; fixing them under cover of a refactor makes the refactor unreviewable). Both are the
    first candidates for the evolution policy in (5):
    (a) **Errors are `{error: string}`**, not the `{code, message, retryable}` taxonomy the plan specifies. An
    iOS Widget holding a deleted favourite cannot currently tell "prune permanently" from "retry later", so it
    retries forever. Fix additively: serve `code`/`retryable` alongside `error`, then retire `error`.
    (b) **`Route.service` is served at two different fidelities under one type** — `/v1/stop/:id` omits
    `patterns` (the summary tier; duplicating it was 54 MB of an 82 MB build, ADR-055) while `/v1/route/:id`
    carries it. Both satisfy the same optional-`patterns` schema, so a native client cannot tell which tier it
    received and will read "absent" as "this route has no frequency table". Needs either two named schemas or
    an explicit tier discriminator. **Resolved by [ADR-065](#adr-065--routeservice-is-two-named-schemas-not-one-optional-field-the-fidelity-tier-is-in-the-type)** —
    two named schemas, no change to the bytes.
  - `StopLite` carries flat `lat`/`lng` while `Stop` nests `location: LatLng`. Harmless, faithful, noted.

## ADR-053 — The line: the server owns content, order, counts and text; the client owns layout, colour and motion
- **Status:** **Decided and partially implemented 2026-07-29** (WP3-4 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). The line is stated and gated,
  `ClientPolicy` is served at `GET /v1/policy` and honoured by the app, and the three-way arrival-cap
  disagreement is resolved. The per-field moves the same work package scoped (`remarkKind`, `displayName`,
  `code`, derived fares) are **not all done** — see *Consequences*, which names each one and its state. This
  ADR was a **gap in the sequence**: it was forward-referenced from ADR-052 and ADR-064 before it existed.
- **Context:** The plan's WP3-* wave is native enablement, and the question underneath it is: *when an iOS
  and an Android client exist, which decisions do they each make, and which are made once for all three?*
  Get it wrong in one direction and every platform re-derives the same rule and drifts. Get it wrong in the
  other and the server dictates pixels to a platform whose conventions it does not know.
  The concrete evidence that the line was undrawn, all of it live on `main`:
  - **Arrival caps disagreed three ways.** `packages/core/src/route-detail.ts` capped a route row at 3,
    `app/(tabs)/favorites.tsx` sliced a favourite card to 4, `components/StopRow.tsx` capped a stop card at
    6. Wave 2 had already improved this — the `3` was hoisted out of the screen into the kernel with an
    8-row corpus group — which is exactly why it is a good example: hoisting a number into shared code does
    not settle *who decides it*. It only made the number harder to change, since a kernel constant reaches a
    rider through a store release.
  - **The favourites cap was also a bug.** It pre-sliced the list to 4 before handing it to `StopRow`, which
    computes its "+N more" affordance as `total − shown`. With the list already truncated, that arithmetic
    was `4 − 4`, so a place with nine saved routes showed four and said nothing about the other five.
  - **Cadence disagreed with the edge.** Three screens polled every 20 s (a fourth, `EdgeClient.watch()`'s
    shim, also 20 s) against the 30 s coalescing TTL of ADR-057. One poll in three could only ever return
    the byte-identical cached response: a request, a parse and a re-render to learn nothing.
- **Options:** (A) Leave presentation numbers in the client and hand-port them to Swift and Kotlin, pinned by
  the ADR-060 corpus like any other domain rule. (B) Serve resolved *view models* — the server sends the
  finished row, including its colours and sizes. (C) Draw a line by *kind of decision* and serve only the
  content side of it.
- **Decision:**
  1. **The line, and it is quotable on purpose:** *the server owns content, order, grouping, counts and text;
     the client owns layout, colour, motion and interaction.* A threshold is content; the tone it is rendered
     in is not. "This remark is a scheduled one" is content; `text-subtle` is not. Counts and cadences are
     content, because they are judgements about what a rider is told rather than about how it looks.
     *Rejected (B):* a served view model is the standard answer and it is wrong for this app specifically. A
     hex colour on the wire renders outside iOS's own colour system, so it ignores Dark Mode and Increase
     Contrast; a served font size ignores Dynamic Type. Worse, both are invisible from this side of the
     network — nothing in a TS build or a workerd test can fail on them, so the defect ships and is found by
     a rider with large type turned on.
     *Rejected (A):* it is the status quo, and the status quo produced three different answers to one
     question. A number that must be hand-ported is a number that will be ported differently.
  2. **Tunable policy is served, as one small document: `GET /v1/policy` → `ClientPolicy`.** Six fields
     (`dueUnderSec`, `warnUnderSec`, `staleAfterMs`, `refreshAfterMs`, `maxArrivals`, `maxRows`), every one
     **optional**, `max-age=300`.
     *Rejected — embedding it in every response:* six numbers duplicated across every payload, and worse, N
     places a stale copy can come from. Two screens holding two policies at once is the disagreement this
     endpoint exists to end, moved onto the wire.
     *Rejected — putting it on `/v1/health`:* `/v1/health` is ADR-055's operational truth about one isolate,
     is `max-age=0` by design, and a native client should not parse ops telemetry to lay out a list.
     Its own endpoint is also the only option a client can cache and replay offline *as a policy* rather
     than as a fragment of a stop response. It deliberately **never reads the dataset**, so it answers while
     KV is unavailable — which matters because it carries the refresh cadence, and an outage that took the
     policy with it would leave every client polling its own default at the moment the edge could least
     afford the traffic.
  3. **Every new field is `.optional()` per ADR-052 §5, and here that is the mechanism rather than a
     formality.** A partial policy must be a legal policy: the edge may move one threshold and say nothing
     about the other five, and a client three versions old must read that document and fill the rest itself.
     `resolveClientPolicy` in `@nextbus/core` is the single place that filling happens.
  4. **The load-bearing part — moving a rule to the edge must not create a second implementation.** For every
     field, the rule stays declared **once** in `packages/core`; `apps/edge` is the `server` layer and may
     import the kernel (ADR-051), so the Worker *calls* the kernel function and serves the precomputed value;
     the wire field is optional; and the client uses the served value when present and calls **the same core
     function** when it is absent. This is the shape ADR-063 already set for `sortKey`, and it is what keeps
     offline working — ADR-058 ships offline, and a client that cannot answer these questions on its own is
     broken in a tunnel. The alternative, deleting the client-side derivation once the server sends the
     value, trades one duplicate for a feature.
  5. **`CLIENT_POLICY_DEFAULTS` lives in `packages/core` and the Worker serves those very bytes.** Not in
     `packages/contract`: `core` imports the contract with `import type` only (ADR-052 decision 2) and so
     cannot read a runtime constant from it. The constraint produces the right shape anyway — the contract
     declares the *shape*, the kernel declares the *values*, and there is one declaration of "three
     arrivals" rather than a client copy and a server copy. **Serving a compiled-in constant is not a
     no-op:** the value a client compiles in is reachable only by a store release, while the value the Worker
     serves is reachable by a deploy. `apps/edge/src/eta-cache.ts` now *derives* `ETA_TTL_SEC` from
     `refreshAfterMs` rather than restating 30, so the cache window and the poll cadence cannot drift apart
     again.
  6. **A served value that is not a positive finite number is rejected in favour of the default, not
     obeyed and not clamped.** `maxRows: 0` empties every stop card and `refreshAfterMs: 0` is a request
     loop; both are misconfigurations, and both are silent. A clamp was rejected because it invents a policy
     nobody wrote and hides the mistake it prevents. A bad field also does not poison its neighbours — one
     deployed typo must not discard five correct values.
  7. **The line is gated mechanically: `scripts/check-vm-no-styling.mjs`.** No wire field name, schema name
     or literal may match `/#[0-9a-f]{3,8}|px$|fontSize|fontWeight|margin/`. Accents cross as **semantic
     tokens** (`accent: AccentToken`), never hex, so each platform maps to its own colour system. It reads
     the emitted `openapi.json` — the surface a native generator actually consumes — rather than the Zod
     source, because the document is structured enough to tell a *field name* from a *documentation string*.
     `description`/`summary`/`title` are exempt: a field's prose must be free to say "the client owns the
     margin", and a gate that flagged its own documentation would be deleted within a week. Wired into
     `pnpm test` via the root `boundaries` script, **not** into CI — there is no PR/push CI workflow in this
     repo (`.github/workflows/` holds only `dataset.yml`; authoring `ci.yml` is WP0-5's job and WP0-5 is
     deferred). Nobody should believe in enforcement that is not there.
- **Why this is worth the endpoint:** ADR-008's honesty thresholds become **one edge deploy instead of three
  store releases**, and they stop being three different numbers. The counter-argument — that this is
  configuration for its own sake, since nobody has asked to change these values — is fair about the *values*
  and misses the *disagreement*: the reason to serve them is that a single served document is the only shape
  in which "how many rows does a stop card show?" has exactly one answer across web, iOS and Android.
- **Consequences / notes for whoever touches this next:**
  - **A rider on Favourites now sees up to 6 route rows, not 4, and gets the "+N more" affordance that
    screen never showed.** This is the visible behaviour change in the wave; it is intended.
  - **`UPCOMING_ARRIVALS` is gone** from `packages/core/src/route-detail.ts`, and `ETA_STALE_AFTER_MS` /
    `ETA_DUE_UNDER_SEC` are gone from `eta.ts`. All three are now `CLIENT_POLICY_DEFAULTS` fields.
    `upcoming`, `etaView` and `isStale` take the value as a trailing optional parameter, so the corpus pins
    both the default and an override — `route-detail#upcoming`'s 8 rows became 9, and `eta#etaView` and
    `eta#isStale` each gained an override row.
  - **The gap that is not yet closed, stated plainly.** `dueUnderSec` and `staleAfterMs` are served and the
    kernel accepts them, but **no screen threads them in yet**: their consumers sit deep inside components
    (`EtaTimes`, `EtaBadge`, `formatRelative`), and wiring them means touching every ETA render path.
    Today this is harmless — the default and the served value are the same number from the same declaration,
    so they cannot disagree. The day someone overrides one on the edge, the web client will silently ignore
    it while a native client honours it. That is a real trap and it is recorded here rather than discovered.
  - **`warnUnderSec` has no consumer at all.** Served deliberately as a forward declaration: the document is
    what a native repo generates its models from, and omitting the imminence threshold invites each platform
    to pick its own — rebuilding the three-way disagreement one platform at a time.
  - **`remarkKind` is served**, on the `sortKey` shape: `classifyRemark` stays the one declaration in
    `packages/core`, the edge *calls* it and stamps the result on all three ETA paths (`/v1/etas/:id`,
    `/v1/stop/:id`, `/v1/route/:id`), and the client falls back to the same function when the field is
    absent. Absent — not `"info"` — when there is no remark, because "the operator said nothing" and "said
    something uncategorized" are different facts. `RemarkTag`'s kind→Tailwind map **stays in the client**:
    that is the client half of this very line. Verified live: a GMB `"Scheduled"` board returns
    `remarkKind: "scheduled"`. *(An earlier draft of this bullet said `remarkKind` was still client-side —
    it was written before the work landed and was wrong for a few hours. Corrected at integration; the
    schema's own `describe()` is the authority.)*
  - **Still client-side, and each is a known follow-up rather than a decision:** `displayName` and `code`
    (composed at ~9 render sites as `titleCaseName(splitStopCode(name).label)`, plus four in
    `route-detail.ts` — deliberately not started rather than half-done, since a served field with nine
    sites still composing locally is worse than none), and the derived fare rules (`fareRange`,
    `fareStages`, `estimateChildFare`/`estimateElderlyFare` — the last two carry recorded defects on `''`,
    so serving them would publish a known-wrong value to three platforms).
  - **The policy can silently fail to arrive and nothing looks wrong**, because the defaults are a complete
    and correct policy. That is the design, and it is also the failure mode nobody would notice, so
    `useClientPolicy` returns a `source: 'served' | 'defaults'` discriminator for a debug readout. Verify
    with `curl -s localhost:8787/v1/policy` — six numbers and a `max-age=300`.
  - **A five-minute window in which an old client binary and a new deploy disagree** — before that client's
    first policy fetch. That is the price of working offline; it is bounded, and the served value always wins
    once it arrives.

## ADR-054 — Design tokens and i18n as generated cross-platform artefacts
- **Status:** **Decided and implemented 2026-07-29** (WP3-1 and WP3-2 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). Like
  [ADR-053](#adr-053--the-line-the-server-owns-content-order-counts-and-text-the-client-owns-layout-colour-and-motion)
  this was a **gap in the sequence**, reserved by the plan and never written. Two work packages, one ADR,
  because they are the same decision applied to two kinds of value.
- **Context:** [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)
  made wire *shapes* agree by construction and [ADR-060](#adr-060--the-fixture-corpus-is-the-equivalence-mechanism-for-domain-rules)
  made domain *rules* agree by a shared corpus. Two categories were left over, and both were **already
  drifting on `main` before any native client existed**:
  - **Design values were written down four times.** The 13 semantic colours lived in
    `packages/ui/src/themes.ts` *and* in two hand-copied `global.css` files; radii and the type scale were
    restated in `preset.js`; `BRAND.ink` appeared as a literal in three further files, including
    `scripts/gen-icons.mjs` and a `<meta name="theme-color">`. `packages/ui/global.css` had **no importer at
    all** — a file kept in step by hand that nothing loaded.
  - **UI strings had no enforcement and prose leaked out of the catalogue.** `packages/i18n` had **zero
    tests and no `test` script**, so it was in no turbo target and nothing about it was ever checked; parity
    was a TypeScript annotation, which catches a missing key but not an untranslated one. Meanwhile
    `apps/mobile` carried an `OPERATOR_LABEL` map, a `HOLIDAY` locale table in `RouteMeta`, and a second
    three-locale table in `lib/tileSource.ts`. Interpolation was hand-rolled `String.replace('{n}', …)`, and
    `formatStopCount(1, 'en')` rendered **"1 stops"** — the last surviving Wave 1 `knownDefect`.
- **Decision:**
  1. **One declaration per category, everything else generated, committed and drift-gated.** Design values:
     `packages/ui/tokens.json` — 122 tokens in DTCG form with a real primitive→alias layer, so `#111827` is
     written once and aliased as brand ink, light text, light accent and focus ring. Strings:
     `packages/i18n/src/catalogue.ts` — 117 keys × 3 locales in an ICU subset, restructured **key-major** so
     the three renderings of one message sit together and a missing translation is visible rather than
     inferred from a diff.
  2. **Generated output is committed, not built on demand.** A reviewer sees it, and a consumer with no
     toolchain — `scripts/gen-icons.mjs` reads the resolved token JSON — can just read it. Fifteen artefacts:
     the TS token module, `preset.js`, `apps/mobile/global.css`, a resolved flat JSON, SwiftUI + Compose
     constants; and for i18n, `.strings`, `.stringsdict` (plurals) and `strings.xml` (`<plurals>`) per locale.
  3. **Zero new npm dependencies, and therefore no `layers.json` carve-out.** `packages/ui/src` and
     `packages/i18n/src` are both in the `tokens` layer with a closed-world `"npm": []`. Style Dictionary was
     rejected as over-engineering for 122 tokens; `intl-messageformat` was rejected because ICU *syntax* is
     what the native artefacts need, not an ICU *runtime* — plural selection goes through the built-in
     `Intl.PluralRules`, which the kernel is banned from but this layer is not. A carve-out here would have
     been the first crack in the rule ADR-051 exists to keep simple.
  4. **`ELEVATION` is platform-neutral at source, and web is a first-class platform.** Shadow geometry plus
     an optional Material dp, with `elevationStyle(level, Platform.OS)` as the single mapping for iOS,
     Android **and** web. The old shape was RN's `ios`/`android` split, and the same split had already been
     re-hand-written for web in `MiniMap`'s `Platform.select` `boxShadow` — the duplication the neutral shape
     removes. Its shadow colour had also been a fifth hex belonging to no token.
  5. **`LocalizedString` is a branded type, enforced at the display boundary.** `t()` returns it and ~25 UI
     chrome props require it, so reintroducing `OPERATOR_LABEL` is `TS2322`. ICU argument names are extracted
     from the message literal **at the type level**, so a missing or misspelled placeholder is a compile
     error, not a `{n}` shipped to a rider. The type is the primary mechanism; a `view` `bannedSyntax` rule
     in `layers.json` is the second net, for the cases types cannot reach — React Native types its own
     `accessibilityLabel` as `string`, so an English literal on a `Pressable` is legal TypeScript.
  6. **The prose boundary: `core` owns the rule, `i18n` owns the word.** Applied to exactly one thing now.
     `formatStopCount` was a pure label with no rule (`${n} ${STOPS_LABEL[locale]}`), so it is **deleted from
     the kernel** with its 5 corpus rows and its `@spec` tag, and is an ICU plural key instead — which is
     what that defect row's own `why` had prescribed. The **other six English label tables stay in
     `packages/core`** (`DUE_LABEL`, `MIN_LABEL`, `EVERY_LABEL`, `ABOUT_LABEL`, `WALK_LABEL`,
     `COMPASS_LABELS`): they are uninflected unit words with no plural rule, a port reproduces them from the
     corpus, and moving them would churn ~100 corpus rows across seven formatters to buy no cross-platform
     guarantee. That is a deferral, recorded here so it is owned rather than rediscovered.
  7. **Language endonyms are a documented exception.** `English` / `繁體中文` / `简体中文` are correct
     *because* they do not follow the active locale — a reader whose UI is Chinese must be able to find the
     word "English". They go through an `endonym()` function rather than three literals, so the exception is
     named in one place instead of tempting a translator to "fix" it.
  8. **Neither gate runs in CI, because there is no CI.** `.github/workflows/` holds only `dataset.yml`;
     authoring `ci.yml` is WP0-5 and WP0-5 is deferred. The plan's *"`git diff --exit-code` in CI"* wording
     describes something that does not exist. Both gates are wired into their package's `test` script, so
     `pnpm test` is the enforcement — stated plainly so nobody trusts a check that isn't running.
- **Consequences:**
  - **The visual result is provably unchanged:** all **26 CSS custom properties are byte-identical to
    `origin/main`**, and `gen-icons.mjs` reading the token regenerated all nine PNGs byte-identically. 122
    values moved with no repaint.
  - **The last Wave 1 `knownDefect` is closed properly.** `1 stop` / `2 stops` / `0 stops` in English, and
    uninflected `1 個站` in both Chinese locales — through a plural rule, not an English special case. **Four
    `knownDefect` rows remain** (in `route-detail`, `mercator` and `stop-detail`), and the brief that started
    this work wrongly called this "the last remaining" one; the agent checked rather than believed it.
  - **Two caching holes were found and closed, both of which made a gate silently vacuous.** `turbo` was
    caching `@nextbus/ui:test` while its gate reads `apps/mobile/global.css` — *outside* the package's hash —
    so a hand-edit of the file the web build actually loads would have replayed a pass; fixed with
    `cache: false` in `packages/ui/turbo.json`. And `.gitignore`'s `ios/`/`android/` rules would have
    excluded the generated native artefacts entirely: the gate would have compared them successfully on the
    machine that made them while a clean checkout had nothing to compare. Fixed with directory negations —
    git does not descend into a directory excluded by an `ios/`-style pattern, so a `**` negation alone never
    reaches them. Both are the same failure: *a gate that passes because it is looking at nothing.*
  - **Swift and Kotlin output is UNVERIFIED.** There is no compiler in this repo and it has never been
    compiled. Both files carry an `UNVERIFIED` banner and are deliberately dumb — constants only — so that a
    fix is a change to the emitter rather than to hand-written code. Compiling them is the first job of the
    first native repo (WP3-3), and until then this ADR claims generation, not correctness.
  - **The brand does not reach data-derived text, and that residual is the deferral in decision 6.**
    `Text`'s `children` are not branded, and an English word concatenated into a `RouteMeta` fact value
    produces no error, because kernel-formatted values are plain `string` and `packages/core` cannot import
    the brand without inverting the layer graph. So the gate covers UI chrome, not every glyph on screen.
  - **`packages/i18n` is now in a turbo target for the first time**, and `packages/ui` gained a `test`
    script it never had. Two packages that were structurally unable to fail now can.
  - A follow-up neither package took: `app.json` and the web manifest still hold `#111827` literally, pinned
    by the gate rather than generated, because templating them is an Expo build change that cannot be
    verified here. The drift is closed; the duplication is not.

## ADR-055 — Content-addressed precompute to KV/R2: the dataset leaves the request path
- **Status:** **Decided and implemented 2026-07-27** (WP0-1 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). Supersedes the "daily crawl
  cron" sketch in [`docs/03`](./03-architecture.md) and the `scheduled` stub, both now removed.
- **Context:** every cold isolate fetched the 8.3 MB consolidated dataset ([ADR-021](#adr-021--citybus-and-kmb-static-data-from-the-hkbus-consolidated-dataset)),
  parsed it (~67 ms of `JSON.parse` alone, measured on an M-series Mac), ran the ADR-042 clustering and kept
  ~20 MB of heap alive, then memoized it. Three separate problems, only one of which is speed:
  1. **Latency.** A cold `/v1/nearby` measured **3.97 s**. Cloudflare recycles isolates constantly, so this
     was not a rare first-request cost.
  2. **Availability.** `data.hkbus.app` was a *runtime* dependency. Their outage became our outage as soon
     as isolates recycled — an availability risk we took on every request for data that changes daily.
  3. **It blocks Phase 2.** Durable Objects get 128 MB each. N instances each holding a 20 MB parsed
     dataset is not survivable, which is why WP5-3 has this as a hard prerequisite, not a nice-to-have.
- **Decisions:**
  1. **The expensive half runs outside the Worker**, in a GitHub Action
     (`.github/workflows/dataset.yml`, daily 19:00 UTC = 03:00 HKT, plus `workflow_dispatch`). It fetches,
     normalizes, clusters and shards; the Worker only ever *reads*. Deliberately not a Cron Trigger: the
     job's cost profile is a build machine's, not an edge isolate's.
  2. **Shards are sliced by what a request needs, not by what the model looks like.** KV holds
     `place:<hash>:<id>` (a place *or* a lone stop, with its members, its routes and the fare at each pole —
     everything `/v1/stop` and `/v1/etas` need in **one** read), `alias:<hash>:<stopId>` (member pole → its
     place, so a bare pole id from a route's stop list still lands on the whole place, ADR-042),
     `route:<hash>:<id>`, and `geo:<hash>:<cell>`. R2 holds `builds/<hash>/search-index.json` and
     `manifest.json`. Measured on the live dataset: 10,118 places · 6,351 aliases · 3,653 routes · 486
     cells, ≈20.6k keys, 2.6 s to build.
  3. **Geo cells carry ranking stubs only** — id, anchor, member coordinates — at 0.01° (~1.1 km). A 500 m
     query reads about four cells, ranks by *nearest member pole* (the walk the rider actually makes), then
     reads only the ≤6 winning place documents. Inlining whole places into cells would have made one cell
     megabytes and pulled a slab of the territory to render six cards.
  4. **Content addressing, and the pointer flips last.** Every key carries the build hash, so writing a new
     build cannot disturb the one being served; `build:current` — the single mutable key — is written only
     after every shard has landed. A crashed run therefore leaves an unreachable orphan, never a
     half-served dataset, and a rollback is one key write. Readers resolve one hash for a whole request, so
     nobody ever sees a mixed build. The hash digests the *shard payloads*, so it moves exactly when what
     we would serve moves; a separate `sourceHash` digests the upstream body so an unchanged day skips
     republishing entirely (KV writes are the metered side of this design).
  5. **`GET /v1/health` exposes `datasetBuildsThisIsolate`, and it must be 0.** The in-request build still
     exists as a fallback — it is what makes `pnpm dev:edge` work against no remote state, and what turns
     an empty namespace into "slow" rather than "down" — so the only thing stopping it quietly becoming
     production's behaviour again is a number we assert on.
     `apps/edge/test/dataset-kv.test.ts` seeds a real build into Miniflare KV/R2, sweeps every endpoint and
     asserts both the counter and that the dataset URL was never fetched.
  6. **Both bindings are optional in the type** (`apps/edge/src/bindings.d.ts`), which is why we hand-write
     `Cloudflare.Env` rather than generating it. Generated bindings are required, and required bindings
     would delete the fallback.
  7. **Response tiering:** `/v1/stop/:id` returns `Route.service` **without** `patterns`; `/v1/route/:id`
     keeps the full per-day-type profiles. `patterns` is read on exactly one screen (the Route fact sheets)
     and duplicating it into every place a route touches was **54 MB of an 82 MB build** — the largest
     interchange document went from 188 kB to 51 kB. A native client should read frequency profiles from
     the route endpoint.
  8. **One id-resolution rule everywhere.** A bare member pole id now promotes to its place on
     `/v1/etas` too, not just `/v1/stop` — previously `/v1/etas/<pole>` returned that pole alone. Safe to
     change now (`watch()` is its only caller and has none of its own), and the alternative was two
     resolution rules for the same id space. Relatedly, a **stale `P:` id** — a favourite saved before a
     reclustering — resolves through its first member to the *current* place rather than 404ing. That is
     a stopgap; the favourite id scheme itself is WP2-5's to fix.
  9. **Two guards the review added, both worth stating because neither is obvious.** `/v1/nearby`'s
     `radius` is now **clamped to 50–2,000 m**: post-sharding it decides how many *KV keys* a
     request reads (one per cell, quadratic in the radius), so `radius=50000` would have fanned out
     to ~8,000 concurrent reads and blown the subrequest limit — a remote amplification from one
     query parameter. And the publisher distinguishes *"there is no current build"* from *"we could
     not read it"*: collapsing those would make a transient wrangler failure look like a first-ever
     publish, and the prune would then delete the build that was live seconds earlier.
- **Measured result:** cold `/v1/nearby` **3.97 s → 0.74 s**; warm 6 ms; `datasetBuildsThisIsolate` 0 across
  a full endpoint sweep. The upstream dependency moves from every request to once a day.
- **Consequences / open:** the *source* is still the hkbus consolidated dataset — an own crawl of the
  operator APIs remains a backlog item, and is now a change of one build script rather than of the Worker.
  ≈20.6k KV writes per publish is ~600k/month if the data changes daily, inside the paid plan's 1M included
  writes and reduced further by the `sourceHash` skip. The pipeline has been verified end to end against
  Miniflare-local KV/R2 but **not** yet against real remote resources — the namespace id in `wrangler.toml`
  is still a placeholder.

## ADR-056 — The live protocol: frames, a sharded hibernating `EtaHub`, and what we could not verify
- **Status:** **Decided and implemented 2026-07-30** (Wave 5: WP5-0 … WP5-3), **extended 2026-07-31** with
  decisions 13–19, which an adversarial review over the finished diff forced. Implementation:
  `packages/contract/src/wire/live.ts` + `asyncapi.json` (emitted, committed, gated) ·
  `packages/core/src/live.ts` + `spec/live.spec.json` (row counts live in the generated table,
  `packages/contract/README.md` §6 — no document restates them by hand) · `packages/ports/src/live-transport.ts` ·
  `packages/api-client/src/live/{engine,poll,memory,socket,controller}.ts` + `src/endpoint.ts` ·
  `apps/edge/src/{live,eta-hub}.ts` · `apps/mobile/lib/useLiveEtas.ts` ·
  `scripts/check-view-transport-free.mjs` · `scripts/check-one-endpoint-declaration.mjs` ·
  `.github/workflows/ci.yml`. **Not deployed** — WP0-5 still owns that, and several claims below say so.
- **Context:** [ADR-004](#adr-004--data-strategy-pull-only-normalize-at-the-edge-no-scraping) has promised
  since v1 that swapping the polling client for a socket engine would not touch the UI, and
  `DataSource.watch()` existed to make that true. It was a shim that concatenated whole ETA lists on a timer,
  and — the fact that decides this ADR's shape — **it had no callers at all.** So WP5-2's acceptance
  (*"substitute a `FakeSocketDataSource`; `git diff --stat` shows zero lines changed under
  `apps/mobile/app/**`"*) was zero by construction: nothing under those paths reached the seam, and nobody
  edits a screen while running a test. That is [WP4-0](#adr-068)'s situation again — an acceptance
  presupposing an artefact that does not exist — and it is why Wave 5 starts with an unplanned **WP5-0**:
  give `watch()` a real consumer first, then measure the substitution. Two further inputs: `docs/03`'s Phase 2
  sketch said one Durable Object per stop on a 10–15 s alarm, which the plan's own cost model had already
  refuted; and the frames had to be *declared* somewhere, which raised the question of whether AsyncAPI is
  the OpenAPI story again. It is not, and §"AsyncAPI, honestly" is that answer.
- **Decision:**
  1. **Six frames, and the listener's output is canonically ordered.** `subscribe` · `ping`/`pong` ·
     `snapshot` · `delta` · `status`, declared once in Zod beside every other wire shape and published as
     `asyncapi.json`. The reducer sorts the session's readings by `(stopId, routeId)`, code-point, no locale.
     **Without a canonical order the two transports diverge by construction**, and WP5-1's acceptance
     ("byte-identical listener output from the poll emulator and a memory fake") is unmeetable by *any*
     implementation: the poll emulator's order is whatever `/v1/etas` returned, while a delta protocol that
     merges in place and appends new keys has a history-dependent order. Same lesson as
     [ADR-063](#adr-063--the-search-indexs-order-is-data-a-precomputed-sortkey-range-scans-a-content-hash-version-and-an-etag)
     — *the order is data*. Nothing is lost, because display order is `stopCardView`/`nearbyView`'s job and
     already in the kernel. **The negative result is the proof:** reversing both the target order and each
     pole's reading order inside the poll emulator changed **nothing** — 17 of 17 matrix rows still passed.
     The thing that would break byte-identity is the kernel losing the sort, not a transport choosing its own.
     One deliberate exception: `applyLiveEtasToNearby` orders soonest-first, because `stopCardView` caps a
     card by taking the first `maxRows` readings, so that order decides *which* buses a rider sees.
  2. **`delta` can say `gone`, and the client must honour it.** Polling replaces the whole payload, so a
     departed bus disappears for free; a delta protocol strands it, and the last reading for a route would sit
     on screen for ever. That is precisely the silent staleness
     [ADR-008](#adr-008--eta-honesty-approximations-never-fake-precision) forbids, so `gone` is not an
     optimisation but the rule that makes the protocol legal. It carries `EtaRef`s — `(stopId, routeId)` —
     and its documented meaning is *"the bus departed, **or** the target was dropped"*, which is what lets a
     rejected favourite blank rather than freeze.
  3. **Frame identity reuses the route-at-stop grammar, and the server had to be corrected to serve it.**
     `(stopId, routeId)` is the same tuple `formatFavoriteRouteKey` encodes
     ([ADR-062](#adr-062--the-favourite-key-is-the-member-pole-and-the-scheme-is-versioned)), so a Widget
     watching a favourite maps 1:1 onto a live target and no second key spelling is minted. Building the first
     real consumer found that **`Eta.stopId` carried the operator's own raw stop id** (`6AB438AD3AE100DD`)
     where its own schema declares the identity canonical (`KMB:6AB438AD3AE100DD`). Every *reader* of the pair
     therefore compared two alphabets and matched **nothing, always**: at a three-pole Mong Kok place,
     `/v1/stop` served 21 route rows of which 8 carried a reading, and one second after paint the
     subscription's first snapshot merged and **0 survived**. Fixed on the server (`memberEtaLists` stamps
     each pole's readings with that pole's canonical id, on new objects, because `coalesce` hands the same
     array to every concurrent caller), which repairs `/v1/etas`, `/v1/stop`, `/v1/nearby` and the shard's
     frames at once. **No wire shape changed.** Four waves of gates could not see it: `stopDetail` attaches
     readings by `routeId` alone, `/v1/nearby` hands a place its own readings by construction, the
     conformance test asserts the field is a `string`, and **every fixture in the repo — including the
     kernel's corpus — wrote the canonical spelling the contract asks for.** The corpus agreed with the
     contract, the server disagreed with both, and no suite spanned the two. `Eta.stopId` was also the only
     field of `EtaSchema` with no `.describe()`, which is how the ambiguity survived; it has one now.
  4. **No frame carries an engine label.** A `snapshot` from the shard and a `snapshot` synthesized by the
     poll emulator are the same bytes. Anything else would make the two transports differ *by construction*
     and quietly retire the equivalence the wave exists to prove — and a screen that could tell would grow a
     branch on it. The label exists on the `LiveTransport` (a custom transport must answer *"which engine are
     you"*), never on the wire.
  5. **Two failure rules, stated once and implemented twice: a failed round is not a departure, and an
     unchanged round is silent.** A target whose fetch fails keeps its previous readings — reporting them
     `gone` would say the bus had left when we merely could not ask — and a round in which nothing changed
     sends **no frame at all**, not an empty `delta`, which is both what makes "an unchanged round" a
     meaningful test row and what a shard on the 20:1 incoming-message meter should do. Both are expressed as
     per-target bookkeeping rather than as a fallback, so no rule is invented: a target we did not hear from
     simply has unchanged state. **Nothing binds the two implementations** — see §"What is not done".
  6. **`state` describes the connection; `error` describes the thing the message names.** A per-target
     rejection is `state: 'live'` with a permanent error beside the snapshot whose echo says which targets
     survived; an accepted set that came back empty is `state: 'closed'` with a permanent error, which is
     terminal; an empty `subscribe` is `closed` with **no** error, so the client may re-subscribe. This is a
     contract clarification as much as a code fix: the socket transport originally treated *any*
     `retryable: false` as terminal, so **one stale favourite silently killed live arrivals for every stop a
     rider had**, permanently, with the socket reporting itself healthy. `WireError.retryable` is documented
     as *"whether the identical **request** may succeed later"*; what describes the connection is
     `StatusFrame.state`, and only `closed` plus a permanent error means *never*.
  7. **One socket per client, and the *server* computes the shard.** The client connects to
     `/v1/live?targets=<percent-encoded canonical ids>` and the **Worker** hashes the accepted, sorted target
     set (FNV-1a over the lowest id, `% LIVE_SHARD_COUNT`, 8 today) with the kernel's `liveShardFor`. Sharding
     by *stop* would poll a hot stop once but need up to six sockets for a rider watching six places, which
     defeats the battery argument that is the whole UX case for Phase 2; sharding by *client* keeps one socket
     and lands everyone watching the same places on the same shard, which is the case that matters. Having the
     server hash it **deletes an agreement surface**: a client with a stale shard count would otherwise
     compute a different shard and nothing would say so. **The cost we accept, observed rather than
     predicted:** two clients whose target sets only *partially* overlap land on different shards and the
     shared stop is polled once per shard — measured while writing the tests, where the same place answered
     `etas=6` on the shared shard and `etas=0` on the other. Bounded by the shard count, and it only ever
     duplicates upstream reads, never rider-visible state.
  8. **One URL per renderer, and the socket URL is derived from it — so Wave 5 adds no new required
     variable.** `liveSocketUrl` (corpus-pinned, in the kernel) maps `http:`→`ws:` / `https:`→`wss:` and
     appends `/v1/live`. It is a kernel rule rather than three lines in three shells because the
     `https:`→`wss:` half is the mistake that ships a rider's location and favourites in cleartext, **works
     perfectly against `http://localhost:8787`, and shows no symptom anywhere.** The base URL itself now has
     exactly one declaration, `DEFAULT_API_URL`, down from four copies under two variable names across three
     build systems — with `scripts/check-one-endpoint-declaration.mjs` in the `pnpm boundaries` chain, because
     "one declaration" is the kind of rule this repo gates rather than trusts. An optional
     `EXPO_PUBLIC_LIVE_URL` / `VITE_LIVE_URL` override exists for the one case derivation cannot cover, a
     socket tier on another host; **nothing reads it yet** (§"What is not done").
  9. **The `Origin` check is browser-only and advisory, and the default is off.** A missing `Origin` is
     always allowed; with `LIVE_ALLOWED_ORIGINS` unset there is no filtering at all; set, it refuses browser
     origins outside the list at the handshake. Three facts force this shape, all from RFC 6455 and none from
     CORS: a WebSocket upgrade **is not a CORS request** (no preflight, and the browser ignores
     `Access-Control-Allow-Origin`, so the `*` this Worker sends on every `/v1/*` response neither grants nor
     restricts anything here); §4.1 requires the header only *"if the request is coming from a browser
     client"*, and React Native's `WebSocket` omits it by default, so **rejecting an absent `Origin` would
     break exactly the iOS and Android clients this design exists for** while protecting nothing; and
     therefore it is never authorisation, because any non-browser client sends any `Origin` it likes. What it
     does do is stop a page on another site from opening a socket with a rider's browser doing the connecting.
     **Three things would actually protect this endpoint: this check (exists, off), Cloudflare rate limiting
     at the zone (does not exist — it needs the custom domain WP0-5 has not created), and the DO's own caps
     (exist).** So the endpoint is unprotected today, and the caps do not change that; they stop one
     *connection* from amplifying, not one script from opening many. One protocol limitation worth knowing:
     a refused upgrade's taxonomy body is **unreadable by a browser** — the WebSocket API exposes neither
     status nor body — so the readable rejection path is the snapshot's echo and `status` frames, and the
     envelope is for `curl`.
  10. **Five caps, each bounding a different quantity, none tuned against a measurement.** 12 targets per
     connection · 48 targets per shard · **12 CTB routes per place per round** · 64 sockets per shard · 8 KiB
     per client frame. (It was four until the shard cap's arithmetic was measured; the CTB budget is the term
     that decides a round's fan-out and it had no cap at all — see below and decision 15.) A `subscribe` frame is
     [ADR-055](#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)'s
     `radius=50000` amplification with a longer lever — it names an unbounded list of stops, each costing a
     place read plus a coalesced upstream call *every round, for as long as the socket is open*. Each cap
     carries its arithmetic in the code, and the shard cap's was **corrected in 2026-07 after being
     measured** rather than estimated from the fixture: the fan-out is dominated by CTB, which has no
     per-stop board (ADR-021) and so costs one call per *route* rather than per pole. Over the shipped
     dataset the 48 heaviest real places cost **1,342 upstream calls at the read path's default CTB budget
     of 24** — ≈67 s of queued fetching at six simultaneous outgoing connections, *past* the 45 s cadence
     floor — not the ≈100–150 calls / ≈6 s first published here. So a round passes the DO's own
     `LIVE_CTB_BUDGET = 12`, as `/v1/nearby` already did, and the same 48 places cost **785 calls ≈ 39 s**,
     inside the floor. **39 s against a 45 s floor is not a comfortable margin, and is stated rather than
     rounded:** if either the cap or the cadence moves, that is the number to recompute, and
     `apps/edge/test/eta-hub-caps.test.ts` is what holds the budget itself in place. (8 KiB keeps a
     canonicalised session inside half of the attachment's 16,384-byte
     limit; that one was right.) Excess targets are **rejected and named**, never truncated
     silently, because a socket watching half a rider's list is the silent filter ADR-008 rules out. **The
     trade we accept: a cap is itself a lock-out vector** — 64 sockets from one script would refuse the 65th
     rider on that shard. The values sit far above plausible legitimate concurrency and far below the
     runtime's own 32,768, and the real answer is zone rate limiting, i.e. WP0-5.
  11. **Per-connection state lives in the socket's attachment; the alarm cadence and the readings live in
     SQLite.** Hibernation discards in-memory state, so an instance field is not storage — and the failure is
     not subtle: re-injected as an instance field, 13 of 22 tests fail, because `fetch` and `alarm` reach the
     object as separate invocations and the field is already empty on the very next round.
     `[[migrations]] new_sqlite_classes` rather than the newer declarative `[exports.EtaHub]`: the two are
     equivalent for dev and deploy, but `wrangler versions upload` fails fast when `exports` entries are
     present, gradual deployments are unsupported across its lifecycle changes, a rollback cannot cross one,
     and the move is one-way. Nothing has ever been deployed from here, so giving up versions, gradual
     rollout and rollback **before the first deploy** is the worse trade. (`new_classes` was never an option:
     the key-value backend is Paid-only and closed to new accounts.) This one constrains WP0-5.
  12. **The Durable Object holds no rules.** The diff is `diffEtas`, the cadence is `nextLiveCadenceMs`, the
     shard is `liveShardFor`, the accepted set is `acceptTargets` — and the *union* of two subscribers'
     narrowings is `acceptTargets` again, whose documented union semantics ("if either asks for all routes,
     the merge asks for all routes") turned out to be exactly a shard's poll set. Nothing in `eta-hub.ts`
     decides anything a corpus could pin, which is the property that makes the server side portable evidence
     rather than a second implementation of the protocol.

  **Decisions 13–19 were forced by an adversarial review over the finished diff (2026-07-31).** Six
  read-only finders raised 28 candidates; three skeptics, one per area, judged 25 and **confirmed 13**. Most
  of the 13 were repairs and are in the commit log; the seven below changed what this ADR *decides*, and each
  is recorded with the defect it prevents rather than with the diff that closed it. Two facts about the
  review itself belong in the decision record, because they are the reason the wave's own gates did not
  substitute for it: **every one of the 13 was in code that passed `typecheck`, `test`, `lint`, `boundaries`
  and a `--dry-run` bundle**, and **three were regressions that arrived by *removing* a line** — a served
  threshold that stopped being in force, a failed first load that became permanent, and a freshness cue that
  could never fire. Nothing in this repo can see a deletion whose loss is a behaviour.

  13. **A boarding point is part of a route row's identity: `operator|routeNo|bound|stopId`.** (The owner's
     call, 2026-07-31, chosen from three options.) `dedupeRoutes` discarded the pole on a comment claiming it
     was noise. It *is* noise for KMB and Citybus — CTB 969 appears three times at one pole, all bound for
     Causeway Bay, timetable variants of one bus, and those share a pole so they still collapse — and it is
     **identity for GMB**, where numbers repeat: at Tai On Street `GMB:20:outbound:2002320` boards at one pole
     for Chai Wan (Fung Yip Street) while `GMB:20:outbound:2002319` boards at another for Chai Wan Industrial
     City, both circular so both "outbound" on every leg, so direction could not separate them either. Fused,
     the second destination was never shown, and where 20 was a pole's only route **the pole's whole group
     vanished from the list while its dot stayed on the map — 21 poles emptied in the 2026-07-27 build.** This
     ADR owns the fix because the live protocol is what made it visible: `/v1/etas/:id` dedupes across the
     whole place keeping the sooner arrival, so the merge could fill only one of two poles' rows, and
     `dedupeRoutes` picked its survivor *by which row has a reading* — so the surviving row's destination
     text, its lit map dot and its scroll target followed the sooner kerb and **moved as buses departed**
     (measured against live upstream: GMB 68K publishing at both poles 11 s apart, and a pair flipping between
     "Kai Ham" and "Ho Chung"). **The corpus had pinned the defect twice and argued both ways:** one
     `knownDefect` row's `why` prescribed exactly this key, and a second row pinned the *flip* as intended
     behaviour — that one is renamed and now pins the fix, exercising both halves of the key at once (same-pole
     variants still collapse, the second pole keeps its own row). `knownDefect` rows 4 → 3. Two costs stated
     rather than smoothed over: Tin Shui Wai Park's two members both print the stop code **TN510**, so 269D
     now renders twice under headings that look identical (**WP5-10** — a heading is the wrong thing to fix by
     fusing two services); and the edge still dedupes across poles, so at most one of a line's poles can carry
     a reading. That residual is the canonical model **under-normalising**, not a client bug: the model's unit
     of *an arrival* is (line, place) while its unit of *a row* is now (line, pole), and they have to be the
     same unit — the pole is the one a rider walks to. **WP5-9.**
  14. **A failed *first* round is not an empty world, and "nothing" includes a permanent rejection.**
     Decision 5's rule held from round **two**: the poll emulator's `seq === 0` branch published whatever came
     back, so a first round in which every request threw sent `snapshot { etas: [] }` — the frame that means
     *this stop has no arrivals*. The Place screen paints minutes from its own `/v1/stop/:id` fetch and then
     blanks one frame later, because `applyLiveEtasToStopDetail` nulls a row it cannot match (correctly — that
     is `gone`'s honesty rule); the `retrying` status that would explain it cannot reach a listener whose
     signature is `Eta[]`; and since WP5-0 the screen no longer polls while its query succeeds, so nothing
     repaired it for a whole cadence. Worse, the blanked document is still `status: 'success'`, which is
     exactly what ADR-058's persister dehydrates, so an offline start replays the blank instead of the
     arrivals the persister exists to keep. A round that learned nothing now sends nothing and `seq` stays 0.
     **The decision is in what "learned nothing" excludes**, and the first cut got it wrong: suppressing the
     snapshot whenever no target *answered* also took the echo away from the case that needs it most — a
     target rejected `retryable: false` leaves the watch set, and the empty snapshot is then not a claim about
     buses but the accepted-set echo saying *we are not watching what you asked for*, the only signal a rider
     gets that a saved favourite has stopped resolving. The corpus row that exists for that shape went red.
  15. **A full shard rejects targets; it does not refuse riders — and cap excess is `internal` /
     `retryable: true`, never `bad_request`.** `LIVE_MAX_TARGETS_PER_SHARD` was read at exactly one site, the
     upgrade, and a `subscribe` frame reaches the same state without passing it. That frame is the *normal*
     path — per-stop route narrowing, and `socket.ts` sends a changed target set on the open connection rather
     than reconnecting — so the real bound was `LIVE_MAX_SOCKETS_PER_SHARD × LIVE_MAX_TARGETS_PER_CONNECTION`
     = **768**, sixteen times the documented one, and the `readings` table's stated "≤ 48 rows" went with it.
     The refusal was also a lock-out: once any five sockets had pushed a shard past 48, every subsequent
     *legitimate* upgrade got `500 shard is at capacity` — a status and a body the browser WebSocket API
     exposes to nobody, classified retryable, which `socket.ts` then reconnects on for ever. **One anonymous
     script could take a shard's stops away from every rider watching them, and their whole experience of
     those stops would be a reconnect loop.** So the cap moves to `subscribe()`, the one path every
     subscription takes (the upgrade calls it too), and is applied through the rejection mechanism decision 10
     already promised: sliced greedily in canonical order so `fits[0] === kept[0]` and a capped connection
     stays on the shard `liveShardFor` routed it to, and counted with the kernel's `acceptTargets`, so a
     target naming a stop somebody already watches costs the shard nothing and is not refused — which is the
     case the whole sharded design exists for. **The taxonomy is the decision, and it is not the obvious
     one.** `retryable: false` is the wire's instruction to *prune*: ADR-052's own reasoning is that a Widget
     holding a deleted favourite must be able to drop it permanently. A full shard is **our** fault and the
     rider's stop is perfectly fine, so the excess goes out as `internal` with `retryable: true`, in a second
     `status` frame — the same argument the refused upgrade already made for the same condition, kept rather
     than deleted along with the refusal.
  16. **The hook that replaces a screen's `refetchInterval` returns the screen's clock.** `refetchInterval`
     did two jobs and only one was obvious: it fetched, and it **re-rendered** — and a screen's
     `const now = Date.now()` advances only when something re-renders it. WP5-0 deleted it and took the clock
     with it. A round in which nothing changed calls no listener (decision 5, deliberately),
     `useClientPolicy` has a `staleTime` and no interval, and `refetchOnWindowFocus` is `false`, so on a quiet
     stop nothing re-rendered at all and `etaReadout`'s `stale` flag — the one cue that says *these times have
     stopped arriving* — could never fire. Two minutes after the last reading, one minute before the bus was
     due, the screen still read "4 min" with no hint that anything had stopped: the
     [ADR-008](#adr-008--eta-honesty-approximations-never-fake-precision) failure the whole honesty design
     exists to prevent, introduced by removing a line. **Only one of the two halves is a bug**, and separating
     them is the decision: the *label* ageing on a coarse cadence is what riders have seen since v1 and is not
     the countdown ADR-008 forbids — that rule bans fabricated precision, not arithmetic on a timestamp we
     were handed — while the *stale flag never firing* is the regression. Both ride on one mechanism, a `now`
     that moves, so `useLiveEtas` returns the tick, on the served `refreshAfterMs`. Not a separate `useNow` a
     screen must remember to call: converting a screen off `refetchInterval` is precisely the moment its clock
     stops, and a hook that hands the replacement back cannot be half-adopted. A grep-level gate asserting
     *"calls `useNow`"* would not have helped either — it passes on a screen that calls it and then reads
     `Date.now()` anyway, the same *referenced is not rendered* trap that killed WP4-1's cheap gate. Recorded
     and not fixed: nothing pauses the tick while the app is hidden, exactly as three surviving
     `refetchInterval`s already do not — a battery question for whoever adds visibility handling, and one more
     argument for the socket.
  17. **The two engines must re-echo a mid-stream drop identically, and only a `snapshot` can.** A `delta`
     cannot restate membership, because only `SnapshotFrame` carries `targets`. When a round drops a target
     permanently the shard therefore sends a corrected snapshot in place of the delta; the poll emulator's
     re-echo was gated on `seq === 0`, so after round one it sent a delta. Same upstream, two different
     clients: the socket client learns the set shrank while the poll client keeps an accepted set naming a
     pole nobody polls, and its rider is then shown "no buses due" for a stop we are not watching — the silent
     filter ADR-008 rules out, and the exact thing `SnapshotFrame.targets` exists to prevent. Both engines
     re-echo now. **The honest part is why no existing test could catch it:** the scenario matrix's
     `summarize()` reports status and readings, and both engines reduce a permanent drop to the same readings,
     so the row that exercises this passed before and after — and adding `targets` to `summarize` would have
     turned it green while *asserting the stale echo*, because the scripts are hand-written to describe one
     engine. That is the limit of comparing two engines against a script rather than against each other, and
     it is what **WP5-5** buys. The assertion is a separate test driving both engines through one drop.
  18. **The accepted-set echo has a reader, and it stops at the controller rather than at `EtaListener`.**
     The contract says in as many words what a client does with `SnapshotFrame.targets` — *"compare it with
     what you sent and tell the rider about the difference"* — and nothing could: `applySnapshot` returned
     `{ seq, etas, status }` and dropped the field, so on all three platforms the one comparison the field is
     published for was unperformable, while both producers deliberately send no other signal for a target
     they refused. Reachable today, not hypothetical: ADR-058's persister rehydrates a `['stop', <id>]` entry
     as `success`, so a pole saved under a pre-ADR-062 id makes the subscription's `enabled` true while
     `acceptTargets` rejects the same id; the emulator then sends `snapshot{targets: [], etas: []}` +
     `closed`, every row nulls, and the screen reads "no buses due" for a stop nobody is watching — which
     reads as a data outage rather than as a stale favourite. `LiveSession` gains `targets`, carried through
     `LiveEtaUpdate` to the controller's holder, and it is kept **verbatim, never re-derived**: a client
     filtering the server's answer through its own `acceptTargets` is the reason `?targets=` goes out
     unfiltered in the first place. `EtaListener` is **unchanged**, because ADR-004 fixes `watch()` at
     `(targets, onUpdate) => Subscription`; the comparison belongs to a caller holding a
     `createLiveEtaController`, which is what `useLiveEtas` becomes when Favourites adopts it. **Whether to
     *display* the difference is a product question with an i18n key attached and is deliberately not decided
     here:** "not updating" is true and says nothing about why, "this stop has moved or closed" is a claim
     about the world a parse failure cannot support, and "remove it?" is an action needing a confirm and a
     store write. Five corpus rows had pinned the discard without arguing for it and now assert the
     carry-through. `SnapshotFrame.targets` also comes **off** the reader-less-field register at the end of
     this ADR: that list is `SnapshotFrame.at` / `DeltaFrame.at`, and now nothing else.
  19. **The reconnect schedule is a kernel rule; the timer is not.** `packages/ports/src/live-transport.ts`
     asserted that the reconnect policy *"is a policy three platforms must not each invent, and it is written
     down once in `createSocketTransport`"* — two paragraphs below a table naming `URLSessionWebSocketTask`
     and OkHttp as the iOS and Android implementations, neither of which can read TypeScript. So on the two
     platforms the port exists for, the policy was written down nowhere. This repo's own argument settles
     which layer owns it, turned around: `nextLiveCadenceMs` is **server-only**, has one consumer, and is a
     kernel export with twelve corpus rows on the ground that a hand-port would otherwise transcribe an
     unexplained integer — so a *client* rule all three platforms reconnect by has a stronger claim than that,
     not a weaker one. `liveReconnectDelayMs` and its four constants are kernel exports with 24 corpus rows;
     `jitter` crosses as a **number, not a callback**, because a rule the corpus cannot state is a rule three
     platforms will each invent; and every fallback leans one way — an attempt below one is treated as the
     *first* attempt, because an exponent of −1 makes the first retry faster than the initial delay, i.e. a
     tight loop against a server that has just dropped us. The **scheduling** stays in
     `createSocketTransport`, where a test can watch the second attempt happen at the right moment, and
     `SocketBackoff` stays as the injection point.

  **Also confirmed and repaired, recorded here because two of the three were published claims.** The
  allowlist in `check-view-transport-free` exempted a *line* rather than a rule — the matcher compared file
  and snippet and never `pattern.id`, so a `fetch(` or a `new WebSocket(` sharing a line with `/v1/tiles/`
  in `tileSource.ts` was silently allowed — and its selftest had **never executed the matcher at all**:
  sixteen green fixtures over code nothing ran. A policed directory that stopped existing dropped out in
  silence, while the success line went on printing "5 policed dirs" (`POLICED.length` is directories
  *listed*); renaming `apps/web/src/` took the file count 74 → 60 with nothing reported, and that
  directory's whole purpose is proving the kernel renderer-agnostic. And `asyncapi.json`'s first paragraph
  claimed the two documents *"share `components.schemas` byte for byte"*, which is false for **34 of 34**
  shared schemas — `$id` on all of them and `Eta`/`RouteDetail` structurally, because of the `$ref`-sibling
  fold recorded in §"AsyncAPI, honestly". The emitter said so itself 85 lines above the claim; only the
  sentence a native author reads *first* was wrong.

- **The cadence is 45–60 s because of the data, not because of the cost.** The plan rested it on *"a 10–15 s
  alarm makes the DO more expensive than polling"*, and **that argument does not survive sharding** — once
  one object serves many stops, the marginal cost of a 15 s alarm over a 60 s one is ≈**$10/month per 1000
  continuously-hot stops** (2.59M extra ticks × $0.15/M requests, with `setAlarm` row writes comfortably
  inside the 50M included), so cost would not decide it. The data does. Measured 2026-07-30, ~10:46–10:50
  HKT, `GET https://data.etabus.gov.hk/v1/transport/kmb/route-eta/1A/1` every 10 s, 20 samples: distinct
  `data_timestamp` values arrived at **mean 44.75 s** (179 s over 4 intervals), range **28–60 s**. A 45 s
  alarm is already at the data's own floor; a 15 s alarm returns a byte-identical body roughly two ticks in
  three. Two further observations from the same run make the case stronger than "wasteful": every response
  carried `Cache-Control: max-age=300` with **no `Age` header**, and `generated_timestamp` **went backwards**
  across consecutive polls (10:49:11 → 10:48:59 → 10:49:11) — independent CDN edge copies, so a faster poll
  can return an *older* generation than the one before it. Polling faster is not merely wasteful; it is
  non-monotonic. **This is n=1 route on one off-peak weekday morning: a first measurement, not a
  characterisation.** Peak hour, CTB and GMB are unmeasured, and the ramp (45 s floor → 60 s ceiling over 3
  quiet rounds) is a *policy* fitted to that one measurement rather than a derived optimum. Recorded because
  the alternative is inheriting the figure as settled. Real frames from `wrangler dev` against the live KMB
  feed came out at +0 s, +45 s, +91 s with six readings changing on every round — the floor holding and the
  ramp never widening, which is the rule working rather than a bug.
  **Corrections to the plan's cost model, which is cited more often than it is checked:** its polling column
  says *"today, 20 s"* when `CLIENT_POLICY_DEFAULTS.refreshAfterMs` is **30 s** (ADR-053), so every request
  count in it is 1.5× too high and the 100k-DAU overage is $15, not $24; its *"crossover lands around
  40–45k DAU"* is not reproducible (≈37k from its own inputs, ≈56k at the real cadence) and rests on an
  unstated *"10 active minutes per user per day"*; its four DO cells show no working and omit the
  $12.50/M GB-s duration rate, `setAlarm` row writes and connection requests, so they are **UNVERIFIED**;
  and its heading *"Measured/verified inputs"* overclaims — the Cloudflare figures are vendor-published
  rates (verified against the pricing pages on 2026-07-30, several of which moved when SQLite storage
  billing went live in January 2026), not measurements taken here. Also: the *"upstream refreshes ~1/min"*
  claim is cited across this repo to `docs/01` and ADR-008, and **neither document contains it** — the real
  citation is the KMB vendor specification (`docs/02:23-25`) plus the measurement above.
  **What the meters actually charge, since the design leans on it:** one client connection is two billed
  requests (one Workers, one DO), full price; *outgoing* messages — the entire ETA fan-out this design exists
  to send — are **free**; *incoming* messages are billed 20:1; incoming protocol pings and
  `setWebSocketAutoResponse` replies are free and do not wake the object. So **reconnect churn, not message
  volume, is the cost of a socket**, which is why the client's keepalive is the contract's exact
  `LIVE_PING_MESSAGE` bytes (a one-byte mismatch would wake a hibernated shard on every ping, turning a free
  idle connection into one billed around the clock) and why the reconnect backoff caps at 30 s, below the
  shard's own cadence.

- **AsyncAPI, honestly — a specification artefact with a validator, not a codegen input.** This paragraph
  exists because the alternative is a future agent inheriting a claim of codegen that was never true.
  **(a)** AsyncAPI 3.0's Schema Object is a superset of **JSON Schema draft-07**, not 2020-12 — `2020-12`
  appears nowhere in the 3.0/3.1 specs or either meta-schema, and the issue asking for it was closed stale in
  2022. Our schemas are *emitted* as 2020-12 by zod, so the document **asserts draft-07 over bytes generated
  as 2020-12**; that is recorded in an `x-json-schema-dialect` root extension and made true by a gate that
  fails on any keyword outside the intersection (`prefixItems`, `$defs`, `unevaluated*`, `$dynamicRef` …).
  So: one registry, yes; one dialect, no. **(b) There is no AsyncAPI→Swift generator in existence.** Modelina
  outputs twelve languages and Swift is not among them; a sweep of the tools directory found nothing
  mentioning Swift, Objective-C or iOS in any category. **(c)** Kotlin generation exists and **cannot
  serialise** — JSON, XML and binary serialization are all listed as unsupported — so `generate models kotlin`
  yields annotation-free data classes and the decode layer is hand-written anyway, which puts ADR-052's
  unknown-enum-tolerance obligation back on hand-written code on Android too. **(d) `asyncapi diff` is not an
  `oasdiff` equivalent:** it compares the dereferenced document leaf-by-leaf with JSON Patch and classifies
  by pointer prefix, and a payload field pointer matches no standard entry — so **removing a field classifies
  as `unclassified`, not `breaking`**, and a gate that failed on `breaking` would go green on a deleted field.
  Our own staleness gate says exactly that in its failure text, because the review is the mechanism here, not
  a tool. **(e)** The gate **transcribes** the meta-schema's closed field lists rather than validating against
  it: `@asyncapi/parser` was not added, so **`asyncapi.json` has never been validated against the official
  meta-schema by anything**, and both the script header and `packages/contract/README.md` §7 say so. The
  denial of numeric `exclusiveMinimum`/`exclusiveMaximum` is marked *unsettled* in the gate for the same
  reason — draft-07 §6.2.3 specifies them as numbers, which suggests the scout's note was wrong, and we emit
  neither keyword, so the first person who needs a bound settles it with a citation.
  Two emit decisions belong with this: **`$ref` siblings are folded in the AsyncAPI emit, not in
  `openapi.json`** (a Reference Object drops sibling keys, and four `$ref`-with-`description` sites would have
  silently lost their notes — including `Eta.remarkKind`'s absent-vs-`"info"` trap, the single most
  consequential field note in the contract), and **`seq` is `z.number().int()`**, which puts the first numeric
  constraints (`±9007199254740991`) into the published contract deliberately: `type: integer` is what stops a
  generator typing a monotonic counter as a `Double`, and the bounds are true of the producer.

- **What we could not verify, said where a reader meets it.** Three things in this wave are unfalsifiable
  locally, and each says so at its own site as well as here.
  1. **That workerd *chose* to hibernate a shard.** What is proved outright is the *consequence*: the object
     calls `ctx.acceptWebSocket` and registers no `'message'` listener, so a client frame that is answered at
     all was dispatched to `webSocketMessage()`; and after `evictDurableObject(stub, { webSockets: 'hibernate' })`
     the reconstructed instance still has the socket attached, recovers the exact accepted target set from
     `deserializeAttachment()`, continues the cadence ramp at **55 s** (a fresh counter would restart at the
     45 s floor) and still delivers a `delta`. But `evictDurableObject` is an explicit call into
     `workerd:unsafe`; there is no local knob for the inactivity threshold and nothing hibernates
     spontaneously inside a test's lifetime. So the suite covers hibernation's consequence and **not its
     policy**, and the test is named for what it does — *"rebuilds the subscription from the attachment and
     the ramp from storage, on a cold instance"* — rather than "hibernates". One local artefact worth
     recording: the first injected defect held the session in a module-level `WeakMap` and **passed**,
     because the object runs in the test's own isolate and module scope survives eviction.
  2. **Whether a pending future alarm accrues duration charges.** Cloudflare's own pages contradict each
     other: DO pricing says duration is billed in wall-clock time while the object is active and not eligible
     for hibernation (and hibernation requires no in-progress awaited `fetch()`), while DO *limits* says time
     spent waiting on network or storage does not count towards compute consumption. This swings the duration
     term of a fetch-awaiting `alarm()` between ≈$0 and ≈$60 per 1000 stops per month, and it is
     **load-bearing for the cost model above**. The falsifiable local test cannot distinguish "hibernated"
     from "evicted", because eviction is the only local mechanism. It needs the real
     `durableObjectsPeriodicGroups` dataset — i.e. WP0-5.
  3. **AsyncAPI as a codegen input** — see §"AsyncAPI, honestly". This gets the same treatment as the
     Swift/Kotlin token artefacts and the two conformance templates, which are generated, committed and
     **never compiled** ([ADR-067](#adr-067--the-contract-is-published-for-native-consumers-and-every-part-we-cannot-verify-says-so)):
     the artefact ships, and the claim is exactly as large as what has been run.
  Also unverified, and cheaper: `caches.default` inside a Durable Object is not used and was not tested — two
  shards in different colos cannot share a cache anyway, so it is not a cross-shard deduplication mechanism;
  sharding by target set is, and it needs no cache.

- **Consequences, including what we are accepting:**
  - **Today's default engine is still HTTP polling**, wearing the frame protocol. The poll emulator is what
    ships; the socket is opt-in and, as of this wave, opt-in *by source edit* — see the next section. On the
    default path the Place screen's behaviour is unchanged bar two deliberate differences (a round in which
    nothing changed no longer calls the listener — ADR-008 reaching the seam; and the list is canonically
    ordered where the shim pushed `Promise.all`-completion order) and one reduction: a refresh now costs
    `/v1/etas/:id` instead of the whole `/v1/stop/:id`.
  - **The subscription writes through to the query cache, on the key `useQuery` already owns.** That is what
    keeps [ADR-058](#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)
    working: `setQueryData` on a cached query keeps `status: 'success'`, so the pushed value is persisted and
    a cold start replays it. Writing to a key of its own was tried, and the seam proof fails on it.
  - **A gate now polices the view layer for transports** (`check-view-transport-free.mjs`), closing a gap Wave
    1 recorded and nobody owned for four waves: `pnpm boundaries` checks the *import graph*, so it cannot see
    `fetch('https://data.etabus.gov.hk/…')`, which imports nothing. One allowlist entry, discovered by
    running it: `apps/mobile/lib/tileSource.ts`, whose whole contract is a URL template on our own Worker.
    **The allowlist's own matcher was one of the review's findings** — it exempted a line rather than a rule,
    and the selftest had never run it. An entry now has to name the rule it was granted for, and the selftest
    has a case for the over-match.
  - **Two engines now implement three rules each, and only review binds them.** "A failed round is not a
    departure", "an unchanged round is silent" and — since decision 17 — "a mid-stream drop is re-echoed"
    exist in `poll.ts` and in `eta-hub.ts`; the scenario matrix drives the poll emulator against a
    *hand-written* script, never against the shard. Both defects this wave found in its own code —
    `Eta.stopId` and the terminal-rule overreach — survived because **no test spanned two implementations of
    one rule**, and so did the re-echo divergence, which was found by an agent's judgement while deciding
    whether to widen `summarize()` and not by anything mechanical. Three for three. Named as WP5-5 rather than
    left as a resolution.
  - **`retrying` is used for a per-target failure even when it is permanent**, and `seq` is monotonic across a
    re-subscription on the server while the poll emulator resets it. Two divergences the matrix does not
    cover, recorded rather than accidental.
  - **`/v1/live` degrades to nothing if `ETA_HUB` is unbound**: the binding is optional like `DATASET` and
    `BUILDS`, so a Worker without the Durable Object still runs and answers the taxonomy on that route, and
    every client keeps working because the shipped engine is the poll emulator.
  - **A 400, not a 426, for a missing upgrade**, because no member of `ERROR_CODES` carries 426 by design
    (ADR-064 binds the status to the meaning so a call site cannot pick one) and `bad_request` carries the
    meaning that matters. `upgrade_required` and `rate_limited` are recorded as the taxonomy's next two
    members, owned by WP0-5.
  - **Test totals 705 → 934** (core 738 · edge 93 · api-client 47 · mobile 36 · web 20 — counted on a clean
    clone, because a figure taken from a cached run is the thing ADR-070 exists about), and
    `packages/api-client` has a `test` script for the first time — before this wave `turbo run test` skipped
    the package **silently**, so `EdgeClient.watch()` had never been executed by anything.
  - **`main` gets its first CI workflow**, which is the cheap half of WP0-5 and needs no credentials
    ([ADR-070](#adr-070--a-turbo-tasks-hash-must-include-everything-it-reads-and-says-so) is why it is
    load-bearing rather than hygiene). Its deploy job is written out and deliberately inert. **The docs
    freshness rule is still not enforced anywhere:** the hook CLAUDE.md rule 7 describes is not installed
    (`core.hooksPath` unset), and `scripts/precommit-docs-check.mjs` cannot run in CI unmodified — it is a
    Claude Code `PreToolUse` hook that reads a tool-call payload on stdin and diffs the *index*, so in CI both
    of its early exits fire and it returns 0 having checked nothing. Left out with the reason stated in the
    workflow, because a step that passes vacuously is worse than no step. WP5-8.
- **What is not done, each with an owner:**
  - **WP5-4 — `coalesce` turns an upstream outage into "no buses", and the shard cannot tell.** The most
    consequential thing this wave found and deliberately did not fix. `stopEtas` → `stopArrivals` →
    `memberEtaLists` routes every pole through `coalesce`, which resolves a *rejected* upstream call to `[]`.
    So if KMB is down, every pole returns empty, `stopEtas` returns `[]` **successfully**, and `diffEtas`
    reports every reading `gone` — the "a failed round is not a departure" rule of decision 5 defeated one
    layer *below* where it is enforced. It is **pre-existing and identical on HTTP** (`/v1/etas/:id` already
    answers `200 []` for a stop whose upstream is refusing); the socket only makes it visible, because a
    screen blanks where a card was merely empty. It was not fixed here because the honest fix changes what
    `/v1/etas` and `/v1/nearby` can *say* — per-pole failure reporting, e.g. `{ etas, failed: string[] }` —
    which is a wire decision needing an ADR of its own, and doing it under cover of a socket wave would have
    put a contract change in a commit whose message says "Durable Object". A numbered row now owns it, because
    this repo has twice had a day-one requirement sit in prose that no work package owned (WP2-8, WP2-9) and
    get done only because somebody noticed.
  - **WP5-5 — nothing binds the two engines' failure semantics.** Drive the scenario-matrix rows against
    `EtaHub` through a real socket, so decision 5 is enforced on both sides rather than agreed by review.
  - **WP5-6 — the socket engine is not selectable without a source edit**, so `/v1/live` is unreachable from a
    real build. `EdgeClientOptions.liveUrl` and `.transport` are the plumbing; `EXPO_PUBLIC_LIVE_URL` /
    `VITE_LIVE_URL` and `…_LIVE_TRANSPORT` are the documented spellings and **nothing reads them**. There is
    deliberately no `auto` value in the plan: an automatic choice implies a socket→poll fallback, and
    `createSocketTransport` reconnects for ever rather than degrading. **This is also the bounding fact for
    every shard defect the review found:** five of the thirteen were in `eta-hub.ts`, and no rider was
    affected by any of them because nothing can reach the object — which is equally the reason five of them
    shipped green. Whoever does WP5-6 is un-latching those five fixes, and should read
    `.context/wave5/review/VERDICTS-do.md` before assuming the shard is now sound.
  - **WP5-9 — one reading per boarding point.** Decision 13's residual, and the owner framed it better than
    the finding did: *"we need to normalise the data to our own structure so we can understand what we're
    doing and consistently present it."* `dedupeEtas` collapses on `operator|routeNo|bound`, so a place
    publishes at most one reading per line and the sibling pole's arrival is discarded — measured, GMB 68K had
    buses at both poles 11 s apart and we published one. Now that a row is per pole, the second pole reads "no
    reading right now" while a bus is genuinely due there. A wire change: both `/v1/etas/:id` and
    `/v1/stop/:id`'s embedded readings grow, so it needs its own ADR, a payload-size check at the biggest
    interchange, and a look at whether `NearbyStop.etas`' `maxRows` still reads honestly when a line can
    appear twice.
  - **WP5-10 — a pole heading labelled by something that distinguishes it.** The display cost decision 13
    accepted: two members of one place can print the same stop code (TN510 at Tin Shui Wai Park), so one route
    renders twice under headings that look identical. `bearingOctant` is already in the kernel and already
    renders the compass caption.
  - **WP5-7 — Nearby is not a live adopter, and the reason is a request-count regression.** Its live target set
    is up to six places, so the poll emulator would issue six requests per window where the screen issues one.
    The fix is a batch `/v1/etas?ids=…` (additive per ADR-052 §5) and then adoption — not "later, somehow".
    `applyLiveEtasToNearby` is written, corpus-pinned and has no consumer until then.
  - **WP5-8 — the docs-freshness rule has never been enforced anywhere.** A `--range` mode on
    `scripts/precommit-docs-check.mjs`, with a selftest, so the one declaration of the rule can be applied per
    commit over a PR's range in CI.
  - **WP0-5 owns four things this wave sharpened:** zone rate limiting (the only real protection for
    `/v1/live`), `LIVE_SHARD_COUNT` revisited against 64 sockets per shard, `rate_limited` /
    `upgrade_required` in the taxonomy, and settling the pending-alarm billing question against the real
    metrics dataset.
  - **Two comments in the tree still assert that `observedAt` is the staleness field**
    (`apps/mobile/providers/QueryProvider.tsx:11-13`, `apps/edge/src/eta-cache.ts:15`). `isStale` reads
    `dataTimestamp` and always has; the schema description said otherwise and was corrected in this wave. The
    comments are the residue, and `SnapshotFrame.at` / `DeltaFrame.at` have the same shape — no behavioural
    reader on the client, which either wants one or wants the description to say "diagnostic".

## ADR-057 — Live ETA TTL is 30 s, and every upstream call is coalesced per pole
- **Status:** **Decided and implemented 2026-07-27** (WP0-4). Revises the 8 s/10 s TTLs chosen in
  [ADR-016](#adr-016--slice-1-server-side-v1nearby-on-device-index-deferred). Implementation:
  `apps/edge/src/eta-cache.ts`.
- **Context:** `/v1/nearby` fans out to every member pole of every nearby place — 70–100 upstream calls on a
  cold request, throttled by a 6-simultaneous-connection ceiling, which made it comfortably the slowest
  endpoint. Two separate leaks made that worse than it needed to be. **First, the TTL was too short to
  bind:** upstream refreshes roughly once a minute ([ADR-008](#adr-008--etas-are-approximations-no-client-side-fake-countdown)
  already concedes this), and at an 8 s TTL the hit rate is ~0% — misses per second cap at
  `hot_keys ÷ TTL` and the cache never becomes the binding constraint. **Second, the edge cache only helps
  after a response exists:** N concurrent requests for the same coordinate each opened their own upstream
  connections, and a duplicate call is not free — it displaces a real one against that connection ceiling.
- **Decisions:**
  1. **One TTL, 30 s, shared by the coalescer and the `max-age`** (`ETA_TTL_SEC`). It halves the upstream
     call rate without ever showing an arrival that upstream would itself have called fresh. This does not
     weaken ADR-008: staleness is surfaced from each reading's own `observedAt`, so a cached value is
     *labelled* old rather than presented as new.
  2. **The unit of sharing is the in-flight upstream call, not the response.** `coalesce(key, produce)`
     returns the running promise to every caller within the window, so the distinct call keys *are* the
     calls the Worker can issue: `kmb-board|<pole>` (KMB and LWB read the same board), `gmb-board|<pole>`,
     `CTB-eta|<pole>|<route>|<serviceType>` (CTB has no per-stop board, ADR-021), and
     `kmb-route-eta|<route>|<serviceType>` for the bulk route feed — so opening two direction variants of
     one route number costs one call.
  3. **Cache the GMB *raw* board, not the mapped result.** Mapping raw `route_id`/`route_seq` to canonical
     ids depends on the dataset build (ADR-047); caching the mapping would let a resolved value outlive the
     build that resolved it.
  4. **Never cache a failure.** A rejection evicts its entry and resolves to an empty list, so an upstream
     blip degrades one card for one request instead of pinning it for 30 s.
- **Acceptance, asserted in `apps/edge/test/eta-coalescing.test.ts`:** a counting fetch-mock shows
  `/v1/nearby` at a 20-pole coordinate issues **exactly** distinct-served-pole-count upstream calls, no pole
  twice, and nothing for the poles the response doesn't show; two concurrent requests (distinct edge-cache
  keys, same poles) issue one set; and opening a place after Nearby adds none.

## ADR-058 — Offline is a service worker, a persisted query cache and a remembered fix — not a new data tier
- **Status:** **Decided and implemented 2026-07-27** (WP0-3). Closes the offline claim `docs/03` had been
  making that `docs/11` recorded as untrue.
- **Context:** the PWA had install metadata ([ADR-048](#adr-048--pwa-install-metadata-web-app-manifest--ios-apple-touch-icon-via-a-custom-html))
  but no service worker, so an installed app opened to a browser error offline — the one failure mode that
  makes an installed PWA feel fake. The search index was already cached on device
  ([ADR-037](#adr-037--search-on-device-index-a-smart-route-keypad-and-extensible-filter-chips)); nothing else was.
- **Decisions:**
  1. **Three strategies, chosen per kind of thing** (`apps/mobile/workbox.config.mjs`). The hashed app shell
     is precached — that is what makes the app *open* offline, and without it no other cache is reachable.
     `/v1/index` is stale-while-revalidate. Live ETA endpoints are **network-first with a 4 s timeout** and
     never cache-first: under ADR-008, a bus that left four minutes ago is worse than no answer, so the
     cached copy is a fallback, not a shortcut. Tiles are cache-first and **never prefetched** — pre-emptive
     tile fetching is precisely what both LandsD's "not a large amount of requests in a short period" and
     the OSMF policy prohibit.
  2. **`generateSW` with the runtime inlined**, not `injectManifest` over a CDN `importScripts` — an offline
     service worker that needs the network on first run is not one. `pnpm --filter @nextbus/mobile
     build:web` runs the export and the generation together, because a precache manifest generated against a
     different build is worse than no service worker; the script then asserts on the emitted bundle.
     Registration is production-web-only: a stale worker intercepting Metro's module requests in dev is a
     genuinely nasty bug.
  3. **The query cache is persisted** (`PersistQueryClientProvider` + AsyncStorage, 24 h, successes only).
     Persisting errors would replay a stale failure on the next cold start, which reads as "the app is
     broken" rather than "we're offline". A replayed reading carries its original `observedAt`, so the ETA
     helpers age it and the UI marks it stale — restoring a *labelled old reading* is consistent with
     ADR-008, restoring a fresh-looking one would not be.
  4. **The GPS fix is grid-snapped to 25 m before it leaves the device.** This is WP2-6 pulled forward,
     because none of the above works without it: raw coordinates jitter by metres between readings, so
     the Nearby query key moved constantly and a persisted result could essentially never be replayed.
     It is simultaneously a privacy control and the thing that makes `/v1/nearby` edge-cacheable at all.
     **Completed in Wave 2:** the rule now lives in `packages/core/src/geo-snap.ts` (`snapFix`), pinned
     by `spec/geo-snap.spec.json`; the `apps/mobile/lib/geoSnap.ts` copy is gone. Only the 25 m tier
     exists — WP2-6's plan row also names a 50 m tier for fixes away from Nearby, nothing implements
     it, and `gridM` is a parameter no caller passes.
  5. **Say when the position is remembered.** `useLocation` persists the last fix and returns it with
     `stale: true` while a live one is pending or unobtainable; Nearby shows `lastKnownLocation` instead of
     the app name. ADR-008's honesty applies to the position, not only to the arrival times.
- **Verified:** with both the static server and the edge Worker stopped, a cold load of `/search` opened the
  app and searched from cache, and `/v1/nearby` was replayed from the service-worker cache with its original
  `observedAt` intact. **Not verified:** the Nearby *screen* offline — Chrome's geolocation in the dev
  environment resolves outside Hong Kong, so the data path was exercised directly instead. Worth checking on
  a real phone alongside the other install checks ADR-048 left open.

## ADR-059 — The id grammar: one parser in `core`, the spec and corpus in `contract`
- **Status:** **Decided and implemented 2026-07-28** (WP1-2). Implementation: `packages/core/src/ids.ts`;
  ABNF `packages/contract/src/ids/id-grammar.abnf`; corpus `packages/core/spec/ids.spec.json`; gate
  `scripts/check-no-adhoc-id-parsing.mjs`.
- **Context:** ids were parsed inline wherever they were needed. The plan counted eight such sites; a grep found
  **twelve** — the four the plan missed were in `apps/edge/src/{dataset,search-index,stop-route}.ts` and
  `packages/data-normalize/src/shards.ts`. That undercount is itself the argument: a hand-maintained list of
  parse sites drifts, which is why the allowlist is now derived by grep and gated.
  The reason this matters more than tidiness: **`split()` cannot fail.** A malformed id doesn't throw, it yields
  a plausible wrong answer — `"P"` cast to `OperatorId`, a place id silently resolving to a different place, or
  every unparseable reading from one operator collapsing into a single ETA row. Ids also arrive from persisted
  rider state (favourites saved months ago) and from URLs, so malformed input is *ordinary*, not exceptional.
- **Decision:**
  1. **The parser and formatter live in `packages/core/src/ids.ts`; the ABNF and the corpus live in
     `packages/contract`.** This **amends the plan**, which put the whole thing in `contract`: `core/src/eta.ts`
     needs the parser, and ADR-052's type-only gate forbids `core → contract` at runtime. The split is the
     better shape anyway — the parser is pure kernel logic, while the ABNF and the language-neutral corpus are
     the artefacts a Swift or Kotlin port consumes, and the TS tests drive that same corpus. That shared corpus
     *is* the cross-platform equivalence mechanism for hand-ported logic.
  2. **Total functions** returning `null` or a discriminated union — never throwing — because unparseable is
     ordinary input, not a bug.
  3. **Strict on the three delimiters (`:` `+` `|`), permissive inside a field.** Operators mint the field
     values, so over-strictness would 404 a favourite a rider saved last year. `operator` is validated as a
     *shape* rather than against a fixed vocabulary, so a fifth operator degrades gracefully (ADR-052 §4), with
     **one documented `as OperatorId` cast** replacing five scattered ones. `bound` is closed and guarded by a
     type-level exhaustiveness assert, because we mint it ourselves.
  4. **A favourite key has exactly one `|`.** A place id on the left-hand side parses and is flagged *legacy* —
     the migration is WP2-5's, and this is what will let it detect what needs migrating.
  5. **`formatPlaceId` deliberately does not sort members.** The builder's `localeCompare` ordering is baked
     into published datasets and into saved favourites, so changing the collation is a migration, not
     formatting.
  6. **The gate is keyed on file + matched snippet, not line number** (the plan's own line numbers had already
     drifted — `:312` → `:314`), and it fails **both** on growth *and* on a stale entry, so a fixed site can't
     leave a permanent exception behind. The allowlist reached **zero**.
- **Consequences — two deliberate behaviour changes:**
  - a malformed place id (`P:…+`, `P:a++b`) now resolves to **nothing** instead of silently resolving to a
    different place;
  - unparseable route ids in `dedupeEtas` now key on the whole id rather than collapsing every malformed
    reading from one operator into one rider line.
- **Follow-ups, recorded rather than done:**
  - `stopMatchesOperators` (`packages/core/src/search.ts`) still introspects ids with
    `` includes(`${op}:`) `` — the same class of bug (a KMB pole whose raw id begins `CTB…` would false-match
    Citybus). Left because the grep that would catch it is too noisy to gate on; a four-line fix with
    `parseStopOrPlaceId` when someone owns that file.
  - ~~`apps/mobile/lib/preferences.ts` keeps its own `favoriteRouteKey` template. Folding it into the formatter
    needs the migration, which is WP2-5's by the plan.~~ **Closed by [ADR-062](#adr-062--the-favourite-key-is-the-member-pole-and-the-scheme-is-versioned) (WP2-5):** the template is
    gone, and the fold shipped with the versioned migration that made it safe.
  - `lineKey` in `apps/edge/src/stop-route.ts` still duplicates `dedupeEtas`' key construction (both now go
    through the shared parser, with a comment tying them). Exporting one line-key helper from `core` is WP2-2.
  - **A malformed id returns `502`, which is wrong** — it is a permanent client error, so `400` is correct,
    and `502` reads as *retryable*, so an iOS Widget holding a malformed favourite would retry forever. **Now
    scheduled as WP2-8** together with ADR-052's `{code, message, retryable}` taxonomy, since it is the same
    defect wearing a different hat. It was previously a note in an ADR that no work package owned, which is
    how something specified from the start quietly never happens.

## ADR-060 — The fixture corpus is the equivalence mechanism for domain rules
- **Status:** **Decided and implemented 2026-07-28** (WP1-5). Implementation: `packages/core/spec/*.spec.json`,
  `packages/core/test/`, `scripts/check-spec-coverage.mjs`. Completes Wave 1.
- **Context:** [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)
  separates three kinds of change and solves only one of them. Wire *shapes* are generated, so every platform
  agrees by construction. **Domain rules cannot be generated** — `dedupeEtas`, the honest-ETA thresholds,
  bearing labels, fare formatting — they get hand-written again in Swift and Kotlin. Nothing about a Zod schema
  or an OpenAPI document constrains them, so without a shared, language-neutral specification three platforms
  will quietly disagree about when a bus is "due". This is the mechanism for that half.
- **Decision:**
  1. **Corpora are pure JSON at `packages/core/spec/<module>.spec.json`** — one file per kernel module, beside
     the `src` that implements it, so moving a package takes its spec along. `groups` keyed by export name;
     cases are `{name, why?, knownDefect?, args, expect}`; `version: 1`. **No `undefined`, no functions, no
     comments** — JSON `null` is the absent value and is translated at the boundary in `test/corpus.ts` — because
     an XCTest or JUnit suite has to read these rows verbatim. **The figure is generated, and this sentence no
     longer states it** — read the table in `packages/contract/README.md` §6, which
     `packages/contract/scripts/check-native-guide.mjs` fails on when it drifts. (WP1-5 shipped 36 groups /
     274 cases; every wave since has grown it, and this line was found stale **three** times — at Wave 3, at
     Wave 5, and again inside Wave 5 when the review pass added rows. Three strikes is enough: the mechanism is
     the answer and a hand-written count here is just a fourth chance to be wrong.)
  2. **`@spec <module>#<export>`** in an export's JSDoc marks it corpus-specified. Both halves are checked
     against the file stem and the symbol, so a tag cannot drift onto the wrong corpus or outlive a rename.
  3. **`check-spec-coverage.mjs` enforces both directions** — a tagged export with an empty or missing corpus,
     *and* an orphan corpus file or group that no tag references (rot in the other direction: rows that specify
     nothing). It also asserts **18 named boundary rows** by name, so deleting one is a red build. `--selftest`
     runs 8 synthetic scenarios proving each failure mode fires; same standard as ADR-052's gates — watched
     failing before trusted.
  4. **Branch coverage on `packages/core` is gated at 100%** (149/149), not line coverage: these defects live in
     the branch nobody thought of. No unexplained slack, so a rule added without rows fails rather than diluting
     an average. Two branches are covered by hand-written tests rather than rows, and argued in place: an unknown
     `Locale` (genuinely reachable — ADR-052 marks the enum `x-unknown-tolerant` and the client does no runtime
     validation) and a `NaN` bearing (JSON cannot express NaN).
  5. **`knownDefect` is a first-class corpus state.** A row may assert behaviour we agree is *wrong*, so that
     all platforms stay wrong *identically* and the fix becomes one coordinated change; the `why` must state what
     `expect` becomes when fixed. The gate prints the count every run. **This lifecycle already ran for real:**
     the literal-`|` row was written as a defect (`dedupeEtas` collapsed two distinct rider lines into one, so an
     arrival disappeared), WP1-2's `parseRouteId` landed, the row went red, and it was updated to expect both
     ids — which is exactly what will force every native suite to port the parser.
  6. **A kernel rule may not consult the host locale, ICU version or time zone.** Generalised from `formatClock`
     (see ADR-051): a corpus cannot pin a property of the machine. WP1-4's `toLocale*` ban is the mechanical half.
- **Consequences — the defects this found in shipped code.** Eight, of which one is fixed and seven remain
  recorded as `knownDefect` rows (each asserting today's behaviour, with the corrected expectation written in):
  - **✅ FIXED: `inferBusMarkers` could drop a bus entirely.** Departed readings were discarded *inside* the
    discontinuity scan, so a stale departed reading still acted as its successor's predecessor — the bus
    genuinely approaching the next stop was then judged "not a lead" and dropped too. **No marker anywhere: a
    bus one minute away vanished from the route view.** Since upstream only republishes about once a minute,
    stale departed readings are common rather than exotic. Departed readings are now nulled *before* the scan,
    which is what the drop-off rule always said; the change is strictly additive — it can restore a marker the
    old ordering discarded but never invent one. This is the clearest argument for the whole harness: the defect
    is invisible without a fixture that pins the interaction between two tests that each look correct alone.
  - `formatDistance` prints `"1000m"` for 995–999 m instead of `"1.0km"` — compare the *rounded* metres.
  - `estimateChildFare('')` → `"0.0"` and `estimateElderlyFare('')` → `"2.0"`: `Number('')` is 0, so a missing
    fare becomes a confident concession estimate.
  - `formatStopCount(1, 'en')` → `"1 stops"` — needs a plural-aware i18n key, not a per-platform patch.
  - `formatServiceHours` passes a past-midnight wrap straight through, so a raw GTFS `"25:35"` reaches a rider.
  - `buildRouteTrie('')` makes the *root* terminal, so `isCompleteRoute(root, '')` is true and submit-on-empty
    looks meaningful. Unreachable today; armed by any bad dataset build.
  - Doc inaccuracy, not a defect: `search.ts` offers `NA` as the night+airport example, but the family patterns
    require a digit, so bare `NA` is night-only. Recorded as `bare-na-is-night-only` so nobody "corrects" the regex.
- **Format converged, and it closed a real hole (2026-07-28).** WP1-2's id corpus and WP1-5's kernel corpora
  were written in parallel and landed in different shapes and different directories. Converging them on
  `groups` + `doc` moved `id-corpus.json` to **`packages/core/spec/ids.spec.json`**, gave `src/ids.ts` its ten
  `@spec` tags, and moved the suite to `packages/core/test/ids.test.ts`. The ABNF stays in `packages/contract` —
  that is a grammar specification, not test data.
  This was not tidying. `src/ids.ts` was covered by **neither gate**: no `@spec` tag, so the rot check could not
  see it, and absent from the coverage `include` list, so *"100% branches on `core`"* silently excluded the
  module that parses persisted rider state. Bringing it in put its real figure at **84%**, and the branches it
  exposed were `?? ''` fallbacks made unreachable by a length check one line above — dead code
  `noUncheckedIndexedAccess` had demanded. Removed rather than suppressed, because this module is hand-ported
  and a porter would faithfully reproduce a case that cannot happen. `core` is back to 100%, now over
  **197 branches rather than 149**.
  Two lessons worth keeping: a coverage `include` allowlist silently excludes modules that did not exist when it
  was written, so it must be revisited whenever a module lands; and the migration was done under a script that
  **aborted unless every recorded expectation was a checked projection of real output** — three projections
  turned up (omitted keys, a member recorded as its id string, `stopKind` flattening `stop.kind`), and demanding
  each be named is what kept a behaviour change from hiding inside a format migration.
- **Superseded — the open format question, resolved above.** Left here because the reasoning still applies to
  any third corpus: settle the shape before WP3-3 generates a native scaffold that would have to read two. WP1-5's corpus and WP1-2's
  `id-corpus.json` agree on `name`/`why`/`version` but still differ two ways: `doc` (a string) versus
  `$comment` (an array of lines), and cases nested under `groups` keyed by export versus flat sections.
  **Settle on `groups` + `doc` before WP3-3 generates a native scaffold that would otherwise have to read both**
  — `$comment` conventionally means "ignore me", and this prose is the deliverable, since the reason has to
  travel to the next language and not just the value.
## ADR-061 — Environments and configuration topology: local + production, ephemeral previews, and no staging tier
- **Status:** **Decided 2026-07-28.** The disarming half is implemented; the rest is guidance that WP0-5
  executes. Supersedes nothing; it writes down what was previously implicit.
- **Context:** the first-ever scheduled `dataset.yml` run failed
  ([run 30302525962](https://github.com/davidwdf/odysseus/actions/runs/30302525962)) on its first remote KV
  write, because the namespace id in `wrangler.toml` is still `REPLACE_WITH_KV_NAMESPACE_ID` and no Cloudflare
  credentials exist. That prompted three questions worth answering once, properly: where does configuration
  live, do we need a secrets service, and do we need a staging tier.
- **Decisions:**
  1. **Two environments — local and production — plus ephemeral per-change previews. No standing staging
     tier.** Four reasons, in order of weight:
     - **Drift is the project's stated top priority.** A third environment is a *drift source*: another
       config set, another dataset that can silently go stale, another place `EXPO_PUBLIC_API_URL` points
       somewhere different. Adding one to guard against drift would be self-defeating.
     - **Local fidelity is already unusually high.** `pnpm dataset:publish --local` writes into the same
       Miniflare state `wrangler dev` reads, so the KV path is genuinely exercised, and the edge suite runs
       *inside workerd* against simulated KV/R2 ([ADR-055](#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)). That is what a staging tier would
       have been for.
     - **Previews are free and disposable.** Cloudflare Pages gives per-branch preview URLs automatically;
       Workers gives per-version preview URLs (`wrangler versions upload`). Tied to a PR's lifetime, so
       nothing to maintain and nothing to drift.
     - **There is no production yet.** Building staging before production is backwards.
  2. **One exception, and it is about the prune, not about environments: create a *preview* KV namespace
     before the first production publish.** `publish-dataset.mts` step 4 **deletes ~20k keys** per superseded
     build, and that path has only ever run against Miniflare. Miniflare cannot tell us how the real bulk-delete
     API behaves at that size, and the failure mode is deleting the live build. Wrangler supports this natively
     via `preview_id` on the binding, so the cost is one namespace. Run a **full two-build publish + prune
     cycle** against it, assert the allowlist and the rollback target survive, and only then publish to
     production. This is a test fixture with a real backend — deliberately *not* a second environment to keep
     in sync.
  3. **No secrets manager. Three homes, split by consumer.** The whole secret surface is **two values, and
     neither is needed to run the project** — every upstream is keyless ([`docs/02`](./02-data-sources.md),
     [ADR-049](#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)), so a fresh clone works with nothing configured.
     **CI credentials → GitHub Actions secrets** · **Worker runtime secrets → `wrangler secret put`** (none
     today; [ADR-050](#adr-050--stop-imagery-google-street-view-deep-link-now-hk-streetscape-360-as-the-inline-target)'s Streetscape key would be the first) · **local → `wrangler login`**, OAuth, so no
     token file. Doppler/Infisical/Vault would be more machinery than two values with one consumer justify.
     Revisit at a second environment, a second person, or ~10 secrets. Inventory:
     [`docs/10`](./10-scaffold-and-running.md#configuration--secrets).
  4. **Two things that look like secrets and are not.** `EXPO_PUBLIC_*` is **inlined into the bundle** by
     Expo and readable in DevTools — it can never hold a credential, which is *why* the tile proxy exists;
     anything needing a key is proxied through the Worker. And the **KV namespace id is an identifier**,
     inert without an authenticated token, committed on purpose so the Worker's bindings resolve.
  5. **The nightly publish is armed by a repo variable, not by merging the workflow.**
     `DATASET_PUBLISH_ARMED=true` gates the *scheduled* run; `workflow_dispatch` always runs, so a manual
     dispatch is how the credentials get proven before the cron is trusted. A cron that fails every night is
     a cron everyone learns to ignore — and this one is *expected* to fail for as long as WP0-5 is open. A
     preflight step names the missing secret or the placeholder namespace id rather than letting it surface
     mid-publish as a wrangler exec error.
- **Verified:** the failed run reached `pnpm test` and died before writing a single data key — `build:history`
  is written before any shard and `build:current` is flipped last, so ADR-055's write order held under a real
  failure rather than a simulated one. The preflight logic was exercised in all three states (nothing set,
  credentials present but namespace still a placeholder, all present).

## ADR-062 — The favourite key is the member pole, and the scheme is versioned
- **Status:** **Decided and implemented 2026-07-28** (WP2-5). Implementation: `apps/mobile/lib/preferences.ts`
  (`PREFERENCES_VERSION`, `migratePreferences`), pinned by `apps/mobile/lib/preferences.migration.test.ts`.
- **Context:** [ADR-032](#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes) made the favourite
  primitive a route-at-stop pair keyed `"<stopId>|<routeId>"`;
  [ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant)
  then amended the stop half to the **member pole** id, because a place id embeds its member list and therefore
  churns every time the clustering is re-tuned. Both statements sit in this log; neither was enforced anywhere
  on disk. Two loose ends followed. (a) `apps/mobile/lib/preferences.ts` kept its own `${stopId}|${routeId}`
  template even after WP1-2 gave `core` `formatFavoriteRouteKey`/`parseFavoriteRouteKey`
  ([ADR-059](#adr-059--the-id-grammar-one-parser-in-core-the-spec-and-corpus-in-contract) records the deferral,
  and the reason for it: folding the template in *is* the migration). (b) Any key already written under the
  place-id scheme is stranded — it names a place id that stops existing at the next clustering change, and the
  favourite then disappears with no error, no log line and no way back. `persist` had neither `version` nor
  `migrate`, so there was no mechanism to rescue it, and every improvement to the save UI makes the stranded
  set larger. Favourites are the one part of this app a rider builds by hand, so this is the only piece of
  persisted state whose loss is not recoverable by re-fetching.
- **Options:**
  1. **Ship the pole-keyed scheme and accept the loss.** Free, and the app has few enough users today that the
     blast radius is small. But the failure is silent and permanent, and "few users" is an argument that
     expires while the code does not.
  2. **Fix on read** — normalize each key wherever the Favourites tab reads it. No version bump, so nothing to
     get wrong at hydration. But a read fix-up never finishes: it must stay correct in perpetuity, it has to be
     repeated at every read site (there are now four), it leaves the wrong bytes on disk so the problem is
     never actually over, and it erases the evidence that the scheme ever moved.
  3. **A versioned `persist` migration** (chosen) — `version: 1` plus a `migrate` step that runs once at
     hydration and re-stamps the blob.
- **Decision:** (3), under four rules.
  1. **One formatter, one parser.** `favoriteRouteKey` is deleted from `preferences.ts`; the store, `SaveStar`,
     the route schematic's action sheet and the Favourites tab all mint and read keys through
     `@nextbus/core` (ADR-059). The tab's own `indexOf('|')` splitter went with it — the ad-hoc-parsing gate
     stays green with an empty allowlist.
  2. **v0 → v1 expands a place key onto *every* member pole**, rather than picking one. A place-keyed
     favourite simply does not record which kerb the rider meant. A wrong guess is an invisibly missing
     favourite; an over-expansion is invisible in the harmless direction, because the tab intersects the saved
     keys with the route-at-pole rows the place actually reports, so a key for a pole that does not serve that
     route can never render. Expansions de-duplicate against keys already saved, in save order.
  3. **Nothing is ever dropped.** A key the grammar cannot read is kept verbatim, in place — not deleted, and
     not moved to a quarantine list, which would only be a second place to forget about. The grammar is
     deliberately narrower today than it will be (ADR-059's `OPERATOR_RE` widens the day a fifth operator
     ships), so a key that starts parsing again later simply starts working again.
  4. **A blob from a future version passes through untouched and is re-stamped at ours** — a rider who
     downgrades, or two browser tabs on different builds. Discarding it would be destructive; a scheme we
     cannot read renders as nothing, which upgrading again undoes. The price is that **every step must be
     idempotent**, because a step can meet data it has already been run against. That is asserted, not assumed.
- **Why the test feeds whole blobs through the real store:** the migration function is the easy half.
  Everything that can silently eat a rider's favourites lives in the wiring around it — and one piece of that
  wiring is genuinely surprising: `persist` calls `migrate` only when the stored `version` is a **number** and
  differs from ours, so a blob with **no** `version` field is loaded verbatim and never migrated at all. That
  is harmless here only because every write this store has ever made stamped `version: 0` (`persist`'s
  default), which is a fact about the past that a test now pins rather than a property anyone should
  remember. So the suite writes the literal `{"state":…,"version":0}` strings into an in-memory storage,
  rehydrates the **real** store with only that storage swapped, and asserts both the resulting state and the
  bytes written back — a migration that is right in memory and wrong on disk is still broken.
- **Consequences:**
  - `preferences.ts` exports `PREFERENCES_VERSION` and `migratePreferences`; the next change to what a
     persisted key *means* is a numbered step beside this one, not an edit to the current one.
  - **One accepted loss, stated rather than hidden:** the pre-2026-06-10 `favorites` list (bare stop ids,
    ADR-032's removed primitive) is not migrated. A bare stop cannot become a route-at-stop pair without
    inventing a route, and no shipped UI ever created one; `partialize` drops the field at the next write.
  - **One accepted cost:** an over-expanded key for a pole that does not serve the route stays on disk for
    good, and the Favourites tab issues one `getStop` per distinct saved pole — so a two-member expansion is
    one extra request, coalesced back into a single card because the grouping is by place.
  - ADR-059 §5's hazard shrinks: because favourites no longer hold place ids after v1, changing the member
    collation in `formatPlaceId` can no longer orphan a favourite. It still churns deep links and query-cache
    keys, so the rule stands — it is just no longer load-bearing for the rider's saved list.
  - Cross-device sync of favourites ([docs/07](./07-backlog.md)) inherits this: the migration runs where the
    blob is, so a server-side copy of the list would need the same numbered step rather than a second scheme.

## ADR-063 — The search index's order is data: a precomputed `sortKey`, range scans, a content-hash version and an ETag
- **Status:** **Decided and implemented 2026-07-28** (WP2-7 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). Implementation:
  `packages/core/src/search.ts`, `apps/edge/src/search-index.ts`, `apps/edge/src/index.ts`,
  `packages/contract/src/wire/search.ts`; corpus `packages/core/spec/search.spec.json`; response assertions
  `apps/edge/test/search-index.test.ts`. Amends
  [ADR-037](#adr-037--search-on-device-index-a-smart-route-keypad-and-extensible-filter-chips), which specified
  the trie and the size-pair version.
- **Context: a rider sees `2` before `10` because of a call to ICU.** `compareRouteNo` was
  `a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })`, and the smart keypad's live key-enabling
  was a prefix trie built on device. Both are the textbook answers and neither was wrong. Both are also
  **unportable in the specific way this project cares about** ([ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe) kind 2):
  - Swift's nearest equivalent is `compare(options: [.numeric, .caseInsensitive])` and Kotlin's is a
    hand-rolled natural-order comparator. The three disagree on mixed digit/letter runs — exactly the shape
    of a Hong Kong route number (`10A`, `E22A`, `N260`) — so one index would render in **three different
    orders on three platforms** and no test would catch it, because each platform would be self-consistent.
  - A trie is a *structure*, not a rule. Three ports each build their own; the corpus can pin the shape of
    ours, but a Swift `TrieNode` that a human transcribed is not the thing the corpus checked.
  Separately, `version` was `` `${routes.length}.${stops.length}` `` — the file's own comment called it
  "good enough". It is not: it **collides whenever one build adds a route and drops another**, which is the
  ordinary shape of a daily dataset diff. The client compares two identical strings, keeps its cached index,
  and holds a picture of the network that no longer exists — silently, until someone searches for a route
  that was renumbered.
- **Decisions:**
  1. **The order is a string, not a computation.** `routeSortKey` zero-pads every run of digits to **four**,
     so `10A` → `0010A` and `9` < `10A` < `11` under plain byte comparison — and byte comparison is the one
     ordering JavaScript, Swift and Kotlin already agree on without being asked. `compareRouteNo` is now a
     comparison of two keys; the operator tiebreak in `searchRoutes`, which was a second `localeCompare` in a
     smaller font, went the same way.
     *Rejected alternative:* "have every platform use ICU with the same options". It reads like the cheap fix
     and it is the expensive one — it makes correctness depend on three vendors' collation tables staying in
     step, forever, with the failure invisible on the platform you happen to be testing.
     Four digits is ten times the widest run any HK route number carries. **Overflow is correct, not merely
     tolerated:** a longer run is prefixed with one `~` per extra digit instead of padded, and since `~`
     (U+007E) sorts after every digit and every upper-case letter, a longer run always lands after a shorter
     one while equal lengths compare lexically — which for equal lengths *is* numeric order. The key stops
     being human-readable at five digits; it does not stop being right, and the input is upstream data we do
     not control.
  2. **The edge precomputes it into `RouteLite.sortKey`, and the client may derive it.** The field is
     **optional** per [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe) §5, so a client holding an index cached before the field existed still
     sorts; `searchRoutes` falls back to `routeSortKey(routeNo)`, which is the same function that produced
     the field, so the two can never disagree. Precomputing it is the first slice of WP3-4 and it buys
     something real: the displayed order becomes changeable by a dataset publish rather than by three client
     releases. A corpus row proves the client honours the field rather than re-deriving it, by sending two
     keys that deliberately contradict their own numbers.
  3. **Range scans replace the trie.** `routeKeys` returns every route number upper-cased, de-duplicated and
     **byte-sorted**; every number sharing a prefix is then contiguous, so `nextValidChars` is a binary
     search for the first key ≥ the prefix followed by a walk to the first key that has lost it, and
     `isCompleteRoute` is one binary search for exact membership. Same keys light up, no structure to port —
     the sorted array *is* the data, and the corpus compares arrays rather than a shape a reader has to
     reconstruct. Note the array is in **byte** order, not rider order: sorting it by `routeSortKey` would
     put `0002` between `0001` and `0010` and destroy the contiguity the scan depends on. There is a corpus
     row whose only job is to stop someone "fixing" that.
     The blank-route-number guard ADR-060's corpus recorded survives the change, in one place instead of two:
     blanks never enter the array, so the empty prefix answers "not a complete route" with no special case.
  4. **`version` is a content hash of `routes` + `stops`** — SHA-256, first 16 hex, the *same digest recipe*
     `scripts/build-dataset.mts` uses for the build hash, because a second hashing scheme is a thing to keep
     in step for no benefit. It moves exactly when the bytes move, so the collision above cannot happen.
     *Rejected alternative:* reuse the dataset build hash itself, which is sitting right there in the
     manifest. It would have made the ETag answerable from the already-cached `build:current` pointer — but
     that hash digests **every** shard, so a fare change on one route would re-download the whole index for
     content byte-identical to what the client already holds. Note the build hash already digests the search
     index's JSON, so it cannot be the value inside it without being circular.
  5. **`/v1/index` serves that hash as a strong ETag and honours `If-None-Match`.** A returning client whose
     6 h `max-age` has lapsed pays a header exchange instead of the blob. **What it costs:** a 304 is not
     free — only the body is skipped, and the handler still resolves the response to know its validator, so
     a cold colo still reads the R2 object to answer "nothing changed". We took that trade because the
     expensive side is the rider's mobile data, not our egress. Two smaller costs, both paid in the code:
     the colo cache key had to **stop copying the client's headers** (`If-None-Match` in the key would split
     the cache into one entry per validator a client happens to hold, and the conditional response would
     miss it entirely), and only strong single-value `If-None-Match` is honoured — a weak or comma-list tag
     simply misses and gets the 200 it would have got anyway, which is the safe direction.
     This composes with the two caching decisions either side of it:
     [ADR-057](#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole)'s `cached()`
     still coalesces and still stores exactly one 200 per URL — the 304 is derived from that entry and never
     stored — and [ADR-058](#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)'s
     stale-while-revalidate is unchanged and now revalidates cheaply, which is what it always wanted to do.
     No other endpoint gets an ETag: the rest are live, where a validator that never matches is pure overhead.
- **Verified** in `apps/edge/test/search-index.test.ts`, inside workerd against simulated KV/R2: the 200
  carries `ETag: "<version>"` matching the body, a matching `If-None-Match` returns **304 with an empty body**
  and the validators repeated, a stale validator gets the full index, and an unconditional request *after* a
  304 still gets a complete 200 — the assertion that would fail if a bodiless response had been cached.
  `version` is asserted to be 16 hex characters, and every route in the served index carries a padded
  `sortKey`. The corpus grew from 274 to 352 rows and `packages/core` holds **100 % branch coverage** across
  210 branches (was 151).
- **Consequences / notes for whoever touches this next:**
  - `buildSearchIndex` is now **async** (`crypto.subtle.digest`, because its two runtimes are node and
    workerd and only one of them has `node:crypto`). Its three callers were updated; a fourth would fail to
    typecheck rather than silently hash a promise.
  - The `RouteKeypad` prop is `keys: readonly string[]`, not `trie`. `RouteTrieNode` and `buildRouteTrie`
    are **deleted**, not deprecated — a duplicate implementation is the failure mode Wave 2 exists to prevent.
  - `searchStops` still ranks by a substring match and is untouched here. Its ordering is stable-sort-dependent
    rather than collator-dependent, so it has the same portability hazard in a different form; the corpus
    row that pins it (`equal-rank-keeps-index-order`) is the only thing standing between us and a Swift port
    that reshuffles the results list between keystrokes.
  - The other endpoints' inline cache lookups in `apps/edge/src/index.ts` (`/v1/eta`, `/v1/nearby`,
    `/v1/tiles`) still build their cache key with `new Request(url, request)`, so a client that sends
    `If-None-Match` to them splits their colo cache. Harmless today — nothing sends one — and left alone
    deliberately, because those lines were being rewritten by WP2-8 in the same wave.

## ADR-064 — The error taxonomy: the status code and the code are one decision
- **Status:** **Decided and implemented 2026-07-28** (WP2-8 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). Declaration:
  `packages/contract/src/wire/responses.ts` (`ErrorCodeSchema`, `ERROR_CODES`, `ErrorResponseSchema`);
  the only constructor: `apps/edge/src/errors.ts`; the gate: `apps/edge/test/wire-conformance.test.ts`.
  Discharges the first of the two "faithful but wrong" transcriptions
  [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)
  recorded and the last bullet of
  [ADR-059](#adr-059--the-id-grammar-one-parser-in-core-the-spec-and-corpus-in-contract)'s follow-ups.
- **Context:** the plan specified `{code, message, retryable}` in *The contracts* from the first draft,
  and separately noted that a malformed id returned **502** where **400** is correct. They were written
  down as two items, tracked as two items, and owned by nobody — which is how something specified from
  the start quietly never happens. They are **one defect**. `5xx` *is* the retryable signal: every HTTP
  client, every CDN and every background scheduler in the path reads the status line, and most of them
  read nothing else. An iOS Widget holding a favourite whose id no longer parses gets a 502, concludes
  "transient", and retries on every refresh for as long as the rider keeps the tile — on their battery,
  against our edge, forever. Adding a `code` field to the body would not have fixed that on its own,
  because URLSession classifies the response before anything reads the JSON. So the taxonomy is only
  worth anything if the status is derived from it rather than chosen next to it.
  The second half of the context is who this is *for*. The PWA does no runtime validation at all
  (ADR-052 decision 2) and its screens mostly just show "couldn't load". The consumer that needs this is
  the one that cannot ask a human: a Widget, a complication, a background refresh — anything that has to
  decide, unattended, between *prune this permanently* and *try again later*.
- **Decision:**
  1. **One table binds the code, the HTTP status and the retry advice.** `ERROR_CODES` in the contract
     maps each of `bad_request → 400`, `not_found → 404`, `internal → 500`,
     `upstream_unavailable → 502`, `upstream_timeout → 504` to its status **and** its `retryable`.
     `apps/edge/src/errors.ts`'s `fail(code, message)` takes a code and reads the status off the table;
     nothing in `apps/edge` can produce a failure response any other way. That is the whole mechanism:
     the two halves of the defect cannot come apart again because there is no longer a place to write
     them separately. `satisfies Record<z.infer<typeof ErrorCodeSchema>, …>` makes a code without a
     status, or a status without a code, a typecheck error.
  2. **`retryable` is "may the identical request succeed later?", and it is `false` only for
     `bad_request` and `not_found`.** `internal` is retryable, which looks wrong for a second and is
     not: a bug of ours is no evidence that the rider's saved stop has gone, and pruning somebody's
     favourites because we shipped a bad deploy is the worse of the two failures. The rule the client
     needs is "is this *my* request that is wrong?", not "whose fault is it?".
  3. **`retryable` travels on the wire rather than being a table the client compiles in.** `ErrorCode`
     is marked `x-unknown-tolerant` like the other closed enums (ADR-052 decision 4) — `rate_limited`
     is the obvious next member — and an already-installed client that has never heard of a new code
     must still know whether to retry it. A compiled-in mapping would make every new member a store
     release. This is the same reasoning as ADR-053's served `ClientPolicy`, applied to failure.
  4. **Malformed and absent are different, and neither is retryable.** An id that does not parse
     (`parseStopOrPlaceId` / `parseRouteId` return `null`) is `bad_request`; an id that parses and
     resolves to nothing is `not_found`. Both are permanent, so a Widget prunes either — but the split
     is worth keeping because it is the difference between *our id scheme changed* (a migration bug,
     WP2-5's territory) and *this pole left the dataset* (ordinary churn), and only one of those is
     something we should be paged about. Parsing happens **before** the KV read, so a junk id costs no
     lookups.
  5. **Shipped additively per ADR-052 §5.** `code`, `message` and `retryable` are served *alongside*
     `error`, which is unchanged and still duplicates `message`. Nothing that reads `error` today
     breaks. **What retires `error`:** it is removed in the first release after a native client exists
     and is generated from `openapi.json` (WP3-3) — the removal is breaking, so it needs the `oasdiff`
     gate, its own ADR and a `CONTRACT_VERSION` major bump. Until then it is marked `deprecated: true`
     in the emitted schema, which is the only signal a generated client will actually surface. The web
     client never read it, so the deprecation window costs us one duplicated string per failure.
- **The gate:** `apps/edge/test/wire-conformance.test.ts` is now table-driven — one row per error exit
  in `apps/edge/src`, driven through the real Worker inside workerd, each asserting the status
  `ERROR_CODES` gives its code, the code itself, `retryable`, `cache-control: no-store`, and that the
  body carries nothing `ErrorResponseSchema` does not describe. Two completeness assertions keep the
  table honest: **every member of `ERROR_CODES` must be exercised**, and **every published endpoint
  that takes a parameter must have at least one row** — a parameter is the only way a client can get a
  request wrong, so a new `{id}` endpoint with no error case is visible here rather than in a native
  crash log. `internal` is the one row driven through the helper rather than a request, and
  deliberately so: it is what the top-level catch reports when a handler that should have classified
  itself throws anyway, so *nothing a client can send* reaches it. Injecting a fault into production
  code to turn that row green would be testing the injection.
- **Four defects this surfaced, all fixed here** (each was a real error exit that classified wrongly):
  - **A malformed id was a 502** at `stopDetail`/`stopEtas`/`routeDetail` — the ADR-059 note. Now 400.
  - **A well-formed id for a stop that does not exist was also a 502.** Now 404. This is the one with a
    behaviour change downstream: `apps/edge/test/dataset-kv.test.ts`'s "build whose keys were never
    written" case asserted 502 and now asserts 404, because the Worker genuinely cannot tell an absent
    shard from an absent stop. It does not have to: `build:current` is flipped last, so a *current*
    build always has its keys (ADR-055), and the synthetic state that test constructs is unreachable.
  - **A malformed percent-escape in a path threw.** Every canonical id is percent-encoded (place ids
    contain `+`), and `decodeURIComponent('%E0%A4%A')` raises `URIError` — which left the isolate as
    workerd's bare `Error 1101`: no envelope at all, and a 500 that reads as retryable. Now a 400.
  - **Tile failures answered in `text/plain` with a hand-picked status.** An `<Image>` reads neither,
    but a native client debugging a blank map does, and "502" told it to keep retrying a tile that will
    never exist. Now the same envelope, with upstream's 404 as `not_found` and their 504 as
    `upstream_timeout`.
- **`upstream_unavailable`, not `internal`, is the default for an unclassified throw** at the two
  request-scoped catches. The producers there are dataset reads (KV, R2, `data.hkbus.app`) and live ETA
  calls, so an unclassified throw is I/O far more often than a bug — and it preserves today's 502 for
  every path that was not the id defect, which matters because those 502s may be load-bearing for a
  client we cannot see. `internal` is reached only from the top-level catch, where a throw genuinely is
  ours; it logs the stack.
- **Consequences / notes:**
  - `EdgeRequestError` in `@nextbus/api-client` replaces `new Error("… → HTTP 502")` and carries
    `status`, `code` and `retryable`. It reads the envelope as data — `@nextbus/core`'s types erase, so
    there is nothing to validate with — and falls back to `internal`/retryable when the body is not
    ours. That fallback is for a response the Worker never sent (a Cloudflare error page, a captive
    portal); treating an unreadable 404 from airport wifi as permanent would prune favourites.
  - `@nextbus/contract` moved from a devDependency of `apps/edge` to a dependency. It costs no bundle:
    zod is already in the Worker via `@nextbus/data-normalize`'s upstream parsers.
  - The `500` and `504` responses were missing from every path in `openapi.json` — the emit built its
    responses map by hand. It now derives it from `ERROR_CODES`, so the document cannot list a status
    the taxonomy does not mint, or omit one it does.
  - **Not done, and deliberately:** no `rate_limited`, because we do not rate-limit; no per-field
    validation detail in the envelope, because the plan's batch-ETA POST (which needs "the offending
    index") is a later work package and inventing the shape now would be guessing.

## ADR-065 — `Route.service` is two named schemas, not one optional field: the fidelity tier is in the type
- **Status:** **Decided and implemented 2026-07-28** (WP2-9 of
  [`docs/proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md)). Closes the second of the two
  "faithful but wrong" transcriptions [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe) left open (the error taxonomy is the other, WP2-8).
- **Context:** `/v1/route/:id` serves a route's `service` with `patterns` — the per-day-type frequency
  profiles — and `/v1/stop/:id` serves it without. That omission is not an oversight and must not be undone:
  duplicating `patterns` into every place a route touches was **54 MB of an 82 MB build**
  ([ADR-055](#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path) §7), and it
  is read on exactly one screen. The defect was that **both tiers satisfied one schema** whose `patterns` was
  optional. A decoder that receives no `patterns` therefore learns nothing: it cannot tell *"this route has no
  frequency table"* from *"you called the endpoint that never sends one"*. Today that is invisible, because
  the only client is the TS app, which knows which screen it is on and performs no runtime validation at all
  (ADR-052 §2). The moment WP3-3 generates Swift and Kotlin models, the ambiguity becomes a field on a struct
  that two different people will interpret two different ways — and the wrong interpretation renders
  "no timetable" for a route that has one.
- **Decision: two named schemas.** `RouteServiceSummary` (no `patterns`) and `RouteServiceInfo` (summary
  fields **plus** `patterns`), carried by `RouteSummary` and `Route` respectively. `StopDetail.routes[].route`
  is a `RouteSummary`; `RouteDetail.route` stays a `Route`. Judged from the consumer's side, which is the only
  side that matters here:
  1. **The generated OpenAPI reads as the truth.** `StopDetail` `$ref`s `RouteSummary` → `RouteServiceSummary`,
     whose property list simply ends at `hours`. A reader with nothing but `openapi.json` can see which tier
     each endpoint serves without a sentence of prose — which was the acceptance criterion, and prose is what
     the old schema already had and nobody could act on.
  2. **A Swift `Codable` and a kotlinx `@Serializable` model handle it with no hand-written decoder**, because
     each tier emits as one *flat* object. This is why the shared fields are spread into both schemas rather
     than composed with `.extend()`/`allOf`: `allOf` is exactly the construct those two generators handle
     worst, and a contract whose whole purpose is generated models must not hand them their weak case.
  3. **Absence becomes unambiguous by construction, not by convention.** On the summary tier the field does
     not exist, so it cannot be misread. On the full tier `patterns: nil` means the dataset has no frequency
     table for that route — a real fact, and now the only thing it can mean.
- **Additive-safe (ADR-052 §5), and worth being precise about why.** The **wire bytes do not change**: no
  field is added, removed, renamed or retyped on any endpoint, and every payload that validated before
  validates now. What is new is two *component names* in `openapi.json` — `RouteSummary` and
  `RouteServiceSummary` — alongside `Route` and `RouteServiceInfo`, which keep their names and their exact
  shapes. An already-generated client keeps decoding; a regenerated one gains a type. `CONTRACT_VERSION` stays
  at 1.0.0, correctly.
- **Rejected, in the order they were tempting:**
  1. **An explicit tier discriminator** — a `fidelity: 'summary' | 'full'` field on `RouteServiceInfo`. It is
     additive and it does resolve the ambiguity, but it resolves it *at runtime, in code the reader has to
     remember to write*: `patterns` stays optional on one struct, so every call site needs a hand-written
     `if fidelity == .full && patterns == nil` to reach the same conclusion the type could have stated. It
     also puts a constant on the wire for every route in every place document, to describe something the URL
     already determined. A tag that says which shape you got is strictly worse than getting a different shape.
  2. **The same discriminator as a real `oneOf` + OpenAPI `discriminator`.** Type-safe on paper and the worst
     of the three in practice: `oneOf` is precisely where Swift `Codable` needs the custom `init(from:)` this
     whole contract exists to avoid, and kotlinx would want a sealed hierarchy for what is one object with one
     optional field.
  3. **Hoisting `patterns` out of `service` onto `RouteDetail`** as a sibling of `route`. Genuinely the
     cleanest end state — one `Route`, one `RouteServiceInfo`, and the extra fidelity hanging off the only
     envelope that can carry it — but it *removes* `RouteServiceInfo.patterns`, which is a breaking change
     under ADR-052 §5. It would need `oasdiff`, a deprecation window serving the profiles in both places, and
     a client migration, to buy a slightly tidier model. Noted here so the next person knows it was weighed
     rather than missed.
- **`toRouteSummary` is the one definition of what the tier drops**, exported from
  `@nextbus/data-normalize/shards` and applied **twice, for two different reasons** — which is the part worth
  reading twice before deleting one of them. The shard build applies it for **size** (the 54 MB above); the
  Worker's `/v1/stop/:id` applies it again for the **contract**. The second is not belt-and-braces: a KV
  document is untyped JSON that may have been written by a publisher older than the code reading it, so the
  tier an endpoint serves has to be a property of the endpoint, not of whatever is in the namespace.
- **Held by a gate, in both directions** (`apps/edge/test/wire-conformance.test.ts`, inside workerd against
  simulated KV/R2). One direction is now automatic: `StopDetail` parses through `RouteSummary`, so ADR-052's
  strict "nothing undocumented" check fails if a stop response ever grows a `patterns`. The other direction is
  not, because `patterns` is optional at the full tier too — a route endpoint that quietly stopped sending
  profiles would satisfy every schema in the document — so it is asserted explicitly. The edge fixtures gained
  a GTFS frequency table for this: without one, "the stop endpoint omits `patterns`" would have passed
  vacuously, which is the failure mode a gate is supposed to be immune to. Both assertions were watched to
  fail on an injected violation, and the Worker-side guard was watched to hold the tier on its own with the
  build-side one removed.
- **Consequences / notes:** `apps/mobile` has a zero diff — `RouteSummary` and `Route` are mutually assignable
  in TypeScript (structural typing, `patterns` optional on the full tier), so the split buys the TS client
  nothing and is not meant to. The enforcement lives where the risk does: in the OpenAPI document, in the
  decoders WP3-3 generates from it, and in the conformance gate. If a future change makes `patterns`
  **required** at the full tier — emitting `[]` for a route with no table, which would give TS teeth too — note
  that it forces a `service` object onto routes that today carry no static facts at all, so it is a wire
  change with a UI consequence, not a rename.

## ADR-066 — The colo cache key carries the build hash, so a dataset flip invalidates by construction
- **Status:** **Decided and implemented 2026-07-28**, closing the one defect Wave 2's verification pass found.
  Implementation: `cached()` in `apps/edge/src/index.ts`; pinned by *"a dataset flip invalidates the cached
  index"* in `apps/edge/test/search-index.test.ts`.
- **Context:** [ADR-055](#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)
  publishes a new dataset by writing content-addressed shards and then flipping `build:current`. Everything
  downstream is keyed by that hash — **except the colo cache in front of the Worker**, whose key was the
  request URL alone. `/v1/index` carries a **6 h** `max-age`, so for six hours after a publish the edge kept
  serving the previous index while `/v1/health` cheerfully reported the new `buildHash`.
  [ADR-063](#adr-063--the-search-indexs-order-is-data-a-precomputed-sortkey-range-scans-a-content-hash-version-and-an-etag)
  then made it worse in a specific and instructive way: with an ETag on the endpoint, a client revalidating
  inside that window got a **304 confirming the stale copy**. The index is versioned *precisely* so a client
  can tell it moved; a cache in front of it that answers "unchanged" defeats the whole mechanism. Reproduced
  by hand before it was fixed: after `pnpm dataset:publish --local`, `/v1/health` reported
  `d598893de6add2e4` while `/v1/index` still served `version: 3091.10118`, and the same URL with a
  cache-busting parameter returned the new `a8495d810abf620d`.
- **Decision:** the cache key is `<url>?__build=<buildHash>` (`inline` when there is no KV build). `cached()`
  resolves the dataset **before** the lookup and hands it to the producer, so the same memoized manifest read
  serves both the key and the work. `searchParams.set` overwrites, so a client passing `__build` itself
  splits nothing.
- **Why this rather than purging on publish:** a purge step is a thing someone has to remember, in a pipeline
  that already failed to remember it once — and it cannot run at all until WP0-5 gives us credentials, so the
  gap would have stayed open for the entire pre-launch period. Scoping the key makes the property true by
  construction: there is no sequence of publishes that serves a stale build, because a stale build's entries
  are simply not addressable. It also costs nothing per request. Old entries are not deleted; they age out on
  their own TTL, which is the same trade ADR-055 already makes for superseded shards.
- **Rejected:** *shortening the TTL* — it trades a bounded wrong answer for a permanently higher origin load
  and still serves a stale index for the length of the TTL. *Purging via the Cache API on flip* — `caches.default`
  is per-colo, so a Worker cannot purge the other 300; that needs the zone-level purge API and therefore
  credentials, an auth token in the publish script, and a failure mode where a half-purged flip is worse than
  none. *Putting the hash in the path* (`/v1/index/<hash>`) — honest, but it makes the client resolve a build
  before it can fetch anything, which is a round trip added to every cold start to fix a cache bug.
- **The inline fallback is not cached at all.** Its body is whatever upstream returned to *this isolate*;
  nothing addresses it, so there is no honest key for it. The first cut of this ADR gave it a constant
  `__build=inline`, which quietly rebuilt the defect on the fallback path — a 6 h entry keyed on nothing that
  moves, which no publish could ever displace. **Caught in review, not by the gates**, and now pinned by a
  test that changes upstream between two inline requests and was watched failing against the constant key.
  `readManifest` maps *any* KV failure to `null` and deliberately never memoizes one, so this path is reached
  by a single unreadable `build:current`, not only by a KV-less deployment.
- **Consequences:**
  - Every `cached()` endpoint inherits this, not just `/v1/index`. `/v1/stop`, `/v1/route` and `/v1/etas` were
    never really exposed (a 30 s TTL bounds their staleness), but they are now correct for the same reason
    rather than by accident of being short-lived.
  - **`/v1/nearby` is dataset-derived and is _not_ covered.** It caches inline rather than going through
    `cached()`, and still keys on the URL, so a flip can leave it serving the previous build's places for up
    to `ETA_TTL_SEC` (30 s) per colo. Bounded, so low-impact — recorded here rather than left to be
    rediscovered, because the obvious reading of this ADR is that every dataset-derived endpoint is now safe,
    and one is not.
  - **The live ETA and tile paths are untouched** and still key on the URL: neither is derived from the
    dataset, so a build hash in their key would fragment the cache for nothing.
  - **During a KV outage an isolate now builds the inline index where it might previously have served a warm
    colo entry**, so `datasetBuildsThisIsolate` can be non-zero while `build:current` is unreadable. That is
    the counter doing its job rather than the WP0-1 invariant breaking: the invariant is *0 in healthy
    production*, and an outage is precisely the degradation the number exists to surface. The alternative —
    serving a possibly-hours-old index because the dataset layer is down — is the failure this ADR is about.
    `inlineSource()` memoizes per isolate, so the cost is one build per isolate: ADR-055's own
    degrade-to-slow promise, and no worse than a cache miss during the same outage would already have been.
  - `getDataset` runs **inside** `cached`'s `try`. It is a KV read, so a throw from it is upstream I/O and
    must be classified `upstream_unavailable` with the endpoint's context, not stamped `internal` by the
    top-level handler — `internal` means *our* bug (ADR-064), and mislabelling KV I/O as one both misleads a
    retrying client and pollutes the unhandled-error log used to find real defects. Also caught in review.
  - The tests assert on the **served bytes** across a flip, not on the key's shape — a key-shape assertion
    passes against any scheme that merely looks different, and what a rider is owed is the published build.
    Both were watched failing against the code they pin.
  - **Found by verification, not by review or CI.** Wave 2's ETag work was green on every gate; the defect
    only appeared when a real dataset was rebuilt and published against a running Worker. Worth remembering
    the next time an endpoint gains a validator: the test that matters is the one that spans two builds.

## ADR-067 — The contract is published for native consumers, and every part we cannot verify says so
- **Status:** **Decided and implemented 2026-07-29** (WP3-3). Implementation: `packages/contract/README.md`,
  `packages/contract/native/`, `packages/contract/scripts/{native-guide,emit-native-guide,check-native-guide}.mjs`,
  `apps/edge/test/unknown-enum-tolerance.test.ts`. Completes Wave 3.
- **Context:** [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)
  makes wire *shapes* generated, and [ADR-060](#adr-060--the-fixture-corpus-is-the-equivalence-mechanism-for-domain-rules)
  makes domain *rules* corpus-pinned. Both are mechanisms; neither is a document a person can start from.
  A porter arriving at this repo would have found no README anywhere under `packages/`, an OpenAPI
  document whose `info.description` held most of the prose they needed, a corpus whose reader contract
  existed only as TypeScript, and — after Wave 3 — two Swift/Kotlin token files nobody had compiled. The
  work package's own framing is that a native repo starting life with the corpus already wired in is the
  only real mitigation for corpus rot. The hazard is that the mitigation is itself scaffolding, and the
  plan's risk table names it: *"codegen becomes stale scaffolding"*.
- **Decision:**
  1. **`packages/contract/README.md` is written for a reader starting an iOS or Android repo tomorrow**,
     not as an inventory of this monorepo. It answers five questions in order: what to consume, how to
     generate from it, what you will get wrong if you guess, how to wire the corpus into XCTest/JUnit,
     and what is not guaranteed. The last section is the one that earns the rest its credibility.
  2. **`info.description` in `openapi.json` stays canonical for wire conventions; the README transcludes
     it.** The document is canonical because a consumer may only ever receive *the document* — through a
     generator pipeline, a vendored copy, an artefact store — so a rule that lives only in a README is a
     rule half the audience never sees. Restating it in prose was rejected: two copies of the same list,
     one of them hand-maintained, is precisely the drift this wave exists to remove. Three conventions
     Wave 3 created (`sortKey` ordering, `remarkKind`'s absence, `/v1/policy` as advice) were added to the
     **document**, and reached the README by regeneration.
  3. **Every figure the README quotes is generated from the artefact it describes** — endpoint and schema
     counts, per-corpus group/case/`knownDefect` totals, token and string counts — and a gate fails on a
     stale region. **The gate also fails when the README cites a repo path that no longer exists**, which
     is the failure mode nothing else in the repo can see: WP3-1 deleted `packages/ui/src/tokens.ts`, and
     a document pointing at it would read as authoritative forever.
  4. **The XCTest and JUnit conformance files ship as templates, with a banner stating they have never
     been compiled and never been run.** Three options were weighed. *Ship nothing* leaves the corpus
     reader contract as TypeScript only, so the first porter reimplements six subtle rules from scratch
     and gets rule 2 or rule 6 wrong — those are the two that yield a green suite proving nothing.
     *Compile them on a macOS runner* was already descoped by the plan and needs a toolchain, a target
     and models that do not exist. *Ship them labelled* keeps the value (the six rules, resource loading,
     the vendoring warning, the unknown-enum test, a worked `Approx` example) and makes the one thing we
     cannot claim explicit. Deciding this in an ADR matters because the banner is the kind of thing a
     later tidy-up removes on the grounds that it looks unfinished.
  5. **Each template carries a `coveredGroups` set and a test that fails while any corpus group is
     unported.** Red on day one is intended: it is the port's to-do list expressed as a build failure,
     and it goes green exactly when the native client agrees with the web client about every rule. The
     module list it iterates is generated, so a corpus added here cannot be invisible to both suites.
  6. **The unknown-enum obligation is gated as far as TypeScript honestly can, and the limit is
     stated.** `x-unknown-tolerant` binds *generated native decoders*; the PWA is unaffected because its
     schemas erase (`import type`) and it does no runtime validation, and the Zod schemas themselves are
     strict, as the edge requires. So `apps/edge/test/unknown-enum-tolerance.test.ts` asserts the three
     things that are real here — every published enum carries the flag (with an empty, reasoned
     `CLOSED_ON_PURPOSE` allowlist); a reference decoder honouring the document preserves an unknown
     member *and still rejects one for a closed enum*; and Zod rejects it, which is **why** the
     obligation sits on codegen rather than on any gate in this repo.
- **Consequences, including what we are accepting:**
  - **Two artefacts in this repo now carry `UNVERIFIED` banners** — WP3-1's token files and WP3-3's
    templates — and the honest reading is that Wave 3 shipped more unverified native surface than
    verified. That was the trade the owner chose when picking Wave 3 over Wave 4; recording it here means
    the first native repo inherits a known list rather than a discovery.
  - **The templates will rot, and the gate only slows it.** The module list and the cited paths are
    checked; the Swift and Kotlin *bodies* are not, and cannot be. Their value decays from the day they
    are written, which is the argument for the first port happening sooner rather than later, and for it
    sending fixes back.
  - **`packages/contract/test` is now two gates chained with `&&`**, so a stale `openapi.json` masks a
    stale README until the first is fixed. Accepted: the alternative is running a generator check against
    a document that is known stale, whose output nobody should trust.
  - **ADR-060's corpus figure was wrong for two waves** ("36 groups, 274 cases" against a real 65 and
    510) and is corrected in this commit. The correction is a one-liner; the durable fix is decision 3,
    which is why that decision exists at all. **ADR-059's title is also stale** — it says the id corpus
    lives in `contract`, which ADR-060's convergence changed — and is deliberately left alone here rather
    than renaming a shipped ADR's heading; the ABNF's own header now states where the corpus really is,
    and the README says so too.
  - **No CI enforces any of this.** There is still no PR/push workflow (`.github/workflows/` holds only
    `dataset.yml`; `ci.yml` is WP0-5, deferred), so every gate named above runs from a package `test`
    script via `turbo run test` and the pre-commit hook. The README says so in its own "not guaranteed"
    section, because a porter reading "gated" would otherwise assume a server enforces it.

## ADR-068 — The client's derived view is kernel logic, so a second renderer calls it rather than reading the JSX
- **Status:** **Decided and implemented 2026-07-29** (WP4-0, the prerequisite Wave 4's plan row did not
  have). Implementation: `packages/core/src/stop-card.ts`, additions to `packages/core/src/eta.ts`
  (`etaUrgency`, `etaReadout`, `remarkView`, and a `dueUnderSec` parameter on `etaLabelParts`),
  `packages/core/spec/stop-card.spec.json`, and the repointed components in `apps/mobile`.
- **Context:** [`docs/proposals/03`](../proposals/03-clean-separation-and-phase2-plan.md) WP4-1 asks for
  `apps/web` — a Vite + React DOM renderer of one screen — with the acceptance *"CI asserts its derived
  output is **byte-identical** to the RN golden; lines of new logic outside `.tsx` and adapters: **zero**"*.
  Both halves presupposed an artefact that did not exist. There was no *derived output*: no view-model
  layer on the client (`check-vm-no-styling` polices the wire), and the plan itself lists a served `/v2`
  view-model tier as the **rejected** alternative. So the derivation had to be client-side — and six of
  them were sitting inside `apps/mobile`'s components, reachable only by rendering a React tree: the
  list's order, the `maxRows` cap and its "+N more" count, the caption's parts and its two different
  separators, destination-else-remark as the headline, the route number and its fallback, and the stop
  name split into label + code. A second renderer's only options were to re-implement each or to read the
  JSX and guess. **A re-implementation would have passed a byte-identity check on the day it was written
  while proving the opposite of the thesis**, which is why this is an ADR and not a refactor.
- **Decision:**
  1. **The derived view is kernel logic and lives in `packages/core`**, under Wave 2's method: copy,
     pin with a language-neutral corpus, delete the original. The module is `stop-card`, not `nearby`,
     because Favourites renders the same card through the same component — naming it after one of its two
     callers would have been wrong inside a week. `nearbyView` (the ordering) is the part that really is
     Nearby's own.
  2. **The line inside the client is the same line ADR-053 draws across the network: content and
     meaning versus layout and colour.** So `etaUrgency` returns `'due' | 'soon' | 'normal' | 'none'` — a
     **name**, never a token and certainly never a colour — and `EtaBadge`'s `soon → text-warning` table
     stays in the view, where it is correct. What could not stay there was the *threshold*.
  3. **`core` owns the rule; `i18n` owns the word** ([ADR-054](#adr-054)). `remaining` is a number and
     `t(locale, 'moreRoutes', { n })` stays in the renderer, because a plural is an ICU rule. The caption
     is the deliberate exception: its parts are already kernel functions (`formatBearing`,
     `formatDistance`, `formatWalk`) and what a second renderer would otherwise have to re-guess is their
     order and the fact that `' · '` binds a distance to its walk time while a wider `'  ·  '` separates
     that pair from the compass direction.
  4. **The expectations in the corpus were derived from the implementation, and that is only honest
     because a parity harness proved the implementation first.** A temporary harness transcribed the old
     `.tsx` derivations verbatim and diffed both over real `/v1/nearby` snapshots: **30 cards / 120 rows
     across 3 locales, with every difference declared in advance.** The harness was watched failing on an
     injected cap change (exit 1, measured directly rather than through a pipe) and then **deleted** — a
     shipped parity harness would be a second declaration of the very rules being consolidated.
  5. **`etaReadout` and `remarkView` are extracted too, because the Place screen was the second copy.**
     `app/stop/[id].tsx` derived label, urgency, staleness and the remark's locale/classification by hand,
     in parallel with the Nearby card. Leaving that copy behind while Nearby moved is precisely how the
     imminence threshold came to disagree with the policy in the first place; the two screens now call one
     function. The three fields travel together because they must **agree** — the label's "Due" band and
     the urgency's `due` band are the same `dueUnderSec`, so a caller computing one with a served policy
     and the other with the default renders the word "Due" in the ordinary colour.
  6. **`apps/web` was added to `layers.json` and to `check-no-raw-colours.mjs` before it holds a single
     file.** Every dependency-cruiser rule the generator emits is keyed `from` a layer dir, and the only
     rule with a non-layer `from` is `no-circular` — so a directory absent from that list is the `from` of
     **no rule at all**. A new app would have been free to import `data-normalize` or to call an upstream
     HK API directly with golden rule 2 silent. All three nets were watched firing on an injected probe.
- **The bug this found before any second renderer existed:** `EtaBadge` decided imminence with a literal
  `parts.value <= 5` — **360 s**, since `value` is floored minutes — while `CLIENT_POLICY_DEFAULTS`
  served **`warnUnderSec: 180`** and the comment on that field read *"Nothing reads this yet"*. Both were
  true: the field had no reader, and the screen had its own number. That is
  [ADR-053](#adr-053)'s three-way arrival-cap disagreement one field over, and the **seventh** instance in
  this repo of one judgement written down twice. In a live sample it mis-coloured **7 of 40 rows**. The
  band is now the served one, which is the single user-visible change in this work package: an arrival
  between 3 and 6 minutes away is no longer coloured as "run".
- **Consequences, including what we are accepting:**
  - **The visible change is a narrowing, and it is deliberate.** Riders who learned that amber meant
    "within about five minutes" now see amber only under three. The alternative — moving `warnUnderSec` to
    300 to preserve the appearance — would have kept a number nobody had chosen and thrown away the reason
    the field exists.
  - **`etaLabelParts` gained a fourth parameter**, closing the Wave 3 loose end from the other side: it
    was the one place a served `dueUnderSec` was silently dropped, and it happens to be the widest-reached
    ETA renderer in the app. `staleAfterMs` is threaded too. Neither changes anything today, because the
    served values equal the defaults — the trap was that the day one of them changed, only some callers
    would have moved.
  - **`remarkView` accepts `null` as well as `undefined`, and the type is wider than `Eta.remark`'s.**
    The app does no runtime validation ([ADR-052](#adr-052) decision 2), so an explicit `"remark": null`
    reaches the kernel however the schema types it. The component this replaced read the field through
    optional chaining and survived; the first cut of the extraction guarded `=== undefined` and threw.
    **No live sample would have caught that** — real feeds do not currently send it. A corpus row did.
  - **Two of the four gate scopes for `apps/web` are armed but unexercised until the package is real.**
    A bare `@nextbus/data-normalize` specifier is unresolvable before `apps/web` has a `package.json`, so
    dependency-cruiser cruises nothing and reports clean; Biome's textual rule fires regardless. That the
    two-net design of [ADR-051](#adr-051) covers the gap is the reason it has two nets, and it is worth
    knowing rather than discovering.
  - **The second CSS emit target for `apps/web` is deliberately deferred to WP4-1**, not forgotten: it
    cannot be emitted into an app that does not exist, `check-tokens-current.mjs` iterates the emitter's
    own output so the target is drift-gated the moment it is added, and nothing in `apps/web` can render
    without the custom properties. That is the one deferral here that cannot rot unnoticed.
  - **"CI asserts" remains unenforced.** `.github/workflows/` still holds only `dataset.yml`, so the
    corpus runs from `packages/core`'s `test` script via `turbo run test` and the pre-commit hook — the
    same position ADR-067 records. WP4-1's byte-identity assertion inherits it.
  - **`pnpm install --frozen-lockfile` had been failing on `main`** since Wave 1 wrote the lockfile and
    `apps/edge` later gained `@nextbus/contract`. Nothing noticed because every local install was
    non-frozen; CI defaults it to true, so the workflow WP4-1's acceptance assumes would have died at
    install before a single gate ran. Fixed here because adding a workspace package forces it anyway.

## ADR-069 — A second renderer, and what it caught in the first
- **Status:** **Decided and implemented 2026-07-29** (WP4-1, completing Wave 4). Implementation:
  `apps/web/**` (Vite 8 + React DOM + plain Tailwind 3.4), `packages/api-client/src/location.ts`,
  `bearingOctant`/`bearingOctantDeg` in `packages/core/src/geo.ts`, `apps/web/scripts/check-no-derivation.mjs`,
  `apps/web/test/nearby-projection.test.tsx`, and a second CSS emit target in `packages/ui`.
- **Context:** The plan calls WP4-1 *"the cheapest empirical test of the whole thesis"* — everything else
  in it makes unfalsifiable claims about what Swift will need; this one is testable today.
  [ADR-068](#adr-068) had to come first, because the acceptance presupposed a derived view that did not
  exist. With `stopCardView`/`nearbyView` in the kernel, a second renderer becomes a fair test: if the
  thesis holds, `apps/web` is elements and classes and nothing else.
- **Decision:**
  1. **One screen, no navigation, no persisted cache, no locale override.** Each is real work and none
     of it tests the thesis; every line added is a line a reviewer must read before believing the claim.
     The consequence is stated in the file: `Nearby` takes no router, and that is its *only* structural
     difference from `apps/mobile/app/(tabs)/index.tsx`.
  2. **`vite` is pinned to `8.0.16` exactly**, the version already hoisted as vitest 4's peer. Golden
     rule 6 is the scar from two majors of one package fighting over a single hoisted binary under
     `node-linker=hoisted`, and vite carries esbuild. `@vitejs/plugin-react` had to go to `6.0.4`, the
     first line that declares vite 8 — the install told us, which is the value of a peer range.
  3. **The token pipeline gained an emit target rather than a copy.** `check-tokens-current.mjs`
     iterates whatever `generate()` returns, so `apps/web/src/tokens.css` is drift-gated by
     construction; a hand-copied file would have been correct the day it was written. The variables are
     **byte-identical to `apps/mobile/global.css`**, and the generated NativeWind-flavoured `preset.js`
     was **verified**, not assumed, to work under plain Tailwind 3.4: every semantic utility, the whole
     type scale, the radii and the `.dark` block appear in the built CSS.
  4. **The `useLocation` state machine moved to `packages/api-client`, and `apps/mobile` now consumes
     it too.** `LocationProvider`'s own doc names the three things that sit on top of it — the mandatory
     `snapFix`, the remembered fix, and deliberately no `watch()` — and all three were inside an RN hook
     (ADR-051: *"conflates the port with shared logic"*). Duplicating them would have meant two answers
     to "what does a rider see while the GPS warms up". `client` is the only layer that may compose
     `kernel` and `ports`, so that is where it went; the package's name is narrower than its contents
     now, which is an honest mismatch and cheaper than a package per shared concern. Each app is left
     with a three-method adapter and a ten-line hook, and **they are the same ten lines.**
  5. **`bearingOctant` is shared, because the needle and the word are one rule.** `BearingArrow` had its
     own `Math.round(deg / 45) * 45`, which agrees with `formatBearing` for every real bearing but omits
     the range normalisation — so a negative value would have pointed the needle somewhere the label does
     not name. Porting the screen would have made a third copy.
  6. **A gate, `check-no-derivation.mjs`, polices the renderer for *shapes* rather than names:**
     ordering, capping, selecting, string-joining, arithmetic, and comparison against a numeric literal.
     Calling a kernel function is correct and must never be flagged; computing an answer is the
     violation. `src/adapters/` and `src/hooks/` are exempt *by the acceptance criterion itself*. It has
     eight selftest scenarios including two controls, and it fails when it matches no files.
  7. **The equivalence assertion uses the corpus as its golden**, not a fixture invented for it. Every
     `stopCardView` case is rendered and its visible text compared against a projection of the same
     view — so the renderer is proven to add no string and drop none, over real dataset rows, in the same
     file a Swift or Kotlin suite reads.
- **What the second renderer caught in the first — the return on the whole wave:**
  1. **HTML collapses the caption's deliberate double separator.** `stopCardCaption` uses `' · '` to bind
     a distance to its walk time and a wider `'  ·  '` to separate that pair from the compass direction.
     The DOM collapses consecutive whitespace, so the web card read *"Southwest-bound · 170m · 2 min
     walk"* against React Native's *"Southwest-bound  ·  170m · 2 min walk"* — the same string,
     rendered differently. Fixed with `whitespace-pre-wrap` and pinned. **My first version of the test
     could not see it**, because it normalised whitespace before comparing: a test that launders the
     property it checks is worse than none.
  2. **The "+N more" count was hidden whenever it could not be tapped.** Both components guarded it with
     `remaining > 0 && onPress`, so a caller with nowhere to navigate showed six of twenty-six routes and
     said nothing — the silent filter ADR-008 forbids. Every caller in `apps/mobile` passes `onPress`,
     which is why it had never fired; this app's single screen does not. Fixed in **both** renderers: the
     tap is optional, the truth is not. The regression test was watched failing against the old guard.
  Neither was reachable by reading the code, and neither is a bug in `apps/web`. That is the argument for
  Wave 4 existing, made concretely rather than in the abstract.
- **Consequences, including what we are accepting:**
  - ✅ **Closed the same day — "byte-identical" is now measured on both sides.** This consequence was
    originally recorded as an open gap: the web renderer was proven a faithful projection of the view and
    the RN renderer was not. It is now `apps/mobile/test/stoprow-projection.test.tsx`, and the addendum
    below records how it was closed, including the attempt that failed.
  - **`check-no-derivation` polices `apps/web` only.** `apps/mobile`'s route, search and workbench
    screens still hold rules WP4-0 did not hoist, so the same rules would fire on legitimate un-migrated
    code and the gate would be switched off within a week. The asymmetry is deliberate, recorded in the
    script, and closes when Place and Route detail get their own WP4-0.
  - **`biome.json` gained `css.parser.tailwindDirectives`** so `@apply` parses — taught, not silenced,
    the same choice Wave 3 made for the `@tailwind` at-rule. Its `overrides` block is still generated
    from `layers.json`; only the top level is hand-edited.
  - **`packages/core` now exports `./spec/*`.** The corpus is a consumable artefact — `apps/web` asserts
    against it and the native templates tell a porter to vendor it — so it has a stable specifier
    instead of a relative path that breaks when the layout moves. A small step toward the unsolved
    corpus-vendoring problem, not a solution to it.
  - **Two configs are `.cjs`.** `apps/web` is `"type": "module"` and both Tailwind's and PostCSS's config
    formats are CommonJS, as is the generated `preset.js`. Renaming beat adding a `createRequire` shim to
    import a config the RN app requires directly.
  - **No `apps/web` deploy, and no CI.** `vite build` produces `dist/` (260 kB JS, 84 kB gzipped) and
    nothing publishes it; `.github/workflows/` still holds only `dataset.yml`. Both belong to WP0-5.


### Addendum (2026-07-29) — closing the one-sided measurement, and the cheap gate that did not work

**The gap was measured before it was fixed.** Deleting the inline `<Text>{view.caption}</Text>` from
`apps/mobile/components/StopRow.tsx` — so every card silently loses its compass direction and distance —
passed `turbo run typecheck`, `pnpm lint` **and all 686 tests**. A narrower correction to the original
wording: deleting a field rendered through a *dedicated imported component*
(`{row.remark ? <RemarkTag …/> : null}`) *is* caught, incidentally, by Biome's `noUnusedImports`. It is
the **inline** fields — the caption, the headline, the code, the minutes unit — that nothing guarded.

**A cheaper gate was designed, built, tested against that failure, and deleted, because it did not
work.** The idea was to assert that every field of `StopCardView` is *referenced* somewhere in each
renderer's render path, with the field list parsed out of `packages/core/src/{stop-card,eta}.ts` so it
could not go stale. It passed the deletion. The reason is worth recording because it generalises:
**"referenced" is not "rendered"** — the surviving guard `{view.caption ? (…)}` still mentions `caption`,
and no textual rule separates a guard from a render. Sharpening it to "appears in value position" fails
too, because a discriminant is only ever compared (`label.kind === 'mins'`) and a boolean is only ever a
condition (`stale ? 'opacity-45' : ''`). Shipping it would have added a gate that passes on the exact
failure it was built for — this repo's own recurring bug, and worse than having no gate at all.

**What worked was rendering the tree.** `react-native` is aliased to **`react-native-web`** in a new
`apps/mobile/vitest.config.ts`, and the RN card is rendered in jsdom and read back through the *same*
projection `apps/web`'s suite uses. Three things make this honest rather than convenient:

  1. **`react-native-web` is a ship target, not a stand-in.** It is how Expo renders the PWA, so one of
     the three platforms is now covered directly. `react-test-renderer` was the alternative and would
     have needed `@react-native/babel-preset` to strip Flow types out of the `react-native` source while
     still not exercising a real layout.
  2. **The projection function is duplicated in the two suites on purpose, not shared.** It is the
     *specification* each renderer is measured against; a shared helper would let one edit silently relax
     both. If the copies ever disagree, that is the signal.
  3. **The one shortcut is asserted rather than assumed.** `lucide-react-native` cannot load outside
     Metro (its `.mjs` entry imports names its own `context.mjs` does not export, and inlining it drags in
     `react-native-svg`'s Flow source), so it is aliased to `lucide-react`. That is only legitimate if
     icons contribute no text — so a test renders a card whose only content is a caption and asserts
     exactly two text nodes alongside a non-zero `<svg>` count. If either package ever ships a label, it
     fails.

**What is still not covered, and now precisely:** iOS and Android *native* rendering. `react-test-renderer`
would not have covered it either. What is covered on all three platforms is the thing that actually goes
wrong — a component dropping, duplicating or reordering a field — because the component tree under test is
the same source Metro bundles.

**One incidental finding.** `apps/mobile` resolves TypeScript **6.0.3** while every other package is on
5.9.3 (CLAUDE.md golden rule 6 says 5.9 for shared packages), and 6.0 rejected a cast that 5.9 had
accepted in the *web* suite: the corpus states absent optionals as JSON `null`, and both suites were
asserting them into `string | undefined`. Both now convert rather than cast. The version divergence is
pre-existing and unaddressed; it earned its keep here.

## ADR-070 — A turbo task's hash must include everything it reads, and says so
- **Status:** **Decided and implemented 2026-07-29.** Implementation: `turbo.json` (root),
  `packages/contract/turbo.json`, `apps/mobile/turbo.json`, `apps/web/turbo.json`.
- **Context:** turbo hashes a task from its package's own files, plus its internal dependencies' when the
  task declares a topological `dependsOn`. Both root `test` and `typecheck` were `{}` — neither. Three
  gates in this repo read files **outside** the package whose task runs them, and each replayed a stale
  pass in turn:
  1. **Wave 2** — `@nextbus/mobile:typecheck` replayed across a `packages/core` source change, so the app
     could report green without being rechecked. Recorded in `docs/11` and worked around with `--force` on
     every integration run since. A flag somebody has to remember is not a fix.
  2. **WP3-1** — `@nextbus/ui:test` cached while its drift gate read `apps/mobile/global.css`. Closed with
     `cache: false`.
  3. **Wave 4** — `@nextbus/contract:test` checks that `README.md` and the two native conformance
     templates quote the *current* corpus figures, and the corpus lives in `packages/core`. WP4-0 added a
     corpus module and WP4-1 grew two more, so those three artefacts went stale — and **the task replayed
     a green log from a different worktree's run days earlier**, because the turbo cache is shared across
     the agent worktrees under `.claude/worktrees/`. It was green locally, red on a clean checkout, and it
     **merged that way**: `origin/main` at `3c9fb37` fails `pnpm test` on a fresh clone.
- **Decision:**
  1. **Root `typecheck` is `dependsOn: ["^typecheck"]`.** A package's hash now includes its internal
     dependencies', which is the property that was missing. `--force` is no longer needed and should not
     be used to paper over a hash that is wrong.
  2. **Where a task reads outside its package, it declares that with `inputs`** —
     `["$TURBO_DEFAULT$", "$TURBO_ROOT$/packages/core/spec/*.spec.json"]` in `packages/contract`,
     `apps/mobile` and `apps/web`. **Declared rather than switched off**, diverging from WP3-1's
     `cache: false`: the dependency is real, stating it teaches a reader what the task reads, and the
     cache keeps working. `cache: false` remains right where the read set is not expressible as a glob.
  3. **`dependsOn` is deliberately NOT used for `test`.** It would serialise every suite behind the
     kernel's for no gain, and — decisively — it could not have fixed the contract case at all:
     `@nextbus/contract` does not depend on `@nextbus/core`. The graph runs the other way, `core` imports
     `contract`. A dependency-based fix is unavailable precisely where the bug was worst.
- **Consequences, including what we are accepting:**
  - **`origin/main` is red until this lands.** Worth stating plainly rather than folding into a changelog:
    the merged Wave 4 PR left the tree failing a gate, and the only reason nobody saw it is that the cache
    hid it. This is the argument for WP0-5's `ci.yml` in one sentence — a clean checkout is the only
    honest test. ✅ **Since Wave 5 something performs one:** `.github/workflows/ci.yml` runs
    `pnpm install --frozen-lockfile` and the whole gate set on a fresh checkout for every PR and every push
    to `main` ([ADR-056](#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)).
  - **The declaration is per-package and can go stale.** A future gate reading somewhere new must add its
    own `inputs` entry, and nothing enforces that it does. The general fix would be a check that every
    file a task opens is inside its hash, which needs tracing rather than static analysis; recorded as the
    residual rather than pretended away. **It fired twice more inside Wave 5**, which is how quickly: `apps/edge`
    had no `turbo.json` at all while its suite asserts the OpenAPI document's shape *and* imports the kernel's
    live constants, and `apps/mobile` declared the corpus but not `packages/core/src`, which its two new suites
    read through the components they render. Both now declare it, proven by a content change to
    `packages/core/src/live.ts` turning both tasks from `cache HIT` to `cache MISS`. Instances four and five of
    the same shape, in the ADR that exists to record it.
  - **The shared worktree cache is a hazard in its own right.** A pass computed in one checkout satisfies
    a task in another, so "it was green on my machine" can mean "it was green in a checkout you have never
    seen". `--force` remains the right tool when *diagnosing* a suspicious green; it is the wrong tool for
    living with one.

## ADR-071 — What counts as one boarding point, and what a rider is told about two
- **Status:** **Decided and implemented 2026-07-31** (WP5-10 + WP5-11, on `wave5-followups-v1`).
  **Amends [ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant)**
  (a cluster's poles are now folded onto *boarding points*) and closes
  [ADR-062](#adr-062--the-favourite-key-is-the-member-pole-and-the-scheme-is-versioned)'s orphaning hazard
  **structurally rather than by migration**. Implementation: `foldDuplicatePoles`,
  `SAME_POLE_MAX_SEPARATION_M` and `sameLabelEverywhere` in `packages/data-normalize/src/dataset.ts`
  (+ `allAliases` in `shards.ts`); `StopDetailPole.aliasIds` in `packages/contract/src/wire/detail.ts`;
  `boardingPoleId`, `dedupeRoutes(routes, members)`, `poleSideOctants` and `POLE_SIDE_MIN_SEPARATION_M`
  in `packages/core/src/stop-detail.ts`; `initialBearingDeg` in `packages/core/src/geo.ts`; eight
  `poleSide*` keys + `poleSideLabel` in `packages/i18n`; `atPole` in `apps/edge/src/stop-route.ts`; the
  Place screen `apps/mobile/app/stop/[id].tsx`. Pinned by `apps/edge/test/pole-merge.test.ts` (13 tests
  in workerd over a seeded KV build, one of them off a real `/v1/live` socket) and the corpus
  (`stop-detail` + `geo`; 86 groups · 726 cases · 3 `knownDefect`, `core` still 100 % on all four
  thresholds over 415 branches; 977 tests). The dataset moves `d598893de6add2e4` →
  **`1ccad7436a8df480`**, so production needs a publish.
- **Context:** [ADR-056](#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)
  decision 13 put the boarding pole into a route row's identity, which is noise for KMB and Citybus and
  **identity for GMB**. The accepted cost was a display one: where two members of a place print the same
  heading, a line boarding at both renders **twice, under two labels identical character for character**,
  and the rider is asked to choose between two rows with nothing to choose with. WP5-10 was to label the
  heading; WP5-11 was then filed *by WP5-10's measurement*, which found that most of those pairs are one
  physical pole published under two upstream ids. They are recorded as one ADR because they are one
  decision seen twice — **what counts as a distinct boarding point, and what a rider is told about it** —
  and because each rule's correctness argument is the other rule's declining to act.
- **The measurement that disproved WP5-11's premise, which is why the row was rewritten rather than
  satisfied:** the row assumed a distance gap between "one pole published twice" and "two genuine
  berths", and there is none.
  - Over `d598893de6add2e4`, the **516** member pairs sharing an operator *and* a full name within one
    place run **continuously from 0 to 31 m, with every band populated** — 88 · 11 · 47 · 109 · 164 · 71
    across 0–0.5 / 0.5–2 / 2–5 / 5–10 / 10–20 / 20–31 m. Those bands total **490**; the remaining **26**
    sit at **31.8–54.9 m**, i.e. *beyond* `MERGE_RADIUS_M` (30 m), and are in one place only because
    clustering is **single-linkage** — A–B and B–C each inside the radius puts A–C at 55 m (ADR-042). The
    discrepancy is recorded rather than reconciled away because the tail is where the *clearest* genuine
    berths live: **ND126, at 35.35 m, is in it**. Anyone tempted to make the figures add up by widening
    the last band would be folding two boarding points a rider has to choose between.
  - **The genuine two-berth stands sit *inside* that continuum**: KMB prints one code on poles
    **TN507 22.88 m**, **TN581 19.01 m** and **ND126 35.35 m** apart, while Tin Shui Wai Park's duplicated
    **TN510** pair is **1.11 m**. So the thing not to swallow and the thing to fold are drawn from one
    distribution.
  - **Route-disjointness discriminates nothing**, and it was the obvious second signal. Re-measured over
    the 464 pairs matching in all three locales: **24 overlap**, they do not sort by distance (8 of them
    in the *nearest* band), and disjointness is the norm at every distance including 36 of 36 at 25–31 m.
    It is not evidence, in either direction, and the rule does not use it. (An earlier note in the stopped
    work claimed all 464 were disjoint; that figure was wrong and is corrected in the docblock.)
  - **No threshold above ~2 m can separate the two populations.** The row's original acceptance — *"no
    place shows two identical headings"* — is therefore unachievable, and was reworded **with the work
    stopped** rather than quietly failed after shipping. A row that promises it is a row someone later
    satisfies by lowering a threshold until it lies.
  - The ambiguity is also 9× wider than the plan's row assumed: **567 of 10 118 places print a duplicate
    pole heading**, and only **64** are stop-code collisions — **507** are poles with no printed code at
    all (two Citybus poles at Peaksville both reading just "Citybus"). Neither the code nor the name
    separates them, so `location` is the only field on the wire that can, which is what makes the labelling
    rule a kernel rule rather than a screen decision.
- **Decisions:**
  1. **`SAME_POLE_MAX_SEPARATION_M = 2`, and it is not a guess.** Two poles fold only where a rider could
     not possibly tell them apart: **same operator, the same name in all three locales, and complete-linkage
     separation ≤ 2 m**. The number comes from the **coordinate quantisation**, not from the histogram —
     upstream publishes five decimals, so a position is a point on a ~1.1 m grid and two feeds describing
     one pole can differ by at most one grid step per axis — and the build *confirms* the derivation rather
     than merely permitting it: all **85** qualifying pairs sit at **exactly four** separations
     (**0.000 m ×75**, **1.027–1.029 ×3**, **1.112 ×4**, **1.515 ×3**) with **nothing** between the grid
     diagonal and two steps (2.058 m). The boundary must lie in **(1.515, 2.058)**; 2 is the round number
     inside it, so its exact value changes no outcome. **A native port must copy this number exactly** —
     a discrete distribution is the signature of the grid, and a port that rounds it to 3 m starts merging
     berths. Three supporting choices: **complete linkage, not single** (chaining would let 0 m / 2 m / 4 m
     become one 4 m group, which is two grid steps and unsupported by the argument); **the lowest id
     survives**, because it is already the head of the sorted member list and does not move when routes or
     coordinates change; and **distance is necessary, never sufficient** — `sameLabelEverywhere` does the
     real work, which the build proves, since **TN511 shares a coordinate *exactly* with the surviving
     TN510 pole and is not folded** because its printed code differs and a rider can read it.
  2. **The two thresholds must stay different numbers, and both docblocks say so.** 2 m to fold two ids
     into one pole; **`POLE_SIDE_MIN_SEPARATION_M` = 10 m** before `poleSideOctants` will name a compass
     side. **Declining to name a side is a weaker act than asserting two poles are one** — the first fails
     by saying nothing, the second fails by hiding a berth — so the weaker claim gets the looser threshold.
     Recorded because they sit two packages apart, answer adjacent questions, and somebody will otherwise
     tidy them into one constant. (The 10 m floor has three independent derivations of its own, in
     `POLE_SIDE_MIN_SEPARATION_M`'s docblock: `formatDistance` already rounds metres to the nearest 10 under
     [ADR-008](#adr-008--etas-are-approximations-no-client-side-fake-countdown), so an app that refuses a finer
     *distance* must not imply a finer *direction*; ~10 m is the GPS error `mercator.ts` already names; and
     below ~2 m the octant is not even *stable* — ±0.55 m per axis is ~21° of bearing wobble at 2 m against
     an octant's 22.5° half-width, versus ≤ ~9° at 10 m.)
  3. **The id-spelling rule, which is the one a port will get wrong.** **A reading is stamped with the pole
     whose board it came off** — the id the route's own row names — **never with the boarding point that row
     is displayed under**; **an alias is an *addressable pole*, not a spelling to be replaced**; and **the
     wire and everything persisted speak raw pole ids**. The fold is a display collapse on the client's side
     of the wire. Concretely: `atPole(call.poleId, …)`, the fare table keyed on the row's own `stopId`, and
     `boardingPoleId` used only to *group* and to *key*.
     **The first design got this backwards and it is worth recording that it did.** It stamped each reading
     with the boarding point, so a route boarding **only** at a folded pole had a row naming the folded id
     and a reading naming the survivor: `applyLiveEtasToStopDetail` matches `(row.stopId, row.route.id)` over
     the **raw** `StopDetail` in the query cache, so the merge matched nothing and **every arrival on that
     row blanked one cadence after paint, with no error anywhere**. All three live paths share one stamping
     site (`/v1/etas/:id`, `/v1/stop/:id`'s embedded readings and the `EtaHub` frames all reach `atPole`), so
     one line broke three engines and one line fixed them — which is also why the proof drives all three
     rather than reasoning from the shared site, since "one site, so they must agree" is exactly the
     reasoning that shipped the last spelling bug. It also restores the invariant
     `apps/edge/test/eta-stop-id.test.ts` has asserted since Wave 5, `row.eta.stopId === row.stopId`, which
     had passed only because its fixture has no aliases.
     **This is the third time the same shape has appeared in this project**, and that is the reason it is a
     numbered decision rather than a commit message: (a) `Eta.stopId` carrying the *operator's* spelling
     where the schema declares the identity canonical (ADR-056 decision 3 — every reader compared two
     alphabets and matched nothing, always); (b) the live merge's `(stopId, routeId)` pair, which is the
     tuple that made (a) visible; and (c) this. Each was a case of one id being written in two alphabets and
     no test spanning them.
  4. **The collapse lives in the *key*, so no future call site can repeat the mistake.** `dedupeRoutes(routes,
     members)` keys on the boarding point and **returns the rows untouched, raw pole id and all**. That shape
     is load-bearing rather than incidental, and it avoided a *second* orphaning found while settling the
     first: the screen was re-basing each row's `stopId` before deduping, and `SaveStar` persists
     `${row.stopId}|${routeId}` — so **starring a re-based row would have written a favourite key that no
     `/v1/stop` response will ever carry**, orphaning the favourite at the moment the rider created it. The
     feature would have caused the exact failure it exists to prevent, from the display side. A call site
     that never holds a rewritten row cannot make that mistake. `members` defaults to `[]`, which is the
     previous behaviour and the right answer for the ~10 040 places with no aliases.
  5. **`StopDetailPole.aliasIds` is additive-optional** — free per
     [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)
     §5 — **and it answers ADR-062 structurally rather than by migration.** Both ids stay permanently valid
     favourite keys, because the wire keeps naming both and `allAliases` is derived from `placeByStopId`
     rather than from each place's `members`, so the two cannot disagree about which poles resolve
     (**6 354 keys before the fold, 6 354 after — not one id stopped resolving**). **This is the stronger
     form of the answer: a migration has to run, an invariant does not.** ADR-062 exists because a
     place-keyed favourite was stranded by a clustering change; a fold that *removed* an id would have
     stranded every favourite saved at it and needed a numbered migration step, with all the ways one can
     fail to run. Nothing is deleted instead — a folded pole keeps its stop record, its route rows, its slot
     in every route's stop sequence, its `alias:` entry and its place in the `P:` id. Merging what a place
     *displays* is reversible; deleting an id a rider holds is not.
  6. **`poleSideOctants` names a side only where two headings collide, and declines rather than inventing
     one.** Five things about its shape, each measured rather than assumed:
     - **The kernel returns an octant (`0`–`7`, clockwise from North) and `i18n` supplies the word**
       ([ADR-054](#adr-054--design-tokens-and-i18n-as-generated-cross-platform-artefacts)) — eight
       `poleSide*` keys via `poleSideLabel(octant, locale)`. These are
       deliberately **not** `formatBearing`'s words: that renders the same eight octants as *travel*
       directions ("Northeast-bound"), which would print a heading about where the buses go over a group of
       routes mostly heading the other way. "East side" / 「東面」 is a side of this place, not a service.
     - **It speaks only where two poles of one place print the same heading**, so **226 places gain a side
       and 9 892 render exactly as they did**. Restraint is the design: a cue that appears on 2 % of places
       means something when it appears.
     - **The centroid is of the *colliding* poles, not of the place.** With the place centroid a colliding
       pair off to one side of a five-member interchange gets two bearings a few degrees apart and the
       separation guard **discards 11 of the 15 cases it should keep** — measured, which is why this departs
       from the obvious reading. Relative to each other is also the comparison a rider's eyes make, and for
       a pair the bearings are reciprocal, so the two sides are opposite by construction.
     - **The heading text is an argument, not something the rule derives, because *whether two headings
       collide is itself locale-dependent*.** At Shau Kei Wan East Government Secondary School three KMB
       poles print bare "KMB" in English while upstream gives one of them `(ED522)` in both Chinese
       locales — so the place is ambiguous **three ways in `en` and two ways in Chinese**. A rule that
       rebuilt the heading from `name.en` would answer the wrong question in two of the three locales we
       ship; one that compared ids would answer it in none. Both readings are corpus rows.
     - **It declines rather than inventing an ordinal**, and there is no fallback anywhere — not in the
       kernel, not in the `.tsx`. 345 of the 571 groups get nothing: 331 because a member sits inside the
       10 m floor, and **14 because two of three colliding poles land in one octant** (checked separately,
       since reciprocity only saves a pair; printing those would leave two headings identical *and* longer
       while claiming the ambiguity was resolved). **"1 of 2" is a number a rider cannot walk anywhere
       with, which is the same dishonesty ADR-008 forbids for ETAs** — and worse here, because it
       manufactures a distinction between two poles that are, on the ground, one pole. That those are
       mostly *exactly* what the declined cases were is what filed decision 1.
  7. **`buildPlaces`' private copy of the bearing calculation is deleted**, in favour of the kernel's
     `initialBearingDeg` — the pipeline held the repo's only initial-bearing expression, private to the
     offline build, where no rule the app runs could reach it, and the labelling rule needed one at render
     time. It was transcribed character for character (association included) rather than reassociated to
     match `haversineMeters`, and **verified bit-identical (`Object.is`) over 18 430 real coordinate pairs
     from the shipped build** before the pipeline was switched over; `geo.test.ts` now holds the pipeline's
     own expression beside ours and compares them exactly. That is not ceremony: those bearings feed
     `BEARING_SPREAD_CAP_DEG`, so **a last-bit difference could change which poles cluster into a place and
     republish the whole 8.3 MB dataset under a new hash** for no reason anyone could see. A bearing written
     twice, with sign conventions easy to get subtly right in one copy and wrong in the other, is precisely
     the drift [ADR-060](#adr-060--the-fixture-corpus-is-the-equivalence-mechanism-for-domain-rules) exists
     to catch.
- **Why — the effect over the rebuilt build `1ccad7436a8df480`:** **80 poles folded across 75 places**,
  members **6 354 → 6 274**, 30 places falling to a single member, places printing a duplicate pole heading
  **567 → 496** and colliding groups **571 → 498**. Place counts are unchanged **by construction**, not by
  luck: the place id and the `< 2` cluster gate are both minted from the *clustered* set. **TN507, TN581 and
  ND126 are each still two members**, asserted both synthetically and through the running API; the widest
  separation among all 80 folded poles is **1.515 m**, the grid diagonal, so nothing sits near the threshold
  from either side. `poleSideOctants` barely moves (**226 → 227**), which is the honest reading and the
  argument for doing both halves: **the fold removes cases rather than making them nameable.** **Every defect
  either rule prevents was watched failing first**, which is the standing rule of this wave and the only
  reason the assertions are worth anything: with `poleSideOctants`' two guards deleted, Tin Shui Wai Park came
  out North *and* South from a 1.11 m offset, the coincident pair came out North and North (`atan2(0,0)`), and
  the school came out North / North / South; and against the pre-fix tree, four `pole-merge` assertions went
  red, including the live merge returning `undefined` for a route boarding only at the folded pole — on all
  three engines, one of them read off a real `/v1/live` socket.
- **Consequences, including what we are accepting:**
  - **The favourites requirement outranked the feature and was proved end to end, not read.** Rebuilt →
    `dataset:publish --local` → `pnpm dev:edge` with `/v1/health` reporting `"dataset":"kv"`,
    `datasetBuildsThisIsolate: 0`; then a favourite keyed on a **merged-away** pole
    (`KMB:FADDB1E247E62936|KMB:106:inbound:1`) written into the **real** `localStorage` preferences by
    read-modify-write, rendering on the Favourites tab as *A Kung Ngam Road, Chai Wan Road · Northwest-bound*
    with *`106 → Wong Tai Sin  7 min`* under it — then the two test keys removed the same way and the rider's
    own **12** favourites confirmed back exactly as found.
  - **Open: WP5-12 — the 2–10 m residual.** Post-fold, **141 pairs across 115 places** (43 at 2–5 m, 98 at
    5–10 m; **0 remain at or under 2 m**) share an operator and a name in every locale: too far apart to
    call one pole (2 m is one grid step; 3 m is two, and two poles 3 m apart may genuinely be two poles),
    too close for a compass side. Both rules are right and the gap between them is real, so it needs a
    **third kind of answer, not a widened threshold on either.** Its most promising lead is unexpected and
    runs the opposite way from what anyone assumed: the **14 pairs excluded at ≤ 2 m for differing in one
    locale all print the code in *Chinese* and omit it in *English*** — at Prince Edward Station both poles
    read `PRINCE EDWARD STATION, MONG KOK POLICE STATION` in English at exactly the same coordinate while
    the Chinese reads `(MK356)` and `(MK357)`. So the code **exists upstream** and only the English label
    lacks it, which is a true answer rather than a threshold nudge.
  - **Open, pre-existing and not ours: a favourite whose route has no current arrival renders an empty
    card.** `FavoritePlaceRow` filters rows to those carrying an `eta` and drops the rest, so a peak-only
    service shows a card with a name and nothing under it (269D:3 at Tin Shui Wai Park, tested at 22:55; the
    row *was* matched — fare 18.5 present by `curl`). **It means an empty card cannot be told from a broken
    key by eye**, which is why the favourites proof above rests on a route with a live arrival rather than on
    that one. Worth a row of its own, adjacent to WP5-4.
  - **Unchanged, and not made worse: WP5-9.** `dedupeEtas` still collapses a line across the poles of a
    place, so where two ids of one *folded* pole both serve a line the losing variant's row blanks. The fold
    shrinks its blast radius if anything, since two rows became one.
  - **One existing `knownDefect` grew slightly.** Collapsing two service-type variants across a folded pair
    inherits `dedupeRoutes`' tie-break defect — the survivor is the first row *carrying a reading*, not the
    one with the *sooner* bus, and two variants can have different destinations. Post-fold those behave
    exactly like two variants at one pole, which is the case the corpus row already covers: no new defect,
    a wider blast radius.
  - **The build hash moved**, so production needs a `dataset:publish`; the daily workflow will do it, and the
    first serve after a deploy is the moment to confirm `/v1/health` still says `"dataset":"kv"` with
    `datasetBuildsThisIsolate: 0` ([ADR-055](#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)).
  - **Four figures in the stopped work were wrong and are corrected in the tree** rather than carried
    forward: "0 of 325 route rows" → 324; "85 of 331 heading groups no longer collide" → **73 groups across
    71 places**; "all 464 candidate pairs have disjoint route sets" → 24 overlap; and a `VICTORIA PARK`
    locale example that contradicted its own claim, replaced with the three measured ones. `docs/03`'s "in
    67 places" is 75, since **all 80 folded poles carry route rows** — which is also why `boardCalls` still
    calls each alias's own upstream board: **0 of the 324 route rows on a folded pole also appear on its
    member**, so skipping it would leave those rows blank across 75 places while everything else looked
    healthy.
