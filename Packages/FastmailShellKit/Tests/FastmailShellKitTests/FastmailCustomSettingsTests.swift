import Foundation
import Testing
@testable import FastmailShellKit

private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "FastmailCustomSettingsTests.\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

// Swift keeps no list of the options. Anything under the namespace is a
// setting, whatever it is called, and anything outside it is not.
@Test func injectionCollectsTheNamespaceAndNothingElse() {
    let defaults = freshDefaults(#function)
    let baseline = FastmailCustomSettings.current(from: freshDefaults(#function + ".baseline"))

    defaults.set(false, forKey: "fastmailCustom.labelColours")
    defaults.set("Todo", forKey: "fastmailCustom.triageLabel")
    defaults.set("yes", forKey: "fastmailCustom.somethingSwiftHasNeverHeardOf")
    defaults.set("beta", forKey: "backend")
    defaults.set(true, forKey: "push.alerts")

    let settings = FastmailCustomSettings.current(from: defaults)
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")
    #expect(settings["somethingSwiftHasNeverHeardOf"] as? String == "yes")
    #expect(settings["backend"] == nil)
    #expect(settings["alerts"] == nil)
    #expect(Set(settings.keys) == Set(baseline.keys).union([
        "labelColours", "triageLabel", "somethingSwiftHasNeverHeardOf",
    ]))
}

// A value that is neither a Bool nor a String cannot be handed to the page as
// either, and a key that fails the write guard could only have climbed out of
// the namespace by way of a dot; both are left out rather than passed through.
@Test func nonBoolNonStringValuesAndUnwritableKeysAreExcluded() {
    let defaults = freshDefaults(#function)
    defaults.set(42, forKey: "fastmailCustom.someNumber")
    defaults.set("nope", forKey: "fastmailCustom.bad.key")

    let settings = FastmailCustomSettings.current(from: defaults)
    #expect(settings["someNumber"] == nil)
    #expect(settings["bad.key"] == nil)
    #expect(settings["bad"] == nil)
}

@Test func scriptsCarryTheSettingsAndTheApplyCall() throws {
    let defaults = freshDefaults(#function)
    defaults.set("Todo", forKey: "fastmailCustom.triageLabel")

    let source = FastmailCustomSettings.applyScriptSource(from: defaults)
    #expect(source.contains("window.__fastmailCustomSettings = {"))
    #expect(source.contains("window.fastmailCustom.applySettings"))

    // The embedded object must round-trip as JSON with every option present
    let start = try #require(source.range(of: "{"))
    let end = try #require(source.range(of: "};"))
    let json = String(source[start.lowerBound..<end.lowerBound]) + "}"
    let object = try #require(
        try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
    )
    #expect(object.count == 1)
    #expect(object["triageLabel"] as? String == "Todo")
}

@Test @MainActor func bootstrapScriptRunsFirstAndInTheMainFrameOnly() {
    let script = FastmailCustomSettings.bootstrapScript(from: freshDefaults(#function))
    #expect(script.injectionTime == .atDocumentStart)
    #expect(script.isForMainFrameOnly)
    #expect(script.source.hasPrefix("window.__fastmailCustomSettings = {"))
}

// Only a host that can sync says so; a page told nothing draws no switch.
// Where it is said, it is said before the page is asked to apply.
@Test func theApplyScriptCarriesTheSyncSwitchOnlyWhereThereIsOne() throws {
    let defaults = freshDefaults(#function)
    #expect(!FastmailCustomSettings.applyScriptSource(from: defaults).contains("__fastmailCustomSync"))

    let on = FastmailCustomSettings.applyScriptSource(from: defaults, syncEnabled: true)
    #expect(on.contains(#"window.__fastmailCustomSync = {"enabled":true};"#))
    let sync = try #require(on.range(of: "window.__fastmailCustomSync"))
    let apply = try #require(on.range(of: "applySettings"))
    #expect(sync.lowerBound < apply.lowerBound)

    let off = FastmailCustomSettings.applyScriptSource(from: defaults, syncEnabled: false)
    #expect(off.contains(#"window.__fastmailCustomSync = {"enabled":false};"#))
}

@Test @MainActor func theBootstrapCarriesTheSyncSwitchOnlyWhereThereIsOne() {
    let defaults = freshDefaults(#function)
    #expect(!FastmailCustomSettings.bootstrapScript(from: defaults).source.contains("__fastmailCustomSync"))

    let script = FastmailCustomSettings.bootstrapScript(from: defaults, syncEnabled: false)
    #expect(script.source.hasPrefix("window.__fastmailCustomSettings = {"))
    #expect(script.source.hasSuffix(#"window.__fastmailCustomSync = {"enabled":false};"#))
}
