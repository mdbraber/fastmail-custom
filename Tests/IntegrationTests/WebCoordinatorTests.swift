import XCTest
import WebKit
import AppKit
@testable import FastmailShellKit

@MainActor
final class WebCoordinatorTests: XCTestCase {
    private struct WaitTimeoutError: Error {}

    private func waitUntil(
        timeout: TimeInterval = 5,
        _ condition: () async throws -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("condition not met within \(timeout)s")
        throw WaitTimeoutError()
    }

    func testDelegateSelectorsArePresent() {
        let coordinator = WebCoordinator(model: ShellModel(), startURL: URL(string: "https://app.fastmail.com")!)
        let coordinatorSelectors = [
            "webView:decidePolicyForNavigationAction:decisionHandler:",
            "webView:decidePolicyForNavigationResponse:decisionHandler:",
            "webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:",
            "webViewWebContentProcessDidTerminate:",
            "webView:didFailNavigation:withError:",
            "webView:didFailProvisionalNavigation:withError:"
        ]
        for selector in coordinatorSelectors {
            XCTAssertTrue(
                coordinator.responds(to: NSSelectorFromString(selector)),
                "WebCoordinator does not respond to \(selector)"
            )
        }

        let bridge = NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
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

    func testRefusedSchemeCancelsNavigationWithoutExternalOpenAndSurfacesBanner() async throws {
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

        let refusedURL = URL(string: "file:///etc/passwd")!
        webView.load(URLRequest(url: refusedURL))
        try await waitUntil { model.banner != nil }

        XCTAssertTrue(openedURLs.isEmpty)
        XCTAssertNotEqual(webView.url, refusedURL)
        XCTAssertEqual(model.banner, "Refused to open \(refusedURL.absoluteString)")
    }

    func testFullScreenClassIsReassertedWhenNavigationFinishesWhileWindowIsFullScreen() async throws {
        let model = ShellModel()
        let coordinator = WebCoordinator(model: model, startURL: URL(string: "https://app.fastmail.com")!)
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = coordinator
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
            styleMask: [.titled, .closable, .fullScreen],
            backing: .buffered,
            defer: true
        )
        window.contentView = webView

        webView.loadHTMLString("<html><body></body></html>", baseURL: URL(string: "https://app.fastmail.com")!)
        try await waitUntil {
            (try? await webView.evaluateJavaScript(
                "document.body.classList.contains('fmshell-fullscreen')"
            )) as? Bool == true
        }
    }

    func testFullScreenClassIsNotAssertedWhenWindowIsNotFullScreen() async throws {
        let model = ShellModel()
        let coordinator = WebCoordinator(model: model, startURL: URL(string: "https://app.fastmail.com")!)
        let webView = WKWebView(frame: .zero)
        webView.navigationDelegate = coordinator
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: true
        )
        window.contentView = webView

        webView.loadHTMLString("<html><body></body></html>", baseURL: URL(string: "https://app.fastmail.com")!)
        try await waitUntil { webView.url?.host == "app.fastmail.com" }
        let hasClass = try await webView.evaluateJavaScript(
            "document.body.classList.contains('fmshell-fullscreen')"
        ) as? Bool
        XCTAssertEqual(hasClass, false)
    }

    func testProvisionalNavigationFailureFiltersOnlyOwnPolicyCancellations() {
        let cases: [(error: NSError, shouldReport: Bool)] = [
            (NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled), false),
            (NSError(domain: "WebKitErrorDomain", code: 102), false),
            (NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet), true),
            (NSError(domain: "SomeOtherDomain", code: 102), true)
        ]
        for testCase in cases {
            let model = ShellModel()
            let coordinator = WebCoordinator(model: model, startURL: URL(string: "https://app.fastmail.com")!)
            coordinator.webView(
                WKWebView(frame: .zero),
                didFailProvisionalNavigation: nil,
                withError: testCase.error
            )
            XCTAssertEqual(
                model.banner != nil,
                testCase.shouldReport,
                "domain=\(testCase.error.domain) code=\(testCase.error.code)"
            )
        }
    }
}
