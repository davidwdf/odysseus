# Consuming NextBus HK from iOS or Android

This document is for someone starting a **native repo tomorrow**. It is not an inventory of this
monorepo; it is the list of artefacts you consume, the rules you cannot infer from them, and — just as
important — the things nobody here has verified on your behalf.

Read it in order. §1 is what to take, §2 is how to generate from it, §3 is what you will get wrong if
you guess, §4–5 are the three fields and the one grammar that carry the most surprise per byte, §6 is
the half of the port that no schema can give you, and §7 is what is **not** guaranteed. §7 is the one
people skip and then rediscover.

One framing to start with, because it decides how you spend your first week:

> **Generating models from `packages/contract/openapi.json` is half a port.** Wire *shapes* are
> generated from a single Zod declaration, so every platform agrees about them by construction. Domain
> *rules* — deduping arrivals, when a bus counts as "due", bearing labels, fare estimates, id parsing —
> cannot be generated, so you will hand-write them a third time. §6 is the mechanism that keeps your
> third copy honest, and it is the part of this document worth the most to you.

---

## 1. What this repo publishes for you

<!-- BEGIN GENERATED: artefacts -->
| Artefact | What it is today | What you do with it |
| --- | --- | --- |
| `packages/contract/openapi.json` | OpenAPI 3.1, v2.0.0 — **8 paths, 38 component schemas** | Generate your models. This is the only artefact you *must* consume. |
| `packages/contract/asyncapi.json` | AsyncAPI 3.0.0 for the `/v1/live` socket — **6 frames, 49 component schemas** | Read it. **Do not plan to generate from it** — there is no AsyncAPI→Swift generator at all, and the Kotlin one cannot serialise. See §7. |
| `packages/contract/src/ids/id-grammar.abnf` | ABNF (RFC 5234) for every id that crosses the wire | Hand-write a parser against it. The `ids` corpus below is what proves your parser agrees with ours. |
| `packages/core/spec/` | **14 corpora, 107 groups, 915 cases, 5 `knownDefect` rows** | Drive your XCTest/JUnit suite from these bytes. This is the domain-rule half of the port. |
| `packages/contract/ui/` | **7 component spec(s)** — Favourites, Nearby, PlaceDetail, PlaceRow, RouteDetail, Search, StopRow; each declares its slots and their order, all five states with what each must *not* look like, its interaction targets and its a11y role (4 state(s) marked `knownDefect`) | The **view** half of the port, and the newest thing here — read §7 before you rely on it. Two renderers drive these today; yours would be the third and the first independent one. |
| `packages/contract/native/ios/CorpusConformanceTests.swift` | **Template — never compiled, never run** | Copy into your test target on day one and make it build. See §6. |
| `packages/contract/native/android/CorpusConformanceTest.kt` | **Template — never compiled, never run** | Ditto, for `src/test/kotlin`. |
| `packages/ui/generated/NextBusTokens.swift` | 122 design tokens — **never compiled** | Compile it. A compile error here is a bug in the emitter, not something to patch in place. |
| `packages/ui/generated/NextBusTokens.kt` | 122 design tokens — **never compiled** | Ditto. |
| `packages/i18n/generated/ios/` | 3 locales × 127 strings + 2 plural messages | `.lproj` bundles — drop in as-is; do not retype a string. |
| `packages/i18n/generated/android/` | 3 resource folders | `values*/strings.xml` — drop in as-is. |
<!-- END GENERATED: artefacts -->

Three notes on that table, all of which are about trust:

- **"Never compiled" is literal.** There is no Swift or Kotlin toolchain in this repository and no gate
  that could compile one. The design-token files and the two conformance templates are generated or
  hand-written output that has been reviewed and never built. Getting them to compile is your job, and
  a compile error in a *generated* file (the tokens) is a bug in its emitter — report it rather than
  patching the output, which is regenerated and would lose your fix.
- **Only `packages/contract/openapi.json` is mandatory.** Everything else is a head start you can
  decline. The corpus in §6 is the one you should not decline.
- **Nothing here is versioned or published to a registry yet.** You consume it out of this git repo, by
  a script, pinned to a commit. See §7.

## 2. Generate your models

The document is OpenAPI 3.1 (`jsonSchemaDialect` draft 2020-12) with every named shape hoisted into
`components.schemas`, which is what gives you stable type names instead of `InlineResponse200`. It is
committed, and `pnpm --filter @nextbus/contract test` fails when it no longer matches the schemas it is
built from — so the copy you fetch is the copy the Worker is held to by its own conformance suite.

Two generator settings are not preferences. Get these wrong and you ship a client that breaks on a
server change that was designed to be safe:

1. **Do not reject unknown properties.** Objects on this wire are open by design (§3). A generator
   configured to fail on an unrecognized key turns every additive server change into a crash.
2. **Generate unknown-tolerant enums.** Seven enums are marked `x-unknown-tolerant`; see §3, and write
   the decode test in §6 before you trust your generator's output.

Regenerate rather than hand-edit, and commit the generated models so a reviewer can see a wire change
arrive. Pin the commit of this repo you generated from; when you bump it, the model diff *is* the
change log.

## 3. What you will get wrong if you guess

<!-- BEGIN GENERATED: conventions -->
*Transcluded verbatim from `openapi.json` → `info.description`, which is **canonical** for wire
conventions. A native repo may only ever receive the OpenAPI document — through a generator
pipeline, a vendored copy, an artefact store — and must still be told these rules, so they live in
the document and are copied here rather than the other way round. Editing the list below is a red
build; edit `packages/contract/src/openapi.ts` and re-emit.*

- **Timestamps** are ISO-8601 with a `+08:00` offset.
- **`"HH:mm"` may exceed 24** — `"25:35"` means 01:35 the next day.
- **Fares are decimal strings.** Compare numerically, display verbatim, never parse to a float.
- **Objects are open.** Additional properties are permitted by design, so a client generated
  from an older revision of this document keeps decoding after a field is added. Do not
  configure your generator to reject unknown keys.
- **A route is served at two service fidelities, and they are two schemas.** `/v1/route/{id}`
  returns `Route` (`service`: `RouteServiceInfo`, with `patterns`); stop responses return
  `RouteSummary` (`service`: `RouteServiceSummary`, which has no `patterns` property at all).
  Decode each against its own type and the absence of a frequency table is never ambiguous.
- **Enums marked `x-unknown-tolerant`** will gain members without a major version bump.
  Generate a fallback case (`case unknown(String)`); do not throw on an unrecognized value.
- **ETAs are approximations.** Do not run a per-second countdown; refresh the value only when
  a new reading arrives, and judge staleness from `dataTimestamp` — the operator's clock.
  `observedAt` is when *we* fetched it, which tells a replayed reading from a fresh one but must
  not be used as the age: a cache replay would then look live. It is also the one timestamp here
  that is `Z`-suffixed UTC rather than `+08:00`, because our layer stamps it.
- **`RouteLite.sortKey` is the order to display, not a hint.** Sort by it verbatim and every
  platform agrees; the ordering it encodes is `localeCompare(numeric: true)`, which has no
  faithful Swift or Kotlin equivalent, so the server computes it rather than asking three
  languages to reinvent it (ADR-063). It is optional only so an older client still decodes.
- **`Eta.remarkKind` is absent when there is no remark** — not `"info"`. Treat the missing key
  as "nothing to classify"; a default of `info` invents an honesty cue the operator did not give.
- **`GET /v1/policy` is advice, not a dependency.** It serves counts, cadences and the ADR-008
  honesty thresholds, `max-age=300`, and **every field is optional**. Compile in your own
  defaults, overlay whatever the document supplies, and never block first paint on the fetch:
  a client that cannot reach it must still be a working client.
- **Every failure returns `ErrorResponse`.** Branch on `code`, and let `retryable` decide
  whether a background client (Widget, complication) retries or prunes the request. The
  status code always agrees with `code`. `error` duplicates `message` and is deprecated.
- **This document does not specify domain rules.** Shapes are generated and therefore agree by
  construction; rules — deduping arrivals, when a bus is "due", bearing labels, fare estimates —
  are hand-ported per platform and are pinned by a language-neutral fixture corpus instead
  (ADR-060). Generating models from this file is half a port. Read
  `packages/contract/README.md` for the other half.
<!-- END GENERATED: conventions -->

The four that bite hardest, with the native specifics the document above cannot carry:

- **Fares.** `"12.5"`, not `12.5`. Keep them as `String` end to end. For arithmetic use `Decimal`
  (Swift) or `BigDecimal` (Kotlin) and never `Double`: `Double("0.1")! + Double("0.2")!` prints
  `0.30000000000000004`, and a fare table that adds up to the wrong cent is a support ticket you cannot
  reproduce. For **display**, print the string verbatim — the operators publish `"12.5"` and `"12.50"`
  and re-formatting loses the distinction.
- **`"HH:mm"` past midnight.** `"25:35"` is 01:35 the next day. `DateFormatter` with `HH:mm` and
  `LocalTime.parse` both **reject** it, so a service-hours string reaches you as a parse failure rather
  than a wrong time — which is the good outcome, provided you handle it. Split on `:`, take the hours as
  an integer, and `hours % 24` with a day rollover. Do not "fix" the upstream value.
- **Unknown-tolerant enums.** The concrete shapes:
  - Swift: `enum OperatorId: Decodable { case kmb, lwb, ctb, gmb, unknown(String) }` with an
    `init(from:)` that falls through to `.unknown(raw)`.
  - Kotlin: a `sealed interface` with a `Known`/`Unknown` pair. A Kotlin `enum class` **cannot** hold the
    raw string, so the obvious generated shape is the wrong one; this is worth checking by hand.
  - Either way the failure mode is severe and delayed: the day a fifth operator ships, a four-case enum
    throws on decode and every installed copy of your app is bricked until a release reaches devices.
    Apple's review queue is in that path. Test it (§6) rather than assuming your generator did it.
- **Open objects.** "Additional properties permitted" is not a formality — it is how this contract
  evolves without a major version. Combined with the rule above, an additive server change reaches an
  old client as an ignored field and an unrecognized enum member, both survivable, and that is the whole
  evolution strategy.

## 4. Three things the server now owns, so you do not have to

The line between server and client is deliberate: **the server owns content and order, the client owns
presentation.** Three fields are the useful worked examples.

### `RouteLite.sortKey` — the best example in the whole contract of why the server owns order

Riders search routes by number, and bus route numbers sort *numerically inside a string*: `9` before
`10A` before `11`. In TypeScript that is one call — `localeCompare(b, undefined, {numeric: true})`.

**There is no faithful Swift or Kotlin equivalent.** Not "it is more code": the platform primitives
disagree with each other and with the web. So the server does the work once and ships the answer:
`sortKey` is a byte-comparable string with each numeric run zero-padded, `10A` → `0010A`. Sort by it
with a plain byte comparison and all three platforms produce the identical list.

What to actually do:

- Sort by `sortKey` verbatim. Do not sort by `routeNo`, and do not "improve" the ordering locally — the
  point is agreement, and a local improvement is a divergence.
- It is `optional` only because ADR-052 makes every added field optional so older clients keep
  decoding. If it is absent, derive it the way `routeSortKey` in `packages/core/src/search.ts` does;
  that fallback exists so a client is never blocked, not as an invitation to skip the field.
- This generalizes. When you find yourself reaching for a locale-sensitive or ICU-version-sensitive
  primitive to reproduce something the web app does, that is a signal the value should cross the wire
  instead. Raise it rather than porting it.

### `Eta.remarkKind` — classified server-side, and **absent** when there is nothing to classify

Operators publish remarks as prose, not codes, so classifying one ("is this a timetable estimate or a
tracked bus?") is a text match — a domain rule, pinned by the corpus at `eta#classifyRemark`. The edge
runs that rule and ships the result, so three platforms do not each write the match.

The trap is the absent case. **No remark means no `remarkKind` key at all** — not `"info"`. Decode it as
an optional and leave it nil/null. Defaulting it to `info` manufactures an honesty cue the operator
never gave, which is precisely what ADR-008 exists to prevent.

`remark` is the wording to show a rider; `remarkKind` is the thing to branch on. Never match on the
prose yourself.

### `ClientPolicy` — six numbers, and a fetch you must be able to lose

`GET /v1/policy` serves counts, cadences and the honesty thresholds. It exists so tuning a threshold is
one edge deploy instead of three store releases.

Consume it like this, and the order matters:

1. **Compile in your own defaults.** `resolveClientPolicy` in `packages/core/src/policy.ts` is the
   reference, and its defaults are the values to copy.
2. **Overlay whatever the document supplies, field by field.** Every field is optional *individually* —
   a partial policy is a legal policy, so the edge can move one number and say nothing about the rest.
3. **Never block first paint on the fetch.** `max-age=300`, so cache it; if it never arrives, your
   compiled-in defaults are a complete, working policy. A client that cannot start without this
   endpoint has converted a tuning convenience into a hard dependency.

What is deliberately *not* in it: colours, sizes, animation durations. The server owns the threshold; you
own the tone it renders in. A gate in this repo fails if anyone tries to send a colour in a policy.

## 5. Ids are a grammar, not a `split(":")`

Every id that crosses the wire is a delimited string — `KMB:6:outbound:1`, `KMB:1234`, `P:<a>+<b>` — and
the grammar is written down once, as ABNF, at `packages/contract/src/ids/id-grammar.abnf`. It is ABNF
rather than TypeScript precisely so you can consume it.

Four things that file will not shout at you but that matter:

- **The delimiters are validated absolutely; field contents are barely validated at all.** Operators mint
  the values, so a grammar that enumerated what we have seen would reject the first thing we have not,
  and the failure mode of over-strictness is a rider's saved favourite going 404 because of a rule we
  wrote after they saved it.
- **`serviceType` is an opaque `String`.** Decoding it as an integer loses GMB's ids and turns `"01"` into
  `"1"`.
- **Parsing is total.** A malformed id returns the absent value — never a throw, never a plausible-but-wrong
  result. Ids arrive from persisted favourites and from URLs, so malformed input is ordinary, not
  exceptional.
- **Percent-encode ids in paths.** Place ids contain `+`, which decodes to a space.

The reference implementation is `packages/core/src/ids.ts` and the corpus that pins it is
`packages/core/spec/ids.spec.json` — **not** in this package, despite what ADR-059's title says. The
grammar is a specification and lives here; the corpus is test data and lives with every other corpus, so
one rot check covers them all.

## 6. The fixture corpus — the half of the port no schema can give you

<!-- BEGIN GENERATED: corpus -->
| Corpus | Reference implementation | Groups | Cases | `knownDefect` |
| --- | --- | --: | --: | --: |
| `eta.spec.json` | `packages/core/src/eta.ts` | 21 | 147 | — |
| `favourites.spec.json` | `packages/core/src/favourites.ts` | 3 | 18 | — |
| `geo-snap.spec.json` | `packages/core/src/geo-snap.ts` | 1 | 12 | — |
| `geo.spec.json` | `packages/core/src/geo.ts` | 9 | 81 | — |
| `ids.spec.json` | `packages/core/src/ids.ts` | 10 | 56 | — |
| `live.spec.json` | `packages/core/src/live.ts` | 15 | 177 | — |
| `mercator.spec.json` | `packages/core/src/mercator.ts` | 6 | 37 | 1 |
| `policy.spec.json` | `packages/core/src/policy.ts` | 1 | 7 | — |
| `route-detail.spec.json` | `packages/core/src/route-detail.ts` | 6 | 70 | 3 |
| `route-position.spec.json` | `packages/core/src/route-position.ts` | 1 | 14 | — |
| `search.spec.json` | `packages/core/src/search.ts` | 16 | 134 | — |
| `stop-card.spec.json` | `packages/core/src/stop-card.ts` | 4 | 34 | — |
| `stop-detail.spec.json` | `packages/core/src/stop-detail.ts` | 8 | 70 | 1 |
| `stop-name.spec.json` | `packages/core/src/stop-name.ts` | 6 | 58 | — |
| **total** |  | **107** | **915** | **5** |
<!-- END GENERATED: corpus -->

Each file is `{module, source, version, doc, groups}`; each group is `{doc, cases[]}`; each case is
`{name, why?, knownDefect?, args, expect}`. Read the `doc` and `why` strings — they exist for you
specifically, and they usually name the defect the row was written to catch.

### The six reader rules

The working reference loader is `packages/core/test/corpus.ts`, 91 lines, deliberately thin: everything
it does is what your suite will do, and its header states that being language-neutral is a design
constraint rather than a happy accident. If a corpus needed clever machinery to consume, the corpus
would be wrong.

These six rules are not stylistic. Each is a way a port produces a **green suite that proves nothing**:

1. **Decode the envelope**, and address rows as `<module>#<group>`.
2. **Fail loudly on a missing group — and on an empty `cases` array.** Looping over an empty list is a
   passing test that asserts nothing, and it is the single most likely way this harness rots.
3. **JSON `null` means the language's absent value** — `nil`, `null`, `undefined` — translated at the
   **decode boundary only**. Never map it to a sentinel: an `expect: null` row is asserting that a
   malformed input yields absence, and a port that produced `""` would pass the row while shipping a
   different function.
4. **`nowIso` is a clock reading passed in as an argument, parsed as a fixed `+08:00` offset with no
   host-time-zone dependency.** No test may read the real clock. In Kotlin use `OffsetDateTime.parse`:
   `LocalDateTime.parse` silently discards the offset and `Instant.parse` rejects it.
5. **Geo rows compare with `Approx {meters, tolerance}`.** Trigonometry does not agree to the last bit
   across languages, so the row carries its own tolerance; `tolerance: 0` means exactness is genuinely
   demanded.
6. **`knownDefect: true` still asserts — never skip it.** Those rows record behaviour we agree is *wrong*
   and are keeping identically wrong on all three platforms so the fix is one coordinated change. `why`
   says what `expect` becomes when it is fixed. Skipping them is how three platforms end up wrong in
   three different ways.

### The templates

`packages/contract/native/ios/CorpusConformanceTests.swift` and
`packages/contract/native/android/CorpusConformanceTest.kt` encode all six rules, plus resource loading,
plus a worked example of an exact-match rule and of an `Approx` one, plus the unknown-enum decode test
from §3. **Both carry a banner saying they have never been compiled and never been run, because they
have not.** Copy them in on day one and make them build — that is a smaller job on day one than on day
ninety, and it is the only real mitigation for the corpus going stale relative to your port.

Each template also contains a `coveredGroups` set and a test that fails while any corpus group is
unported. **Red is the intended state on day one**: it is your port's to-do list expressed as a build
failure, and it goes green exactly when your client agrees with the web client about every rule. Do not
weaken it to a warning.

**Vendor the corpus with a script, not by hand.** A copied corpus that has quietly fallen behind this
repo is a suite that passes while the rule it pins has moved — the exact failure the corpus exists to
prevent, reintroduced by the act of copying. Check the freshness of your copy in your own build.

## 7. What is not guaranteed

Read this section twice; it is the honest half of the document.

- **No Swift or Kotlin here has ever been compiled.** Not the design tokens, not the two conformance
  templates. There is no toolchain in this repo and no gate that could add one.
- **No native client exists.** Nothing in this document has been exercised end to end by a real app. It
  is a considered specification, not a tested integration, and the first port should expect to find
  mistakes in it — and to send them back.
- **`ui/*.spec.json` is the newest artefact here and the least proven.** It is emitted, schema-validated
  and drift-gated like the other two, and both of this repo's renderers pass it unmodified — but they are
  a DOM renderer and `react-native-web`, which is to say two web renderers. Nothing has yet asked whether
  a slot order that reads correctly in a flow layout reads correctly in a SwiftUI `VStack`, or whether
  "the visible text is a function of the view model alone" survives a platform whose controls carry their
  own labels. **A state marked `knownDefect` is a target neither renderer meets**, not a description of
  behaviour to copy — check `enforcement` before you make your suite agree with it.
- **Vendoring is unsolved, and these specs make the surface bigger.** Nothing in this repo can tell
  whether your copy of `packages/core/spec/` or `packages/contract/ui/` is current, and a stale copy
  yields a **green** suite pinning a rule that has moved. That was already the one hole in the corpus-rot
  story; adding component specs widens it rather than changing it.
- **`openapi.json` is generated and gated; the prose in §§1–7 is not, except where marked.** The three
  generated regions (the artefact table, the conventions list, the corpus table) are checked against a
  fresh count on every `pnpm test`. Everything else is judgement written by hand and can age.
- **`asyncapi.json` is a specification artefact with a validator, and only aspirationally a codegen
  input.** Four things you would otherwise assume about it, each of which was checked:
  - **There is no AsyncAPI→Swift generator in existence.** Modelina, the reference generator, emits 12
    languages and Swift is not among them; a sweep of `asyncapi.com/tools` found no tool mentioning
    Swift, Objective-C or iOS in any category. Hand-write the frame types from the document.
  - **Kotlin generation exists and cannot serialise.** Modelina's Kotlin output lists JSON, XML and
    binary serialization as "currently not supported", so you get annotation-free data classes and
    hand-write the decode layer anyway — which puts the `x-unknown-tolerant` obligation on hand-written
    code on Android too, exactly as on iOS.
  - **`asyncapi diff` is not an `oasdiff` equivalent.** Its standards table has no
    `/components/schemas/*` pointer, so adding *or removing* a payload field classifies as
    `unclassified` rather than `breaking`. A gate built on it would go green on a removed field, so
    there is no such gate: breaking-change discipline for the frames is ADR-052 §5 plus review.
  - **The document has never been validated against the AsyncAPI meta-schema.** That would need a
    dependency this repo has not taken. `packages/contract/scripts/check-asyncapi-current.mjs`
    transcribes the field lists and constraints that matter from the 3.0.0 spec and the websockets
    binding meta-schema, and each of its rules is watched failing on a synthetic document
    (`--selftest`) — but "AsyncAPI 3.0" here is a careful reading, not a validator's verdict.

  What *is* gated: the document is rebuilt and compared on every `pnpm test`; every schema keyword is
  checked to lie inside the draft-07 ∩ AsyncAPI vocabulary the document claims (the payloads are
  emitted as 2020-12 and AsyncAPI's Schema Object is a superset of draft-07, which the
  `x-json-schema-dialect` extension records); every frame is checked to carry a distinct required
  `type` const, which is the spec's "valid against one and only one message" MUST that no AsyncAPI tool
  enforces; and the socket frames are checked **not** to appear in `openapi.json`.
- **No package here is published.** No registry, no semantic version per artefact, no CI that would
  notify you of a change. `CONTRACT_VERSION` is `1.0.0` and bumps only on a *breaking* wire change;
  additive-optional changes are free and deliberately silent, which is exactly why you should regenerate
  from a pinned commit and read the model diff.
- **No push or pull-request CI runs in this repo at all.** Every gate named in this document runs from a
  package's `test` script, locally and in the pre-commit hook. When something says "gated", that is what
  it means.
- **ETAs are approximations, and at Hong Kong night hours (roughly 01:00–05:30 HKT) there are no live
  arrivals at all.** An empty `arrivals` array is the data, not a bug, and any example output you capture
  at 03:00 will look broken. Do not write a test that assumes a non-empty array.
- **The corpus specifies the rules it covers, and no more.** A rule with no group is a rule you can get
  wrong silently. If you port something the corpus does not pin, say so — the right fix is a new corpus
  group here, not a test only your platform has.

## 8. Keeping this document honest

The failure mode this file is designed against is a real one from this repo's own history: ADR-060
recorded the corpus as "36 groups, 274 cases" and still said so two waves later, by which point it was
`65` groups and `510` cases. A native repo's map of this tree rotting the same way costs a porter a
suite they believe is complete.

So the figures here are not written down — they are counted from the artefacts:

```bash
pnpm --filter @nextbus/contract native:emit   # refill the generated regions
pnpm --filter @nextbus/contract test          # fails on a stale region, or a path this file cites
                                              # that no longer exists
```

`packages/contract/scripts/check-native-guide.mjs` is that gate; it runs as part of `pnpm test`. It
deliberately does **not** claim to check whether any Swift or Kotlin compiles.
