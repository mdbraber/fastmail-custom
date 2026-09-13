import Foundation
import Testing
@testable import FastmailShellKit

private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "CustomModeSettingsTests.\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

// Swift keeps no list of the options. Anything under the namespace is a
// setting, whatever it is called, and anything outside it is not.
@Test func injectionCollectsTheNamespaceAndNothingElse() {
    let defaults = freshDefaults(#function)
    let baseline = CustomModeSettings.current(from: freshDefaults(#function + ".baseline"))

    defaults.set(false, forKey: "customMode.labelColours")
    defaults.set("Todo", forKey: "customMode.triageLabel")
    defaults.set("yes", forKey: "customMode.somethingSwiftHasNeverHeardOf")
    defaults.set("beta", forKey: "backend")
    defaults.set(true, forKey: "push.alerts")

    let settings = CustomModeSettings.current(from: defaults)
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
    defaults.set(42, forKey: "customMode.someNumber")
    defaults.set("nope", forKey: "customMode.bad.key")

    let settings = CustomModeSettings.current(from: defaults)
    #expect(settings["someNumber"] == nil)
    #expect(settings["bad.key"] == nil)
    #expect(settings["bad"] == nil)
}

@Test func scriptsCarryTheSettingsAndTheApplyCall() throws {
    let defaults = freshDefaults(#function)
    defaults.set("Todo", forKey: "customMode.triageLabel")

    let source = CustomModeSettings.applyScriptSource(from: defaults)
    #expect(source.contains("window.__customModeSettings = {"))
    #expect(source.contains("window.customMode.applySettings"))

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
    let script = CustomModeSettings.bootstrapScript(from: freshDefaults(#function))
    #expect(script.injectionTime == .atDocumentStart)
    #expect(script.isForMainFrameOnly)
    #expect(script.source.hasPrefix("window.__customModeSettings = {"))
}
