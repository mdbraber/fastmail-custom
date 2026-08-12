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
