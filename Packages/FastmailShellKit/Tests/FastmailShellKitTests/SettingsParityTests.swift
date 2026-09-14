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
