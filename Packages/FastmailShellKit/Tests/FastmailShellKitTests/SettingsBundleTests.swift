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

// The alerts switch is read by the registrar under this key; the Settings
// app must write the same one, with the same default, or the two disagree.
@Test func settingsBundleCarriesTheAlertsSwitch() throws {
    for app in apps {
        let row = try #require(
            try specifiers(for: app).first { $0["Key"] as? String == PushPreferences.alertsKey },
            "\(app) is missing the alerts row"
        )
        #expect(row["Type"] as? String == "PSToggleSwitchSpecifier")
        #expect(row["DefaultValue"] as? Bool == true)
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
        #expect(row["DefaultValue"] as? String == Backend.standard.rawValue)
        #expect(row["Values"] as? [String] == Backend.allCases.map(\.rawValue))
        #expect(row["Titles"] as? [String] == Backend.allCases.map(\.title))
    }
}

// The Custom mode options are in the page now. A row here would be a second
// place to change one, and the two would disagree the moment either was used.
@Test func settingsBundleCarriesNoCustomModeRow() throws {
    for app in apps {
        let keys = try specifiers(for: app).compactMap { $0["Key"] as? String }
        #expect(!keys.contains { $0.hasPrefix(CustomModeSettings.keyPrefix) }, "\(app) still has one")
        #expect(Set(keys) == [Backend.defaultsKey, StartView.defaultsKey, PushPreferences.alertsKey])
    }
}
