// NextBus HK — fixture-corpus conformance, JUnit 5 template.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  UNVERIFIED — THIS FILE HAS NEVER BEEN COMPILED AND HAS NEVER BEEN RUN.
//
//  There is no Kotlin toolchain in this repository and no gate that could compile it, so nothing
//  below is known to be valid Kotlin. Treat it as a specification with syntax colouring: the *rules*
//  it encodes are load-bearing and were derived from the working TypeScript loader
//  (`packages/core/test/corpus.ts`), but the code is a first draft nobody has built.
//
//  **Making this compile and go green is the first job of the first Android repo**, before any UI. A
//  compile error here is expected. Fix it in your repo, then send the fix back so the next port
//  starts from working code — the value of this file drops to zero the moment it is stale, which is
//  exactly the "codegen becomes stale scaffolding" risk it is trying to mitigate.
//
//  The same banner is on `packages/ui/generated/NextBusTokens.kt` for the same reason. Do not infer
//  from either file's existence that a Kotlin client has ever been built.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT THIS FILE IS FOR
// Wire *shapes* agree across platforms by construction: they are generated from one Zod declaration
// into `openapi.json` and you generate models from that. Domain *rules* cannot be generated —
// `parseRouteId`, `dedupeEtas`, when a bus is "due", bearing labels, fare estimates — so they get
// hand-written a second and third time, in Swift and Kotlin, and nothing about a schema constrains
// them. The corpora in `packages/core/spec/*.spec.json` are the mechanism instead (ADR-060): every
// platform drives the identical bytes and a rule your port got wrong is a red test here rather than
// a wrong minute on a rider's phone.
//
// GETTING THE CORPUS ONTO YOUR TEST CLASSPATH
// Vendor `packages/core/spec/*.spec.json` into `src/test/resources/spec/`. Nothing else is needed —
// Gradle puts `src/test/resources` on the test classpath already.
//
// **Copy them with a Gradle task, never by hand, and check the copy is current in your own build.** A
// vendored corpus that has silently fallen behind this repo is a suite that passes while the rule it
// was meant to pin has moved — the failure this whole mechanism exists to prevent, reintroduced by
// the act of copying.

package app.nextbus.conformance

import app.nextbus.kit.Eta
import app.nextbus.kit.Geo
import app.nextbus.kit.IdParser
import app.nextbus.kit.OperatorId
import app.nextbus.kit.ParsedRouteId
import app.nextbus.kit.RemarkKind
import java.time.Instant
import java.time.OffsetDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

// ── The reader contract ───────────────────────────────────────────────────────────────────────────
//
// Six rules. They are not stylistic — each one is a way a port can produce a green suite that proves
// nothing, and they are stated in the same order in `packages/contract/README.md` §6 and in the
// XCTest template beside this one.

/**
 * One row of a corpus group.
 *
 * `Expected` is very often a *nullable* type at the call site: JSON `null` means "the language's
 * absent value", and **rule 3** is that the translation happens here, at the decode boundary, and
 * nowhere else. Never map `null` to a sentinel — a `parseRouteId` row whose `expect` is `null` is
 * asserting that a malformed id yields `null`, and a port that turned it into `""` would pass this
 * row while shipping a different function.
 */
@Serializable
data class SpecCase<Args, Expected>(
    val name: String,
    /** Prose for a porter: what this row catches. Read it when a row fails. */
    val why: String? = null,
    /**
     * **Rule 6.** `true` marks behaviour we agree is WRONG and are keeping identical across all three
     * platforms until it is fixed in one coordinated change. It **still asserts**. There is no
     * `@Disabled` and no `Assumptions.assumeTrue` anywhere in this file, deliberately: a skipped
     * defect row is how three platforms end up wrong in three different ways.
     */
    val knownDefect: Boolean = false,
    val args: Args,
    val expect: Expected,
)

/**
 * **Rule 5.** A distance assertion carries its own tolerance, because trigonometry does not agree to
 * the last bit across languages and a port is not wrong for differing in the twelfth decimal. A
 * `tolerance` of `0.0` means the row really does demand exactness (a zero distance, say).
 */
@Serializable
data class Approx(val meters: Double, val tolerance: Double)

object Corpus {
    // BEGIN GENERATED: corpus-modules
    /** Every corpus in `packages/core/spec/`. Enumerated rather than discovered: a JVM cannot
     *  list a directory inside a jar. Generated and gated, so a new corpus cannot be invisible. */
    val modules = listOf(
        "eta",
        "favourites",
        "geo-snap",
        "geo",
        "ids",
        "live",
        "location-mark",
        "mercator",
        "policy",
        "route-detail",
        "route-markers",
        "route-path",
        "route-position",
        "search",
        "settings",
        "stop-card",
        "stop-detail",
        "stop-name",
    )
    // END GENERATED: corpus-modules

    /**
     * `ignoreUnknownKeys` mirrors the wire contract: objects are open by design, so a payload with a
     * field this build has never heard of must decode rather than throw. It is *not* a licence to be
     * sloppy about the corpus — a corpus row is data we control, and a typo in `args` should be caught
     * by the fact that the rule then fails, not swallowed here.
     */
    private val json = Json { ignoreUnknownKeys = true }

    fun file(module: String): JsonObject {
        val stream = javaClass.getResourceAsStream("/spec/$module.spec.json")
            ?: error("corpus $module.spec.json is not on the test classpath — check src/test/resources/spec/")
        return json.parseToJsonElement(stream.reader().readText()).jsonObject
    }

    fun groupNames(module: String): Set<String> =
        (file(module)["groups"]?.jsonObject ?: error("corpus $module.spec.json has no `groups`")).keys

    /**
     * The rows of one group, decoded for the caller.
     *
     * **Rule 1** is the envelope: `{module, source, version, doc, groups}`, each group
     * `{doc, cases[]}`. **Rule 2** is the two `error`s below — a missing group and an *empty* `cases`
     * array both fail loudly, because looping over an empty list is a green test that proves nothing,
     * and that is the single most likely way this harness rots into a vacuous pass.
     */
    inline fun <reified Args, reified Expected> cases(
        module: String,
        group: String,
    ): List<SpecCase<Args, Expected>> {
        val groups = file(module)["groups"]?.jsonObject ?: error("corpus $module.spec.json has no `groups`")
        val found = groups[group]?.jsonObject ?: error("corpus $module.spec.json has no group \"$group\"")
        val rows = found["cases"]?.jsonArray ?: error("corpus group $module#$group has no `cases`")
        if (rows.isEmpty()) error("corpus group $module#$group has no cases")
        return rows.map { Json.decodeFromJsonElement<SpecCase<Args, Expected>>(it) }
    }

    /**
     * **Rule 4.** The clock reading a row was written against — passed in as an argument, never read
     * from the device.
     *
     * `OffsetDateTime.parse` is the only correct choice of the three obvious ones, and the other two
     * fail in opposite directions: `LocalDateTime.parse` silently **discards** the `+08:00` and leaves
     * you interpreting the result in the device's zone, while `Instant.parse` wants `Z` and rejects an
     * offset outright. Never involve `ZoneId.systemDefault()` — a row whose result depended on the
     * host zone would be worthless to a second platform and flaky on the first.
     */
    fun at(nowIso: String): Instant = OffsetDateTime.parse(nowIso).toInstant()
}

// ── The suite ─────────────────────────────────────────────────────────────────────────────────────

class CorpusConformanceTest {

    /**
     * Every group this suite actually drives. Add to it as you port each rule.
     *
     * This set is the whole point of the next test: without it, "we have a conformance suite" and "we
     * have ported the rules" look identical from the outside, and a corpus nobody consumes is a
     * specification nobody is held to.
     */
    private val coveredGroups = setOf(
        "ids#parseRouteId",
        "geo#distanceMeters",
        // PORT ME: add one entry per group as you implement it, until the test below passes.
    )

    /**
     * The completeness gate — the native mirror of `scripts/check-spec-coverage.mjs`.
     *
     * Fails while any corpus group is unported, and **that is the intended state on day one**: this is
     * your port's to-do list, expressed as a red test, and it goes green exactly when the Kotlin
     * client implements every rule the web client does. Do not weaken it to a warning; a to-do list
     * that cannot fail a build is a to-do list nobody finishes.
     */
    @Test
    fun `every corpus group is ported`() {
        val unported = Corpus.modules.flatMap { module ->
            val groups = Corpus.groupNames(module)
            check(groups.isNotEmpty()) { "corpus $module.spec.json declares no groups" }
            groups.map { "$module#$it" }
        }.filterNot(coveredGroups::contains).sorted()

        assertEquals(
            emptyList<String>(), unported,
            "${unported.size} corpus group(s) are not ported to Kotlin yet — each is a domain rule " +
                "this client does not agree with the web client about",
        )
    }

    @Serializable
    data class IdArgs(val id: String)

    /**
     * A worked example: the id grammar. The reference implementation is `packages/core/src/ids.ts`,
     * the grammar it implements is `packages/contract/src/ids/id-grammar.abnf`, and these rows are
     * what tie your parser to both.
     *
     * `Expected` is `ParsedRouteId?` — see rule 3. A row whose `expect` is `null` asserts that a
     * malformed id returns `null` rather than throwing or returning something plausible; ids reach
     * this function from persisted favourites and from URLs, so malformed input is ordinary.
     *
     * `@TestFactory` rather than a loop inside one `@Test`, so a failing row is named in the report
     * and the rest still run — the corpus is a table of independent facts, and reporting it as one
     * assertion hides how many of them are wrong.
     */
    @TestFactory
    fun `ids#parseRouteId`(): List<DynamicTest> {
        // PORT ME: `ParsedRouteId` is yours to write, and must be `@Serializable` so the corpus can
        // express the expectation directly. Keep `serviceType` a `String` — it is an opaque operator
        // label, and decoding it as `Int` loses GMB's ids and turns "01" into "1".
        val rows = Corpus.cases<IdArgs, ParsedRouteId?>("ids", "parseRouteId")
        return rows.map { row ->
            DynamicTest.dynamicTest(row.name) {
                assertEquals(row.expect, IdParser.parseRouteId(row.args.id), row.why ?: row.name)
            }
        }
    }

    @Serializable
    data class GeoArgs(val aLat: Double, val aLng: Double, val bLat: Double, val bLng: Double)

    /** A worked example of rule 5 — the only rows in the corpus that may not compare exactly. */
    @TestFactory
    fun `geo#distanceMeters`(): List<DynamicTest> {
        val rows = Corpus.cases<GeoArgs, Approx>("geo", "distanceMeters")
        return rows.map { row ->
            DynamicTest.dynamicTest(row.name) {
                val actual = Geo.distanceMeters(row.args.aLat, row.args.aLng, row.args.bLat, row.args.bLng)
                assertEquals(row.expect.meters, actual, row.expect.tolerance, row.name)
            }
        }
    }

    /**
     * **The one test in this file that no gate in the TypeScript repo can stand in for.**
     *
     * `openapi.json` marks seven enums `x-unknown-tolerant`, meaning the server will add members
     * without a major version bump. The web client is unaffected — its schemas erase at build time and
     * it does no runtime validation at all — so *this* is where the obligation actually lands: a
     * generated Kotlin `enum class` with four entries **throws on decode**, and one new operator
     * bricks every installed copy of your app until the next release reaches devices.
     *
     * `apps/edge/test/unknown-enum-tolerance.test.ts` gates the half that can be gated there (that
     * every enum in the document carries the flag, and that a decoder honouring the flag accepts an
     * unknown member). It cannot gate *your* generator's output. This test does. Write it first.
     */
    @Test
    fun `an unknown enum member decodes rather than throwing`() {
        // "NLB" is real — New Lantao Bus is in the consolidated dataset and out of v1 scope, so it is
        // the most likely fifth operator rather than a made-up value.
        val payload = """
            {
              "routeId": "NLB:11:outbound:1",
              "stopId": "NLB:0001",
              "operator": "NLB",
              "arrivals": ["2026-07-29T14:31:00+08:00"],
              "remark": { "en": "Typhoon service", "zh-Hant": "颱風服務", "zh-Hans": "台风服务" },
              "remarkKind": "typhoon",
              "dataTimestamp": "2026-07-29T14:30:00+08:00",
              "observedAt": "2026-07-29T14:30:02+08:00"
            }
        """.trimIndent()

        // PORT ME: `Eta` is generated from openapi.json. `OperatorId`/`RemarkKind` must carry an
        // unknown case — with kotlinx.serialization the usual shape is a sealed interface with a
        // `Known`/`Unknown` pair, because a Kotlin `enum class` cannot hold the raw string. If this
        // throws, fix the generator; do not hand-edit the model and do not add "NLB" to the enum.
        val eta = Json { ignoreUnknownKeys = true }.decodeFromString<Eta>(payload)

        assertEquals(OperatorId.Unknown("NLB"), eta.operatorId, "an unrecognized operator must round-trip")
        assertEquals(RemarkKind.Unknown("typhoon"), eta.remarkKind)
        // Objects are open by design, so an added *field* must not throw either.
        assertEquals(1, eta.arrivals.size)
    }

    /**
     * `remarkKind` is **absent**, not `"info"`, when there is no remark. A port that defaults it
     * invents an honesty cue the operator never gave — the one thing ADR-008 forbids.
     *
     * Note the `@SerialName("operator")` your generated model will need: `operator` is a Kotlin
     * modifier keyword, so the property is named something else and mapped back on the wire.
     */
    @Test
    fun `an absent remarkKind stays absent`() {
        val payload = """
            {
              "routeId": "KMB:6:outbound:1",
              "stopId": "KMB:0001",
              "operator": "KMB",
              "arrivals": [],
              "dataTimestamp": "2026-07-29T14:30:00+08:00",
              "observedAt": "2026-07-29T14:30:02+08:00"
            }
        """.trimIndent()

        val eta = Json { ignoreUnknownKeys = true }.decodeFromString<Eta>(payload)
        assertNull(eta.remark)
        assertNull(eta.remarkKind)
    }
}
