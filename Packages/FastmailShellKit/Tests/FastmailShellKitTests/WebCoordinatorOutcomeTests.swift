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
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .allow) == .allow)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .openExternally) == .cancelAndOpenExternally)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .download) == .cancelAndOpenExternally)
    #expect(WebCoordinator.windowOpenOutcome(navigationType: .linkActivated, decision: .refuse) == .cancelWithBanner)
}

@Test func nonLinkActivatedWindowOpenIsCancelledRegardlessOfDecision() {
    for decision: NavigationDecision in [.allow, .openExternally, .download, .refuse] {
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
