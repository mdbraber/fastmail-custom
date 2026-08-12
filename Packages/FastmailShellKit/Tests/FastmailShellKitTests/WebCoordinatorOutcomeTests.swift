import Testing
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
