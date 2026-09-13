import XCTest
import WebKit
@testable import FastmailShellKit

@MainActor
final class HarnessTests: XCTestCase {
    private var webView: WKWebView!
    private var received: [[String: Any]] = []
    private var recorder: Recorder?
    private var replies: (([String: Any]) -> Any?)?

    private final class Recorder: NSObject, WKScriptMessageHandlerWithReply {
        var onMessage: (([String: Any]) -> Void)?
        var reply: (([String: Any]) -> Any?)?
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
        ) {
            let body = message.body as? [String: Any] ?? [:]
            onMessage?(body)
            replyHandler(reply?(body), nil)
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
        scheme: String? = nil,
        applicationName: String? = nil
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
        if let applicationName {
            configuration.applicationNameForUserAgent = applicationName
        }
        if let scheme {
            configuration.setURLSchemeHandler(HTMLSchemeHandler(), forURLScheme: scheme)
        }
        let recorder = Recorder()
        recorder.onMessage = { [weak self] body in self?.received.append(body) }
        recorder.reply = { [weak self] body in self?.replies?(body) }
        self.recorder = recorder
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

    func testElectronShimAppearsOnlyWithTheElectronTokenAndKeepsEveryNotificationInABatch() async throws {
        webView = try makeWebView(
            userScript: "", metadata: Self.meta(),
            applicationName: WebContainer.electronUserAgentToken
        )
        try await load(webView)
        let electronType = try await evaluate(webView, "typeof window.electron") as? String
        XCTAssertEqual(electronType, "object")

        _ = try await evaluate(webView, """
        window.electron.showNotification({title: 'A', body: 'a'}, {id: '1'});
        window.electron.showNotification({title: 'B', body: 'b'}, {id: '2'});
        true;
        """)
        try await waitUntil {
            self.received.filter { $0["action"] as? String == "notify" }.count >= 2
        }
        let notifyCount = received.filter { $0["action"] as? String == "notify" }.count
        XCTAssertEqual(notifyCount, 2)

        let withoutToken = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(withoutToken)
        let withoutElectronType = try await evaluate(withoutToken, "typeof window.electron") as? String
        XCTAssertEqual(withoutElectronType, "undefined")
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

    // The window's light-or-dark trim follows Fastmail's own answer, not a
    // guess at the header's luminance: the Work account's sky blue measures
    // darker than the old threshold allowed, and the navy log-in screen took
    // the whole app dark with it.
    func testThemeReportCarriesFastmailsOwnDarkFlag() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await waitUntil { self.received.contains { $0["action"] as? String == "theme" } }
        let payload = received.last { $0["action"] as? String == "theme" }?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["color"] as? String, "rgb(124, 179, 66)")
        XCTAssertEqual(payload?["isDark"] as? Bool, false)
    }

    // A page with no theme to ask reports no answer, rather than one inferred
    // from whatever colour it happens to be painted.
    func testAPageWithNoThemeToAskReportsNoDarkFlag() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await waitUntil { self.received.contains { $0["action"] as? String == "theme" } }
        _ = try await evaluate(
            webView,
            "delete window.FastMail; document.head.appendChild(document.createElement('meta')); true"
        )
        try await waitUntil {
            self.received.filter { $0["action"] as? String == "theme" }.count >= 2
        }
        let payload = received.last { $0["action"] as? String == "theme" }?["payload"] as? [String: Any]
        XCTAssertEqual(payload?["color"] as? String, "rgb(124, 179, 66)")
        XCTAssertNil(payload?["isDark"])
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

    private func buildSettingsList() -> String {
        """
        (function () {
          var ul = document.createElement('ul');
          ul.className = 'v-Sources-list';
          function item(label, href) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.className = 'app-source';
            a.setAttribute('href', href);
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'u-standardicon v-Icon');
            a.appendChild(svg);
            var span = document.createElement('span');
            span.className = 'u-truncate';
            span.textContent = label;
            a.appendChild(span);
            li.appendChild(a);
            return li;
          }
          ul.appendChild(item('Notifications', '/settings/notifications'));
          ul.appendChild(item('Custom swipes', '/settings/actions'));
          ul.appendChild(item('Offline', '/settings/offline'));
          document.body.appendChild(ul);
        })();
        true;
        """
    }

    private func settingsLabels(_ webView: WKWebView) async throws -> String {
        try await evaluate(webView, """
        [].map.call(
          document.querySelectorAll('.v-Sources-list a'),
          function (a) { return (a.querySelector('span') || a).textContent.trim(); }
        ).join(',')
        """) as? String ?? ""
    }

    func testSettingsListGetsDeviceSettingsBetweenCustomSwipesAndOffline() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, buildSettingsList())
        try await waitUntil {
            (try await self.evaluate(
                self.webView, "document.querySelectorAll('.fmshell-device-settings').length"
            ) as? Int ?? 0) >= 1
        }
        let labels = try await settingsLabels(webView)
        XCTAssertEqual(labels, "Notifications,Custom swipes,Device settings,Offline")
        // Added once, even as the DOM keeps changing.
        _ = try await evaluate(webView, "document.body.appendChild(document.createElement('div')); true")
        try await Task.sleep(nanoseconds: 250_000_000)
        let count = try await evaluate(
            webView, "document.querySelectorAll('.fmshell-device-settings').length"
        ) as? Int
        XCTAssertEqual(count, 1)
    }

    // On the Mac the shell's settings open from the app menu and Cmd-comma, so
    // the Settings screen carries no Device settings row.
    func testDeviceSettingsRowIsAbsentInTheMacBuild() async throws {
        webView = try makeWebView(
            userScript: "",
            metadata: Self.meta(),
            applicationName: WebContainer.electronUserAgentToken
        )
        try await load(webView)
        _ = try await evaluate(webView, buildSettingsList())
        // Give the observer the window it would use to add the row, then
        // confirm it stayed out and the stock list is untouched.
        try await Task.sleep(nanoseconds: 300_000_000)
        let count = try await evaluate(
            webView, "document.querySelectorAll('.fmshell-device-settings').length"
        ) as? Int
        XCTAssertEqual(count, 0)
        let labels = try await settingsLabels(webView)
        XCTAssertEqual(labels, "Notifications,Custom swipes,Offline")
    }

    // Fastmail sizes the list in pixels (row count times a row height) for its
    // collapse animation; the added row must grow that inline height so the
    // next section's header does not lap the last row.
    private func buildSizedSettingsList() -> String {
        """
        (function () {
          var ul = document.createElement('ul');
          ul.className = 'v-Sources-list';
          function item(label, href) {
            var li = document.createElement('li');
            li.style.height = '40px';
            li.style.margin = '0';
            var a = document.createElement('a');
            a.className = 'app-source';
            a.setAttribute('href', href);
            var span = document.createElement('span');
            span.className = 'u-truncate';
            span.textContent = label;
            a.appendChild(span);
            li.appendChild(a);
            return li;
          }
          ul.appendChild(item('Notifications', '/settings/notifications'));
          ul.appendChild(item('Custom swipes', '/settings/actions'));
          ul.appendChild(item('Offline', '/settings/offline'));
          ul.style.position = 'relative';
          ul.style.height = '120px';
          document.body.appendChild(ul);
        })();
        true;
        """
    }

    func testDeviceSettingsRowGrowsTheListsPixelHeight() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, buildSizedSettingsList())
        try await waitUntil {
            (try await self.evaluate(
                self.webView, "document.querySelectorAll('.fmshell-device-settings').length"
            ) as? Int ?? 0) >= 1
        }
        let height = try await evaluate(
            webView, "document.querySelector('.v-Sources-list').style.height"
        ) as? String
        // Four rows at 40px once Device settings joins the original three.
        XCTAssertEqual(height, "160px")
    }

    func testDeviceSettingsOpensShellSettingsWithoutNavigating() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, buildSettingsList())
        try await waitUntil {
            (try await self.evaluate(
                self.webView, "document.querySelectorAll('.fmshell-device-settings').length"
            ) as? Int ?? 0) >= 1
        }
        _ = try await evaluate(webView, """
        window.__before = location.href;
        document.querySelector('.fmshell-device-settings').dispatchEvent(
          new MouseEvent('click', {bubbles: true, cancelable: true, view: window})
        );
        true;
        """)
        try await waitUntil { self.received.contains { $0["action"] as? String == "openSettings" } }
        let navigated = try await evaluate(webView, "location.href !== window.__before") as? Bool
        XCTAssertEqual(navigated, false)
    }

    // MARK: The C key

    private func pressC(
        alt: Bool = false,
        command: Bool = false,
        shift: Bool = false,
        on target: String = "document.body"
    ) async throws {
        _ = try await evaluate(webView, """
        \(target).dispatchEvent(new KeyboardEvent('keydown', {
            code: 'KeyC', key: '\(alt ? "ç" : "c")',
            altKey: \(alt), metaKey: \(command), shiftKey: \(shift),
            bubbles: true, cancelable: true
        }));
        """)
    }

    private func plantComposeButton() async throws {
        _ = try await evaluate(webView, """
        var button = document.createElement('a');
        button.className = 's-new-message';
        button.href = '#compose';
        button.textContent = 'Compose';
        document.body.appendChild(button);
        window.__compose = button;
        window.__clicks = [];
        button.addEventListener('click', function (event) {
            window.__clicks.push({ alt: event.altKey, meta: event.metaKey });
            event.preventDefault();
        });
        true;
        """)
    }

    private func clickCompose(alt: Bool = false, command: Bool = false) async throws {
        _ = try await evaluate(webView, """
        window.__compose.dispatchEvent(new MouseEvent('click', {
            altKey: \(alt), metaKey: \(command),
            bubbles: true, cancelable: true
        }));
        """)
    }

    private func composeAsks() -> [String] {
        received
            .filter { $0["action"] as? String == "compose" }
            .compactMap { ($0["payload"] as? [String: Any])?["mode"] as? String }
    }

    private func watchKeys() async throws {
        _ = try await evaluate(webView, """
        window.__keys = [];
        document.addEventListener('keydown', function (event) {
            if (event.code !== 'KeyC') return;
            window.__keys.push({ alt: event.altKey, shift: event.shiftKey });
        });
        """)
    }

    // Plain C is the one the setting speaks for, so it asks the app where the
    // message should go rather than deciding, and Fastmail never sees the key.
    func testPlainCAsksTheAppWhereTheMessageGoes() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await watchKeys()
        try await pressC()
        try await waitUntil { self.composeAsks() == ["default"] }
        let seen = try await evaluate(webView, "window.__keys.length") as? Int
        XCTAssertEqual(seen, 0)
    }

    // Command-Option-C names its own place, whatever the setting says.
    func testCommandOptionCAsksForATab() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await pressC(alt: true, command: true)
        try await waitUntil { self.composeAsks() == ["tab"] }
    }

    // Command on its own is Copy, and Shift is Fastmail's own.
    func testCommandCAndShiftCAreLeftAlone() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await watchKeys()
        try await pressC(command: true)
        try await pressC(shift: true)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(composeAsks(), [])
        let seen = try await evaluate(webView, "window.__keys.length") as? Int
        XCTAssertEqual(seen, 2)
    }

    // The Compose button reads the same as the key it stands for.
    func testComposeButtonAsksTheAppTheSameWay() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await plantComposeButton()
        try await clickCompose()
        try await waitUntil { self.composeAsks() == ["default"] }
        try await clickCompose(alt: true, command: true)
        try await waitUntil { self.composeAsks() == ["default", "tab"] }
        let ownClicks = try await evaluate(webView, "window.__clicks.length") as? Int
        XCTAssertEqual(ownClicks, 0)
    }

    // Option-click means Fastmail's own compose, which is Fastmail's to open:
    // the button is clicked again, plainly, and the app is not asked.
    func testOptionClickHandsFastmailThePlainClick() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await plantComposeButton()
        try await clickCompose(alt: true)
        try await waitUntil {
            (try await self.evaluate(self.webView, "window.__clicks.length") as? Int ?? 0) == 1
        }
        let alt = try await evaluate(webView, "window.__clicks[0].alt") as? Bool
        XCTAssertEqual(alt, false)
        XCTAssertEqual(composeAsks(), [])
    }

    // Option-C means Fastmail's own compose, which is Fastmail's to open: the
    // app is not asked, and the page is handed the plain key it understands.
    func testOptionCHandsFastmailThePlainKey() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await watchKeys()
        try await pressC(alt: true)
        try await waitUntil {
            (try await self.evaluate(self.webView, "window.__keys.length") as? Int ?? 0) == 1
        }
        let alt = try await evaluate(webView, "window.__keys[0].alt") as? Bool
        XCTAssertEqual(alt, false)
        XCTAssertEqual(composeAsks(), [])
    }

    // Told the message belongs in the page after all, the page opens it there.
    func testBeingToldInlineHandsFastmailThePlainKey() async throws {
        replies = { body in
            guard body["action"] as? String == "compose" else { return nil }
            return "inline"
        }
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        try await watchKeys()
        try await pressC()
        try await waitUntil {
            (try await self.evaluate(self.webView, "window.__keys.length") as? Int ?? 0) == 1
        }
    }

    // A C typed into a field is a letter, not a command.
    func testCTypedIntoAFieldIsJustALetter() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        var field = document.createElement('input');
        document.body.appendChild(field);
        window.__field = field;
        true;
        """)
        try await pressC(on: "window.__field")
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(composeAsks(), [])
    }

    func testSetSettingReachesTheBridge() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.setSetting('triageLabel', 'Todo'); true;")
        try await waitUntil { self.received.contains { $0["action"] as? String == "setting" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setting" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["key"] as? String, "triageLabel")
        XCTAssertEqual(payload["value"] as? String, "Todo")
    }

    // NativeBridgeTests boxes its numeric cases as Swift literals inside an
    // Any array, which is not the object real traffic hands over: WebKit
    // marshals a JS number into a genuine NSNumber, and only a genuine
    // NSNumber triggers the bridging quirk the CFGetTypeID guard exists to
    // catch. This sends a real 1 through the live bridge, so what the fake
    // recorder captures is what Swift actually receives for it, then feeds
    // that exact body to the same NativeBridge the app runs.
    func testSetSettingWithARealJavaScriptOneIsRefused() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.setSetting('labelColours', 1); true;")
        try await waitUntil { self.received.contains { $0["action"] as? String == "setting" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setting" })
        let bridge = NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
        let reply = await bridge.handle(body: message)
        XCTAssertNotNil(reply.error)
    }

    // Its positive twin, which every toggle the apps write depends on: a real
    // JavaScript true crosses the live bridge as a genuine CFBoolean, passes
    // the same guard, and is stored as a Bool. Stored in a throwaway suite of
    // its own, the way the app's own handler stores into the standard one, so
    // nothing reaches the user's real defaults.
    func testSetSettingWithARealJavaScriptTrueIsStoredAsABool() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.setSetting('labelColours', true); true;")
        try await waitUntil { self.received.contains { $0["action"] as? String == "setting" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setting" })
        let suite = "HarnessTests.\(#function)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }
        let bridge = NativeBridge(
            expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
            onSetting: { key, value in defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key)) }
        )
        let reply = await bridge.handle(body: message)
        XCTAssertNil(reply.error)
        let stored = try XCTUnwrap(defaults.object(forKey: "customMode.labelColours"))
        XCTAssertEqual(CFGetTypeID(stored as CFTypeRef), CFBooleanGetTypeID())
        XCTAssertEqual(stored as? Bool, true)
    }

    // MARK: The Notifications page

    // The page is for the phone and the iPad; the Mac keeps Fastmail's own,
    // so under the Electron token there is nothing for the userscript to find
    func testNotificationsBridgeExistsOnlyWithoutTheElectronToken() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        let kinds = try await evaluate(webView, """
        [typeof window.native.notifications.state,
         typeof window.native.notifications.set,
         typeof window.native.notifications.openSettings].join(',')
        """) as? String
        XCTAssertEqual(kinds, "function,function,function")

        let mac = try makeWebView(
            userScript: "", metadata: Self.meta(),
            applicationName: WebContainer.electronUserAgentToken
        )
        try await load(mac)
        let onMac = try await evaluate(mac, "typeof window.native.notifications") as? String
        XCTAssertEqual(onMac, "undefined")
    }

    func testNotificationStateResolvesToTheAppsAnswerParsed() async throws {
        replies = { body in
            guard body["action"] as? String == "notificationState" else { return nil }
            return #"{"contacts":null,"mailboxIds":[],"mode":"inbox","permission":"allowed","pushToken":"00abff","senders":"everyone"}"#
        }
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__state = null;
        window.native.notifications.state().then(function (state) { window.__state = state; });
        true;
        """)
        try await waitUntil {
            try await self.evaluate(self.webView, "!!window.__state") as? Bool == true
        }
        let summary = try await evaluate(webView, """
        [window.__state.mode, window.__state.pushToken, String(window.__state.contacts === null)].join(',')
        """) as? String
        XCTAssertEqual(summary, "inbox,00abff,true")
    }

    func testSetNotificationsSendsTheChoiceAndResolvesToTheSavedOne() async throws {
        replies = { body in
            guard body["action"] as? String == "setNotifications" else { return nil }
            return #"{"mailboxIds":["P2F"],"mode":"custom","senders":"vips"}"#
        }
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__saved = null;
        window.native.notifications.set({ mode: 'custom', senders: 'vips', mailboxIds: ['P2F'] })
            .then(function (saved) { window.__saved = saved; });
        true;
        """)
        try await waitUntil { self.received.contains { $0["action"] as? String == "setNotifications" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setNotifications" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["mode"] as? String, "custom")
        XCTAssertEqual(payload["senders"] as? String, "vips")
        XCTAssertEqual(payload["mailboxIds"] as? [String], ["P2F"])
        try await waitUntil {
            try await self.evaluate(self.webView, "!!window.__saved") as? Bool == true
        }
        let saved = try await evaluate(webView, "window.__saved.mode + ',' + window.__saved.mailboxIds.join('|')") as? String
        XCTAssertEqual(saved, "custom,P2F")
    }

    // A refusal, or no app at all, reaches the page as a rejection it can
    // report, not as a state made of nothing
    func testNotificationStateRejectsWhenTheAppGivesNoAnswer() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__failed = null;
        window.native.notifications.state().then(
            function () { window.__failed = 'resolved'; },
            function (error) { window.__failed = error.message; }
        );
        true;
        """)
        try await waitUntil {
            try await self.evaluate(self.webView, "window.__failed !== null") as? Bool == true
        }
        let failed = try await evaluate(webView, "window.__failed") as? String
        XCTAssertEqual(failed, "The app did not answer")
    }

    func testOpenNotificationSettingsReachesTheBridge() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.notifications.openSettings(); true;")
        try await waitUntil {
            self.received.contains { $0["action"] as? String == "openNotificationSettings" }
        }
    }
}
