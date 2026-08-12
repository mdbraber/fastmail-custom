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
        chromeCSS: nil,
        metadata: UserScriptMetadata(name: "T", matches: matches, runAt: runAt, grants: ["none"])
    )
}

private let fastmail = URL(string: "https://app.fastmail.com/mail/Inbox")!

@Test @MainActor func harnessIsAlwaysFirstAndAtDocumentStart() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(), url: fastmail)
    #expect(injected.scripts.first?.source.contains("HARNESS") == true)
    #expect(injected.scripts.first?.injectionTime == .atDocumentStart)
}

@Test @MainActor func harnessIsGatedToTheConfiguredHost() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(), url: fastmail)
    #expect(
        injected.scripts.first?.source
            .contains("location.hostname.replace(/\\.$/, '') === \"app.fastmail.com\"") == true
    )
}

@Test @MainActor func harnessGateFallsBackToEmptyHostWhenURLHasNone() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(), url: URL(string: "about:blank")!)
    #expect(
        injected.scripts.first?.source.contains("location.hostname.replace(/\\.$/, '') === \"\"") == true
    )
}

@Test @MainActor func userScriptIsInjectedVerbatimNotEmbedded() throws {
    let source = "var s = \"a'b\\\"c\";\nif (a </script> b) {}\n\u{2028} 🙂"
    let injected = try ScriptInjector.userScripts(from: bundle(userScript: source), url: fastmail)
    #expect(injected.scripts.contains { $0.source.contains(source) })
}

@Test @MainActor func documentIdleAndDocumentEndBothMapToDocumentEnd() throws {
    for runAt in [UserScriptMetadata.RunAt.documentIdle, .documentEnd] {
        let injected = try ScriptInjector.userScripts(from: bundle(runAt: runAt), url: fastmail)
        #expect(injected.scripts.last?.injectionTime == .atDocumentEnd)
    }
}

@Test @MainActor func documentStartMapsToDocumentStart() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(runAt: .documentStart), url: fastmail)
    #expect(injected.scripts.last?.injectionTime == .atDocumentStart)
}

@Test @MainActor func overlayFollowsTheUserScript() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(injected.scripts.count == 3)
    #expect(injected.scripts[0].source.contains("HARNESS"))
    #expect(injected.scripts[1].source.contains("BODY"))
    #expect(injected.scripts[2].source.contains("OVERLAY"))
}

@Test @MainActor func nonMatchingURLYieldsHarnessOnly() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(), url: URL(string: "https://example.com/")!)
    #expect(injected.scripts.count == 1)
    #expect(injected.scripts[0].source.contains("HARNESS"))
    #expect(injected.userScriptIncluded == false)
}

@Test @MainActor func emptyMatchListMatchesEverything() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(matches: []), url: URL(string: "https://example.com/")!)
    #expect(injected.scripts.count == 2)
    #expect(injected.userScriptIncluded == true)
}

@Test @MainActor func allScriptsAreMainFrameOnly() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(injected.scripts.allSatisfy { $0.isForMainFrameOnly })
}

@Test @MainActor func guardedSourceCarriesLabelAndPatternsForTheRuntimeGate() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(injected.scripts[1].source.contains("\"userscript\""))
    #expect(injected.scripts[1].source.contains("app.fastmail.com"))
    #expect(injected.scripts[2].source.contains("\"overlay\""))
}

@Test func guardedSourceLogsThroughNativeWhenThePerDocumentGateDeclines() {
    let source = ScriptInjector.guarded("BODY", patterns: ["https://app.fastmail.com/*"], label: "userscript")
    #expect(source.contains("} else {"))
    #expect(source.contains("console.warn(notice)"))
    #expect(source.contains("window.native.log(notice)"))
    #expect(source.contains("@match does not cover"))
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

@Test func gatedToHostWrapsSourceInAHostnameCheck() {
    let source = ScriptInjector.gatedToHost("BODY", host: "app.fastmail.com")
    #expect(source.contains("if (location.hostname.replace(/\\.$/, '') === \"app.fastmail.com\") {"))
    #expect(source.contains("BODY"))
}

@Test func gatedToHostNormalizesATrailingDotOnTheDocumentHostname() {
    let source = ScriptInjector.gatedToHost("BODY", host: "app.fastmail.com")
    #expect(source.contains(".replace(/\\.$/, '')"))
}

@Test @MainActor func chromeCSSIsInjectedAsAStyleElementAtDocumentStart() throws {
    let injected = try ScriptInjector.userScripts(
        from: bundle(), url: fastmail, chromeCSS: ".v-PageHeader { padding-left: 78px; }"
    )
    let styleScript = try #require(injected.styleScript)
    #expect(styleScript.injectionTime == .atDocumentStart)
    #expect(styleScript.source.contains("padding-left: 78px"))
    #expect(injected.scripts.contains { $0 === styleScript })
}

@Test @MainActor func chromeCSSIsOmittedWhenAbsent() throws {
    let injected = try ScriptInjector.userScripts(from: bundle(), url: fastmail, chromeCSS: nil)
    #expect(injected.styleScript == nil)
    #expect(injected.scripts.allSatisfy { !$0.source.contains("createElement('style')") })
}

@Test @MainActor func chromeCSSSurvivesQuotesAndNewlines() throws {
    let css = ".x::after { content: \"a'b\\\"c\"; }\n.y { color: red; }"
    let injected = try ScriptInjector.userScripts(from: bundle(), url: fastmail, chromeCSS: css)
    let styleScript = try #require(injected.styleScript)
    let literal = try #require(ScriptInjector.jsonLiteral(css))
    #expect(literal.contains("\\n"))
    #expect(literal.contains("\\\""))
    #expect(styleScript.source.contains("style.textContent = \(literal);"))
    #expect(!styleScript.source.contains(css))
}

@Test @MainActor func chromeCSSIsInjectedEvenWhenTheURLDoesNotMatch() throws {
    let injected = try ScriptInjector.userScripts(
        from: bundle(), url: URL(string: "https://example.com/")!, chromeCSS: "x{}"
    )
    #expect(injected.styleScript != nil)
}
