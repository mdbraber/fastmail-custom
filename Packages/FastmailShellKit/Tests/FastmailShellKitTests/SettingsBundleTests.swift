import Foundation
import Testing
@testable import FastmailShellKit

private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

private let apps = ["Personal", "Work"]

private func specifiers(for app: String) throws -> [[String: Any]] {
    let url = repoRoot
        .appendingPathComponent("Apps")
        .appendingPathComponent(app)
        .appendingPathComponent("Settings.bundle")
        .appendingPathComponent("Root.plist")
    let data = try Data(contentsOf: url)
    let plist = try #require(
        try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    )
    return try #require(plist["PreferenceSpecifiers"] as? [[String: Any]])
}

@Test func settingsBundleKeyMatchesTheDefaultsKey() throws {
    for app in apps {
        let keys = try specifiers(for: app).compactMap { $0["Key"] as? String }
        #expect(keys.contains(StartView.defaultsKey))
    }
}

// The plist names the backends in strings the generator writes by hand, so
// this is what stops them drifting from the cases the app actually resolves
@Test func settingsBundleOffersEveryBackend() throws {
    for app in apps {
        let row = try #require(
            try specifiers(for: app).first { $0["Key"] as? String == Backend.defaultsKey },
            "\(app) is missing the backend row"
        )
        #expect(row["Type"] as? String == "PSMultiValueSpecifier")
        #expect(row["DefaultValue"] as? String == Backend.production.rawValue)
        #expect(row["Values"] as? [String] == Backend.allCases.map(\.rawValue))
        #expect(row["Titles"] as? [String] == Backend.allCases.map(\.title))
    }
}

// The generator writes the group headers from its own title map; this ties
// that map to the catalog's Group titles so the two cannot drift.
@Test func settingsBundleShowsEveryGroupHeader() throws {
    for app in apps {
        let titles = try specifiers(for: app)
            .filter { $0["Type"] as? String == "PSGroupSpecifier" }
            .compactMap { $0["Title"] as? String }
        for group in InboxModeSettings.Group.allCases {
            #expect(titles.contains(group.title), "\(app) is missing the \(group.title) header")
        }
    }
}

// The iOS Settings screen and the injected settings share the catalog's keys
// and defaults; a drifted plist would write values nothing reads.
@Test func settingsBundleCarriesEveryInboxModeOption() throws {
    for app in apps {
        let byKey = Dictionary(
            try specifiers(for: app).compactMap { row in (row["Key"] as? String).map { ($0, row) } },
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
