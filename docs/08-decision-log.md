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
- **Status:** **Amended by [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)
  (2026-07-31)** — the decision below is unchanged (de-duplicate **once**, at a single server seam) and its
  **key gained the boarding pole**, so the collapse is one line **per kerb** rather than one line per place. A
  line boarding at two poles of a merged place now publishes **two** readings, distinguished by `stopId`.
- **Context:** A stop is indexed **per direction** (and per operator service-type), but the upstream
  KMB/CTB ETA feed returns **every direction of a route in a single response** (verified: `/eta/{stop}/E42/1`
  returns both bounds; `/eta/{stop}/E42/2` → `[]`). So fetching a stop's routes once-per-ref re-fetches the
  same response and emits each arrival **two+ times, identically** — the "two A41, same time" bug seen on the
  Nearby card. The fix had initially been patched ad-hoc per call site (nearby, then the Favorites card),
  while `/v1/etas` (used by `watch()`/polling) wasn't deduped at all — exactly the inconsistency to avoid.
- **Decision:** De-duplicate **once, at a single server seam.** `dedupeEtas` (one definition, in
  `@nextbus/core/eta`) collapses an `Eta[]` to ~~**one rider line per `operator|routeNo|bound`**~~ — since
  [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place), **one rider line per
  `operator|routeNo|bound|stopId`**, i.e. one per line at *each boarding pole* — keeping the
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
  **Partly reversed by [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)
  (2026-07-31):** the *"listed once"* half of the query strategy below is gone. It is recorded here as *the
  user-preferred behaviour* and **the user reversed it**, so a line boarding at two poles of a place is now
  listed **once per pole** — see the marked paragraph. Everything else stands, the *fetch* dedupe included.
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
  **dedupe** so a route serving two poles is fetched and ~~listed once (the user-preferred behaviour;
  [`dedupeEtas`](#adr-023--eta-lists-are-de-duplicated-once-server-side-canonical-api) already collapses
  `operator|route|bound`)~~ — **struck here rather than merely noted elsewhere, because this is the sentence the
  code stopped agreeing with. [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)
  (2026-07-31) reversed the *listing* half, and it was the owner who reversed the preference this sentence
  records** — once shown that GMB 68K had buses at **both** kerbs of
  Fu Kin Street **11 s apart** while we published one, so `dedupeEtas` keys on `operator|route|bound|stopId`
  and a line boarding at two poles is **two readings**, one per kerb a rider can walk to. The *fetch* dedupe
  above is untouched (upstream calls are still deduped by `(route, serviceType)`, one `stop-eta` call per KMB
  pole). Read that ADR before re-fusing two poles anywhere: for GMB the pole is **identity**, not tidiness.
  **Both** the Place page and the compact Nearby card fetch **every** route at the place
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
       **Amended 2026-07-31: that argument is right at *one pole* and exactly wrong *across* poles, and both keys
       now carry the pole** — `dedupeRoutes` since
       [ADR-056](#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)
       decision 13, `dedupeEtas` since
       [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place). A merged place is N poles
       (ADR-042), and at **Tai On Street** two *different* GMB services share the number **20** — both
       circular, so both "outbound" — and only the pole separates them. *"A stop belongs to one region"* still
       holds; *"a place is one stop"* never did, and this is the discrimination the corpus's two GMB rows draw.

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
    outbound row (`dedupeEtas` collapse), keeping the sooner arrival. *(Still true under ADR-072: both variants
    leave the **same pole**, which is exactly the case that still collapses.)*

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
  - ✅ **WP5-9 — one reading per boarding point. Closed 2026-07-31 by
    [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)**, which added the pole to
    `dedupeEtas`' key, moved "which reading belongs to which row" into the kernel for `/v1/stop` as well as the
    live merge, and measured the payload cost (unchanged at all eight heaviest interchanges; +1.1 % on
    `/v1/stop`). Kept as written because the framing is the reason it was done. Decision 13's residual, and the
    owner framed it better than the finding did: *"we need to normalise the data to our own structure so we can
    understand what we're doing and consistently present it."* `dedupeEtas` collapsed on
    `operator|routeNo|bound`, so a place
    published at most one reading per line and the sibling pole's arrival was discarded — measured, GMB 68K had
    buses at both poles 11 s apart and we published one. Since a row became per pole, the second pole read "no
    reading right now" while a bus was genuinely due there. A wire change: both `/v1/etas/:id` and
    `/v1/stop/:id`'s embedded readings grow, so it needed its own ADR, a payload-size check at the biggest
    interchange, and a look at whether `NearbyStop.etas`' `maxRows` still read honestly when a line can
    appear twice. **All three were done; the payload check is the one that inverted the expectation.**
  - ✅ **WP5-10 — a pole heading labelled by something that distinguishes it. Closed 2026-07-31 by
    [ADR-071](#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)**, which needed
    two rules rather than one: most of the pairs wearing identical headings were one physical pole published
    twice. The display cost decision 13
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
  - ~~`lineKey` in `apps/edge/src/stop-route.ts` still duplicates `dedupeEtas`' key construction (both now go
    through the shared parser, with a comment tying them). Exporting one line-key helper from `core` is WP2-2.~~
    **Closed by [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place) (WP5-9, 2026-07-31):**
    the helper is `etaLineKey` in `@nextbus/core`, with three readers (`dedupeEtas`, the edge's destination
    table, `stopCardView`). The edge's copy and the comment saying it *"must agree with `dedupeEtas` exactly"*
    are gone — a comment was never the mechanism, and a second spelling of one line drops a destination
    silently rather than failing.
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
  **structurally rather than by migration**. Its WP5-9 consequence is closed by
  [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place), hours later on the same branch.
  Implementation: `foldDuplicatePoles`,
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
  - ~~**Unchanged, and not made worse: WP5-9.** `dedupeEtas` still collapses a line across the poles of a
    place, so where two ids of one *folded* pole both serve a line the losing variant's row blanks. The fold
    shrinks its blast radius if anything, since two rows became one.~~ **Closed hours later on this same
    branch by [ADR-072](#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)**, so the premise above
    is no longer true of the code: `dedupeEtas` keys on the pole, and each id's board's readings are published
    and matched under that id. The case this bullet described also needed one line listed at **both** ids of a
    folded pair, and the figure below says that is **0 of the 324** route rows on a folded pole — so it was
    already unreachable in build `1ccad7436a8df480` rather than merely narrow.
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

## ADR-072 — An arrival is a line at a kerb, not a line at a place
- **Status:** **Decided and implemented 2026-07-31** (WP5-9, four commits on `wave5-followups-v1`). Closes
  [ADR-056](#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)
  decision 13's stated residual and completes the boarding-point decision
  [ADR-071](#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two) from the data
  side, as that ADR does from the label side. **It also reverses a preference recorded in
  [ADR-042](#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant)
  as the user's own** — decision 7 below, because that is the part a future agent will otherwise undo in good
  faith. Implementation: `etaLineKey`, `etaBoardingKey` and `dedupeEtas` in `packages/core/src/eta.ts`;
  `applyLiveEtasToStopDetail` in `packages/core/src/live.ts`; `soonestPerLine` + `stopCardView` in
  `packages/core/src/stop-card.ts`; the row build and `stampTables` in `apps/edge/src/stop-route.ts`; four
  descriptions in `packages/contract/src/wire/` (`EtaSchema.stopId`, `StopDetail.routes[].eta`,
  `NearbyStop.etas`, `NearbyStop.routeCount`), with `openapi.json`, `asyncapi.json` and the native guide
  re-emitted. Pinned by `apps/edge/test/eta-per-pole.test.ts` (10 assertions in workerd over a seeded KV
  build, its live-merge cases reading off a real `/v1/live` socket through the real `EtaHub`; **6 watched
  failing** against the pre-fix tree) and the corpus (13 files · **88** groups · **742** cases · 3
  `knownDefect` · **19** named boundary rows, one of them new and watched failing; `core` still 100 % on all
  four thresholds over 416 branches; **1 008** tests, from 977). **The dataset does not move** —
  `pnpm dataset:build` reproduces `1ccad7436a8df480` byte for byte — so unlike ADR-071 this needs no publish.
- **Context — what a rider saw, because that is the whole argument.** At **Fu Kin Street**
  (`/stop/P:GMB:20015724+GMB:20015749`, driven in a browser against live feeds) the place has two kerbs and GMB
  **68K** boards at both. **Pre-fix the first kerb's 68K row read *"every 7 – 9 min"* — the static timetable
  band, which is to say no arrival at all — while the second kerb's read a real 3 min. Post-fix the same two
  rows read 9 min and 4 min (*Scheduled*).**
  Both buses were real and upstream had published both. We had not: `dedupeEtas` collapsed on
  `operator|routeNo|bound` across the **whole place**, so `/v1/etas/:id` carried at most one reading per line
  however many kerbs the line boards at, and since decision 13 made a route row **per pole** the sibling
  row had nothing to show and fell back to a frequency band. A rider standing at the first kerb was reading a
  timetable while a bus was nine minutes out **from that kerb**. Falling back to the band is not itself
  dishonest — it is labelled Static, per [ADR-008](#adr-008--etas-are-approximations-no-client-side-fake-countdown)
  — but it is the honest presentation of an answer we had thrown away.
  **The measurement, line-precise, against the live GMB feed at 23:20:** of the **43** rider lines that board
  at **two** poles of one place in build `1ccad7436a8df480`, upstream had a bus at **both** kerbs
  simultaneously for **2** of them (68K outbound *and* inbound at Fu Kin Street, three arrivals at each kerb)
  and **for each of those two we published a single reading**. Two of 43 sounds small and is the honest figure:
  most minibus lines are finishing for the day at 23:20, and the pole-precise count — poles publishing anything
  at all — was **14 of 43**. The fusion was ours; upstream keeps the two apart.
- **Decisions:**
  1. **An arrival is identified by `operator|routeNo|bound|stopId`.** Factored as
     `etaBoardingKey(eta)` = `` `${etaLineKey(eta)}|${eta.stopId}` ``, both exported from `@nextbus/core` and
     corpus-pinned. **The unit of an arrival is now the unit of a row**: a rider line at one boarding point,
     the kerb a rider actually walks to.
     [ADR-023](#adr-023--eta-lists-are-de-duplicated-once-server-side-canonical-api) is **not** reversed —
     "de-duplicate once, at a single server seam" is untouched, the seam is the same `stopArrivals`, and only
     its key is finer.
  2. **Two service-type variants at *one* kerb still collapse, and that is the same rule rather than an
     exception to it.** Citybus **969 is listed three times at one pole**, all bound for Causeway Bay; KMB runs
     269D as types 1 and 4 off one pole. Those are one bus to a rider, and the test is not "are these rows
     distinguishable in the data" but **"is there anything here a rider can act on"**: nobody chooses a
     timetable variant, and everybody has to choose a kerb. Seen that way the two halves of the key are one
     decision, not a compromise between two.
     **For GMB the pole is identity, not tidiness.** At **Tai On Street** two *different* minibus services
     share the number **20** — `GMB:20:outbound:2002320` boards for Chai Wan (Fung Yip Street) at one kerb,
     `GMB:20:outbound:2002319` for Chai Wan Industrial City at the other — and **both are circular**, so both
     read "outbound" on every leg. Neither the number nor the direction separates them; only the pole does.
     Both halves are pinned by one corpus row
     (`eta#dedupeEtas:one-line-at-two-poles-keeps-a-reading-for-each`, now in `REQUIRED_ROWS`) which exercises
     same-pole variants collapsing and the second pole keeping its own reading **in the same case**, so a
     future edit cannot satisfy one half by breaking the other.
  3. **`etaLineKey` is the line half of the key, exported because a comment is not a mechanism.**
     `apps/edge/src/stop-route.ts` carried its own copy of the line key under a comment saying it *"must agree
     with `dedupeEtas` exactly"* — a duplication [ADR-059](#adr-059--the-id-grammar-one-parser-in-core-the-spec-and-corpus-in-contract)
     had already recorded and filed. There is one declaration now and three readers: `dedupeEtas`, the edge's
     destination table (`stampTables`) and `stopCardView`.
  4. **Which reading belongs to which row is *one* rule, and it lives in the kernel.** `/v1/stop/:id` builds
     its rows with `eta: null` and calls **`applyLiveEtasToStopDetail`** — the same kernel function the live
     subscription applies to that same payload one cadence later. **Two defects this work package did not know
     about are closed by that move, and both were found by sweeping real data rather than by reasoning about
     the code**, which is why they are recorded as findings and not as tidying:
     - **`/v1/stop` indexed its readings by *route id alone*, and a route id does not name a kerb.** Measured
       live over all **37** places with a two-pole line: **1** row carried a reading off the *other* pole —
       `GMB:1A:outbound:2002355`'s row at `GMB:20001114` holding a reading stamped `GMB:20009421` (Hiram's
       Highway, opposite Marina Cove). So the app showed a bus at a kerb it was **not** coming to *and* said
       nothing at the kerb it was. Post-fix sweep: **0**.
     - **A row whose service-type variant upstream did not publish got nothing.** Over 156 real places (the 37
       plus the 120 heaviest): of **2 124** readings, **2 122** match a row on the exact `(pole, routeId)`
       pair, **2** name a variant that no row at **their own pole** lists, and **0** match nothing at all. So a
       *strict* pair match would have dropped a real arrival at the kerb it was coming to — the exact defect
       this work package is named after, arriving from the other side. Boards publish whichever variant is
       running; a row names one.
     The rule is therefore **exact `(pole, routeId)` first, then the soonest reading for that row's own line at
     that row's own pole**, with the fallback index built by `dedupeEtas` and keyed by `etaBoardingKey` — the
     same normalisation and the same key the wire keys on, not a second rule. **It never crosses a pole**, so
     `row.eta.stopId === row.stopId` is now **structural rather than a fixture's luck**:
     `apps/edge/test/eta-stop-id.test.ts` has asserted that invariant since Wave 5 and was green only because
     no fixture had one route id on two poles' boards. **This is the decision a native port will get wrong** —
     the order, and the prohibition on the fallback crossing a kerb — and its cost is measured rather than
     imagined: 1 in 37 places for the first half, 2 in 2 124 readings for the second. Two corpus rows cover it,
     the fallback itself and `the-line-fallback-never-crosses-a-pole`.
  5. **A compact card collapses back to one row per line *before* the cap, and `routeCount` stays in lines.**
     `NearbyStop.etas` carries per-pole readings like every other path, and `stopCardView`'s `soonestPerLine`
     collapses them keeping the soonest; `remaining` is counted in lines on both sides of the subtraction.
     **`routeCount` is not a count of readings and never was** — `routeCountOf` in
     `packages/data-normalize/src/shards.ts` counts distinct `operator|route|bound` across *every* pole of the
     place — so the moment `etas` could hold two readings of one line, `remaining = routeCount − rows.length`
     was subtracting poles from lines. **Watched, with the collapse removed:** the live Fu Kin Street card
     printed **`68K → Julimount Garden` twice** (9 min and 15 min) and said **"+0 more"** while **68S, a whole
     line, was hidden**; the same card at `maxRows: 2` was **one route number printed twice**, a duplicate
     eating the slot the second line needed. Four reasons, in the order they mattered:
     - **The card has no kerb heading.** Two rows reading `68K → Julimount Garden` with two times ask a rider
       to choose between them and give them nothing to choose by — the same failure `poleSideOctants` declines
       to commit one screen over (ADR-071 decision 6). The kerb is a **Place-detail** fact, and that screen has
       a heading per pole to make it legible.
     - **One unit end to end.** The card counts lines, shows lines and hides lines. Any other choice needs a
       compensating rule somewhere, and the compensation is what goes quietly wrong.
     - **It is where both Nearby paths meet.** `applyLiveEtasToNearby` does *not* collapse — correctly, it is
       the readings' own list — so collapsing at the *edge* would have made the HTTP card and the future live
       card (WP5-7) disagree. In the card rule they cannot.
     - **The card reads exactly as it does today**, which for a wire change whose point is elsewhere is a
       virtue.
     **Rejected, and recorded as a design call rather than a defect:** collapsing on *what the row prints*
     (line **+ destination**), which would keep both of Tai On Street's `GMB:20` services on the card —
     **26 of the 43** cross-pole lines have **different destinations at their two poles**, nearly all GMB. It
     is the better card if the compact list should enumerate *services* rather than *lines*; it costs a unit
     mismatch in "+N more" and admits two rows with the same route id, which today's `key={row.routeId}` would
     hit as a duplicate React key in **both** renderers. Both new card behaviours are corpus rows
     (`one-line-at-two-kerbs-is-one-row-and-the-count-stays-in-lines`,
     `a-line-at-two-kerbs-does-not-eat-two-slots-under-the-cap`), and because `apps/web`'s and `apps/mobile`'s
     projection suites replay that group, **both renderers were measured rather than argued about** (web
     20 → 22, mobile 36 → 38 — [ADR-069](#adr-069--a-second-renderer-and-what-it-caught-in-the-first)).
  6. **Additive per [ADR-052](#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)
     §5, and exactly how: a line may now appear once *per pole* where it appeared once per place.** No field
     added, none removed, no shape changed — the growth is in the **cardinality of an existing array**, which
     `EtaListSchema` and `NearbyStop.etas` already permit, and `stopId` was already the field that
     distinguishes the two readings. What did change is that four descriptions now *say* it
     (`EtaSchema.stopId`, `StopDetail.routes[].eta`, `NearbyStop.etas`, `NearbyStop.routeCount`), because a
     generated native decoder reads the description and nothing else. `openapi.json`, `asyncapi.json` and the
     native guide are re-emitted and all three gates pass.
  7. **ADR-042's "user-preferred behaviour" is reversed by the same user, and this log is corrected rather
     than left to disagree with the code.** ADR-042's query-strategy paragraph recorded *"**dedupe** so a route
     serving two poles is fetched and listed **once** (**the user-preferred behaviour**; `dedupeEtas` already
     collapses `operator|route|bound`)"*. **The owner reversed that preference on 2026-07-31**, having been
     shown that GMB 68K had buses at **both** kerbs of Fu Kin Street **11 s apart** while we published one —
     first for *rows* (ADR-056 decision 13) and now for *readings*. The *fetch* half of that sentence still
     stands: upstream calls are still deduped by `(route, serviceType)`, and one KMB `stop-eta` call still
     serves a whole pole. **Four statements in this file were stale and are corrected in place**, each
     annotated in the house style so a reader meets the correction where they meet the claim:
     - **ADR-023's decision** — *"collapses an `Eta[]` to one rider line per `operator|routeNo|bound`"* → the
       key gained the pole. Its decision stands; a status line now says so.
     - **ADR-042's query strategy** — the sentence above, struck and corrected, with a pointer at the top of
       its status.
     - **ADR-047 decision 5** — *"Per-stop (`dedupeEtas` …): plain `operator|no|bound` for **all** operators —
       safe for GMB too"*. The GMB argument is still right **at one pole** and is now exactly wrong **across**
       poles; "a stop belongs to one region" holds, "a place is one stop" never did. (Its Hin Keng 803 example
       is still correct: both variants leave *one* pole, so they still collapse.)
     - **ADR-059's follow-ups** — *"`lineKey` in `apps/edge/src/stop-route.ts` still duplicates `dedupeEtas`'
       key construction … Exporting one line-key helper from `core` is WP2-2"* → done, it is `etaLineKey`.
       (The WP5-9 report attributed this line to ADR-052; it is ADR-059's.)
     Two more were written *concurrently* with this work and are corrected too: ADR-056's WP5-9 follow-up row,
     and ADR-071's *"Unchanged, and not made worse: WP5-9"* consequence, whose premise — that `dedupeEtas`
     still collapses across a place's poles — is exactly what this ADR removes. **A decision log that argues
     with the code is worse than one with a gap**, because the gap is visible and the argument is not: it hands
     the next agent a rationale for re-fusing two kerbs and a citation to do it with.
- **Why — the payload measurement, which inverted the expectation the work package was written on.** Pre/post
  pairs were taken against live feeds ~90 s apart, each with a cache-busting query (the edge caches both
  endpoints on the URL) and a `dataTimestamp` fingerprint so feed drift is *visible* rather than assumed;
  pre-fix runs restored `cd2fc22`'s `apps/edge/src` + `packages/core/src`, waited for the worker to reload and
  **confirmed the old behaviour was live** (68K publishing 1 reading, not 2) before measuring.
  - **`/v1/etas` does not grow at the worst interchange at all — it is unchanged at all eight of the
    heaviest.** Victoria Park has **126 rows across 113 rider lines at 7 poles and not one line boards at two
    of them**, and that is structural rather than lucky: ADR-042's *"no single route+bound serves both"* veto
    forbids one **canonical route id** at two poles of a place, so a shared **rider line** needs *two* route ids
    that agree on number and direction — two service-type variants, or two GMB services sharing a number. That
    is a minibus and outer-NT shape, not a Causeway Bay one. Growth is confined to the **43** lines at **37**
    places, at most one extra reading each
    — a territory-wide ceiling of **+43 readings ≈ +13 kB**, spread one place at a time.
  - **The growth that exists is on `/v1/stop`, and it comes from the variant fallback rather than from the
    pole.** Worst absolute in the sample: **+942 B on Victoria Park's 58 kB** (58 031 → 58 973 B, +1.6 %);
    across 13 places **447.7 → 452.8 kB, +1.1 %**, against `/v1/etas`' **69.5 → 69.6 kB**. Those extra filled
    rows are variants the client's `dedupeRoutes` collapses anyway, so they cost bytes without changing the
    screen — the honest price of not blanking the 2-in-2 124 readings whose variant is not the one listed at
    their pole. **Nothing here is within two orders of magnitude of the 188 kB document that motivated
    [ADR-055](#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path).**
  - Four rows in the sample show a `dataTimestamp` change between their pair; their `/v1/etas` deltas of ±5 %
    are feed drift, not this change, and the `/v1/stop` filled-row deltas are consistent across drifting and
    non-drifting places alike. Recorded because a measurement whose noise is unlabelled is a measurement
    someone later "corrects".
- **Driven, not only tested.** `pnpm dataset:build` → **`1ccad7436a8df480`**, byte-identical to the shipped
  build, and `dataset:publish --local` answered *"upstream unchanged — nothing to do"*, which is
  content-addressing working; `/v1/health` held `{"dataset":"kv","datasetBuildsThisIsolate":0}` throughout
  (the ADR-055 production invariant, **local only, never remote**). Post-fix, `/v1/etas` at Fu Kin Street
  carries `GMB:68K:outbound:2007762 @ GMB:20015724` **and** `GMB:68K:outbound:2007765 @ GMB:20015749`; over
  all 37 two-pole-line places `/v1/stop` has **0** rows whose reading names another pole. The compact card was
  rendered from the running worker's `/v1/nearby` (`routeCount 2`, two 68K readings) and printed
  `68K → Julimount Garden 3 min` with **"+1 more"** — the hidden line being 68S, which had no reading:
  truthful in both halves.
- **Consequences, including what we are accepting:**
  - **Open — a rider who stars one line at *both* kerbs still sees one Favourites row.** Verified in a browser
    with both keys saved (`GMB:20015724|GMB:68K:…2007762` **and** `GMB:20015749|GMB:68K:…2007765`): the Fu Kin
    Street card renders a single `68K → Julimount Garden`. Both keys resolve and the card's own collapse
    (decision 5) is what merges them, so this is **not a regression** — pre-fix only one of the two kerbs had a
    reading at all — but **the rider's own explicit choice is invisible**, and telling the two apart needs a
    **per-row kerb label the card does not have**. Owner: **WP5-12**, whose problem statement this joins from
    the favourites side; the alternative is decision 5's rejected collapse-on-what-the-row-prints.
  - **Open — `stopCardView`'s "keep the first" now depends on producers sorting soonest-first for *value* as
    well as for order.** Every producer does (`/v1/nearby`'s schema says so, `stopArrivals` sorts,
    `applyLiveEtasToNearby` sorts, Favourites sorts) and **none is enforced to**. The cap already had this
    dependency, so the collapse adds no new risk — but a producer that stopped sorting used to merely reorder
    rows and would now silently show the **later** bus of a line. A comparator here or a gate on the producers
    would fix it; left as the pre-existing assumption, documented in `soonestPerLine`. Owner: unassigned, and
    it belongs to whoever adds the next producer (WP5-7's batch `/v1/etas?ids=…` is the next one).
  - **Open, and a real hole in a gate CI runs rather than flakiness:** `apps/edge/test/wire-conformance.test.ts`
    flaked once, on *"returns a payload that satisfies the schema, with no undocumented fields"*, inside a root
    `pnpm test` while another package was failing. It has not reproduced in ~10 subsequent runs, and the reason
    it *can* is structural: its `fetch` stub ends `return realFetch(input, init)`, so **any URL it does not
    recognise goes to the live internet**. One of ADR-052's three gates therefore has a live escape hatch, and
    a suite with one is a flake waiting for a slow night — worse, a red build that a re-run makes green teaches
    a reader to re-run. Owner: unassigned; the fix is to fail the stub on an unrecognised URL.
  - **A cosmetic consequence of the fallback, recorded because it changes which row wins.** Where two
    service-type variants at one pole now *both* carry a reading, `dedupeRoutes` keeps the **first-listed**
    variant rather than the one that happened to hold the exact reading. The displayed time is the same and the
    choice is more stable — it no longer moves as buses depart — but the destination shown is the first
    variant's, and two variants of one line can differ there. The existing `knownDefect`
    (`stop-detail#dedupeRoutes:the-first-live-variant-wins-even-when-a-later-one-is-sooner`) is **untouched and
    still accurate**: it is about two variants at *one* pole, which still collapse, and `/v1/stop` still
    carries each variant's own exact reading, so its 18-vs-3-minute example reproduces exactly as written.
  - **A pole heading still cannot tell a rider which kerb the 9-minute bus is at**, which is the honest limit
    of this change. Fu Kin Street's two members are named *"…, outside Sin Sam House…"* and *"…, opposite Sin
    Sam House…"* — genuinely different, and published **1.51 m** apart, so `foldDuplicatePoles` rightly
    declines on the name test and `poleSideOctants` rightly declines on distance (ADR-071 decisions 1 and 6).
    But `poleHeading` in `apps/mobile/app/stop/[id].tsx` is *operator + the parenthesised stop code* and GMB
    names carry no code, so **both headings print a bare "GMB"** while the *names* differ. That is a cheaper
    lead than any in WP5-12's row: the name already distinguishes what the code does not. Owner: **WP5-12**.
  - **No `dataset:publish` is needed** — the build hash did not move, which is also the proof that this changed
    no derivation in the offline pipeline.

## ADR-073 — A failed board is not an empty board: per-pole ETA failure on the wire
- **Status:** **Decided and implemented 2026-08-03** (WP5-4). Implementation: `apps/edge/src/eta-cache.ts`
  (`coalesce` loses its `fallback`), `apps/edge/src/stop-route.ts` (`memberEtaLists` → `{ etas, failed }`,
  `stopArrivals`/`stopEtas` → `EtaReport`), `apps/edge/src/nearby.ts`, `apps/edge/src/eta-hub.ts`
  (`round`/`sendRound`), `packages/contract/src/wire/responses.ts` (`EtaFailure`, `EtaReport`),
  `packages/contract/src/openapi.ts` (`CONTRACT_VERSION` → `2.0.0`), `packages/core/src/live.ts`
  (`retainFailedPoles`), `packages/core/src/datasource.ts`, `packages/api-client/src/live/poll.ts`.
  Pinned by `packages/core/spec/live.spec.json` (**10 new corpus rows, 3 of them named boundary rows in
  `scripts/check-spec-coverage.mjs`**), `apps/edge/test/eta-cache.test.ts` (2 rows, one of them the
  inverse of the assertion it replaces), `apps/edge/test/live-rounds.test.ts` (the HTTP block, 4 rows) and
  the cross-runtime corpus of [ADR-074](#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines)
  (11 rows, run against both engines).
- **Context — the defect, and where it actually was.** `stopEtas` → `stopArrivals` → `memberEtaLists`
  routes every upstream board through `coalesce`, and `coalesce`'s signature was
  `coalesce(key, produce, fallback)` with every ETA call site passing `[]`. So a *rejected* upstream call
  resolved to an empty list and the call **succeeded**. Downstream, nothing could tell the difference
  between *this pole has no buses* and *this pole would not answer*:
  - `/v1/etas/:id` served `200 []` for a stop whose operator was refusing, and edge-cached it for 30 s.
  - The live engines then did the only correct thing available to them with readings that are no longer
    present: `diffEtas` reported every one of them `gone`. A rider watching a stop through a KMB outage
    saw the buses vanish one by one, with the connection reading `live`.
  - The rule *"a failed round is not a departure"* ([ADR-056](#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)
    decision 5) was written down twice, enforced twice — in `live/poll.ts` and in `eta-hub.ts` — and
    **defeated one layer below both copies**, because a *cache* had decided what a failure meant on its
    callers' behalf. Both engines held the rule per **target**; a target is a place, a place is N boarding
    poles (ADR-042), and an upstream board call is per pole.
  Pre-existing and identical on HTTP; the socket only made it visible, because a screen blanks where a
  card was merely empty.
- **Decisions:**
  1. **`coalesce` no longer takes a `fallback`, and that parameter was the bug.** It rejects; the caller
     decides what a failure means, at the call site, where a reader can see it. `routeDetail` still
     degrades to a static-only route view and now says so on its own line — which is a genuinely
     different answer from `/v1/etas`', and having one cache make it for both is what went wrong. The
     rejection is still not cached (the entry is evicted, so the next caller retries), and the stored
     promise carries its own handler so a round nobody awaited cannot surface as an unhandled rejection.
  2. **The unit of failure is the pole.** `EtaFailure { stopId, error }`, where `stopId` is the same
     canonical pole id an `Eta` carries — so a client pairs a failure with readings it already holds
     without a second id vocabulary — and `error` is the ADR-064 taxonomy rather than a string, because
     `retryable` is the field a background client needs. Citybus has no stop board, so one pole is N
     calls: if any refuses, the pole is named **once** and the routes that did answer are in `etas` as
     usual. Aggregating to the place would claim we could not ask about kerbs we did ask about; splitting
     to the route would emit a dozen `status` frames for one outage.
  3. **`/v1/etas/{id}` answers an object where it answered an array, and that is a breaking change taken
     because it is free today.** ADR-052 §5 classifies a type change as breaking and pairs it with "a
     deprecation window in which both shapes are served". The window here is **empty, and the reason is a
     fact rather than an exemption**: WP0-5 has not happened, so `openapi.json` has never been published
     anywhere a generator could read it and nothing outside this repo consumes `/v1/etas`. Serving both
     shapes would leave a dead array form for a native generator to emit against nobody. `CONTRACT_VERSION`
     is `2.0.0`. §5's `oasdiff` gate still does not exist — recorded again rather than quietly relied on;
     what stands in for it is the constant, this ADR, and `wire-conformance.test.ts`. **The window stops
     being free the day the Worker is deployed, which is the argument for doing this now rather than later.**
  4. **`failed` is omitted when empty, not sent as `[]`.** Same rule as `Eta.remarkKind` being absent
     rather than `info`: "every board answered" and "we have nothing to say about failures" must not be
     the same bytes. The common case therefore costs nothing, which matters for the one payload the poll
     emulator fetches once per target per cadence. Asserted as a control — a producer that always sent
     `failed: []` would make the field unreadable and the test red.
  5. **The retention rule is one kernel function, called identically by both engines.**
     `retainFailedPoles(prev, next, failedStopIds)` in `packages/core/src/live.ts`: a previous reading
     whose pole is in `failed` **and which this round did not replace** survives; everything else is this
     round's truth, including an absence. `next` always wins (a pole can fail partway); a retained reading
     keeps its own `dataTimestamp` so `isStale` ages it honestly and the screen labels it (ADR-008);
     nothing is resurrected, so a first-round outage retains nothing. Put in the kernel rather than
     written twice because writing it twice is the defect this ADR is about, one layer up.
  6. **A pole failure never drops a target from a subscription, whatever code it carries.**
     `retryable: false` is the wire's instruction to *prune a favourite*, and a refusing board says
     nothing about whether the rider's stop exists. Only a target-level failure can be permanent. Stated
     as a rule rather than as an observation about today's codes, because the codes reachable there are
     all retryable and a future one might not be.
  7. **A partial answer is a `200`, not a `502`.** Failing the request would throw away the kerbs that did
     answer in order to report that one was down — strictly less honest than saying both things.
  8. **`routes=` filters the readings and never the failures.** A caller narrowing to three routes is
     saying which arrivals it wants, not which outages it will hear about — and a KMB board is one call
     for every route at the pole, so "did this pole answer" has no per-route truth to filter by. Filtering
     both would hand a screen watching one route at a refusing pole an empty list with nothing to explain
     it, which is the state this shape exists to make impossible.
  9. **`retrying`, not a new `degraded` state.** `LiveStateSchema`'s own comment names `degraded`
     ("connected but the shard cannot reach upstream") as its obvious next member, and it is more honest
     about a healthy socket over a sick upstream. Deferred deliberately: WP5-4's acceptance names
     `retrying`; ADR-056 decision 6 already draws the line (`state` describes the connection, `error`
     describes the thing the message names) and decision 5's note records the `retrying`-for-a-permanent-
     failure choice as a divergence kept on purpose so the two engines match; and a new rider-facing state
     is a label decision with an i18n key attached. Whoever adds it must change both engines in one commit
     and add rows to ADR-074's corpus, which is now the thing that would catch them not doing so.
  10. **A round that reports *any* failure, including a partial one, resets `announcedLive`.** A place
      whose second kerb refused is not a place we are fully live on, and a rider whose row has stopped
      moving must not be told otherwise. Both engines build one flat, ordered failure list per round — by
      accepted-target order, then by the wire's pole order — so a round carrying both kinds of failure
      produces the same `status` sequence on both.
- **What is deliberately NOT propagated, and the reason is technical:**
  - **`/v1/stop/:id` and `/v1/nearby` do not carry `failed`.** Both embed readings from the same producer,
    so the information exists; adding an optional field is one line. It is not one line to make it
    *correct*: `applyLiveEtasToStopDetail` and `applyLiveEtasToNearby` spread the document they are handed,
    so a `failed` list fetched once over HTTP would survive every subsequent live merge unchanged — a
    screen would go on saying "we could not reach this kerb" for as long as it stayed open, long after the
    socket had recovered. Fixing that means teaching the merge helpers about failures, which is a kernel
    change with corpus rows of its own. **Consequence, stated plainly: a Nearby card whose upstream is
    refusing still reads as "no buses", and so does the Place screen's first paint.** The Place screen
    learns within one cadence from its subscription's `retrying`; Nearby has no subscription until WP5-7.
    Owner: **WP5-13** (new row), sequenced after WP5-7 so the field lands with a reader.
  - **`/v1/route/:id` has no per-stop failure field either**, for the same reason plus a smaller stake: it
    is one bulk call for the whole route, so the failure is all-or-nothing and the view degrades to static.
- **Consequences, including what we are accepting:**
  - **A pole that refuses for ever keeps showing an ageing, labelled reading rather than blanking.** That
    is the same thing the per-target rule has always done for a target that keeps failing, deliberately,
    and consistency between the two levels is what makes it one rule. The honesty cue is `isStale` on the
    operator's own clock plus a `retrying` status that recurs every round.
  - **`DataSource.getEtas` returns an `EtaReport`.** The seam changes shape, which is only cheap because
    **no screen calls it**: its readers are `EdgeClient` itself and the poll transport. `watch()`'s
    signature is untouched, which is the part ADR-004 fixes.
  - **The frames do not change, and `asyncapi.json`'s only diff is the version.** The shard applies
    `retainFailedPoles` itself and simply never sends `gone` for a pole it could not read, so a client
    learns from the retained readings plus `retrying`. `failed` exists on the wire so the *poll emulator*
    can apply the identical rule. That is what keeps the two engines' frame output comparable at all.
  - **Measured, not assumed:** `openapi.json` 34 → 36 component schemas, one path's response type changed;
    `asyncapi.json` 45 → 47 schemas (it registers `EtaFailure`/`EtaReport` through the shared component
    pass) with no channel or message change. Test totals: core 785 → 795, edge 130 → 134, api-client 59 →
    69 (the last two counts include ADR-074's and ADR-076's rows).
  - **Open — the `/v1/eta/:co/:stop/:route` debug endpoint is unchanged**, and was already right: it
    deliberately does not route through `coalesce` and fails loudly, with a comment saying why. It is now
    the *only* ETA path that answers a non-2xx for an upstream refusal, which is correct for a debug
    endpoint and worth knowing when comparing the two by hand.

## ADR-074 — The live rounds corpus: one table, two runtimes, and the rule that binds two engines
- **Status:** **Decided and implemented 2026-08-03** (WP5-5). Implementation:
  `packages/core/fixtures/live-rounds.json` (11 rows) + `live-rounds.ts` (the row type and the fixed
  topology), a `"./fixtures/*"` export in `packages/core/package.json`, and two drivers —
  `packages/api-client/test/live-rounds.test.ts` (the poll emulator) and
  `apps/edge/test/live-rounds.test.ts` (the **real** `EtaHub` over a **real** WebSocket inside workerd).
  `packages/api-client/turbo.json` and `apps/edge/turbo.json` declare the fixture as an `inputs` glob
  (ADR-070). All 11 rows pass through both engines.
- **Context.** Three rules are implemented twice — *"a failed round is not a departure"*, *"an unchanged
  round is silent"* (ADR-056 decision 5) and *"a mid-stream drop is re-echoed as a snapshot"* (decision
  17) — once in `packages/api-client/src/live/poll.ts` and once in `apps/edge/src/eta-hub.ts`. **Every
  defect Wave 5 found in its own live code survived because no test spanned both implementations. Three
  for three**, and ADR-056 says so in its own "what is not done". The scenario matrix drove the poll
  emulator against a *hand-written script*, so a rule the emulator got wrong was a rule the script had
  been written to describe; decision 17's divergence was found by an agent's judgement, not by anything
  mechanical. ADR-073 then added a fourth twice-implemented rule (`retainFailedPoles`' call sites), which
  is what made this the moment.
- **Decisions:**
  1. **The rows are data in `packages/core/fixtures/`, not a shared module — and that is a layer fact.**
     `layers.json` gives `server` the dirs `["apps/edge"]`, **tests included**, and
     `use: [contract, kernel, ports, adapters]`. `@nextbus/api-client` is not on that list and is not even
     a dependency of `@nextbus/edge`, so an edge test cannot import `createPollTransport`,
     `createSocketTransport` or `createLiveEtaController`, and `pnpm boundaries` is right to forbid it. The
     alternatives were measured and rejected: adding `client` to `server`'s `use` legalises
     `apps/edge/src` importing `EdgeClient` for the whole layer; a workers-pool project inside
     `packages/api-client` makes the client package build the server. What both sides may import is
     `@nextbus/core`, so the rows are a corpus, exactly as ADR-060 already argues for domain rules.
  2. **Not in `packages/core/spec/`.** That directory is the `@spec`-tagged corpus and
     `check-spec-coverage.mjs` enforces a two-way tag↔group relationship over it. These rows pin an
     *interaction between two runtimes*, not one exported function, so a new directory with its own
     package export is honest and a file smuggled into `spec/` under a name the gate's glob misses is not.
  3. **The assertion is what a listener holds when each round settles, not the frame transcript.** The
     shard **cannot** be compared on a transcript, and the reason is structural rather than a defect: it is
     a stateful server, so it answers a `subscribe` immediately from stored readings — an empty snapshot
     plus `live` on a cold shard — and only then polls, while the poll emulator has nothing to answer with
     until its first fetch returns. Two correct engines, two different transcripts, and no implementation
     of either could make them equal. (`seq` differs too: monotonic across a re-subscription on the server,
     reset on the client — ADR-056 records both as divergences the matrix does not cover.) So a row
     declares one line per round: `<state>[!<code>] etas=[…] watching=[…]`, or `silent` when the round
     emitted nothing. That is engine-independent and it is precisely where the four rules live.
  4. **The line carries the accepted target set, which `summarize()` in the matrix deliberately does not.**
     Decision 17 records why adding it *there* would have been worse than useless: it would have turned the
     row green while asserting the **stale** echo, because the scripts are hand-written to describe one
     engine. With two real engines measured against one hand-written list, that trap is gone.
  5. **The vocabulary is logical and each driver substitutes its own ids.** A row names places, poles,
     routes and arrival offsets abstractly (`A`, `C1`, `R9`, `+7`) against one fixed three-place topology —
     two single-kerb places and one two-kerb place, because since ADR-072 an arrival is a line at a *kerb*
     and a one-pole fixture would make the per-pole rows prove nothing. The edge driver maps them onto ids
     that exist in its seeded dataset and **asserts the mapping**: `A`/`B` are one member, `C` is two, read
     out of `/v1/stop` rather than hard-coded, so a clustering change cannot silently degrade the per-pole
     rows into per-place ones.
  6. **The client driver simulates the edge, and that is the mechanism rather than a weakness.** A row
     describes what an upstream *board* did; the client side has no edge, so its `getEtas` synthesizes the
     `EtaReport` the edge would have produced. If that simulation disagrees with what the real Worker
     produces, the shard driver's lines will not match the same declared list and the row goes red on that
     side. The binding runs through the fixture, not through shared code.
  7. **`silent` is a count on the client and a bounded window on the server, and the difference is stated
     where it is asserted.** The client driver advances its own cadence, so "the round emitted nothing" is
     decidable. The edge driver waits until the frame count has stopped moving for 150 ms, so a slow round
     is never mistaken for a silent one — only a frame arriving *after* that window could mislead, and
     nothing in the object defers a send. Its control is structural: the fixture requires every row that
     declares `silent` to declare a non-silent line as well, and a test asserts that requirement over the
     table, so a reader that had died reports `silent` for the rest of the row and goes red.
  8. **The two 8-line summarizers are duplicated on purpose.** A shared one would have to live in
     `packages/core`, i.e. a test formatter shipped in the hand-ported kernel — and the two transcriptions
     being *independent* is the point: a formatter that drifted makes a row red rather than making two
     engines agree with each other. The same argument `live-socket.test.ts` gives for keeping its own copy
     of `manualTimers`.
  9. **The existing scenario matrix stays, with a stated division of labour.** It asserts the per-repaint
     transcript against a hand-written script, which is what pins frame *ordering* (data frame before
     status frames), a `seq` gap and a reconnect — none of which a real engine can be asked to produce on
     demand. A rule about what a **frame** means, or about the order frames arrive in, gets a row there; a
     rule about what a **round** does gets a row in the shared corpus. Both file headers say so.
- **Driven, not only tested.** The corpus found a defect in its own first draft rather than in the code:
  a row asserting "a fresh reading at a refusing pole still wins" declared that a line the *answering*
  kerb had stopped listing should survive. It should not — that kerb answered, so the bus has departed —
  and both engines said so. The row was rewritten to the property it could actually express at this level
  (retention at one kerb while the other *changes*), and the partial-pole case it was reaching for is
  recorded as **not covered here, with the reason**: only Citybus can refuse a pole partway, the edge's
  seeded dataset is KMB-only and a KMB board is one call, so neither driver can produce it. That property
  is pinned where it lives instead — `live#retainFailedPoles:a-fresh-reading-beats-a-retained-one`.
- **Consequences, including what we are accepting:**
  - **Two tables, and a reader has to be told which one to add a row to.** Mitigated by both headers and
    by this ADR; not eliminated. The alternative — moving all twelve matrix rows into the shared fixture —
    would have meant expressing hand-written `ServerFrame[]` scripts in logical ids so the shard could be
    driven from the same table, for rows the shard cannot produce at all.
  - **The edge driver depends on `runDurableObjectAlarm` and on `resetEtaCache()` between rounds.** The
    first fires whatever is armed, immediately, so it proves what a round *does* and never *when* — the
    cadence is asserted separately in `eta-hub.test.ts`. The second is mandatory rather than hygiene:
    `coalesce` holds a pole for 30 s per isolate, so without it round two re-reads round one's board and
    every change row reports silence.
  - **A shard is wiped between rows**, because a Durable Object's name is a function of the target set
    (ADR-056 decision 7) and the pool resets neither instances nor their storage between `it()` blocks. A
    row that inherited the previous row's readings would see a `delta` where the fixture declares a
    snapshot, and the first round of every row would be wrong in a way that depended on file order.
  - **`resyncNeeded` is asserted false on every frame of every row**, which is a free check that the
    shard's counter stays coherent across a handshake plus N rounds — a sequence nothing else drives end
    to end.
  - **Open — the corpus is TypeScript-driven only.** It is language-neutral JSON on purpose, so a Swift or
    Kotlin client could read the same rows, but there is no native driver and ADR-067's honesty rule
    applies: this is portable, not ported.

## ADR-075 — Three renderers, one executable spec, and drift defined on the spec rather than the pixels
> **Numbering note (resolved):** this was written concurrently with the WP5-4/5/6 work and deliberately
> took **075**, leaving **073–074** free for it. Both were used —
> [ADR-073](#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire) (WP5-4) and
> [ADR-074](#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines)
> (WP5-5) — so **no renumbering is needed** and WP5-6 took
> [076](#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll). Kept as the
> record of how two branches numbered against each other without a collision.

- **Status:** **Decided 2026-08-03, not implemented.** Owner's decision. **Supersedes
  [ADR-002](#adr-002--expo-rn--rn-for-web-pwa-first-native-later-ota)** and replaces
  [`docs/06`](./06-roadmap.md) Phase 3. The work plan is
  [`proposals/04`](./proposals/04-platform-idiomatic-renderers.md) (Wave 6). **Launch is not blocked:**
  WP0-5 ships the Expo PWA first, unchanged.
- **Context — two incompatible futures were both on `main`, and nobody had reconciled them.**
  `docs/06` Phase 3 said *"Native apps (**same codebase**) … real iOS + Android, **no rewrite**"* via EAS
  Build. `packages/contract/README.md` — shipped by WP3-3 — opens *"This document is for someone starting
  a **native repo tomorrow**"* and tells that reader they *"will hand-write \[the domain rules] a third
  time"*. Waves 1–5 served the second one almost exclusively: `packages/ports` is described in `CLAUDE.md`
  as *"the iOS/Android porting checklist"*, the corpus exists so a hand-written port can be measured, and
  [ADR-069](#adr-069--a-second-renderer-and-what-it-caught-in-the-first)'s justification for `apps/web` was
  that everything else in Wave 4 *"makes unfalsifiable claims about what Swift will need"*. **If native is
  hand-written, ADR-002's entire basis — one codebase, three platforms — is already gone in practice**, and
  `react-native-web`'s only remaining job is rendering the web app.
  **What that job has cost, itemised, all of it paid for the only platform that ships today:** reanimated
  v4's `scrollTo()` is a silent no-op on web (needed a `scrollToY` DOM helper); the JS stack broke
  `Animated.ScrollView` scrolling so ADR-043's slide/reveal was **tried and reverted** and web gets an
  instant cut; RN's array `filter` form silently no-op'd on RN-web and needed a platform-split CSS string;
  `hitSlop` is ignored, so dots needed fixed 32 px boxes; a `backdrop-filter` isolation bug meant opacity on
  a wrapper killed the blur mid-scroll; nested interactive elements are invalid HTML; the
  two-tap-while-focused quirk on Search; `lucide-react-native` cannot load outside Metro so tests alias it
  to `lucide-react`, and `react-native` had to be aliased to `react-native-web` to test an RN card at all.
  `GlassView`'s liquid glass is a **web** library ported *into* RN and is Chromium-only.
  **A correction to this repo's own record, since ADR-002's reasoning was quoted at the owner and was
  wrong in this context:** *"pure PWA forever loses iOS push + background location"* compared Expo against
  **PWA-only-forever**. Under this decision iOS is a native Swift app, so push, background location and
  haptics come from it and React Native is irrelevant to all three. ADR-002's premise is also partly stale
  on its own terms — iOS 16.4 (2023) added Web Push for home-screen-installed web apps. Background location
  genuinely has no web equivalent, which is a limit of the web, not an argument for RN.
- **Decision:**
  1. **The shared artefact is the spec, not the component tree.** Web is **plain React**
     (`apps/web` — Vite + React DOM + Tailwind 3.4); iOS is **hand-written Swift**; Android is
     **hand-written Kotlin**; each is idiomatic for its platform. `apps/edge` and every `packages/*`
     are untouched — this is a renderer decision, and the kernel was built for it.
  2. **The design is platform-idiomatic within a bounded line**, declared as a table in
     `proposals/04`: content, semantic colour, the type scale, spacing and touch targets, the ADR-008
     honesty rules, the *existence* and distinguishability of all five states, interaction targets and
     destinations, and a11y roles and label content are **shared and are identity**. Material,
     elevation, shape, motion, gesture idiom, navigation chrome and the icon set are **idiom**.
     **The token layer already works this way**, which is the evidence the line will hold:
     `elevation` is one declaration consumed as `elevationStyle(level, Platform.OS)` — a shadow geometry
     plus Android's Material dp where the platform wants one — and `glassShadow` is declared web-only
     (*"native glass lifts via its container's `e3`"*). WP3-1 made `ELEVATION` platform-neutral at
     source; this generalises that shape rather than inventing one.
  3. **A component spec is data validated by a schema, never prose.** `docs/09` §6 is already titled
     *"ETA display spec (the signature component)"*, is already prose, and the imminence band it
     describes was written down **four times with two different values** until WP4-0 hoisted it. Prose
     rots here, and so do gates that look at nothing —
     [ADR-070](#adr-070--a-turbo-tasks-hash-must-include-everything-it-reads-and-says-so)'s cache key,
     the rules that fired on a stale `dist/`, and the field-reference gate that was built, tested against
     the failure it was for, and **deleted** because *"referenced" is not "rendered"*. The format is
     `packages/core/spec/*.spec.json`'s: a module doc, named groups, and every case carrying a `why`.
     **The schema and the conformance walker go in a new `packages/ui-spec` with no domain vocabulary;
     NextBus's own specs go in `packages/contract/ui/`** beside `openapi.json` and `asyncapi.json`,
     because a native reader already starts at `packages/contract/README.md`. Both need a `layers.json`
     entry before they have a file, the way `apps/web` did.
  4. **"No drift" is redefined from visual to functional, deliberately.** It becomes *every renderer
     satisfies the same executable spec*, enforced by a conformance suite per renderer, replacing *all
     platforms look and behave the same* — which nothing enforces and `react-native-web` already fails
     (see the list above). This is recorded as a decision rather than left to be discovered, because
     drift is the owner's stated top priority and this changes what the word means.
  5. **Every spec is extracted from the working RN renderer while it still exists, and both renderers
     must pass before the RN one is retired — screen by screen.** WP4-0 → WP4-1 ("hoist, then render")
     generalised. Deleting first would make the spec *what somebody remembers the app did*, and an
     incomplete spec is worse than none because it reads as complete. **Nearby is retrofitted first**,
     where two renderers already agree, so the *format* is validated in an afternoon rather than at
     screen five: if it cannot express a screen that demonstrably works, it is the wrong format.
  6. **`apps/mobile` changes role rather than being deleted.** Until WP6-8 it is the **reference
     implementation** the specs are extracted from and measured against — which is why shipping the
     Expo PWA at WP0-5 is not a contradiction.
  7. **The portable system is designed for and extracted on demand (the rule of two).** The second
     motivation is a portfolio of HK open-data apps over the same substrate — a weather app over the
     HKO feeds is the named next one — and the method, the ADR-008 honesty principles, the token and
     i18n pipelines, the gate chain and the `TileSource`/LandsD proxy are what travel. But extracting a
     framework with one consumer is a guess, so WP6-10 waits for a real second consumer and the interim
     acceptance is **a named seam, not a package**. A `ui-spec` that has grown a `stopId` is the early
     warning.
- **Why the alternatives lose:**
  - **Keep React Native.** Only defensible if native comes from Expo. It does not, per the artefacts
    five waves actually built — so the one-codebase premise is already spent and the RN-web tax buys
    nothing that ships.
  - **A big-bang switch.** The spec would be written from memory of a deleted app; decision 5 exists
    against exactly this.
  - **Prose specs in `docs/09`.** Tried, in §6, and it is one of the four places the imminence band
    disagreed with itself.
  - **One shared component library across platforms** (the RN premise, restated). It is what forces
    the visual lowest common denominator this decision is trading away, and it is why the glass is
    Chromium-only and the transitions are an instant cut.
- **Consequences, including what we are accepting:**
  - 🔴 **Three visual designs means design review and QA triple, forever** — the recurring price of
    platform-idiomatic, paid per change rather than once.
  - 🔴 **Corpus vendoring is still unsolved and this enlarges it.** `docs/11` already carries it as the
    one hole in the corpus-rot story: nothing here can enforce that a native repo's copy is current, and
    a stale copy yields a **green** suite pinning a moved rule. Adding `contract/ui/` to what a native
    repo vendors grows the unenforced surface. WP6-9 must not start before it is answered.
  - 🟠 **A shared spec is a shared bug** — this fixes divergence, not wrongness. Same trade Wave 2 made
    pinning four `knownDefect` rows: identical and visible beats different and hidden.
  - 🟠 **Between WP6-8 and WP6-9 there is exactly one renderer measured against the spec**, which is
    weaker than today. `apps/web` stops being an *independent* second renderer the moment it is the only
    web one, and `apps/mobile/test/stoprow-projection.test.tsx` retires with `apps/mobile`. The corpus
    survives as the specification; WP6-9 restores independence, and pulling it earlier is the mitigation.
  - 🟠 **WP6-0 — the `apps/web` shell (router, persisted query cache, locale provider, service worker) —
    buys nothing a rider can see** and is the largest package before any screen moves. Porting a screen
    first and bolting the shell on after would make every screen's spec provisional.
  - 🟡 **Two open items become spec work rather than patches:** a favourite whose route has no current
    arrival renders an **empty card**, and WP5-4's outage **blanks a screen**. Neither is a rendering
    bug; both are states nothing ever declared. They are `mustNot` entries with citations.
  - 🟡 **`docs/09` needs a pass** to mark §5 (motion, Reanimated-shaped) and §6 (the prose ETA spec) as
    superseded by the component specs, and to say which of its rules are identity and which are idiom.
    Not done here — it wants the format to exist first.
  - ⚪ **`apps/mobile`'s TypeScript 6.0.3 divergence from 5.9.3 resolves itself** when the Expo SDK
    leaves the tree. An incidental win, not a reason.
  - ⚪ **WP0-5 is barely affected.** Worker, domain, KV/R2 and the publish pipeline are identical either
    way; the app-hosting half is `expo export -p web` → Pages versus `vite build` → Pages, a small
    contained swap. Migrating before there are riders is how a project does not launch.

## ADR-076 — The live engine is selected by the environment, and the default stays `poll`
> **Numbering note:** **073–074** were reserved for WP5-4/5-5 and are used;
> [ADR-075](#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)
> was written concurrently on another branch and is left where it is, so WP5-6 takes **076** rather than
> renumbering somebody else's anchor out from under nine files that reference it.

- **Status:** **Decided and implemented 2026-08-03** (WP5-6). Implementation:
  `packages/api-client/src/live/select.ts` (new — `liveEngineFrom`, `liveTransportFor`,
  `liveTransportFromEnv`, `LIVE_ENGINES`, `DEFAULT_LIVE_ENGINE`), `apps/mobile/lib/datasource.ts`,
  `apps/web/src/adapters/datasource.ts`, and `LiveTransportContext` moved from
  `packages/api-client/src/index.ts` into `live/engine.ts` so `select.ts` can read it without a cycle.
  Pinned by `packages/api-client/test/live-select.test.ts` (9 rows),
  `apps/mobile/test/datasource-transport.test.ts` (4) and `apps/web/test/datasource-transport.test.ts` (3).
  Docs: `docs/10`'s configuration table loses its two "nothing yet" rows; all three `.env.example` files
  lose their "nothing reads these" block.
- **Context.** `EdgeClientOptions.liveUrl` and `.transport` were the plumbing;
  `EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT` and `EXPO_PUBLIC_LIVE_URL` / `VITE_LIVE_URL` were
  the documented spellings — in `docs/10`, in three `.env.example` files, and in ADR-056 — and **nothing
  read any of them**. So `/v1/live` shipped *unreachable from a real build*: the server, the transport and
  its reconnect policy all existed and were tested, and no build could select them. That is also the
  bounding fact for every shard defect Wave 5's review found: five of the thirteen were in `eta-hub.ts`,
  no rider was affected by any of them because nothing could reach the object, and that is equally why
  five of them shipped green.
- **Decisions:**
  1. **The read stays per-renderer; the decision does not.** `process.env.EXPO_PUBLIC_*` and
     `import.meta.env.VITE_*` are inlined by two different bundlers, and babel-preset-expo's inliner
     visits **only** a literal `process.env.X` member expression — so a destructure, a computed key, or a
     helper taking the variable's *name* compiles, runs in dev, and bakes in `undefined` in a production
     bundle. `endpoint.ts` already argues this for the API URL. Each shell therefore keeps one literal read
     per variable and hands the string to `liveTransportFromEnv`, which is the only part with a rule in it.
     Not a second `=== 'socket'` per app: that is exactly the drift the one-declaration discipline exists
     for, and the two renderers would eventually disagree about a spelling.
  2. **The default stays `poll`, and `liveTransportFromEnv` returns `undefined` for it.** Both `undefined`
     and `createPollTransport` produce the poll emulator — `EdgeClient` is
     `opts.transport ?? createPollTransport` — but only `undefined` leaves *the client* holding the answer
     to "what is the default", instead of two app shells each restating it.
  3. **No `auto`, and it is now asserted rather than only argued.** An automatic choice implies a
     socket→poll fallback and none exists: `createSocketTransport` reconnects for ever rather than
     degrading, so `auto` would be a promise the code does not keep, and a transport that quietly became a
     different transport would make "which engine is driving" unanswerable. `liveEngineFrom('auto')` is a
     test row.
  4. **An unrecognised spelling falls back to `poll` and warns once, naming the value and the two legal
     ones.** Both alternatives are real and neither is free. Throwing breaks first paint over a
     misconfigured *optional* knob, on a data layer constructed at module scope. Silently polling is this
     repo's recurring failure shape — somebody sets the variable, sees ordinary behaviour, and concludes
     the socket works. Case-sensitive on purpose: `SOCKET` is a typo, not a synonym, and normalising case
     would make the accepted set larger than the documented one.
  5. **The socket factory reads `ctx.endpoints.socketUrl` *inside* the factory.** `EdgeClient.watch()`
     calls the factory once per **subscription**, and the connect URL carries `?targets=` because the
     Worker derives the shard from it (ADR-056 decision 7). A closure capturing a URL built at module scope
     would be wrong the moment a second screen watched a different place — and wrong invisibly, because one
     screen would still work. Asserted by stubbing the platform `WebSocket` and reading back two different
     connect URLs from two subscriptions.
  6. **`EXPO_PUBLIC_LIVE_URL` / `VITE_LIVE_URL` are wired too**, for the one case derivation cannot cover:
     a socket tier on a different host. Unset — the normal case — still means `wss://<same host>/v1/live`
     derived by the corpus-pinned `liveSocketUrl`, so ADR-056 decision 8's "one variable per renderer"
     is unchanged.
  7. **Nothing needs to change in `build-web.mjs`.** A WebSocket handshake is never dispatched to a service
     worker's `fetch` handler, so no Workbox route could match `/v1/live` and there is nothing cacheable
     about a socket. The script already spreads `...process.env` into the `expo export` child, so an ambient
     value reaches the build without an edit. Checked rather than assumed.
- **What flipping the variable un-latches, and what we did about it.** Selecting `socket` makes five
  confirmed `eta-hub.ts` findings reachable for the first time (ADR-056 decisions 14, 15, 17 and the
  `Eta.stopId` correction of decision 3). Three things stand behind them now, and none of them existed
  when the findings were written:
  - **[ADR-074](#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines)
    drives the real Durable Object over a real socket** for 11 scenarios, including four that refuse an
    upstream board, and asserts `resyncNeeded === false` on every frame — so the shard's counter, its
    retention, its silence and its accepted-set echo are exercised end to end rather than reviewed.
  - **[ADR-073](#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire) closed the
    one defect that was rider-visible on both engines**, which was the largest of the latent five in
    consequence.
  - **The default is still `poll`**, so this is a change to what is *possible*, not to what ships. Nobody
    is exposed to the shard by upgrading; they are exposed by setting a variable, and that is now a
    decision somebody makes rather than a source edit somebody forgets.
  **What still has not happened, stated plainly:** the socket has never spoken to a *deployed* Worker
  (WP0-5), `/v1/live` is unprotected and the `Origin` check is browser-only and off by default (ADR-056
  decision 9), and hibernation's *policy* remains locally unobservable.
- **Consequences, including what we are accepting:**
  - **`apps/web` can select the socket and it changes nothing a rider of that app sees.** No screen there
    calls `DataSource.watch()` — Nearby fetches `getNearby` on an interval — so there is no subscription to
    run over either engine until WP5-7. The plumbing is symmetrical anyway, because the asymmetry that
    costs is the one nobody notices until the second renderer needs it. `docs/10`'s row says so rather than
    implying parity.
  - **With the socket selected, each subscription opens its own connection**, since the factory is
    per-`watch()` call. Today that is one screen watching one place; when Favourites or Nearby adopt live,
    it is worth revisiting whether a client should multiplex.
  - **The default engine now has a test.** Before this it was pinned only behaviourally, by
    `edge-client-watch.test.ts` observing `/v1/etas/:id` requests — a good test of the poll path that says
    nothing about what happens the day somebody changes a `??`. Both app-shell suites now assert the pair
    (fetched-and-not-socketed, or socketed-and-not-fetched) rather than "did it fetch", so a socket with a
    polling fallback could not pass either.
  - **The module-scope read makes the selection awkward to test, and the test says so.** `vi.resetModules()`
    plus a dynamic import, with the platform globals stubbed **before** the import because `EdgeClient`
    binds `globalThis.fetch` in its constructor. That is the price of a singleton built at import time; the
    alternative — a factory a screen calls — would move the env read out of the position the Expo inliner
    requires.
  - **Turbo needs no change**, measured with `--dry=json`: framework inference already covers `VITE_*` and
    `EXPO_PUBLIC_*` for both app packages' `build`, `dev` and `test` tasks, so the new variables
    participate in the cache hash. A redundant `env` array would be one more thing to keep in sync.

## ADR-077 — A card can say "we could not ask", and a failure list must not outlive its round
- **Status:** **Decided and implemented 2026-08-03** (WP5-13). Implementation:
  `packages/contract/src/wire/errors.ts` (**new** — the taxonomy extracted out of `responses.ts`),
  `packages/contract/src/wire/detail.ts` (`failed` on `NearbyStop` and `StopDetail`),
  `packages/core/src/live.ts` (`applyLiveEtasToNearby` / `applyLiveEtasToStopDetail` take the current
  failure set), `packages/core/src/stop-card.ts` (`StopCardView.incomplete`),
  `apps/edge/src/stop-route.ts`, `apps/edge/src/nearby.ts`, `packages/i18n/src/catalogue.ts`
  (`etasUnavailable` ×3 locales + the 9 regenerated native artefacts),
  `apps/mobile/components/StopRow.tsx`, `apps/web/src/components/StopCard.tsx`. Pinned by **9 new corpus
  rows** across three groups, both renderers' projection suites (which caught the new field on their own),
  and 3 new edge specs.
- **Context.** [ADR-073](#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire)
  put per-pole failure on `/v1/etas/:id` and deliberately left it off `/v1/nearby` and `/v1/stop/:id`,
  with the reason recorded: those two payloads pass through the kernel's merge helpers, which **spread**
  the document they are handed, so a `failed` list fetched once over HTTP would survive every later live
  merge — a screen would keep saying "we could not reach this kerb" long after the socket recovered. The
  consequence of leaving it out was equally recorded and equally real: **a Nearby card during a KMB
  outage rendered identically to a stop with no buses due.** Measured, not argued — with the KMB base URL
  pointed at an unroutable host, `/v1/nearby` returned six cards of which three had `etas: []` and
  nothing whatsoever to distinguish them from a quiet stop.
- **Decisions:**
  1. **The merge helpers take the current failure set as an argument, and `failed` is destructured *out*
     of the spread.** Not overwritten in it — the difference is the whole bug. `...detail` copies the
     document's own list, so a conditional that only *adds* the argument's version leaves the stale list
     standing on exactly the call that has none to report: the live merge. Removing it first means an
     absent argument **clears** the field, which is the direction that fails safe: a caller that forgets
     loses information rather than inventing it.
  2. **An absent argument is the honest state of a live consumer**, not an oversight. The frames carry no
     failure list, deliberately (ADR-073) — the shard applies the retention itself — so once a
     subscription takes over, its `status: retrying` is the authority and the HTTP-era list must go. The
     cost is precision: a two-kerb place whose second kerb is refusing reads as "retrying" for the whole
     place on the live path, where the HTTP payload could name the kerb. Recorded rather than fixed; the
     fix is frames that carry `failed`, which is a wire change to make when a screen renders per-kerb
     failure, because that is when the extra precision has a reader.
  3. **A card gets a boolean, not a count, and the kernel decides it.** `StopCardView.incomplete` is true
     when at least one of the place's boarding points refused. The granularity *is* the decision: a
     compact card prints no per-kerb heading — the same argument `soonestPerLine` makes for collapsing two
     kerbs' readings into one row — so a count of refusing kerbs would be a number with no referent on
     that surface. `apps/web`'s `check-no-derivation.mjs` makes this structural rather than conventional:
     a renderer testing `view.failed?.length` would be a second declaration of the rule, and the two
     renderers would eventually disagree about the empty-array case.
  4. **Length, never presence.** `failed: []` reads as "every board answered", exactly as an absent field
     does. The wire omits it when empty, but a fixture or a generated client that materialises empty
     arrays must not flip every card in the app; a corpus row asserts it.
  5. **Attribution goes through `memberStopIds`.** An `EtaFailure.stopId` is a pole while a
     `NearbyStop.stop.id` may be a merged `P:` place id (ADR-042), so `applyLiveEtasToNearby` matches
     failures to cards exactly as it matches readings. Comparing them directly would leave every merged
     place — most of the interesting ones — looking healthy while its kerbs refused. A failure naming a
     pole no card clusters is **dropped**, which is reachable in practice: a batch endpoint (WP5-7) will
     report failures for a whole request while a caller renders a filtered subset.
  6. **The string says the times are missing and that the reason is ours.** *"Live times unavailable"* —
     not that the stop is closed, not that no bus is coming, and not how many kerbs refused. ADR-056
     decision 18 declined the neighbouring question (what to say about a *refused target*) because "this
     stop has moved or closed" is a claim about the world a parse failure cannot support. An upstream
     refusal is the easier case: we know what went wrong and whose fault it is. Muted, below the rows, no
     alert colour — the readings that arrived are true, and nothing is wrong with the rider's stop.
  7. **The taxonomy moved to `wire/errors.ts`, and it was forced rather than chosen.** `EtaFailure` is now
     a field in `detail.ts`, and `responses.ts` **imports** `detail.ts` for `WIRE_ENDPOINTS` — so
     `detail.ts → responses.ts` closes an ESM cycle, which between two modules of top-level `const`s does
     not fail loudly: it evaluates one to `undefined`, surfacing as a schema silently missing a field.
     That is the exact hazard `responses.ts`' original note warned about, arriving from the other
     direction. `ErrorCodeSchema`, `ERROR_CODES`, `WireErrorSchema`, `ErrorResponseSchema` and
     `EtaFailureSchema` now live in a module that imports nothing of ours, and `responses.ts` re-exports
     every one of them so **no caller anywhere changed**. Note the second-order trap that came with it:
     adding `export * from './wire/errors'` to the package index alongside the existing
     `export * from './wire/responses'` makes those names **ambiguous**, and ESM resolves an ambiguous
     star export by *excluding* the name — `ERROR_CODES` would have become `undefined` at the package
     root with no error anywhere. Caught by asserting the root's exports at runtime rather than by
     reading; the index exports the taxonomy through exactly one path.
- **Driven, not only tested.** Verified against the real Worker with the KMB upstream pointed at an
  unroutable host, then reverted: `/v1/nearby` named all three kerbs of each KMB place with
  `upstream_unavailable` / `retryable: true` while the **Citybus** place in the same response kept its six
  readings and reported nothing; `/v1/stop/:id` named all three poles with every row's `eta` null. Then in
  a browser, the mixed-operator case — the one no unit test would have produced: *"Belair Garden, Tai
  Chung Kiu Road"* showed its NLB and Citybus arrivals (B8 4 min, 182 52 min) **and** the muted marker for
  its refusing KMB kerbs, while the two all-GMB places beside it showed full times and no marker at all.
  Per-operator, per-kerb, on live data.
- **Consequences, including what we are accepting:**
  - **The healthy payload is byte-identical to before.** `failed` is omitted when empty on both endpoints,
    confirmed by `curl` against live data as well as by a control row in each suite.
  - **`incomplete` is a required field on `StopCardView`**, so every hand-built view literal in the two
    projection suites had to declare it. That is the type system doing its job — and both projection
    suites failed on the new field before they were updated, which is `apps/web`'s whole purpose
    (ADR-069) working as intended on a change that started in the kernel.
  - **A card with rows *and* the marker is the common case, not the edge case** — a place is often served
    by more than one operator, and only one of them is down. The marker sits below the rows for exactly
    that reason.
  - **Open — Favourites shows the marker too, and that is right but incomplete.** `FavoritePlaceRow`
    renders the same `stopCardView`, so a favourite at a refusing place now says so. It does **not** fix
    the adjacent unowned item: a favourite whose route simply has no arrival still renders an empty card,
    and that is a different cause with the same symptom. Do not close one over the other.
  - **Open — `/v1/route/:id` still says nothing.** Its ETAs come from one bulk call, so the failure is
    all-or-nothing and the view degrades to static; giving it a per-stop failure field means deciding
    what a route screen says about a whole feed being down, which no row owns yet.

## ADR-078 — Rule 7 is enforced per commit over a range, and an empty range is a failure
- **Status:** **Decided and implemented 2026-08-03** (WP5-8). Implementation:
  `scripts/precommit-docs-check.mjs` (the rule extracted as `docsVerdict`, plus a `--range` mode and a
  `--selftest`), `package.json` (`check:docs-freshness`, `check:docs-freshness:selftest`, the latter
  appended to the `boundaries` chain), `.github/workflows/ci.yml` (`fetch-depth: 0` and the per-commit
  step, replacing the paragraph that explained why the step could not exist), `CLAUDE.md` rule 7,
  `docs/05`.
- **Context.** Rule 7 — *a commit that changes code changes the docs, or says `[docs-ok]` and why* — was
  the only golden rule in this repo enforced by **nothing**, and both CLAUDE.md and `ci.yml` said so at
  length. The reason was mechanical rather than neglect. `scripts/precommit-docs-check.mjs` is a Claude
  Code `PreToolUse(Bash)` hook: it reads a tool-call payload on **stdin**, extracts the `git commit`
  command line from it, and diffs the **index**. In CI stdin is empty and nothing is staged, so both of
  its early exits fire and it returns 0 having examined nothing. Wiring *that* into CI would have shipped
  a step that passes for ever while checking nothing — the failure this repo has now hit eight times, and
  worse than no step, because a green tick is a claim. It is also not a git hook: `core.hooksPath` is
  unset and `hooks/` holds only samples, so a `git commit` typed outside a Claude Code session never saw
  it either.
- **Decisions:**
  1. **The rule is one function and the modes only differ in their inputs.** `docsVerdict({ files,
     bypass })` is the whole of rule 7; hook mode hands it the index and a bypass read from the *command
     line*, `--range` mode hands it one commit's `diff-tree` and a bypass read from that commit's
     *message*. Computing `bypass` in the caller rather than sniffing for it inside is what keeps the
     predicate pure — it is tested with neither a git repository nor a stdin payload — and it is why there
     is one copy of the rule rather than two. Two copies of a rule that must agree is the defect
     [ADR-073](#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire) is about,
     one layer down.
  2. **`--no-verify` is honoured in hook mode and nowhere else.** It means "skip the hooks for this
     invocation", which is a statement about a hook rather than about the documentation, and a commit that
     already exists has no invocation to skip. So in `--range` mode the only bypass is `[docs-ok]` in the
     message — which is per commit, permanent, and visible in `git log` for ever. That is also why this
     gate has **no allowlist**, unlike every `check-*.mjs`: the escape hatch is already in the history and
     needs no second file to rot.
  3. **An empty range is a FAILURE.** A range naming no commits has told us nothing about the tree, and a
     gate answering "fine" to that is exactly this repo's recurring failure in the one shape a commit-range
     check can take. It exits 1 and names the two ways a range goes empty (a shallow clone; the 40-zero
     `before` sha on a new ref).
  4. **`--no-merges`, with the limitation stated rather than discovered.** A merge's `diff-tree` against
     its first parent is empty — verified against both merges in this history — so a merge would read as
     "no files" and pass vacuously; and on `pull_request` the checkout is a *synthetic* merge of head into
     base, which without the flag would be examined as one extra commit containing the whole PR squashed,
     passing whenever any commit in it touched a doc and defeating the per-commit granularity. **What
     therefore escapes:** content that exists only in a merge commit (an "evil merge", a conflict resolved
     by editing code). Checking it means diffing a merge against each parent and deciding which difference
     is the merge's own — a real problem, not worth solving for a repository whose merges are all
     PR merges.
  5. **`--root` on `diff-tree`, which is the easy thing to get wrong.** Without it `diff-tree` prints
     *nothing* for a commit with no parent, so the initial commit of any repository passes unexamined.
     Measured against this repo's own root commit: 1 file with the flag, 0 without.
  6. **The selftest builds a real repository, in `os.tmpdir()`, and never touches this one.** A commit
     range cannot be faked, so the range half of the selftest runs `git init` in a temp directory and
     commits fixtures into it — asserting that three commits produce exactly one offender **and that it is
     the right one**, that a merge is skipped while the merged branch's own commits are not, that the root
     commit is examined, and that an empty commit passes. Every git call passes an explicit `cwd`, which is
     not fussiness: this workspace shares its checkout and its branch with other sessions, so a mutating
     git command that inherited the process cwd would be reaching into somebody else's tree.
  7. **The live tree is the last control, and a shallow clone fails it.** The selftest applies the real
     rule to the last 20 commits of the current branch. `actions/checkout` fetches one commit by default,
     so without `fetch-depth: 0` that control would examine the head commit, report "1 commit examined",
     and pass — a control reading a twentieth of what it claims is the same defect as one reading nothing,
     arriving silently. It now refuses a shallow clone by name.
  8. **The chain runs the selftest; CI runs the range.** There is no canonical range locally (on `main`,
     `origin/main..HEAD` is empty, which is decision 3's failure), so `pnpm boundaries` ends with
     `check:docs-freshness:selftest` and `ci.yml` computes the range from the event:
     `<base sha>..HEAD` on `pull_request`, `before..HEAD` on `push` with the zero sha resolved to the
     pushed commit's parent. `pnpm check:docs-freshness` is the by-hand equivalent for a branch.
- **Measured before turning it on:** the rule was run over **all 51 non-merge commits in this repository's
  history** and **every one passes** — 44 of them touch code, 12 claim `[docs-ok]`. So the gate needed no
  grandfathering, no `since:` date and no allowlist of historical shas, which is the outcome that made it
  an S rather than an M. That measurement is also what the live-tree control preserves: if a later commit
  breaks the rule, `pnpm test` goes red on the branch before CI does.
- **Consequences, including what we are accepting:**
  - **Two exit codes, deliberately.** `2` in hook mode, because that is the code a `PreToolUse` hook must
    use for its stderr to reach the agent; `1` in `--range`/`--selftest`, the ordinary failure code every
    other gate in the chain uses. It looks like a slip, so the header says why.
  - **`fetch-depth: 0` in CI** — a full fetch of a ~50-commit repository, which is noise next to
    `pnpm install`, and load-bearing for two steps rather than one.
  - **This is still not a git hook.** A human typing `git commit` outside a Claude Code session gets no
    warning; they get a red PR. That is the honest division: a hook is advice at the keyboard, and CI is
    the thing that actually holds the line. Installing a real `core.hooksPath` hook would be a third
    caller of the same `docsVerdict` and is a follow-up, not a gap in this one.
  - **The `check-docs` skill is unchanged** and is still what a blocked commit should reach for. This ADR
    added the enforcement, not the remedy.

## ADR-079 — One request per round: the batch ETA endpoint, and Nearby as a live adopter
- **Status:** **Decided and implemented 2026-08-03** (WP5-7). Implementation:
  `packages/contract/src/wire/responses.ts` (`ETAS_BATCH_MAX_IDS`, `EtaBatchEntry`, `EtaBatch`, the
  `getStopEtasBatch` endpoint, `WireParam.type` gains `'string[]'`), `packages/contract/src/openapi.ts`
  (the repeated-parameter emit), `packages/core/src/live.ts` (`narrowEtasToRoutes`, `liveTargetsKey`,
  the `ETAS_BATCH_MAX_IDS` restatement), `packages/core/src/types.ts`,
  `packages/core/src/datasource.ts` (`getEtasBatch` on the seam), `apps/edge/src/stop-route.ts`
  (`stopEtasBatch`, `LIST_CTB_BUDGET`), `apps/edge/src/index.ts`, `apps/edge/src/nearby.ts`,
  `packages/api-client/src/index.ts`, `src/live/engine.ts`, `src/live/poll.ts`,
  `apps/mobile/lib/useLiveNearby.ts`, `apps/web/src/hooks/useLiveNearby.ts`,
  `apps/mobile/app/(tabs)/index.tsx`, `apps/web/src/screens/Nearby.tsx`. Pinned by **11 new corpus
  rows** in two groups, `apps/edge/test/etas-batch.test.ts` (8 cases in workerd),
  `apps/mobile/test/live-nearby.test.tsx` (8), `apps/web/test/live-nearby.test.tsx` (4), and the
  request-count assertions in `packages/api-client/test/edge-client-watch.test.ts` and
  `live-matrix.test.ts`.
- **Context.** `applyLiveEtasToNearby` was written and corpus-pinned in WP5-1 and had **no consumer for a
  whole wave**, for a reason recorded at the time: the poll emulator issued one `/v1/etas/:id` per target
  per cadence, Nearby watches up to six places, and the screen already fetched `/v1/nearby` once per
  window. Adopting a subscription would have taken one request per window to six — a regression a rider
  pays for a feature they cannot see. So the row's own sequencing was *endpoint first, adopter second*.
- **Decisions:**
  1. **The batch is enveloped and per id: `{ reports: [{ id, etas, failed?, error? }] }`.** A flat
     `{ etas, failed }` across all ids is not merely awkward, it is **undecodable**: an `Eta.stopId` is a
     *pole*, a requested id may be a `P:` place spanning several, and a bare pole id is promoted to its
     place by the dataset's alias table — so the map from "the id I asked about" to "the poles that
     answered" lives in the dataset and no client holds a copy. The poll emulator keys its `readings` and
     applies `retainFailedPoles` **per target**, so a flat list would retain another target's readings. A
     `Record<id, EtaReport>` was rejected for losing order (D1's canonical serialization) and for having
     nowhere to put a per-id failure without a union value.
  2. **An entry is `EtaReportSchema.extend({ id, error })`, so it is assignable to `EtaReport`.** That is
     the property that keeps the batch from becoming a second read path: everything that consumes an
     `EtaReport` takes an entry unchanged, and `apps/edge/test/etas-batch.test.ts` asserts an entry is
     **byte-identical** (`JSON.stringify`, so key order too) to `/v1/etas/<that id>`. `.extend()` also
     emits a flat component rather than an `allOf`, per the `ErrorResponseSchema` precedent.
  3. **The parameter repeats; it is not delimited — and this is a grammar fact, not a preference.** `,`
     **is** a legal `idchar` (`ids/id-grammar.abnf`: only `:`, `+` and `|` are structural), and
     `URLSearchParams` decodes `%2C` *before* any split could run, so `?ids=A%2CB,C` and `?ids=A,B%2CC`
     arrive identical. Verified in node rather than assumed. Repetition is the only separator not drawn
     from the id alphabet. `WireParam.type` therefore gains `'string[]'` and the OpenAPI emit adds
     `style: form, explode: true` — both spelled out even though `explode` is form's default, so a
     generator reading only one cannot emit a CSV. **`/v1/live?targets=` stays comma-separated**: real ids
     contain no commas, and changing a socket's URL grammar is a wire change with no defect behind it. The
     inconsistency is recorded rather than propagated.
  4. **A per-id failure is an `error` on its entry and the batch is a `200`.** Failing the request would
     throw away the ids that answered — the identical judgement ADR-073 made one level down for a place
     whose second kerb refused. `wireErrorOf` is the same classifier, so a stale favourite is
     `not_found`/`retryable: false` and the emulator's existing drop rule prunes it with no new mechanism.
     The residual accepted knowingly: an entry with `error` set carries `etas: []`, which is the very
     ambiguity ADR-073 removed one level down — mitigated by the field's own description telling a reader
     to branch on `error` and never on the empty list, and by `etas` staying required so `/v1/etas/{id}`'s
     shape does not change.
  5. **12 ids, and over it is a `400` rather than a truncation.** Twelve is `EtaHub`'s
     `LIVE_MAX_TARGETS_PER_CONNECTION`, because it answers the same question. `/v1/nearby` may clamp its
     `radius` because a clamped radius still answers the question asked; a silently shortened id list does
     not — the caller would hold that target's previous readings for ever with no `status` frame to say
     they had stopped being refreshed, which reads exactly like the outage this endpoint makes visible.
     **The cap is on the wire** (`ETAS_BATCH_MAX_IDS`) because the *client* has to chunk at it, and the
     client chunks rather than truncating for the same reason.
  6. **`CONTRACT_VERSION` does not move.** A new path with new components, with `/v1/etas/{id}`,
     `EtaReport`, `EtaFailure` and `Eta` untouched, is additive per ADR-052 §5 — whose own restatement at
     the constant says additive changes "must not touch this". Measured: `openapi.json` 7 → **8 paths**,
     36 → **38 schemas**; `asyncapi.json` 47 → 49 (it registers the shared components); the native guide's
     figures move with them, which is why `native:emit` is mandatory here and is a step CLAUDE.md's emit
     block did not list.
  7. **`cached()` is kept, with the key normalized.** The id list is deduplicated and sorted before the
     colo-cache key is rebuilt, so `?ids=b&ids=a` is one entry with `?ids=a&ids=b`. The combinatorial-key
     worry is real in general and largely answered by a fact already in the tree: the fix is snapped to a
     25 m grid *before it leaves the device* (`snapFix`, mandatory in `location.ts`), so two riders at one
     stop produce the same six place ids and the same key. What does the heavy lifting is not the response
     cache at all but `coalesce`'s per-pole 30 s TTL — asserted here: a batch over the six places
     `/v1/nearby` just served costs **zero** upstream calls, and cold it costs one per distinct pole
     (twelve), not one per id.
  8. **No `routes=` on the batch, and the narrowing became a kernel rule.** Per-id narrowing needs a
     nested delimiter and decision 3 has just established there is no safe character for one. So the batch
     answers every route and `narrowEtasToRoutes` — the same function `/v1/etas/:id?routes=` now calls —
     runs client-side one hop later, while the shard goes on narrowing server-side by passing `routeIds`
     into the same producer. One declaration, two call sites; written twice they would eventually disagree
     about a route id that no longer parses or about the empty list, and identical listener output on both
     engines is precisely what ADR-074's corpus asserts. Cost: a narrowed target's un-narrowed readings
     cross the wire. No caller narrows today.
  9. **`getEtas` was replaced in the transport, not supplemented.** `PollTransportDeps` and
     `LiveTransportContext` take `getEtasBatch` and nothing else. Keeping both would put the round's rules
     — retention, the permanent drop, the failure ordering — on two paths, one of them unreachable in
     production and therefore exercised only by a test, which is this repo's recurring failure shape.
     `DataSource.getEtas` and `/v1/etas/{id}` both stay: the endpoint has eight callers in `apps/edge/test`
     and the seam is a published declaration.
  10. **A *request*-level failure is fanned out to one failure per target of that request.** This is the
      one failure shape only the polling engine can have — the phone is offline, the Worker 502s — and the
      shard cannot produce it at all, because it calls the read path per target inside the object. So
      collapsing it to a single `status` frame would make the two engines emit a different number of frames
      for identical circumstances, which is the byte-identity WP5-1 exists to assert. A missing entry for
      an id we *did* ask about, with no request failure to explain it, is `internal`/retryable and never an
      empty reading list.
  11. **`liveTargetsKey` is in the kernel because an array dependency is a request storm.** A live hook
      subscribes inside an effect that must depend on the target set; a `WatchTarget[]` is a fresh array
      every render, the subscription's own readings are written to the query cache, that re-renders the
      screen, and `subscribe` fires a round *immediately* — so an array dependency resubscribes on its own
      output, unboundedly, one HTTP request per turn. The key is over the **accepted** set, so two
      orderings of one set (what a Nearby list produces as a rider walks a few metres) are one
      subscription, and an empty string means "nothing here is watchable". `|` is the only separator,
      because `:` is inside every id and `+` separates the members of a place id — either would make
      `{P:KMB:A+KMB:B}` and `{P:KMB:A, routes:[KMB:B]}` spell one key — and each target carries an arity
      field so it stays self-delimiting. In the kernel rather than in a hook because two renderers must
      resubscribe at the *same* moments, which is drift on the spec rather than on the pixels (ADR-075).
  12. **The hook is hand-copied per renderer, and tested per renderer.** `packages/api-client` may not
      import React (`layers.json` gives the `client` layer `"npm": []`), so a shared hook is not available
      without a new package and a new layer entry. The rules are shared and the wiring is not — the same
      split `useLocation` and `useClientPolicy` already have. Both copies have their own suite, because
      every asymmetry `apps/web` has caught has been of one shape: wired in one shell, documented in the
      other.
- **Two defects found on `apps/mobile` Nearby while doing this, both live before it:**
  - **The clock was frozen.** `const now = Date.now()` in the render body only advances when something
    re-renders, and this screen had **no** `refetchInterval` at all — `git log -S` finds the string has
    never existed in that file — no interval in `useClientPolicy`, and a one-shot `useLocation`. So the
    minutes never aged and `etaReadout`'s `stale` cue could never fire. It is the defect
    `useLiveEtas` documents for the Place screen, present here already and worse, because the *data* was
    frozen too: 0 requests per window, not 1. Adopting the subscription fixes both, and the hook returns
    `{ now }` so the pairing cannot be half-adopted.
  - **A failed first load was permanent.** `retry: 1`, `refetchOnWindowFocus: false`, no interval, and an
    error branch with no pull-to-refresh: a rider whose first request lost a network race sat on a dead
    screen. Both renderers now carry the Place screen's conditional
    `refetchInterval: (q) => q.state.status === 'error' ? … : false`.
- **Measured, before and after, per renderer** (window = `refreshAfterMs`, 30 s):

  | | before | after |
  |---|---|---|
  | `apps/web` Nearby | 1 (`/v1/nearby` on an interval) | 1 (`/v1/etas?ids=…` per round) |
  | `apps/mobile` Nearby | **0** — nothing refreshed at all | 1 |
  | the same screen on the per-target engine | would have been 6 | — |

  So the row's acceptance — *"request count per window does not increase"* — needed restating, and this is
  the honest version: **≤ 1 request per window per Nearby screen, and the same number on both
  renderers.** Mobile going 0 → 1 is a fix, not a regression, and stating it that way is the point:
  against the old mobile baseline *any* subscription "increases" the count.
- **Consequences, including what we are accepting:**
  - **`StopCardView.incomplete` is first-paint-only on Nearby.** The live merge is called with no failure
    set, so the "Live times unavailable" marker a card got from `/v1/nearby`'s own `failed` clears when
    the first round lands. That is ADR-077 decision 2's rule and its own words: *"the frames carry no
    failure list, deliberately — so once a subscription takes over, its `status: retrying` is the
    authority and the HTTP-era list must go … the fix is frames that carry `failed`, which is a wire
    change to make when a screen renders per-kerb failure."* What covers the rider instead is
    `retainFailedPoles` keeping a refusing kerb's readings with their own `dataTimestamp`, so they visibly
    age — which is exactly why the restored clock matters more than it looks. **The residual, stated
    narrowly:** a pole that has never produced a reading retains nothing, so a card at a place whose
    outage was already running at first paint reads as a quiet stop. Owner: **WP5-14** (new row).
  - **`VITE_LIVE_TRANSPORT=socket` is no longer inert in `apps/web`.** ADR-076 recorded that it was real
    configuration changing nothing visible, because no screen there called `watch()`. One does now, and
    three code comments plus `docs/10` that said otherwise were corrected rather than deleted.
  - **`/v1/etas/` (trailing slash) is now a 400 with a usage line** where it used to fall through to the
    router's 404. Better, and still a behaviour change on an existing path.
  - **`NEARBY_CTB_BUDGET` became `LIST_CTB_BUDGET` in `stop-route.ts`** — one declaration for every reader
    that answers about several places at once, rather than a second copy of `12` in the new branch. The
    shard keeps its own, deliberately: a round that repeats every 45 s for as long as a socket is open has
    a different reason for the same number.
  - **The `?routes=` parameter's description was a lie and is corrected.** It said "to restrict the
    fan-out to"; it has never reached `memberEtaLists` and filters the response only. Fixed in the
    contract, so the published document stops making a claim about cost that the code does not make.
  - **Test totals:** core 816 (+12), edge 147 (+10), api-client 71 (+2), mobile 53 (+8), web 32 (+4).
    Corpus 91 groups / 772 cases.

## ADR-080 — What tells two boarding points apart, in the order the data can support it
- **Status:** **Decided and implemented 2026-08-03** (WP5-12). Implementation:
  `packages/core/src/stop-name.ts` (`poleNameKey`, `poleFlagCode`),
  `packages/core/src/stop-detail.ts` (`poleDistinctions`, plus the private `sidedOctants` / `poleUnits` /
  `centroid` / `byHeading` extracted out of `poleSideOctants`, which is otherwise unchanged),
  `packages/i18n/src/catalogue.ts` (`poleTooCloseToTell` ×3 locales + the 9 regenerated native artefacts),
  `apps/mobile/app/stop/[id].tsx`, `packages/data-normalize/src/dataset.ts` (a prose correction — see
  below). Pinned by **18 new corpus rows** in three groups (`stop-detail#poleDistinctions` 7,
  `stop-name#poleNameKey` 6, `stop-name#poleFlagCode` 5), **4 new `REQUIRED_ROWS` entries**, and four
  cross-cutting properties in `packages/core/test/stop-detail.test.ts`.
- **Context — the gap, and why it needed a third kind of answer.**
  [ADR-071](#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two) built two
  refusals and required their thresholds to stay different: `foldDuplicatePoles` will not merge two poles
  more than **2 m** apart (one coordinate grid step), and `poleSideOctants` will not name a compass side
  under **10 m** — *"declining to name a side is a weaker act than asserting two poles are one."* Both are
  right, so the band between them is real. Re-measured here over build `ceb33eed99461e04`: **141 member
  pairs across 115 places** share an operator and a byte-identical name in all three locales and sit
  2–10 m apart (43 in 2–5 m, 98 in 5–10 m, **0** at or under 2 m — the fold's window is genuinely empty),
  and **all 141 print a character-for-character identical heading today**. The row that filed it said not
  to widen either threshold. This does not.
- **Two of the row's own three leads were measured and do not work. Recording that is half of this ADR.**
  1. **"A printed code that upstream carries in one locale only" resolves 0 of the 141 — by
     construction.** The band's membership predicate is *"identical name in every locale"*, so any printed
     code is necessarily identical on both poles. The row conflated two disjoint populations. The one it
     was *describing* is different and real: **52 pairs whose `en` matches while the Chinese differs, 28 of
     them by a code**, all of the shape "the English label lacks a code that both Chinese names carry".
     That is worth having, and it is `poleFlagCode` below — a **display** rule, not the dataset change the
     row assumed.
  2. **"Which pole the rider is closer to" cannot be honest at this range, and the app does not hold a
     position good enough to try.** `SNAP_GRID_M` is 25 and the snap is mandatory before a fix leaves the
     device, so simulating a rider standing **exactly at** one of the two poles: the snapped fix names the
     **wrong pole nearer in 97 of 282 cases (34.4 %)**, mean displacement **10.07 m**, max 17.32 m, and it
     exceeds the *entire pair separation* in **224 of 282**. That is before any GPS error — and the snap
     makes the error deterministic, so every rider in one 25 m cell gets the same wrong answer. A stable
     lie is worse than a flickering one.
  3. **"The route sets as a tie-break" was confirmed useless, not refuted.** 136 of the 141 pairs have
     disjoint line sets — the same as at 0–0.5 m and at 25–31 m, so it does not sort by distance and is not
     evidence. And as a *tie-break* it accomplishes nothing a rider can use: the route rows are already
     printed under each heading, so a heading that repeated them adds no information.
  Also quantified, because the row's acceptance names it: **nudging one pole by one latitude grid step
  flips the compass octant in 27 of the 141 pairs (19 %)**. "A word that flips on a one-grid-step
  coordinate nudge" is not hypothetical, which is why the 10 m floor is not widened.
- **The shape that does work was hiding in plain sight: the heading throws away the pole's own name.** Of
  the **258** heading groups `poleSideOctants` declines on its floor guard, **143 have member names that
  differ in some locale** — at Queen Mary Hospital two minibus poles 7.35 m apart both print bare
  `GMB` / `專線小巴` while the wire has carried *"Queen Mary Hospital, Pok Fu Lam Road"* and *"POK FU LAM
  ROAD, near Queen Mary Hospital Wing H"* all along. Saying *"we cannot tell these apart"* there is not
  restraint, it is a false claim about our own data. The other **115** groups are WP5-12's set proper, and
  for those the app **says so plainly** — which is the second branch the row's acceptance explicitly
  permits, and a shippable outcome rather than a cop-off.
- **Decisions:**
  1. **A new export, and `poleSideOctants` is untouched.** Its return type is `Map<string, number>` with 7
     corpus rows including 3 named refusals, hand-ported under ADR-060, and the mixed case below *requires*
     two poles to share a side — which violates that function's own asserted invariant. Widening it would
     mean rewriting the invariant and the ports for a rule that is correct. Its two guards are extracted as
     a **private** `sidedOctants(points)` so a second caller can ask the same question about points that
     have no pole id; its existing rows going green untouched is the proof the extraction changed nothing.
  2. **The order is side → name → units → nothing, and side comes first deliberately.** Tier 1 *is* one
     call to `sidedOctants`, so the **226** groups that speak today are byte-identical by construction —
     asserted as a property over every corpus row, not hoped for. Name-first would replace a two-word
     compass cue with a ~35-character name in 97 groups, and in every name-distinct group one pole's name
     partly repeats the screen title. ADR-071's measured restraint — *a cue on 2 % of places means
     something when it appears* — is preserved rather than diluted.
  3. **Names are compared through a folded key, never by bytes, and this is the finding that would
     otherwise have shipped a lie.** **21 colliding groups** in this build differ *only* by case,
     punctuation width or an ideographic space: `Bonham Road, near Hospital Road` /
     `Bonham Road near Hospital Road`; `KENT ROAD, near Kowloon Tong Station` / `Kent Road, near …`;
     `昭信路, 近煜明苑煒明閣` / `昭信路，近煜明苑煒明閣`. A byte test calls those distinct, prints the same
     words twice, and claims the ambiguity resolved — exactly what `poleSideOctants` refuses to do with a
     compass word it cannot support. `poleNameKey` folds with an **explicit character list** rather than
     `NFKC`, because NFKC makes the hand-port depend on a whole Unicode table agreeing across three
     languages while a list is inspectable and corpus-pinnable. (`Intl` is a denied global in the kernel,
     so a collator was never available.)
  4. **Units, at the same 10 m — no third threshold.** A group the compass rule declines is partitioned by
     **complete linkage** at `POLE_SIDE_MIN_SEPARATION_M`, and the compass question is asked again about
     the *units'* centroids. Complete rather than single linkage on ADR-071's own reasoning: single linkage
     would chain 0 / 9 / 18 m into one 18 m "indistinguishable" unit and suppress a word that is honest at
     18 m. Reusing the existing constant keeps ADR-071's "exactly two numbers" intact — the unit *is*
     "closer than a compass word can resolve", which is what that number already means.
     **This is what makes the mixed place honest, and it is the case a simpler rule gets wrong.** At Lok Hin
     Terrace three poles print bare `KMB`: two at the *same* coordinate and one 47–54 m away. Today all
     three get **nothing**, because the distinctness guard trips on the coincident pair. Now the pair is one
     unit and the far pole another, both units get a side, the pair additionally says it is adjacent — and
     the far pole is **not** marked adjacent, because calling a pole 50 m from its siblings "a few steps
     away" would be a plain falsehood. 29 groups are this shape.
  5. **A record with optional fields, not a discriminated union.** `crowded` and `octant` are genuinely
     orthogonal — a *unit* can have a side while the poles inside it cannot be separated — so a union would
     need a `side-and-crowded` member, which reads as an enum whose author knew the states were a product.
     `StopCardView`'s precedent (ADR-077): fields with docblocks, one written-down invariant, renderers read
     fields. The invariant is **"two poles under one heading share an `octant` only if both are `crowded`,
     and every pole in a multi-pole unit is `crowded`"**, and it replaces `poleSideOctants`' stronger one
     *for the new group only* — the old assertion stays, pointed at the old function, or a reviewer will
     "fix" the unit tier out of existence. A pole with nothing to say is **absent from the map**, never
     present with every field unset.
  6. **`poleFlagCode` borrows a code across locales, and the shape gate is the discriminator.** The active
     locale's own trailing parenthetical is used **verbatim whatever its shape** — that is today's
     behaviour, and a rider reading `(Macao Ferry)` is reading what upstream wrote for them. Only the
     *borrow* is gated on Latin-letters-then-digits, and that gate was measured: of the **63** poles whose
     `en` carries no parenthetical while a Chinese name does, **51 are flag-shaped and 12 are not**, the 12
     being translated place phrases (`黃泥涌道55-57號(近翠景樓)`), and **167** poles carry trailing
     parentheticals that *disagree* across locales for exactly that reason. A code is what is printed on the
     physical flag, so showing the Chinese one to an English reader is the same string rather than a
     translation. **Measured before shipping: zero new colliding groups in any locale, no sided group loses
     its side, and 12 groups in `en` stop colliding entirely** — visible in the corpus rows, where
     `KMB · CW114`, `KMB · CW145` and `KMB · ED516` are poles lifted out of a collision before the labelling
     rule ever sees them. Two of those lose a compass suffix they had: a strict improvement (a code on the
     flag beats a compass word) that will read as a regression to anyone diffing screenshots without this
     paragraph.
  7. **What it says: `poleTooCloseToTell` — "Another stop a few steps away — check the sign".** Claims only
     what is true: there is more than one boarding point, they are closer than the app's own direction
     floor, and we cannot say which is which. Vaguer than the data, which ADR-008 permits — over-precision
     is what it forbids. **No count** (ADR-077's argument, one screen over: a rider cannot act on the
     difference between two and three), **no ordinal** (`poleSideOctants` already refuses "1 of 2", and the
     reason holds), **no distance** (`formatDistance` rounds to 10 m under ADR-008, so "3 m apart" asserts
     precision the same repo refuses one function away), and **not "either stop will do"** — that is advice
     we cannot support, since one may be a shelter and the other a flag. "Check the sign" is the one
     actionable thing left, and it is honest: the flag carries a code the app has just admitted it lacks.
- **No dataset rebuild, and here are the fields it reads.** `StopDetailPole.id`, `.name` (all three
  locales) and `.location`, plus the operator from the id via `parseStopId`. Every one is already on
  `StopDetailSchema`, nothing in `packages/data-normalize` changes, so the content hash cannot move and no
  `dataset:publish` is required — the contrast with ADR-071, which moved the build hash and needed one.
  Deliberately **not** done: writing the borrowed code into `name.en` in the pipeline. That is a dataset
  change, a new hash and its own ADR, and it would rewrite a name a rider reads to solve a display problem
  the client can solve.
- **No favourite moves, and the proof is by call site.** `SaveStar` persists
  `formatFavoriteRouteKey(row.stopId, routeId)` off an untouched `dedupeRoutes` result;
  `dedupeRoutes`' key is `${operator}|${routeNo}|${bound}|${boardingPoleId(r.stopId, members)}` and
  `poleDistinctions` appears nowhere in it. **A unit is a display concept only.** Expressing it as a wider
  boarding-point mapping would collapse one line boarding at both poles into a single row and discard the
  sibling kerb's arrival — the exact defect WP5-9 fixed, protected by the `REQUIRED_ROWS` entry
  `eta#dedupeEtas:one-line-at-two-poles-keeps-a-reading-for-each`. That is the single most likely way to
  get this wrong.
- **A prose correction in `packages/data-normalize/src/dataset.ts`, because its own data contradicts it.**
  The joint-route signal's comment called an index-aligned KMB/CTB pair *"the same physical pole under each
  operator's id"*. Measured: the 1 520 pairs that loop produces are **p50 16.4 m apart, p90 49.2 m, p99
  110.7 m, max 354.4 m, 403 of them (26.5 %) over 30 m**. Index alignment means "the same stand on this
  route", not "one pole". It is used only to rescue an already-close, already-same-named pair, which is
  legitimate — but anyone who read the old sentence and built a merge on it would fuse berths 350 m apart.
  Corrected in place rather than deleted, with the distribution.
- **Consequences, including what we are accepting:**
  - **The honest cost is a doubling of how often the app says anything.** Places carrying a pole cue go
    **226 → 464** of 10 115 (2.2 % → 4.6 %); poles told nothing fall from every pole in 271 declined groups
    to **54**. Whether 4.6 % still counts as restraint is a judgement, and it is stated here rather than
    buried: the *strongest true* answer wins in every group, so nothing is said that the data cannot
    support, but there is now more of it on screen.
  - **`apps/web` cannot demonstrate this**, and the ADR does not claim "both renderers". There is no Place
    screen there — its one screen is Nearby, and a Nearby card prints no kerb heading by design
    (`stopCardView`), so a "these two are adjacent" note there would describe a distinction the card does
    not draw. ADR-075 defines drift on the *spec* rather than on the pixels, so the corpus is the proof.
    The design is already gate-shaped for the day a web Place view exists: the 10 m comparison and the unit
    partition are fields on a returned record, so `check-no-derivation.mjs`'s `threshold` and `selecting`
    rules have nothing to fire on.
  - **Open — 54 poles across 22 groups are still told nothing.** Each is alone in its unit inside a group
    whose unit octants still collide (Statue Square: four KMB poles across 41 m). They are ≥10 m from their
    siblings, so the map genuinely answers them — the heading is already a tap target that highlights a
    labelled dot. A caption saying so is *discoverability*, not disambiguation, and is deferred with that
    reason rather than improvised.
  - **Open — ADR-072's both-kerbs favourite is untouched.** A rider who stars one line at both kerbs still
    sees one Favourites row. It needs a per-row kerb label on a compact card, which `soonestPerLine` and
    `StopCardView` deliberately refuse. It stays open under its own row rather than being smuggled in here;
    WP5-12 was named as its owner and this ADR declines that half explicitly.
  - **Open, and adjacent — `splitStopCode` only matches ASCII parentheses**, so 24 names per Chinese locale
    ending in a full-width parenthetical are not split at all today. Pre-existing, one line away from
    `poleFlagCode`, and *not* widened here: doing so would shift what every heading prints in Chinese, which
    wants its own measurement.
  - **Test totals:** core 839 (+23), corpus 94 groups / 790 cases, 26 named boundary rows.

## ADR-081 — The frames carry `failed`, and a round whose failure set moved is news
- **Status:** **Decided and implemented 2026-08-03** (WP5-14). Implementation:
  `packages/contract/src/wire/live.ts` (`failed?` on `SnapshotFrame` and `DeltaFrame`),
  `packages/core/src/live.ts` (`sameFailures`, `unionFailures`, `LiveSession.failed`, the three reducer
  cases), `packages/core/src/datasource.ts` (`EtaListener` gains a trailing `failed?`),
  `packages/api-client/src/live/controller.ts` (`LiveEtaUpdate.failed`), `src/live/poll.ts` (`sentFailed`
  and the new news clause), `src/index.ts` (the identity guard), `apps/edge/src/eta-hub.ts`
  (`Session.failed`, `sessionChanged`, `sendRound`, and the carry-forward on `subscribe`),
  `apps/mobile/lib/useLiveNearby.ts`, `apps/mobile/lib/useLiveEtas.ts`,
  `apps/web/src/hooks/useLiveNearby.ts`. Pinned by **13 new corpus rows** in two groups, all **11
  cross-runtime rows re-declared with a `failed=[…]` column** (ADR-074's grammar), an anti-vacuous control
  on each of the two drivers, 3 new cases in `apps/mobile/test/live-nearby.test.tsx` and 1 in
  `apps/edge/test/eta-hub.test.ts`.
- **Context.** ADR-073 put per-pole failure on `/v1/etas/:id` and deliberately left it **off the frames**,
  with a reason that was true at the time: the shard applies `retainFailedPoles` itself, so a client
  learns from the retained readings plus a `retrying` status, and the field existed on the wire only so the
  poll emulator could apply the identical rule. ADR-077 then gave a card a marker fed by the HTTP
  payload's `failed`, recorded the cost in one sentence, and named the trigger: *"the fix is frames that
  carry `failed`, which is a wire change to make **when a screen renders per-kerb failure**, because that
  is when the extra precision has a reader."* WP5-7 made Nearby a live adopter and its card renders
  exactly that, so `StopCardView.incomplete` became **first-paint-only**: the marker cleared on the first
  live round and a card at a refusing place read as a quiet stop again. That is the reader arriving.
- **Decisions:**
  1. **A frame's `failed` is the complete current set, restated in full, and an absent field means
     empty.** It is the one field on a `delta` that is not a patch, and the asymmetry is forced rather
     than chosen: an optional field cannot distinguish *unchanged* from *none*, so one of the two has to be
     the meaning — and only *none* fails safe, which is the same direction ADR-077 decision 1 chose for the
     merge helpers' argument. Clearing loses information; keeping would invent it.
  2. **Therefore a round whose failure set moved is *news*, even when no reading did.** This is the
     producers' half of decision 1 and the part that makes it correct rather than merely cheap. Without it
     the delta branch stays silent for exactly the round an outage produces — a kerb stops answering,
     `retainFailedPoles` keeps its previous readings, so nothing changed and nothing is gone — and the card
     could not speak until some *other* bus happened to move. The recovery direction is worse: the marker
     would outlive the recovery by a whole cadence, which the row's acceptance rules out in as many words.
     `sameFailures` in the kernel is the predicate, and **both engines call it**, so a disagreement about
     what counts as a change would be a disagreement about how many frames one outage produces.
  3. **`sameFailures` compares `stopId`, `error.code` and `error.retryable`, and *not* `error.message`.**
     The message is prose that embeds whatever the upstream said, so a wording that varied between two
     rounds describing one outage would make every round news and undo decision 2 entirely. The three
     compared fields are the three a caller branches on: which kerb, what kind of failure, and whether to
     keep asking. Exactly `COMPARED_FIELDS`' argument for excluding `observedAt`, and exactly the same risk
     if it is got wrong in the other direction.
  4. **`unionFailures` is a kernel rule, not a `flatMap().sort()` written twice.** A round is N targets and
     each answers with its own list, so the frame needs the union — and if the two engines built it
     differently they would put different bytes on the wire for identical upstream behaviour, which is the
     one property ADR-074's corpus exists to assert. It **deduplicates by pole**, which is reachable rather
     than theoretical: a rider can watch a merged place *and* one of its own member kerbs at once (a Nearby
     card is keyed on the place, a favourite on the kerb — ADR-062) and the batch endpoint answers about
     both. First occurrence wins, and since the lists arrive in accepted-target order that is deterministic
     on both engines.
  5. **Pole failures only; a whole-target failure stays a `status` frame.** `EtaFailure.stopId` is a
     boarding point (ADR-073 decision 2) while a target may be a merged place, so putting a place id in
     this list would produce an entry that matches no reading and — through `memberStopIds` — no card
     either: safe by luck rather than by design. A target that could not be answered at all is already
     covered, and better: `retryable: true` retains its readings (so the card ages honestly) and
     `retryable: false` re-echoes a corrected snapshot, which is the accepted-set mechanism ADR-008 asks
     for.
  6. **A `status` frame leaves `failed` alone.** `state` describes the **connection** and `failed`
     describes the **upstream**; they are different facts. A `retrying` that cleared the per-kerb marker
     would be strictly less honest than the frame it arrived on, and a reconnect must not erase what we
     know about the kerbs.
  7. **`EtaListener` gains a trailing optional parameter, which is why this is not a change to the seam.**
     ADR-004 fixes `watch()` as `(targets, onUpdate) => Subscription`, and every listener already written
     stays assignable — a one-parameter function is a valid two-parameter one in TypeScript, in Swift with
     a default, and in Kotlin. `watch()`'s own comment previously argued that widening the signature was
     *not* the fix and that a caller needing more should hold a `createLiveEtaController`; that argument
     was about the **accepted target set**, which is a fact about the subscription and needs a product
     decision to render, and it still stands. A failure set is a fact about the data the listener is
     already being handed.
  8. **The identity guard at `EdgeClient.watch` now asks about failures too.** It skipped any update whose
     `etas` array was the same object — correct, because `applyLiveFrame`'s `status` case passes `etas`
     through by reference, so a status-only transition carried no information through a door that could
     only pass readings. The round that matters most is now exactly that shape (unchanged readings, moved
     failure set), so the guard would have swallowed it. It compares with `sameFailures`, so the door and
     the producers agree.
  9. **The shard stores the set per socket and carries it forward on a re-`subscribe`.** Per socket
     because each connection watches its own subset and hears only about its own kerbs; stored because "is
     this round news?" can only be answered against the previous *frame*. The carry-forward was **found on
     a real socket rather than reasoned about**: a `subscribe` is answered from stored *readings*, so
     sending `failed: []` alongside them paired six real readings with a claim that nothing was refusing,
     and a card that had been saying "we could not ask" went quiet for a cadence before saying it again.
     Filtered through `memberStopIds`, so a target the caller has just dropped takes its kerbs with it.
     `sessionOf` **tolerates the field's absence**, which is what lets a socket opened by the previous
     deploy keep working rather than being dropped by an attachment it does not carry.
- **Verified against live Hong Kong data, with the KMB upstream pointed at an unroutable host and then
  reverted** — the same technique ADR-077 used, one layer up:
  - The batch endpoint: three Citybus places kept all their readings and reported nothing, while the three
    KMB places came back with **zero readings and every refusing kerb named** (3, 4 and 5 of them).
  - On a real socket to the real `EtaHub`: `snapshot seq=1 etas=0` → `status live` →
    **`delta seq=2 changed=6 gone=0 failed=[3 kerbs]`** → three `retrying` → and on a re-`subscribe`,
    `snapshot seq=4 etas=6 failed=[3 kerbs]`. An earlier trace, before decision 9, showed the same
    subscribe answering with **no** `failed` field, which is the defect that line fixes.
  - The frame that did not exist before this row, observed: **`delta changed=0 gone=0 failed=[…]`** — a
    round that learned nothing about readings and everything about which kerbs had stopped answering.
    Before WP5-14 that round was completely silent.
- **Consequences, including what we are accepting:**
  - **ADR-074's corpus grammar gained a column, and that is the cross-runtime proof.** All 11 `settles`
    lines now end `failed=[…]`, and the **real Durable Object over a real WebSocket in workerd reproduces
    every one of them independently** — neither driver imports the other, and `layers.json` forbids it. Two
    rows show the recovery direction (`failed=[A]` → `failed=[]` within one round), which is the half of
    the acceptance a still-refusing row cannot demonstrate; an anti-vacuous control on **each** driver
    requires at least five rows to name a kerb and at least two to recover, because the two read one
    fixture and a row that went quiet would go quiet on both at once.
  - **`CONTRACT_VERSION` does not move.** An optional field added to two frame schemas is additive per
    ADR-052 §5. Measured: `asyncapi.json` stays at 49 component schemas (it already registered
    `EtaFailure` for `EtaReport`) and only the two frame payloads and the version differ; `openapi.json` is
    untouched at 8 paths / 38 schemas.
  - **An extra frame per outage transition, and no more than that.** A continuing outage is still silent —
    asserted by the corpus row `a-board-that-keeps-refusing-keeps-saying-so`, whose two failing rounds
    produce their `retrying` status frames and **no** second delta. The cost is one data frame when a kerb
    starts refusing and one when it stops.
  - **Open — a reconnect starts with no failure set.** A new WebSocket has no attachment, so its first
    snapshot carries none whatever the shard knows. The stored readings are equally invisible to that
    socket, so the two are consistent rather than contradictory, and the next round tells it everything
    within one cadence. Recorded rather than fixed: fixing it means the shard storing a failure set
    *outside* any socket's attachment, which is a different lifetime and a different decision.
  - **Open — `/v1/route/:id` still says nothing**, unchanged from ADR-073 and ADR-077. Its ETAs come from
    one bulk call, so the failure is all-or-nothing.
  - **Test totals:** core 853 (+14), edge 149 (+2), api-client 71, mobile 56 (+3), web 32. Corpus 96 groups
    / 803 cases.

## ADR-082 — The web shell before the web screens: a router over a declared destination set, and one PWA policy for two apps
- **Status:** **Decided and implemented 2026-08-03** (WP6-0, the first row of Wave 6 —
  [`proposals/04`](./proposals/04-platform-idiomatic-renderers.md)). Implementation: `apps/web/src/shell/`
  (`App.tsx`, `destinations.ts`, `TabBar.tsx`, `Placeholder.tsx`, `BackButton.tsx`,
  `ShellPreferences.tsx`, `layout.ts`), `apps/web/src/providers/` (`QueryProvider`, `LocaleProvider`),
  `apps/web/src/lib/` (`preferences`, `appearance`, `serviceWorker`), `apps/web/src/main.tsx`,
  `apps/web/index.html`, `apps/web/scripts/build-web.mjs`, `apps/web/public/` (generated), and — shared —
  `scripts/pwa/workbox.config.mjs` moved out of `apps/mobile/` plus `scripts/gen-icons.mjs` emitting into
  both web roots. **No kernel, contract, edge or dataset change.** Pinned by 41 new tests in
  `apps/web/test/{shell,shell-parity}.test.ts{x,}` and `test/pwa-policy.test.mjs`, each watched failing on
  an injected defect.
- **Context.** [ADR-075](#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)
  makes `apps/web` the web renderer and `apps/mobile` the reference implementation until WP6-8. It also
  names WP6-0's own risk: *"the `apps/web` shell buys nothing a rider can see, and it is the largest package
  before any screen moves. Porting a screen first and bolting the shell on after would make every screen's
  spec provisional."* What `apps/web` had after Wave 4 was one screen and no shell at all — no router, no
  persisted query cache, no locale override, no appearance store, no service worker, no manifest. Its own
  `Nearby` said so in a comment listing four things *"deliberately absent"*.
  **The two halves of the acceptance pull against each other**, and that tension is what most of this ADR
  is about: *"opens offline and switches locale, with **zero screens ported**"*. A locale override nothing
  can operate is a claim about plumbing rather than a thing that was run, and this repo's standard is that
  a claim is exactly as large as what has been measured.
- **Decisions:**
  1. **The destination set is declared as data, and a test binds it to expo-router's.** ADR-075's
     invariant/idiom table puts *the destination set and back semantics* on the **identity** side and the
     chrome that expresses them on the idiom side, so `src/shell/destinations.ts` holds the paths, the
     names' catalogue keys, and the tab order — and `test/shell-parity.test.ts` derives the same set from
     `apps/mobile/app/**`, the file-based routes expo-router actually serves, and fails on a disagreement.
     The paths are **byte-identical**, including `/favorites` with its American spelling (CLAUDE.md rule 5
     exempts route names, and a shared destination set means a bookmarked deep link resolves the same on
     either renderer — a URL is not a label).
     The exclusion list has one entry, `/workbench`, with a reason, and a second assertion requires every
     entry in it to still name a real route — so the list cannot quietly grow into "the sets match because
     we stopped comparing".
  2. **An unported destination renders a `Placeholder`, not a 404 and not a silent redirect.** The router
     serves all eight paths from day one. ADR-075's own state rule is that each of loading / empty / error /
     stale / offline must be distinguishable and non-blank; *"not built yet"* is a state of the same kind,
     and the alternative — a table listing only Nearby — makes every other destination read as **broken**
     rather than as not yet here. Each unported destination names the work package that ports it, and a
     test requires that: a route whose placeholder nobody has agreed to replace is a promise, not a plan.
     **No new catalogue string was needed** — `comingSoon` was already there in all three locales — and that
     was a constraint rather than luck. Scaffolding that adds keys to `@nextbus/i18n` leaves them behind in
     the generated Swift `.strings` and Kotlin `strings.xml` long after the scaffolding is gone.
  3. **The tabs are a layout route, so the pushed destinations have no tab bar and do have a way back.**
     expo-router expresses that as the `(tabs)` group with its own `_layout`; `<Route element={<TabsLayout/>}>`
     is the identical shape. Getting it right is what preserves [ADR-037](#adr-037--search-is-its-own-page-launched-from-a-glass-button-that-shares-the-tab-bars-row)'s
     decision that search is its own page rather than a fourth tab. It also forces the question a stack
     answers for free: **back is a history pop *except* on a cold arrival**, where `navigate(-1)` would leave
     the site — or, in an installed PWA's standalone window, do nothing at all and strand the rider with no
     browser chrome to escape by. `useNavigationType() === 'PUSH'` distinguishes the two; a cold arrival goes
     *up* to Nearby instead.
  4. **The shell carries the smallest possible locale + appearance control, and it is named as a deletion.**
     `ShellPreferences` is what makes *"switches locale"* something that was run. It deliberately is **not**
     the Settings screen — no sections, no glass, no `Text` primitive, no spec — and WP6-7 replaces it with
     the spec'd screen and deletes the file. It shares with the RN screen everything that is identity: the
     same catalogue keys, the same option order, `null` for *follow the device*, and language names as
     **endonyms**, because a reader whose UI is in the wrong language must still be able to find their own.
  5. **The web preferences store owns a different storage key from the RN one, and that is data safety
     rather than tidiness.** zustand's `persist` writes `partialize`'s output as the **whole** blob, so a
     store modelling two fields does not preserve the other four — it erases them. A shell store writing
     `nextbus.preferences` would therefore delete every favourite a rider had curated: not in dev, where
     Expo is on :8081 and Vite on :8082 and localStorage is per-origin, but at **WP6-8**, the moment
     `apps/web` is served from the domain the Expo PWA was installed from. Silently, with no error anywhere.
     So the shell writes `nextbus.shell.v1`, a test asserts the two keys differ *and* that the RN store
     really does still hold favourites under its own, and **WP6-4 hoists ADR-062's versioned favourite-key
     migration to a home both renderers call** when it ports the screen that needs it. Modelling favourites
     here instead would have meant a second implementation of that migration, which is the shape of every
     defect Wave 5 found in its own live code.
     The **query persister key is deliberately the same** in both apps, which is safe for the opposite
     reason: both write the library-owned `PersistedClient` shape over identical query keys, so a rider
     whose Expo PWA is replaced by this build keeps their cache instead of cold-starting.
  6. **The appearance is applied before the first render, which is what makes the storage choice
     load-bearing.** `apps/mobile` holds its splash screen until AsyncStorage has rehydrated; there is no
     splash screen here, so `main.tsx` calls `applyMode(currentMode())` *before* `createRoot().render`, and
     that is only honest because the preference is read through a **synchronous** `localStorage` wrapper
     rather than through the async `KeyValueStore` port. One try/catch serves all three sync consumers
     (`persist`, the query persister, and the port itself), because `localStorage` throws rather than
     returning null in Safari private browsing and in a partitioned context.
     The rule is shared: `resolveMode(appearance, systemIsDark)` from `@nextbus/ui`, the same call the RN
     `useTheme` makes. Only the mechanism differs — a class on `<html>` here, NativeWind's `vars()` there.
     `theme-color` is **created from the token** rather than declared in `index.html`, so the browser chrome
     tracks a light/dark switch instead of being pinned to one, and there is no fourth copy of the ink hex.
  7. **One Workbox policy, two consumers.** `apps/mobile/workbox.config.mjs` moved to `scripts/pwa/`, along
     with the five assertions over the emitted `sw.js`. The caching policy *is* [ADR-058](#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier) —
     live ETAs network-first and never cache-first (ADR-008), tiles cached only once seen and never
     precached (LandsD's terms), the shell precached or nothing else is reachable — and for the rest of
     Wave 6 two PWAs ship at once, so two copies of it could disagree about what a rider sees with no
     network. Sharing removes that drift and introduces a different risk in its place, which is why
     `test/pwa-policy.test.mjs` now asserts the policy's shape on every `pnpm test`: one edit here changes
     what both apps do offline, and every way it could break is silent. The manifest and its icons are
     likewise emitted from **one** generator run into both web roots, with `theme_color` read from the ink
     token instead of hand-copied (it had been a hand-maintained hex; WP6-0 would have made it a third copy).
  8. **`react-router` is pinned to 7.18.2, not the current 8.3.0, and the reason is worth recording.**
     Router 8 requires `react >= 19.2.7`; this repo pins React to **19.2.3** because that is what the Expo
     SDK aligns to (golden rule 6). So **the Expo SDK still constrains the plain-React app's dependency
     choices until WP6-8**, which is a small, concrete instance of the tax ADR-075 itemised — and the first
     one to arrive *after* the decision rather than before it. Router 7's `<Link>`/`<NavLink>` also do two
     jobs a hand-rolled router would have to redo: they render real `<a href>` elements (middle-click, open
     in new tab, a screen reader's link list) and set `aria-current="page"`, which is the DOM's way of
     saying `accessibilityState: { selected }`.
  9. **An unknown path redirects to Nearby rather than rendering a "not found" page.** A content decision,
     not a lazy one: every string comes from the catalogue, the catalogue has no such message, and inventing
     one in three locales to describe a URL a rider cannot have typed on purpose is the wrong trade.
     `replace` keeps the bad URL out of history so back does not bounce off it.
- **Why the alternatives lose:**
  - **Port a screen first, add the shell after.** ADR-075's named risk. Every screen's spec would be
    provisional: navigation, the locale, the appearance and offline all change what a screen must declare.
  - **Only route the one screen that exists.** Then a deep link or a tap to any other destination 404s or
    silently bounces, which reads as broken. It also leaves the destination set — an identity — undeclared,
    so nothing could compare it.
  - **A hand-rolled router.** Cheaper by one dependency, and it owes back/forward, real anchors, focus and
    nested layouts. The shell is also the part ADR-075 decision 7 expects to travel to a second app; the
    boring standard travels better than a bespoke one.
  - **Share the RN preferences store, or its storage key.** Data loss, per decision 5.
  - **Hoist the cache constants into `packages/core`.** Tempting, and wrong in the same way ADR-075 warns
    about in reverse: the kernel is hand-ported to Swift and Kotlin, and a TanStack storage key means
    nothing to either. *"A `ui-spec` that has grown a `stopId` is the early warning"* — a kernel that has
    grown a `PERSIST_KEY` is the same mistake pointed the other way. A test binds the two copies instead,
    and the duplication is **deleted** rather than resolved when `apps/mobile` retires.
  - **An inline `<script>` in `index.html` to kill the pre-bundle theme flash.** It would be a second
    declaration of both the storage key and the meaning of `auto`, in a file no gate reads. The residual —
    a light flash for as long as the module takes to parse, which the service worker reduces to a frame or
    two once installed — is accepted and written down instead.
- **Verified by running, not by reasoning:**
  - `pnpm --filter @nextbus/web build:web`, then the ADR-058 measurement: served `dist/`, loaded the app,
    then **killed the static server** and cold-loaded — the shell opened, the tab bar worked, `/settings`
    resolved through `navigateFallback`, and the language and appearance chosen before the kill were still
    in force. The full trace is in [`docs/11`](./11-status.md).
  - `pnpm --filter @nextbus/mobile build:web` still produces its service worker from the moved config, so
    the shared home did not break the renderer that ships today.
  - **Every new assertion was watched failing on an injected defect**, which is this repo's standing rule
    and the only reason the numbers below mean anything: a dropped destination, the shell store taking over
    the favourites blob, `staleTime` drifting from the RN provider's, live ETAs turned cache-first, and the
    locale override and the appearance each dropped from `partialize` in turn.
- **Consequences, including what we are accepting:**
  - **The first draft of the parity harness passed while asserting nothing, and the injection pass is what
    caught it** — twice over, which is the useful part. It resolved `apps/mobile` from `import.meta.url`,
    which under the jsdom environment is an `http://localhost/…` URL that `fileURLToPath` rejects, so the
    file failed at *import*: vitest reported a failed **file** rather than failed **tests**, the totals
    still looked plausible, and its own anti-vacuous control could not run. Then `remount()` did not reset
    the preference store — module state, so a value set by a click was still in memory — and both
    persistence assertions passed with `partialize` gutted. Neither would have been found by reading the
    tests, and neither was found by them passing.
  - 🟠 **`ShellPreferences` is scaffolding with an owner, which is the best available version of a bad
    thing.** It is real UI, held to no spec, and the mechanism keeping it honest is a name in `docs/11` and
    in WP6-7's row rather than a gate. If WP6-7 slips, an unspecified surface ships.
  - 🟠 **`apps/web` now has two ways to be wrong that it did not have as a one-screen proof:** a route table
    and a persisted store. Both are covered by tests that read `apps/mobile`, and **both of those tests die
    at WP6-8** — after which the destination set is declared in one place and compared against nothing until
    WP6-9 gives it a second reader. That is ADR-075's own "exactly one renderer measured against the spec"
    risk arriving early, in the shell rather than in a screen.
  - 🟡 **The placeholder is a *rendered* claim about work that has not happened.** Anyone reading the app
    at any point in Wave 6 sees seven "coming soon" pages, and that is the honest state — but it is also a
    thing a screenshot can misrepresent. `docs/11` says which single screen is real.
  - 🟡 **A light flash before the bundle parses**, per the alternatives above. Bounded, understood, not
    fixed.
  - 🟡 **`check-no-derivation` grew a policed directory in the same commit that created it**, which is the
    rule `check-no-raw-colours` states at length and the reason the shell's tab list is two arrays spread
    together rather than one array filtered: a `.filter()` over the destination table is exactly the
    derivation the gate exists to stop, and the declaration is the cheaper answer anyway.
  - ⚪ **`pnpm dev:dom` and `pnpm --filter @nextbus/web build:web` are the two commands that change**;
    `docs/10` carries both. `pnpm dev:web` still means the Expo PWA, which is still what WP0-5 ships.
  - **Test totals:** core 853, edge 149, api-client 71, mobile 56, **web 73 (+41)**. Corpus unchanged at 96
    groups / 803 cases — WP6-0 added no kernel rule, which is the point.

## ADR-083 — A component spec is data with five words, and the projection is what pins it
- **Status:** **Decided and implemented 2026-08-03** (WP6-1, the second row of Wave 6 —
  [`proposals/04`](./proposals/04-platform-idiomatic-renderers.md)). Implementation: a new
  **`packages/ui-spec`** (`src/schema.ts`, `src/project.ts`, `src/conform.ts`, and
  `scripts/check-no-domain-vocabulary.mjs`), **`packages/contract/src/ui/stop-row.ts`** with
  `scripts/emit-ui-specs.mts` + `scripts/check-ui-specs-current.mjs` emitting and gating
  `packages/contract/ui/stop-row.spec.json`, both renderers' suites rewritten to drive the walker
  (`apps/web/test/nearby-projection.test.tsx`, `apps/mobile/test/stoprow-projection.test.tsx`), a `uiSpec`
  layer in `layers.json`, and declared turbo `inputs` for the three tasks that read the new artefact.
  **Neither component changed** — `StopRow.tsx` and `StopCard.tsx` are untouched, which is the acceptance.
  Pinned by 21 new tests over the format itself and 47 conformance runs across the two renderers, each
  gate watched failing on an injected defect.
- **Context.** [ADR-075](#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)
  decision 3 says *"a component spec is data validated by a schema, never prose"*, names
  `packages/ui-spec` and `packages/contract/ui/` as its two homes, and leaves the format itself to be
  designed. `proposals/04` picks `StopRow` first for a reason worth restating: **two renderers already draw
  it and already agree**, so writing its spec validates the format for free — *"if the format cannot
  express a screen that demonstrably works, the format is wrong, and we learn that in an afternoon instead
  of at screen five."*
  What each renderer had instead was a hand-written `expectedText(view)` — 20 lines naming which fields a
  card shows and in what order — **deliberately duplicated**, with
  [ADR-069](#adr-069--a-second-renderer-and-what-it-caught-in-the-first) decision 7's reasoning that a
  shared helper lets one edit silently relax every renderer at once.
- **Decisions:**
  1. **The format's vocabulary is five words, and it was validated by retrofitting rather than by design.**
     `field` · `message` · `literal` · `each` · `oneOf`, plus `when` as a **path tested for truthiness**.
     Every one is there because `StopRow` could not be expressed without it: a repeated row list needs
     `each`, an ETA readout that is either number-plus-unit, a word, or a dash needs `oneOf`, and the arrow
     before a destination is a `literal` the renderer supplies. **There is deliberately no expression
     language.** `when` cannot say `> 0`, because the moment a spec needs a comparison the number belongs
     in the view model — which is exactly the argument `check-no-derivation` already makes to a renderer.
     One rule covers four conditionals (an empty caption, an absent code, a zero count, a false flag),
     because JavaScript's falsiness covers all four.
  2. **The check is exact equality, and that is what makes a shared spec safe.** ADR-075 accepts *"a shared
     spec is a shared bug"* as a cost. Equality turns most of that cost back into a gate: the spec is
     pinned **from both sides** — drop a slot and the renderers show text the projection does not; invent
     one and the projection expects text nobody draws. Either way both suites go red together. Measured,
     not argued: deleting the `caption` slot from the spec fails 19 of 24 cases on `apps/web` and 20 of 23
     on `apps/mobile`; adding a slot no renderer draws fails 21 and 22.
     **The residual is named rather than hidden:** a rule that *neither* renderer implements and the spec
     does not mention is invisible to all of this. Only an independent third renderer closes it (WP6-9).
  3. **The declaration is shared; the reading is not.** `project()` is one statement of what a component
     shows. Building a tree and reading text and tap targets back out of it stays per renderer — and the
     two are genuinely different: `apps/web` writes a real `<button>` where `react-native-web` renders a
     `Pressable` as `div[role="button"]`, so the suites' selectors differ. That is where a
     renderer-specific mistake lives, so ADR-069 decision 7 survives exactly where it applies. What retires
     is `expectedText`, which was a *specification* written twice.
  4. **Three universal checks, not per-component flags.** `slots` (the text is exactly the projection, in
     order); **`content-not-affordance`** (the same text with every handler withheld); `sibling-not-nested`
     (no interactive element inside another, with an anti-vacuous control that a spec declaring interaction
     targets must produce interactive elements at all). The second is ADR-069's own finding promoted to a
     law — *the visible text is a function of the view model alone* — and it is the first time that bug is
     mechanically caught rather than found by eye: re-injecting `remaining > 0 && onPress` into
     `StopRow.tsx` now fails 18 of 23 cases. Universal rules belong to the format; per-component facts
     belong to the spec.
  5. **Every state must declare what enforces it — `by`, `knownDefect`, or `unenforced` with a reason.**
     This is the anti-vacuous rule of the whole format. A spec full of `mustNot` sentences that nothing
     checks reads exactly like an enforced one, which is the failure this repo has now hit five times in
     other guises (ADR-070's cache key, the rules that fired on a stale `dist/`, the field-reference gate
     that was built and deleted, the native artefacts comparable only on the machine that made them, and
     WP6-0's own parity suite failing at *import* while its totals looked plausible). `by` is resolved
     against the slot list at emit time **and** on every conformance run, so a renamed slot cannot leave a
     true-looking claim behind.
  6. **`StopRow`'s `empty` state is a declared `knownDefect`, and the sentence was not softened to match
     the code.** `proposals/04`'s worked example declares *"a card with a name and nothing under it"* as a
     `mustNot`, citing `docs/11`'s open bug — and enforcing that would have failed both renderers on day
     one, against an acceptance that says both pass unmodified. The alternative to a `knownDefect` was
     rewriting the sentence into something true, which would have quietly deleted the target. Same trade
     Wave 2 made pinning four `knownDefect` corpus rows, for the reason ADR-075 restates: identical and
     visible beats different and hidden. Owner: **WP6-4**. Both suites additionally pin the *current*
     behaviour, so closing it is a deliberate change to two renderers rather than an accident in one.
  7. **The format knows nothing about buses, and two mechanisms hold that line.** `layers.json` gives the
     `uiSpec` layer `use: []`, so it cannot import the contract or the kernel — the structural half.
     `check-no-domain-vocabulary.mjs` scans identifiers and string literals in `src/` **and** `test/`, plus
     the emitted `.d.ts` (where an *inferred* type would carry a name the source never writes), for twelve
     domain words. ADR-075 decision 7's own early warning — *"a `ui-spec` that has grown a `stopId`"* — is
     now a build failure rather than a thing nobody sees. **Comments are exempt, and the selftest is what
     forced that:** scanning them made every ADR citation a violation, so a portable package could not
     explain why it exists. `check-no-derivation.mjs` made the same call for the same reason.
  8. **`packages/contract` depends on `ui-spec` type-only.** The specs are data; data needs the format's
     *type* to be checked against, never its runtime. Same shape and reason as `kernel` importing
     `contract` type-only (ADR-052 decision 2) — the published `ui/*.spec.json` must not carry a validator
     into anyone's bundle. `src/ui` is deliberately **not** re-exported from the contract's barrel, so the
     Worker's runtime graph is unchanged.
  9. **The artefact is emitted, committed and drift-gated three ways.** Every committed file must match its
     declaration, every declaration must have a file, and **every file must have a declaration** — the
     third is the direction people forget, and an orphan spec that no suite is measured against would pass
     for ever. The gate is stricter than `openapi.json`'s needs to be, because the failure is worse: a
     stale wire document eventually produces a decode error, while a stale component spec produces a
     **green** conformance run pinning a rule that has moved.
- **Why the alternatives lose:**
  - **Prose in `docs/09`.** Tried, in §6, and the imminence band it describes was written down four times
    with two different values. ADR-075 decision 3 already settled this; WP6-1 is where the alternative
    would have been re-adopted by accident, one `must` sentence at a time.
  - **Keep the duplicated `expectedText`.** It is a specification written twice, so the two renderers agree
    only until somebody edits one. The duplication also cannot be read by a Swift suite, which is the whole
    point of the exercise.
  - **An expression language for `when`.** Every conditional in the app is a presence test; a comparison in
    a spec is a rule leaking out of the kernel. Code in data is how a specification becomes a second
    implementation.
  - **Enforce the states mechanically now.** Three of `StopRow`'s five cannot be observed from one card at
    all — a skeleton belongs to the list screen, staleness is opacity rather than text, and offline is
    indistinguishable from stale without knowing whose network failed. Declaring them `unenforced` *with the
    reason and the owning work package* is honest; asserting them would have meant either weakening them to
    what a card can show or inventing a harness that cannot see what it claims to.
  - **Hoist the format into a shared repo now.** WP6-10, and the rule of two. The seam is named and free of
    domain vocabulary; extraction waits for a second consumer.
- **Verified by running, and the injection pass is the evidence:** the spec's `caption` slot deleted (both
  suites red), a slot added that nobody draws (both red), the caption line deleted from **only** `apps/web`'s
  component (web red, RN green — the ADR-069 deletion, now caught by a shared declaration), ADR-069's
  original `&& onPress` bug re-injected into `StopRow.tsx` (RN red, via `content-not-affordance`), the
  committed JSON hand-edited (drift gate red), and an orphan spec file added (gate red). Plus: touching
  `ui/stop-row.spec.json` turns `@nextbus/web:test` from a **cache hit into a cache miss**, so ADR-070's
  hole was closed before it could bite — `apps/{web,mobile}/turbo.json` and `packages/contract/turbo.json`
  declare the artefact as an input.
- **Consequences, including what we are accepting:**
  - **The vocabulary gate found a real leak in its own package on its first working run** — an error
    message in `conform.ts` naming what ADR-069's finding was about. Two drafts of the matcher were wrong
    before that, and both failures are worth recording because they are the same failure: a check that
    silently matches nothing. The first used `\bword(?![a-z])` with the `i` flag, and `/i` applies to the
    character class too, so the lookahead rejected every following letter and only bare words ever matched.
    The second *replaced* each token with its de-pluralised form, turning `routes` into `rout` and
    `onPress` into `pres`. It now adds candidates instead of substituting, and the selftest is what caught
    both.
  - 🟠 **A defect in `project()` or `conform()` now relaxes both renderers at once.** That is the shape
    ADR-069 decision 7 was written against, accepted here because the alternative is a specification
    written twice. The mitigations are that the walker has 21 tests of its own, that its fixtures are
    abstract (so the format cannot quietly acquire this app's assumptions), and that exact equality means
    most spec errors fail rather than pass. A *walker* error is the residual.
  - 🟠 **`ui/*.spec.json` is one more thing a native repo must vendor, and vendoring is still unsolved.**
    ADR-075 named this and WP6-1 makes it concrete. `packages/contract/README.md` §7 now says so where the
    reader meets it, and repeats that a `knownDefect` is a target rather than behaviour to copy. **WP6-9
    must not start before vendoring is answered** — unchanged, and now with more surface.
  - 🟡 **Two tests retired, and the totals went down.** The bespoke "+N more with nowhere to tap" case in
    each suite is now `content-not-affordance` running over *every* corpus case rather than one — strictly
    stronger, and it is why `web` reads 72 and `mobile` 55 rather than 73 and 56.
  - 🟡 **The spec's `a11y` block is declared and unasserted.** `role` and `name.fromSlot` are resolved
    against the slot list, so they cannot dangle, but nothing checks that the rendered tree agrees. The
    honest reason is that the two renderers express the same accessible role by different means and the
    third will again; WP6-2 is where a screen-level a11y assertion becomes worth building.
  - 🟡 **`docs/09` §5 and §6 still need their superseded banners.** ADR-075 deferred that *"until the spec
    format exists"*. It exists now, and one component's spec is not yet enough to supersede the prose ETA
    spec — `EtaBadge` is inside `StopRow`'s spec as three `oneOf` branches, not as a component of its own.
    Owner: WP6-2, which is the first screen-level spec and the first place the prose is genuinely replaced.
  - ⚪ **`packages/ui-spec` has no `turbo.json` and needs none** — its test reads only its own files. The
    three tasks that read the *artefact* declare it, which is the ADR-070 lesson applied prospectively for
    once rather than after a stale replay.
  - **Test totals:** core 853, edge 149, api-client 71, **ui-spec 21 (new)**, web 72, mobile 55 — 1 221.
    Corpus unchanged at 96 groups / 803 cases: WP6-1 added no kernel rule, which is the point.

## ADR-084 — A screen spec: a state that declares what it shows, and a slot that references another spec
- **Status:** **Decided and implemented 2026-08-03** (WP6-2, the third row of Wave 6). Implementation:
  `packages/ui-spec` gains a `ComponentNode` (`component`), an `enforcement.shows` variant,
  `projectState()`, `conformStates()`, a `StatefulHarness`, and `states` as a **record with five required
  keys** rather than a closed object of exactly five; `packages/contract/src/ui/nearby.ts` →
  `packages/contract/ui/nearby.spec.json` (9 states, 8 of them projected) plus a `UI_SPEC_REGISTRY`;
  `apps/web/test/nearby-states.test.tsx` and `apps/mobile/test/nearby-states.test.tsx` drive every state on
  both renderers; `apps/web/src/screens/Nearby.tsx` gains the two taps that make it the shipping web Nearby;
  and `docs/09` §5 and §6 finally get their superseded banners. 15 new tests over the format, 21 new
  conformance runs across the two screens.
- **Context.** `StopRow`'s spec (WP6-1, ADR-083) is a projection of one view model, and every one of its
  states is a field of that model. **A screen is not**, and that is the whole of this row: Nearby's states
  are branches over an async status — no fix yet, permission refused, a *remembered* position rather than a
  live one, the first fetch in flight, the fetch failed, nothing due — and no view model carries any of it.
  Three of `StopRow`'s five states were declared `unenforced` for exactly this reason and handed to WP6-2.
- **Decisions:**
  1. **A state may declare its own projection, and the driver is asked to enter it.**
     `enforcement.shows` is the fourth variant, and it is what turns five sentences into five assertions.
     The split of responsibility is the load-bearing part: **the driver owns getting there** — that is
     per-renderer hook wiring, and it is where a renderer-specific mistake lives — while **the spec owns
     what must be there.** `renderState(name)` returns the tree *and* the view it corresponds to, because a
     state like "the fetch failed" has content (the error's own message) that no view model holds either.
     Returning `null` is a **finding, not a skip**: a declared projection nothing can render is the same
     vacuous pass as a gate matching no files.
  2. **`slots` is what every state shows; `shows` is what a state adds.** Nine states repeating the
     screen's chrome would be nine chances to disagree about it. What fell out of that split is the row's
     best result: **only the title survives every branch — the subtitle does not**, because the difference
     between the ordinary content state and the `stale` one *is* the subtitle. ADR-008's honesty rule
     applies to the rider's **position** and not only to the times, and declaring the subtitle per state is
     what makes *"say so when the fix is remembered"* an assertion instead of a sentence. It is watched
     failing both ways: the spec claiming the live subtitle for `stale`, and the web screen dropping the
     remembered one.
  3. **A slot may reference another component's spec.** `{ component: 'StopRow' }` inside an `each` is how
     *"this screen is a list of these cards"* becomes a checked claim: a slot added to `StopRow` turns up in
     Nearby's expected text with no edit to Nearby's spec, and a screen that stopped drawing its cards goes
     red. Writing the card's slots out again would have been two declarations of one thing — the failure
     this format exists to prevent, reproduced inside it. Resolved through `UI_SPEC_REGISTRY`, which is
     **derived from `UI_SPECS`** rather than written out, so a spec cannot be emitted and yet be
     unreferenceable.
  4. **`states` is a record with five required keys, not an object of exactly five.** Nearby has nine: the
     canonical five plus `content` (a screen needs a name for "it worked"), `undetermined`, `denied` and
     `locationError`. A schema that forbade the extras would have pushed them back into prose, which is the
     one thing ADR-075 decision 3 rules out. The floor stays five.
  5. **The seams are mocked; the query is not.** Both suites replace the four seams a screen reads the world
     through (`useLocation`, `useLiveNearby`, `useClientPolicy`, the `DataSource`) and leave TanStack Query
     real, because `loading`, `failed` and `content` **are** its states and mocking `useQuery` would mean
     asserting against a mock of the thing under test. The fixtures come from the corpus —
     `stop-card.spec.json`'s `nearbyView` group supplies both the `NearbyStop[]` the source returns and the
     `StopCardView[]` the screen must draw, with `now` pinned to the case's own clock — so the two suites'
     goldens are the same bytes.
  6. **`apps/web`'s Nearby is the shipping web Nearby.** The two taps are wired, to paths **byte-identical**
     to the RN screen's (`/stop/:id`, `/route/:id?stop=:id`), so a deep link resolves the same on either
     renderer. Verified in a real browser against live Hong Kong data.
  7. **Pull-to-refresh is declared `idiom`, and the asymmetry is deliberate rather than an oversight.** The
     RN screen has a `RefreshControl`; the web screen has nothing. Since WP5-7 the arrivals arrive by
     subscription at the served cadence, so a manual refresh is *reassurance* rather than how a rider gets
     fresh data — and the platform with a natural gesture for it offers it. What is **not** idiom is
     recovery from `failed`, and neither renderer makes it a control: `refetchInterval` fires only on error
     (ADR-079), identically on both, which is why that state's `must` owes the rider an explanation rather
     than a button.
  8. **`docs/09` §5 and §6 are marked superseded, which ADR-075 deferred until the format existed.** §6 —
     titled "ETA display spec" since Wave 1, prose, and the section whose imminence band was written down
     four times with two different values — now points at `etaUrgency` for the rules and `stop-row.spec.json`
     for what a renderer must draw. §5 is *partly* superseded: motion is **idiom**, so its durations and
     curves are `apps/mobile`'s recipe rather than a cross-platform requirement, and what survives as
     identity is that reduced motion must not change the content. Three of §6's bullets are in neither
     place yet and now say so.
- **Why the alternatives lose:**
  - **Mock `useQuery` and assert the branches directly.** It would make the states deterministic and
    meaningless: the states *are* the query's states.
  - **Give the screens injectable props so a test can set their state.** That is changing the component to
    suit the specification, and ADR-075 decision 5's whole point is that the spec is extracted from the
    renderer as it is.
  - **Restate `StopRow`'s slots inside Nearby's spec.** Two declarations of one component. The registry
    costs one derived object.
  - **Leave the screen states as prose in the `must`/`mustNot` sentences.** That is what WP6-1 left behind
    for three of `StopRow`'s five, and it is only defensible when nothing *can* observe them. A screen can.
  - **Add pull-to-refresh to the web screen for parity.** Parity of *mechanism* is what ADR-075 traded away.
    The web has no natural gesture for it, and inventing a button would be a control the design never asked
    for to satisfy a symmetry that stopped being the goal.
- **Verified by running:** both suites green over all nine states, and **watched failing four ways** — the
  spec claiming the live subtitle for `stale` (both renderers red), the card list dropped from `content`
  (both red, which is composition being asserted), the web screen's remembered-position sentence removed
  (web red, RN green), and the RN screen's "no service" line removed (RN red). In a real browser against
  live Hong Kong data: six cards, a heading tap to `/stop/GMB%3A20001553`, back to `/` with the tab bar
  restored, a row tap to `/route/GMB:804:outbound:2010275?stop=GMB:20001553`, and **zero nested interactive
  elements** across the whole rendered list — the DOM half of `sibling-not-nested`, measured outside jsdom.
- **Consequences, including what we are accepting:**
  - **A test whose fixture was right and whose timing was wrong is the row's cautionary tale.** The first
    draft of both drivers flushed a fixed number of microtasks after mounting, and two states read their
    tree while the screen was still showing "locating" — so the suite reported a divergence at index 2 for
    `content` and `failed` rather than the state it had been asked about. A bounded poll for the transition,
    failing loudly with the text it actually found, is the difference between testing the state and testing
    the scheduler. It is the same class as WP6-0's `remount()` that did not reset the store: **a harness
    that looks at the wrong moment is indistinguishable from a renderer that is wrong.**
  - 🟠 **The RN suite needs six mocks, and two of them are platform modules rather than seams.**
    `expo-router` cannot load outside Metro and the safe-area context wants a provider irrelevant to what is
    under test; `useLocale` reaches `expo-localization` → `expo-modules-core` → `__DEV__`, a Metro global
    that does not exist in jsdom. Each is replaced with the smallest thing the screen uses, and the locale is
    *pinned* rather than defined-away because the corpus fixtures are `en` and a locale the suite did not
    control would compare an English projection against a Chinese render. The cost is real: the more of a
    screen's environment a suite replaces, the less of the real screen it measures.
  - 🟠 **The native `denied` variant is unobservable in both suites.** When the OS will not prompt again a
    native build offers *"open Settings"* where the web offers *"retry"*, and under `react-native-web` and
    the DOM alike `Platform.OS` is `web`. Declared as an invariant on the `retry` slot so the divergence is
    visible rather than discovered; the first suite that could assert it is WP6-9's.
  - 🟡 **`offline` is declared `unenforced` on the screen too, and honestly so.** It is textually identical
    to `stale`: offline *is* a remembered fix plus replayed readings, and which network failed is not
    something the screen says. What distinguishes it — the readings' age and dimming — is inside the card and
    is opacity rather than text. The cache-replay half is asserted in `apps/web/test/shell.test.tsx`.
  - 🟡 **Nearby's `a11y` block is still declared and unasserted**, unchanged from WP6-1: the two renderers
    reach the same accessible role by different means (`<button>` versus `div[role="button"]`), and asserting
    a role *per slot* needs a way to associate an element with a slot name that the format does not have.
    The one a11y property that *is* enforced is structural — no nested tap targets — and it is now measured
    in a browser as well as in jsdom.
  - 🟡 **Every ADR-069 finding is a declared invariant with a case, and both were already closed by WP6-1** —
    stated because WP6-2's row asks for it: the caption's collapsed double separator is
    `slots.caption.invariant` plus the `whitespace-pre-wrap` assertion in the DOM suite, and the hidden
    overflow count is the universal `content-not-affordance` check running over every corpus case.
  - ⚪ **`apps/web` no longer has a screen with nowhere to go.** Its Nearby taps reach two placeholders, which
    is the state WP6-0 designed for — and it means the `content-not-affordance` check's inert render is now
    the *only* place either renderer exercises a card with no handlers. That is worth knowing rather than
    fixing: it is exactly the configuration ADR-069's bug hid in.
  - **Test totals:** core 853, edge 149, api-client 71, ui-spec 30, web 83, mobile 65 — 1 251.
    Corpus unchanged at 96 groups / 803 cases: no kernel rule moved.

## ADR-085 — The Place screen's composition is a kernel function, and the words it joins are injected
- **Status:** **Decided and implemented 2026-08-03** (WP6-3a — the hoist half of WP6-3). Implementation:
  `placeDetailView` and its `PlaceDetailView` / `PlaceGroup` / `PlaceRouteRow` / `PlaceDetailLabels` types in
  `packages/core/src/stop-detail.ts`, **15 corpus cases** in `spec/stop-detail.spec.json` plus four property
  tests, and `apps/mobile/app/stop/[id].tsx` rewired to consume it — ~90 lines of derivation deleted from the
  screen, two local helpers deleted outright, and both leaf components (`RouteRowItem`, `StopMeta`) reduced
  to projections. `packages/core` is back at **100 % on all four axes**.
- **Context.** `proposals/04` puts Place detail third *"because it has the most domain rules in the app"*,
  and the screen was the proof: nine decisions lived in it as loose expressions, reachable only by rendering
  a React tree — the pole heading and its `·`, the per-kerb distances, whether the walk is a single time or a
  range, the summary line and *its* two separator widths, the grouping under boarding points, which poles are
  shown at all, each row's three-way readout, and whether the place is grouped. A second renderer could only
  have re-implemented them from the JSX, and a re-implementation looks right on the day it is written
  (ADR-068's argument, applied to the screen it was always going to matter most on).
- **Decisions:**
  1. **One composition function, not nine exports.** The four rules `stop-detail.ts` already held
     (`dedupeRoutes`, `operatorsOf`, `orderPoles`, `poleDistinctions`) decide *what* a rider sees;
     `placeDetailView` decides what they collapse to on screen. Splitting the composition into more exports
     would leave the *order* of the calls — which is itself a rule — in the renderer.
  2. **Words the kernel joins are injected, never imported.** `labels` is three strings and two functions.
     The kernel may not import `@nextbus/i18n` (`layers.json` gives it `use: []`), and it should not: ADR-054
     draws the line at *core owns the rule, the catalogue owns the word*. What is a rule is the joining —
     which is exactly what two renderers get subtly different, and the reason `stopCardCaption` exists.
  3. **`routeCount` is a function of `n`, not a noun.** Because the plural rule is the catalogue's — and
     because taking the noun is how the RN screen came to print **"1 routes"**, which this hoist reproduces
     faithfully rather than silently fixing (WP4-0's rule: a hoist changes no behaviour). The corpus pins the
     defect; the shape lets a later row fix it with an ICU plural key and no kernel change.
  4. **The three-way readout is in the type.** `PlaceRowReadout` is `eta | headway | none`, because the
     middle case is the one a renderer forgets: a line with no live arrival but a published headway is not a
     line with nothing to say. An optional `EtaReadout` would have made that invisible.
  5. **Rows appear in exactly one place — `groups` or `rows`, never both.** A renderer reading `groups`
     alone would draw nothing for most of Hong Kong, which is single-pole; one reading both would draw every
     row twice. Asserted as a property over every corpus case.
- **Verified, and three things the 100 % branch threshold and the property tests caught that review would
  not have:**
  - **An unreachable `?? []`.** `shown` was `orderPoles(...).filter(rows > 0)` and the render site then did
    `byPole.get(m.id) ?? []` — an arm the filter had already made impossible. The threshold refused to go to
    100 %, which is the threshold doing precisely the job it was set for. It is a `flatMap` carrying the rows
    now, so there is no dead branch to cover or to explain.
  - **A property test that was wrong about a real state.** "Every row is in exactly one place" was written
    with a per-case *"and there is at least one row"*, which went red on the corpus row for a place with no
    routes at all. A place with nothing due is a real state; what would have been vacuous is a corpus where
    *no* case had rows — so the at-least-one check moved to the suite, where it belongs.
  - **A corpus case that pinned nothing.** The served-policy case was recorded against a departed reading,
    whose urgency is `none` under any band — so it passed while never exercising the branch, and the driver
    silently dropping `policy` would not have been noticed either. It is a four-minute arrival now, `normal`
    under the shipped 180 s band and `soon` under a served 600 s one, and the driver forwards **every**
    optional argument a case can carry.
- **Consequences, including what we are accepting:**
  - 🟡 **"1 routes"** — a live English plural defect, now pinned by the corpus with `routeCount`'s doc naming
    it. Fixing it is an ICU key in `@nextbus/i18n`, three locales and a re-emit; it is not this row's.
  - 🟡 **An unreadable pole id yields a heading of `" · Southwest side"`** — a leading separator, because the
    operator label is empty and the side is appended. Faithful to the RN screen, unreachable by any id in a
    real build (every canonical id parses), pinned by a corpus case, and worth one line to fix in whichever
    row next touches the heading.
  - 🟠 **WP6-3 is not finished, and the split is deliberate.** This is the hoist; the **spec** and the
    **`apps/web` port** remain, as does the row's stated acceptance — extending `check-no-derivation` to
    `apps/mobile`'s Place detail. That extension is not a one-line change: the screen has genuine
    *presentational* arithmetic (`Math.min`/`Math.max` over viewport dimensions for the shrinking map, a
    `.filter` over a scroll-offset registry) that the gate's shape rules would flag, so it needs the
    per-site `ALLOWLIST` mechanism `check-view-transport-free` already uses — each entry naming the one rule
    it exempts, with a stale entry failing as loudly as a violation. Rushing a gate is the one thing worth
    less than not having it, so it is the next thing rather than a hurried part of this one.
  - ⚪ **The screen kept its geometry.** `poleDist` survives in the RN screen because `MiniMap` takes
    coordinates and a group header takes a measured walk — geometry, not content. Everything that composes a
    *string* left.
  - **Test totals:** core **857** (+4 tests, +15 corpus cases: 96 groups → 97, 803 cases → 818), edge 149,
    api-client 71, ui-spec 30, web 83, mobile 65 — 1 255.

## ADR-086 — Two readings that were honest and useless: a walk in hours, and poles at one coordinate
- **Status:** **Decided and implemented 2026-08-04.** Both found by opening the rewired Place screen at
  Tin Shui Wai Park — the browser pass WP6-3a recorded as owing. Implementation:
  `formatWalk`/`formatWalkRange` in `packages/core/src/geo.ts` (+7 corpus cases),
  `mergeCoincidentPins` in `packages/core/src/stop-detail.ts` (+8 corpus cases, +2 property tests) and
  `apps/mobile/components/MiniMap.tsx` consuming it. `packages/core` stays at **100 % on all four axes**.
- **Context.** Neither is a regression, and that is the point of recording them: a location fix outside
  Hong Kong put **"21.6km · 270 min walk"** under a place name, and the map drew **two dots at one screen
  point** with their labels invisibly stacked. Both were true, both were useless, and both had been true
  since the features shipped — the screen pass is simply the first time anyone stood in front of them.
- **Decisions:**
  1. **Past an hour, a walk is expressed in hours** — `4.5 hr walk`, one decimal with a bare `.0` dropped,
     and its own word per locale (`小時路程` / `小时路程`). An hour is the boundary because that is where the
     *unit* stops helping: "45 min walk" is a decision a rider can make, "270 min walk" is arithmetic they
     have to do.
  2. **Format the degenerate reading rather than cap it.** The alternative was "more than an hour away",
     and it loses on honesty: that is not what we measured, while a badly-scaled number merely reads as a
     bug in the app. Every such reading is degenerate by construction — nobody walks an hour to a bus stop
     — which is the argument for formatting them *well*, not for hiding them.
  3. **A range takes one unit for both ends, chosen by the larger.** A range that switched units mid-way
     ("45–1.5") is unreadable, and a rider comparing the ends of a range is comparing numbers.
  4. **Poles that publish the *same coordinate* are folded into one pin**, by exact equality rather than a
     distance or pixel threshold. Whether two poles are published at one point is a fact every renderer
     agrees on; "close enough at this zoom" is a different answer per viewport and per platform. Poles a
     metre or two apart keep their own dots — `MiniMap` already flips a label above its own dot for that.
     A separation of **zero** is the case nothing could help with.
  5. **A folded pin keeps every id, and is active when *any* of them is.** Otherwise a folded dot would go
     dim exactly when the rider scrolled to one of the kerbs it stands for — which is what made the label
     appear to *swap* rather than highlight. A tap scrolls to the first of them and does not guess:
     ambiguity is what "one spot, two published poles" means, and the list is where the rider reads which
     is which.
  6. **A folded pin whose poles disagree about the operator has none**, and takes the neutral colour. A
     KMB and a Citybus pole sharing a coordinate have no single brand colour, and picking the first pole's
     would state something the data does not — the same call `parseStopId` makes for a merged `P:` id.
  7. **The fold is the kernel's, not `MiniMap`'s.** Which pins collapse and how their codes join is a rule
     a second renderer's map must reach the same answer on, and `apps/web` has no map yet — so it lands in
     `packages/core` with a corpus rather than in the one component that needs it today.
- **The useful way to state what this exposes:** it is
  [ADR-071](#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)/[ADR-080](#adr-080--what-tells-two-boarding-points-apart-in-the-order-the-data-can-support-it)'s
  population seen from the map instead of from the list — and **the list can tell those kerbs apart while
  the map structurally cannot.** That asymmetry is the whole reason the compass-side / pole-name / "check
  the sign" tiers exist: no map at any usable zoom was ever going to separate poles at zero metres.
- **Verified, and one bug a corpus row caught before any renderer saw it.** The never-`"4–4"` rule compared
  **minutes** while printing **hours**, so 270 and 271 minutes — two different values — both rounded to
  `4.5` and produced `"4.5–4.5 hr walk"`. On the minutes path the two comparisons are identical, which is
  why it was invisible until there was a second unit; it compares the **printed figures** now. The row that
  caught it was written for exactly that shape.
  On the real payload for Tin Shui Wai Park: 3 members → **2 pins**, `001992` and `TN511 · TN510`, and
  21.6 km reads `4.5 hr walk` / `4.5 小時路程`.
- **Consequences:**
  - ⚪ **The map centroid is no longer weighted by duplicate publications** — one physical spot counts once,
    which is the better framing and a free consequence of folding before `fitZoom`.
  - 🟡 **Two live defects from WP6-3a stay open, now in `docs/07` with their fixes described**: the English
    summary can print **"1 routes"** (an ICU plural key away, no kernel change), and an unparseable pole id
    yields a heading with a leading `" · "` (unreachable by any real id, one line to fix). Both are pinned
    by corpus cases so neither can be fixed by accident and unnoticed.
  - **Test totals:** core **867** (+10; corpus 97 groups / 818 cases → **98 / 833**), edge 149,
    api-client 71, ui-spec 30, web 83, mobile 65 — 1 265.

## ADR-087 — The map's pins are content, and the dot's label is the heading's own code

- **Status:** **Decided and implemented 2026-08-04** as the first half of **WP6-3b**. Implementation:
  `PlaceDetailView.pins` + `placePins` in `packages/core/src/stop-detail.ts` (all 15 `placeDetailView`
  corpus cases gain the field, +2 property tests), `apps/mobile/components/MiniMap.tsx` reduced to
  drawing them, and ~20 lines of derivation gone from `apps/mobile/app/stop/[id].tsx`. A hoist, so
  **no behaviour changes**; `packages/core` stays at **100 % on all four axes**.
- **Context.** [ADR-086](#adr-086--two-readings-that-were-honest-and-useless-a-walk-in-hours-and-poles-at-one-coordinate)
  decision 7 put the *fold* in the kernel *"because a second renderer's map must reach the same answer on
  it"*, and then left the three decisions **around** the fold in the renderer: the Place screen built a
  `MapPoint[]` from its member poles — `poleFlagCode(m.name, locale) ?? pole?.rawId` for the dot's label,
  `parseStopId(m.id)?.operator` for its colour, `parseStopId(stop.id)?.operator` for the lone-stop pin —
  and `MiniMap` called `mergeCoincidentPins` on the result. So the rule was shared and its **inputs** were
  not, which is the shape WP4-0 exists to catch: `apps/web`'s map, days away, would have had to arrive at
  the same three answers independently, and a re-implementation looks right on the day it is written.
  The screen's own comment already said so — *"the same helper the heading uses, deliberately: change one
  and at Prince Edward the heading would read `KMB · MK356` while the dot read the raw id"* — a comment
  being the only thing holding two expressions together.
- **Decisions:**
  1. **`PlaceDetailView` carries `pins`**, one per physical spot, already folded, labelled and coloured.
     A map's *identity* is which spots exist, what each is called and which poles each stands for; how a
     pin is **drawn** — a dot, a teardrop, an `MKAnnotationView` — stays idiom. `MiniMap` now takes
     `pins` and `grouped` and decides neither.
  2. **A dot is labelled with the printed code its heading uses**, because it is the same `poleFlagCode`
     call — which borrows a flag-shaped code from *another locale* when this one has none (ADR-080), so
     it is exactly the kind of answer two renderers get subtly differently.
  3. **`grouped` is passed, never derived from `pins.length > 1`.** A place whose every pole shares one
     coordinate folds to a **single** pin and still needs its code chip, its smaller dot and its tap
     target — and "is this place grouped" is already a field of the view. A renderer computing it would be
     a second declaration of it, and a wrong one for exactly the population ADR-086 was written about.
  4. **Every member gets a pin, including one with no rows left**, and the asymmetry with the list is
     deliberate: the list is what a rider is choosing between, the map is a picture of where they are
     standing, and a kerb whose lines all folded away under `dedupeRoutes` is still a kerb. See the
     consequence below for the one live cost of that.
  5. **One code path through the fold, a lone stop included.** Written with its own `return [{ ids: … }]`
     arm it carried a conditional spread for the operator that **no payload can reach** — a place with one
     member always has a readable id — and the 100 % branch threshold refused it, exactly as it refused
     WP6-3a's `?? []`. Handing every case to `mergeCoincidentPins` leaves the "absent stays absent"
     branches in the one place whose corpus exercises both sides of them. **Twice now the threshold has
     found dead code in this file that review did not**, which is the argument for keeping it at 100 %.
- **The finding, and it came from writing the property down rather than from reading the code.** The
  assertion *"a pin is labelled with the code its heading prints"* went red on the first run, on the real
  Tin Shui Wai Park payload: the Citybus dot reads **`001992`** while its heading reads **`Citybus`**. The
  label falls back to the raw pole id and the heading has nothing to fall back to, so the two genuinely
  disagree — a rider matching the dot to the list has to do it by elimination. It has been true since
  ADR-042 shipped the labels. A hoist changes no behaviour (WP4-0's rule), so the property now asserts the
  disagreement **in both directions** — the raw id is on the dot and is *not* in the heading — and the row
  is in `docs/07` with its options. Three anti-vacuous counters, one per branch, because a single total
  would have let the middle branch never run, which is how this would have stayed invisible.
- **Consequences:**
  - 🟡 **A dot for a kerb with no rows scrolls nowhere.** Tapping it asks the list for a group that does
    not exist, and does so silently. Pre-existing, now visible in the corpus, in `docs/07`.
  - 🟡 **A dot labelled with a raw operator stop id names something no sign shows** — see the finding
    above. In `docs/07` with three options, none of them taken here.
  - ⚪ **`MiniMap`'s props no longer mention a coordinate.** It is handed the pins and the flag, which is
    what makes a DOM twin a rendering exercise rather than a second derivation.
  - **Test totals:** core **869** (+2), edge 149, api-client 71, ui-spec 30, web 83, mobile 65 — 1 267.
    Corpus unchanged at 98 groups / 833 cases: **a field was added to 15 existing cases, not a rule.**

## ADR-088 — Place detail's spec, its DOM port, and the gate that finally reads both renderers

- **Status:** **Decided and implemented 2026-08-05** — **WP6-3b**, which closes WP6-3. Implementation:
  `packages/contract/ui/place-detail.spec.json` (18 states, 13 projected) and `ui/place-row.spec.json`,
  `apps/web/src/screens/PlaceDetail.tsx` + `components/{MiniMap,PlaceRow}.tsx` +
  `adapters/{tileSource,links}.ts` + `hooks/useLiveEtas.ts`, two conformance drivers, and
  `scripts/check-no-derivation.mjs` — **moved to the repo root and extended to `apps/mobile`**, which is the
  row's stated acceptance and closes the asymmetry
  [ADR-069](#adr-069--two-renderers-one-kernel-and-the-four-bugs-only-the-second-one-could-find) recorded.
- **Context.** Place detail is the screen `proposals/04` picks third *"because it has the most domain rules
  in the app"*. WP6-3a hoisted them ([ADR-085](#adr-085--the-place-screens-composition-is-a-kernel-function-and-the-words-it-joins-are-injected))
  and WP6-3b is the half that holds a renderer to them. It is the first screen whose spec was written from a
  surface **nothing had ever rendered in a test** — `StopRow` and Nearby both had suites first — so the
  spec-writing itself was the measurement, and most of what follows is what it measured.
- **Decisions:**
  1. **A screen's states have a second axis: the shape of the data.** Nearby's nine states are branches over
     an async status (ADR-084). Place detail has those *and* branches over the payload — one kerb or several,
     and where several, which of ADR-080's three tiers tells two of them apart. Each tier exists only for a
     payload that has it, so each is a **state** driven from the corpus case it was written for. The states
     and the cases line up one to one, which is the evidence they are the data's rather than invented.
  2. **A leaf row gets its own spec**, referenced twice. Place detail draws its rows grouped and flat; writing
     the row's slots out twice inside the screen's spec would be two declarations of one thing — the failure
     this format exists to prevent, reproduced inside it. `place-row.spec.json` is referenced by both shapes
     through ADR-084's `component` word, so a slot added there appears in both with no edit here.
  3. **The reading order is shared; where the chrome sits in the *tree* is idiom.** `apps/mobile` floats a
     collapsing header over its scroll content and therefore renders it **last**, and renders its label
     **twice** (an expanded slot and a collapsed marquee it cross-fades between). `apps/web` puts its header
     in flow, first, which is better for a keyboard and a screen reader. Both put the name at the top of the
     screen. So each driver reads its own chrome first, de-duplicated where it has to be, and the cost is
     stated on the spec's `name` slot rather than discovered: **neither driver can see a name drawn in the
     wrong place on screen** — only one that is missing or wrong.
  4. **Three states are `knownDefect` and the sentences were kept, not softened** (ADR-083's rule). Writing
     the spec is the first time anything asked this screen what it shows, and it does **not** show: the
     "live times unavailable" marker (`PlaceDetailView.incomplete` has existed since ADR-077 and this screen
     has never read it, so a Nearby card says it and the place that card links to does not); that the
     distance and walk may be measured against a **remembered** fix (Nearby says so, this screen does not —
     ADR-008's position rule applied by one screen out of two); and the place's own printed code, which
     `displayName` splits off and the header drops, so a lone stop named *"NELSON STREET MONG KOK (MK514)"*
     shows no `MK514` anywhere. All three are in `docs/07` with their fixes described.
  5. **The gate moved to the repo root and needed a per-site `ALLOWLIST` to get there.** The RN screen has
     genuine presentational arithmetic — `Math.min`/`Math.max` over viewport dimensions for the map's crop
     and dock, a `.filter`/`.find` over a scroll-offset registry, `Math.floor` over tile coordinates — and
     the shape rules cannot tell it from a domain rule. The line every entry has to earn: **geometry is
     presentation, a list is a decision.** Each names the one rule it exempts, so a `.slice()` over rows in
     the same file is still caught, and the four allowlist selftest cases are ported from the defect an
     adversarial review found in `check-view-transport-free`'s matcher rather than waiting to repeat it.
  6. **`apps/mobile` is policed per surface, not wholesale.** Route detail, search, the workbench and
     favourites still hold rules WP4-0 has not hoisted, and so do `CollapsingHeader`, `StopHeader` and
     `GlassView`, which are chrome and motion. Each joins `POLICED` in the commit that hoists it. The
     asymmetry ADR-069 recorded is closed **for this screen** and stated as open for the others.
  7. **`operatorName` moved into `@nextbus/i18n`.** `placeDetailView` takes its words as injected `labels`
     (ADR-054), so the DOM screen needed the same operator names — and a second copy of the
     `OperatorId` → catalogue-key table is how the previous two copies came to disagree. It is `poleSideLabel`'s
     neighbour now, for `poleSideLabel`'s reason. Its third home; the first was a map inside the RN screen.
  8. **The `LinkOpener` port has its first implementation.** Declared since WP1-3 and implemented by nothing —
     `apps/mobile/lib/openExternal.ts` still carries the `Platform.OS` switch its own comment says exists
     *"only because the port did not exist yet"*. The DOM map needed both members, so this app implements
     the port rather than growing a second copy of the switch.
- **What the spec-writing measured, in the order it hurt.**
  - 🔴 **A failed fetch rendered *nothing at all*, on both renderers, for ever.** The branch read
    `isLoading ? skeleton : isError ? message : view ? content : null`, and `isLoading` is
    `isPending && isFetching` — so a query that is **pending and not fetching** matched no arm and the
    trailing `null` won. Measured against a 404 in a real browser: `main` had exactly one child, no skeleton
    and no error text, on `:8081` and `:8082` alike. ADR-079 had already fixed the permanently-dead screen
    for the `error` case, and this is the same failure arriving through a state that never *reaches* `error`,
    so that fix's `refetchInterval` predicate never fires either. **Fixed in both renderers by making the
    skeleton the fallback arm**, so no query state can render nothing, and pinned in both suites as an
    element assertion — because "no text" is what a correct `loading` state and a blank screen have in
    common. *Why* the retry pauses is not diagnosed and is in `docs/07` with the reproduction.
  - 🔴 **An injected defect passed.** Deleting the published-frequency text from the row component left
    **both** suites green: no fixture had a row with a `headway` readout, so the middle arm of the
    three-way readout was declared and never projected. Two more arms were in the same position — no corpus
    case produced a `due` reading at all. Three states and **one new corpus case**
    (`an-arrival-inside-the-minute-reads-due`) later, both injections go red, and the suites now carry a
    **coverage control** that asserts which arms the fixture set exercises. A `oneOf` case nothing drives is
    a specification looking at nothing, which is this repo's most-repeated failure.
  - 🟠 **`onLayout` does not fire on first mount** for the RN map on this screen: it renders with `w === 0`,
    drawing no tiles and no dots, until something else triggers a layout — measured by dispatching a
    `resize` by hand, which made the whole map appear. The DOM twin takes its first measurement in a layout
    effect and keeps a `ResizeObserver` for later changes, so it does not inherit it. In `docs/07`.
  - 🟠 **`ResizeObserver` does not exist in jsdom**, so the effect threw and React dropped the whole screen —
    reported as an empty tree for every state. Feature-detecting it is also simply correct: the first
    measurement is what a map needs to draw at all, and tracking a later resize is the enhancement.
  - 🟡 **The English GMB label is an acronym where the Chinese is a phrase** (`GMB` versus `專線小巴`), which
    the driver now pins as the **only** place the app's catalogue and the corpus's own fixture labels
    disagree — 14 of 15 cases identical. Confirmed on screen at Queen Mary Hospital.
- **Three harness traps, all of them the same shape as WP6-2's and worth the pattern.** *A harness that
  looks at the wrong moment — or cannot supply the input — is indistinguishable from a renderer that is
  wrong.* (a) Both drivers first mounted the screen **without its route**, so `useParams` gave no id, the
  query was disabled, and every state reported *"did not render at index 0"*. (b) The RN driver polled for a
  `[data-testid]` nothing renders, so it always returned before the query resolved. (c) Reanimated cannot
  load outside Metro and its **own shipped mock is broken in v4**, so the suite died at *import*, which
  vitest counts as a failed file rather than failed tests — WP6-0's parity suite hit that exact shape. The
  hand-written shim is the API the app measurably imports, and everything in it is motion, which ADR-075
  puts on the idiom side. `nativewind` needed mocking for a reason worth writing down: it re-exports
  `react-native-css-interop`, whose `main` is `"dist/index"` with **no extension**, so the resolver hands
  node a `.d.ts` and the run dies with `SyntaxError: Unexpected token 'typeof'` — no stack, no file, no
  package name. Found by bisecting the screen's imports one at a time.
- **Watched failing, eight ways.** The "check the sign" slot deleted from the **spec** (both suites red) ·
  the same line deleted from **only** `apps/web` (web red, **RN green** — the ADR-069 deletion, now caught by
  a shared declaration) · the licence credit removed from the web map (6 states red) · the published
  frequency dropped from the row (red **only after** the fixtures covered it) · the "Due" word replaced
  (same) · the kerb's own name dropped from the RN screen (red) · the committed JSON hand-edited (the drift
  gate) · a `.slice()` and a `.filter()` injected into the RN Place screen (the extended gate, which is the
  first time it has ever read that file).
- **Verified in a browser on live Hong Kong data**, on `apps/web`: Tin Shui Wai Park draws its folded
  `TN511 · TN510` pin and `001992`, 14 tiles, the credit, both kerb headings with their walks, all three
  readout kinds, **28 interactive elements and 0 nested** — the DOM half of `sibling-not-nested` measured
  outside jsdom — and a row tap resolving to
  `/route/KMB%3A264X%3Aoutbound%3A1?stop=KMB%3AAFB9321F7CD2C2E4`, the raw boarding pole in `?stop=` as
  ADR-062 requires. Rumsey Street shows two kerbs both reading *"Another stop a few steps away — check the
  sign"* and Queen Mary Hospital shows a kerb named by its own name: ADR-080's tiers 3 and 2, on a second
  renderer, for the first time. Screenshot: `.context/wave6-screenshots/6-web-place-detail-shipping.jpg`.
- **Consequences:**
  - ⚪ **`apps/web` has two ported screens**, and `/stop/:id` has left the placeholder table. Six
    destinations still name the work package that ports them.
  - 🟡 **The map's own text is `unenforced` in both suites** and says so: neither harness lays anything out,
    so the pin labels are in neither tree. What *is* enforced is one layer down — `mergeCoincidentPins`'s
    corpus and ADR-087's property that a pin's label is the code its heading prints.
  - 🟡 **`ui/*.spec.json` grew from two files to four**, which enlarges the unsolved corpus-vendoring
    surface `proposals/04` flags. WP6-9 still must not start before that is answered.
  - **Test totals:** core **869**, edge 149, api-client 71, ui-spec 30, web **105** (+22), mobile **86**
    (+21) — **1 310**. Corpus 98 groups / **834** cases (+1). `packages/core` stays at 100 % on all four axes.

## ADR-089 — A favourite is a rider's own data, so its migration is a shared rule rather than a store's private business

- **Status:** **Decided and implemented 2026-08-05** as the first half of **WP6-4**. Implementation:
  `packages/core/src/favourites.ts` (`FAVOURITE_KEY_VERSION`, `migrateFavouriteKeys`,
  `favouritePoleIds`, `favouritesView`) with a new corpus — `spec/favourites.spec.json`, **3 groups /
  17 cases, one of them `knownDefect`** — the RN store and screen consuming it, and
  `apps/web/src/lib/preferences.ts` rebuilt as the full five-field store on the **same storage key**.
  A hoist, so no behaviour changes; `packages/core` stays at **100 % on all four axes**.
- **Context.** Two things had to move before `apps/web` could draw a Favourites screen at all, and they
  are the same thing seen from either end. The screen's composition lived in
  `apps/mobile/app/(tabs)/favorites.tsx` — grouping resolved poles by place in save order, intersecting
  each place's rows with the saved keys *at the pole*, assembling the readings — reachable only by
  rendering a React tree. And the **migration** lived in that app's zustand store, reachable only by
  loading it. ADR-082 decision 5 named this row as inheriting the second: WP6-0 deliberately wrote a
  *different* storage key, because zustand's `persist` writes `partialize`'s output as the **whole
  blob**, so a two-field store on `nextbus.preferences` would have erased every favourite a rider had
  — silently, at WP6-8, on first launch.
- **Decisions:**
  1. **The version number is shared, and that is the load-bearing part.** Once two stores write one
     blob, the hazard is not that they disagree about a display: it is that they stamp **different
     versions** on it. A store writing a *lower* version re-runs a completed migration; one writing a
     *higher* version makes the next step skip data it has never seen. Neither fails loudly, and the
     data at stake cannot be re-derived from anywhere — so `FAVOURITE_KEY_VERSION` is one declaration
     in the kernel and both stores read it.
  2. **The rule moves; the store shape stays.** `migrateFavouriteKeys` is corpus-pinned in
     `packages/core`; each app keeps its own `migratePreferences` adapter, because
     `PersistedPreferences` names `Appearance` and `Locale` and the kernel may not import either
     (ADR-051). That is ADR-069 decision 7 exactly: *the rule is shared and the wiring is not.* What
     would be dangerous is a second implementation of the rebasing, and there is not one.
  3. **The fix for the shared key is to model *more*, not to share less.** `apps/web` now holds all
     five fields and writes `nextbus.preferences`. `recentRoutes` and `recentStops` have no consumer
     there until WP6-5 — they are held in state and written back unchanged, which is exactly what makes
     sharing safe. **A field a store *reads* and a field it *preserves* are different jobs**, and only
     the first is optional.
  4. **The guard changed shape rather than going away.** `shell-parity.test.ts` asserted the two keys
     *differed*; it now asserts they are the **same**, that the two `partialize` field sets are equal
     *by reading both sources*, that both stamp the shared version, and that neither re-implements the
     rebasing. The field-set check is the stronger guard: a field added to the RN store and forgotten in
     the web one is the only failure mode of a shared key, and it is the one that costs a rider
     something they curated by hand. Watched failing by dropping the recents from `partialize`.
  5. **Which poles to fetch is its own export.** The screen needs that list *before* it has any data,
     so it cannot be derived from the cards — hence `favouritePoleIds` beside `favouritesView`. It
     also decides two things a renderer should not: a key the id grammar cannot read is **skipped
     rather than guessed at** (the migration keeps it on disk in case a later grammar can), and two
     saved poles of one place are **one** query, because `getStop` promotes a member id to its place.
  6. **A card is per *place*, never per saved pole.** Favourites key on the member pole precisely so a
     clustering change cannot orphan them (ADR-062), and that is the wrong unit to draw: a rider who
     saved two lines at two kerbs of one interchange saved two things at one place, and two cards for
     it would read as two places.
  7. **`migrateFavouriteKeys` returns its input by *reference* when it has nothing to do.** The RN
     store's existing test asserts a future-version blob is passed through untouched with `toBe`, and
     keeping that identity is what makes "untouched" mean untouched rather than "equal for now" — an
     equal-but-new object is the shape a future step could quietly start rewriting fields through.
- **The `knownDefect` row, and why it is recorded rather than fixed here.** A saved route with **no live
  reading** contributes nothing, so the card is a name with nothing under it — a peak-only service at
  23:00, which is most of a rider's list overnight. The consequence that matters is diagnostic: **it
  cannot be told from a favourite key that no longer resolves**, which is why WP5-11's favourites proof
  had to rest on a route with a live arrival. It is now a corpus row with its `expect` recorded as it
  stands and its `why` saying what that becomes when fixed — a row whose readout is the published
  frequency, else a dash, the three-way readout `PlaceRouteRow` already has. Fixing it is a change to
  what a card is built **from**, which is WP6-4b's job and the reason this commit is a hoist.
- **Verified in a browser, on the owner's own twelve favourites.** The rewired RN tab draws three cards
  — two distinct `Belair Garden` places, Northeast- and Southwest-bound, which is ADR-042's
  direction-aware clustering visible on screen — with all three readout kinds and a **"+3 more routes"**
  count that is correct because the cap is `stopCardView`'s alone. And the *shared key* was measured
  rather than reasoned about: handed a **v0** blob written the way the RN app writes one, the web store
  ran the shared migration (one place-keyed favourite became **two** pole-keyed ones), stamped the blob
  at version 1, and **preserved both recents lists it does not read**.
  Screenshot: `.context/wave6-screenshots/7-rn-favourites-after-the-hoist.jpg`.
- **Consequences:**
  - ⚪ **A favourite starred in either app is visible in the other** once they share an origin. In dev
    they do not — localStorage is per-origin *including the port* — so this is a WP6-8 property, and it
    is why it was verified by seeding the blob rather than by clicking a star on one app and looking at
    the other.
  - 🟡 **The `nextbus.shell.v1` blob is not migrated.** It held an appearance and a language override,
    for one work package, and re-picking both is two taps — where a migration for scaffolding WP6-7
    deletes is a step every future reader has to understand. Favourites were never in it.
  - 🟡 **WP6-4b still owns the two bugs the row is measured on**: the empty card above, and WP5-12's
    one-row-for-two-kerbs residual, which needs a per-row kerb label the compact card does not have.
  - **Test totals:** core **889** (+20), edge 149, api-client 71, ui-spec 30, web **108** (+3),
    mobile 86 — **1 333**. Corpus **14** files / **101** groups / **851** cases (+1 module, +17 cases).

## ADR-090 — A `mustNot` a component cannot satisfy is a statement about its producer

- **Status:** **Decided and implemented 2026-08-05** — **WP6-4b**, which closes WP6-4. Implementation:
  `EtaLabelParts` gains a `headway` and a `none` arm; `favouritesView` builds its own rows rather than
  delegating them; `packages/contract/ui/favourites.spec.json` (8 states, 6 projected);
  `apps/web/src/screens/Favourites.tsx`; two conformance drivers; and both `EtaBadge`s drawing the
  timetable arm. **`stop-row.spec.json` now carries zero `knownDefect`s.**
- **Context.** WP6-4's row is measured on two bugs being *"closed by declared states, not by a patch"*:
  a favourite whose route has no current arrival rendered an **empty card**, and a rider who starred one
  line at **both kerbs** of a place saw one row. Both had been declared for a wave and neither could be
  enforced, and the reason turned out to be the same one twice — which is this ADR's title.
- **Decisions:**
  1. **`StopRow`'s `empty` state was never the card's to satisfy.** The sentence — *"the static timetable
     band, or an explicit 'no service' line"*, `mustNot: "a card with a name and nothing under it"* — has
     been in the spec since WP6-1 as a `knownDefect` owned by this row. The card could not satisfy it
     because **the row was never built**: `favouritesView` filtered `detail.routes` to those carrying an
     `eta`, so a peak-only service contributed nothing. The fix is a change to what a card is built
     **from**, and the state's enforcement is now `by: 'etaHeadway'` — a real slot.
  2. **`EtaLabelParts` gains two display-only arms**, `headway` and `none`. `etaLabelParts` cannot return
     either and never will: it is handed an arrival, and every existing arm is a statement about one. They
     exist because a **saved** route is a row whether or not a bus is due, and they are the same
     three-way choice `PlaceRouteRow.readout` has carried since WP6-3a. Widening the union rather than
     restructuring `StopCardRow` keeps Nearby's corpus goldens untouched — those rows all come from
     readings, so the new arms are unreachable there by construction.
  3. **Favourites' rows are not `stopCardView`'s rows**, and that is why `favouritesView` now assembles
     its own card. `soonestPerLine`'s collapse-to-one-row-per-line is right for a card *summarising a
     place* and wrong for a list the rider curated — it hid the other kerb's bus entirely. The cap and the
     "+N more" count are computed over the **saved** rows, and the order is the readout's rank then the
     arrival: a live reading, then a timetable, then a dash, because a rider opens this screen to find the
     next bus.
  4. **The kerb label was tried and declined on a measurement.** A per-row code naming the two kerbs is
     what ADR-072 refused and WP5-12 left open. Built, then measured: across five Hong Kong
     neighbourhoods **not one** line published at two kerbs of a place had *distinct* printed codes on
     them — and it cannot, because a place's poles are clustered by sharing a name and the code is part of
     the name (at Tin Shui Wai Park both TN510 poles print `TN510`, which is ADR-071's own example). A
     label repeated on both rows claims a distinction it does not make, so the field was removed rather
     than shipped always-absent-or-always-equal. **What a rider gets is both buses instead of one**, and
     Place detail — which has room for ADR-080's compass-side / pole-name / "check the sign" ladder — is
     one tap away.
  5. **A third instance of the same hole, found by asking the states.** The screen guarded only on
     `isLoading`, so once **every** query had failed it rendered its heading and an empty list — a rider
     could not tell "still fetching" from "we could not reach any of them", and a list they had curated
     looked empty. Same shape as WP6-3b's blank Place screen, reached through a different door. Both
     renderers now have a `failed` arm, and the spec declares it.
  6. **The drivers assert their own fixtures' shape**, and that was measured rather than assumed. Both
     compute their expectation by calling `favouritesView`, so a broken kernel moves the render and the
     expectation *together*: re-introducing the reading-only filter and the per-line collapse turned the
     **corpus** suite red by 4 and 2 tests and left both conformance suites **passing**. That division is
     correct (ADR-084: the corpus enforces the rule, the spec enforces that a renderer draws it) and it is
     also a gap a reader would not expect, so each driver now asserts that its `quietRoute` fixture
     produces a row and its `bothKerbs` fixture produces two rows of one line. Re-injected: both suites
     red.
- **The best failure of the pass, and it is a compliment to the format.** Deleting the `headway` arm from
  `stop-row.spec.json` left both conformance suites green — and failed at **emit**, with
  `StopRow: state 'empty' claims to be enforced by slot 'etaHeadway', which does not exist`. That is
  ADR-083's *"every state must declare what enforces it"* paying off in a way its own ADR did not predict:
  the `by` link makes the slot **undeletable**, and the failure names the state, the slot and the reason
  rather than reporting a text divergence somewhere downstream.
- **Verified in a browser on live Hong Kong data.** On `apps/web`, a seeded list showing both fixes at
  once: `269D → Lek Yuen  10 min` **and** `269D → Lek Yuen  every 12 min` — two rows for one line saved at
  two kerbs, the second carrying the published timetable — plus `969C → Kornhill Plaza  —`, a saved route
  with no reading that is now a row instead of an absence. Ordered live-then-timetable-then-dash. And the
  RN tab is unchanged on the owner's own twelve favourites.
  Screenshots: `.context/wave6-screenshots/8-web-favourites-both-bugs-closed.jpg`,
  `7-rn-favourites-after-the-hoist.jpg`.
- **Consequences:**
  - ⚪ **`apps/web` has three ported screens** and five destinations still naming the work package that
    ports them.
  - ⚪ **`stop-row.spec.json` carries no `knownDefect`s**, which is the first spec in the repo to reach
    that state — and it got there by fixing a producer, not by softening a sentence.
  - 🟡 **A rider still cannot tell which of two kerbs a Favourites row belongs to.** Declared in the
    `bothKerbs` state with the measurement, and it is one tap from an answer. The three `knownDefect`s on
    `place-detail.spec.json` are untouched by this row.
  - 🟡 **`favouritesView`'s `now` is the screen's `Date.now()`**, with no seam — correct, because the
    screen still fetches on `refetchInterval` and re-renders every cadence, but it means both drivers pin
    the clock with `vi.spyOn(Date, 'now')`. Without it every corpus reading renders `—` and the suite
    reports a divergence for the wrong reason, which is the third variant of *a harness that looks at the
    wrong moment* this wave has met.
  - **Test totals:** core **892** (+3), edge 149, api-client 71, ui-spec 30, web **119** (+11),
    mobile **97** (+11) — **1 358**. Corpus 14 files / 101 groups / **852** cases.

## ADR-091 — The keypad and the result list are one filtered set, and a chip set is the index's answer

- **Status:** **Decided and implemented 2026-08-05** as the first half of **WP6-5**. Implementation:
  `searchView` in `packages/core/src/search.ts` (+12 corpus cases in the existing `search.spec.json`,
  +5 property tests) and `apps/mobile/app/search.tsx` consuming it — six `useMemo`s and two local
  components gone. A hoist, so **no behaviour changes**; `packages/core` stays at **100 % on all four
  axes**.
- **Context.** `proposals/04` puts Search fourth and calls it *"the keypad, chips and recents are pure
  interaction over a spec'd index; never walked in a browser"*. The second half was the more accurate:
  twelve corpus groups already pin what *matches*, and the screen was deciding everything about what a
  rider sees — seven decisions, all of them reachable only by rendering a React tree.
- **Decisions:**
  1. **The keypad and the result list are computed from ONE filtered set.** This is the invariant that
     makes a dimmed key honest: a rider presses a live key expecting a result, so a keypad computed over
     a wider set than the search offers keys that lead nowhere, and a narrower one hides a reachable
     route. It was already true by construction in the screen and it was true *by coincidence of two
     `useMemo`s reading the same variable*; it is now one expression, with a property test asserting that
     every key the keypad offers begins some findable number.
  2. **Which operator chips exist is the *index's* answer** (ADR-037's promise, now a rule): a fifth
     operator lights up the day its adapter lands, and — the half that matters more — a chip is never
     offered for an operator the index cannot produce a result for. Sorted, so the row does not reorder
     itself as the dataset is rebuilt.
  3. **A stops list offers no category chips.** A stop has no route number, so a category cannot narrow
     it; a dimmed-but-present night-bus chip over a stop list offers a filter that does nothing, which is
     worse than not offering it.
  4. **Three list states, not two.** "Nothing matched" and "nothing searched" are different sentences with
     different copy, and the screen decided between them by re-testing `query === ''` beside a length
     check. `source: 'results' | 'recents' | 'none'` is one answer, and it is the same shape as every
     other state bug this wave has found: *a screen with less to show than expected must say which less.*
  5. **A recent is a *reference*, resolved against the index.** The dataset is rebuilt daily, a route can
     leave it, and clustering can mint a new `P:` id for a place (ADR-042) — so a saved id may name
     nothing today. It is dropped silently, which is right: the rider's next search simply will not offer
     it, where a row that renders the id and hopes is a tap into nothing.
  6. **A chip key is matched, never taken apart.** `searchView` mints `operator:KMB` / `category:night`
     and the screen compares whole strings against the same two builders. The screen used to
     `split(':')` its own key and cast the halves to two different unions, which read exactly like
     ad-hoc id parsing and was flagged by the gate that bans it; a key that is never split cannot be
     split wrongly.
  7. **`FilterChip.label` widens from `LocalizedString` to `string`**, and that is the ADR-054 line rather
     than a weakening. The kernel decides which chips exist and the caller injects the words, so the brand
     cannot survive the round trip — the kernel may not import `@nextbus/i18n`. It is laundered at the
     injection boundary, in one place, exactly as `PlaceGroup.heading` is. The brand still does its work
     where it can: an English literal cannot reach a chip without passing through `t()` first.
  8. **No `useMemo`.** `searchView` is pure and this screen re-renders on every keystroke regardless, so
     memoizing would add a dependency array that has to stay correct for no measured gain. The six it
     replaced each had one.
- **Walked in a browser for the first time — the pass `docs/11` has owed since ADR-037** — and the
  invariant in decision 1 turned out to be *visible*. With the query `2` and the **Night** chip on, the
  screen says **"No matches"** and **every key on the keypad is dimmed**, letter row included: no night
  route begins with a `2`, so the keypad offers nothing and the list has nothing, and the two agree
  without either knowing about the other. On the resting screen the `0` key alone is dimmed (no route
  number starts with a zero), the letter row reads `A B C E H N P R S T W X`, the chips read
  `Citybus GMB KMB · Night Airport Express`, and two saved recents resolve — including a GMB minibus
  route, which is decision 2 working end to end.
  Screenshots: `.context/wave6-screenshots/9-rn-search-first-browser-pass.jpg`,
  `10-rn-search-keypad-and-list-agree.jpg`.
- **Consequences:**
  - ⚪ **`RecentRoutes` and `RecentStops` collapsed into one `RecentsHeader`.** They were the same twelve
    lines twice and what differed was the rows, which the view now produces in one shape per mode.
  - 🟡 **The GMB chip reads `GMB` in English and `專線小巴` in Chinese**, which is the `docs/07` row WP6-4
    surfaced, visible again here on the widest surface it appears on.
  - 🟡 **WP6-5b still owns the spec, the `apps/web` port and the interaction states** — a keypad that
    collapses on scroll, a text field that focuses, a segment that switches mode. Those are the
    interaction-heavy half `proposals/04` picked this screen for.
  - **Test totals:** core **898** (+6), edge 149, api-client 71, ui-spec 30, web 119, mobile 97 —
    **1 364**. Corpus 14 files / **102** groups / **864** cases (+1 group, +12 cases).

## ADR-092 — A spec cannot hold an interaction, but it can hold what a rider infers from one

- **Status:** **Decided and implemented 2026-08-05** — **WP6-5b**, which closes WP6-5. Implementation:
  `packages/contract/ui/search.spec.json` (10 states, 8 projected), `apps/web/src/screens/Search.tsx` with
  `components/{RouteKeypad,FilterChips}.tsx` and `hooks/useSearchIndex.ts`, two conformance drivers, and
  two more kernel rules (`toggleSearchChip`, `validNextLetters`) plus `SearchKeypad` on the view.
- **Context.** `proposals/04` picked Search fourth for *"interaction-heavy specs"* — the open question being
  whether a spec can carry interaction at all.
- **Decisions:**
  1. **It mostly cannot, and should not try.** A keypad that collapses on scroll, a field that autofocuses,
     a segment that slides: gesture and motion, which ADR-075 puts on the idiom side. The spec says so by
     **enumeration** — six `idiom` entries — rather than by silence, which is the difference between a
     decision and an omission.
  2. **What it can hold is what a rider *infers* from the interaction: a key drawn as live means some route
     number continues that way.** One rule, and the states drive it — `filteredToNothing` being the extreme
     where the honest answer is ten keys and none of them pressable.
  3. **The keypad became purely presentational.** `SearchKeypad` carries the ten digits in keyboard order,
     each with `enabled`, and only the letters that continue the prefix. Both components held their own
     `DIGIT_ROWS` — the same two rows of five, twice — so a renderer adopting a phone's 1-2-3 grid would
     have been a silent divergence in muscle memory. Splitting ten into rows is the one thing left, and it
     is layout.
  4. **A chip key is minted and read in one place.** `toggleSearchChip` takes the key `searchView` produced,
     so no renderer knows the format and neither holds a table of operators to match against. An
     unrecognised key returns the filter unchanged rather than throwing: a stale tap is not a corruption,
     and crashing would lose the rider's whole selection.
  5. **`noMatches` is reachable only in stops mode**, and that is a fact about the keypad rather than about
     the state: **a smart keypad cannot type a query that matches nothing** — the key that would take you
     there is inert by construction. Discovered by writing the driver, which pressed `9` five times and got
     a one-character query.
  6. **The query field is the one genuine platform split**, and it is declared rather than hidden:
     `apps/mobile` draws the typed number in a `<Text>` because its keypad *is* the input, while `apps/web`
     uses a real `<input>` and accepts the hardware keyboard as well, making the pad an accelerator. So
     neither the value nor the placeholder is a shared projection, and the RN driver drops the field's
     **subtree** — structurally, by position, not by value.
  7. **The drivers press controls rather than setting state.** `mode`, `query` and `filter` are the screen's
     own state, so the only honest way into a state is the way a rider gets there. A driver that reached in
     would be asserting that the screen renders a view it was handed, which nothing doubted.
- **Five harness traps, and the fifth was in the injection script itself.** Filtering the tree by *value* to
  drop the field deleted the keypad's `2` key when the query was `2`, and reported a divergence twelve nodes
  later. The RN driver's positional skip ate the **error message** in `failed`, because there is no field in
  that state — the only one of these that hid a state's entire content rather than its timing. The index
  hook memoizes for the session, which is right for the app and leaked a previous state's index into
  `loading`, so the drivers import a fresh module graph per test. And then: **two of the five watched-failing
  injections came back green because they never applied** — a string the formatter had reshaped, and an
  assertion that tripped on the word appearing in `interactions` rather than on the slot surviving. *An
  injection that did not inject is indistinguishable from a gate that does not fire.* Re-run with the edit
  asserted, both go red — 3 states each.
- **And the injection that applied taught something real.** Folding the arrow back into `{origin} →` as one
  string left both suites green, because **React emits an expression and an adjacent literal as separate DOM
  text nodes**: the arrow's node identity comes from React, not from the markup, so splitting it into its own
  `<span>` was cosmetic. The original failure was purely the spec declaring the arrow *before* the origin.
  Recorded rather than dressed up as a fix — what the projection genuinely pins here is the **order**, and
  markup-level node boundaries are not observable to it at all.
- **Consequences:**
  - ⚪ **`apps/web` has four ported screens**, and four destinations still name the work package porting them.
  - ⚪ **`toggleSearchChip` and `validNextLetters` join the kernel**, plus `bumpRecent` and `RECENTS_MAX`
     from the same row — the recents rule two stores now share.
  - 🟡 **`stale` and `offline` are `unenforced`, and the reason is a rule rather than a gap**: a stale search
     index renders *identically* to a fresh one, by design, because a route number that existed yesterday
     almost certainly exists today. ADR-008's staleness rule is about readings, which decay in minutes.
  - ⚪ **The stop field is a `<label>`, not a `<div>` with an `onClick`** — decided by CI rather than by me,
     and worth keeping because it is the right answer rather than merely the lint-clean one. The RN screen
     wraps its input in a `Pressable` so that tapping the icon or the padding focuses the field; the DOM
     equivalent of that is not a click handler on a static element (a mouse-only affordance with no role and
     no keyboard path) but a **label**, which focuses its control natively. `noStaticElementInteractions`
     named it precisely. It reached CI because the local lint result quoted in the previous commit was
     measured *before* the last edit to that file — the same class as WP6-5b's injections that came back
     green: **a check whose result you are quoting from memory is not a check you ran.** The habit that
     follows is to run the gate chain *after* committing, not before, which is also what makes rule 7's
     per-commit range check meaningful.
  - **Test totals:** core **918**, edge 149, api-client 71, ui-spec 30, web **131** (+12), mobile **109**
    (+12) — **1 408**. Corpus 14 files / **105** groups / **878** cases.

## ADR-093 — Which node a bus is at is content; where that node is on screen is geometry

- **Status:** **Decided and implemented 2026-08-05** as the first half of **WP6-6**. Implementation:
  `routeDetailView` in `packages/core/src/route-detail.ts` (+20 corpus cases and 6 property/coverage tests
  in the existing `route-detail.spec.json`), `apps/mobile/app/route/[id].tsx` consuming it, and three leaf
  components reduced to projections — `RouteMeta`, `RouteHeader` and `EtaTimes`. Two new
  catalogue keys (`busApproaching`, `busAtStop`). A hoist, so **no behaviour changes** bar the one named
  below; `packages/core` stays at **100 % on all four axes**.
- **Context.** `proposals/04` puts Route detail fifth and sizes it **L**: *"the schematic, the bus tokens,
  the collapsing header, the auto-scroll"*. It also calls Place detail *"the most domain rules in the app"* —
  and Place detail had nine. **This screen had sixteen**, spread across a 598-line `.tsx` and two components,
  every one of them reachable only by rendering a React tree.
- **Decisions:**
  1. **A bus's position is a stop index, never a pixel.** `RailBus` is
     `{ kind: 'node', index } | { kind: 'segment', from, to }`, and that is the line the title states: the
     kernel says *"between stops 7 and 8"* and each renderer turns that into a y. It is what lets one
     declaration serve a 52 px RN rail whose rows report their own `onLayout` heights and a DOM list that
     measures itself differently — neither can disagree about the **bus**, and both are free to disagree
     about the pixels. The RN screen previously computed `atNode`, the midpoint and the y together in the
     render body, so the *rule* and the *arithmetic* were one expression.
  2. **The origin exception belongs with the position, not with the suppression.** Stop 0 has no segment
     leading into it, so a bus heading there has nowhere to be but on the node — the screen spelled this
     `m.atStop || m.toIndex === 0`. `visibleBusMarkers` already decides *whether* an origin bus is drawn
     (`ORIGIN_BUS_DEPARTS_WITHIN_SEC`); `railBus` decides only where the survivor goes. Two rules, one
     composition, one corpus case each — and a third case for the pair together, because a port that applied
     one and not the other looks right in a screenshot.
  3. **A bus token needs a name, and that is the finding of this row.** A component spec's vocabulary is
     **text** (ADR-083), so the conformance walker cannot see a disc with a glyph in it at all. The tempting
     answer is to declare the tokens `unenforced`; the honest one is that a graphic carrying information a
     rider acts on needs an accessible name, which ADR-075's own table puts on the **identity** side
     (*"every element's role and its label content"*). `BusToken` had none — no `accessibilityLabel`,
     `pointerEvents: 'none'`, and the screen's signature element silently invisible to a screen reader. So
     `RailBus.label` is composed by the kernel from injected words, and the same edit makes the tokens
     projectable *and* closes an accessibility hole nobody had reported. **The spec format found a defect by
     being unable to look at something.**
  4. **Two label keys, not one with a branch.** `busApproaching` and `busAtStop` are different facts: a bus
     at a stop is one a rider standing there can board. Neither says a distance or a fraction of a segment —
     the token sits at a midpoint because that is the only position the data supports (ADR-030, no polylines
     upstream), so *"halfway to X"* would assert precision the pixel does not have (ADR-008).
  5. **The header's two label strings are the kernel's.** `RouteHeader` composed
     `${origin} → ${destination}` at rest and `→ ${destination}` collapsed, each with its own `circular ?`
     branch — four plausible variants of two strings for a second renderer to arrive at. `label` and
     `collapsedLabel` are fields now, and the arrow is one constant so the collapsed form is provably the
     resting one with its origin removed.
  6. **`reverseId`'s presence *is* `canReverse`.** The screen passed `canReverse={!!reverse}` to the header
     and read `reverse.id` in a separate closure, so the control's existence and the id it navigates to were
     two facts that could get out of step. One optional field: a renderer with nothing to flip to draws
     nothing.
  7. **`flipped` is an argument, not something to infer.** The anchor is dropped on a flip because the
     reverse serves the opposite kerbs — and deriving "flipped" from "did the arrived-from id match a row"
     would keep an anchor on a route whose reverse happens to name the same pole, which is a real shape at a
     terminus. Two different facts, so two inputs.
  8. **`hereIndex` and each row's `here` are one answer.** A renderer needs the index because the *second
     beat* of ADR-043's reveal scrolls to it, and it needs the flag because the row is emphasised — but
     "which row to scroll to" and "which row is highlighted" are the same question, and a port that computed
     them separately would scroll to one row and highlight another. A property test asserts they agree on
     every case.
  9. **Staleness is the board's, not the arrival's.** One `dataTimestamp` per stop, so every slot on a row
     dims together; a per-slot answer would make the third time look fresher than the first. `EtaTimes` gained
     the dimming it never had on this screen and **lost its clock and its policy entirely** — it had been the
     *fourth* place the imminence band was written down, and it now has no threshold to be wrong about.
  10. **The static-facts strip is content.** Which pills exist, in what order, the fare's fallback from a
      sectional span to the origin's full fare, and the holiday fare as a **note on the fare pill rather than
      a fifth pill** were all inside `RouteMeta.tsx`. What stays there is the icon table — *"which concept
      each glyph denotes"* is identity and *"the set"* is idiom, so a per-renderer `RouteFactKey → glyph` map
      is the correct residue.
  11. **The tapped stop's name is the row's own.** The screen computed the action sheet's title as
      `titleCaseName(splitStopCode(s.stop.name[locale]).label)` — which is `displayName`'s definition
      inlined, **eleven lines from the call that passed the other spelling to the row**. Neither was wrong;
      that is the problem, because the day one grows a rule the other does not is the day the sheet and the
      row disagree about a stop's name. `RouteFactSheets`' `FactStop` is structural over `RouteStopRowView`
      for the same reason — it was a *third* list built with the same expression.
  12. **`distanceM` is compared with a tolerance, and the corpus says so.** It is a sum of haversines, and
      `geo.spec.json` already states the rule for that class of value — *"trigonometry does not agree to the
      last bit across languages"*. This is the first place in the repo where such a value sits **inside** an
      object compared for exact equality, so the driver lifts it out and compares it within 1 m rather than
      rounding it in the view: rounding would be a second, invisible display rule competing with
      `formatDistance`, which rounds to the nearest 10 m under ADR-008.
- **The one behaviour change, named rather than smuggled.** The action sheet's subtitle used to read
  `titleCaseName(route.destination[locale])` — upstream's LED-sign abbreviation — and now reads the header's
  own `destination`, which prefers the last stop's fuller name. So the sheet says *"1A → Star Ferry, Harbour
  City"* where it used to say *"1A → Star Ferry"*. WP4-0's rule is that a hoist changes no behaviour; the
  alternative here was to keep a **third** answer to "where does this route go" in a file that already had
  two, and one consistent sentence is worth the diff. Visible in the screenshot below.
- **Verified in a browser on live Hong Kong data** (`.context/wave6-screenshots/11-rn-route-detail-after-the-hoist.jpg`,
  `12-rn-route-action-sheet-one-stop-name.jpg`): KMB 1A opened from Kwun Tong (Yue Man Square), 34 rows with
  their codes and sectional fares, the four fact pills, **seven bus tokens each carrying its own accessible
  name** — *"Bus at Sau Mau Ping (Central)"*, *"Bus approaching Kwun Tong BBI - Millennium City"* — the
  anchored row highlighted and scrolled to as ADR-043's second beat, the action sheet titled with the row's
  own name, and a direction flip that swaps the header, the facts strip (`06:00 – 00:50`, `$8.2 → $5.1`) and
  the whole list with its stagger.
- **Consequences:**
  - 🔴 **A Citybus or GMB route shows no times anywhere and does not say why**, and it is now a
    `knownDefect` corpus row rather than an unrecorded fact. `/v1/route/:id` fetches live arrivals for KMB and
    LWB only — Citybus publishes no bulk route-eta endpoint (ADR-021) and GMB is not wired — so every row
    carries `eta: null` for ever, rendering exactly what *"no bus is due right now"* renders. ADR-077 solved
    this shape for `/v1/nearby` and `/v1/stop` by putting `failed` on the wire, and `apps/edge/src/stop-route.ts`
    says in a comment that route detail's equivalent *"should come from here"* — it was WP5-13's and did not
    land. Owner and reproduction in `docs/07`.
  - 🟠 **The four fact *sheets* are not part of this row.** `RouteFactSheets.tsx` is 397 lines and holds three
    more corpus-worthy compositions — the fare-stage timeline with its concession estimates, the per-day-type
    frequency bands, and the day-name list — so it is its own hoist (**WP6-6c** in `proposals/04`) rather than
    something to smuggle into a screen commit. The strip that *opens* them is hoisted here; the sheets
    themselves still derive, which is why `apps/mobile/components/RouteFactSheets.tsx` does **not** join
    `check-no-derivation`'s `POLICED` list.
  - ⚪ **`buses` is walked over the rows, not over the markers**, which puts the tokens in route order and —
    the reason it is written that way — leaves no dead branch. Mapping the markers needs a
    `rows[m.toIndex] === undefined` guard for a name to label the token with, and that arm is unreachable by
    construction. The 100 % branch threshold refused it, exactly as it refused WP6-3a's `?? []`.
  - ⚪ **Seven injected defects, all watched failing** — the origin exception dropped, the collapsed label's
    arrow removed, a flip keeping its anchor, a saved route starring every row, the holiday fare promoted to
    its own pill, per-arrival staleness, and the served arrival cap ignored. Each turned the corpus red by 1
    or 2 tests with the control green either side, and **each injection asserted that it applied** — the
    WP6-5b lesson, where two of five came back green because they never touched the file.
  - 🟡 **A `getBoundingClientRect` read during a 650 ms entry tween is a reading of the animation, not of the
    layout.** The first browser check reported all seven bus tokens stacked at one y and looked like a real
    defect; they were in flight from the origin, as designed. Worth writing down because the next person
    measuring an animated overlay will make the same call.
  - ⚪ **A `git checkout <file>` inside an injection loop destroyed an hour of uncommitted work.** The loop
    reverted to `HEAD`, which predated the hoist. Restore from a copy, never from the index, while the work is
    unstaged — and the same note already exists one hazard over, for `git stash --keep-index`.
  - **Test totals:** core **924** (+6), edge 149, api-client 71, ui-spec 30, web 131, mobile 109 — **1 414**.
    Corpus 14 files / **106** groups / **900** cases / 4 `knownDefect`.

## ADR-094 — Motion is idiom; what the motion is about is not

- **Status:** **Decided and implemented 2026-08-05** as the second half of **WP6-6**, which closes it.
  Implementation: `packages/contract/ui/route-detail.spec.json` (**19 states, 17 projected**),
  `apps/web/src/screens/RouteDetail.tsx` + `components/RouteStopRow.tsx` + `components/RailBusToken.tsx`,
  conformance drivers on **both** renderers (`test/route-detail-states.test.tsx` × 2, 23 tests each), and
  `check-no-derivation` extended to `apps/mobile/app/route/` and three of its leaf components.
- **Context.** `proposals/04` picks Route detail fifth and calls it *"the motion test — the first screen where
  'motion is idiom' is a real claim rather than a slogan"*. WP6-5b had already settled that a spec should not
  try to hold an **interaction** (ADR-092); motion is the same question one step further in, and *"motion is
  idiom"* on its own is too coarse to act on — it would put the bus tokens entirely outside the specification,
  and the bus tokens are the screen.
- **Decisions:**
  1. **Motion is idiom; what the motion is about is not.** A token slides in from the origin, tweens to a new
     position when a round arrives, and bobs on the spot between rounds. Every one of those is curve, duration
     and physics. What is **identity** is *which node it is at* — `{kind:'node', index}` or
     `{kind:'segment', from, to}` (ADR-093) — and that is projected, through the token's name, in eight
     states. `apps/web` animates only the position change and does not bob at all, which is a *choice*: the
     acceptance asked for the web curve to be chosen rather than inherited, and "a page a rider is reading
     should hold still" is the reason.
  2. **The collapsing header is idiom in its behaviour and identity in its content.** It states the route
     number and both ends of the journey at whatever size its platform gives it. The two **composed** journey
     strings (`label`, `collapsedLabel`) are corpus-pinned and deliberately *not* projected, because they are
     chrome at a particular size: `apps/mobile` cross-fades between them, and `apps/web` has one size and puts
     the resting one in `document.title`. Declaring them as slots would fail whichever renderer's chrome did
     not draw both. *The spec holds what both must show; a suite holds what only one can see* — the same line
     ADR-092 drew for the keypad's `enabled`.
  3. **The auto-scroll is idiom in the strongest sense the wave has produced.** `apps/web` sets
     `scroll-margin-top` and calls `scrollIntoView`, so the browser honours the rider's reduced-motion setting
     and this screen owns no offset at all; `apps/mobile` measures every row and computes one behind a reveal
     gate — which `docs/07` records as **not landing on web**. Two renderers, one declared state (`anchored`),
     and what that state pins is that the anchor changes **nothing about what is shown**.
  4. **The direction toggle navigates on the web and swaps state on the phone**, and both are right. A URL
     that names a direction is one a rider can share, so `ROUTE_PATH` is where the DOM toggle points; the RN
     screen holds the flip locally so Back exits the screen rather than the flip. The consequence for the
     suites is worth stating because it is the clearest case yet of *the driver owns getting there*: the RN
     driver reaches `flipped` by **pressing the toggle**, and the DOM driver by opening the route with no
     `?stop=`. Different journeys, identical state, one projection.
  5. **A row with nothing on its right is allowed here and forbidden on a card**, and the spec says why.
     `StopRow`'s `empty` has banned *"a card with a name and nothing under it"* since WP6-1 because a compact
     card is one place among many and a blank readout cannot be told from a broken favourite key. A row on a
     schematic is one stop among a route's own, under a numbered node, in a list read in order — absence there
     says *"no bus reported for this stop"*, which is a fact rather than an ambiguity. **The same shape is not
     the same claim in a different container**, which is the first time this wave has had to draw that
     distinction rather than generalise a `mustNot`.
- **What writing the spec found, and it is three things rather than one.**
  - 🔴 **The RN row composed `"22 min"` as a single animated string.** The kernel hands over `value` and `unit`
    as two fields precisely so they can be styled apart — the figure tabular and urgency-coloured, the unit
    small and muted — and the DOM row does that. The RN odometer animated the pair as one string, so it slid a
    `min` that cannot change *and* diverged from its twin. Two nodes now, the figure animated and the unit
    static. **Found by the projection, not by looking**: the suite reported `rendered "22 min" where the spec
    declares "22"`.
  - 🔴 **A bus token that waits for a measurement draws nothing when the measurement never arrives.** The RN
    overlay skipped any token whose target row had not reported its offset — correct in the moment, and a
    silent empty rail whenever `onLayout` does not fire, which is a live react-native-web bug this repo
    already carries for `MiniMap` (`docs/07`). The conformance suite could not reach a *single* bus state
    until it changed. An unmeasured token now sits at the top of the rail and slides down, which is the
    entrance animation anyway.
  - 🟠 **A loop's `collapsedLabel` *is* its `destination`.** The RN driver drops the collapsed marquee because
    at rest it is in the tree and invisible on screen — and dropping it *by value* deleted the destination too
    on a circular route, where there is no arrow and no origin to shorten away. It is dropped as a **node**
    now: the first child, in visual order, whose whole text is that label.
- **Verified in a browser on live Hong Kong data** (`.context/wave6-screenshots/13-web-route-detail-shipping.jpg`):
  KMB 1A on `apps/web` — the `1A` chip, `Sau Mau Ping (Central)` over `↓ Star Ferry, Harbour City`, the four
  fact pills, 34 rows with codes, sectional fares and figure-plus-unit readouts, `Due` in green and `1 min` in
  amber, **six named bus tokens**, **36 interactive elements and 0 nested**, a reverse link resolving to
  `/route/KMB%3A1A%3Ainbound%3A1`, and a tab title reading the whole journey.
- **Consequences:**
  - ⚪ **`apps/web` has five ported screens** and three destinations still name the work package porting them.
    `/route/:id` was the **last id-parameterised placeholder**, so `test/shell.test.tsx`'s "shows the id it was
    asked for" assertion died with it — replaced by the rule it was protecting: a destination with no
    `titleKey` must have a ported screen, because the placeholder has no words for it.
  - ⚪ **`check-no-derivation` polices `app/route/` and three leaf components.** The allowlist gained three
    entries and every one earns the line *geometry is presentation, a list is a decision*: rail arithmetic, the
    odometer's character-level `slice`s, and a `slice()` with no arguments that is a **copy** rather than a cap.
    `RouteFactSheets.tsx` is deliberately still absent — see below.
  - 🟠 **The four fact sheets are WP6-6c and are not in this row.** `RouteFactSheets.tsx` holds three more
    corpus-worthy compositions (the fare-stage timeline with its concession estimates, the per-day-type
    frequency bands, the day-name list), so the DOM screen draws the strip as **static pills**. The spec
    declares that honestly rather than hiding it: `factValue`'s interaction is `optional: true`, which makes
    the walker require the *text* to be identical whether or not the affordance exists — ADR-069's overflow
    rule applied to a whole surface.
  - 🟡 **Two injections applied and were semantically inert**, which is a new variant of WP6-5b's lesson.
    Renaming a slot the spec references nowhere, and renaming one whose interaction targets its *parent*, both
    left every suite green — because a slot's **name** is only load-bearing where something refers to it. The
    real injections are a **deletion** (both suites red by 11 tests each, which is the spec pinned from both
    sides) and a rename of a slot an interaction *does* target, which fails at **emit** and prints every slot
    name. *An injection that applies is not the same as an injection that changes anything.*
  - ⚪ **Five injections watched failing**, each asserting that it applied: the DOM row dropping its printed
    stop code (web red 14, RN green), the RN strip losing its holiday separator (RN red 1, web green), the DOM
    screen unnaming its tokens (web red 7, RN green), the spec deleting a slot (both red 11), and the emit
    guard above. The asymmetry is the point: a per-renderer defect is a per-renderer failure.
  - 🟡 **Two more platform substitutions than the Place screen needed**, both dying with
    `SyntaxError: Unexpected token 'typeof'` and no stack: `react-native-svg` (through the double-decker glyph)
    and `react-native-gesture-handler` (through the sheet). Found by bisecting the import graph one module at a
    time, which is now twice the only way in. And a **`ResizeObserver` stub installed above the screen's
    import** — a class declaration is hoisted but not initialised, so assigning it in `beforeEach`, or even
    lower in the file, is too late: `react-native-web` has already captured the constructor.
  - 🟡 **jsdom has no `scrollIntoView`**, and an unstubbed call throws out of the effect that brings the
    boarding row up — failing `anchored` for a reason that has nothing to do with the screen.
  - **Test totals:** core 924, edge 149, api-client 71, ui-spec 30, web **154** (+23), mobile **132** (+23) —
    **1 460**. Corpus 14 files / 106 groups / 900 cases / 4 `knownDefect`; **7 component specs**.

## ADR-095 — The estimate mark is content, and so is the separator between two day names

- **Status:** **Decided and implemented 2026-08-05** as **WP6-6c**, which closes **WP6-6** entirely.
  Implementation: `routeFactSheet` in `packages/core/src/route-detail.ts` (+15 corpus cases in
  `route-detail.spec.json`, +7 property/coverage tests), `apps/mobile/components/RouteFactSheets.tsx` reduced
  to a projection, a new `apps/web/src/components/RouteFactSheet.tsx`, and
  `apps/mobile/components/RouteFactSheets.tsx` joining `check-no-derivation`'s `POLICED` list — **with no new
  allowlist entries**, which is the cleanest signal that nothing derivable was left behind.
- **Context.** WP6-6a hoisted the static-facts *strip*; the four surfaces a pill opens (ADR-044) were the last
  derivation on this screen and the reason `RouteFactSheets.tsx` — 397 lines — was deliberately the one route
  surface the gate did not read. `apps/web` drew the strip as inert pills, declared in the spec as an
  `optional` interaction so the gap was a statement rather than a silence.
- **Decisions:**
  1. **The `~` on a concession figure is content.** These are policy-derived estimates rather than route data,
     and ADR-008 forbids presenting an estimate as a reading — so the mark that says so is composed in the
     kernel, where one renderer cannot drop it. The same argument puts the `~` on the route distance.
  2. **The separator between two day names is content too**, and it is the sharpest case in the group. A
     `dayType` of `other` means the dataset's mask matches none of the four named types, and the honest answer
     is to name the days it runs — *which* days, in *what* order (Sunday-first, the mask's own), with *what*
     between them. That was `.map().filter(Boolean).join(' · ')` in a React component: three decisions for one
     answer, and a second renderer would have picked a comma.
  3. **The legend explains exactly the classes that appear.** A class explained but never shown is a promise
     the sheet did not keep; a class shown but not explained is an unlabelled estimate. It was
     `stages.some((st) => estimateChildFare(st.fare) && estimateElderlyFare(st.fare))` inline, and it is a
     property test now.
  4. **A coarse fallback appears only where there is no table**, on both the frequency and the hours sheet.
     Both at once would state one fact twice at two fidelities. Asserted as its own property rather than
     assumed symmetric: the two sheets read *different* fields of the same block, so a port that wired one
     fallback and forgot the other looks right on every route that has patterns.
  5. **`estimate` is a flag, not a mark in the string** — on the overview's three figures. The route distance
     is a straight line through the stops and the journey time is upstream's own timing; the *caveat* under
     each is a whole sentence the catalogue owns, where the `~` inside a fare is a mark inside a figure. A
     property asserts the stop count is never flagged and the other two always are.
  6. **The overview's stop count is a bare number**; the strip's pill carries the whole "34 stops" phrase.
     Same datum, two honest readings — the row beside it already says *Stops* and the pill has no label of its
     own. It is why `labels.stopCount` is not consulted on that sheet, which `noUnusedFunctionParameters`
     pointed out before the reasoning was written down.
  7. **There is no `concession` label in `RouteFactLabels`**, and the absence draws ADR-054's line tightly: the
     kernel decides which classes have a figure and what the figure reads, and never joins their *names* to
     anything — so the word stays in each renderer's table beside the glyph it belongs with. It was in the
     interface for one draft, unused, and lint said so.
  8. **The DOM sheet is a `<dialog>`, and it does not dismiss on a backdrop click.** `showModal()` gives focus
     trapping, Escape and an inert backdrop for free — what a keyboard and a screen reader need, and what a pan
     gesture cannot provide. The obvious backdrop-click (an `onClick` on the `<dialog>`, since a click on the
     backdrop *is* a click on the element) is a handler on a non-interactive element with no keyboard path, and
     Biome's `useKeyWithClickEvents` is right about it. The RN scrim tap is a thumb-reach idiom; Escape and the
     close control are the two paths here and both work for every input device. **Suppressing the rule to add a
     third would have been the wrong trade** — a note worth keeping, because the previous instinct on this
     repo was to suppress (ADR-092's `<div>` with an `onClick`, which CI caught).
- **What the injections found, and one of them is the interesting result.**
  - ⚪ **Four of five went red as expected**: dropping a figure's `~`, joining an unnamed mask with a comma,
    showing the coarse fallback beside the table, and marking the stop count an estimate.
  - 🟠 **The fifth came back green, and the fix it reverted was real.** The fare timeline looks its boarding
    stop up by **position** rather than by `seq`, because `fareStages` numbers stages from the array it was
    handed while a row's `seq` is what the wire numbered it — and the spec's own `seq` invariant says the two
    agree today and would differ on an offset or gapped sequence. Reverting to a `find` by `seq` changed
    nothing, because **every fixture had `seq === index + 1`**: the fix was reasoning rather than a
    measurement. A corpus case with a sequence starting at 5 now exists, and the same injection turns two tests
    red. *An injection that comes back green is sometimes a statement about the fixtures rather than about the
    gate* — the third variant of this lesson in two rows.
  - ⚪ **Two dead branches refused by the 100 % threshold; the stage lookup became a walk over the rows** (as
    the bus tokens did in WP6-6a). `concessionFigures` was also written as two casts on the same premise — **but
    the premise was false, and a post-merge review caught it.** `fareStages` admits a fare wherever `Number(f)`
    is not `NaN`, so a whitespace cell (`Number(' ')` is `0`) or an `Infinity` string survives as a stage, while
    the estimators reject exactly those through `parseFareOrUndefined`'s trim-and-`isFinite` screen — so a
    malformed but unvalidated wire fare (ADR-052 decision 2) printed the literal `~$undefined` and populated the
    legend with it. It is a **both-or-neither guard** now (`return []` when either estimate is absent), which is
    what `FareStageRow.concessions` had already documented, and a regression test pins the empty arm the corpus
    never reached.
- **Also a live defect, pinned as a `knownDefect` corpus row.** A route whose per-stop fares are non-numeric
  gets an **entirely blank fare sheet**: `fareStages` drops any value `Number()` cannot read, so there are no
  stages and no concessions — while `fareRange` drops the same values, falls back to `service.fareFull`, and
  the pill therefore reads `$13.4`. A rider taps a pill showing a fare and gets nothing. The fix is in
  `docs/07`: fall back to the origin full fare as a single stage covering the whole route, which is the same
  datum the pill used.
- **Verified in a browser on live Hong Kong data** (`.context/wave6-screenshots/15-web-route-fare-sheet.jpg`,
  `16-web-route-overview-sheet.jpg`): KMB 1A on `apps/web` — the fare timeline's four price steps with
  `~$4.1` / `~$2.0` beside each, the boarding stop and the stops covered, and the *Estimated concessions*
  legend with both classes and the disclaimer; the frequency sheet's `Mon – Fri` bands; the hours sheet's three
  day types with First/Last; and the overview reading `Stops 34`, `Full journey ~60 min` and `Distance ~13.0km`
  with a caveat under each of the two estimates. The RN sheets render the same content from the same call.
- **Consequences:**
  - ⚪ **`check-no-derivation` now polices every route surface**, 37 files across 15 paths, and the strip's
    interaction is no longer `optional` in the spec — both renderers open a sheet. What `optional` bought while
    it lasted is recorded on the interaction rather than deleted with it.
  - ⚪ **A sheet is not a state of the Route spec.** Its content is `routeFactSheet`'s, pinned by 15 corpus
    cases and projected by both renderers; what the screen spec holds about the sheets is that the pill which
    opens one is a control and that the strip's own text does not depend on the affordance existing. A separate
    component spec for the sheets is available if a third renderer wants one and is not owed by this row.
  - ⚪ **A post-review pass (2026-08-05) closed four more introduced defects**, each one aligning the code with a
    decision this row already recorded:
    - the `concessionFigures` `~$undefined` above (decision 3's legend honesty), now a guard;
    - **both renderers now read `RouteStatRow.estimate`** rather than re-deriving the caveat from the `stat`
      kind (decision 5) — the flag had no reader on either side and each sheet's comment claimed otherwise;
    - the DOM `<dialog>` gained an **accessible name** (`aria-labelledby` → its heading) and now **restores focus**
      to the pill that opened it on close (decision 8, ADR-075's identity side) — `showModal()` gives an unnamed
      dialog and React's unmount skips the browser's own focus-restore step;
    - the web rail re-measures its node offsets through a **`ResizeObserver`** (ADR-093/094): they had been
      measured once per stop-count change, so a row growing its arrivals line on a refetch drifted every token
      below it off its node — a live divergence from the RN screen, which re-measures on `onLayout`.
  - **Test totals:** core **931** (+7), edge 149, api-client 71, ui-spec 30, web 154, mobile 132 — **1 467**.
    Corpus 14 files / **107** groups / **915** cases / **5** `knownDefect`.

## ADR-096 — A screen with no data still has five states, and attribution is one of them

- **Status:** **Decided and implemented 2026-08-07** as **WP6-7**, which closes the last unported
  destination in `apps/web`. Implementation: `packages/core/src/settings.ts` (`settingsView`, `aboutView`,
  `faqView`, +12 corpus cases in a new `settings.spec.json`), three component specs
  (`settings`, `about-data`, `faq`), three new `apps/web` screens, six new conformance suites,
  `apps/web/src/shell/{Placeholder,ShellPreferences}.tsx` **deleted**, and the three RN screens joining
  `check-no-derivation`'s `POLICED` list — **with no new allowlist entries**.
- **Context.** `proposals/04` files this row as *"mostly chrome and prose"* and calls it *"Cheap; last."*
  It is the only screen group in the app with no `DataSource` call anywhere in it, which made two things
  look optional and made both of them the row's actual content. The five canonical states were designed
  around a query — they are branches over an async status (ADR-084) — and the spec format **requires** all
  five. The tempting reading is that they are vacuous here and should all be `unenforced`, which would make
  three specs decoration: the exact failure `enforcement` exists to prevent.
- **Decisions:**
  1. **The five states stop being branches over a fetch and become claims that hold without one, and the
     mechanism is an inversion of the `slots`/`shows` split.** On a screen with data, `slots` is the thin
     chrome that survives every branch and each state adds its own content. Here the **whole screen is
     `slots`**, so a state declaring `shows: []` is declaring *everything* — and a renderer that drew a
     heading and filled its list in an effect diverges at index 0 rather than passing.
     `route-detail.spec.json` records the trap this inverts: there, `shows: []` and *"renders nothing at
     all"* are indistinguishable to a text projection. Here they are opposites.
  2. **`loading` therefore differs between the three screens, deliberately, and the difference is the
     answer.** About and FAQ project the *whole page* in `loading`, because their first frame is the
     finished page — and the claim is kept honest structurally rather than by comment: both drivers mount
     with **no query client and no `DataSource` in scope**, so a fetch added to either screen breaks the
     harness instead of quietly weakening the assertion. Settings' `loading` is `unenforced`, because the
     two renderers close the pre-hydration window by *different* mechanisms (`localStorage` is synchronous,
     so `persist` has read the blob before `create` returns; AsyncStorage is not, so the RN root holds the
     splash) and a third renderer would have to choose one.
  3. **A preference screen's content is a choice, so the choice is a rule.** Which languages are offered,
     in what order, which one is lit, which sources this app is obliged to credit and where each link goes,
     which questions it answers and in what order — 35 decisions across the three files, every one a private
     `const` inside one renderer, and two of them already duplicated three files away in the shell
     scaffolding this row deletes. Two are traps rather than tables: **a language is selected by the
     override and never by the resolved locale** (`useLocale()` and `useLocaleOverride()` are in scope four
     lines apart, either type-checks, and reading the wrong one lights *two* rows for the commonest rider
     there is), and **an appearance is selected by the raw preference and never by the mode it resolves to**
     (`resolveMode('auto', true)` is `'dark'`, so a renderer marking the resolved value shows *Dark* to a
     rider who chose *Auto*, and looks right on every machine whose system theme is light). Both are one
     `===` away, neither is expressible as a type, and both are corpus rows now.
  4. **The words are injected and the catalogue *keys* are not.** ADR-054's line — core owns the rule, the
     catalogue owns the word — puts every label behind an injected function, as `placeDetailView` does. But
     the ordered table of *keys* the FAQ and the About page are built from stays in the kernel: a key is an
     opaque string there, and *which questions this app answers, in what order, paired with which answers*
     is a product decision of the same class as *which sources it credits*. Leaving it with the caller is
     what left it a literal in one screen for a second renderer to copy. The corpus drives `text` as the
     **identity**, so every recorded title, body, question and answer *is* its catalogue key — which makes a
     mis-paired question and answer a byte diff rather than a screen a reader has to notice is strange.
  5. **The membership of each option list comes from the package that owns its type, and never from a
     fourth literal.** `SUPPORTED_LOCALES` from `@nextbus/i18n`; a new `APPEARANCES` from `@nextbus/ui`,
     beside `Appearance` and `resolveMode`. `packages/core` may not import either (`layers.json` gives the
     kernel `use: []`), so declaring the appearance union there would have **added** a declaration to remove
     two. `settingsView` takes both as arguments and decides only which one is lit, which is the part that
     is a rule.
  6. **Attribution is an obligation rather than content, and three of the six were missing — each of them
     closing a decision that had been taken, written down, and never actioned.** ADR-049 decision 5 ends
     *"This extends the ADR-038 'About the data' sources list"* and it never did (the binding credit is the
     one on the map face, which has always shipped; this is the second half, and the CSDI grant conditions
     on naming the portal as well as the department). Green minibus shipped as a v1 operator with its own
     feed and `faqCoverageA` named it, so **the app's own coverage answer contradicted its own attribution
     page**. And every route, stop, fare and frequency is normalized from a third party's consolidated
     crawl rather than fetched from the portal — ADR-021's own decision says to attribute it and ADR-038's
     follow-up list repeats it. A licence obligation living as loose JSX in one renderer is one a second
     renderer can simply not have, and nothing fails. There are **two licence rows** now, not one: the
     basemap arrived a wave after ADR-038 built the section for exactly one, under different terms, leaving
     a single sentence about *"the Government's terms"* standing for two different sets of them.
  7. **The locale → portal-slug map is the strongest kernel rule on these screens.** The portals' path
     segments are `en`/`tc`/`sc` and ours are `en`/`zh-Hant`/`zh-Hans`, so it is neither the identity nor a
     `toLowerCase()` — and a renderer inventing `zh-hant` lands a rider on a 404 in the one place the app
     sends them to read a licence, in the language most of them use. Two tables rather than one shared one,
     because these are two organisations' independent schemes and the day CSDI renames `tc` a shared
     constant would break data.gov.hk's links too. Both are pinned in all three locales, and the drivers
     assert the rendered `href` — the half no text projection can see.
  8. **The prose was audited against the code rather than reread, and `faqOfflineA` was not the worst of
     it.** `faqMergeA` still described ADR-022's cross-operator *pair* merge — a rule ADR-042 replaced with
     direction-aware N-member clustering and ADR-072 partly reversed — so every clause of it was wrong, and
     its *question* was widened with it because two companies at one stop is now the minority reason a place
     has several kerbs. `faqTimingsA` said every figure was *"shown as published"* while the app draws
     concession fares it works out itself and marks with a `~` (ADR-095 decision 1), which is the one case
     where the FAQ **contradicted an on-screen honesty label**. `faqFreshnessA` promised figures are *"greyed
     out"* when the whole shipped treatment is `opacity.etaStale` and ADR-008's *"updated Ns ago"* chip has
     never been built. `faqMapA` is still literally true — HK open data publishes no vehicle positions and no
     polylines — but reads as a broader refusal than the app now makes, so it gains one sentence about the
     schematic rather than a rewrite: *a stop list is not a map, and an inference is not a position.*
     `faqCoverageA` audits clean and is the only one untouched.
  9. **Two states are declared as real defects rather than softened.** Settings' `failed` — *the preference
     could not be saved* — is a `knownDefect`, because both stores write through a wrapper that swallows the
     throw and zustand's `persist` reports nothing to a component, so the screen shows a choice that will not
     survive a reload. Settings' `stale` is a `knownDefect` and it is the more interesting one: two stores
     share one storage key (ADR-089), **neither listens for a `storage` event**, and `persist` writes
     `partialize`'s output as the *whole* blob — so a second tab holds a stale copy in memory and the next
     preference it writes silently reverts the first tab's language. It is ADR-082 decision 5's hazard
     between two *apps*, arriving between two tabs of one. Measured (no listener exists anywhere), owned in
     `docs/07`, and a `mustNot` about a **producer** for the third time (ADR-090).
- **Consequences:**
  - ✅ **`apps/web` has eight ported screens and zero placeholders.** `Placeholder.tsx` and
    `ShellPreferences.tsx` are deleted, no destination carries an `owner`, and `screenFor` is an exhaustive
    switch over the declared paths with a throwing default — so a destination added to the table without a
    screen is now a **typecheck failure**, which is a stronger guarantee than the `owner` field ever was.
    **WP6-8's stated precondition is met.**
  - ✅ **The emitter's own line is the evidence these specs are not decoration**: settings 7 states
    (3 projected, 1 by a slot, 2 known defect, 1 unenforced), about-data 6 (3 / 1 / 0 / 2), faq 8
    (5 / 1 / 0 / 2). A spec printing *"0 projected, 5 unenforced"* would have meant the row had not answered
    its question.
  - 🟠 **`shell-parity.test.ts`'s owner check would have gone vacuous and was rebuilt rather than deleted.**
    With no destination carrying an `owner`, the loop validating the *format* of one can never execute — a
    check looking at nothing, wearing the same green tick as a check that passed. The rule is exercised
    against a synthetic destination instead, so it keeps biting until a real `owner` returns.
  - ⚪ **The version is a `define`, not an env var.** `__APP_VERSION__` is substituted from
    `apps/web/package.json` in both the vite and vitest configs, and declared in `src/globals.d.ts` so a
    missing one is a typecheck failure. A `VITE_*` variable was rejected as a footgun by construction: unset
    yields `undefined`, the screen prints nothing, and that is indistinguishable from a rider on an old
    build. Both apps still read `0.0.0`; ADR-038's follow-up to set a real one is still open.
  - **Test totals:** core **954** (+23), edge 149, api-client 71, ui-spec 30, web **192** (+38), mobile
    **167** (+35) — **1 563** (+96). Corpus **15** files / **110** groups / **927** cases / 5 `knownDefect`.

## ADR-097 — The conformance walker sees presence, not visibility — and an ARIA state it cannot see is one a rider may not be getting either

- **Status:** **Decided and implemented 2026-08-07**, alongside
  [ADR-096](#adr-096--a-screen-with-no-data-still-has-five-states-and-attribution-is-one-of-them), as the
  half of **WP6-7** that was not in its row. Implementation: the DOM FAQ built as a
  `<button aria-expanded>` rather than a `<details>`, `faqView` modelling a collapsed answer as **absent**,
  and **six sites across `apps/mobile` moved from `accessibilityState` to `aria-*`**.
- **Context.** ADR-093 found that a component spec's vocabulary is *text*, so the conformance walker could
  not see a bus token **at all** — a graphic carrying information a rider acts on. Writing the FAQ's spec
  produced the mirror image, and it is the more dangerous of the two because it fails **open**: every driver
  in this repo reads text with `createTreeWalker(host, NodeFilter.SHOW_TEXT)`, which consults the DOM and
  never CSS. jsdom applies no stylesheet at all. So a closed `<details>`, a `hidden` node and a
  `display: none` node are **fully visible** to it.
- **Decisions:**
  1. **A disclosure that keeps its content mounted is indistinguishable, to every check in this repo, from
     one that shows everything.** Measured before any code was written: the exact walk every driver uses,
     run over `<details><summary>Q</summary><p>A</p></details>`, returns `["Q","A"]`. A `<details>`-based FAQ
     would therefore project the **collapsed** state — the state a rider *arrives* in — as seven questions
     and seven answers, and the only escape would be to declare that state without a projection. So
     `<details>` is ruled out on this screen despite being the DOM-idiomatic answer, and despite WP6-6c
     reaching for `<dialog>` on exactly that reasoning.
  2. **A second, independent reason points the same way**, which is what makes it a rule rather than a
     preference: `<summary>` matches none of the drivers' interactive selectors, so a `<details>` FAQ
     reports **zero tap targets** and the sibling-not-nested check looks at nothing. And a third: a hidden
     answer is still read by a screen reader and still found by a page search, so "collapsed" that keeps its
     content is a claim about pixels rather than about content.
  3. **So the rule lives in the kernel, not in two renderers' habits.** `faqView` returns `answer` only when
     the item is expanded — **absent, not empty** — and the spec's `answer` node carries `when: 'expanded'`.
     Declared unconditional it would be satisfied by a renderer showing every answer at once; declared with
     no `when` it would be satisfied by one that mounts them all and hides them. Watched failing: making the
     DOM screen mount every answer behind a `hidden` class turns **7 tests red**.
  4. **The same blindness caught a divergence from the opposite direction, in a component nobody was
     looking at.** The DOM Settings screen's navigation chevron was written as a `›` character. That is a
     **text node** — read by the walker whether or not it is `aria-hidden` — where the RN row draws an SVG,
     so the web row projected one more string than its twin. It is an SVG now. *A glyph is text; an icon is
     not.*
  5. 🔴 **And the mirror of all of it is a live accessibility defect on the shipping PWA.**
     `accessibilityState` is what six places in `apps/mobile` used to say *selected*, *expanded* or
     *disabled*. **`react-native-web@0.21` forwards the modern `aria-*` props and drops `accessibilityState`
     entirely** — no warning, no fallback, no attribute in the emitted DOM. So on the Expo PWA the language
     picker, the appearance picker, the search chips, the search mode segment, the save star and the FAQ
     disclosure announced **no state at all**: the selection was a dot and a font weight, and nothing a
     screen reader could read. Found by writing an assertion that expected to *check* something and found
     nothing to check; confirmed by a probe that rendered a `Pressable` with each prop and read the emitted
     attributes back. Watched failing: reverting one turns the RN driver red by two tests.

     ⚠️ **Corrected within the day, by WP6-7b's parity audit, and the correction is the more useful half.**
     The first fix replaced `accessibilityState` with `aria-*` and was **half right**: RN 0.85 declares
     fourteen `aria-*` props and **`aria-pressed` is not among them**, so on iOS and Android it is dropped
     exactly the way `accessibilityState` is dropped on the web — *the same defect, one platform over,
     introduced by the fix for it*. It type-checks, because `PressableProps` widens; the type system is no
     help in either direction, which is the whole lesson. The five toggle sites now carry **both** props:
     `accessibilityState` is read on native and ignored on web, `aria-pressed` is read on web and ignored on
     native. `aria-selected` would have satisfied both mechanically and is wrong on the web, where
     `aria-selected` on a `button` is not valid ARIA. The FAQ's `aria-expanded` needed no change — RN
     declares that one.
  6. **What a projection cannot see, the suites assert directly — and the flag they assert is the
     kernel's.** `search.spec.json` established this for a keypad key's `enabled` (*"it is a colour, and the
     suites assert it directly"*); Settings needs it for `selected`, and About for an `href`. The division is
     safe **because the value is a field of the view model**: both renderers read one rule rather than each
     deciding, so the two independent readings (`aria-pressed` on a `<button>`, `aria-pressed` on
     react-native-web's `Pressable`) are two honest readings of one answer rather than two answers.
- **Consequences:**
  - ⚪ **The spec says the edge out loud.** `faq.spec.json`'s `idiom` list names the disclosure mechanism as
    idiom *with one hard edge* — whatever the mechanism, a collapsed answer must not be in the tree — because
    an unstated constraint is how the next renderer reaches for `<details>` and passes review.
  - 🟠 **Two gates were found looking at nothing while this row was being built, and both are closed.**
    `packages/core/vitest.config.ts`'s coverage `include` is hand-spelled and `src/favourites.ts` was never
    added when WP6-4 created it — so the module holding the rule a rider's hand-curated list survives on sat
    **outside** the 100 % branch threshold for a whole wave while the threshold reported green. Adding it
    revealed **eight untested branches**, now covered (`favourites.ts` is at 100 % on all four axes). And
    `apps/web/tsconfig.json` included `test/**/*.ts` but not `test/**/*.tsx`, so **seven conformance suites
    were invisible to `pnpm typecheck`** — two real type errors surfaced the moment they were included.
  - 🟡 **`conformStates` runs two checks, not three**, and it is worth stating because every screen suite in
    the repo uses it: exact text equality per projected state, and no nested tap targets. It never calls
    `render(view, {interactive:false})`, so **`content-not-affordance` is not enforced by any screen spec** —
    only by the component-level `conform()` that `nearby-projection.test.tsx` drives over `StopRow`. That is
    a real gap in what a screen spec buys, named here rather than assumed.
  - ✅ **Verified in a browser on `apps/web`** (2026-08-07, `:8082`): Settings' three sections with
    *Automatic* and *Auto* lit; the whole UI switched to 繁體中文 with the language list still reading
    **English · 繁體中文 · 简体中文** and only *Automatic* translated — the endonym rule, on screen; the FAQ's
    seven questions with **zero answers in the DOM** when collapsed (`document.querySelectorAll('p[id]')` →
    0, and the answer text absent from `innerHTML`), then two open at once with both chevrons flipped; and
    About the data with **six credited sources**, **eight anchors** every one of them
    `target="_blank" rel="noopener noreferrer"`, and the terms link resolving to `data.gov.hk/tc/…` under a
    Traditional Chinese UI.

## ADR-098 — A spec can declare an interaction and no gate will check where it goes

- **Status:** **Decided and implemented 2026-08-08**, closing WP6-8's first blocker. Implementation:
  `apps/web/src/components/RouteStopSheet.tsx` and `SaveStar.tsx`, wired into Route detail and `PlaceRow`,
  with 9 direct assertions across the two web state suites.
- **Context.** WP6-7b's parity audit found that **`apps/web` could not create or delete a favourite** —
  `toggleFavoriteRoute` had zero callers. ADR-032 makes the route schematic's stop action sheet the app's
  only favourite-creating affordance and WP6-4 ported the screen that *reads* favourites and neither
  affordance that *writes* one, so the Favourites tab could render a curated list and offer no way to change
  it. Four auditors found it independently; no gate did.
- **Decisions:**
  1. **`conformStates` asserts text and nesting, and never interaction destinations — so a declared
     interaction that goes somewhere else is invisible to the entire spec apparatus.**
     `route-detail.spec.json` has carried the `stopName` interaction **non-optionally** since WP6-6b, with a
     note saying *"deliberately not straight to the place"*, and `apps/web` navigated straight to the place
     for two waves with every suite green. The sheet is not rendered until a tap, so no *projected state*
     changes either way. This is the sharpest instance yet of the format's boundary: a spec describes what a
     surface **shows**, and has no vocabulary for **how the content got there**.
  2. **What a spec cannot check, a driver asserts directly — and the assertion has to be about the key, not
     about the click.** The sheet writes `formatFavoriteRouteKey(pole, route.id)` using the **payload's**
     route id rather than the URL parameter, because `routeDetailView` computes each row's `saved` from that
     spelling: a toggle written under any other would be stored and read back as unsaved, silently. The test
     asserts the stored key equals the kernel's, not merely that something was saved.
  3. **An `idiom` entry that names a renderer is a claim about that renderer, and it can go stale into a
     capability gap.** `place-row.spec.json` called the star idiom, *"present on native"*, on the premise
     that a web rider could favourite elsewhere. The classification was right — the star has no text, so no
     slot can declare it — and the premise was false. The entry now says *"on both renderers"*, and each
     suite asserts that the star **changes not one word of the projection**, which is what keeps "idiom"
     honest rather than convenient.
  4. **The star is a sibling of the row's button, never nested** (ADR-024), which is why `PlaceRow` returns a
     flex container rather than a full-width button. Measured on the live page: 27 interactive elements,
     0 nested.
- **Consequences:**
  - 🟠 **No test in this repo had ever opened a `<dialog>`.** Writing these needed a
    `HTMLDialogElement.prototype.showModal` shim, because jsdom implements the element and not the method —
    which means `RouteFactSheet`'s container had never been mounted either since WP6-6c. The sheets' *content*
    is corpus-projected; their container was unexercised. Same blind spot, one component over.
  - 🟡 **The sheet's own content is a declared state in neither renderer's spec**, and giving it one would
    have to spec the native sheet at the same time. Both suites assert it directly instead — the
    `search.spec.json` division — and `docs/07` carries the follow-up. It would be the first spec for a
    surface that exists only behind an interaction, which ADR-092 did not answer: that ADR settled what a
    rider *infers from* an interaction, not what one *opens*.
  - ✅ **Verified in a browser on live Hong Kong data:** KMB 1A → tap 秀安樓 → the sheet titled with the row's
    own name, the `1A` chip and the journey → *加入收藏* → `nextbus.preferences` gains
    `KMB:6F106FD26B684372|KMB:1A:outbound:1` → the Favourites tab draws the card with its southeast-bound
    caption and a 2-minute reading → Place detail draws exactly one star, labelled `已收藏` and
    `aria-pressed="true"`. Screenshots `.context/wave6-screenshots/21`–`22`.

## ADR-099 — The same font declaration, four static cuts on native and one variable file on the web

- **Status:** **Decided and implemented 2026-08-08**, closing WP6-8's second blocker. Implementation:
  `@fontsource-variable/inter@5.3.0` as a devDependency of `apps/web`, four `@font-face` rules in
  `apps/web/src/index.css`, and four parity assertions in `test/shell-parity.test.ts`.
- **Context.** WP6-7b's parity audit found that **`apps/web` never loaded Inter**. `apps/mobile` loads four
  cuts through `expo-font`, which on web registers real `FontFace`s — so the Expo PWA has rendered in the
  brand typeface since ADR-017 and the renderer meant to replace it rendered in the OS system stack.
- **Decisions:**
  1. **The family names are not ours to choose — they are the contract.** `packages/ui`'s preset declares
     `fontFamily.sans = ['Inter_400Regular', …]` because that is what `expo-font` registers on native, and
     the preset is one declaration for both platforms. So the web declares an `@font-face` per cut. All four
     alias the **same** 48 KB variable file over the full `100 900` range: native needs four static cuts
     because it has no variable-font pipeline here, the web needs one. **Same declaration, two honest
     implementations** — ADR-075's line, arriving in a place nobody expected it.
  2. **Self-hosted, never a third-party link.** ADR-058 makes this app offline-first and `scripts/pwa`'s
     precache globs already included `woff2`, so a font emitted into `dist/` is precached with everything
     else. A Google Fonts `<link>` would be a request that fails exactly when the rest of the app is working,
     and a per-rider request to a domain the About screen does not credit.
  3. **Latin only — ADR-019 is untouched.** That ADR declines to bundle a CJK webfont for size, and the
     decision stands: each `@font-face` is `unicode-range`-limited, so Chinese renders in the platform face
     through the preset's fallback chain. Which is also why the body rule is `@apply bg-bg font-sans` rather
     than a stack written out here — the chain is declared once.
  4. **A comment is not a measurement.** What stood in `index.css` was a hand-written system stack justified
     by *"the same stack the RN app resolves to on web, so a glyph difference is not mistaken for a rendering
     difference while the two are being compared"*. Every clause was wrong, and it read as considered. The
     four new assertions replace it: they read the preset and require a face per cut, one shared source, and
     no `https:` URL.
- **Consequences:**
  - ⚪ **48 KB for the whole weight range**, against 1.35 MB of TTF for the four native cuts and against a
    402 KB JS bundle. The precache went from 9 files to 10, 441 kB to 489 kB.
  - ✅ **Verified in a browser:** all four faces report `loaded`, `<h1>` computes to `Inter_700Bold` at
    weight 700 and body to `Inter_400Regular`, while 繁體中文 and 简体中文 stay on the platform face.
    Screenshot `.context/wave6-screenshots/23`.
  - 🟡 **The first runtime dependency `apps/web` has that `apps/mobile` does not**, which is the direction of
    travel: WP6-8 removes Expo's font pipeline and this replaces it at a twentieth of the bytes.

## ADR-100 — The app's signature motion and material are identity; platform-conventional detail is idiom

- **Status:** **Decided by the owner 2026-08-08**, and it **amends ADR-075's invariant/idiom table, ADR-094,
  ADR-095 decision 8, and the `idiom` entries of five component specs.** Implementation is in progress; the
  shell chrome landed first.
- **Context.** ADR-075 put motion, material, gesture and shape on the **idiom** side wholesale, and ADR-094
  sharpened that into *"motion is idiom; what the motion is about is not"* — with the stated acceptance that
  *"`apps/web` animates only the position change and does not bob at all"*, because *"the web curve is
  chosen, not inherited"*. Every renderer difference that followed was then justified by pointing at those
  words: a flat opaque tab bar, no cross-fade, a `<dialog>` instead of a bottom sheet, a stock Lucide bus in
  place of the app's own glyph, no odometer, no collapsing headers.
  On review the owner's verdict was that the result is not a platform-idiomatic renderer, it is **less of
  the app** — and that the line was drawn in the wrong place.
- **Decision.** *The app's signature motion and material are identity. Platform-conventional detail is
  idiom.*
  - **Identity** — the things that make this app recognisably itself, and which a second renderer must
    therefore reproduce: the floating glass tab bar and its lens; the cross-fade between tabs; the
    collapsing headers; the bottom action sheet and its drag; the double-decker bus token and its bob; the
    arrival odometer; the direction-swap animation. A rider who used both should not be able to tell which
    one they are holding by how it *feels*.
  - **Idiom** — what genuinely belongs to the platform: the focus ring, the scrollbar, press feedback,
    hover, the text-selection colour, how a keyboard traverses, the fallbacks a browser needs where a native
    effect has no equivalent, and every accessibility affordance a platform offers that the other cannot.
- **Consequences:**
  - ⚠️ **Amends rather than deletes.** ADR-075's thesis is untouched: one executable spec, three renderers,
    drift defined on the spec. What moves is the boundary the spec's `idiom` lists draw, and the six specs
    that assert "nothing moves on this screen" have to be corrected as each surface is done rather than in
    one sweep — an `idiom` entry left claiming the old line is worse than none.
  - 🟠 **A process finding, and it is the reason this ADR exists at all.** The parity audit that preceded it
    (WP6-7b) told its verifiers to reclassify a finding as *intended idiom* when the choice was **written
    down somewhere** — which made documentation self-justifying, since most of it was written by the same
    agent sessions that made the choices, never reviewed by the owner. Re-read against this decision, **at
    least five findings the audit refuted or reclassified are real**, three of them independently on the
    owner's own list: the direction swap with no feedback, the instant kerb jump, the header tap-to-top, the
    unmanaged scroll position, and the keypad the OS keyboard covers. *"It is in an ADR" is not "the owner
    chose it"*, and an audit that cannot tell the two apart under-reports in a predictable direction.
  - ⚪ **What it does not license.** Copying a native constant into the web without asking whether it means
    the same thing is still wrong — a 52 px RN rail and a 44 px DOM gutter arrive at different numbers from
    the same answer (ADR-093), and that stays true. Identity is the *effect*, not the implementation.

## ADR-101 — A data router, because the point of View Transitions is the shared element rather than the fade

- **Status:** **Decided 2026-08-08** with the owner, implemented in `apps/web/src/shell/App.tsx`.
- **Context.** The owner asked for a cross-fade between tabs and, beyond it, for the mobile page
  transitions the web has never had. `react-router@7.18.2` wires View Transitions **only inside a data
  router** — the call sits behind `router.window`, which `<BrowserRouter>` never populates — so the choice
  was a hand-rolled `document.startViewTransition` in the tab bar, or migrating the shell.
- **Decisions:**
  1. **Migrate to `createBrowserRouter`.** A hand-rolled transition gets the cross-fade and nothing else.
     What the router adds is **`useViewTransitionState(href)`**, which lets a component claim a
     `view-transition-name` *for the duration of one navigation* — the difference between a page that fades
     and a route badge that flies from a list row into a header. The cross-fade was never the reason.
  2. **The router is built in `useState`, not at module scope.** `createBrowserRouter` reads
     `window.location` when it is *created*: at module scope it would capture whatever the URL was when the
     bundle loaded, and `shell.test.tsx`'s `pushState(path)` → mount would have opened the same screen eight
     times while appearing to cover every destination. The initialiser runs once per mount, which is also
     what that file's cold-start `remount()` wants.
  3. **The providers move inside the router**, into a root route element, since `RouterProvider` must be
     outermost. Their order is unchanged and still the RN root layout's: `QueryProvider` outside
     `LocaleProvider`, because a query key never contains the locale (ADR-052) and switching language must
     not invalidate a single cached response.
- **Consequences:**
  - ⚠️ **This is the second attempt at web page transitions.** ADR-043 built a JS navigator stack for
    push/back and reverted it because it broke web scrolling; `docs/07` still carries the item. View
    Transitions have no such failure mode — no navigator swap, no scroll container of their own, the browser
    snapshots and animates — which is why this is a different attempt rather than a retry. Firefox has none
    and cuts, exactly as the app does today.
  - ⚪ **Loaders and actions are deliberately not adopted.** The data router is here for its transition
    machinery; data still arrives through TanStack Query, which is what ADR-058's persisted cache is built
    on. Moving fetches into loaders would be a second, unrelated decision.

## ADR-102 — Search's query lives in the URL, and `replace` is what makes that safe

- **Status:** **Decided 2026-08-08** with the owner, implemented in `apps/web/src/screens/Search.tsx` and
  `apps/web/src/lib/searchParams.ts`.
- **Context.** Opening a result and coming back landed a rider on an empty keypad, having lost the query,
  the mode and every chip — `apps/mobile` keeps them because expo-router holds the screen mounted on a
  stack, and react-router unmounts it. The owner's instinct was a store, on the grounds that URL state
  *"often causes bugs and quirks with back button behavior"*.
- **Decisions:**
  1. **The URL, not a store** — but the objection was right about the failure mode and wrong about it being
     inherent. Pushing a history entry per keystroke turns Back into a per-character undo, which is what
     people mean when they say URL state is messy. **`replace: true` on every change** mutates the current
     entry instead, so Back leaves the screen. Measured rather than asserted: typing `805` grew
     `history.length` by **0**, and opening a result then going back returned to `/search?q=805`.
  2. **Read straight from the params, never mirrored into state.** One source, so a back/forward that
     changes the URL changes the screen with no effect keeping the two in step — which is the *other* class
     of bug URL state is blamed for.
  3. **Two parameters (`ops`, `cats`) rather than one encoded blob, and no knowledge of the kernel's chip
     keys.** `toggleSearchChip` mints and reads those keys with prefixes it owns (ADR-091); the codec
     encodes the filter's own two fields instead, so a change to the chip grammar cannot break a bookmark.
     An unrecognised value is passed through rather than dropped: `searchView` decides which chips exist
     from the index, so a hand-edited URL narrows to nothing, which is honest. Dropping it would show
     unfiltered results under a URL claiming otherwise.
  4. **The codec is `lib/`, not the screen.** A query-string grammar is plumbing, like the storage key and
     the appearance resolver. Worth stating because `lib/` is also outside `check-no-derivation`'s policed
     set, and moving code there *to dodge a gate* would be the failure this repo keeps writing ADRs about —
     the test is whether it would belong there anyway, and it would.
- **Consequences:**
  - 🟡 **The results list's scroll offset is still lost**, which the URL does not restore and the RN stack
    gave away free. Open in `docs/07`.
  - ⚪ **Reversible by design.** If any of the three things the owner asked to watch for misbehaves — Back
    undoing characters, a shared link not restoring the mode, a reload losing the chips — the state moves to
    a non-persisted store slice and only this file and the codec change.
