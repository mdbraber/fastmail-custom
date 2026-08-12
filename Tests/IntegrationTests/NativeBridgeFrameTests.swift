import XCTest
import WebKit
@testable import FastmailShellKit

@MainActor
final class NativeBridgeFrameTests: XCTestCase {
    private struct WaitTimeoutError: Error {}
    private var webView: WKWebView!
    private var bridge: NativeBridge!

    override func tearDown() {
        webView = nil
        bridge = nil
        super.tearDown()
    }

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

    private func makeWebView(expectedHost: String = "app.fastmail.com") {
        let configuration = WKWebViewConfiguration()
        bridge = NativeBridge(expectedHost: expectedHost, onLog: { _ in }, onError: { _ in })
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        webView = WKWebView(frame: .zero, configuration: configuration)
    }

    private func waitForDocumentReady(onHost host: String) async throws {
        try await waitUntil {
            try await self.webView.evaluateJavaScript(
                "document.readyState === 'complete' && location.host === '\(host)'"
            ) as? Bool == true
        }
    }

    private func bridgeResult() async throws -> Bool {
        try await waitUntil {
            try await self.webView.evaluateJavaScript("typeof window.__bridgeResult") as? String == "object"
        }
        return try await webView.evaluateJavaScript("window.__bridgeResult.ok") as? Bool ?? false
    }

    func testMessageFromMatchingOriginMainFrameIsAccepted() async throws {
        makeWebView()
        webView.loadHTMLString("<html><body></body></html>", baseURL: URL(string: "https://app.fastmail.com")!)
        try await waitForDocumentReady(onHost: "app.fastmail.com")
        _ = try await webView.evaluateJavaScript(Self.postMessageAndRecordJS)
        let ok = try await bridgeResult()
        XCTAssertTrue(ok)
    }

    func testMessageFromWrongOriginMainFrameIsRejected() async throws {
        makeWebView()
        webView.loadHTMLString(
            "<html><body></body></html>",
            baseURL: URL(string: "https://evil.fastmailusercontent.com")!
        )
        try await waitForDocumentReady(onHost: "evil.fastmailusercontent.com")
        _ = try await webView.evaluateJavaScript(Self.postMessageAndRecordJS)
        let ok = try await bridgeResult()
        XCTAssertFalse(ok)
    }

    func testMessageFromNonMainFrameIsRejectedEvenWhenOriginMatches() async throws {
        makeWebView()
        webView.loadHTMLString("<html><body></body></html>", baseURL: URL(string: "https://app.fastmail.com")!)
        try await waitForDocumentReady(onHost: "app.fastmail.com")
        _ = try await webView.evaluateJavaScript(Self.createSubframeAndPostMessageJS)
        let ok = try await bridgeResult()
        XCTAssertFalse(ok)
    }

    private static let postMessageAndRecordJS = #"""
    (function () {
        window.webkit.messageHandlers.native.postMessage({ action: 'log', payload: { message: 'x' } })
            .then(function (value) { window.__bridgeResult = { ok: true, value: value }; })
            .catch(function (error) { window.__bridgeResult = { ok: false, error: String(error) }; });
    })();
    """#

    private static let createSubframeAndPostMessageJS = #"""
    (function () {
        var iframe = document.createElement('iframe');
        iframe.srcdoc = "<script>window.webkit.messageHandlers.native.postMessage({action:'log',payload:{message:'x'}}).then(function(v){parent.__bridgeResult={ok:true,value:v};}).catch(function(e){parent.__bridgeResult={ok:false,error:String(e)};});<\/script>";
        document.body.appendChild(iframe);
    })();
    """#
}
