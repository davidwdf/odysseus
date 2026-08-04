# 11 — Status & Where to Continue

> **Living handoff doc — update it at the end of each working session.**
> Snapshot: **2026-08-03**. **Waves 0–5 are all merged to `main`** (PRs #11–**#21**; `main` is `0c97e17`),
> and **Wave 6 has started: WP6-0 and WP6-1 are done** on `design-language-reuse-v2`
> ([ADR-082](./08-decision-log.md#adr-082--the-web-shell-before-the-web-screens-a-router-over-a-declared-destination-set-and-one-pwa-policy-for-two-apps),
> [ADR-083](./08-decision-log.md#adr-083--a-component-spec-is-data-with-five-words-and-the-projection-is-what-pins-it)).
> **What WP6-1 is:** the **first component spec exists**, and it is data. `packages/ui-spec` holds the
> format — a Zod schema plus a conformance walker, with **no NextBus vocabulary** — and
> `packages/contract/ui/stop-row.spec.json` is emitted from a typed declaration, validated, committed and
> drift-gated beside `openapi.json` and `asyncapi.json`. **Both renderers now drive it, and neither
> component changed**: `StopRow.tsx` and `StopCard.tsx` are untouched, which is the whole acceptance.
> **The format is five words** — `field` · `message` · `literal` · `each` · `oneOf` — plus `when` as a *path
> tested for truthiness*, and there is deliberately **no expression language**: a spec that needs `> 0` is a
> kernel rule leaking out. Each of the five is there because `StopRow` could not be expressed without it,
> which is the point of retrofitting the format to a component that demonstrably works rather than designing
> it first.
> **Three things it settled that the plan left open.** (a) The check is **exact equality**, and that is what
> makes one shared declaration safe where ADR-069 decision 7 forbade a shared *helper*: the spec is pinned
> from both sides, so an under- or over-specified spec turns both suites red rather than quietly relaxing
> them. The refinement is *the declaration is shared, the reading is not* — each renderer still owns how it
> builds a tree and reads text out of it, and those genuinely differ (`<button>` versus
> `div[role="button"]`). (b) **Every state must declare what enforces it** — `by` a slot, `knownDefect`, or
> `unenforced` with a reason — because a spec full of `mustNot` sentences that nothing checks reads exactly
> like an enforced one. (c) `proposals/04`'s own worked example contained a sentence that **would have failed
> both renderers on day one**: *"a card with a name and nothing under it"*. It is kept as the target and
> marked a `knownDefect` owned by **WP6-4**, rather than softened into something true.
> **ADR-069's bug is now caught mechanically for the first time.** `content-not-affordance` — the same text
> with every handler withheld — is that finding promoted to a universal law, and re-injecting
> `remaining > 0 && onPress` into `StopRow.tsx` fails 18 of 23 cases. Before this it took a second renderer
> and a human noticing.
> **Watched failing, six ways:** the `caption` slot deleted from the spec (19/24 red on web, 20/23 on
> mobile), a slot added that nobody draws (21 and 22 red), the caption line deleted from **only**
> `apps/web`'s component (web red, RN green — the ADR-069 deletion, now caught by a shared declaration), the
> `&& onPress` bug re-injected, the committed JSON hand-edited, and an orphan spec file added. Plus: touching
> `ui/stop-row.spec.json` turns `@nextbus/web:test` from a cache **hit** into a cache **miss**, so ADR-070's
> hole was closed prospectively for once — three `turbo.json` files declare the new artefact as an input.
> **The vocabulary gate found a real leak in its own package on its first working run**, and two earlier
> drafts of it were silently matching nothing: `\bword(?![a-z])` with the `i` flag (which makes the character
> class case-insensitive too, so the lookahead rejected every letter), then a de-pluraliser that *replaced*
> tokens and turned `routes` into `rout`. Its selftest caught both.
> **What WP6-0 is:** `apps/web` — the plain-React renderer that replaces the Expo PWA under
> [ADR-075](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels) —
> stopped being a one-screen proof and became an app **shell**: a react-router 7 router over a declared
> destination set, `PersistQueryClientProvider` on a synchronous localStorage persister, a `LocaleProvider`
> with a persisted override, an appearance store applied to `<html>` *before* the first render, a Workbox
> service worker, an installable manifest, and `build:web`. **One screen is ported (Nearby)**; the other
> seven destinations render a placeholder that names the work package porting it, because a router listing
> only Nearby would make every other destination read as *broken* rather than *not yet here* — and would
> leave the destination set, which ADR-075 calls identity, undeclared and therefore uncomparable.
> **Three things the plan's row did not anticipate, and they are the useful part.** (a) The acceptance's own
> two halves pull against each other — *"opens offline and switches locale"* versus *"with zero screens
> ported"* — so the shell carries a deliberately minimal locale + appearance control, and **WP6-7 deletes
> that file**. (b) The web preferences store owns a **different storage key** from the RN one, because
> zustand's `persist` writes `partialize`'s output as the *whole* blob: a two-field shell store on
> `nextbus.preferences` would have erased every favourite a rider curated, silently, the first time
> `apps/web` was served from the origin the Expo PWA was installed from. WP6-4 inherits the hoist of
> ADR-062's migration. (c) `react-router` is pinned to **7.18.2, not 8.3.0**, because router 8 wants
> `react >= 19.2.7` and this repo pins React to 19.2.3 to follow the Expo SDK — **the Expo SDK still
> constrains the plain-React app's dependencies until WP6-8**, which is a new, concrete instance of the tax
> ADR-075 itemised.
> **Also: one PWA policy for two apps.** `workbox.config.mjs` moved from `apps/mobile/` to `scripts/pwa/`
> with the five assertions over the emitted `sw.js`, because for the rest of Wave 6 two PWAs ship at once
> and two copies of ADR-058 could disagree about what a rider sees with no network. `apps/web`'s new
> `test/pwa-policy.test.mjs` asserts the policy's shape on every `pnpm test`. The icons and
> `manifest.webmanifest` are emitted from one `gen-icons.mjs` run into both web roots, with the manifest's
> two colours now read from the ink **token** instead of a hand-copied hex.
> **Verified by running:** built `apps/web`'s PWA, served it, chose 繁體中文 and Light, then **killed the
> static server** (nothing on 4173, nothing on 8787) and cold-loaded — `/settings`, `/` and
> `/stop/KMB%3A18492CD3D2C1A6D0` all opened, in Chinese, in light mode, with the id decoded and a working
> back control, and `performance.getEntriesByType('navigation')[0].deliveryType` read **`cache-storage`**
> while a probe to an unknown path threw *Failed to fetch*. `pnpm --filter @nextbus/mobile build:web` still
> emits its worker from the moved config (59 files precached). Screenshots:
> `.context/wave6-screenshots/`.
> **Every one of the 41 new tests was watched failing on an injected defect, and that pass caught two
> assertions that were passing vacuously** — the parity suite resolved `apps/mobile` from
> `import.meta.url`, which is an `http://localhost/…` URL under jsdom, so the file failed at *import* and
> vitest reported a failed **file** rather than failed **tests**; and `remount()` did not reset the
> preference store (module state), so both persistence assertions passed with `partialize` gutted. Neither
> was findable by reading the tests.
> Previously: **Wave 5 was complete bar the
> deployment** on `turbo-cache-inputs-v2` — 25 commits, and the branch was larger than a wave should be
> because an adversarial review and its thirteen fixes landed on the same branch as the feature.
> **Three of Wave 5's own follow-ups are now built on `wave5-followups-v1`** (16 commits above `origin/main`;
> **WP5-10** and **WP5-11**, one ADR between them —
> [ADR-071](./08-decision-log.md#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two) —
> and then **WP5-9**,
> [ADR-072](./08-decision-log.md#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)),
> and the dataset build hash moves to **`1ccad7436a8df480`**, so production needs a publish. **WP5-9 does not
> move it again** — the rebuild after it is byte-identical, which is the proof that it changed nothing in the
> offline pipeline.
> **Why the history looks odd:** WP5-10 was authored on `turbo-cache-inputs-v2` *before* PR #19 merged, and
> **#19 was squash-merged, which orphaned every original commit on that branch** — so those three commits and
> the WP5-11 work were **cherry-picked** onto a branch cut from `origin/main`. Nothing was lost and nothing was
> re-derived; the commit hashes in `.context/wave5/reports/WP5-10.md` simply no longer exist in any branch.
> **What Wave 5 is:** `DataSource.watch()` stopped being a promise. It is now a real frame protocol —
> `snapshot`/`delta`/`status`, declared once in Zod and published as `asyncapi.json` — over a pluggable
> transport, whose **default is a poll emulator** (HTTP polling wearing the frames) and whose other
> implementation is a **sharded, hibernating `EtaHub` Durable Object** behind `/v1/live`, with an adaptive
> 45→60 s alarm ([ADR-056](./08-decision-log.md#adr-056--the-live-protocol-frames-a-sharded-hibernating-etahub-and-what-we-could-not-verify)).
> Four agents, one workspace, sequential, ten commits — **then a review pass of fifteen more.**
> **The plan's own acceptance could not be met as written, twice over, and that is the wave's most useful
> finding:** WP5-2's *"`git diff --stat` shows zero lines changed under `apps/mobile/app/**`"* was zero **by
> construction** — nothing under those paths reached `watch()` at all, which the row itself notes and no work
> package owned — so an unplanned **WP5-0** gave it a real consumer first (`lib/useLiveEtas.ts`, ten lines,
> writing through to the query key `useQuery` already owns so ADR-058 keeps working); and WP5-1's
> *"byte-identical listener output"* is unachievable without a **canonical `(stopId, routeId)` order in the
> kernel**, which the row does not mention. With that order, reversing a transport's own ordering changes
> nothing (17/17 matrix rows still pass) — the negative result is the proof.
> **Two defects that were live on `main` fell out of it, and both survived for the same reason — no test
> spanned two implementations of one rule.** (a) **`Eta.stopId` served the operator's raw id** where its own
> schema declares the identity canonical, so every reader of the pair compared two alphabets and matched
> nothing: at a three-pole Mong Kok place, 8 of 21 rows had a live reading and **0 survived** the first merge
> one second after paint. Found by opening the screen in a browser — no test in this repo could have found
> it, because every fixture, including the kernel's corpus, wrote the spelling the contract asks for. Fixed
> on the server, no wire shape changed. (b) **The socket transport treated any `retryable: false` as
> terminal**, so **one stale favourite silently killed live ETAs for every stop a rider had**, permanently,
> with the socket reporting itself healthy. `state` describes the connection; `error` describes the thing the
> message names.
> **Verified by running, not by reasoning:** real frames from `wrangler dev` against the live KMB feed
> (snapshot → status → delta at +0 s, six readings changing every round at +45 s and +91 s, `pong` on the
> keepalive, canonical pole ids in every reading), an *unchanged* round arranged with the production
> coalescer and observed sending **nothing at all**, the Place screen repainting in Chrome at the cadence,
> `/v1/health` holding `"dataset":"kv"` with `datasetBuildsThisIsolate: 0` throughout, and
> `wrangler deploy --dry-run` resolving `env.ETA_HUB (EtaHub)` as a Durable Object.
> **Three things are unverifiable and say so where a reader meets them:** that workerd *chose* to hibernate
> (only its consequence is provable locally — there is no local knob, and `evictDurableObject` is an explicit
> call), whether a pending future alarm accrues duration charges (Cloudflare's own pages contradict each
> other, and it swings the cost model), and AsyncAPI as a **codegen** input — there is no AsyncAPI→Swift
> generator in existence, Kotlin generation cannot serialise, and `asyncapi diff` calls a removed field
> `unclassified`, so the document is a specification artefact with a validator. Same treatment as the
> never-compiled Swift/Kotlin token artefacts.
> **Also in this wave:** the repo's **first CI workflow** (`.github/workflows/ci.yml` — a clean checkout,
> typecheck · lint · test · `wrangler deploy --dry-run` · `git diff --exit-code`, no credentials needed; the
> deploy job is written out and deliberately inert), **one declaration of where the API is** (`DEFAULT_API_URL`,
> down from four copies under two variable names, with a gate), an `.env.example` inventory at the root plus
> the one `apps/web` never had, and the commented custom-domain block in `wrangler.toml`. Test totals
> **705 → 934** (core 738 · edge 93 · api-client 47 · mobile 36 · web 20, **counted on a clean clone** —
> two reports of this wave quoted 891 and 937, neither counted); `packages/api-client` has a `test`
> script for the first time, having been skipped **silently** by `turbo run test` until now.
> **Then an adversarial review ran over the finished diff, and it is the most useful thing in the wave after
> the seam itself.** Six read-only finders raised 28 candidates; three skeptics — one per area, batched, *not*
> a per-finding fan-out — judged 25 and **confirmed 13**. Every one of the 13 was in code that had already
> passed `typecheck`, `test`, `lint`, `boundaries` and a `--dry-run` bundle, and **three arrived by *removing*
> a line**: the served cadence stopped being in force, a failed first load became permanent, and the freshness
> cue could never fire because `refetchInterval` was the screen's clock as well as its fetch. Nothing here can
> see a deletion whose loss is a behaviour — and the seam-substitution harness least of all, because it pins
> `now` to a constant so two engines can be compared byte for byte, which is exactly why the clock needed a
> test of its own. Five of the 13 were in the shard, where **no rider could be affected because nothing can
> reach the object yet (WP5-6)** — which is equally why five of them shipped green. All 13 are closed; the
> decisions among them are ADR-056 decisions 13–19.
> **One of them was not a bug report but a product decision, and the owner took it:** a rider line is now
> identified by operator + number + direction **at one pole**, so a line boarding at two poles of a merged
> place keeps a row at each. That field is noise for KMB and Citybus and **identity for GMB** — two different
> number-20 services at Tai On Street, both circular so both "outbound", were one row, the second destination
> never shown, and where 20 was a pole's only route **the pole's whole group vanished from the list while its
> dot stayed on the map** (21 poles emptied in the 2026-07-27 build). The corpus had pinned the defect twice
> and argued both ways; one row is renamed and now pins the fix. Two costs were accepted rather than smoothed
> over, and both were carried forward with an owner: WP5-9 and WP5-10 below. **Both are now closed, and
> closing WP5-10 turned out to need two rules rather than one** (ADR-071): most of the pairs wearing identical
> headings were *one physical pole published twice*, which no label can fix. **WP5-9 (ADR-072) finished the
> thought the same night** — a reading is now keyed on the kerb too, so the two units the model was using for
> "an arrival" and "a row" are one unit.
> **Verified by running, in the review pass too:** `pnpm dev:edge` against the real KV state (`/v1/health`
> `"dataset":"kv"`, `datasetBuildsThisIsolate: 0`) with a Node WebSocket probe on `/v1/live` against the live
> HK feeds, showing the corrected re-echo on real data (`KMB:NOPE` accepted by the parser, then re-echoed out
> of the accepted set with `not_found` on the next round); the boarding-point fix measured against live
> upstream (GMB 68K publishing at both poles 11 s apart, and a pair flipping between "Kai Ham" and "Ho
> Chung"); and `wrangler deploy --dry-run` still resolving `EtaHub`. **Tested but not run:** the freshness-cue
> fix (`apps/mobile/test/live-clock.test.tsx`, both cases watched failing against the shipped code, no browser
> pass), the kernel's reconnect schedule and the accepted-set reader (corpus + unit only, and the field is not
> reachable from a screen yet), and the two poll-emulator fixes. **Every one of the 13 fixes was watched
> failing first**, which is the wave's standing rule and the only reason the assertions are worth anything.
> Previously: **Wave 4 — the proof** (PR #17, [ADR-068](./08-decision-log.md) · [ADR-069](./08-decision-log.md)):
> `apps/web` renders one screen from the identical kernel functions, and what it caught in the *first*
> renderer was the return on the wave — see *Next steps*.
> Previously: **Wave 3 is complete** on `wave3-native-enablement-v1` — WP3-1, WP3-2 and WP3-4 built in
> parallel (one agent and one git worktree each) and integrated one merge at a time, then WP3-3 last,
> deliberately, so it published a contract that already included the other three.
> **What Wave 3 is:** the two categories ADR-052 and ADR-060 did not cover — design values and UI strings —
> each got **one declaration generating committed artefacts**, and *the line* between server and client got
> written down and mechanically gated. `packages/ui/tokens.json` (122 DTCG tokens) replaces values that were
> hand-maintained in **four** places, and every one of the 26 CSS custom properties came out
> **byte-identical to `main`**; `packages/i18n`'s ICU catalogue (117 keys × 3 locales) generates
> `.strings`/`.stringsdict`/`strings.xml` and makes a hard-coded English literal a **compile error**
> (`TS2322`), closing the last Wave 1 defect — `1 stop`, not `"1 stops"` — through a plural rule rather than
> an English special case. A served **`ClientPolicy`** ([ADR-053](./08-decision-log.md)) collapses three
> arrival caps and **four** poll cadences into one number the edge owns, and `remarkKind` moved to the edge
> with the rule still declared once. Both codegen decisions are [ADR-054](./08-decision-log.md).
> **The payoff was a bug nobody had reported:** Favourites pre-sliced its ETA list to 4 *before* `StopRow`
> computed "+N more" as `total − shown`, so the sum was `4 − 4` and a place with nine saved routes showed
> four and said nothing about the other five. Deleting the slice fixed the cap and the affordance at once.
> **Three gates were found to be vacuous or nearly so**, each in a different way: `turbo` cached
> `@nextbus/ui:test` while its gate read a file outside the package's hash; `.gitignore` would have excluded
> the generated native artefacts, so the gate would have compared them only on the machine that made them;
> and the new literal rules fired on a stale `dist/` bundle, i.e. on yesterday's source. All three are the
> same failure — *a gate that passes because it is looking at nothing.* **WP3-3** then published the contract
> for a native repo ([ADR-067](./08-decision-log.md)): `packages/contract/README.md` written for someone
> starting an iOS or Android repo tomorrow, XCTest and JUnit conformance templates with the corpus wired in,
> a 7-test unknown-enum decode suite, and a gate that regenerates the README's figures and **rejects a cited
> path that is missing *or* gitignored** — which is how it caught its own near-miss, `packages/contract/native/`
> being silently excluded by the Expo `ios/`/`android/` patterns while present on disk. **Everything we cannot
> verify says so:** the Swift/Kotlin token artefacts and both test templates are **generated but never
> compiled**, and compiling them is the first native repo's job, not an inherited claim.
> Previously: **Wave 2 — domain extraction, WP2-1 … WP2-9**, all nine built in parallel and integrated one
> merge at a time.
> **What Wave 2 is:** the domain rules stopped living in screens. `dedupeRoutes`/`operatorsOf`/the pole
> comparator, the 120 s origin-bus suppression, `upcoming`, terminus-and-circular naming, the stop-name
> rules, Web-Mercator framing and `snapFix` are now `packages/core` modules pinned by corpus — **271
> branches at 100%, from 151** — so a Swift or Kotlin port has data to test against rather than a screen to
> read. Three of the nine were not moves: the favourite key scheme got a **versioned migration** that cannot
> silently lose a star ([ADR-062](./08-decision-log.md)), the search index's **order became data** — a
> precomputed `sortKey`, range scans instead of a trie, a content-hash `version` and an ETag
> ([ADR-063](./08-decision-log.md)) — and every edge error path got a **taxonomy bound to its status code**
> ([ADR-064](./08-decision-log.md)), which fixed a malformed id answering `502` where `400` is right.
> `RouteServiceInfo` is now **two named schemas** so a native client can tell "no timetable" from "wrong
> endpoint" ([ADR-065](./08-decision-log.md)).
> **Verified end-to-end, not just green:** `/v1/stop/NOTANID` → `400 bad_request retryable:false`,
> an absent-but-well-formed id → `404 not_found`, `/v1/index` → `ETag` then a **304 with an empty body**,
> a rebuilt dataset carrying `version: a8495d81…` and byte-sortable keys (`1`→`0001`, `10`→`0010`,
> `N260`→`N0260`), the route tier carrying 3 frequency profiles where the stop tier has no `patterns` key
> at all, and the app walked in a browser — the keypad narrowing `1` to A/M/P/S off range scans, a circular
> GMB route reading *"Circular via MacDonnell Road"*, and a 5-pole place framed with every dot on-screen.
> **One defect found doing it, and fixed** ([ADR-066](./08-decision-log.md)): a dataset flip did not
> invalidate `/v1/index`'s colo cache, so a publish was invisible for six hours and a revalidating client
> got a 304 confirming the stale copy. The cache key carries the build hash now. Every gate had been green —
> only a real rebuild-and-publish against a running Worker found it.
> Previously: **Wave 1 — the contract foundation, WP1-1 … WP1-5**
> ([ADR-051](./08-decision-log.md#adr-051--layered-package-boundaries-packagesports-is-declaration-only-and-imports-nothing) ·
> [ADR-052](./08-decision-log.md#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe) ·
> ADR-059 · ADR-060). `packages/contract` is the single declaration of every wire shape and `packages/core`'s
> types are `z.infer` of it through **`import type` only**, so zod never reaches the client's runtime graph;
> `packages/ports` is the porting checklist; the id grammar has one parser and an **empty** ad-hoc-parsing
> allowlist; `layers.json` generates both boundary configs; and a **331-case corpus at 100% branch coverage**
> pins the domain rules that no schema can generate. **Every gate was watched failing on an injected
> violation.** Two shipped bugs fell out of it — a bus could vanish from the route view, and `formatClock` read
> the device timezone. Next: **Wave 4** (the `apps/web` proof), then **WP3-3**;
> WP0-5/deploy is deferred on purpose (see *Next steps*).
> Four things changed, all of them load-bearing for launch. **(1) The dataset left the request path**
> ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path)): a daily GitHub Action precomputes content-addressed shards into KV + R2 and the
> Worker reads a handful of point keys — cold `/v1/nearby` went **3.97 s → 0.74 s**. `static-index.ts` and the Worker
> cron are **deleted**. **(2) The basemap is the HK Lands Department's** ([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)),
> proxied and self-cached by our own Worker behind a `TileSource` seam — **no OSM tile anywhere in the app**.
> **(3) The PWA works offline** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)): a Workbox service worker + a persisted TanStack
> Query cache, with live ETAs network-first (never cache-first — ADR-008). **(4) Live ETAs are coalesced per pole**
> on a 30 s TTL ([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole)), so one pole is fetched once per isolate per window however many
> riders ask. Also: `apps/edge` now has a **vitest suite that runs inside workerd** (18 tests; `apps/mobile` 17;
> root `pnpm test` runs both).
> ⚠️ **WP0-5 — deploy + CI + custom domain — is NOT done.** It needs a real domain and a Cloudflare account, and
> **there is no Cloudflare auth in this environment**: the KV namespace id in `wrangler.toml` is a placeholder and
> the publish pipeline has **never run against real remote KV/R2** (only Miniflare-local, verified end-to-end).
> It is the only thing between here and a live URL, but it is **deliberately not the next job** — owner's call,
> 2026-07-27: we launch after most of the other waves land. The nightly publish is disarmed until then
> ([ADR-061](./08-decision-log.md#adr-061--environments-and-configuration-topology-local--production-ephemeral-previews-and-no-staging-tier)).
> Earlier: **Green Minibus (GMB) — third operator**
> ([ADR-047](./08-decision-log.md#adr-047--green-minibus-gmb-a-third-operator-keyed-on-gtfsid-with-per-arrival-livescheduled-honesty)).
> GMB is now a v1 operator. Static geometry/fares/frequency come free from the consolidated dataset (one line in
> `CO_TO_OPERATOR`); a new `packages/data-normalize/src/gmb.ts` adapter fetches the live **stop board**
> (`data.etagmb.gov.hk/eta/stop/{id}`, one call per pole like KMB). GMB numbers repeat across regions, so routes are
> keyed on the globally-unique `gtfsId` (canonical `GMB:{no}:{bound}:{gtfsId}`); the edge resolves the live board's
> numeric `route_id`+`route_seq` back via a `gmbCanonicalByLive` map. Live-vs-**Scheduled** honesty rides the existing
> remark path (no new `Eta` flag). UI is data-driven — a green accent + `OPERATOR_LABEL` entry were the only UI edits;
> chips/Nearby/fare+frequency sheets lit up automatically. **Verified end-to-end on the edge** (etas, nearby, index);
> the app UI (`pnpm dev:web`) still wants an eyeball. **Gotcha for next time:** the GMB host 403s an empty
> `User-Agent` (Workers-runtime default) — the adapter sends one. Follow-ups in [docs/07](./07-backlog.md): friendlier
> "Minibus" label, a region tag in search, GMB route-level live ETAs (static-only today), GMB stop-merge edge cases.
> Earlier: **Route-detail direction toggle**
> ([ADR-046](./08-decision-log.md#adr-046--route-detail-direction-toggle-server-resolved-reverse-an-in-card-fromto-header-and-a-circular-route-treatment)) —
> a server-resolved `RouteDetail.reverse` (edge picks the opposite bound + service-type variant; absent for circular /
> one-way routes) drives an **in-card from/to header** whose reverse toggle flips direction *in place* (local state +
> `keepPreviousData` + prefetch → no skeleton), with a `GitCompareArrows` glyph, a lyrics-style name swap, a staggered
> list cascade, and bus tokens that slide down from the first stop. **Circular routes** (flagged `(CIRCULAR)` in the
> destination name) show a loop glyph + "Circular via <turnaround>" and no toggle. Verified on web (KMB 1 + KMB 10).
> Earlier: **Core navigation-animation system**
> ([ADR-043](./08-decision-log.md#adr-043--a-core-navigation-animation-system-cross-fade-tabs-slide-and-reveal-stack-web-swipe-back)) —
> rules centralised in **`lib/navTransitions.ts`** (+ the two `_layout`s), reduced-motion aware. **On web:** tab↔tab
> **cross-fade** (flash fixed by painting the theme bg on the tabs wrapper + `sceneStyle`) and a left-edge
> **swipe-back** gesture (`components/WebSwipeBack`). The **slide-in / reveal-on-back is native-only** (an instant cut
> on web for now): a JS stack *did* animate it on web but **broke `Animated.ScrollView` scrolling** inside its cards,
> so it was **tried and reverted** — we're back on the native `<Stack>` (scrolling/chrome/overlays solid). A
> `usePageRevealReady()` hook is wired for the route page's **two-step reveal** (mechanism only). **Known gaps
> (pre-existing / separate):** the route auto-scroll doesn't land on web, and `components/BottomSheet`'s slide-up
> entrance doesn't complete on web — both [docs/07](./07-backlog.md). Earlier: **Stop-detail enrichment**
> ([ADR-041](./08-decision-log.md#adr-041--stop-detail-a-collapsing-header-shared-with-route-a-keyless-static-mini-map-and-an-enriched-summary)) —
> the route header was generalised into a shared **`CollapsingHeader`** so Stop detail now collapses its name into the
> glass pill exactly like Route; a **keyless static `MiniMap`** (standard **OSM** raster tiles laid down as `<Image>`s
> — *the OSM tiles have since been replaced by LandsD, WP0-2/ADR-049; everything else here still stands* —
> **dark mode derived via a CSS `filter`** on the same tiles, white-haloed pin, no map lib/key, tap → platform maps)
> sits at the top; and a **"served by · N routes · distance"** summary + per-row **boarding fares** enrich it.
> *A deliberate first pass — to iterate (interactive MapLibre map, the route-at-stop star).*
> Earlier: **Route-detail design pass**
> (ADR-036 refinement) — the static service facts are now a wrapping **pill** row (fare framed **high → low**,
> frequency, service hours, stop count; **whole-route journey time hidden** — data kept); range dashes spaced
> ("10 – 25", "05:35 – 23:40"); per-stop **fare aligned to the name's top line**, with the **stop code inline**
> at the end of the name (wraps rather than overlapping the fare); `EtaTimes` shows the unit **per slot**
> ("4 min 20 min 32 min"); the **origin
> bus token** only appears ≤2 min before departure; and the consolidated-dataset fetch is repointed to its
> canonical host `https://data.hkbus.app/` (old gh-pages path now 301-redirects). Earlier: **Search is live**
> (**ADR-037**). The
> empty *Routes* tab is gone; search is now its **own page** (`app/search.tsx`, no tab bar) **pushed from a
> glass search button that shares the tab bar's row at the far right** (the bar fills the space to its left) —
> bottom tabs are now Nearby / Favourites / Settings. The route-header back lens is now a shared
> **`GlassIconButton`** (`BackButton`), reused by the search launcher and search's back button.
> A new edge **`/v1/index`** ships a compact route+stop index; the app caches it stale-while-revalidate (the
> first **on-device index**, ADR-007) and queries it locally. *(Since WP0-1 the index is read straight out of
> R2 — `builds/<hash>/search-index.json` — and the service worker gives it a second stale-while-revalidate
> layer, so search paints instantly and works offline.)* Header = back button left of a Routes/Stops
> segment (icon per item): a **smart keypad** (prefix-trie → only valid next keys lit, dead keys dimmed;
> letters in a compact scroll row above the pad) for route numbers, a
> text field for stop/place names (matches any locale), **extensible filter chips** (operator chips
> data-driven from the index so GMB/MTR light up automatically when added; Night/Airport/Express predicates),
> and recents. Earlier: **Fares · frequency · journey time · remarks** (**ADR-036**, proposals P1–P3) — we
> parse the `fares`/`faresHoliday`/`freq`/`jt` the consolidated dataset already gave us (and the `rmk_*` we
> already fetched) and surface them across Nearby/Stop/Route.
> A research dive + proposals also landed in [`docs/research`](./research/README.md) + [`docs/proposals`](./proposals/README.md).
> Earlier: **Nearby polish** (**ADR-034**) —
> route rows now show **`[chip] → destination`** (server-stamped `Eta.destination`), and a single shared
> **`StopName`** title-cases stop names + splits the muted operator code **everywhere** (Nearby, Favourites,
> route schematic, Stop-detail header). Earlier: **route-header refinement** built
> (**ADR-033** — no bar background; title morphs into a pill beside the back lens; frosted-not-lens glass over
> scrolling content). **Favourite route-at-stop** design recorded as **ADR-032** (not yet built).

## TL;DR
Scaffold, **Slice 1 (Nearby)**, the **design system** (fonts/type/elevation/themed nav + single **Ink**
theme, light/dark/auto), **Slice 2 (Stop · Route · Favorites · language picker)**, and **Citybus** are complete and
**verified end-to-end against live HK open data**. Nearby/stop/route are **multi-operator (KMB + CTB + GMB)**,
served **server-side** from **precomputed KV/R2 shards** built daily outside the Worker
([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path); the shards are still derived from the hkbus consolidated dataset — an own crawl
of the operator APIs remains backlog); live ETAs come direct from the official APIs, coalesced per pole
([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole)). Co-located stops are **merged into one same-kerb place**
([ADR-022](./08-decision-log.md) → [ADR-042](./08-decision-log.md)). The web build is an **installable PWA that
opens offline** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier)) on a **LandsD basemap**
([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay)).
**Waves 1–5 of [`proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md) are all complete**, so
the contract, the kernel, the native artefacts, the second renderer and the live protocol are in. Live ETAs
now arrive through `DataSource.watch()` on Place detail, from a poll emulator by default and from a sharded
`EtaHub` Durable Object over `/v1/live` when the socket engine is selected — which is now a single
environment variable, `EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT`, with the default still `poll`
([ADR-076](./08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll), WP5-6). Pick up at **WP0-5**: it is now genuinely the next job rather than a deferral, because
the cheap half (CI on every PR) has landed and the rest is a domain, a Cloudflare account and the settings
that follow — plus the Wave 5 follow-ups (WP5-4 … WP5-13), of which **WP5-4**, **WP5-5**, **WP5-6**,
**WP5-9**, **WP5-10** and **WP5-11** are ✅ **done** — one pole published twice is now one boarding point, two real poles get a compass
side ([ADR-071](./08-decision-log.md#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two);
the build hash moved to `1ccad7436a8df480`, so production needs a publish), and **an arrival is now identified
by a line at a kerb rather than a line at a place**, so both kerbs' rows carry their own bus
([ADR-072](./08-decision-log.md#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)), and — as of
2026-08-03 — **an upstream outage no longer reads as "no buses" on the arrivals path**: `coalesce` has lost
the `fallback` that caused it, `/v1/etas/:id` answers `{ etas, failed }` and both engines apply one kernel
retention rule to it ([ADR-073](./08-decision-log.md#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire)), bound by a corpus that drives the real Durable Object over a real
socket ([ADR-074](./08-decision-log.md#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines)), and the socket is selectable from the environment
([ADR-076](./08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll)). **WP5-13** then closed the last rider-facing hole those three left: `/v1/nearby` and `/v1/stop` can say
*"we could not ask"* now, so a card during an outage no longer reads as an empty stop
([ADR-077](./08-decision-log.md#adr-077--a-card-can-say-we-could-not-ask-and-a-failure-list-must-not-outlive-its-round)). **WP5-8** followed the same day
([ADR-078](./08-decision-log.md#adr-078--rule-7-is-enforced-per-commit-over-a-range-and-an-empty-range-is-a-failure)):
CLAUDE.md rule 7 is enforced per commit over a PR's range in CI, by the same predicate the `PreToolUse`
hook applies, and a range naming no commits fails rather than passing. **WP5-7** followed
([ADR-079](./08-decision-log.md#adr-079--one-request-per-round-the-batch-eta-endpoint-and-nearby-as-a-live-adopter)):
`/v1/etas?ids=…` answers a whole round in one request, so both Nearby renderers subscribe, and the two
frozen-clock/permanent-error defects that had been sitting on mobile Nearby are fixed with it. That leaves
**WP5-12** (the 2–10 m residual the clustering rules deliberately leave between them) and **WP5-14** —
both now done as well
([ADR-080](./08-decision-log.md#adr-080--what-tells-two-boarding-points-apart-in-the-order-the-data-can-support-it),
[ADR-081](./08-decision-log.md#adr-081--the-frames-carry-failed-and-a-round-whose-failure-set-moved-is-news)),
so **every numbered row of Wave 5 is closed**. **Wave 6 has begun** — [`proposals/04`](./proposals/04-platform-idiomatic-renderers.md),
the three-renderers plan — and its first row **WP6-0** is done: `apps/web` now has a shell (router,
persisted query cache, locale override, appearance, service worker, installable manifest) with **one ported
screen** and a named owner for each of the other seven destinations
([ADR-082](./08-decision-log.md#adr-082--the-web-shell-before-the-web-screens-a-router-over-a-declared-destination-set-and-one-pwa-policy-for-two-apps)).
`pnpm dev:dom` is that app; `pnpm dev:web` is still the Expo PWA, and **WP0-5 still ships the Expo PWA**.
**WP6-1 followed the same day** ([ADR-083](./08-decision-log.md#adr-083--a-component-spec-is-data-with-five-words-and-the-projection-is-what-pins-it)):
the **first component spec exists** — `packages/ui-spec` is the format (a schema + a conformance walker, no
domain vocabulary) and `packages/contract/ui/stop-row.spec.json` is the instance, emitted and drift-gated
beside `openapi.json`. **Both renderers drive it and neither component changed.** Next is **WP6-2**: Nearby's
own spec, which owns the three states a card cannot show alone and wires the taps.
WP0-5 (deploy) is Wave 0 and still needs a domain and
Cloudflare credentials from a human; it remains the launch blocker. **Before writing a test or a gate here, read
[`docs/05`](./05-monorepo-and-tooling.md#writing-a-test-or-a-gate-here-what-the-harnesses-require)** — the
gate chain's shared shape, which script polices which directory, the two `layers.json` facts that decide
where a test can live, and the five things about the workerd suite that will bite (chiefly: `coalesce`
holds a pole for 30 s so a round needs `resetEtaCache()`, and `caches.default` is reset between neither
tests nor files). All of it was established by reading the scripts and watching them fail, twice, because
none of it was written down. WP5-12 now owns two things it did
not: a rider who stars one line at **both** kerbs still sees one Favourites row, and at Fu Kin Street the two
kerbs' *names* differ ("outside" vs "opposite" Sin Sam House) where the printed code does not — a cheaper lead
than any in its own row.

## ✅ Done & verified
- **Monorepo:** pnpm + Turborepo + Biome; 8 packages; internal packages are source-only (no build step).
- **packages:** `core` (canonical types, `DataSource` seam, honest-ETA helpers) · `data-normalize`
  (KMB + Citybus ETA adapters · **multi-operator static index** from the consolidated dataset `dataset.ts` ·
  KMB bulk crawl `kmb-static.ts` kept for the future own-crawl) · `api-client` (`EdgeClient`, `watch()` as a
  real frame protocol over a pluggable transport — poll emulator · memory fake · WebSocket — and the shared
  location controller) · `i18n` (en / 繁 / 简 + `resolveLocale`) · `ui` (NativeWind preset + livery×mode themes + tokens) · `tsconfig`.
- **apps/edge:** `/v1/nearby`, **`/v1/stop/:id`**, **`/v1/route/:id`**, **`/v1/etas/:id`** (canonical),
  `/v1/index`, **`/v1/health`**, **`/v1/tiles/…`**, **`/v1/live`** (the WebSocket upgrade, served by the sharded
  `EtaHub` Durable Object — ADR-056), and the low-level `/v1/eta/:co/:stop/:route` —
  **multi-operator (KMB + CTB + GMB)** read through the **`DatasetSource` seam** (`dataset.ts`: precomputed
  KV/R2 shards in production, an in-isolate build as the dev fallback) + per-pole coalesced ETA fetch +
  edge cache. **No `scheduled` handler and no cron** — the daily build is a GitHub Action (ADR-055).
- **apps/mobile:** tabs shell · `QueryProvider` (**`PersistQueryClientProvider`** + AsyncStorage
  persister — ADR-058) · `LocaleProvider` (device detection + **persisted**
  override) · **Nearby** (live, tappable cards) · **Stop detail** `/stop/[id]` (**collapsing header + keyless static
  mini-map + served-by/route-count/distance summary**, live ETAs with boarding fares, route dedup, flat route rows —
  [ADR-041](./08-decision-log.md#adr-041--stop-detail-a-collapsing-header-shared-with-route-a-keyless-static-mini-map-and-an-enriched-summary)) ·
  **Route detail** `/route/[id]` (**vertical schematic line-strip** with per-stop times + moving
  bus tokens — [ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)) · **Favorites** tab · **Settings** (language +
  appearance + livery pickers) · components `CollapsingHeader` (shared by `RouteHeader`/`StopHeader`), `MiniMap`,
  `StopCard`, `EtaBadge`, `RouteChip`, `Fare`, `Card`, `Text`, `Skeleton`. *(The stop-level `SaveButton` was removed —
  favourites move to route-at-stop, [ADR-032](./08-decision-log.md#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes).)*
- **Verified:** `pnpm typecheck` 7/7 · live `/v1/nearby` · `/v1/stop` · `/v1/route` · `/v1/etas` return
  real data · **full Slice 2 flow walked in-browser** (Nearby→Stop→Route, save→Favourites, language re-localizes).
- **Design system realized** ([ADR-017](./08-decision-log.md)): **Inter loaded** (weight cuts +
  splash gate); **`<Text variant>`** typography primitive driving the docs/09 §3 scale (+ `text-*`
  utilities in the preset); **elevation** tokens + a **`Card`** primitive (shadow on light / surface-2
  on dark); **themed tab bar** via a new `useTheme()` hook + `themeColor()` resolver; operator-accent
  contrast text tokenized (no more raw hex in `StopCard`). All `apps/mobile` text migrated to `<Text>`.
- **Theme picker live** ([ADR-018](./08-decision-log.md)): **two-axis theme** — `themes[livery][mode]`,
  every livery (Classic/KMB/Citybus/CMB/Dot-Matrix/Split-Flap) in **light + dark**. **Settings screen**
  has an appearance segmented control (auto/light/dark) + livery list. Persisted via **Zustand +
  AsyncStorage**; splash gated on rehydration (no theme flash). **Verified in-browser**: switching
  either axis re-skins tab bar/cards/accents/surface-tint instantly; choice survives reload. Also
  verified `expo export --platform web` (Inter assets emitted) · typecheck 7/7 · Biome clean (only the
  pre-existing `ready!` / `@tailwind` warnings).
- **Slice 2 — Stop/Route/Favorites/Language** ([ADR-020](./08-decision-log.md)): KMB index extended with
  `stopById` + route origin/dest + ordered `routeToStops`; worker `/v1/stop`, `/v1/route`, `/v1/etas`
  (canonical) with a shared memoized index; **`getEtas` mismatch reconciled**. App: tappable Stop detail
  (live ETAs, rider-duplicate routes collapsed, favourite toggle), Route detail (ordered stops), Favourites
  (Zustand store, reuses theme persistence), Settings language picker (persisted, live re-localization).
  Fixed an etabus **3-concurrent-fetch 403** quirk (route fetched solo, then the pair, + backoff retry).
- **Citybus — multi-operator** ([ADR-021](./08-decision-log.md)): static layer for **KMB + CTB** now built
  from the hkbus **consolidated dataset** → `data-normalize/dataset.ts` (originally memoized in-Worker via
  `edge/static-index.ts`; **since WP0-1 that file is deleted** and the derivations are precomputed into KV/R2
  shards by `data-normalize/shards.ts`); `nearby`/`stop`/`route` dispatch ETAs per operator. **Verified in-browser/curl**:
  Central nearby = 4 CTB + 2 KMB with live ETAs; CTB stop/route detail render (yellow Citybus chip); KMB intact.
- **Same-kerb stop-merge** ([ADR-022](./08-decision-log.md)): our own cross-operator clustering
  (`data-normalize/dataset.ts` → `buildPlaces`; 30 m + landmark-name match, ≤1 member/operator) groups a
  shared KMB+CTB kerb into one `Place`. Merged stops reuse the canonical `Stop` (`sources[]` spans both
  operators); place id is self-describing `P:<id>+<id>`. `nearby` collapses, `stop`/`etas` fan out per
  operator. **Verified:** Central's "Jardine House" now one merged card; merged stop detail shows CTB(yellow)
  + KMB(red) routes with live ETAs in-browser; the distinct 10.8 m-apart "Alexandra House"/"The Landmark"
  correctly stay separate; single-stop + Favorites unaffected.
- **Route schematic line-strip** ([ADR-030](./08-decision-log.md#adr-030--route-view-as-a-vertical-schematic-line-strip-with-two-state-bus-tokens)):
  `RouteDetail.stops[]` now carries a per-stop `eta`, filled from KMB **`route-eta`** (every stop in one
  upstream call → `fetchKmbRouteEta`); `/v1/route/:id` moved onto the short live-ETA TTL (8 s then, **30 s
  since ADR-057** — at 8 s the cache hit rate was ~0% because upstream only refreshes ~1/min). The route page is a **vertical
  schematic** — fixed glass header (lens back button + RouteChip title + origin→dest subtext), seq-in-node
  rail, up to 3 upcoming times per stop, **two-state bus tokens** (`inferBusMarkers` in `@nextbus/core`,
  drop-off detection), and **auto-scroll** to the opened-from stop. CTB stays static-only (no bulk
  route-eta). **Verified in-browser** against live route 1: 25/25 stops with ETAs, tokens on arriving
  stops, auto-scroll lands on the origin stop; typecheck 7/7, Biome clean.
- **Design Workbench + app icon** (branch `design-workbench`, uncommitted): a dev-facing
  **`/workbench`** route (`apps/mobile/app/workbench.tsx`) — a live gallery of the type scale, colour
  tokens, radius/elevation, and every component in each state, driven by the real theme store (the
  "mockup system" for revising components + the rules in `docs/09`). **App icon** finalized: a
  road-sign side-profile double-decker, white-on-ink, −8° lean, centred round wheels — master
  `apps/mobile/assets/icon.svg`, assets via `scripts/gen-icons.mjs`, wired in `app.json` (incl. iOS
  light/dark/tinted), `BRAND.ink` token added. Verified: icon rasterizes correctly, web export emits
  the favicon, `expo config` validates. Deferred (needs the name): 巴士 wordmark/splash lockup.
- **Lucide icons** ([ADR-025](./08-decision-log.md)): `lucide-react-native` (+ SDK-pinned `react-native-svg`)
  behind one **`<Icon icon tone>`** primitive (`apps/mobile/components/Icon.tsx`) — `tone` is a semantic
  role resolved via `useTheme().color()`, so icons follow the livery/appearance. In use: **tab-bar icons**
  (MapPin/Route/Star/Settings), optional `Button` icon, stop-heading
  `ChevronRight`; Workbench has an ICONS gallery. **Verified in-browser** (icons re-theme on livery+mode switch).
- **Nearby is a flat list, not cards** ([ADR-026](./08-decision-log.md)): new **`StopRow`** replaces
  `StopCard` (deleted) — full-bleed, hairline dividers, heading = name + `MapPin` + "{distance} · {n} min
  walk" + chevron. Surfaces `NearbyStop.distanceM` (was unused) via new pure `@nextbus/core/geo` helpers
  (`formatDistance`/`walkMinutes`/`formatWalk`, distance rounded — ADR-008 honesty). Nearby sorts by
  distance; Favorites reuses `StopRow` (distance hidden). **Verified in-browser against live data.**
- **Floating tab bar** ([ADR-027](./08-decision-log.md)): the tab bar is now a `position:absolute`
  rounded **pill** (side + bottom margins, full border on dark / `e3` shadow on light) that **content
  scrolls underneath** — a new "layered & immersive" design principle (docs/09 §1). Geometry centralized
  in `apps/mobile/lib/tabBarLayout.ts` (`useTabBarLayout()` → safe-area `bottom` offset + `contentInset`);
  Nearby/Favorites/Settings pad their scroll content by it. Also fixed a label-descender clip (bar padding
  was shrinking the icon+label item). **Verified in mobile-emulation, light + dark.**
- **Liquid-glass material + Ink livery** ([ADR-028](./08-decision-log.md)): new **`GlassView`** primitive
  (`apps/mobile/components/GlassView.tsx`) — a translucent pane whose tint follows the appearance + active
  livery. On **web** it does **true SVG refraction**, **ported from nikdelvin/liquid-glass**
  (`apps/mobile/lib/liquidGlass.ts`): a smooth vector-SVG displacement map (gradients + blurred
  neutral-centre mask → soft rim, no pixelation) in a data-URI filter (3-pass chromatic aberration, `sRGB`)
  applied via `backdrop-filter: blur() url('…#displace') brightness() saturate()`. **Chromium-only**
  (Safari/Firefox → frosted `blur()`); **native** → `expo-blur`. Props: `depth`/`strength`/`blur`/`chroma`;
  `lens` = magnifier vs. subtle panel glass. Backs the **floating tab bar**; shown in the Workbench GLASS
  section. New **Ink** livery (`themes.ts` + `liveryInk`): ink-on-paper (light) / deep ink + indigo accent
  (dark). iOS-26 true Liquid Glass (`expo-glass-effect`) stays a deferred drop-in. **Verified in Chrome
  (Ink, light + dark):** bus chips scroll under the tab bar with a clean frosted transition (the earlier
  "white box"/pixelation is gone); lens magnifies the chips behind it.
- **Theming simplified to one Ink theme** ([ADR-029](./08-decision-log.md)): **retired the multi-livery
  axis** (Classic/KMB/Citybus/CMB/Dot-Matrix/Split-Flap). Now a single **Ink** theme in **light/dark/auto**
  (appearance only) — a monochrome "ink & paper" system: accent = ink on light, **paper on dark** (replaced
  the old indigo-on-deep-slate dark). `themes` is `Record<Mode, ThemeVars>`; `LiveryId`/`LIVERIES`/
  `DISPLAY_LIVERIES` removed; `preferences` drops `livery`; Settings/Workbench livery pickers + i18n
  `livery*`/`settingsTheme` removed; `global.css` resynced. **Verified in Chrome (light + dark).**
- **Route header refinement** ([ADR-033](./08-decision-log.md#adr-033--route-header-no-bar-background-title-morphs-into-a-pill-beside-the-back-lens)):
  `RouteHeader` dropped its full-width glass bar — the chrome now floats over scrolling content. A big
  **centred badge over `A → B`** at the top **morphs** on scroll into a **glass pill beside the back lens**
  (single travelling/scaling badge; the route label cross-fades centred-below → inline; pill glass fades in).
  Back lens + pill use a **frosted, zero-chroma** glass (not the `lens` magnifier) so high-contrast stop text
  scrolling underneath doesn't refract into rainbow fringing. Also fixed a **backdrop-filter isolation** bug —
  the pill's fade opacity had to move off a wrapper onto the `GlassView` root (now an `Animated.View`), or an
  opacity-<1 ancestor isolated the blur and it flickered on/off during scroll. **Verified in-browser**
  (expanded, mid-morph, collapsed at phone width; DOM-confirmed blur present across the fade); typecheck 7/7,
  Biome clean.
- **Fares · frequency · journey time · remarks** ([ADR-036](./08-decision-log.md), proposals P1–P3): the
  consolidated dataset's `fares`/`faresHoliday`/`freq`/`jt` are now parsed (`data-normalize/dataset.ts` →
  `RouteServiceInfo` + sectional `routeFareAtSeq`) and threaded through `/v1/nearby` · `/v1/stop` · `/v1/route`
  (boarding fare per stop, route full-fare/journey/frequency/hours). New `Fare`/`RemarkTag`/`RouteMeta`
  primitives; the parsed-but-unshown `Eta.remark` now renders (`classifyRemark` tints "Scheduled" as
  lower-confidence); Stop detail shows "every N–M min" for no-ETA routes. **Verified against the live worker**
  (route 1 → fare $6.7, ~45 min, every 10–30 min, 05:35–23:40; Nearby/Stop boarding fares); typecheck 7/7, Biome clean.
- **Research + proposals docs** (2026-06-10): a deep dive into all HK bus open data, our feature inventory/gaps,
  competitive analysis, and data-display ideas in [`docs/research`](./research/README.md); fast-win + bigger-bet
  proposals in [`docs/proposals`](./proposals/README.md). Key facts: no live GPS / no GTFS-RT / no route polylines in HK open data.
- **Search — its own page** ([ADR-037](./08-decision-log.md#adr-037--search-on-device-index-a-smart-route-keypad-and-extensible-filter-chips)):
  edge **`/v1/index`** (`apps/edge/src/search-index.ts`) ships a compact `SearchIndex` (2002 routes collapsed to
  one per operator+number+direction, 8126 stops with 1179 same-kerb places pre-merged, ~2 MB) off the shared
  memoized static index. New `DataSource.getSearchIndex()` (`EdgeClient`); the app caches it in AsyncStorage
  stale-while-revalidate (`apps/mobile/lib/searchIndex.ts`) — the first **on-device index** (ADR-007). Pure
  search/keypad logic in **`@nextbus/core/search`** (`buildRouteTrie`/`nextValidChars`/`searchRoutes`/
  `searchStops`/`routeCategories`). UI: a standalone **`app/search.tsx`** (no tab bar) pushed from a **floating
  search button** in `app/(tabs)/_layout.tsx` (Routes tab removed → tabs are Nearby/Favourites/Settings);
  header = back button + Routes/Stops segment; **`RouteKeypad`** (trie-driven valid-next-key lighting; letters
  in a scroll row above the pad), stop text search (any-locale), **`FilterChips`** (operator chips data-driven
  from the index; Night/Airport/Express predicates), recents (`preferences`). **Verified:** live `/v1/index`
  returns 2002/8126; keypad/category logic checked against real numbers (79 night, 93 airport, 137 express;
  `next("")`=digits+start-letters, `next("26")`=`0,1,3,4,5,7,8,9,M,X`). typecheck 7/7, Biome clean.
  *Not yet walked in-browser (visual pass pending).*
- **About section: "About the data" + "FAQ"** ([ADR-038](./08-decision-log.md#adr-038--about-the-data-screen-open-data-attribution--honesty-notes), proposals P10):
  two new no-tab-bar screens (shared `BackButton` glass lens), reached from an **About** section in Settings.
  **`app/about-data.tsx`** — **full-width rows (not cards)**: a **Sources** group of tappable **link rows**
  (DATA.GOV.HK / KMB·LWB / Citybus) that open the source in a **new tab** (`lib/openExternal.ts`) with an
  external-link icon, a **Licence** link row to the locale-aware **data.gov.hk terms**, and the app **version**
  (`expo-constants`) — satisfying the launch-blocking attribution requirement. **`app/faq.tsx`** — an
  **accordion** (collapsed by default, no dividers; tap to expand) owning the **freshness/honesty notes** plus a
  broader rider set: operator coverage, same-kerb merges, offline, no-live-map (no HK GPS/polylines), and what
  "Scheduled"/"Last bus" remarks mean. Trilingual strings in `@nextbus/i18n`. typecheck 7/7, Biome clean.
  *(The **offline** answer — `faqOfflineA` — predates ADR-058 and now **understates** what the app does: the
  shell opens offline and the last-seen arrivals replay, labelled stale. Refresh the three locale strings.)*
  **Verified in-browser** (all three screens render; FAQ expand/collapse works; Settings → both rows).
- **Precompute → KV/R2: the dataset leaves the request path** ([ADR-055](./08-decision-log.md#adr-055--content-addressed-precompute-to-kvr2-the-dataset-leaves-the-request-path), WP0-1):
  the Worker no longer builds the 8.3 MB index in-request. A **daily GitHub Action**
  (`.github/workflows/dataset.yml` → `apps/edge/scripts/build-dataset.mts` + `publish-dataset.mts`) does the
  fetch, the normalization and the ADR-042 clustering, then writes **content-addressed** shards — KV
  `place:<hash>:<id>` · `alias:<hash>:<stopId>` · `route:<hash>:<id>` · `geo:<hash>:<cell>`, R2
  `builds/<hash>/search-index.json` + `manifest.json` — and flips the single mutable **`build:current`** key
  **last**, so a half-written crawl is unreachable and a rollback is one key write. Every endpoint reads
  through the new **`DatasetSource`** seam (`apps/edge/src/dataset.ts`), which has a KV implementation and an
  in-isolate fallback so `pnpm dev:edge` still needs no remote state. Shard shapes are pure functions of a
  `StaticIndex` in **`packages/data-normalize/src/shards.ts`**, so the publisher and the fallback agree by
  construction. **`GET /v1/health`** returns `{ok, dataset:'kv'|'inline', buildHash, datasetBuildsThisIsolate}`
  — that counter must be **0** in production, and `apps/edge/test/dataset-kv.test.ts` sweeps every endpoint
  against a seeded build and asserts it. **Measured:** cold `/v1/nearby` **3.97 s → 0.74 s**, warm **6 ms**;
  the build emits **10,118 places · 6,351 aliases · 3,653 routes · 486 cells** (14,072 stops), ≈**20.6k KV
  keys**. **Wire change worth knowing:** `/v1/stop/:id` returns route `service` **without `patterns`**
  (summary tier — `fareFull`/`journeyMin`/`headway`/`hours`); `/v1/route/:id` keeps the full per-day-type
  profiles. Duplicating `patterns` into every place a route touches was **54 MB of an 82 MB build** and
  nothing on the Place screen reads it. **Deleted:** `apps/edge/src/static-index.ts`, the Worker `scheduled`
  handler, and `[triggers] crons`. **New:** `apps/edge/src/{dataset,env,tiles,eta-cache}.ts` + `bindings.d.ts`.
  **Not done:** the shards are still derived from the hkbus consolidated dataset (own crawl = backlog); the KV
  namespace id in `wrangler.toml` is a **placeholder**; the pipeline has **only ever run against
  Miniflare-local KV/R2** (verified end-to-end there), never real remote resources — no Cloudflare auth here.
- **Basemap → HK Lands Department** ([ADR-049](./08-decision-log.md#adr-049--the-basemap-is-the-hk-lands-departments-self-cached-with-labels-as-a-per-locale-overlay), WP0-2 — the decision was recorded 2026-07-26 and is **now implemented**):
  `components/MiniMap.tsx` names **no tile host**. It goes through **`apps/mobile/lib/tileSource.ts`** (a
  `TileSource` interface + `landsdTileSource`) to our own Worker routes **`/v1/tiles/basemap/:z/:x/:y.png`**
  and **`/v1/tiles/label/:lang/:z/:x/:y.png`** (`apps/edge/src/tiles.ts`, 12 h TTL, deliberately overriding
  LandsD's `cache-control: private` so a shared cache can actually work — caching is expressly permitted by
  the CSDI licence). Two raster layers stack: a **language-free basemap** plus a **label overlay chosen by
  `useLocale()`**, so switching language relabels the map with no restyling. Attribution obligations are
  satisfied — a self-hosted `apps/mobile/assets/landsd-logo.png` on the map face plus a **linked** "Map from
  Lands Department" notice (the mistake the old plain-text OSM credit made). The two pre-migration fixes the
  backlog asked for are **moot**: the OSM credit is gone and there is no `TILE_URL`. Dark mode still uses the
  CSS invert filter (`TileSource.invertForDark`) — LandsD's raster service has no dark variant.
  **Verified in the running app** on a multi-pole Mong Kok place.
- **Service worker + offline PWA** ([ADR-058](./08-decision-log.md#adr-058--offline-is-a-service-worker-a-persisted-query-cache-and-a-remembered-fix--not-a-new-data-tier), WP0-3): new
  `apps/mobile/workbox.config.mjs` + `apps/mobile/scripts/build-web.mjs`, run as
  **`pnpm --filter @nextbus/mobile build:web`** (`expo export -p web` then `generateSW` over the output — one
  command, because a precache manifest generated against a different build is worse than none).
  `lib/serviceWorker.ts` registers `/sw.js` on **production web only** — never in dev, where a stale worker
  intercepting Metro is a genuinely nasty bug. Strategies: **precache** the hashed app shell (**59 files,
  ~10.6 MB**); **`/v1/index`** stale-while-revalidate; **live ETA endpoints network-first with a 4 s timeout**
  (never cache-first — a bus that left four minutes ago is worse than no answer, ADR-008); **tiles**
  cache-first and **never prefetched**. `providers/QueryProvider.tsx` is now a **`PersistQueryClientProvider`**
  over an AsyncStorage persister (24 h, **successes only**). `snapFix` (**25 m** grid) — **WP2-6, landed
  early** because the offline acceptance needs a stable query key, and moved into
  **`packages/core/src/geo-snap.ts`** by Wave 2. `lib/useLocation.ts` remembers the last fix and returns `stale: true`
  when it uses it; Nearby then shows the new `lastKnownLocation` string instead of the app name.
  **Verified:** with **both** the static server and the edge Worker killed, a cold load of `/search` opened
  the app and searched from cache, and `/v1/nearby` was replayed from the SW cache **with its original
  `observedAt` intact**. **Not verified:** the Nearby *screen* offline — Chrome's geolocation in this
  environment resolves outside Hong Kong, so the **data path** was verified instead of the screen.
- **Per-pole ETA coalescer + 30 s TTL** ([ADR-057](./08-decision-log.md#adr-057--live-eta-ttl-is-30-s-and-every-upstream-call-is-coalesced-per-pole), WP0-4): new
  **`apps/edge/src/eta-cache.ts`** — an isolate-level cache keyed per *upstream call*, so a pole is fetched
  **once per 30 s per isolate** no matter how many concurrent requests want it, and the second caller awaits
  the first caller's promise rather than opening a connection (the fan-out is throttled by a
  6-simultaneous-connection ceiling, so a duplicate call displaces a real one). **Failures are not cached** —
  the entry is evicted and the caller gets a fallback, so an upstream blip degrades a card instead of erroring
  a screen. **`ETA_TTL_SEC = 30`** replaces the old 8 s (ETAs) and 10 s (nearby): at 8 s the hit rate was ~0%
  because upstream only refreshes ~1/min. The KMB bulk `route-eta` feed is coalesced too.
  **`apps/edge/test/eta-coalescing.test.ts`** proves `/v1/nearby` at a 20-pole coordinate issues *exactly*
  distinct-pole-count upstream calls, and that two concurrent requests issue one set.
- **Tests: there is a suite now.** `apps/edge` runs **`@cloudflare/vitest-pool-workers`** — real workerd with
  simulated KV/R2. As of Wave 2 that is **48 tests** across `dataset-kv` · `eta-cache` · `eta-coalescing` ·
  `tiles` · `search-index` · `wire-conformance`; `packages/core` has **525** (the corpus) and `apps/mobile`
  **12** (the preferences migration — its `stopName` and `geoSnap` suites became corpus rows when those
  modules moved to `core`). Root **`pnpm test`** runs all three, and
  `.github/workflows/dataset.yml` runs typecheck + tests *before* it is allowed to touch KV.
  **Gotcha worth remembering:** root `package.json` now pins `pnpm.overrides.esbuild = "0.27.3"`. `.npmrc`
  sets `node-linker=hoisted`, so wrangler's exact-pinned esbuild and vitest's newer one fought over the single
  hoisted platform binary and `wrangler dev` died with
  `Host version "0.27.3" does not match binary version "0.28.1"`.
- **Upstream data bug found while precomputing every route:** the consolidated dataset declares `serviceType`
  as a string, but a minority of entries carry a **number**, which crashed `localeCompare`.
  `packages/data-normalize/src/dataset.ts` now coerces with `String(...)`. The old per-request path had only
  ever touched the string-typed majority — precomputing *everything* is what surfaced it.
- **The wire contract — WP1-1** ([ADR-052](./08-decision-log.md#adr-052--the-wire-contract-zod-is-the-single-declaration-types-erase-and-the-schema-stays-additive-safe)):
  new **`packages/contract`** holds the Zod schemas that are the **single declaration** of every shape crossing
  the network (`src/wire/{primitives,stop,route,eta,detail,search,responses}.ts`), plus the OpenAPI 3.1
  assembly (`src/openapi.ts` → committed **`openapi.json`**, 6 paths · 28 component schemas). No
  `zod-to-openapi`: OpenAPI 3.1's Schema Object *is* JSON Schema 2020-12, which Zod 4 emits natively.
  `packages/core/src/types.ts` + the three search shapes are now **`z.infer` re-exports imported with
  `import type`**, so `types.js` emits `export {};` and **zod never enters the client bundle** — `core`'s
  runtime dependency list stays empty, which is what keeps it hand-portable to Swift/Kotlin.
  **The one decision that makes the schema adjustable** is `WIRE_JSON_SCHEMA_OPTIONS` in
  `src/json-schema.ts`: it strips `additionalProperties: false` from the emit, so adding an optional field is
  a deploy rather than a migration — otherwise a strict generated decoder on an already-installed phone would
  reject any payload containing a field it didn't know. Closed enums carry `x-unknown-tolerant` so a fourth
  operator can't brick deployed clients. **Three gates, each verified to fail on an injected violation:**
  the type-only boundary check (`packages/core/scripts/check-type-only-contract.mjs`), the response-conformance
  suite (`apps/edge/test/wire-conformance.test.ts` — asserts responses satisfy their schema **and carry no
  undocumented field**), and the OpenAPI staleness check
  (`packages/contract/scripts/check-openapi-current.mjs`). All three run under `pnpm test`.
  **Verified:** typecheck 8/8 · **22 edge + 17 mobile tests + both script gates** · Biome clean (only the 7
  pre-existing findings) · **`apps/mobile` diff vs `main` is empty**, the WP1-1 acceptance criterion.
  **The conformance gate found a real bug on its first run:** `/v1/nearby` used
  `Number(url.searchParams.get('lat'))`, and `Number(null)` is `0` — so a request with *missing* coordinates
  was served as 0, 0 and returned an empty list with a **200** instead of a 400. Fixed.
  **Known-wrong-but-faithful** (left alone deliberately; WP1-1 changes no shapes — see ADR-052): errors are
  `{error}` not `{code, message, retryable}`, and `Route.service` is served at two fidelities under one type.
- **Wave 1 complete — WP1-2 · WP1-3 · WP1-4 · WP1-5** (ADR-051 · ADR-059 · ADR-060), built by four agents in
  parallel worktrees and integrated one at a time:
  - **`packages/ports`** — the six platform seams (`KeyValueStore`, `LocationProvider`, `LocaleProvider`,
    `LinkOpener`, `Clock`, `TileSource`) as **declaration-only** interfaces; `ls packages/ports/src` is the
    iOS/Android porting checklist. Imports nothing, so ports take domain types as *type parameters* —
    `TileSource<LocaleId, ImageAsset>`. `apps/mobile/lib/tileSource.ts` now **binds** the port rather than
    re-declaring it, so the compiler checks the equivalence. **Nothing is wired to the other five yet** — that is
    Wave 2/3, one adapter at a time.
  - **The id grammar** — one parser in `packages/core/src/ids.ts` (not in `contract`, because `core/src/eta.ts`
    needs it and ADR-052's type-only gate forbids that edge at runtime); ABNF + a 60-row corpus in
    `packages/contract/src/ids/`. The plan listed **8** ad-hoc parse sites; a grep found **12**. All drained —
    **the allowlist is empty** — and the gate is keyed on file + snippet, not line numbers, which had already
    drifted.
  - **The boundary engine** — `layers.json` is the single declaration, generating both the dependency-cruiser
    ruleset and `biome.json`'s overrides, with drift gated. **13 injected violations, every gate fires**,
    including the two transitive cases. Two tools because neither suffices: the cruiser sees paths, `import type`
    and reach; Biome is textual and catches platform globals that need no import.
  - **The fixture corpus** — `@spec <module>#<export>` + `scripts/check-spec-coverage.mjs`, **36 rules, 274
    language-neutral JSON cases, 100% branch coverage gated**, both rot directions checked, 18 named boundary
    rows asserted by name. This is the equivalence mechanism for the *hand-ported* half that no schema can cover.
  - **Two real bugs fixed as a result.** `formatClock` used `toLocaleTimeString`, whose output depends on the
    host ICU build *and the device timezone* — a rider abroad saw their own local time on a Hong Kong board; now
    computed arithmetically from a fixed HK offset, and the kernel bans the `toLocale*` pattern. And
    **`inferBusMarkers` could drop a bus entirely** — a stale departed reading acted as its successor's
    predecessor, so a bus one minute away vanished from the route view; departed readings are now discarded
    before the discontinuity scan. Six further defects are recorded as `knownDefect` corpus rows.
  - **Verified:** typecheck 9/9 · 22 edge + 88 mobile + 282 core · 4 script gates · 13 boundary self-tests ·
    100% `core` branch coverage · Biome at the 7 pre-existing findings. WP1-2 also drove the Worker by `curl`
    and walked the PWA in a browser.
- **One pole published twice is one boarding point; two real poles get a compass side** — **WP5-11 + WP5-10**,
  both 2026-07-31 on `wave5-followups-v1`
  ([ADR-071](./08-decision-log.md#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)).
  `foldDuplicatePoles` + `SAME_POLE_MAX_SEPARATION_M` = **2 m** (`packages/data-normalize/src/dataset.ts`)
  fold a cluster's poles onto **boarding points** where a rider could not possibly tell them apart — same
  operator, the same name in **all three locales**, complete-linkage separation ≤ 2 m; the other id rides the
  wire as `StopDetailPole.aliasIds` and stays a valid favourite key **for ever**. `poleSideOctants` +
  `POLE_SIDE_MIN_SEPARATION_M` = **10 m** (`packages/core/src/stop-detail.ts`) put a **compass side** on a
  heading — "Citybus · North side" / 「九巴 · ND126 · 東面」 — but **only** where two poles of one place print
  the same text and sit far enough apart for a side to mean something; `core` returns the octant and
  `@nextbus/i18n`'s eight `poleSide*` keys supply the word (ADR-054). `initialBearingDeg` moved out of the
  pipeline into `packages/core/src/geo.ts`, **verified bit-identical over 18 430 real coordinate pairs**
  before the switch, because those bearings feed the clustering spread cap.
  **Effect on the rebuilt build `1ccad7436a8df480`:** 80 poles folded across 75 places, members 6 354 →
  6 274, duplicate pole headings **567 → 496 places**, 226 places gaining a side and 9 892 rendering exactly
  as before — while `placeByStopId` keeps **6 354** keys, so **not one id stopped resolving**. TN507
  (22.88 m), TN581 (19.01 m) and ND126 (35.35 m) provably stay two members. Tests **977** (core 768 · edge
  106 · api-client 47 · mobile 36 · web 20); corpus 86 groups · 726 cases · 3 `knownDefect`; `core` still
  100 % on all four thresholds.
  - **Driven, not merely tested.** `pnpm dataset:build` → `pnpm dataset:publish --local` → `pnpm dev:edge`
    with `/v1/health` reporting `"dataset":"kv"`, `"buildHash":"1ccad7436a8df480"`,
    `datasetBuildsThisIsolate: 0` (the ADR-055 production invariant). Then in a browser against that Worker:
    **Peaksville** two Citybus poles that both read bare "Citybus" now read **North side / South side** and
    the map dots agree; **Cheerful Park** reads **"KMB · ND126 · East side"** (20 routes) and **"· West
    side"** (W3) while "Citybus" and "KMB · ND127" are untouched, and in 繁體中文 「九巴 · ND126 · 東面」/
    「· 西面」; **Tin Shui Wai Park** now prints **three** headings where it printed four, with **269D once**,
    live at 2 min. Locale switched through the app's own Settings picker, never by poking a store; console
    clean.
  - **The favourites proof, stated concretely because it is the requirement that outranked the feature.**
    Read the **real** `localStorage['nextbus.preferences']` (12 genuine favourites present),
    **read-modify-write** appended `KMB:FADDB1E247E62936|KMB:106:inbound:1` — a key on a pole this change
    **merged away** — opened `/favorites`, and the card rendered **A Kung Ngam Road, Chai Wan Road** with
    **`106 → Wong Tai Sin  7 min`** under it. Then removed the two test keys the same way and confirmed the
    rider's **12 favourites are back exactly as found**. Backed at three lower levels too: `allAliases` derived from
    `placeByStopId` (6 354 keys), `apps/edge/test/pole-merge.test.ts` resolving `/v1/stop/<folded id>` for
    **both** ids of the folded pair inside workerd, and `curl` showing 11 of 11 readings matching a row
    (**0** matching none) plus a `/v1/live` delta carrying the folded pole's id.
  - **Tested but not driven:** the four `pole-merge` assertions that pin the id-spelling rule (they run the
    real kernel merge over real Worker responses in workerd, one set of readings off a real `/v1/live`
    socket, and **all four were watched failing** against the pre-fix tree — including the merge returning
    `undefined` for a route boarding only at the folded pole), and the two `poleSideOctants` guards, watched
    failing by building the rule without them.
  - **The measurement is the finding, and it rewrote its own work package.** WP5-11 assumed a distance gap
    between "one pole published twice" and "two genuine berths": **516** same-operator same-name member pairs
    run **continuously 0 → 31 m**, the two-berth stands sit *inside* that continuum, and route-disjointness
    discriminates nothing (**24 of 464 overlap**, 8 of them in the nearest band). So the row's original
    acceptance — *"no place shows two identical headings"* — is unachievable, and it was **reworded with the
    work stopped** rather than quietly failed after shipping.
- **An arrival is a line at a kerb, not a line at a place** — **WP5-9**, 2026-07-31 on `wave5-followups-v1`
  ([ADR-072](./08-decision-log.md#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)).
  `dedupeEtas` keys on **`operator|routeNo|bound|stopId`** (`etaBoardingKey` = `etaLineKey` + the pole, both
  exported from `@nextbus/core`), so a line boarding at two poles of a place publishes **one reading per
  pole** on `/v1/etas/:id`, on `/v1/nearby` and in the `EtaHub` frames. Two service-type variants at *one*
  kerb still collapse to the soonest (Citybus 969 is listed three times at one pole) — nobody chooses a
  timetable variant and everybody chooses a kerb, which is one rule seen twice rather than two. `/v1/stop/:id`
  now builds rows with `eta: null` and calls **`applyLiveEtasToStopDetail`**, so the HTTP payload and the live
  merge are **one rule** where there had been two that must agree; a row with no exact `(pole, routeId)` match
  takes the soonest reading for its own line **at its own pole**, and the fallback never crosses a kerb, so
  `row.eta.stopId === row.stopId` is structural rather than a fixture's luck. `stopCardView` collapses back to
  one row per line **before** the cap, because a compact card has no kerb heading and `NearbyStop.routeCount`
  counts rider *lines*. Additive per ADR-052 §5: no field added or removed, only an array's cardinality, plus
  four descriptions that now say so. Tests **1 008** (core 785 · edge 116 · api-client 47 · mobile 38 · web
  22, from 977); corpus 88 groups · 742 cases · 19 named boundary rows; `core` still 100 % on all four
  thresholds. **The build hash does not move** (`1ccad7436a8df480` reproduced byte for byte), so no publish.
  - **Driven in a browser and against live feeds.** **Fu Kin Street** (`/stop/P:GMB:20015724+GMB:20015749`,
    where GMB 68K really does board at both kerbs): **before**, the first kerb's 68K row printed *"every
    7 – 9 min"* — the **static timetable band, i.e. no arrival at all** — while the second kerb read **3 min**;
    **after**, the two rows read **9 min** and **4 min** (*Scheduled*), both real. Post-fix `/v1/etas` carries
    `GMB:68K:outbound:2007762 @ GMB:20015724` **and** `…:2007765 @ GMB:20015749`, and over **all 37** places
    with a two-pole line `/v1/stop` has **0** rows whose reading names another pole (**1 before** — a row at
    `GMB:20001114` holding a reading stamped `GMB:20009421`, Hiram's Highway opposite Marina Cove: a bus shown
    at a kerb it was not coming to *and* nothing at the kerb it was). The compact card was rendered from the
    running worker's `/v1/nearby` and printed `68K → Julimount Garden 3 min` with **"+1 more"** (the hidden
    line being 68S, which had no reading) — truthful in both halves. Favourites was exercised the same way as
    ADR-071's proof: read-modify-write on the **real** `localStorage['nextbus.preferences']` (12 genuine
    favourites), keys appended on **both** kerbs, then the original 777-byte string restored **verbatim** and
    confirmed. Payload measured pre/post against live feeds ~90 s apart with a cache-busting query and a
    `dataTimestamp` fingerprint, the pre-fix tree confirmed live before each pair: **`/v1/etas` unchanged at
    all eight heaviest interchanges** (Victoria Park's 113 lines have no line at two poles), and the growth is
    on `/v1/stop` from the variant fallback — **+942 B on Victoria Park's 58 kB**, **+1.1 %** over 13 places.
    `pnpm dataset:build` reproduced `1ccad7436a8df480`; `/v1/health` held `"dataset":"kv"` with
    `datasetBuildsThisIsolate: 0` throughout (local only, never remote).
  - **Tested but not driven:** the 10 assertions in `apps/edge/test/eta-per-pole.test.ts` (Tin Shui Estate with
    the Marina Cove board on its second pole, through `fetchConsolidatedIndex` → a seeded KV build in workerd →
    `worker.fetch`, its live-merge cases reading off a **real `/v1/live` socket through the real `EtaHub`**) —
    **6 of them watched failing** against the pre-fix tree; the kernel key's 10 new assertions and the fallback
    row, each watched failing; and the new required boundary row, watched failing by renaming the case. The
    card's two rows were **measured in both renderers** rather than argued about, since `apps/web`'s and
    `apps/mobile`'s projection suites replay the group (web 20 → 22, mobile 36 → 38): with the collapse
    removed, the live Fu Kin Street card printed `68K` **twice** and said **"+0 more"** while 68S was hidden,
    and at `maxRows: 2` it was one route number printed twice.
- **Docs:** plan `01–10`, the full ADR set in [`docs/08`](./08-decision-log.md) (Wave 0 adds **055** ·
  **057** · **058** and implements **049**), research + proposals sets, `CLAUDE.md` / `AGENTS.md`,
  pre-commit docs-check skill + hook.

## 🚧 Not done yet / known limitations
- 🟠 **A defect in the conformance walker now relaxes both renderers at once** (WP6-1,
  [ADR-083](./08-decision-log.md#adr-083--a-component-spec-is-data-with-five-words-and-the-projection-is-what-pins-it)).
  `project()` in `packages/ui-spec` is one declaration of what a component must show, replacing an
  `expectedText` that was duplicated on purpose. That trade is deliberate and ADR-069 decision 7's rule is
  *refined, not reversed* — the declaration is shared, the reading is not — but the residual is real: exact
  equality catches a wrong **spec**, and nothing but the walker's own 21 tests catches a wrong **walker**.
  Its fixtures are abstract on purpose so it cannot quietly acquire this app's assumptions.
- 🟡 **`ui/*.spec.json` is one more thing a native repo must vendor, and vendoring is still unsolved.** The
  hole was already the one gap in the corpus-rot story; WP6-1 widens it rather than changing it, and a stale
  copy still yields a **green** suite pinning a rule that has moved. `packages/contract/README.md` §7 says so
  where the reader meets it, and adds the thing a porter would otherwise get wrong: **a state marked
  `knownDefect` is a target neither renderer meets**, not behaviour to copy. **WP6-9 must not start before
  this is answered** — unchanged from ADR-075, with more surface.
- 🟡 **`StopRow`'s spec declares three of its five states `unenforced`, and one a `knownDefect`.** `loading`,
  `stale` and `offline` cannot be observed from one card — a skeleton belongs to the list screen, staleness is
  opacity rather than text, offline is indistinguishable from stale without knowing whose network failed — so
  they carry a reason and an owner (**WP6-2**) instead of an assertion. `empty` is the target sentence both
  renderers currently fail (**WP6-4**). The `a11y` block is declared and cross-referenced but nothing asserts
  the rendered tree agrees; that too is WP6-2's.
- 🟡 **`docs/09` §5 (motion) and §6 (the prose ETA display spec) still need their superseded banners.**
  ADR-075 deferred it *"until the spec format exists"*, and it does now — but one component's spec is not
  enough: `EtaBadge` lives inside `StopRow`'s spec as three `oneOf` branches rather than as a component of its
  own, so §6 is not yet genuinely replaced. Owner: **WP6-2**.
- 🟠 **`apps/web` renders seven "coming soon" placeholders, and that is the honest state of Wave 6** (WP6-0,
  [ADR-082](./08-decision-log.md#adr-082--the-web-shell-before-the-web-screens-a-router-over-a-declared-destination-set-and-one-pwa-policy-for-two-apps)).
  Nearby is the **only** ported screen; `/favorites` (WP6-4), `/settings` (WP6-7), `/search` (WP6-5),
  `/stop/:id` (WP6-3), `/route/:id` (WP6-6), `/about-data` and `/faq` (WP6-7) are placeholders that name their
  owner, and a test requires every unported destination to have one. `pnpm dev:web` — the Expo PWA — is
  still the complete app and is still what WP0-5 ships. **A screenshot of `apps/web` will misrepresent the
  project unless it is Nearby.**
- 🟠 **`apps/web/src/shell/ShellPreferences.tsx` is scaffolding held to no spec, and only a name keeps it
  honest.** It exists because WP6-0's acceptance requires *"switches locale"* to be something that was run,
  and the Settings screen belongs to WP6-7. **WP6-7 must delete this file**, not extend it. If WP6-7 slips,
  an unspecified rider-facing surface ships. There is no gate; this row is the mechanism.
- 🟡 **Two of WP6-0's tests read `apps/mobile`'s source, and both die at WP6-8.**
  `apps/web/test/shell-parity.test.ts` is what binds the destination set and ADR-058's four cache numbers
  across the two shells, and it is deliberately temporary — after `apps/mobile` retires, the destination set
  is declared in one place and compared against nothing until WP6-9 gives it a second reader. That is
  ADR-075's own *"between WP6-8 and WP6-9 there is exactly one renderer measured against the spec"* risk,
  arriving early and in the shell rather than in a screen.
- 🟡 **WP6-4 inherits a hoist it does not currently own in the plan:** ADR-062's versioned favourite-key
  migration lives in `apps/mobile/lib/preferences.ts`, and the web shell deliberately does **not** model
  favourites so that it cannot be a second implementation of it. Porting Favourites means moving that
  migration to a home both renderers call — a WP4-0-shaped hoist, its own commit, and the one part of Wave 6
  where getting it wrong loses a rider's curated data rather than a rendering.
- 🟡 **A brief light flash before `apps/web`'s bundle parses.** The appearance class is applied by
  `main.tsx` before the first render, but the stylesheet paints `bg-bg`'s light value while the module is
  still loading. The usual fix — an inline `<script>` in `index.html` reading localStorage — would be a
  second declaration of the storage key and of what `auto` means, in a file no gate reads. Accepted; the
  service worker reduces the window to a frame or two once installed.
- **Not deployed** (WP0-5). **CI now exists** — `.github/workflows/ci.yml` runs typecheck · lint · test ·
  `wrangler deploy --dry-run` · `git diff --exit-code` on a clean checkout for every PR and every push to
  `main`, needing no credentials — but there is still **no Cloudflare Pages deploy and no domain**, so nothing
  is reachable outside a dev machine. It needs a real domain **and** a Cloudflare account, and **this
  environment has no Cloudflare auth at all** — hence the placeholder KV namespace id in `wrangler.toml`, the
  commented `[[routes]]` block beside it, and the fact that `dataset:publish` has only ever been exercised
  against Miniflare-local KV/R2. The workflow's deploy job is written out in full and **inert** until the
  `DEPLOY_ARMED` variable is set, so arming it is a settings change rather than a new file.
- ✅ **Closed 2026-08-03 by WP5-6** ([ADR-076](./08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll)), kept for the history:
  *"`/v1/live` is unreachable from a real build"* — the server, the transport and its reconnect policy all
  existed and were tested, and `EXPO_PUBLIC_LIVE_TRANSPORT` / `VITE_LIVE_TRANSPORT` were documented in four
  places and read by **nothing**. Both app shells now select `poll` | `socket` from the environment through
  one shared declaration (`live/select.ts`), with `_LIVE_URL` wired alongside it; **the default is still the
  poll emulator**, so this changes what is *possible* rather than what ships. Two things worth carrying
  forward: selecting `socket` is what un-latches the review's five `eta-hub.ts` findings, and what stands
  behind them now is WP5-5's corpus driving the real Durable Object over a real socket (ADR-076 lists all
  three mitigations); and **`socket` in `apps/web` is inert until WP5-7**, because no screen there
  subscribes. The `.context/wave5/review/VERDICTS-do.md` this bullet used to point at **is not in this
  workspace** — it was written in another worktree — so the durable record is ADR-056 decisions 13–19.
- ✅ **Closed 2026-07-31 by WP5-9** ([ADR-072](./08-decision-log.md#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)),
  kept for the history: *"a place publishes at most one reading per line, but now renders a row per pole"* — so
  the second kerb's row read "no reading right now" while a bus was genuinely due there (at Fu Kin Street it
  read the **static timetable band**, *"every 7 – 9 min"*, while a 68K was nine minutes out from that very
  kerb). `dedupeEtas` keys on the pole now, so both rows carry their own bus, and *"which reading belongs to
  which row"* is one kernel rule serving both `/v1/stop` and the live merge instead of two that had to agree.
  **Two residuals it leaves are below**: a rider starring one line at *both* kerbs still sees one Favourites
  row, and `stopCardView`'s collapse now depends on producers sorting soonest-first for *value* as well as
  order.
- 🟡 **A rider who stars one line at *both* kerbs of a place sees one Favourites row** (left by WP5-9,
  ADR-072, and verified in a browser with both keys saved). Both keys resolve; the compact card's
  collapse-to-one-row-per-line is what merges them, which is right for a card with no kerb heading and wrong
  for a rider's explicit choice. **Not a regression** — before WP5-9 only one of the two kerbs had a reading at
  all — but telling the two apart needs a **per-row kerb label the card does not have**. Owner: **WP5-12**,
  which this joins from the favourites side; the alternative is ADR-072's rejected "collapse on what the row
  *prints*" (26 of the 43 cross-pole lines show **different destinations** at their two kerbs).
- 🟡 **`stopCardView`'s "keep the first" depends on every producer sorting soonest-first, and none is enforced
  to** (pre-existing, sharpened by WP5-9). `/v1/nearby`'s schema says sorted, `stopArrivals` sorts,
  `applyLiveEtasToNearby` sorts, Favourites sorts. The `maxRows` cap already had this dependency, so the
  collapse adds no new risk — but a producer that stopped sorting used to merely reorder rows and would now
  silently show the **later** bus of a line. A comparator in `soonestPerLine` or a gate on the producers would
  fix it. Owner: unassigned, and **WP5-7 has now added that next producer without closing it** — honestly
  rather than by claiming otherwise: `stopEtasBatch` delegates to `stopArrivals`, the one producer that
  sorts, and `apps/edge/test/etas-batch.test.ts` asserts both that an entry is byte-identical to
  `/v1/etas/:id` and that its readings are soonest-first. So the new producer cannot disagree by
  construction, and the *general* rule — a comparator in `soonestPerLine`, or a gate over the producers —
  is still nobody's.
- ✅ **Already closed, and this bullet was stale** — noticed while WP5-4 edited the file. The claim was that
  `apps/edge/test/wire-conformance.test.ts`'s `fetch` stub ended `return realFetch(input, init)` and so could
  leave the sandbox. It does not: the stub **throws** on an unrecognised URL, with a paragraph naming all
  three consequences (the WP5-9 flake, an upstream that answers *plausibly* making the fixtures stop being
  the thing under test, and CI having no HK network path at all). Kept as a correction rather than deleted,
  because a status doc that carried a fixed item for a wave is the same failure as one that omits a broken
  one.
- ✅ **Closed 2026-07-31 by WP5-10 + WP5-11** ([ADR-071](./08-decision-log.md#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)),
  kept for the history: *"two poles of one place can wear identical headings"* — Tin Shui Wai Park's two
  members both printed the stop code TN510, so 269D rendered twice under labels that looked the same. Both
  halves shipped: the pairs that are **one pole published twice** are folded onto one boarding point, and the
  rest get a **compass side** where the poles are far enough apart for one to mean something. **The residual
  is real and owned:** 141 pairs across 115 places sit 2–10 m apart — too far to fold, too close for a side
  (**WP5-12** below).
- 🟡 **A favourite whose route has no current arrival renders an empty card** (found by WP5-11, **pre-existing
  and unowned — worth its own row**, adjacent to WP5-4). `FavoritePlaceRow` filters rows to those carrying an
  `eta` and drops the rest, so a peak-only service shows a card with a name and nothing under it (269D:3 at
  Tin Shui Wai Park, tested at 22:55; the row *was* matched — fare 18.5 present by `curl`). The consequence
  that matters is diagnostic: **an empty card cannot be told from a broken favourite key by eye**, which is
  why WP5-11's favourites proof rests on a route with a live arrival instead.
- ✅ **Closed by Wave 5, kept here for the history: a raw upstream URL literal in a screen was invisible to
  both tools.** `pnpm boundaries` checks the *import graph*, and `fetch('https://data.etabus.gov.hk/…')`
  imports nothing, so golden rule 2 was encoded only as `view` ✗→ `adapters` — recorded in Wave 1 and owned by
  nobody for four waves. The mechanism, not a promise: `scripts/check-view-transport-free.mjs` in the
  `boundaries` chain, five source patterns over five policed directories, with the live tree as its last
  selftest scenario. Its allowlist matcher was itself one of the review's findings, so the selftest now has
  four allowlist cases including the over-match. Still open in the same family: `packages/ui/preset.js` and
  `global.css` sit outside the policed `src` directories.
- ✅ **Closed 2026-08-03 by WP5-4** ([ADR-073](./08-decision-log.md#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire)), kept for the history:
  *"an upstream outage reads as 'no buses', on both the socket and HTTP"* — `coalesce` took a `fallback` and
  every ETA call site passed `[]`, so a **rejected** upstream board resolved to an empty list and the call
  succeeded. `/v1/etas/:id` served `200 []`, and both engines then did the only thing available to them with
  readings that are no longer there: reported every one `gone`. The rule was written down twice, enforced
  twice, and defeated one layer below both copies. `coalesce` has no `fallback` any more; `/v1/etas/:id`
  answers `{ etas, failed }` (a **breaking** wire change, `CONTRACT_VERSION` 2.0.0, taken now because the
  deprecation window is free until WP0-5); and `retainFailedPoles` in the kernel is the one rule both
  engines apply to it. **Residual, and it is real:** `/v1/nearby` and `/v1/stop` still cannot say it, so a
  Nearby card and a Place screen's *first paint* still read as "no buses" during an outage — see the
  🟡 bullet below and **WP5-13**.
- ✅ **Closed 2026-08-03 by WP5-13** ([ADR-077](./08-decision-log.md#adr-077--a-card-can-say-we-could-not-ask-and-a-failure-list-must-not-outlive-its-round)), kept for the history:
  *"`/v1/nearby` and `/v1/stop/:id` cannot say 'we could not ask'"* — so a Nearby card during a KMB outage
  rendered identically to a stop with no buses due. Both payloads carry `failed` now, and the thing that
  made it safe is the fix ADR-073 said it was waiting for: the two kernel merge helpers **take** the
  current failure set and destructure the old one *out* of the spread, so an absent argument clears the
  field rather than letting an HTTP-era list outlive the outage it describes. A card says one thing —
  `StopCardView.incomplete`, a boolean, because a compact card prints no kerb heading — rendered by both
  renderers from the kernel's answer as a muted *"Live times unavailable"* below the rows. Measured with
  the KMB upstream pointed at an unroutable host: the Citybus place in the same response kept its six
  readings and reported nothing, and in a browser a mixed-operator place showed its NLB/Citybus arrivals
  **and** the marker for its refusing KMB kerbs. **Residual:** the live path is coarser than the HTTP one
  — a subscription's `retrying` names no kerb — which is deliberate and recorded in the ADR.
- ✅ **Closed 2026-08-03 by WP5-5** ([ADR-074](./08-decision-log.md#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines)), kept for the history:
  *"nothing binds the two engines' failure semantics"* — the rules were implemented in `live/poll.ts` **and**
  in `eta-hub.ts`, and the scenario matrix compared the poll emulator against a hand-written script, never
  against the shard. Every defect Wave 5 found in its own live code survived exactly this gap, three for
  three. There is now one table of rounds — `packages/core/fixtures/live-rounds.json`, 11 rows — driven by a
  client driver and by an edge driver that opens a **real socket to the real `EtaHub`** inside workerd and
  reduces its frames with the kernel's own `applyLiveFrame`. It asserts what a listener *holds when each
  round settles* rather than a frame transcript, because a stateful server and a poll emulator cannot have
  equal transcripts (ADR-074 decision 3 says why). The corpus found a defect in its own first draft, which
  is the honest way round.
- **`/v1/live` is unprotected**, and the `Origin` check does not change that: a WebSocket upgrade does not
  honour CORS, a missing `Origin` must be allowed (that is what native clients send), so the check is
  browser-only, advisory, and **off by default** because there is no production origin to allowlist yet. What
  would protect it is zone rate limiting, which needs the domain. The DO's five caps bound one connection's
  fan-out, not one script's — and one of them was found in the review to be a lock-out in its own right: a
  shard that had filled up **refused** every subsequent legitimate upgrade with a 500 the browser cannot read.
  It rejects the excess targets now and keeps the rider.
- **Live ETA / nearby data is server-side**; the **search index is on-device** (ADR-037 — first step of
  [ADR-007](./08-decision-log.md)), but it's still **server-computed** and fetched. The static data is now
  precomputed into KV/R2 (ADR-055), but it is still **derived from the hkbus consolidated dataset** — the own
  crawl of the operator APIs is still backlog. KMB + CTB + GMB; other operators (NLB/MTR) are in the
  consolidated set but out of v1 scope — search's operator filter chips are data-driven, so they appear the
  moment those adapters land.
- Same-kerb merge is **conservative** ([ADR-022](./08-decision-log.md)): stops whose landmark strings differ
  (e.g. KMB stop-code-only names) won't merge. Follow-up: token-overlap matching / own-crawl coordinates.
- ETA lists are de-duplicated **once, server-side** ([ADR-023](./08-decision-log.md)): `stopArrivals` (one
  upstream call per route+serviceType, then `dedupeEtas` → one rider line per route+direction) backs both
  `/v1/nearby` and `/v1/etas`. Fixed the "two A41, same time" double-count. Favorites' summary reuses the
  shared `dedupeEtas`; future: store the name in the Favorites store so it reads `/v1/etas` directly.
- **Stop-card navigation** ([ADR-024](./08-decision-log.md)): in `StopCard` the **stop name** → Stop detail
  and **each route row** → `/route/:id?stop=:stopId` are sibling tap targets (not nested). `/route/[id]`
  reads `?stop=` to show an **"arrivals here"** card (the route's next few arrivals at that stop) and
  highlights the current stop. **Verified in-browser**: route-row tap → route view with "Arriving / 9 / 17
  min" + ST141 highlighted; name tap → stop detail; no nested-`<button>` warning.
- **Simplified (zh-Hans) static names fall back to Traditional** (consolidated dataset has en + 繁 only);
  live ETA text still has all three. Backlog: true zh-Hans via own crawl.
- Static layer no longer depends on hkbus **at runtime** (ADR-055) — an outage there means the *build* is
  skipped and the Worker keeps serving the last good `build:current`, i.e. **stale, not broken**. The
  remaining dependency is on their data as a *source*; backlog: own crawl.
- Offline is **shipped** (ADR-058) but the **Nearby screen offline is unverified** — the data path was proved
  instead, because Chrome geolocation in this environment resolves outside Hong Kong. Worth an eyeball on a
  real device. Offline is also **web-only**: native has no service worker, though the persisted query cache
  and last-known-fix work on all three targets.
- **Search** (the `/search` page, ADR-037) ships but **hasn't been walked in-browser** yet (logic + edge
  endpoint verified by curl; visual/interaction pass on the floating button, keypad, chips and result lists is
  pending). Route results navigate to a representative variant id (direction toggle / service-type picker =
  follow-up). Filter chips live only on Search, not yet on Nearby (rest of proposals P8).
- Stop detail's ETA fan-out is **coalesced** per pole (ADR-057) and **bounded** per place
  (`DEFAULT_CTB_BUDGET` in `stop-route.ts` — only CTB needs it; a KMB pole costs one `stop-eta` call for every
  route). Since Wave 5 it refreshes through **`DataSource.watch()`** rather than `refetchInterval` — the same
  frames either way, the poll emulator by default (`/v1/etas/:id` per cadence instead of the whole
  `/v1/stop/:id`, so a refresh costs less than it used to), the socket when selected. **Nearby, Favourites and
  Route detail are still on `refetchInterval`**: Nearby is deliberately not the first adopter, because six
  places would mean six requests per window where the screen issues one, and the fix is a batch
  `/v1/etas?ids=…` first (WP5-7). No **interactive** map (the static `MiniMap` is there) · no push · no native
  build has been run.
- `Skeleton` is static; the number-flip / split-flap ETA animation isn't built; **CJK uses the platform
  face by decision** (no Noto bundled — [ADR-019](./08-decision-log.md)); `font-display` (dot-matrix) face
  not added; display-livery character treatments (LED / flip-tile) are colour-only. (Lucide icons now
  shipped — [ADR-025](./08-decision-log.md).)

## ▶️ How to resume
1. Read [`CLAUDE.md`](../CLAUDE.md) → [`docs/README.md`](./README.md).
2. `pnpm install`, then `pnpm dev` (or `pnpm dev:edge` / `pnpm dev:web`). Verify per [`docs/10`](./10-scaffold-and-running.md).
3. `pnpm test` (**1 221 tests** on `design-language-reuse-v2`: core 853 · edge 149 · api-client 71 ·
   **ui-spec 21** · mobile 55 · web 72, plus the whole `pnpm boundaries` chain; `main` at `0c97e17` has
   1 161. WP6-1's totals went *down* by two in the apps and that is the intended direction: the bespoke
   "+N more with nowhere to tap" case in each suite is now `content-not-affordance` running over **every**
   corpus case) and `curl localhost:8787/v1/health` — locally that reports
   `"dataset":"inline"`, which is the expected dev fallback; in production it must read `"kv"` with
   `datasetBuildsThisIsolate: 0`.
4. For the PWA specifically: `pnpm --filter @nextbus/{mobile,web} build:web`, serve that app's `dist/`, then
   kill both the static server and the Worker to check the offline path. **Use different ports for the two
   apps** — a service worker's scope is the origin, so the first navigation after switching apps on one port
   is answered from the *other* app's precache and looks like your build did nothing (one reload fixes it;
   `docs/10`'s third dev-loop trap has the tell and the cleanup).
5. **If you touch `apps/edge/test/eta-hub*.test.ts`, two harness facts cost real time before they were
   understood, and both are in comments where you will hit them.** (a) A promise resolved *inside* the shard's
   I/O context resumes the test in that context, so the next `ws.send` dies with *"Cannot perform I/O on behalf
   of a different Durable Object"* — a gate on a held round has to be **polled from a counter**, and the round
   started by the shard itself (a `subscribe` naming an unpolled stop pulls the alarm to `now`, which is the
   production timing anyway) rather than by `runDurableObjectAlarm`. (b) Any case that leaves **two live
   sockets** on a shard makes a later `evictDurableObject(…, { webSockets: 'hibernate' })` in the same file
   hang — reproduced on the *unfixed* object, so it is the pool and not any change of ours. That is why the cap
   assertions live in their own file. Owner: whoever does WP5-5, which puts the matrix through a real socket
   and will meet both.

## 🔜 Next steps (priority order)

> **New, 2026-08-03 — the renderer decision, and it changes what Phase 3 is.**
> [**ADR-075**](./08-decision-log.md#adr-075--three-renderers-one-executable-spec-and-drift-defined-on-the-spec-rather-than-the-pixels)
> supersedes ADR-002: **web becomes plain React**, iOS and Android become **hand-written** and
> platform-idiomatic, and all three are held to **one executable spec** — so "nothing drifts" changes
> from *the UIs match* (which nothing enforced, and `react-native-web` already failed) to *every
> renderer satisfies the same spec* (a conformance suite). It resolves a contradiction that had been on
> `main` for several waves: `docs/06` Phase 3 said native came from the *same Expo codebase*, while
> `packages/contract/README.md` was addressed to *"someone starting a native repo tomorrow"* and every
> generated native artefact served that second reader.
> **The work plan is [`proposals/04`](./proposals/04-platform-idiomatic-renderers.md) — Wave 6, WP6-0 … WP6-10 —
> and it is written to be walked component by component**; the specs themselves are not written yet.
> **WP6-0 is done as of 2026-08-03** ([ADR-082](./08-decision-log.md#adr-082--the-web-shell-before-the-web-screens-a-router-over-a-declared-destination-set-and-one-pwa-policy-for-two-apps)):
> `apps/web` has the shell and one ported screen, and **WP6-1 is done too**: `packages/ui-spec` is the format,
> `packages/contract/ui/stop-row.spec.json` is the first instance, and both renderers pass it unmodified.
> **WP6-2 is next** — Nearby's own spec. Three things are already waiting for it and are written down rather
> than remembered: the three `StopRow` states declared `unenforced` because a card cannot show them alone
> (loading, stale, offline), the `a11y` block that is declared but unasserted, and `docs/09` §5/§6's
> superseded banners. It also wires the taps WP6-0's placeholders are waiting for. Read WP6-0's and WP6-1's
> unanticipated findings in `proposals/04`'s work-package note first; two of them (the destination set as
> identity, the storage-key hazard) change what a later row has to do.
> **WP0-5 still ships the Expo PWA first**, and
> `apps/mobile` stays the reference implementation until each screen's spec passes on both renderers.
> Docs updated with it: `docs/01` (principles 4–5), `docs/04` (superseded banner), `docs/05` (no EAS),
> `docs/06` (Phase 3 rewritten), `docs/10` (deploy targets), `docs/README`. **`docs/09` still needs a
> pass** to mark §5 (motion) and §6 (the prose ETA spec) as superseded by component specs and to label
> its rules identity-vs-idiom — deliberately deferred until the spec format exists.

0. **Favourite routes-at-a-stop** ([ADR-032](./08-decision-log.md#adr-032--favourites-are-route-at-stop-pairs-not-bare-routes) + [ADR-042](./08-decision-log.md#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant), **✅ done 2026-06-15**) —
   the store + tab are on the route-at-stop model (stop-only favourites **removed**, 2026-06-10):
   `favoriteRoutes: string[]` keyed `"${memberStopId}|${routeId}"` with `toggleFavoriteRoute`. **Save UI =
   a bottom sheet** (`components/BottomSheet.tsx` + `SheetAction`): tapping a stop on the **route schematic**
   opens **Favourite / Remove favourite** (this route at the tapped pole) + **View stop**. *(A glass save-star
   in the route header was prototyped then dropped — didn't feel right.)* **Place detail** keeps a per-row
   `SaveStar` as a saved-state **indicator only** (`hideWhenEmpty` — only saved routes show a filled star).
   **Keys on the raw *member* pole id, never the `P:` place id** (place ids churn under clustering and would
   orphan favourites). The **Favourites tab groups by place**: each saved pole resolves via `getStop` (the
   server promotes a member id to its place), grouped by the returned place id, so a multi-pole place shows
   once with its starred routes from every pole. Browser-verified end-to-end. Bare-route favourites deferred.
1. **[`proposals/03`](./proposals/03-clean-separation-and-phase2-plan.md) — Waves 1 … 5 are all ✅ complete**
   (ADR-051 … ADR-054, ADR-059, ADR-060, ADR-062 … ADR-069, **ADR-056** for Wave 5, **ADR-071** for two of
   its follow-ups and **ADR-072** for a third). Wave 3 landed 2026-07-29, Wave 4 the same day, **Wave 5 on
   2026-07-30 — bar the deployment; it merged as PR #19 on 2026-07-31.**
   ← **start at WP0-5**, then the remaining Wave 5 follow-ups below (**WP5-9, WP5-10 and WP5-11 are done**, on
   `wave5-followups-v1`).
   **Why Wave 3 went first, against this doc's own earlier advice:** it was framed here as "the larger, more
   speculative bet … every claim is about a Swift compiler nobody has run". That was true of **one** of its
   four packages. The other three closed drift that was live on `main`: design values written down four
   times, an i18n package with zero tests and prose leaking out of it, and three arrival caps that disagreed.
   Only WP3-3 (publish the contract for a native repo that does not exist) is speculative, which is why it is
   the one still open. Worth remembering as a pattern: *"speculative" attached to a wave when it only applied
   to a quarter of it.*
   **Next, in order:**
   - ✅ **WP4-0 done 2026-07-29 — the derived view is kernel logic now, so WP4-1's acceptance is
     measurable** ([ADR-068](./08-decision-log.md)). **This work package is not in the plan**; WP4-1's row
     needed it and did not say so. Its acceptance is *"lines of new logic outside `.tsx` and adapters:
     zero"*, and six derivations were living inside `apps/mobile`'s components, reachable only by rendering
     a React tree — the list's order, the `maxRows` cap and its "+N more" count, the caption's parts and
     its two different separators, destination-else-remark as the headline, the route number fallback, and
     the stop-name split. A second renderer could only have re-implemented them, and **a
     re-implementation would have passed a byte-identity check while proving the opposite of the thesis.**
     They are `packages/core/src/stop-card.ts` now (`displayName`, `stopCardCaption`, `stopCardView`,
     `nearbyView`) plus `etaUrgency` / `etaReadout` / `remarkView` in `eta.ts`, pinned by a 30-case corpus
     built from the real dataset build `d598893de6add2e4`. `core` is at **100% branches, 315/315** (from
     279), threshold unchanged. `apps/web` is already in `layers.json` and `check-no-raw-colours`, so it
     cannot be born ungated. **The one user-visible change:** the imminence band is the served
     `warnUnderSec` (180 s) instead of `EtaBadge`'s literal `value <= 5` (360 s) — see the ADR; an arrival
     3–6 minutes out is no longer coloured as "run".
   - ✅ **WP4-1 done 2026-07-29 — Wave 4 is complete** ([ADR-069](./08-decision-log.md)).
     `apps/web` is a Vite 8 + React DOM + plain-Tailwind app rendering **one** screen (Nearby) from the
     identical `packages/core` functions: `pnpm dev:dom` → http://localhost:8082. It derives nothing, and
     `apps/web/scripts/check-no-derivation.mjs` enforces that by policing *shapes* — ordering, capping,
     selecting, string-joining, arithmetic, thresholds — with 8 selftest scenarios. The equivalence
     assertion (`apps/web/test/nearby-projection.test.tsx`) renders **every `stopCardView` corpus case**
     and compares its visible text against a projection of the same view, so the golden is the corpus a
     Swift or Kotlin suite would read.
     **Three things landed along the way, each because two renderers forced the question:**
     the `useLocation` state machine moved to `packages/api-client` (the only layer that may compose
     `kernel` + `ports`) and **`apps/mobile` consumes it too** — each app is now a three-method adapter
     plus the same ten-line hook; `bearingOctant` is shared, because the compass needle and
     `formatBearing`'s word are one rule and `BearingArrow` had its own copy without range
     normalisation; and `packages/ui` gained a **second CSS emit target** whose variables are
     byte-identical to `apps/mobile/global.css` (7 artefacts gated now, was 6). The generated
     NativeWind-flavoured `preset.js` was **verified** to work under plain Tailwind 3.4, not assumed.
     **What the second renderer caught in the first — the point of the wave, concretely:**
     (a) **HTML collapses the caption's deliberate double separator**, so the web card read
     "Southwest-bound · 170m · 2 min walk" where RN read "Southwest-bound  ·  170m · 2 min walk" — the
     same string, rendered differently. Fixed with `whitespace-pre-wrap`. My first test could not see it
     because it normalised whitespace before comparing.
     (b) **The "+N more" count was hidden whenever it could not be tapped** (`remaining > 0 && onPress`),
     so a caller with nowhere to navigate showed 6 of 26 routes and said nothing — the silent filter
     ADR-008 forbids. Every `apps/mobile` caller passes `onPress`, which is why it had never fired.
     Fixed in **both** renderers; regression test watched failing against the old guard.
     ✅ **Both sides are measured now** (closed the same day; ADR-069 addendum). This had been recorded
     as 🟠 *"byte-identical is measured on one side only"*, and the gap was real: deleting the inline
     `<Text>{view.caption}</Text>` from the RN card — so every card silently loses its compass direction
     and distance — passed typecheck, lint **and all 686 tests**. (A narrower correction to the original
     note: a field rendered through a *dedicated imported component* IS caught incidentally by Biome's
     `noUnusedImports`; it is the **inline** fields that nothing guarded.) It is now
     `apps/mobile/test/stoprow-projection.test.tsx` — `react-native` aliased to **`react-native-web`**
     in a new `apps/mobile/vitest.config.ts`, the RN card rendered in jsdom, read back through the *same*
     projection `apps/web`'s suite uses. That is a ship target, not a stand-in: it is how Expo renders the
     PWA. **A cheaper gate was built first and deleted because it did not work** — asserting each field is
     *referenced* in the render path passed the deletion, because the surviving guard
     `{view.caption ? (…)}` still mentions `caption`. "Referenced" is not "rendered", and no textual rule
     separates them: a discriminant is only ever compared, a boolean only ever a condition. Shipping it
     would have added a gate that passes on the exact failure it was built for.
     🟡 **Still not covered: iOS/Android *native* rendering** — `react-test-renderer` would not have
     covered it either. What is covered on all three platforms is a component dropping, duplicating or
     reordering a field, because the tree under test is the source Metro bundles.
     ⚪ **`apps/mobile` resolves TypeScript 6.0.3 while every other package is on 5.9.3** (golden rule 6
     says 5.9 for shared packages). Found incidentally: 6.0 rejected a cast 5.9 had accepted in the web
     suite, where the corpus's JSON `null` was being asserted into `string | undefined`. Both suites now
     convert rather than cast. The version divergence is pre-existing and unaddressed.
     🟡 **`check-no-derivation` polices `apps/web` only** — `apps/mobile`'s route, search and workbench
     screens still hold rules WP4-0 did not hoist, so the same rules would fire on legitimate code.
     Closes when Place and Route detail get their own WP4-0.
     🟡 **Nothing deploys `apps/web`** (`vite build` → `dist/`, 260 kB JS / 84 kB gzipped). ✅ **CI landed
     2026-07-30** with Wave 5 (`.github/workflows/ci.yml`, no credentials needed); the deploy half is still
     WP0-5.
   - **When a native repo actually appears**, its first jobs are already written down: compile
     `packages/ui/generated/NextBusTokens.{swift,kt}` and `packages/contract/native/{ios,android}/` (all
     four generated, none ever compiled), and solve **corpus vendoring** — see the loose end below. Start
     from `packages/contract/README.md`, which is written for exactly that reader.
   **Loose ends the waves left, in priority order:**
   - ✅ **Fixed 2026-07-28 — a dataset flip now invalidates the cached index**
     ([ADR-066](./08-decision-log.md)). Found while verifying WP2-7, and worth keeping in the record because
     of *how*: `cached()` keyed `caches.default` on the URL alone with a 6 h `max-age`, so for six hours after
     a publish `/v1/index` served the **previous** index while `/v1/health` reported the new `buildHash` — and
     once WP2-7 gave the endpoint an ETag, a revalidating client got a **304 confirming the stale copy**. The
     key now carries the build hash, so a flip is invalidating by construction rather than by anyone
     remembering to purge. The test spans two builds and was **watched failing** against the pre-fix code.
     Every gate had been green; only rebuilding and publishing a real dataset against a running Worker
     exposed it.
   - ✅ **Done 2026-07-28:** five of the six `knownDefect` rows are fixed (`formatDistance` 995–999 m,
     `estimateChildFare('')`, `estimateElderlyFare('')`, `formatServiceHours`' past-midnight wrap,
     `buildRouteTrie('')`), and the corpus format is converged. **One `knownDefect` remains on purpose:**
     `formatStopCount(1, 'en')` → `"1 stops"` needs a plural-aware key and belongs to **WP3-2** (i18n → ICU),
     not a per-platform patch.
   - **Four new `knownDefect` rows Wave 2 pinned rather than fixed** — each is now wrong *identically* on
     every platform, which is the point, and each has a `why` saying what `expect` becomes when it is fixed:
     (a) where one line has two variants both carrying a reading, the **first** wins rather than the
     **sooner**, so Nearby and Place detail can contradict each other (KMB 269D at Tin Shui Wai);
     (b) one route number covering two services at two poles erases the second — **21 poles emptied** in the
     current build, mostly GMB, while their map dots stay; (c) a lone stop frames **one zoom step wider**
     than the multi-pole place next door on any phone ≤394 px — the gap `b084c06` tried to close;
     (d) blank-`en` GMB circulars lose the *"Circular via …"* treatment.
   - ✅ **Fixed 2026-07-29 — `pnpm lint` is green.** It had been red on `main` with 6 errors: Biome did
     not know the `@tailwind` at-rule (two `global.css` files) and one `useTemplate` in
     `scripts/precommit-docs-check.mjs`. A permanently-red gate is a gate nobody reads, and Wave 3
     generates Biome-formatted files in three of its four packages, so it had to go first. The at-rule is
     now **taught, not silenced** — `noUnknownAtRules` keeps firing at `error`, with
     `options.ignore: ["tailwind"]` in `biome.json`, so a genuinely unknown at-rule is still caught.
     Note `biome.json` is **half generated**: `scripts/boundaries/generate.mjs` rewrites only its
     `overrides` block from `layers.json`, so top-level `linter.rules` is safe to hand-edit —
     `pnpm boundaries:check` confirms no drift.
   - ✅ **Fixed 2026-07-29 — turbo tasks now declare what they read** ([ADR-070](./08-decision-log.md)).
     This had stood since Wave 2 as *"turbo replays a cached `@nextbus/mobile:typecheck` across a
     `packages/core` source change; use `--force` until the cache key is fixed"* — a workaround that
     depends on somebody remembering a flag, which is not a fix. Root `typecheck` is now
     `dependsOn: ["^typecheck"]`, so a package's hash includes its dependencies'. **It recurred a third
     time first, and worse:** `@nextbus/contract:test` verifies that the README and the two native
     templates quote current corpus figures, but the corpus is in `packages/core`, which `contract` does
     **not** depend on — so neither the default hash nor `dependsOn` could ever see a corpus change. Wave
     4 added one corpus and grew two, and the gate went red on a clean checkout while replaying green
     locally **from another worktree's run days earlier** (the turbo cache is shared across the agent
     worktrees). Green locally, red in CI, and it merged that way. Fixed with explicit
     `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/packages/core/spec/*.spec.json"]` in
     `packages/contract`, `apps/mobile` and `apps/web` — declared rather than switched off, so a reader
     learns what the task reads.
   - **The plan's 50 m snap tier does not exist.** WP2-6's row says *"25 m nearby / 50 m elsewhere"*; only
     `SNAP_GRID_M = 25` was ever implemented, and `gridM` is a parameter no caller passes. Not invented
     during a move — the row should lose the clause or gain a follow-up.
   - **`layers.json` is 44% over its line budget** — per the plan's own risk row that is the signal to simplify
     the generator when it next needs to change, not to grow it. Not worth touching working, self-testing code
     for a line count alone.
   - **Wave 3's own loose ends (2026-07-29), highest-consequence first:**
     - 🔴 **Corpus vendoring is unsolved, and it is the one hole in the corpus-rot story.** Both native
       templates tell a porter to copy `packages/core/spec/*.spec.json` in with a script and check
       freshness, but **nothing in this repo can enforce that a native repo's copy is current** — and a
       stale copy produces a *green* suite pinning a rule that has since moved, which is worse than no
       suite at all. Options when a native repo exists: publish the corpus as a versioned package the
       native build fetches; or have the templates assert a content hash committed here. Unowned by any WP
       — the same shape as the WP2-8/WP2-9 gap that only got fixed because someone noticed.
     - ✅ **Closed 2026-07-29 by WP4-0 — a served `dueUnderSec` / `staleAfterMs` override now reaches
       every ETA render path** ([ADR-068](./08-decision-log.md)). It had been served while **no screen
       threaded it in**, and closing it turned up worse than a gap: `etaLabelParts` took no `dueUnderSec`
       parameter at all, and the imminence band was written down **four** times — `EtaBadge`'s
       `parts.value <= 5` and `EtaTimes`' identical literal (both 360 s), the workbench swatch labelled
       "soon (≤5)", against a served `warnUnderSec` of **180**. `etaUrgency` owns the thresholds now and
       each renderer keeps only its colour table. `formatRelative` still defaults, and that is fine — it
       has no callers outside `core`. **This is the one user-visible change in the work package:** an
       arrival 3–6 minutes out is no longer coloured as "run". Verified in the browser on Nearby,
       Favourites, Place detail and the route schematic, in both locales and both appearances.
     - 🟠 **The Swift and Kotlin token artefacts have never been compiled** — no compiler exists in this
       repo. They carry an `UNVERIFIED` banner and are constants-only so a fix is an emitter change.
       Compiling them is **WP3-3's** first job; nothing may claim they work until it has.
     - 🟠 **`displayName`/`code` and the derived fares did not move to the edge** (WP3-4 priorities 4–5,
       deliberately not started rather than half-done). `displayName` must be `I18nText`, not a string, and
       the edge must stamp at **four+** assembly points — `remarkKind`'s first pass stamped one of three ETA
       paths and only a test caught it. Fares first need their two `''` defects fixed, or the move publishes
       a known-wrong value to three platforms.
     - 🟡 **The `LocalizedString` brand does not reach data-derived text.** `Text`'s `children` are not
       branded, so an English word concatenated into a kernel-formatted value (e.g. a `RouteMeta` fact)
       compiles. `packages/core` cannot import the brand without inverting the layer graph — this is the
       residual of ADR-054 decision 6's deferral, not an oversight.
     - 🟡 **`useClientPolicy` returns `source: 'served' | 'defaults'` and nothing displays it.** A policy that
       fails to arrive looks *exactly* like a working app, because the defaults are a complete correct
       policy — that is the design and the trap. A one-line readout on `app/workbench.tsx` is the cheapest
       honest fix and is the highest-value ten minutes left in the wave.
     - 🟡 **`app.json` and the web manifest still hold `#111827` literally** — pinned by WP3-1's gate rather
       than generated, because templating them is an Expo build change unverifiable here. Drift closed,
       duplication not.
     - ⚪ **`QueryProvider`'s `staleTime: 15_000` and Nearby's `radius=500` are still literals.** Both were
       argued and left: `staleTime` governs remount refetch (coherent against a 30 s cadence) and making it
       policy-derived means threading a hook into the provider that builds the `QueryClient`. `radius` is
       arguably the seventh policy knob if anyone wants one.
     - ⚪ **The boundaries `walk()` now skips `dist` and the tool caches.** Recorded because of *how* it
       surfaced: WP3-2's new literal rules fired three times at integration, all inside a stale
       `apps/mobile/dist/**` bundle — i.e. on *yesterday's source*. It was green in the authoring worktree
       (which had never run `build:web`), so the gate was red only for whoever had built recently. A gate
       that reports build output is a gate people learn to ignore.
   - **Wave 5's own loose ends (2026-07-30, extended after the review pass 2026-07-31), highest-consequence
     first** — each is also a numbered row in `docs/proposals/03` now, because this repo has twice had a
     day-one requirement sit in prose that no work package owned (WP2-8, WP2-9) and get done only because
     somebody noticed:
     - ✅ **WP5-4 done 2026-08-03** ([ADR-073](./08-decision-log.md#adr-073--a-failed-board-is-not-an-empty-board-per-pole-eta-failure-on-the-wire)) — the heaviest item a rider
       could feel, and the diagnosis moved one layer from where the row put it. The bug was not that
       `coalesce` *swallowed* a rejection; it was that `coalesce` **took a `fallback` at all**, so a cache
       decided what a failure meant for every one of its callers — one layer below the two places that
       enforce *"a failed round is not a departure"*, which is why the rule was written down twice and
       defeated anyway. The parameter is gone; `/v1/etas/:id` answers `{ etas, failed }` keyed on the
       **pole** (a place is N boarding points and an upstream board call is per point);
       `retainFailedPoles` in `packages/core` is the one rule both engines apply, with 10 corpus rows and
       3 named boundary rows. A **breaking** wire change — `CONTRACT_VERSION` 2.0.0 — taken now because
       ADR-052 §5's deprecation window is genuinely empty until WP0-5 and will not be afterwards.
       **`routes=` filters readings and never failures**, and a partial answer is a 200 rather than a 502.
       Residual: WP5-13 below.
     - ✅ **WP5-5 done 2026-08-03** ([ADR-074](./08-decision-log.md#adr-074--the-live-rounds-corpus-one-table-two-runtimes-and-the-rule-that-binds-two-engines)) — `packages/core/fixtures/live-rounds.json`, 11 rows,
       driven by the poll emulator on one side and by the **real `EtaHub` over a real WebSocket** on the
       other. It could not be a shared module (`layers.json` forbids `server → client`, tests included, and
       `@nextbus/api-client` is not even a dependency of `@nextbus/edge`), so it is a corpus, exactly as
       ADR-060 argues for domain rules. It asserts what a listener holds *when each round settles* — not the
       frame transcript, because a stateful server answers a `subscribe` before it has polled and a poll
       emulator cannot, so no implementation of either could make the two transcripts equal. It carries the
       accepted target set, which the old matrix deliberately did not (ADR-056 decision 17 explains why
       adding it *there* would have asserted the stale echo). The existing matrix stays, with a stated
       division of labour: frame rules there, round rules here.
     - ✅ **WP5-6 done 2026-08-03** ([ADR-076](./08-decision-log.md#adr-076--the-live-engine-is-selected-by-the-environment-and-the-default-stays-poll)) — both app shells select `poll` | `socket` from the
       environment, the read staying per-renderer (the Expo inliner visits only a literal
       `process.env.X`) while the decision is one declaration in `live/select.ts`. The default is still
       `poll`; there is no `auto`; an unrecognised value falls back and warns, naming the value and the two
       legal ones. `_LIVE_URL` is wired too. **This is the line that un-latches the review's five
       `eta-hub.ts` findings** — ADR-076 lists the three things that stand behind them now rather than
       asserting the shard is sound, and the default staying `poll` means nobody is exposed by upgrading.
     - ✅ **WP5-7 done 2026-08-03**
       ([ADR-079](./08-decision-log.md#adr-079--one-request-per-round-the-batch-eta-endpoint-and-nearby-as-a-live-adopter))
       — `/v1/etas?ids=…` answers about a whole round, so the poll emulator makes **one** request per
       cadence for a set instead of one per target, and both Nearby renderers now subscribe. The **id
       parameter repeats rather than carrying a delimiter**, because `,` is a legal `idchar` and a query
       string decodes `%2C` before anything could split on it (verified, not assumed); the answer is
       enveloped per id because a flat list is *undecodable* — the target→pole map lives in the dataset;
       a per-id failure is an entry with a `200`; the cap is 12 on the wire with a `400` over it and the
       client chunks. `narrowEtasToRoutes` became a kernel rule the edge and the transport both call, and
       `liveTargetsKey` is in the kernel because an array in a hook's dependency list is a **request
       storm**. **Two live defects on mobile Nearby fell out of it:** its `Date.now()` could never advance
       (no `refetchInterval` had ever existed in that file) so the staleness cue could not fire *and* the
       arrivals never refreshed at all — 0 requests per window, not 1 — and a failed first load was
       permanent. Both fixed. `CONTRACT_VERSION` unmoved: 7 → 8 paths, 36 → 38 schemas, additive.
     - ✅ **WP5-8 done 2026-08-03**
       ([ADR-078](./08-decision-log.md#adr-078--rule-7-is-enforced-per-commit-over-a-range-and-an-empty-range-is-a-failure))
       — rule 7 is enforced per commit over a PR's range in `ci.yml`. The rule is one function,
       `docsVerdict({ files, bypass })`, and both modes call it: the `PreToolUse` hook over the *index* with
       the bypass off the command line, `--range <base>..<head>` over each commit's `diff-tree` with the
       bypass off its *message* (so `--no-verify` skips a hook, never a review). **An empty range is a
       failure**, `--no-merges` keeps a merge from passing vacuously and drops `pull_request`'s synthetic
       one, `--root` is what makes an initial commit examinable at all, and a **shallow clone fails the
       selftest's live control by name** — `actions/checkout`'s default depth would have had it examine one
       commit and report success, so `fetch-depth: 0` is now load-bearing for two steps. Turned on with no
       grandfathering because it was measured first: **all 51 non-merge commits in this history pass** (44
       touch code, 12 claim `[docs-ok]`). Still **not** a git hook — a `git commit` outside Claude Code gets
       no warning, it gets a red PR, which is the honest division of labour.
     - ✅ **WP5-9 done 2026-07-31** on `wave5-followups-v1`
       ([ADR-072](./08-decision-log.md#adr-072--an-arrival-is-a-line-at-a-kerb-not-a-line-at-a-place)) — the
       model's unit of *an arrival* was (line, place) while its unit of *a row* had become (line, pole), and
       they are now one unit: `dedupeEtas` keys on `operator|routeNo|bound|stopId`, so a line boarding at two
       kerbs publishes a reading at each. Two service-type variants at *one* kerb still collapse, which is the
       same rule rather than an exception — nobody chooses a timetable variant and everybody chooses a kerb.
       **Two defects the row did not know about were found by sweeping real data, not by reading code:**
       `/v1/stop` indexed readings by **route id alone** and so handed a row a reading off the other kerb
       (1 of 37 places, now 0), and **2 of 2 124** readings name a service-type variant no row at their own pole
       lists, so a strict pair match would have blanked a real arrival. Both close by the edge calling
       `applyLiveEtasToStopDetail` — **one rule for the HTTP payload and the live merge**. **Read ADR-072
       decision 4 before porting the merge:** exact `(pole, routeId)` first, then the soonest for that row's own
       line **at its own pole**, and the fallback must never cross a kerb. The payload check inverted the
       expectation: `/v1/etas` is **unchanged at all eight heaviest interchanges** and the growth is +1.1 % on
       `/v1/stop`. **The build hash does not move**, so no publish.
     - ✅ **WP5-10 + WP5-11 done 2026-07-31** on `wave5-followups-v1`
       ([ADR-071](./08-decision-log.md#adr-071--what-counts-as-one-boarding-point-and-what-a-rider-is-told-about-two)) —
       decision 13's accepted display cost, closed from both sides. One physical pole published under two
       upstream ids is now **one member** with the other id in its `aliasIds` (2 m, derived from the ~1.1 m
       coordinate grid and confirmed by the build: 85 qualifying pairs at exactly four separations, nothing
       between the grid diagonal and two steps), and where two poles are genuinely two, `poleSideOctants`
       puts a **compass side** on the heading (10 m floor — a *different* number on purpose: declining to
       name a side is weaker than asserting two poles are one). **Read ADR-071 decision 3 before touching
       any of it:** a reading is stamped with the pole whose board it came off, an alias is an addressable
       pole rather than a spelling to be replaced, and the collapse lives in `dedupeRoutes`' **key** — the
       first design stamped readings with the boarding point and blanked every arrival at a folded pole on
       all three engines. The build hash moved to **`1ccad7436a8df480`**, so production needs a publish.
     - ✅ **WP5-12 done 2026-08-03**
       ([ADR-080](./08-decision-log.md#adr-080--what-tells-two-boarding-points-apart-in-the-order-the-data-can-support-it))
       — and **the row was wrong about its own population, which is the finding.** The band reproduces
       exactly (141 pairs / 115 places over build `ceb33eed99461e04`), and its acceptance's prohibition is
       now a number: one latitude grid step flips the octant in **27 of 141 pairs (19 %)**. Two of its
       three leads are dead, measured — *a code in one locale only* resolves **0 of 141 by construction**
       (the band's own predicate is "identical name in every locale"), and *which pole you are closer to*
       is **34.4 % wrong for a rider standing at one of them**, because `SNAP_GRID_M` is 25 and the snap
       displaces the fix by a mean of 10.07 m, deterministically. The answer was the shape the row did not
       list: **the heading throws away the pole's own name**, and 143 of the 258 declined groups have names
       that differ. `poleDistinctions` answers with at most one of a compass side (byte-identical to
       `poleSideOctants`, asserted as a property), the pole's own name (folded through `poleNameKey` —
       **never bytes**; 21 groups differ only by case or punctuation), or *"Another stop a few steps away —
       check the sign"*. **Units** at the same 10 m — no third threshold — are what make the mixed place
       honest: at Lok Hin Terrace two coincident poles now share a side *and* say they are adjacent while
       the pole 50 m away gets its own side and is not called adjacent, where today all three are told
       nothing. `poleFlagCode` borrows a flag-shaped code across locales (Prince Edward's MK356/MK357),
       gated because 12 of 63 candidates are translated phrases. **No dataset rebuild, no favourite
       moves.** Cost: places carrying a cue 226 → 464 of 10 115. Still open: **54 poles in 22 groups are
       told nothing**, and ADR-072's both-kerbs favourite is explicitly declined here rather than
       smuggled in.
     - ✅ **WP5-14 done 2026-08-03**
       ([ADR-081](./08-decision-log.md#adr-081--the-frames-carry-failed-and-a-round-whose-failure-set-moved-is-news))
       — the live frames carry `failed`, so a card says *"Live times unavailable"* on the **live path** and
       not only at first paint. The decision that makes it correct is one the row could not have
       anticipated: **a round whose failure set moved is news even when no reading did.** Without it the
       delta branch is silent for exactly the round an outage produces — a kerb stops answering,
       `retainFailedPoles` keeps its readings, so nothing changed and nothing is gone — and a recovered
       kerb's marker would outlive the recovery by a cadence. `sameFailures` is that predicate (in the
       kernel, called by both engines, and it deliberately ignores the error *message*), `unionFailures`
       builds the round's set identically on both sides and dedupes by pole. An absent `failed` means
       **empty**, not unchanged; pole ids only, so a whole-target failure stays a `status` frame. **Found on
       a real socket, not reasoned about:** a re-`subscribe` is answered from stored readings, so answering
       it with `failed: []` paired six real readings with a claim that nothing was refusing — the shard now
       carries the set forward for surviving targets. A *reconnect* still starts blank; stated, not fixed.
       ADR-074's corpus grammar gained a `failed=[…]` column and **the real Durable Object reproduces all
       11 rows independently over a real socket**. Verified with the KMB upstream unroutable: the socket
       produced `delta changed=0 gone=0 failed=[3 kerbs]` — the frame that was silence before this row —
       and in the browser the marker was still on the card after the times had advanced.
     - 🟡 **A favourite with no current arrival renders an empty card** — pre-existing, found by WP5-11, and
       **unowned**: `FavoritePlaceRow` drops rows without an `eta`, so an empty card cannot be told from a
       broken favourite key by eye. Wants a row of its own beside WP5-4; see *Not done yet* above.
     - 🟡 **A rider who stars one line at *both* kerbs sees one Favourites row** — left by WP5-9 (ADR-072) and
       verified in a browser. The card's collapse-to-one-row-per-line merges them, which is right for a card
       with no kerb heading and wrong for an explicit choice. **WP5-12 owned this and declined it explicitly**
       ([ADR-080](./08-decision-log.md#adr-080--what-tells-two-boarding-points-apart-in-the-order-the-data-can-support-it)):
       it needs a per-row kerb label on a compact card, which `soonestPerLine` and `StopCardView` refuse
       for the same reason they refuse a per-kerb failure count — so it is **unowned again** rather than
       closed over. The
       alternative is ADR-072's rejected collapse on what the row *prints* (26 of 43 cross-pole lines show
       different destinations at their two kerbs). WP5-12's other cheaper lead from WP5-9 **is** built: at Fu Kin
       Street the two kerbs' **names** differ ("outside" vs "opposite" Sin Sam House, 1.51 m apart) while
       `poleHeading` prints a bare "GMB" for both, because GMB names carry no stop code.
     - 🟡 **`stopCardView`'s "keep the first" relies on producers sorting soonest-first** — pre-existing (the
       cap already did) and now load-bearing for the *value* shown as well as the row order, since a producer
       that stopped sorting would silently show the **later** bus of a line. **Owner: unassigned**, and it
       belongs to whoever adds the next producer — WP5-7's batch `/v1/etas?ids=…`.
     - 🟡 **`apps/edge/test/wire-conformance.test.ts` falls through to the live internet** — its `fetch` stub
       ends `return realFetch(input, init)`. It flaked once during WP5-9 and has not reproduced in ~10 runs, but
       a gate CI runs with a live escape hatch is a red build a re-run turns green. Fix: fail on an unrecognised
       URL. **Owner: unassigned.**
     - 🟡 **`asyncapi.json` has never been validated against the official meta-schema.** Its gate
       *transcribes* the closed field lists rather than validating (`@asyncapi/parser` was not added), and the
       Operation Object's full field list is deliberately **not** transcribed because nothing here has read
       it. Both the script header and `packages/contract/README.md` §7 say so. The gate's denial of numeric
       `exclusiveMinimum`/`exclusiveMaximum` is marked *unsettled* for the same reason — draft-07 §6.2.3
       specifies them as numbers, we emit neither, and the first person who needs a bound settles it with a
       citation.
     - 🟡 **The gates' comment-stripping lexers were quote-blind, and one was measurably wrong.**
       `scripts/check-one-endpoint-declaration.mjs` was written with `check-view-transport-free.mjs`'s lexer
       verbatim and went **blind** on `packages/contract/src/asyncapi.ts`, where the prose
       `'/components/schemas/*'` *inside a string* opened a block comment that never closed. Only the stale
       allowlist entry made it visible — a gate whose allowlist can go stale reports its own false negatives.
       Both skip quoted spans now; measured first, and none of the view gate's 74 files had the shape, so that
       one was latent rather than live. **`scripts/boundaries/check.mjs`'s `bannedSyntax` still does not strip
       comments at all** (it made Wave 5 reword a kernel comment that merely *named* the forbidden
       constructs), and adding a stripper there without a selftest scenario would be worse than the gap.
     - 🟡 **`retrying` is reported for a per-target failure even when it is permanent**, and `seq` is
       monotonic across a re-subscription on the server while the poll emulator resets it. Two divergences the
       matrix does not cover; changing either should change both, and nothing binds them (WP5-5).
     - ⚪ **`SnapshotFrame.at` / `DeltaFrame.at` have no behavioural reader** on the client — the reducer
       ignores them, and that is now the *complete* list: `SnapshotFrame.targets` was on it until the review
       gave the accepted-set echo a reader (ADR-056 decision 18). Same shape as the `observedAt` finding:
       either something reads them or the description should say "diagnostic". And **two comments still assert `observedAt` is the staleness field**
       (`apps/mobile/providers/QueryProvider.tsx:11-13`, `apps/edge/src/eta-cache.ts:15`) — `isStale` reads
       `dataTimestamp` and always has; the schema description was corrected in Wave 5, those comments are the
       residue.
     - ⚪ **Small, argued, left:** `packages/core` should export `canonicalEtas` rather than have the server
       reach it through `diffEtas([], etas).changed`; `LiveEtaController.engine` exists and **no screen reads
       it**, so there is no "live vs polling" label for a rider (it needs an i18n key and a decision about
       what the word promises); `apps/mobile` uses `tsx` in `build:web` without declaring it (the majority
       precedent — `apps/edge` is the exception); and mobile Nearby still has no `refetchInterval` where web
       Nearby does, with the web file's comment claiming they match.
2. **Search polish** (ADR-037 follow-ups) — the content-hash `version` landed with WP2-7; still open is an
   **omnibox** (route + stop in one box); "routes to <place>" reverse search; direction toggle (P11) on the
   landed route.
3. **WP0-5 — deploy + CI + custom domain** (the one thing between here and a live URL, and **deliberately
   deferred until most other waves land** — owner's call, 2026-07-27). Create the real
   resources (`wrangler kv namespace create DATASET`, `wrangler r2 bucket create nextbus-builds`), replace the
   placeholder id in `apps/edge/wrangler.toml`, add the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
   secrets and the `EDGE_URL` repo variable the dataset workflow already reads, **rehearse the publish against
   a `--preview` namespace first** — two builds, so the ~20k-key prune runs for real once before it can touch
   production ([ADR-061](./08-decision-log.md) decision 2) — then run `pnpm dataset:publish`
   against **real** KV/R2 for the first time, **then set `DATASET_PUBLISH_ARMED=true`** to re-enable the
   nightly cron (it is skipped until then — see `docs/10` "Configuration & secrets"; a
   `workflow_dispatch` run is the way to test the credentials first), ✅ **`ci.yml` landed with Wave 5** — typecheck · lint · test ·
   `wrangler deploy --dry-run` · `git diff --exit-code`, on a clean checkout, no credentials needed — so what
   is left here is: uncomment `[[routes]]` / `workers_dev = false` in `wrangler.toml` with the real hostname,
   add the `preview_id`, set `DEPLOY_ARMED=true` to wake the already-written deploy job, and write the Pages
   half for `apps/mobile/dist` (deliberately not written: it needs a Pages project **and** the decision about
   which hostname the PWA is built against, because `build:web` bakes it into the service worker's caching
   routes). Confirm `GET /v1/health` reports `"dataset":"kv"` and
   `datasetBuildsThisIsolate: 0`. Also **blocked** on a domain + a Cloudflare account (no auth in this
   environment). *(**Own crawl → KV/R2** is now a separate, smaller job: the KV/R2 pipeline exists — only the
   source needs swapping, in `scripts/build-dataset.mts`. It buys self-reliance and true zh-Hans.)*
4. **Street-level stop photos** ([ADR-050](./08-decision-log.md#adr-050--stop-imagery-google-street-view-deep-link-now-hk-streetscape-360-as-the-inline-target)) —
   the Google Street View **deep link** is hours of work, keyless and free; do it with or before the map work.
   Then **Streetscape 360** inline, once we know whether a coordinate→panorama lookup works without their JS
   SDK (email `3dmap@landsd.gov.hk` for the free key and ask).
5. **Map view** (MapLibre) for Nearby — the tiles are already solved: consume `lib/tileSource.ts` and it
   inherits the LandsD basemap + label overlay that `MiniMap` uses.
6. **Honest-motion slice** — number-flip / split-flap ETA animation, freshness pulse, shimmer skeleton,
   reduced-motion + a11y pass (Reanimated is installed/wired but unused), swipe-to-favourite + haptics.
7. **Departure-board mode** (ADR-026 follow-up) — an alternate Nearby view: one ETA-sorted stream of next
   departures across nearby stops; the natural home for the Split-Flap / Dot-Matrix display liveries.
8. **Direction-aware stop clustering** ([ADR-042](./08-decision-log.md#adr-042--direction-aware-same-kerb-clustering-n-member-places-supersedes-adr-022s-pair-merge--invariant) — study in `.context/stop-merge-study/`).
   **Quick win ✅ done (2026-06-11):** the existing cross-operator pair merge now applies a **direction gate** —
   reject a candidate whose stops' **mean travel bearings** disagree by >45°, unless a co-run KMB+CTB route lists
   both at the same sequence position (`directionAgrees`/`bearingDeg` in `dataset.ts`). **Backend now fully built
   & verified (2026-06-11):** N-member single-linkage clustering (`buildPlaces`) with cluster-level vetoes +
   bearing-spread cap + same-operator members; per-place ETA fetch (KMB `stop-eta` 1 call/pole, CTB per-route to a
   budget, dedupe) returning an honest `routeCount`; `/v1/stop` carries member poles + per-route pole ids; name
   chosen once. Belair → 2 kerb-split places (live + snapshot); ≈2,010 clusters / 5,461 stops. **Place UI now built
   (2026-06-11):** Nearby cards show soonest ≤6 + "+N more routes" (honest `routeCount`); **Place detail** groups
   routes under their pole with a multi-pin `MiniMap`, a walk *range*, and route→stop→place nav (`?pole` anchor).
   **Member-keyed favourites ✅ done (2026-06-15):** per-route saving keyed on the member pole id
   (`${operator}:${eta.stopId}`) — favourite via the route-schematic bottom sheet + a per-row `SaveStar` in Place
   detail; Favourites-tab groups by place (resolve each saved pole → place via `getStop`). See item 0.
   **Direction tag ✅ done (2026-06-15):** a place's `meanBearingDeg` rides on the wire `Stop.bearingDeg`;
   `formatBearing` (`@nextbus/core`) renders a localized 8-point "-bound" label preceded by a `BearingArrow`
   (rotated compass arrow) on the Nearby card + Place summary — Belair now reads "↗ Northeast-bound" vs
   "↙ Southwest-bound" (browser-confirmed). Same pass: operators comma-separate ("Citybus, KMB"); `formatDistance`
   drops the unit space ("200m"). **Confidence + audit ✅ done (2026-06-15):** every `IndexPlace` carries a 0–100
   `confidence` + `bearingSpreadDeg` (`placeConfidence`); high-spread audit cleared the risky tail (22 GOOD / 1
   UNCERTAIN / 0 direction fusions — `.context/stop-merge-study/high-spread-audit.md`).
   **Remaining (ADR-042 "Open follow-ups"):** (a) **circular-route heading** — a "which way round" cue for loop
   routes like KMB 284; (b) **cluster-review UI** — a one-off internal tool to eyeball/accept-split groupings,
   sorted by `confidence` worst-first; (c) optional **18-district gazetteer** to upgrade the direction tag to the
   friendlier "towards {district}" wording (compass ships now; "towards X" isn't otherwise derivable).

## 📍 Key file pointers
- DataSource seam → `packages/core/src/datasource.ts`; EdgeClient → `packages/api-client/src/index.ts`
- Edge logic → `apps/edge/src/{nearby,stop-route,search-index}.ts` (`stop-route.ts` has `resolveMembers`/
  `toMergedStop` for `P:` place ids); multi-op index + same-kerb `buildPlaces` →
  `packages/data-normalize/src/dataset.ts` (KMB own-crawl in `kmb-static.ts`, for the future)
- **Dataset pipeline (ADR-055)** → seam + KV reads `apps/edge/src/dataset.ts`; shard shapes/keys
  `packages/data-normalize/src/shards.ts`; build + publish `apps/edge/scripts/{build-dataset,publish-dataset}.mts`
  (`pnpm dataset:build` / `pnpm dataset:publish`); schedule `.github/workflows/dataset.yml`; bindings
  `apps/edge/wrangler.toml` + `src/{env.ts,bindings.d.ts}`. Health check → `GET /v1/health`
- **ETA coalescing (ADR-057)** → `apps/edge/src/eta-cache.ts` (`coalesce`, `ETA_TTL_SEC`)
- **The live protocol (ADR-056)** → frames `packages/contract/src/wire/live.ts` → `asyncapi.json`; rules
  `packages/core/src/live.ts` + `spec/live.spec.json`; the port `packages/ports/src/live-transport.ts`;
  engines `packages/api-client/src/live/{engine,poll,memory,socket,controller}.ts`; where the API is
  `packages/api-client/src/endpoint.ts`; the shard `apps/edge/src/{live,eta-hub}.ts`; the screen's ten lines
  `apps/mobile/lib/useLiveEtas.ts`; the proofs `apps/mobile/test/seam-substitution.test.tsx` +
  `packages/api-client/test/live-matrix.test.ts` + `apps/edge/test/eta-hub.test.ts`; the gates
  `scripts/check-view-transport-free.mjs` + `scripts/check-one-endpoint-declaration.mjs`
- **CI / config topology** → `.github/workflows/ci.yml` (+ `dataset.yml`); the variable inventory
  `.env.example` at the root, with the loaded files at `apps/{mobile,web}/.env.example`; docs/10
  "Configuration & secrets"
- **Tiles (ADR-049)** → Worker proxy `apps/edge/src/tiles.ts`; client seam `apps/mobile/lib/tileSource.ts`;
  consumer `apps/mobile/components/MiniMap.tsx`; projection maths `packages/core/src/mercator.ts`
- **PWA / offline (ADR-058)** → `apps/mobile/workbox.config.mjs` · `apps/mobile/scripts/build-web.mjs`
  (`pnpm --filter @nextbus/mobile build:web`) · `apps/mobile/lib/serviceWorker.ts` ·
  `apps/mobile/providers/QueryProvider.tsx` · fix snapping `packages/core/src/geo-snap.ts`
- **The domain kernel (Wave 2)** → `packages/core/src/{stop-name,stop-detail,route-detail,mercator,geo-snap}.ts`,
  each pinned by `packages/core/spec/<module>.spec.json` and consumed by `test/<module>.test.ts`
- **The derived client view (WP4-0, ADR-068)** → `packages/core/src/stop-card.ts`: `displayName`,
  `stopCardCaption`, `stopCardView` (one card) and `nearbyView` (the ordered list), plus `etaUrgency`,
  `etaReadout` and `remarkView` in `src/eta.ts`. **`apps/mobile` derives nothing** — `StopRow` takes a
  whole `StopCardView`, `EtaBadge` takes `{label, urgency, stale}`, `RemarkTag` takes a `RemarkView`,
  `StopName` takes a `StopCardName`. Adding a rule to a screen is now the smell: it belongs here, or
  `apps/web` will not see it
- **Error taxonomy (ADR-064)** → table `packages/contract/src/wire/responses.ts` (`ERROR_CODES`); the only
  way to build a failure `apps/edge/src/errors.ts`; client `EdgeRequestError` in `packages/api-client`
- Tests → `apps/edge/test/*.test.ts` (workerd + simulated KV/R2) · `packages/core/test/*.test.ts` (the
  corpus) · `apps/mobile/lib/*.test.ts`; `pnpm test`
- Screens → `apps/mobile/app/(tabs)/index.tsx` (Nearby), `app/stop/[id].tsx`, `app/route/[id].tsx`,
  `app/(tabs)/favorites.tsx`; tab shell + floating bar → `app/(tabs)/_layout.tsx` (geometry in
  `apps/mobile/lib/tabBarLayout.ts`); location → `apps/mobile/lib/useLocation.ts`
- **Design tokens → `packages/ui/tokens.json`** — the one file a human edits (DTCG, WP3-1). Everything
  else is generated by `pnpm --filter @nextbus/ui tokens:emit` and drift-gated: `src/tokens.generated.ts`,
  `preset.js`, `apps/mobile/global.css`, `generated/tokens.json` (resolved, for build scripts),
  `generated/NextBusTokens.{swift,kt}`. Hand-written and *not* generated: `src/themes.ts` (the
  light/dark var maps) and `src/elevation.ts` (`elevationStyle()`, the one iOS/Android/web mapping).
  `src/typography.ts` and `src/tokens.ts` are **deleted** — their values live in `tokens.json`.
  (Spec: [`docs/09`](./09-theme.md))
- Design-system primitives → `apps/mobile/components/Text.tsx`, `Card.tsx`, **`Icon.tsx`** (Lucide),
  **`GlassView.tsx`** (liquid-glass; web SVG refraction via `apps/mobile/lib/liquidGlass.ts`, ported from
  nikdelvin/liquid-glass),
  **`StopRow.tsx`** (flat nearby/favorites item); distance/walk helpers → `packages/core/src/geo.ts`;
  theme resolver → `apps/mobile/lib/useTheme.ts`; fonts/splash → `apps/mobile/app/_layout.tsx`
- Prefs (theme/appearance/locale/**favorites**, Zustand+persist) → `apps/mobile/lib/preferences.ts`;
  Settings (language + appearance) → `apps/mobile/app/(tabs)/settings.tsx`; Ink theme (`themes[mode]`) → `packages/ui/src/themes.ts`
- Decisions → [`docs/08`](./08-decision-log.md)
