import XCTest
import WebKit
@testable import FastmailShellKit

@MainActor
final class HarnessTests: XCTestCase {
    private var webView: WKWebView!
    private var received: [[String: Any]] = []

    private final class Recorder: NSObject, WKScriptMessageHandlerWithReply {
        var onMessage: (([String: Any]) -> Void)?
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
        ) {
            if let body = message.body as? [String: Any] { onMessage?(body) }
            replyHandler(nil, nil)
        }
    }

    private static var fixtureURL: URL {
        Bundle(for: HarnessTests.self).url(forResource: "fixture", withExtension: "html")!
    }

    private static func meta(
        matches: [String] = [],
        runAt: UserScriptMetadata.RunAt = .documentIdle
    ) -> UserScriptMetadata {
        UserScriptMetadata(name: "T", matches: matches, runAt: runAt, grants: ["none"])
    }

    private func makeWebView(userScript: String, metadata: UserScriptMetadata) throws -> WKWebView {
        let harnessURL = Bundle(for: HarnessTests.self).url(forResource: "harness", withExtension: "js")!
        let harness = try String(contentsOf: harnessURL, encoding: .utf8)
        let bundle = ScriptBundle(
            harness: harness,
            userScript: userScript,
            overlay: nil,
            metadata: metadata
        )
        let configuration = WKWebViewConfiguration()
        let recorder = Recorder()
        recorder.onMessage = { [weak self] body in self?.received.append(body) }
        configuration.userContentController.addScriptMessageHandler(
            recorder,
            contentWorld: .page,
            name: "native"
        )
        for script in try ScriptInjector.userScripts(from: bundle, url: Self.fixtureURL) {
            configuration.userContentController.addUserScript(script)
        }
        return WKWebView(frame: .zero, configuration: configuration)
    }

    private func load(_ webView: WKWebView) async throws {
        let url = Self.fixtureURL
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        try await waitUntil {
            try await self.evaluate(
                webView,
                "document.readyState === 'complete' && /fixture\\.html/.test(document.URL)"
            ) as? Bool == true
        }
    }

    private func evaluate(_ webView: WKWebView, _ js: String) async throws -> Any? {
        try await webView.evaluateJavaScript(js)
    }

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

    func testHarnessInstallsAndExposesNative() async throws {
        webView = try makeWebView(userScript: "window.__ran = true;", metadata: Self.meta())
        try await load(webView)
        let installed = try await evaluate(webView, "typeof window.__fmshell") as? String
        XCTAssertEqual(installed, "object")
        let native = try await evaluate(webView, "typeof window.native.log") as? String
        XCTAssertEqual(native, "function")
    }

    func testDocumentIdleScriptRunsAfterLoadNotAtStart() async throws {
        let script = "window.__readyStateWhenRun = document.readyState;"
        webView = try makeWebView(userScript: script, metadata: Self.meta())
        try await load(webView)
        try await waitUntil {
            try await self.evaluate(self.webView, "window.__readyStateWhenRun") != nil
        }
        let state = try await evaluate(webView, "window.__readyStateWhenRun") as? String
        XCTAssertTrue(state == "interactive" || state == "complete")
    }

    func testThrowingUserScriptIsReportedNotSilent() async throws {
        webView = try makeWebView(userScript: "throw new Error('boom');", metadata: Self.meta())
        try await load(webView)
        try await waitUntil { self.received.contains { $0["action"] as? String == "error" } }
        let error = received.first { $0["action"] as? String == "error" }
        let payload = error?["payload"] as? [String: Any]
        XCTAssertTrue((payload?["message"] as? String ?? "").contains("boom"))
        XCTAssertFalse((payload?["stack"] as? String ?? "").isEmpty)
    }

    func testNativeLogDeliversMessageToNative() async throws {
        webView = try makeWebView(userScript: "window.native.log('x', 'y');", metadata: Self.meta())
        try await load(webView)
        try await waitUntil { self.received.contains { $0["action"] as? String == "log" } }
        let entry = received.first { $0["action"] as? String == "log" }
        let payload = entry?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["message"] as? String, "x y")
    }

    func testRouteHookFiresOnPushState() async throws {
        let script = "window.native.onRoute(function () { window.__fixtureRouted += 1; });"
        webView = try makeWebView(userScript: script, metadata: Self.meta())
        try await load(webView)
        try await waitUntil {
            try await self.evaluate(self.webView, "typeof window.__fixtureRouted") as? String == "number"
        }
        _ = try await evaluate(webView, "history.pushState({}, '', location.pathname + '?changed=1')")
        try await waitUntil {
            (try await self.evaluate(self.webView, "window.__fixtureRouted") as? Int ?? 0) >= 1
        }
    }

    func testMatchMismatchPreventsInjection() throws {
        webView = try makeWebView(
            userScript: "window.__ranAnyway = true;",
            metadata: Self.meta(matches: ["https://example.com/*"])
        )
        XCTAssertEqual(webView.configuration.userContentController.userScripts.count, 1)
    }

    func testDocumentStartScriptRunsWhileDocumentIsLoading() async throws {
        let script = "window.__readyStateWhenRun = document.readyState;"
        webView = try makeWebView(userScript: script, metadata: Self.meta(runAt: .documentStart))
        try await load(webView)
        let state = try await evaluate(webView, "window.__readyStateWhenRun") as? String
        XCTAssertEqual(state, "loading")
    }

    func testDocumentEndScriptNeverRunsBeforeDOMContentLoaded() async throws {
        let script = "window.__readyStateWhenRun = document.readyState;"
        webView = try makeWebView(userScript: script, metadata: Self.meta(runAt: .documentEnd))
        try await load(webView)
        let state = try await evaluate(webView, "window.__readyStateWhenRun") as? String
        XCTAssertTrue(state == "interactive" || state == "complete")
    }
}
