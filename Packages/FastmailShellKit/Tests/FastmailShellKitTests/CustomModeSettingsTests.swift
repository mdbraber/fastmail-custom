import Foundation
import Testing
@testable import FastmailShellKit

private func freshDefaults(_ name: String) -> UserDefaults {
    let suite = "CustomModeSettingsTests.\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Test func unsetDefaultsProduceTheCatalogDefaults() {
    let settings = CustomModeSettings.current(from: freshDefaults(#function))
    #expect(settings.count == CustomModeSettings.options.count)
    #expect(settings["labelColours"] as? Bool == true)
    #expect(settings["swapArchiveExpand"] as? Bool == true)
    #expect(settings["triageLabel"] as? String == "Triage")
    #expect(settings["snoozeDefault"] as? String == "2w")
    #expect(settings["bottomBarSlots"] as? String == "Snooze, Pin, Keep, Archive, Labels, Move, Delete")
}

@Test func storedValuesWinOverDefaults() {
    let defaults = freshDefaults(#function)
    defaults.set(false, forKey: "customMode.labelColours")
    defaults.set(false, forKey: "customMode.swapArchiveExpand")
    defaults.set("  Todo  ", forKey: "customMode.triageLabel")
    let settings = CustomModeSettings.current(from: defaults)
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["swapArchiveExpand"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")
}

// Emptying a field that names one thing asks for the default back: a
// triage label called nothing is not something anyone means.
@Test func emptyTextFallsBackToTheDefaultWhereEmptyMeansNothing() {
    let defaults = freshDefaults(#function)
    defaults.set("   ", forKey: "customMode.triageLabel")
    defaults.set("   ", forKey: "customMode.snoozeTime")
    let settings = CustomModeSettings.current(from: defaults)
    #expect(settings["triageLabel"] as? String == "Triage")
    #expect(settings["snoozeTime"] as? String == "08:00")
}

// Emptying a field that names a list says none of them, and has to survive the
// trip: clearing "Labels that are never projects" used to hand Later straight
// back, so there was no way to stop excluding it.
@Test func emptyTextIsHonouredWhereEmptyMeansNone() {
    let defaults = freshDefaults(#function)
    for key in ["excludedLabels", "contactGroupLabels", "appBadgeLabel"] {
        defaults.set("   ", forKey: "customMode.\(key)")
    }

    let settings = CustomModeSettings.current(from: defaults)
    #expect(settings["excludedLabels"] as? String == "")
    #expect(settings["contactGroupLabels"] as? String == "")
    #expect(settings["appBadgeLabel"] as? String == "")
}

// Never set is not the same as set to empty, even for those: a field nobody
// has touched still gets the default.
@Test func untouchedClearableFieldsStillGetTheirDefaults() {
    let settings = CustomModeSettings.current(from: freshDefaults(#function))
    #expect(settings["excludedLabels"] as? String == "Later, Feedbin")
    #expect(settings["contactGroupLabels"] as? String == "")
    #expect(settings["appBadgeLabel"] as? String == "Triage")
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
    #expect(object.count == CustomModeSettings.options.count)
    #expect(object["triageLabel"] as? String == "Todo")
}

@Test @MainActor func bootstrapScriptRunsFirstAndInTheMainFrameOnly() {
    let script = CustomModeSettings.bootstrapScript(from: freshDefaults(#function))
    #expect(script.injectionTime == .atDocumentStart)
    #expect(script.isForMainFrameOnly)
    #expect(script.source.hasPrefix("window.__customModeSettings = {"))
}

// The reorder list must offer exactly the verbs the userscript knows, in the
// catalog's order.
@Test @MainActor func barSlotNamesAreTheCurrentVerbs() {
    #expect(CustomModeSettingsModel.barSlotNames
        == ["Snooze", "Pin", "Keep", "Archive", "Labels", "Move", "Delete"])
    #expect(!CustomModeSettingsModel.barSlotNames.contains("File"))
    #expect(!CustomModeSettingsModel.barSlotNames.contains("Waiting"))
    #expect(!CustomModeSettingsModel.barSlotNames.contains("Someday"))
}

// Drawn from the catalog's own default so the reorder list cannot drift from
// the verbs the userscript actually knows.
@Test @MainActor func barSlotNamesMatchTheCatalogDefault() {
    let fromDefault = (CustomModeSettings.current(from: freshDefaults(#function))["bottomBarSlots"] as? String ?? "")
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
    #expect(CustomModeSettingsModel.barSlotNames == fromDefault)
}

// With nothing stored the reorder list is exactly the current verbs.
@Test @MainActor func loadBarOrderWithoutAStoredValueListsTheCurrentVerbs() {
    #expect(CustomModeSettingsModel.loadBarOrder(from: freshDefaults(#function))
        == ["Snooze", "Pin", "Keep", "Archive", "Labels", "Move", "Delete"])
}

// A value saved by an older build still names Waiting and Someday; those
// retired verbs are dropped, the recognised ones keep their saved order, and
// the rest follow in the catalog's order. Keep is not one of the retired
// ones: 2.x spelled this verb that way, 3.0 called it File, and it is Keep
// again, so a saved Keep names the verb it always meant.
@Test @MainActor func loadBarOrderDropsRetiredVerbsFromAnOlderStoredValue() {
    let defaults = freshDefaults(#function)
    defaults.set("Delete, Keep, Waiting, Someday, Move", forKey: "customMode.bottomBarSlots")
    let order = CustomModeSettingsModel.loadBarOrder(from: defaults)
    #expect(!order.contains("Waiting"))
    #expect(!order.contains("Someday"))
    #expect(Array(order.prefix(3)) == ["Delete", "Keep", "Move"])
    #expect(Set(order) == Set(["Snooze", "Pin", "Keep", "Archive", "Labels", "Move", "Delete"]))
}

// The verb was File between 3.0 and the rename. An order saved under that
// spelling still puts Keep where File stood, rather than losing the name and
// appending the verb at the end.
@Test @MainActor func loadBarOrderReadsASavedFileAsKeep() {
    let defaults = freshDefaults(#function)
    defaults.set("File, Archive, Snooze", forKey: "customMode.bottomBarSlots")
    let order = CustomModeSettingsModel.loadBarOrder(from: defaults)
    #expect(Array(order.prefix(3)) == ["Keep", "Archive", "Snooze"])
    #expect(!order.contains("File"))
}

@Test func subOptionsNameARealToggleParent() {
    for option in CustomModeSettings.options {
        guard let parentKey = option.parent else { continue }
        let parent = CustomModeSettings.options.first { $0.key == parentKey }
        #expect(parent != nil, "\(option.key) points at a missing parent")
        if case .toggle = parent?.defaultValue {} else {
            Issue.record("\(option.key)'s parent \(parentKey) is not a toggle")
        }
    }
}

// A sub-option renders indented under its parent within one group; a parent in
// a different tab would strand it, so they must share a group.
@Test func subOptionsShareTheirParentsGroup() {
    for option in CustomModeSettings.options {
        guard let parentKey = option.parent,
              let parent = CustomModeSettings.options.first(where: { $0.key == parentKey })
        else { continue }
        #expect(option.group == parent.group,
                "\(option.key) is in \(option.group) but its parent \(parentKey) is in \(parent.group)")
    }
}

// options(in:) partitions the catalog; every option lands in exactly one
// group, and no group is empty, so no tab or section comes up blank.
@Test func everyOptionBelongsToExactlyOneNonEmptyGroup() {
    let regrouped = CustomModeSettings.Group.allCases.flatMap { CustomModeSettings.options(in: $0) }
    #expect(regrouped.count == CustomModeSettings.options.count)
    #expect(Set(regrouped.map(\.key)) == Set(CustomModeSettings.options.map(\.key)))
    for group in CustomModeSettings.Group.allCases {
        #expect(!CustomModeSettings.options(in: group).isEmpty, "\(group) has no options")
    }
}

// The anchor settings sit where the grouping proposal placed them.
@Test func theAnchorSettingsAreInTheExpectedGroups() {
    func group(of key: String) -> CustomModeSettings.Group? {
        CustomModeSettings.options.first { $0.key == key }?.group
    }
    #expect(group(of: "appBadgeLabel") == .general)
    #expect(group(of: "labelColours") == .appearance)
    #expect(group(of: "triageLabel") == .labelsFiling)
    #expect(group(of: "snoozeKey") == .snooze)
    #expect(group(of: "urgentKey") == .keyboard)
    #expect(group(of: "bottomBarSlots") == .bottomBar)
}

// The custom-mode groups are every group but the app-level General one, which
// the shell builds itself.
@Test func inboxGroupsAreEveryGroupButGeneral() {
    #expect(!CustomModeSettings.Group.inboxGroups.contains(.general))
    #expect(Set(CustomModeSettings.Group.inboxGroups) == Set(CustomModeSettings.Group.allCases).subtracting([.general]))
}

// The mode was called Inbox mode until 2026-09-07, and its settings were
// stored under that name. Nobody should have to set them again.
@Test func settingsChosenUnderTheOldNameAreCarriedOver() {
    let defaults = freshDefaults(#function)
    defaults.set(false, forKey: "inboxMode.labelColours")
    defaults.set("Todo", forKey: "inboxMode.triageLabel")

    let settings = CustomModeSettings.current(from: defaults)
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")

    // Carried over once: the new key now holds it and the old one is gone
    #expect(defaults.object(forKey: "customMode.labelColours") as? Bool == false)
    #expect(defaults.object(forKey: "inboxMode.labelColours") == nil)
    #expect(defaults.object(forKey: "inboxMode.triageLabel") == nil)
}

// A value written since the rename is the answer; an older one never overwrites it
@Test func aValueChosenSinceTheRenameOutranksTheOldOne() {
    let defaults = freshDefaults(#function)
    defaults.set("Old", forKey: "inboxMode.triageLabel")
    defaults.set("New", forKey: "customMode.triageLabel")

    #expect(CustomModeSettings.current(from: defaults)["triageLabel"] as? String == "New")
    #expect(defaults.object(forKey: "inboxMode.triageLabel") == nil)
}

// The groupings field is the one place a user writes their own message-list
// groupings, so the shipped default doubles as the worked example of the
// format the userscript parses.
@Test func theGroupingsDefaultIsTheAgePreset() {
    let settings = CustomModeSettings.current(from: freshDefaults(#function))
    let text = settings["groupings"] as? String
    #expect(text?.hasPrefix("by age (urgent first)") == true)
    #expect(text?.contains("\n  Triage = in:Triage OR is:unread") == true)
    #expect(text?.contains("\n  Pinned = is:pinned") == true)
    #expect(text?.contains("\n  Today = date:today") == true)
    #expect(text?.contains("\n  Yesterday = date:yesterday") == true)
    #expect(text?.contains("\n  This week = after:1w") == true)
    #expect(text?.contains("\n  This month = after:1m") == true)
    #expect(text?.hasSuffix("\n  Older") == true)
}

// Emptied on purpose means no groupings of the user's own, not the preset back.
@Test func theGroupingsFieldIsClearable() {
    let defaults = freshDefaults(#function)
    defaults.set("   ", forKey: "customMode.groupings")
    #expect(CustomModeSettings.current(from: defaults)["groupings"] as? String == "")
}

// Only the form reads this; the value kind stays .text so the resolver, the
// injected JSON and their tests are untouched.
@Test func onlyTheGroupingsOptionIsMultiline() {
    let multiline = CustomModeSettings.options.filter(\.multiline).map(\.key)
    #expect(multiline == ["groupings"])
}

@Test func theGroupingsOptionSitsInItsOwnGroup() {
    #expect(CustomModeSettings.options(in: .grouping).map(\.key) == ["groupings"])
    #expect(CustomModeSettings.Group.grouping.title == "Groups")
}

#if canImport(AppKit)
import AppKit

private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

// The reorder list draws the bar's own glyphs, so every verb has to have one
// in the shared catalog, rendered as a template or it arrives as flat black
// artwork rather than taking the row's colour.
@Test @MainActor func everyBarSlotHasItsGlyphInTheSharedCatalog() throws {
    for name in CustomModeSettingsModel.barSlotNames {
        let glyph = CustomModeSettings.barSlotGlyph(name)
        #expect(!glyph.isEmpty, "\(name) names no glyph")

        let imageset = repoRoot
            .appendingPathComponent("Apps/Shared/Glyphs.xcassets")
            .appendingPathComponent("\(glyph).imageset")
        let manifest = imageset.appendingPathComponent("Contents.json")
        #expect(
            FileManager.default.fileExists(atPath: manifest.path),
            "\(glyph) is not in the shared asset catalog"
        )

        let contents = try #require(
            try JSONSerialization.jsonObject(with: try Data(contentsOf: manifest)) as? [String: Any]
        )
        let properties = contents["properties"] as? [String: Any]
        #expect(properties?["template-rendering-intent"] as? String == "template")

        let files = (contents["images"] as? [[String: Any]] ?? [])
            .compactMap { $0["filename"] as? String }
        #expect(!files.isEmpty, "\(glyph) names no artwork")
        for file in files {
            #expect(
                FileManager.default.fileExists(atPath: imageset.appendingPathComponent(file).path),
                "\(glyph) names \(file), which is not there"
            )
        }
    }
}

// The fallback only matters in a bundle without the catalog, but a name the
// system cannot draw would be a blank rather than a stand-in.
@Test @MainActor func everyBarSlotFallbackIsASymbolThatWillDraw() {
    for name in CustomModeSettingsModel.barSlotNames {
        let symbol = CustomModeSettings.barSlotSymbol(name)
        #expect(
            NSImage(systemSymbolName: symbol, accessibilityDescription: nil) != nil,
            "\(symbol) is not a symbol the system can draw"
        )
    }
}
#endif
