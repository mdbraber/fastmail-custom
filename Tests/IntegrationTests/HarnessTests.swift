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

    private func notifications() -> [[String: Any]] {
        received.filter { $0["action"] as? String == "notify" }.compactMap { $0["payload"] as? [String: Any] }
    }

    // On a page with an origin of its own: WebKit delivers no BroadcastChannel
    // message on a file: page, whose origin is opaque, and Fastmail's page is
    // never one
    private func electronWebView() async throws -> WKWebView {
        let url = URL(string: "fmtest://app.test/")!
        let view = try makeWebView(
            userScript: "", metadata: Self.meta(), configURL: url, scheme: "fmtest",
            applicationName: WebContainer.electronUserAgentToken
        )
        try await loadCustomScheme(view, url: url)
        return view
    }

    // What Fastmail's offline worker broadcasts for a message that should
    // notify, as read from its proxyWorker.js
    private func broadcastEmailPush(_ webView: WKWebView, id: String, name: String, address: String,
                                    subject: String, trusted: Bool = false) async throws {
        _ = try await evaluate(webView, """
        window.__proxyworker = window.__proxyworker || new BroadcastChannel('proxyworker');
        window.__proxyworker.postMessage({type: 'emailPush', data: {
            '@type': 'EmailPush', accountId: 'A1', userId: 'u1',
            email: {id: '\(id)', threadId: 'T-\(id)', subject: '\(subject)',
                from: [{name: '\(name)', email: '\(address)'}],
                keywords: \(trusted ? "{$istrusted: true}" : "{}"), mailboxIds: {}}
        }});
        true;
        """)
    }

    // Fastmail hands over its push as the notification's data: the ids sit
    // under email, not at the top
    func testFastmailsNotificationTakesItsIdsFromTheEmail() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, """
        window.electron.showNotification({title: 'Ada', body: 'Re: engine'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'M1', threadId: 'T1'}});
        true;
        """)
        try await waitUntil { !self.notifications().isEmpty }
        let shown = try XCTUnwrap(notifications().first)
        XCTAssertEqual(shown["id"] as? String, "M1")
        XCTAssertEqual(shown["threadId"] as? String, "T1")
    }

    // The start of the message's text is asked of Fastmail for the message the
    // push names, and becomes the body, with the subject moving up; without
    // an answer the notification goes as Fastmail wrote it
    func testANotificationShowsTheStartOfItsMessage() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, """
        window.__asked = [];
        window.FastMail = { callJMAPMethod: function (name, args) {
            window.__asked.push({name: name, args: args});
            if (args.ids[0] === 'M9') return new Promise(function () {});
            return Promise.resolve({list: [{id: args.ids[0], preview: '  Dear Charles,\\n the  engine works. '}]});
        } };
        window.electron.showNotification({title: 'Ada', body: 'Engines'},
            {'@type': 'EmailPush', userId: 'u1', accountId: 'A1', email: {id: 'M8', threadId: 'T8', subject: 'Engines'}});
        window.electron.showNotification({title: 'Bob', body: 'Lunch'},
            {'@type': 'EmailPush', userId: 'u1', accountId: 'A1', email: {id: 'M9', threadId: 'T9', subject: 'Lunch'}});
        true;
        """)
        try await waitUntil(timeout: 10) { self.notifications().count >= 2 }
        let shown = notifications()
        let previewed = try XCTUnwrap(shown.first { $0["id"] as? String == "M8" })
        XCTAssertEqual(previewed["title"] as? String, "Ada")
        XCTAssertEqual(previewed["body"] as? String, "Engines")
        XCTAssertEqual(previewed["subject"] as? String, "Engines")
        XCTAssertEqual(previewed["preview"] as? String, "Dear Charles, the engine works.")
        // Fastmail never answered for this one, so it went without, in time
        let unanswered = try XCTUnwrap(shown.first { $0["id"] as? String == "M9" })
        XCTAssertNil(unanswered["preview"])
        XCTAssertEqual(unanswered["body"] as? String, "Lunch")

        let asked = try await evaluate(webView, "JSON.stringify(window.__asked[0])") as? String
        XCTAssertEqual(asked, #"{"name":"Email/get","args":{"accountId":"A1","ids":["M8"],"properties":["preview"]}}"#)
    }

    // Custom's excluded labels leave out a message Fastmail chose to show,
    // and only while Custom is the choice
    func testAMessageInAnExcludedLabelIsLeftOutInCustom() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, """
        window.native.notificationExclusions.get = function () { return Promise.resolve(['L-later']); };
        localStorage.setItem('preferences:u1.notificationsMail', JSON.stringify('custom'));
        window.electron.showNotification({title: 'Ada', body: 'Later'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'X1', threadId: 'T1', mailboxIds: {'L-inbox': true, 'L-later': true}}});
        window.electron.showNotification({title: 'Bob', body: 'Now'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'X2', threadId: 'T2', mailboxIds: {'L-inbox': true}}});
        true;
        """)
        try await waitUntil(timeout: 10) { !self.notifications().isEmpty }
        // Time for the excluded one to have arrived, were it coming
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertEqual(notifications().compactMap { $0["id"] as? String }, ["X2"])

        _ = try await evaluate(webView, """
        localStorage.setItem('preferences:u1.notificationsMail', JSON.stringify('inbox'));
        window.electron.showNotification({title: 'Cy', body: 'Later'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'X3', threadId: 'T3', mailboxIds: {'L-inbox': true, 'L-later': true}}});
        true;
        """)
        try await waitUntil(timeout: 10) { self.notifications().count >= 2 }
        XCTAssertEqual(notifications().compactMap { $0["id"] as? String }, ["X2", "X3"])
    }

    // Fastmail's service worker drops a notification when the sender's
    // contact has a photo, so the new-mail broadcast it would have answered
    // is answered here after a short wait
    func testAnEmailPushFastmailNeverShowsIsShownByTheFallback() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, "localStorage.setItem('preferences:u1.notificationsMailSound', JSON.stringify('default')); true;")
        try await broadcastEmailPush(webView, id: "M2", name: "  Bob   Smith ", address: "bob@example.com", subject: "Lunch")
        try await waitUntil(timeout: 15) { !self.notifications().isEmpty }
        let shown = try XCTUnwrap(notifications().first)
        XCTAssertEqual(shown["id"] as? String, "M2")
        XCTAssertEqual(shown["title"] as? String, "Bob Smith")
        XCTAssertEqual(shown["body"] as? String, "Lunch")
        XCTAssertEqual(shown["threadId"] as? String, "T-M2")
        XCTAssertEqual(shown["sound"] as? Bool, true)
        // No Fastmail page to look a photo up in
        XCTAssertEqual(shown["icon"] as? String, "")
        let data = try XCTUnwrap((shown["data"] as? String)?.data(using: .utf8))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual((json["email"] as? [String: Any])?["id"] as? String, "M2")
    }

    func testFastmailsOwnNotificationKeepsTheFallbackFromRepeatingIt() async throws {
        webView = try await electronWebView()
        try await broadcastEmailPush(webView, id: "M3", name: "Cy", address: "cy@example.com", subject: "Hi")
        _ = try await evaluate(webView, """
        window.electron.showNotification({title: 'Cy', body: 'Hi'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'M3', threadId: 'T-M3'}});
        true;
        """)
        // Past the fallback's wait, with room to spare
        try await Task.sleep(nanoseconds: 3_000_000_000)
        XCTAssertEqual(notifications().filter { $0["id"] as? String == "M3" }.count, 1)

        // And the other way round: shown by the fallback first, Fastmail's late one is not sent again
        try await broadcastEmailPush(webView, id: "M4", name: "Di", address: "di@example.com", subject: "Yo")
        // A hidden page's timers run slow, the fallback's wait among them
        try await waitUntil(timeout: 15) { self.notifications().contains { $0["id"] as? String == "M4" } }
        _ = try await evaluate(webView, """
        window.electron.showNotification({title: 'Di', body: 'Yo'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'M4', threadId: 'T-M4'}});
        true;
        """)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(notifications().filter { $0["id"] as? String == "M4" }.count, 1)
    }

    func testTheFallbackShowsTheAddressForANameDressedUpAsOne() async throws {
        webView = try await electronWebView()
        try await broadcastEmailPush(webView, id: "M5", name: "support@fastmail.com", address: "evil@example.com", subject: "Verify")
        try await broadcastEmailPush(webView, id: "M6", name: "Fastmail Support", address: "evil@example.com", subject: "Verify")
        try await broadcastEmailPush(webView, id: "M7", name: "Fastmail Support", address: "help@fastmail.com", subject: "Real", trusted: true)
        try await waitUntil(timeout: 15) { self.notifications().count >= 3 }
        let titles = Dictionary(uniqueKeysWithValues: notifications().compactMap { shown in
            (shown["id"] as? String).map { ($0, shown["title"] as? String ?? "") }
        })
        XCTAssertEqual(titles["M5"], "evil@example.com")
        XCTAssertEqual(titles["M6"], "evil@example.com")
        XCTAssertEqual(titles["M7"], "Fastmail Support")
    }

    private static let pngDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

    // Fastmail's service worker hands the sender's picture over already read
    // into a data: URL; nothing else is passed on as one
    func testFastmailsPictureIsPassedOnOnlyAsImageData() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, """
        window.electron.showNotification({title: 'Ada', body: 'Hi', icon: '\(Self.pngDataURL)'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'P1', threadId: 'T1'}});
        window.electron.showNotification({title: 'Bob', body: 'Hi', icon: '/static/favicons/FM-Notification-Icon-196.png'},
            {'@type': 'EmailPush', userId: 'u1', email: {id: 'P2', threadId: 'T2'}});
        true;
        """)
        try await waitUntil { self.notifications().count >= 2 }
        let icons = Dictionary(uniqueKeysWithValues: notifications().compactMap { shown in
            (shown["id"] as? String).map { ($0, shown["icon"] as? String ?? "missing") }
        })
        XCTAssertEqual(icons["P1"], Self.pngDataURL)
        XCTAssertEqual(icons["P2"], "")
    }

    // Fastmail's service worker drops the notification for exactly the
    // senders whose contact has a photo, so the fallback looks the photo up:
    // default address book first, the address itself on the card, the photo's
    // type from mediaType, at the size the service worker asks for
    func testTheFallbackCarriesTheSendersContactPhoto() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, """
        window.__calls = [];
        window.FastMail = {
            auth: {
                get: function (key) {
                    return {
                        accounts: {
                            A2: {accountCapabilities: {'urn:ietf:params:jmap:contacts': {}}},
                            A3: {accountCapabilities: {}},
                            A1: {accountCapabilities: {'urn:ietf:params:jmap:contacts': {}}}
                        },
                        primaryAccounts: {'urn:ietf:params:jmap:contacts': 'A1'},
                        downloadUrl: 'https://download.test/{accountId}/{blobId}/{name}?type={type}'
                    }[key];
                },
                signUrl: function (url) { window.__signed = url; return '\(Self.pngDataURL)'; }
            },
            callJMAPMethod: function (name, args) {
                window.__calls.push(name + ' ' + args.accountId);
                if (name === 'ContactCard/query') {
                    return Promise.resolve({ids: args.accountId === 'A2' ? ['C1', 'C2'] : []});
                }
                return Promise.resolve({list: [
                    {id: 'C1', kind: 'individual', emails: {e: {address: 'bob+later@example.com'}},
                        media: {p: {kind: 'photo', blobId: 'WRONG', mediaType: 'image/jpeg'}}},
                    {id: 'C2', kind: 'individual', emails: {e: {address: ' Bob@Example.com '}},
                        media: {p: {kind: 'photo', blobId: 'B1', mediaType: 'image/jpeg'}}}
                ]});
            }
        };
        true;
        """)
        try await broadcastEmailPush(webView, id: "P3", name: "Bob", address: "bob@example.com", subject: "Photo")
        try await waitUntil(timeout: 15) { self.notifications().contains { $0["id"] as? String == "P3" } }
        let shown = try XCTUnwrap(notifications().first { $0["id"] as? String == "P3" })
        XCTAssertEqual(shown["icon"] as? String, Self.pngDataURL)
        let signed = try await evaluate(webView, "window.__signed") as? String
        XCTAssertEqual(signed, "https://download.test/A2/B1/image.jpeg?type=image%2Fjpeg&max-width=212&max-height=212")
        let calls = try await evaluate(webView, "window.__calls.join(', ')") as? String
        // Then the message's preview, asked once the notification is on its way
        XCTAssertEqual(calls, "ContactCard/query A1, ContactCard/query A2, ContactCard/get A2, Email/get A1")
    }

    // A click goes to Fastmail's own goMessage action with the push's ids.
    // FastMail.userId is empty when the page was loaded without ?u=, which
    // must not turn the click away; a known other user or an account the
    // session lacks must.
    func testAMailClickIsHandedToFastmailsGoMessageAction() async throws {
        webView = try await electronWebView()
        _ = try await evaluate(webView, """
        window.__actions = [];
        window.FastMail = {
            userId: '',
            store: {},
            auth: {get: function (key) {
                return {isAuthenticated: true, accounts: {A1: {}}}[key];
            }},
            doAction: function (name, args) { window.__actions.push([name, args]); }
        };
        window.__push = function (changes) {
            var push = {'@type': 'EmailPush', userId: 'u1', accountId: 'A1',
                email: {id: 'M1', threadId: 'T1', mailboxIds: {I: true}}};
            Object.assign(push, changes);
            return window.native.openMessage(JSON.stringify(push));
        };
        true;
        """)
        let taken = try await evaluate(webView, "window.__push({})") as? Bool
        XCTAssertEqual(taken, true)
        let action = try await evaluate(webView, "JSON.stringify(window.__actions)") as? String
        XCTAssertEqual(action, #"[["goMessage",{"accountId":"A1","emailId":"M1","threadId":"T1","mailboxIds":{"I":true}}]]"#)

        let refused = try await evaluate(webView, """
        [
            window.__push({accountId: 'A9'}),
            window.__push({email: {id: 'M1', threadId: 'T1'}}),
            window.__push({'@type': 'CalendarAlert'}),
            (FastMail.userId = 'u2', window.__push({})),
            window.native.openMessage('{')
        ]
        """) as? [Bool]
        XCTAssertEqual(refused, [false, false, false, false, false])
        let count = try await evaluate(webView, "window.__actions.length") as? Int
        XCTAssertEqual(count, 1)
    }

    // Fastmail's Mail preferences page asks whether it is the default email
    // app before it draws, and its switch asks to become it. The shells leave
    // that to macOS, so the answer is always no and the switch does nothing;
    // neither may throw, or the page never draws. The answer is a promise,
    // since a bare false reaches the page's switch as on.
    func testElectronShimAnswersTheDefaultEmailAppQuestionsWithoutThrowing() async throws {
        webView = try makeWebView(
            userScript: "", metadata: Self.meta(),
            applicationName: WebContainer.electronUserAgentToken
        )
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__isDefault = 'pending';
        var answer = window.electron.getIsDefaultApp();
        window.__isPromise = !!answer && typeof answer.then === 'function';
        Promise.resolve(answer).then(function (value) { window.__isDefault = value; });
        window.electron.setIsDefaultApp(true);
        true;
        """)
        try await waitUntil {
            try await self.evaluate(self.webView, "window.__isDefault !== 'pending'") as? Bool == true
        }
        let summary = try await evaluate(webView, """
        [String(window.__isPromise), String(window.__isDefault === false)].join(',')
        """) as? String
        XCTAssertEqual(summary, "true,true")
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

    private func buildSettingsList(withFastmailCustom: Bool = false) -> String {
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
          \(withFastmailCustom ? "ul.appendChild(item('Custom options', '/settings/custom-options'));" : "")
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

    func testDeviceSettingsFollowsFastmailCustom() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, buildSettingsList(withFastmailCustom: true))
        try await waitUntil {
            (try await self.evaluate(
                self.webView, "document.querySelectorAll('.fmshell-device-settings').length"
            ) as? Int ?? 0) >= 1
        }
        let labels = try await settingsLabels(webView)
        XCTAssertEqual(labels, "Notifications,Custom swipes,Custom options,Device settings,Offline")
    }

    // The Custom options entry is drawn only once its page installs, and can land
    // below a Device settings row that went in first.
    func testDeviceSettingsMovesUnderFastmailCustomWhenItArrivesLater() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, buildSettingsList())
        try await waitUntil {
            (try await self.evaluate(
                self.webView, "document.querySelectorAll('.fmshell-device-settings').length"
            ) as? Int ?? 0) >= 1
        }
        _ = try await evaluate(webView, """
        (function () {
          var ul = document.querySelector('.v-Sources-list');
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.className = 'app-source';
          a.setAttribute('href', '/settings/custom-options');
          var span = document.createElement('span');
          span.className = 'u-truncate';
          span.textContent = 'Custom options';
          a.appendChild(span);
          li.appendChild(a);
          ul.insertBefore(li, ul.lastElementChild);
        })();
        true;
        """)
        try await waitUntil {
            try await self.settingsLabels(self.webView)
                == "Notifications,Custom swipes,Custom options,Device settings,Offline"
        }
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
            onSetting: { key, value in defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key)) }
        )
        let reply = await bridge.handle(body: message)
        XCTAssertNil(reply.error)
        let stored = try XCTUnwrap(defaults.object(forKey: "fastmailCustom.labelColours"))
        XCTAssertEqual(CFGetTypeID(stored as CFTypeRef), CFBooleanGetTypeID())
        XCTAssertEqual(stored as? Bool, true)
    }

    // MARK: Settings sync

    func testAccountReachesTheBridge() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.account('u1234abcd'); true;")
        try await waitUntil { self.received.contains { $0["action"] as? String == "account" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "account" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["accountId"] as? String, "u1234abcd")
    }

    // What really crosses for a JavaScript false and a JavaScript 1, fed to
    // the bridge the app runs: the switch takes the boolean and refuses the
    // number, for the reason testSetSettingWithARealJavaScriptOneIsRefused
    // gives.
    func testSetSettingsSyncCrossesAsARealBooleanOnly() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        let sent = { self.received.filter { $0["action"] as? String == "settingsSync" } }
        _ = try await evaluate(webView, "window.native.setSettingsSync(false); true;")
        try await waitUntil { sent().count == 1 }
        _ = try await evaluate(webView, "window.native.setSettingsSync(1); true;")
        try await waitUntil { sent().count == 2 }

        var handed: [Bool] = []
        let bridge = NativeBridge(
            expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
            onSettingsSync: { handed.append($0) }
        )
        let boolean = await bridge.handle(body: sent()[0])
        let number = await bridge.handle(body: sent()[1])
        XCTAssertNil(boolean.error)
        XCTAssertNotNil(number.error)
        XCTAssertEqual(handed, [false])
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
            return #"{"excludedMailboxIds":["P9L"],"mailboxIds":["P2F"],"mode":"custom","senders":"vips"}"#
        }
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__saved = null;
        window.native.notifications.set({ mode: 'custom', senders: 'vips', mailboxIds: ['P2F'], excludedMailboxIds: ['P9L'] })
            .then(function (saved) { window.__saved = saved; });
        true;
        """)
        try await waitUntil { self.received.contains { $0["action"] as? String == "setNotifications" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setNotifications" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["mode"] as? String, "custom")
        XCTAssertEqual(payload["senders"] as? String, "vips")
        XCTAssertEqual(payload["mailboxIds"] as? [String], ["P2F"])
        XCTAssertEqual(payload["excludedMailboxIds"] as? [String], ["P9L"])
        try await waitUntil {
            try await self.evaluate(self.webView, "!!window.__saved") as? Bool == true
        }
        let saved = try await evaluate(webView, """
        [window.__saved.mode, window.__saved.mailboxIds.join('|'), window.__saved.excludedMailboxIds.join('|')].join(',')
        """) as? String
        XCTAssertEqual(saved, "custom,P2F,P9L")
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
