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
