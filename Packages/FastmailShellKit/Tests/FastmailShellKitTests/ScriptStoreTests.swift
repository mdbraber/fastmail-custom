import Testing
@testable import FastmailShellKit

private struct StubLoader: ResourceLoading {
    var resources: [String: String]
    func string(named name: String) -> String? { resources[name] }
}

private let header = """
// ==UserScript==
// @match https://app.fastmail.com/*
// @run-at document-idle
// ==/UserScript==
"""

@Test func loadsHarnessUserScriptAndMetadata() throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": header + "\nBODY"
    ])
    let bundle = try ScriptStore(loader: loader, overlayName: nil).load()
    #expect(bundle.harness == "HARNESS")
    #expect(bundle.userScript.contains("BODY"))
    #expect(bundle.overlay == nil)
    #expect(bundle.metadata.runAt == .documentIdle)
}

@Test func loadsOverlayWhenPresent() throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": header,
        "userscript.personal.js": "OVERLAY"
    ])
    let bundle = try ScriptStore(loader: loader, overlayName: "userscript.personal.js").load()
    #expect(bundle.overlay == "OVERLAY")
}

@Test func missingOverlayIsNotAnError() throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": header
    ])
    let bundle = try ScriptStore(loader: loader, overlayName: "userscript.personal.js").load()
    #expect(bundle.overlay == nil)
}

@Test func missingHarnessThrows() {
    let loader = StubLoader(resources: ["userscript.js": header])
    #expect(throws: ScriptStoreError.harnessMissing) {
        try ScriptStore(loader: loader, overlayName: nil).load()
    }
}

@Test func missingUserScriptThrows() {
    let loader = StubLoader(resources: ["harness.js": "HARNESS"])
    #expect(throws: ScriptStoreError.userScriptMissing) {
        try ScriptStore(loader: loader, overlayName: nil).load()
    }
}

@Test func unparseableUserScriptPropagatesTheParseError() {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": "no metadata here"
    ])
    #expect(throws: MetadataParseError.blockMissing) {
        try ScriptStore(loader: loader, overlayName: nil).load()
    }
}
