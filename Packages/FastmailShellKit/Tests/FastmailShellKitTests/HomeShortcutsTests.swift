import Foundation
import Testing
@testable import FastmailShellKit

@Test func theHomeScreenOffersTheTwoListsAndTheTwoBeginnings() {
    let shortcuts = HomeShortcuts.shortcuts(badgeLabel: "Triage")
    #expect(shortcuts.map(\.title) == ["Inbox", "Triage", "Compose", "Search"])
    #expect(shortcuts.count == 4, "iOS draws four and no more")
    #expect(shortcuts.map(\.path) == ["/mail/Inbox", "/mail/Triage", "/mail/Inbox/compose", nil])
    #expect(shortcuts.map(\.type) == [
        HomeShortcuts.inboxType, HomeShortcuts.labelType,
        HomeShortcuts.composeType, HomeShortcuts.searchType
    ])
    #expect(Set(shortcuts.map(\.icon)).count == 4, "each is told apart at a glance")
    #expect(shortcuts.first?.icon == .system("tray"))
    // The funnel, the same glyph the sidebar row wears for this label, rather
    // than the tag a label would otherwise get.
    #expect(shortcuts[1].icon == .template(HomeShortcuts.funnelImageName))
}

// Search has no address to open; Fastmail's /mail/search: bounces to the
// Inbox with nothing typed. So it asks the page instead, and it is the only
// one of the four that does.
@Test func searchAsksThePageAndOpensNoAddress() {
    let shortcuts = HomeShortcuts.shortcuts(badgeLabel: "Triage")
    let search = shortcuts.first { $0.type == HomeShortcuts.searchType }
    #expect(search?.action == "search")
    #expect(search?.path == nil)
    #expect(shortcuts.filter { $0.action != nil }.count == 1)
    #expect(shortcuts.allSatisfy { $0.path != nil || $0.action != nil }, "an entry that does nothing is not one")
}

// An icon that does not resolve draws a blank rather than complaining, and a
// blank says nothing about which of the two was wrong.
#if canImport(AppKit)
import AppKit

private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

@Test @MainActor func everyShortcutIconIsOneThatWillDraw() throws {
    for shortcut in HomeShortcuts.shortcuts(badgeLabel: "Triage") {
        switch shortcut.icon {
        case .system(let name):
            #expect(
                NSImage(systemSymbolName: name, accessibilityDescription: nil) != nil,
                "\(name) is not a symbol iOS can draw"
            )
        case .template(let name):
            let imageset = repoRoot
                .appendingPathComponent("Apps/Shared/Glyphs.xcassets")
                .appendingPathComponent("\(name).imageset")
            #expect(
                FileManager.default.fileExists(atPath: imageset.appendingPathComponent("Contents.json").path),
                "\(name) is not in the shared asset catalog"
            )

            // Rendered as a template, or it arrives as flat black artwork
            // rather than taking the menu's own colour.
            let data = try Data(contentsOf: imageset.appendingPathComponent("Contents.json"))
            let contents = try #require(
                try JSONSerialization.jsonObject(with: data) as? [String: Any]
            )
            let properties = contents["properties"] as? [String: Any]
            #expect(properties?["template-rendering-intent"] as? String == "template")

            let files = (contents["images"] as? [[String: Any]] ?? [])
                .compactMap { $0["filename"] as? String }
            #expect(!files.isEmpty, "\(name) names no artwork")
            for file in files {
                #expect(
                    FileManager.default.fileExists(atPath: imageset.appendingPathComponent(file).path),
                    "\(name) names \(file), which is not there"
                )
            }
        }
    }
}
#endif

@Test func withoutABadgeLabelTheLabelRowIsTheOnlyOneMissing() {
    #expect(HomeShortcuts.shortcuts(badgeLabel: "").map(\.title) == ["Inbox", "Compose", "Search"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: "   ").map(\.title) == ["Inbox", "Compose", "Search"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: nil).map(\.title) == ["Inbox", "Compose", "Search"])
}

// The badge label may be the Inbox itself; two identical shortcuts help nobody
@Test func aBadgeLabelThatIsTheInboxIsNotOfferedTwice() {
    #expect(HomeShortcuts.shortcuts(badgeLabel: "Inbox").map(\.title) == ["Inbox", "Compose", "Search"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: "  inbox ").map(\.title) == ["Inbox", "Compose", "Search"])
}

@Test func aNestedLabelKeepsItsPathAndAwkwardCharactersAreEncoded() {
    func labelShortcut(_ badgeLabel: String) -> HomeShortcut? {
        HomeShortcuts.shortcuts(badgeLabel: badgeLabel).first { $0.type == HomeShortcuts.labelType }
    }
    #expect(labelShortcut("Projects/Work")?.path == "/mail/Projects/Work")
    #expect(labelShortcut("To read")?.path == "/mail/To%20read")
    #expect(labelShortcut("R&D")?.path == "/mail/R%26D")
    // The title stays readable whatever the path needs
    #expect(labelShortcut("To read")?.title == "To read")
    #expect(labelShortcut("Projects/Work")?.title == "Projects/Work")
}

@Test func aShortcutOpensItsPageOnFastmail() throws {
    let url = try #require(HomeShortcuts.url(path: "/mail/Triage", backend: .production))
    #expect(url.absoluteString == "https://app.fastmail.com/mail/Triage")
    // The shortcut lands on the server the app is set to, like everything else
    let onBeta = try #require(HomeShortcuts.url(path: "/mail/Triage", backend: .beta))
    #expect(onBeta.absoluteString == "https://app.beta.fastmail.com/mail/Triage")
    // A path is all a shortcut carries; anything else is refused rather than opened
    #expect(HomeShortcuts.url(path: "https://example.net/mail/Inbox") == nil)
    #expect(HomeShortcuts.url(path: "mail/Inbox") == nil)
    #expect(HomeShortcuts.url(path: "") == nil)
}

// The link goes through the same router a tapped push does, so it must pass it
@Test func aShortcutsAddressIsOneTheRouterWillOpen() throws {
    let profile = Profile(
        id: "personal",
        displayName: "Test",
        startURL: URL(string: "https://app.fastmail.com/")!,
        overlayScriptName: nil,
        urlScheme: "fastmail-personal",
        accountID: "f00dcafe",
        handoffScheme: nil
    )
    let url = try #require(HomeShortcuts.url(path: "/mail/Triage"))
    #expect(LinkRouter.route(url, profile: profile) == .load(url))
}
