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
  1. **On-device search index (first realization of [ADR-007](#adr-007--on-device-static-index)).** A new edge
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
- **Status:** **Built & verified — backend + place UI (2026-06-11), member-keyed favourites (2026-06-15).** Shipped:
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
  1. **Same-name pole disambiguation.** Within a multi-pole place the poles share a landmark name; the group label
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
  `lib/stopName.ts`, `@nextbus/i18n`).
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
     destination name — `CIRCULAR` / `循環` / `循环` (`isCircular`/`stripCircular` in `lib/stopName.ts`). Because a
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
