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

    private final class HTMLSchemeHandler: NSObject, WKURLSchemeHandler {
        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            guard let url = urlSchemeTask.request.url else { return }
            let data = Data("<html><body></body></html>".utf8)
            let response = URLResponse(
                url: url, mimeType: "text/html", expectedContentLength: data.count, textEncodingName: "utf-8"
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        }
        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
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

    private func makeWebView(
        userScript: String,
        metadata: UserScriptMetadata,
        configURL: URL? = nil,
        chromeCSS: String? = nil,
        scheme: String? = nil
    ) throws -> WKWebView {
        let harnessURL = Bundle(for: HarnessTests.self).url(forResource: "harness", withExtension: "js")!
        let harness = try String(contentsOf: harnessURL, encoding: .utf8)
        let bundle = ScriptBundle(
            harness: harness,
            userScript: userScript,
            overlay: nil,
            chromeCSS: nil,
            metadata: metadata
        )
        let configuration = WKWebViewConfiguration()
        if let scheme {
            configuration.setURLSchemeHandler(HTMLSchemeHandler(), forURLScheme: scheme)
        }
        let recorder = Recorder()
        recorder.onMessage = { [weak self] body in self?.received.append(body) }
        configuration.userContentController.addScriptMessageHandler(
            recorder,
            contentWorld: .page,
            name: "native"
        )
        let injected = try ScriptInjector.userScripts(
            from: bundle, url: configURL ?? Self.fixtureURL, chromeCSS: chromeCSS
        )
        for script in injected.scripts {
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

    private func loadCustomScheme(_ webView: WKWebView, url: URL) async throws {
        webView.load(URLRequest(url: url))
        try await waitUntil {
            try await self.evaluate(
                webView,
                "document.readyState === 'complete' && document.URL === '\(url.absoluteString)'"
            ) as? Bool == true
        }
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

    func testDocumentIdleScriptRunsAtDocumentEndTiming() async throws {
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

    func testPerDocumentMatchGateBlocksExecutionWhenLocationDiverges() async throws {
        webView = try makeWebView(
            userScript: "window.__ranAnyway = true;",
            metadata: Self.meta(matches: ["https://app.fastmail.com/*"]),
            configURL: URL(string: "https://app.fastmail.com/")!
        )
        XCTAssertEqual(webView.configuration.userContentController.userScripts.count, 2)
        try await load(webView)
        let ranAnyway = try await evaluate(webView, "window.__ranAnyway")
        XCTAssertNil(ranAnyway)
    }

    func testHarnessInstallsWhenDocumentHostMatchesTheConfiguredProductionHost() async throws {
        let url = URL(string: "fmshelltest://app.fastmail.com/mail/Inbox")!
        webView = try makeWebView(
            userScript: "window.__ran = true;",
            metadata: Self.meta(),
            configURL: url,
            scheme: "fmshelltest"
        )
        try await loadCustomScheme(webView, url: url)
        let installed = try await evaluate(webView, "typeof window.__fmshell") as? String
        XCTAssertEqual(installed, "object")
    }

    func testHarnessInstallsWhenDocumentHostHasATrailingDotAndConfiguredHostDoesNot() async throws {
        let configURL = URL(string: "fmshelltest://app.fastmail.com/mail/Inbox")!
        let loadedURL = URL(string: "fmshelltest://app.fastmail.com./mail/Inbox")!
        webView = try makeWebView(
            userScript: "window.__ran = true;",
            metadata: Self.meta(),
            configURL: configURL,
            scheme: "fmshelltest"
        )
        try await loadCustomScheme(webView, url: loadedURL)
        let installed = try await evaluate(webView, "typeof window.__fmshell") as? String
        XCTAssertEqual(installed, "object")
    }

    func testHarnessDoesNotInstallWhenConfiguredHostDoesNotMatchTheLoadedDocument() async throws {
        webView = try makeWebView(
            userScript: "window.__ran = true;",
            metadata: Self.meta(),
            configURL: URL(string: "https://app.fastmail.com/")!
        )
        try await load(webView)
        let installed = try await evaluate(webView, "typeof window.__fmshell") as? String
        XCTAssertEqual(installed, "undefined")
    }

    func testPerDocumentMismatchIsLoggedThroughTheNativeBridge() async throws {
        webView = try makeWebView(
            userScript: "window.__ranAnyway = true;",
            metadata: Self.meta(matches: ["file:///fmshell-test-does-not-exist/*"]),
            configURL: URL(string: "file:///fmshell-test-does-not-exist/fixture.html")!
        )
        XCTAssertEqual(webView.configuration.userContentController.userScripts.count, 2)
        try await load(webView)
        try await waitUntil { self.received.contains { $0["action"] as? String == "log" } }
        let entry = received.first { $0["action"] as? String == "log" }
        let payload = entry?["payload"] as? [String: Any]
        XCTAssertTrue((payload?["message"] as? String ?? "").contains("userscript"))
        XCTAssertTrue((payload?["message"] as? String ?? "").contains("@match does not cover"))
        let ranAnyway = try await evaluate(webView, "window.__ranAnyway")
        XCTAssertNil(ranAnyway)
    }

    func testGuardedWrapperDoesNotLeakPatternsGlobal() async throws {
        webView = try makeWebView(userScript: "window.__ran = true;", metadata: Self.meta())
        try await load(webView)
        try await waitUntil {
            try await self.evaluate(self.webView, "window.__ran") != nil
        }
        let leaked = try await evaluate(webView, "typeof window.__fmshellPatterns") as? String
        XCTAssertEqual(leaked, "undefined")
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

    func testChromeInsetAppliesInWindowedState() async throws {
        let chromeCSS = try XCTUnwrap(BundleResourceLoader().string(named: "chrome-macos.css"))
        webView = try makeWebView(userScript: "", metadata: Self.meta(), chromeCSS: chromeCSS)
        try await load(webView)
        let paddingLeft = try await evaluate(
            webView, "getComputedStyle(document.querySelector('.v-PageHeader')).paddingLeft"
        ) as? String
        XCTAssertEqual(paddingLeft, "78px")
    }

    func testThemeColorComesFromThePaintedAncestorNotTheTransparentHeader() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        let header = try await evaluate(
            webView,
            "getComputedStyle(document.querySelector('.v-PageHeader')).backgroundColor"
        ) as? String
        XCTAssertEqual(header, "rgba(0, 0, 0, 0)")
        let reported = try await evaluate(
            webView,
            "(function(){var n=document.querySelector('.v-PageHeader');while(n){var c=getComputedStyle(n).backgroundColor;if(c&&c!=='transparent'&&c.replace(/\\s/g,'').indexOf('rgba(0,0,0,0)')!==0)return c;n=n.parentElement;}return null;})()"
        ) as? String
        XCTAssertEqual(reported, "rgb(124, 179, 66)")
    }

    func testChromeInsetDropsToZeroInFullscreen() async throws {
        let chromeCSS = try XCTUnwrap(BundleResourceLoader().string(named: "chrome-macos.css"))
        webView = try makeWebView(userScript: "", metadata: Self.meta(), chromeCSS: chromeCSS)
        try await load(webView)
        _ = try await evaluate(webView, "document.body.classList.add('fmshell-fullscreen')")
        let paddingLeft = try await evaluate(
            webView, "getComputedStyle(document.querySelector('.v-PageHeader')).paddingLeft"
        ) as? String
        XCTAssertEqual(paddingLeft, "0px")
    }

    func testChromeInsetSatisfiesFastmailsWindowControlsOverlayDetection() async throws {
        let chromeCSS = try XCTUnwrap(BundleResourceLoader().string(named: "chrome-macos.css"))
        webView = try makeWebView(userScript: "", metadata: Self.meta(), chromeCSS: chromeCSS)
        try await load(webView)
        let detected = try await evaluate(
            webView,
            "!!parseInt(getComputedStyle(document.body).getPropertyValue('--titlebar-area-inset-left'), 10)"
        ) as? Bool
        XCTAssertEqual(detected, true)
    }

    func testHarnessReportsStandaloneDisplayModeWithoutBreakingOtherQueries() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        let standalone = try await evaluate(
            webView, "window.matchMedia('(display-mode: standalone)').matches"
        ) as? Bool
        XCTAssertEqual(standalone, true)
        let width = try await evaluate(
            webView, "window.matchMedia('(min-width: 0px)').matches"
        ) as? Bool
        XCTAssertEqual(width, true)
        let impossible = try await evaluate(
            webView, "window.matchMedia('(min-width: 999999px)').matches"
        ) as? Bool
        XCTAssertEqual(impossible, false)
    }

    private func currentLink(_ webView: WKWebView, prepare: String = "") async throws {
        _ = try await evaluate(webView, """
        window.__link = null; window.__linkError = null;
        \(prepare)
        window.native.currentLink().then(
            function (r) { window.__link = r; },
            function (e) { window.__linkError = e.message; }
        );
        true;
        """)
        try await waitUntil {
            try await self.evaluate(
                self.webView, "!!(window.__link || window.__linkError)"
            ) as? Bool == true
        }
    }

    func testCurrentLinkResolvesFromTheFixtureTitle() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await currentLink(webView)
        let title = try await evaluate(webView, "window.__link && window.__link.title") as? String
        XCTAssertEqual(title, "Welcome to Labels")
        let markdown = try await evaluate(webView, "window.__link && window.__link.markdown") as? String
        let url = try await evaluate(webView, "window.__link && window.__link.url") as? String
        XCTAssertEqual(markdown, "[Welcome to Labels](\(url ?? ""))")
    }

    func testCurrentLinkCollapsesWhitespaceInTheSubject() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await currentLink(webView, prepare:
            "document.querySelector('.v-Thread-title h1').textContent = '  A \\n  spaced   out\\tsubject ';"
        )
        let title = try await evaluate(webView, "window.__link && window.__link.title") as? String
        XCTAssertEqual(title, "A spaced out subject")
    }

    func testCurrentLinkPrefersTheAssignedResolver() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await currentLink(webView, prepare:
            "window.native.subjectResolver = function () { return 'Overridden'; };"
        )
        let title = try await evaluate(webView, "window.__link && window.__link.title") as? String
        XCTAssertEqual(title, "Overridden")
    }

    func testCurrentLinkEscapesBracketsInMarkdown() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await currentLink(webView, prepare:
            "window.native.subjectResolver = function () { return '[urgent] fix'; };"
        )
        let markdown = try await evaluate(webView, "window.__link && window.__link.markdown") as? String
        XCTAssertEqual(markdown?.hasPrefix("[\\[urgent\\] fix]("), true)
    }

    func testCurrentLinkRejectsWhenNoMessageIsOpen() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await currentLink(webView, prepare:
            "document.querySelector('.v-Thread').remove();"
        )
        let error = try await evaluate(webView, "window.__linkError") as? String
        XCTAssertEqual(error, "No message open")
    }

    func testCurrentLinkFallsBackToTheFocusedRow() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await currentLink(webView, prepare: """
        document.querySelector('.v-Thread').remove();
        var row = document.createElement('div');
        row.className = 'v-MailboxItem is-focused';
        row.innerHTML = '<div class="v-MailboxItem-subject">Row subject</div>';
        document.body.appendChild(row);
        """)
        let title = try await evaluate(webView, "window.__link && window.__link.title") as? String
        XCTAssertEqual(title, "Row subject")
    }
}
