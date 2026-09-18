import Testing
import WebKit
@testable import FastmailShellKit

@Test func mainFrameAllowIsAllowed() {
    #expect(WebCoordinator.outcome(for: .allow, isMainFrame: true) == .allow)
}

@Test func subframeAllowIsAllowed() {
    #expect(WebCoordinator.outcome(for: .allow, isMainFrame: false) == .allow)
}

@Test func mainFrameOpenExternallyOrDownloadOpensExternally() {
    #expect(WebCoordinator.outcome(for: .openExternally, isMainFrame: true) == .cancelAndOpenExternally)
    #expect(WebCoordinator.outcome(for: .download, isMainFrame: true) == .cancelAndOpenExternally)
}

@Test func subframeOpenExternallyOrDownloadCancelsWithoutOpening() {
    #expect(WebCoordinator.outcome(for: .openExternally, isMainFrame: false) == .cancel)
    #expect(WebCoordinator.outcome(for: .download, isMainFrame: false) == .cancel)
}

@Test func mainFrameRefuseCancelsWithBanner() {
    #expect(WebCoordinator.outcome(for: .refuse, isMainFrame: true) == .cancelWithBanner)
}

@Test func subframeRefuseCancelsWithoutOpeningOrBanner() {
    #expect(WebCoordinator.outcome(for: .refuse, isMainFrame: false) == .cancel)
}

@Test func linkActivatedWindowOpenFollowsTheNavigationDecision() {
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .allow) == .openInWindow)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .openExternally) == .cancelAndOpenExternally)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .download) == .cancelAndOpenExternally)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .refuse) == .cancelWithBanner)
}

// Fastmail asks for a window of its own in more ways than a link click,
// "Open in new window" on a message is one, and all of them get a window.
@Test func aFastmailWindowIsGivenOneHoweverItWasAskedFor() {
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .other, decision: .allow) == .openInWindow)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .formSubmitted, decision: .allow) == .openInWindow)
}

// Anywhere else, a window nobody clicked for is a pop-up and is refused.
@Test func nonLinkActivatedWindowOpenIsCancelledForAnywhereElse() {
    for decision: NavigationDecision in [.openExternally, .download, .refuse] {
        #expect(WebCoordinator.windowOpenOutcome(navigationType: .other, decision: decision) == .cancel)
    }
}

@Test func genuineLinkClickOpensExternallyButProgrammaticWindowOpenDoesNot() {
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .openExternally) == .cancelAndOpenExternally)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .other, decision: .openExternally) == .cancel)
}

@Test func refusalBannerNamesOnlyTheScheme() {
    #expect(
        WebCoordinator.refusalBanner(for: URL(string: "q:Fastmail-Security-Alert-Call-1-800-555-0100")!)
            == "Refused to open a q: link"
    )
    #expect(!WebCoordinator.refusalBanner(for: URL(string: "q:Fastmail-Security-Alert-Call-1-800-555-0100")!)
        .contains("Fastmail-Security-Alert"))
}

@Test func refusalBannerFallsBackWhenURLHasNoScheme() {
    let url = URL(string: "no-scheme")!
    #expect(url.scheme == nil)
    #expect(WebCoordinator.refusalBanner(for: url) == "Refused to open a link")
}

@Test func subframeCancelLogMessageNamesTheURL() {
    let url = URL(string: "https://fastmailusercontent.com/evil.pdf")!
    #expect(WebCoordinator.subframeCancelLogMessage(for: url) == "Cancelled subframe response: https://fastmailusercontent.com/evil.pdf")
}

// The system reclaims a backgrounded app's web content process routinely, and
// coming back to a page that reloaded itself is ordinary.
@MainActor
@Test func aTerminationInTheBackgroundReloadsWithoutSayingSo() {
    let model = ShellModel()
    let coordinator = WebCoordinator(
        model: model,
        startURL: URL(string: "https://app.fastmail.com/mail/Inbox")!,
        isInFront: { false }
    )

    coordinator.webViewWebContentProcessDidTerminate(WKWebView())

    #expect(model.banner == nil)
}

@MainActor
@Test func aTerminationWhileYouAreLookingAtItSaysWhatHappened() {
    let model = ShellModel()
    let coordinator = WebCoordinator(
        model: model,
        startURL: URL(string: "https://app.fastmail.com/mail/Inbox")!,
        isInFront: { true }
    )

    coordinator.webViewWebContentProcessDidTerminate(WKWebView())

    #expect(model.banner == "The page stopped responding and was reloaded.")
}

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit

// A draft discarded in a window Fastmail popped out ends with the page
// calling window.close() on itself. WebKit tears the page down and leaves
// the window to the app, which used to leave it standing there empty.
@MainActor
@Test func aPageClosingItselfTakesItsPoppedOutWindowWithIt() {
    let coordinator = WebCoordinator(
        model: ShellModel(),
        startURL: URL(string: "https://app.fastmail.com/mail/Inbox")!
    )
    let view = WKWebView()
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
        styleMask: [.titled, .closable],
        backing: .buffered,
        defer: true
    )
    window.isReleasedWhenClosed = false
    window.contentView = view
    window.orderFront(nil)
    #expect(window.isVisible)

    coordinator.webViewDidClose(view)

    #expect(!window.isVisible)
}
#endif
