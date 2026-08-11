import Testing
import Foundation
@testable import FastmailShellKit

private func bundle(userScript: String, overlay: String? = nil) -> ScriptBundle {
    ScriptBundle(
        harness: "HARNESS_SOURCE",
        userScript: userScript,
        overlay: overlay,
        metadata: UserScriptMetadata(
            name: "X",
            matches: ["https://app.fastmail.com/*"],
            runAt: .documentIdle,
            grants: ["none"]
        )
    )
}

private func firstJSONArgument(of source: String) throws -> String {
    let marker = "window.__fmshell.boot("
    let start = source.range(of: marker)!.upperBound
    let rest = String(source[start...])
    let comma = rest.range(of: ",")!.lowerBound
    let literal = String(rest[rest.startIndex..<comma])
    let data = literal.data(using: .utf8)!
    let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    return value as! String
}

@Test func bootstrapContainsHarnessThenBootCall() {
    let source = ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.hasPrefix("HARNESS_SOURCE"))
    #expect(source.contains("window.__fmshell.boot("))
}

@Test func userScriptSurvivesQuotesNewlinesAndScriptTags() throws {
    let hostile = "var s = \"a'b\\\"c\";\nif (a </script> b) {}\n// emoji 🙂 and \\u2028"
    let source = ScriptInjector.bootstrap(from: bundle(userScript: hostile))
    #expect(try firstJSONArgument(of: source) == hostile)
}

@Test func absentOverlayIsEncodedAsNull() {
    let source = ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.contains(", null, "))
}

@Test func metadataIsPassedAsRunAtAndMatches() {
    let source = ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.contains("\"runAt\":\"document-idle\"") || source.contains("\"runAt\": \"document-idle\""))
    #expect(source.contains("app.fastmail.com"))
}
