import Foundation
import Testing
@testable import FastmailShellKit

@Test func theHomeScreenOffersTheBadgeLabelAndTheInbox() {
    let shortcuts = HomeShortcuts.shortcuts(badgeLabel: "Triage")
    #expect(shortcuts.map(\.title) == ["Triage", "Inbox"])
    #expect(shortcuts.map(\.path) == ["/mail/Triage", "/mail/Inbox"])
    #expect(shortcuts.map(\.type) == [HomeShortcuts.labelType, HomeShortcuts.inboxType])
    #expect(Set(shortcuts.map(\.systemImage)).count == 2, "the two are told apart at a glance")
}

@Test func withoutABadgeLabelOnlyTheInboxIsOffered() {
    #expect(HomeShortcuts.shortcuts(badgeLabel: "").map(\.title) == ["Inbox"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: "   ").map(\.title) == ["Inbox"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: nil).map(\.title) == ["Inbox"])
}

// The badge label may be the Inbox itself; two identical shortcuts help nobody
@Test func aBadgeLabelThatIsTheInboxIsNotOfferedTwice() {
    #expect(HomeShortcuts.shortcuts(badgeLabel: "Inbox").map(\.title) == ["Inbox"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: "  inbox ").map(\.title) == ["Inbox"])
}

@Test func aNestedLabelKeepsItsPathAndAwkwardCharactersAreEncoded() {
    #expect(HomeShortcuts.shortcuts(badgeLabel: "Projects/Work").map(\.path) == ["/mail/Projects/Work", "/mail/Inbox"])
    #expect(HomeShortcuts.shortcuts(badgeLabel: "To read").first?.path == "/mail/To%20read")
    #expect(HomeShortcuts.shortcuts(badgeLabel: "R&D").first?.path == "/mail/R%26D")
    // The title stays readable whatever the path needs
    #expect(HomeShortcuts.shortcuts(badgeLabel: "To read").first?.title == "To read")
    #expect(HomeShortcuts.shortcuts(badgeLabel: "Projects/Work").first?.title == "Projects/Work")
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
