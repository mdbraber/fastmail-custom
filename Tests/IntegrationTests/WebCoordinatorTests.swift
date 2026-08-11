import XCTest
import WebKit
@testable import FastmailShellKit

@MainActor
final class WebCoordinatorTests: XCTestCase {
    private struct WaitTimeoutError: Error {}

    private func waitUntil(
        timeout: TimeInterval = 5,
        _ condition: () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("condition not met within \(timeout)s")
        throw WaitTimeoutError()
    }

    func testDelegateSelectorsArePresent() {
        let coordinator = WebCoordinator(model: ShellModel(), startURL: URL(string: "https://app.fastmail.com")!)
        let coordinatorSelectors = [
            "webView:decidePolicyForNavigationAction:decisionHandler:",
            "webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:",
            "webViewWebContentProcessDidTerminate:",
            "webView:didFailNavigation:withError:"
        ]
        for selector in coordinatorSelectors {
            XCTAssertTrue(
                coordinator.responds(to: NSSelectorFromString(selector)),
                "WebCoordinator does not respond to \(selector)"
            )
        }

        let bridge = NativeBridge(onLog: { _ in }, onError: { _ in })
        let bridgeSelector = "userContentController:didReceiveScriptMessage:replyHandler:"
        XCTAssertTrue(
            bridge.responds(to: NSSelectorFromString(bridgeSelector)),
            "NativeBridge does not respond to \(bridgeSelector)"
        )
    }

    func testDisallowedMainFrameNavigationIsRefused() async throws {
        let model = ShellModel()
        let fixtureURL = Bundle(for: WebCoordinatorTests.self).url(forResource: "fixture", withExtension: "html")!
        let fixtureHTML = try String(contentsOf: fixtureURL, encoding: .utf8)
        let allowedBaseURL = URL(string: "https://app.fastmail.com")!
        var openedURLs: [URL] = []
        let coordinator = WebCoordinator(
            model: model,
            startURL: allowedBaseURL,
            openExternally: { url in openedURLs.append(url) }
        )
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = coordinator

        webView.loadHTMLString(fixtureHTML, baseURL: allowedBaseURL)
        try await waitUntil { webView.url?.host == "app.fastmail.com" }

        let blockedURL = URL(string: "https://example.com/")!
        webView.load(URLRequest(url: blockedURL))
        try await waitUntil { !openedURLs.isEmpty }

        XCTAssertEqual(openedURLs, [blockedURL])
        XCTAssertNotEqual(webView.url?.host, "example.com")
    }
}
