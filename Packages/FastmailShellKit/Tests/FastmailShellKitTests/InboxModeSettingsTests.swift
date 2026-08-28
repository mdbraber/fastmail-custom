import Foundation
import Testing
@testable import FastmailShellKit

private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "InboxModeSettingsTests.\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Test func unsetDefaultsProduceTheCatalogDefaults() {
    let settings = InboxModeSettings.current(from: freshDefaults(#function))
    #expect(settings.count == InboxModeSettings.options.count)
    #expect(settings["labelColours"] as? Bool == true)
    #expect(settings["showFilteredCounts"] as? Bool == true)
    #expect(settings["processLabel"] as? String == "Next")
    #expect(settings["qualifierLabels"] as? String == "Admin, Waiting")
    #expect(settings["deferredLabels"] as? String == "Waiting, Snoozed")
}

@Test func storedValuesWinOverDefaults() {
    let defaults = freshDefaults(#function)
    defaults.set(false, forKey: "inboxMode.labelColours")
    defaults.set(true, forKey: "inboxMode.showFilteredCounts")
    defaults.set("  Keep  ", forKey: "inboxMode.processLabel")
    let settings = InboxModeSettings.current(from: defaults)
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["showFilteredCounts"] as? Bool == true)
    #expect(settings["processLabel"] as? String == "Keep")
}

// Emptying a field that names one thing asks for the default back: a kept
// marker called nothing is not something anyone means.
@Test func emptyTextFallsBackToTheDefaultWhereEmptyMeansNothing() {
    let defaults = freshDefaults(#function)
    defaults.set("   ", forKey: "inboxMode.processLabel")
    defaults.set("   ", forKey: "inboxMode.waitingLabel")
    let settings = InboxModeSettings.current(from: defaults)
    #expect(settings["processLabel"] as? String == "Next")
    #expect(settings["waitingLabel"] as? String == "Waiting")
}

// Emptying a field that names a list says none of them, and has to survive
// the trip: clearing "Labels that are never topics" used to hand Later
// straight back, so there was no way to stop excluding it.
@Test func emptyTextIsHonouredWhereEmptyMeansNone() {
    let defaults = freshDefaults(#function)
    for key in ["excludedLabels", "qualifierLabels", "deferredLabels",
                "appBadgeLabel", "appBadgeFilter"] {
        defaults.set("   ", forKey: "inboxMode.\(key)")
    }

    let settings = InboxModeSettings.current(from: defaults)
    #expect(settings["excludedLabels"] as? String == "")
    #expect(settings["qualifierLabels"] as? String == "")
    #expect(settings["deferredLabels"] as? String == "")
    #expect(settings["appBadgeLabel"] as? String == "")
    #expect(settings["appBadgeFilter"] as? String == "")
}

// Never set is not the same as set to empty, even for those: a field nobody
// has touched still gets the default.
@Test func untouchedClearableFieldsStillGetTheirDefaults() {
    let settings = InboxModeSettings.current(from: freshDefaults(#function))
    #expect(settings["excludedLabels"] as? String == "Later")
    #expect(settings["qualifierLabels"] as? String == "Admin, Waiting")
    #expect(settings["appBadgeFilter"] as? String == "next")
}

@Test func scriptsCarryTheSettingsAndTheApplyCall() throws {
    let defaults = freshDefaults(#function)
    defaults.set("Keep", forKey: "inboxMode.processLabel")

    let source = InboxModeSettings.applyScriptSource(from: defaults)
    #expect(source.contains("window.__customInboxModeSettings = {"))
    #expect(source.contains("window.customInboxMode.applySettings"))

    // The embedded object must round-trip as JSON with every option present
    let start = try #require(source.range(of: "{"))
    let end = try #require(source.range(of: "};"))
    let json = String(source[start.lowerBound..<end.lowerBound]) + "}"
    let object = try #require(
        try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
    )
    #expect(object.count == InboxModeSettings.options.count)
    #expect(object["processLabel"] as? String == "Keep")
}

@Test @MainActor func bootstrapScriptRunsFirstAndInTheMainFrameOnly() {
    let script = InboxModeSettings.bootstrapScript(from: freshDefaults(#function))
    #expect(script.injectionTime == .atDocumentStart)
    #expect(script.isForMainFrameOnly)
    #expect(script.source.hasPrefix("window.__customInboxModeSettings = {"))
}

@Test func subOptionsNameARealToggleParent() {
    for option in InboxModeSettings.options {
        guard let parentKey = option.parent else { continue }
        let parent = InboxModeSettings.options.first { $0.key == parentKey }
        #expect(parent != nil, "\(option.key) points at a missing parent")
        if case .toggle = parent?.defaultValue {} else {
            Issue.record("\(option.key)'s parent \(parentKey) is not a toggle")
        }
    }
}
