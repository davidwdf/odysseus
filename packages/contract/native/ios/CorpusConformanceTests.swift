// NextBus HK — fixture-corpus conformance, XCTest template.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  UNVERIFIED — THIS FILE HAS NEVER BEEN COMPILED AND HAS NEVER BEEN RUN.
//
//  There is no Swift toolchain in this repository and no gate that could compile it, so nothing
//  below is known to be valid Swift. Treat it as a specification with syntax colouring: the *rules*
//  it encodes are load-bearing and were derived from the working TypeScript loader
//  (`packages/core/test/corpus.ts`), but the code is a first draft nobody has built.
//
//  **Making this compile and go green is the first job of the first iOS repo**, before any UI. A
//  compile error here is expected. Fix it in your repo, then send the fix back so the next port
//  starts from working code — the value of this file drops to zero the moment it is stale, which is
//  exactly the "codegen becomes stale scaffolding" risk it is trying to mitigate.
//
//  The same banner is on `packages/ui/generated/NextBusTokens.swift` for the same reason. Do not
//  infer from either file's existence that a Swift client has ever been built.
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
// GETTING THE CORPUS INTO YOUR BUNDLE
// Vendor `packages/core/spec/*.spec.json` into `Tests/NextBusKitTests/spec/` and declare it:
//
//     .testTarget(
//         name: "NextBusKitTests",
//         dependencies: ["NextBusKit"],
//         resources: [.copy("spec")]
//     )
//
// **Copy them with a script, never by hand, and check the copy is current in your own build.** A
// vendored corpus that has silently fallen behind this repo is a suite that passes while the rule it
// was meant to pin has moved — the failure this whole mechanism exists to prevent, reintroduced by
// the act of copying. A git submodule or a `curl` of the raw files in a pre-build step both work; a
// one-off drag into Xcode does not.

import XCTest

@testable import NextBusKit

// ── The reader contract ───────────────────────────────────────────────────────────────────────────
//
// Six rules. They are not stylistic — each one is a way a port can produce a green suite that proves
// nothing, and they are stated in the same order in `packages/contract/README.md` §6 and in the
// Kotlin template beside this one.

/// One row of a corpus group.
///
/// `Expected` is declared `Decodable` and is very often an *optional* type at the call site: JSON
/// `null` means "the language's absent value", and **rule 3** is that the translation happens here, at
/// the decode boundary, and nowhere else. Never map `null` to a sentinel — a `parseRouteId` row whose
/// `expect` is `null` is asserting that a malformed id yields `nil`, and a port that turned it into
/// `""` would pass this row while shipping a different function.
struct SpecCase<Args: Decodable, Expected: Decodable>: Decodable {
    let name: String
    /// Prose for a porter: what this row catches. Read it when a row fails — it usually tells you
    /// which branch of your port is wrong.
    let why: String?
    /// **Rule 6.** `true` marks behaviour we agree is WRONG and are keeping identical across all
    /// three platforms until it is fixed in one coordinated change. It **still asserts**. There is no
    /// `XCTSkip` anywhere in this file, deliberately: a skipped defect row is how three platforms end
    /// up wrong in three different ways.
    let knownDefect: Bool?
    let args: Args
    let expect: Expected
}

/// **Rule 5.** A distance assertion carries its own tolerance, because trigonometry does not agree to
/// the last bit across languages and a port is not wrong for differing in the twelfth decimal. A
/// `tolerance` of `0` means the row really does demand exactness (a zero distance, say).
struct Approx: Decodable {
    let meters: Double
    let tolerance: Double
}

func XCTAssertApprox(
    _ actual: Double,
    _ expected: Approx,
    _ label: String,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    XCTAssertEqual(actual, expected.meters, accuracy: expected.tolerance, label, file: file, line: line)
}

enum Corpus {
    // BEGIN GENERATED: corpus-modules
    /// Every corpus in `packages/core/spec/`. Enumerated rather than discovered because a test
    /// bundle cannot portably glob its resources — and because a hard-coded list is the one part
    /// of this file that goes stale when a corpus is added, it is generated and gated instead.
    static let modules = [
        "eta",
        "fare-stages",
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
    ]
    // END GENERATED: corpus-modules

    /// Hong Kong is UTC+8 with no daylight saving, and every timestamp in every corpus carries an
    /// explicit `+08:00`.
    static let hongKong = TimeZone(secondsFromGMT: 8 * 3600)!

    enum CorpusError: Error, CustomStringConvertible {
        case missingResource(String)
        case missingGroup(module: String, group: String)
        case emptyGroup(module: String, group: String)

        var description: String {
            switch self {
            case .missingResource(let m):
                return "corpus \(m).spec.json is not in the test bundle — check `resources:` in Package.swift"
            case .missingGroup(let m, let g):
                return "corpus \(m).spec.json has no group \"\(g)\""
            case .emptyGroup(let m, let g):
                return "corpus group \(m)#\(g) has no cases"
            }
        }
    }

    static func json(_ module: String) throws -> [String: Any] {
        guard let url = Bundle.module.url(forResource: "spec/\(module).spec", withExtension: "json"),
              let object = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        else { throw CorpusError.missingResource(module) }
        return object
    }

    /// The rows of one group, decoded for the caller.
    ///
    /// **Rule 1** is the envelope: `{module, source, version, doc, groups}`, each group
    /// `{doc, cases[]}`. **Rule 2** is the two `throw`s below — a missing group and an *empty* `cases`
    /// array both fail loudly, because `for case in [] { assert }` is a green test that proves
    /// nothing, and that is the single most likely way this harness rots into a vacuous pass.
    static func cases<Args: Decodable, Expected: Decodable>(
        _ module: String,
        _ group: String,
        args: Args.Type = Args.self,
        expect: Expected.Type = Expected.self
    ) throws -> [SpecCase<Args, Expected>] {
        let groups = try json(module)["groups"] as? [String: Any] ?? [:]
        guard let found = groups[group] as? [String: Any] else {
            throw CorpusError.missingGroup(module: module, group: group)
        }
        guard let rows = found["cases"] as? [Any], !rows.isEmpty else {
            throw CorpusError.emptyGroup(module: module, group: group)
        }
        let data = try JSONSerialization.data(withJSONObject: rows)
        return try JSONDecoder().decode([SpecCase<Args, Expected>].self, from: data)
    }

    /// **Rule 4.** The clock reading a row was written against — passed in as an argument, never read
    /// from the device.
    ///
    /// The offset is *in the string*, and `.withInternetDateTime` honours it. Setting `timeZone` to
    /// GMT is the load-bearing part: it makes a string that somehow lacks an offset fail identically
    /// on every machine instead of being interpreted in whatever zone the simulator happens to be in.
    /// A corpus row whose result depended on the host time zone would be worthless to a second
    /// platform and flaky on the first.
    static func at(_ nowIso: String) throws -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        guard let date = formatter.date(from: nowIso) else {
            throw CorpusError.missingResource("unparseable timestamp \(nowIso)")
        }
        return date
    }
}

// ── The suite ─────────────────────────────────────────────────────────────────────────────────────

final class CorpusConformanceTests: XCTestCase {

    /// Every group this suite actually drives. Add to it as you port each rule.
    ///
    /// This set is the whole point of the next test: without it, "we have a conformance suite" and
    /// "we have ported the rules" look identical from the outside, and a corpus nobody consumes is a
    /// specification nobody is held to.
    static let coveredGroups: Set<String> = [
        "ids#parseRouteId",
        "geo#distanceMeters",
        // PORT ME: add one entry per group as you implement it, until the test below passes.
    ]

    /// The completeness gate — the native mirror of `scripts/check-spec-coverage.mjs`.
    ///
    /// Fails while any corpus group is unported, and **that is the intended state on day one**: this
    /// is your port's to-do list, expressed as a red test, and it goes green exactly when the Swift
    /// client implements every rule the web client does. Do not weaken it to a warning; a to-do list
    /// that cannot fail a build is a to-do list nobody finishes.
    func testEveryCorpusGroupIsPorted() throws {
        var unported: [String] = []
        for module in Corpus.modules {
            let groups = try Corpus.json(module)["groups"] as? [String: Any] ?? [:]
            XCTAssertFalse(groups.isEmpty, "corpus \(module).spec.json declares no groups")
            for group in groups.keys.sorted() where !Self.coveredGroups.contains("\(module)#\(group)") {
                unported.append("\(module)#\(group)")
            }
        }
        XCTAssertEqual(
            unported, [],
            "\(unported.count) corpus group(s) are not ported to Swift yet — each is a domain rule "
                + "this client does not agree with the web client about"
        )
    }

    /// A worked example: the id grammar. The reference implementation is
    /// `packages/core/src/ids.ts`, the grammar it implements is
    /// `packages/contract/src/ids/id-grammar.abnf`, and these rows are what tie your parser to both.
    ///
    /// `Expected` is `ParsedRouteId?` — see rule 3. A row whose `expect` is `null` asserts that a
    /// malformed id returns `nil` rather than throwing or returning something plausible; ids reach
    /// this function from persisted favourites and from URLs, so malformed input is ordinary.
    func testParseRouteId() throws {
        struct Args: Decodable { let id: String }
        // PORT ME: `ParsedRouteId` is yours to write, and must be `Decodable` so the corpus can
        // express the expectation directly. Keep `serviceType` a `String` — it is an opaque operator
        // label, and decoding it as `Int` loses GMB's ids and turns "01" into "1".
        let rows = try Corpus.cases("ids", "parseRouteId", args: Args.self, expect: ParsedRouteId?.self)

        var defects = 0
        for row in rows {
            if row.knownDefect == true { defects += 1 }
            XCTAssertEqual(
                IdParser.parseRouteId(row.args.id), row.expect,
                "ids#parseRouteId/\(row.name): \(row.why ?? "")"
            )
        }
        // Printed, not asserted: the count creeping upward is a signal, and the TS gate prints it too.
        if defects > 0 { print("ids#parseRouteId: \(defects) knownDefect row(s) asserted, not skipped") }
    }

    /// A worked example of rule 5 — the only rows in the corpus that may not compare exactly.
    func testDistanceMeters() throws {
        struct Args: Decodable { let aLat: Double, aLng: Double, bLat: Double, bLng: Double }
        let rows = try Corpus.cases("geo", "distanceMeters", args: Args.self, expect: Approx.self)

        for row in rows {
            let actual = Geo.distanceMeters(
                lat1: row.args.aLat, lng1: row.args.aLng,
                lat2: row.args.bLat, lng2: row.args.bLng
            )
            XCTAssertApprox(actual, row.expect, "geo#distanceMeters/\(row.name)")
        }
    }

    /// **The one test in this file that no gate in the TypeScript repo can stand in for.**
    ///
    /// `openapi.json` marks seven enums `x-unknown-tolerant`, meaning the server will add members
    /// without a major version bump. The web client is unaffected — its schemas erase at build time
    /// and it does no runtime validation at all — so *this* is where the obligation actually lands: a
    /// generated Swift `enum` with four cases **throws on decode**, and one new operator bricks every
    /// installed copy of your app until Apple approves a fix.
    ///
    /// `apps/edge/test/unknown-enum-tolerance.test.ts` gates the half that can be gated here (that
    /// every enum in the document carries the flag, and that a decoder honouring the flag accepts an
    /// unknown member). It cannot gate *your* generator's output. This test does. Write it first.
    func testUnknownEnumMemberDecodesRatherThanThrowing() throws {
        // "NLB" is real — New Lantao Bus is in the consolidated dataset and out of v1 scope, so it is
        // the most likely fifth operator rather than a made-up value.
        let payload = """
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
        """.data(using: .utf8)!

        // PORT ME: `Eta` is generated from openapi.json; `OperatorId`/`RemarkKind` must have an
        // unknown-carrying case. If this line throws, your generator is configured wrongly — fix the
        // generator, do not hand-edit the model, and do not add "NLB" to the enum.
        let eta = try JSONDecoder().decode(Eta.self, from: payload)

        XCTAssertEqual(eta.operator, .unknown("NLB"), "an unrecognized operator must round-trip, not throw")
        XCTAssertEqual(eta.remarkKind, .unknown("typhoon"))
        // Objects are open by design, so an added *field* must not throw either.
        XCTAssertEqual(eta.arrivals.count, 1)
    }

    /// `remarkKind` is **absent**, not `"info"`, when there is no remark. A port that defaults it
    /// invents an honesty cue the operator never gave — which is the one thing ADR-008 forbids.
    func testAbsentRemarkKindStaysAbsent() throws {
        let payload = """
        {
          "routeId": "KMB:6:outbound:1",
          "stopId": "KMB:0001",
          "operator": "KMB",
          "arrivals": [],
          "dataTimestamp": "2026-07-29T14:30:00+08:00",
          "observedAt": "2026-07-29T14:30:02+08:00"
        }
        """.data(using: .utf8)!

        let eta = try JSONDecoder().decode(Eta.self, from: payload)
        XCTAssertNil(eta.remark)
        XCTAssertNil(eta.remarkKind)
    }
}
