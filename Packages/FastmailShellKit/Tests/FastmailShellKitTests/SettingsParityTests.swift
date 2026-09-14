import Foundation
import Testing
@testable import FastmailShellKit

// The userscript's catalogue is canonical and nothing else enumerates the
// options, so there is only one thing left that could drift: the badge
// label's default, which the shell needs before the page has ever run.
private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

@Test func theBadgeLabelDefaultMatchesTheUserscript() throws {
    let source = try String(
        contentsOf: repoRoot.appendingPathComponent("Userscript/fastmail-custom-mode.user.js"),
        encoding: .utf8
    )
    let line = try #require(
        source.split(separator: "\n").first { $0.contains("appBadgeLabel:") },
        "the userscript no longer declares appBadgeLabel"
    )
    #expect(line.contains("'\(CustomModeSettings.badgeLabelDefault)'"))
}

// The extension's native part answers through the rules file the apps
// compile, so its store keys and local-only list are the apps' own
@Test func theSafariExtensionsNativePartAnswersThroughTheSharedRules() throws {
    let project = repoRoot.appendingPathComponent("SafariExtension/App/Fastmail Custom Mode")
    let handler = try String(
        contentsOf: project.appendingPathComponent("Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift"),
        encoding: .utf8
    )
    #expect(handler.contains("SettingsSyncRules.extensionAnswer("))

    let pbxproj = try String(
        contentsOf: project.appendingPathComponent("Fastmail Custom Mode.xcodeproj/project.pbxproj"),
        encoding: .utf8
    )
    let reference = "../../../Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift"
    #expect(pbxproj.contains("path = \(reference);"))
    #expect(pbxproj.contains("/* SettingsSyncRules.swift in Sources */,"))
    let named = project.appendingPathComponent(reference).standardizedFileURL
    #expect(FileManager.default.fileExists(atPath: named.path))
}

// background.js never builds a store key; the native part does, through the
// shared rules. What the scripts must agree on is which settings stay on the
// Mac and what an account id looks like.
@Test func theSafariExtensionsScriptsAgreeWithTheSyncRules() throws {
    let background = try String(
        contentsOf: repoRoot.appendingPathComponent("SafariExtension/background.js"),
        encoding: .utf8
    )
    let early = try String(
        contentsOf: repoRoot.appendingPathComponent("SafariExtension/early.js"),
        encoding: .utf8
    )

    let line = try #require(
        background.split(separator: "\n").first { $0.hasPrefix("const LOCAL_ONLY_KEYS = ") },
        "background.js no longer declares LOCAL_ONLY_KEYS"
    )
    let names = line.split(separator: "'").enumerated().filter { $0.offset % 2 == 1 }.map { String($0.element) }
    #expect(names.count == SettingsSyncRules.localOnlyKeys.count)
    #expect(Set(names) == SettingsSyncRules.localOnlyKeys)

    let pattern = "const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,\(SettingsSyncRules.maxAccountIdLength)}$/;"
    #expect(background.contains(pattern))
    #expect(early.contains(pattern))
}
