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
    #expect(settings["swapArchiveExpand"] as? Bool == true)
    #expect(settings["triageLabel"] as? String == "Triage")
    #expect(settings["snoozeDefault"] as? String == "2w")
    #expect(settings["bottomBarSlots"] as? String == "Snooze, Pin, Archive, Labels, File, Delete, Move")
}

@Test func storedValuesWinOverDefaults() {
    let defaults = freshDefaults(#function)
    defaults.set(false, forKey: "inboxMode.labelColours")
    defaults.set(false, forKey: "inboxMode.swapArchiveExpand")
    defaults.set("  Todo  ", forKey: "inboxMode.triageLabel")
    let settings = InboxModeSettings.current(from: defaults)
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["swapArchiveExpand"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")
}

// Emptying a field that names one thing asks for the default back: a
// triage label called nothing is not something anyone means.
@Test func emptyTextFallsBackToTheDefaultWhereEmptyMeansNothing() {
    let defaults = freshDefaults(#function)
    defaults.set("   ", forKey: "inboxMode.triageLabel")
    defaults.set("   ", forKey: "inboxMode.snoozeTime")
    let settings = InboxModeSettings.current(from: defaults)
    #expect(settings["triageLabel"] as? String == "Triage")
    #expect(settings["snoozeTime"] as? String == "08:00")
}

// Emptying a field that names a list says none of them, and has to survive
// the trip: clearing "Labels that are never projects" used to hand Later
// straight back, so there was no way to stop excluding it.
@Test func emptyTextIsHonouredWhereEmptyMeansNone() {
    let defaults = freshDefaults(#function)
    for key in ["excludedLabels", "contactGroupLabels", "appBadgeLabel"] {
        defaults.set("   ", forKey: "inboxMode.\(key)")
    }

    let settings = InboxModeSettings.current(from: defaults)
    #expect(settings["excludedLabels"] as? String == "")
    #expect(settings["contactGroupLabels"] as? String == "")
    #expect(settings["appBadgeLabel"] as? String == "")
}

// Never set is not the same as set to empty, even for those: a field nobody
// has touched still gets the default.
@Test func untouchedClearableFieldsStillGetTheirDefaults() {
    let settings = InboxModeSettings.current(from: freshDefaults(#function))
    #expect(settings["excludedLabels"] as? String == "Later")
    #expect(settings["contactGroupLabels"] as? String == "")
    #expect(settings["appBadgeLabel"] as? String == "Triage")
}

@Test func scriptsCarryTheSettingsAndTheApplyCall() throws {
    let defaults = freshDefaults(#function)
    defaults.set("Todo", forKey: "inboxMode.triageLabel")

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
    #expect(object["triageLabel"] as? String == "Todo")
}

@Test @MainActor func bootstrapScriptRunsFirstAndInTheMainFrameOnly() {
    let script = InboxModeSettings.bootstrapScript(from: freshDefaults(#function))
    #expect(script.injectionTime == .atDocumentStart)
    #expect(script.isForMainFrameOnly)
    #expect(script.source.hasPrefix("window.__customInboxModeSettings = {"))
}

// The reorder list must offer exactly the verbs the userscript knows, in the
// catalog's order. It once kept listing Keep, Waiting and Someday — retired in
// the one-label model — because this vocabulary was hardcoded separately and
// missed the rename to File, so the screen showed nine stale verbs.
@Test @MainActor func barSlotNamesAreTheCurrentVerbs() {
    #expect(InboxModeSettingsModel.barSlotNames
        == ["Snooze", "Pin", "Archive", "Labels", "File", "Delete", "Move"])
    #expect(!InboxModeSettingsModel.barSlotNames.contains("Keep"))
    #expect(!InboxModeSettingsModel.barSlotNames.contains("Waiting"))
    #expect(!InboxModeSettingsModel.barSlotNames.contains("Someday"))
}

// Drawn from the catalog's own default so the reorder list cannot drift from
// the verbs the userscript actually knows.
@Test @MainActor func barSlotNamesMatchTheCatalogDefault() {
    let fromDefault = (InboxModeSettings.current(from: freshDefaults(#function))["bottomBarSlots"] as? String ?? "")
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
    #expect(InboxModeSettingsModel.barSlotNames == fromDefault)
}

// With nothing stored the reorder list is exactly the current verbs.
@Test @MainActor func loadBarOrderWithoutAStoredValueListsTheCurrentVerbs() {
    #expect(InboxModeSettingsModel.loadBarOrder(from: freshDefaults(#function))
        == ["Snooze", "Pin", "Archive", "Labels", "File", "Delete", "Move"])
}

// A value saved by an older build still names Keep, Waiting and Someday; those
// retired verbs are dropped, the recognised ones keep their saved order, and
// the rest — File included — follow in the catalog's order.
@Test @MainActor func loadBarOrderDropsRetiredVerbsFromAnOlderStoredValue() {
    let defaults = freshDefaults(#function)
    defaults.set("Delete, Keep, Waiting, Someday, Move", forKey: "inboxMode.bottomBarSlots")
    let order = InboxModeSettingsModel.loadBarOrder(from: defaults)
    #expect(!order.contains("Keep"))
    #expect(!order.contains("Waiting"))
    #expect(!order.contains("Someday"))
    #expect(order.contains("File"))
    #expect(Array(order.prefix(2)) == ["Delete", "Move"])
    #expect(Set(order) == Set(["Snooze", "Pin", "Archive", "Labels", "File", "Delete", "Move"]))
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

// A sub-option renders indented under its parent within one group; a parent in
// a different tab would strand it, so they must share a group.
@Test func subOptionsShareTheirParentsGroup() {
    for option in InboxModeSettings.options {
        guard let parentKey = option.parent,
              let parent = InboxModeSettings.options.first(where: { $0.key == parentKey })
        else { continue }
        #expect(option.group == parent.group,
                "\(option.key) is in \(option.group) but its parent \(parentKey) is in \(parent.group)")
    }
}

// options(in:) partitions the catalog — every option lands in exactly one
// group, and no group is empty, so no tab or section comes up blank.
@Test func everyOptionBelongsToExactlyOneNonEmptyGroup() {
    let regrouped = InboxModeSettings.Group.allCases.flatMap { InboxModeSettings.options(in: $0) }
    #expect(regrouped.count == InboxModeSettings.options.count)
    #expect(Set(regrouped.map(\.key)) == Set(InboxModeSettings.options.map(\.key)))
    for group in InboxModeSettings.Group.allCases {
        #expect(!InboxModeSettings.options(in: group).isEmpty, "\(group) has no options")
    }
}

// The anchor settings sit where the grouping proposal placed them.
@Test func theAnchorSettingsAreInTheExpectedGroups() {
    func group(of key: String) -> InboxModeSettings.Group? {
        InboxModeSettings.options.first { $0.key == key }?.group
    }
    #expect(group(of: "appBadgeLabel") == .general)
    #expect(group(of: "labelColours") == .appearance)
    #expect(group(of: "triageLabel") == .labelsFiling)
    #expect(group(of: "snoozeKey") == .snooze)
    #expect(group(of: "urgentKey") == .keyboard)
    #expect(group(of: "bottomBarSlots") == .bottomBar)
}

// The inbox-mode groups are every group but the app-level General one, which
// the shell builds itself.
@Test func inboxGroupsAreEveryGroupButGeneral() {
    #expect(!InboxModeSettings.Group.inboxGroups.contains(.general))
    #expect(Set(InboxModeSettings.Group.inboxGroups) == Set(InboxModeSettings.Group.allCases).subtracting([.general]))
}
