import Foundation
import Testing
@testable import FastmailShellKit

private func url(_ text: String) -> URL {
    URL(string: text)!
}

@Test func activityTypeHangsOffTheBundleIdentifier() {
    #expect(
        Continuity.activityType(bundleID: "com.mdbraber.fastmail-custom.personal")
            == "com.mdbraber.fastmail-custom.personal.browse"
    )
}

@Test func activityTypeNeedsABundleIdentifier() {
    #expect(Continuity.activityType(bundleID: nil) == nil)
    #expect(Continuity.activityType(bundleID: "  ") == nil)
}

@Test func aFastmailPageIsWorthContinuing() {
    #expect(
        Continuity.advertised(url("https://app.fastmail.com/mail/Inbox"))
            == url("https://app.fastmail.com/mail/Inbox")
    )
    #expect(
        Continuity.advertised(url("https://app.beta.fastmail.com/mail/Inbox/T123?u=f00dcafe"))
            == url("https://app.beta.fastmail.com/mail/Inbox/T123?u=f00dcafe")
    )
}

@Test func anythingButAFastmailPageIsNot() {
    #expect(Continuity.advertised(nil) == nil)
    #expect(Continuity.advertised(url("about:blank")) == nil)
    #expect(Continuity.advertised(url("https://example.com/mail/Inbox")) == nil)
    #expect(Continuity.advertised(url("fastmail-personal://open?url=x")) == nil)
}

/// The marker that says a link was passed between the two accounts is a
/// message to this app, not part of the page's address.
@Test func theAccountMarkerIsLeftBehind() {
    #expect(
        Continuity.advertised(url("https://app.fastmail.com/mail/Inbox?handoff=1&u=f00dcafe"))
            == url("https://app.fastmail.com/mail/Inbox?u=f00dcafe")
    )
    #expect(
        Continuity.advertised(url("https://app.fastmail.com/mail/Inbox?handoff=1"))
            == url("https://app.fastmail.com/mail/Inbox")
    )
}

@MainActor
@Test func anActivityCarriesThePageAcross() {
    let activity = NSUserActivity(activityType: "com.example.browse")
    Continuity.describe(activity, url: url("https://app.fastmail.com/mail/Inbox/T1"), title: "Dinner")

    #expect(activity.webpageURL == url("https://app.fastmail.com/mail/Inbox/T1"))
    #expect(activity.title == "Dinner")
    #expect(activity.isEligibleForHandoff)
    #expect(Continuity.target(of: activity) == url("https://app.fastmail.com/mail/Inbox/T1"))
}

/// An activity that arrives from an older build, or from something else
/// entirely, opens nothing rather than opening the wrong thing.
@MainActor
@Test func anActivityWithoutAPageOpensNothing() {
    #expect(Continuity.target(of: NSUserActivity(activityType: "com.example.browse")) == nil)

    let stray = NSUserActivity(activityType: "com.example.browse")
    stray.webpageURL = url("https://example.com/")
    #expect(Continuity.target(of: stray) == nil)
}

/// The page's own subject when there is one, so the Handoff banner names the
/// message rather than the app.
@MainActor
@Test func theTitleIsTheSubjectWhenThereIsOne() {
    #expect(Continuity.title(subject: "Dinner on Friday", fallback: "mdbraber.com") == "Dinner on Friday")
    #expect(Continuity.title(subject: "   ", fallback: "mdbraber.com") == "mdbraber.com")
    #expect(Continuity.title(subject: nil, fallback: "mdbraber.com") == "mdbraber.com")
}
