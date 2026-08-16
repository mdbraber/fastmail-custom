import Foundation
import Testing
@testable import FastmailShellKit

private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

@Test func settingsBundleKeyMatchesTheDefaultsKey() throws {
    for app in ["Personal", "Work"] {
        let url = repoRoot
            .appendingPathComponent("Apps")
            .appendingPathComponent(app)
            .appendingPathComponent("Settings.bundle")
            .appendingPathComponent("Root.plist")
        let data = try Data(contentsOf: url)
        let plist = try #require(
            try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
        let specifiers = try #require(plist["PreferenceSpecifiers"] as? [[String: Any]])
        let keys = specifiers.compactMap { $0["Key"] as? String }
        #expect(keys.contains(StartView.defaultsKey))
    }
}

// The iOS Settings screen and the injected settings share the catalog's keys
// and defaults; a drifted plist would write values nothing reads.
@Test func settingsBundleCarriesEveryInboxModeOption() throws {
    for app in ["Personal", "Work"] {
        let url = repoRoot
            .appendingPathComponent("Apps")
            .appendingPathComponent(app)
            .appendingPathComponent("Settings.bundle")
            .appendingPathComponent("Root.plist")
        let data = try Data(contentsOf: url)
        let plist = try #require(
            try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
        let specifiers = try #require(plist["PreferenceSpecifiers"] as? [[String: Any]])
        let byKey = Dictionary(
            specifiers.compactMap { row in (row["Key"] as? String).map { ($0, row) } },
            uniquingKeysWith: { first, _ in first }
        )
        for option in InboxModeSettings.options {
            let row = try #require(byKey[option.defaultsKey], "\(app) is missing \(option.defaultsKey)")
            switch option.defaultValue {
            case .toggle(let value):
                #expect(row["Type"] as? String == "PSToggleSwitchSpecifier")
                #expect(row["DefaultValue"] as? Bool == value, Comment(rawValue: option.defaultsKey))
            case .text(let value):
                #expect(row["Type"] as? String == "PSTextFieldSpecifier")
                #expect(row["DefaultValue"] as? String == value, Comment(rawValue: option.defaultsKey))
            }
        }
    }
}
