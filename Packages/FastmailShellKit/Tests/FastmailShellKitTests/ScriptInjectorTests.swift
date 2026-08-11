import Testing
import WebKit
@testable import FastmailShellKit

private func bundle(
    userScript: String = "BODY",
    overlay: String? = nil,
    runAt: UserScriptMetadata.RunAt = .documentIdle,
    matches: [String] = ["https://app.fastmail.com/*"]
) -> ScriptBundle {
    ScriptBundle(
        harness: "HARNESS",
        userScript: userScript,
        overlay: overlay,
        metadata: UserScriptMetadata(name: "T", matches: matches, runAt: runAt, grants: ["none"])
    )
}

private let fastmail = URL(string: "https://app.fastmail.com/mail/Inbox")!

@Test @MainActor func harnessIsAlwaysFirstAndAtDocumentStart() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(), url: fastmail)
    #expect(scripts.first?.source == "HARNESS")
    #expect(scripts.first?.injectionTime == .atDocumentStart)
}

@Test @MainActor func userScriptIsInjectedVerbatimNotEmbedded() throws {
    let source = "var s = \"a'b\\\"c\";\nif (a </script> b) {}\n\u{2028} 🙂"
    let scripts = try ScriptInjector.userScripts(from: bundle(userScript: source), url: fastmail)
    #expect(scripts.contains { $0.source.contains(source) })
}

@Test @MainActor func documentIdleAndDocumentEndBothMapToDocumentEnd() throws {
    for runAt in [UserScriptMetadata.RunAt.documentIdle, .documentEnd] {
        let scripts = try ScriptInjector.userScripts(from: bundle(runAt: runAt), url: fastmail)
        #expect(scripts.last?.injectionTime == .atDocumentEnd)
    }
}

@Test @MainActor func documentStartMapsToDocumentStart() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(runAt: .documentStart), url: fastmail)
    #expect(scripts.last?.injectionTime == .atDocumentStart)
}

@Test @MainActor func overlayFollowsTheUserScript() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(scripts.count == 3)
    #expect(scripts[0].source == "HARNESS")
    #expect(scripts[1].source.contains("BODY"))
    #expect(scripts[2].source.contains("OVERLAY"))
}

@Test @MainActor func nonMatchingURLYieldsHarnessOnly() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(), url: URL(string: "https://example.com/")!)
    #expect(scripts.map(\.source) == ["HARNESS"])
}

@Test @MainActor func emptyMatchListMatchesEverything() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(matches: []), url: URL(string: "https://example.com/")!)
    #expect(scripts.count == 2)
}

@Test @MainActor func allScriptsAreMainFrameOnly() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(scripts.allSatisfy { $0.isForMainFrameOnly })
}

@Test @MainActor func guardedSourceCarriesLabelAndPatternsForTheRuntimeGate() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(scripts[1].source.contains("\"userscript\""))
    #expect(scripts[1].source.contains("app.fastmail.com"))
    #expect(scripts[2].source.contains("\"overlay\""))
}

@Test func matchesNormalizesEmptyPathToRoot() {
    #expect(ScriptInjector.matches(["https://app.fastmail.com/*"], url: URL(string: "https://app.fastmail.com")!))
    #expect(ScriptInjector.matches(["https://app.fastmail.com/*"], url: URL(string: "https://app.fastmail.com?u=1")!))
}

@Test func matchesNormalizesHostCase() {
    #expect(ScriptInjector.matches(["https://app.fastmail.com/*"], url: URL(string: "https://APP.FASTMAIL.COM/")!))
}

@Test func jsonLiteralEscapesLineAndParagraphSeparators() {
    let literal = ScriptInjector.jsonLiteral("a\u{2028}b\u{2029}c")
    #expect(literal == "\"a\\u2028b\\u2029c\"")
}

@Test func matchesCoversBothProfileStartURLs() {
    #expect(ScriptInjector.matches(["https://app.fastmail.com/*"], url: Profile.personal(accountID: nil).startURL))
    #expect(ScriptInjector.matches(["https://app.fastmail.com/*"], url: Profile.work(accountID: nil).startURL))
}
