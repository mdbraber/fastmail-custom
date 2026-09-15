import XCTest
import WebKit
@testable import FastmailShellKit

// Fastmail's windows keep a roll call on a BroadcastChannel, and a page that
// believes another window is open holds new mail back for up to twenty
// seconds whenever it is not focused. The compose page kept loaded in the
// pool must not count as one of those windows until it is opened, yet it
// still has to hear the others, or it takes itself for the master window and
// shows new-mail notifications of its own.
@MainActor
final class ComposePoolScriptTests: XCTestCase {
    private struct WaitTimeoutError: Error {}
    private var webView: WKWebView!

    override func tearDown() {
        webView = nil
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

    private func loadPooledPage() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(
            source: ComposeWindows.poolScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.loadHTMLString("<html><body></body></html>", baseURL: URL(string: "https://app.fastmail.com/")!)
        try await waitUntil {
            try await self.webView.evaluateJavaScript(
                "document.readyState === 'complete' && location.host === 'app.fastmail.com'"
            ) as? Bool == true
        }
    }

    /// Runs `body` in the page with `heard`, what the other windows hear on
    /// the account's roll call, and `settle`, which lets messages arrive.
    private func run(_ body: String) async throws -> String? {
        try await webView.callAsyncJavaScript("""
        const heard = [];
        const others = new BroadcastChannel('owm:u1:broadcast');
        others.onmessage = (event) => {
            const { type, wcId, url } = event.data;
            heard.push(type + ':' + wcId + (type === 'wc:hello' ? '@' + url : ''));
        };
        const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
        \(body)
        """, contentWorld: .page) as? String
    }

    func testWhilePooledThePageSaysGoodbyeAfterHelloAndAnswersNoRollCall() async throws {
        try await loadPooledPage()
        let heard = try await run("""
        const page = new BroadcastChannel('owm:u1:broadcast');
        page.postMessage({ wcId: 'w2', type: 'wc:hello', url: 'https://app.fastmail.com/compose' });
        page.postMessage({ wcId: 'w2', type: 'wc:ping', url: 'https://app.fastmail.com/compose' });
        page.postMessage({ wcId: 'w2', type: 'auth', data: {} });
        await settle();
        return heard.join(',');
        """)
        XCTAssertEqual(heard, "wc:hello:w2@https://app.fastmail.com/compose,wc:bye:w2,auth:w2")
    }

    func testOpenedFromThePoolThePageAnnouncesItselfAndAnswersAgain() async throws {
        try await loadPooledPage()
        let heard = try await run("""
        const page = new BroadcastChannel('owm:u1:broadcast');
        page.postMessage({ wcId: 'w2', type: 'wc:hello', url: 'https://app.fastmail.com/compose' });
        await settle();
        window.fmshellLeavePool();
        page.postMessage({ wcId: 'w2', type: 'wc:ping', url: location.href });
        await settle();
        return heard.join(',');
        """)
        XCTAssertEqual(
            heard,
            "wc:hello:w2@https://app.fastmail.com/compose,wc:bye:w2,wc:hello:w2@https://app.fastmail.com/,wc:ping:w2"
        )
    }

    // Opened before Fastmail has got as far as saying hello: there is nothing
    // to take back, and the hello, when it comes, counts as it is.
    func testAPageOpenedBeforeFastmailSaidHelloIsCountedNormally() async throws {
        try await loadPooledPage()
        let heard = try await run("""
        window.fmshellLeavePool();
        const page = new BroadcastChannel('owm:u1:broadcast');
        page.postMessage({ wcId: 'w2', type: 'wc:hello', url: location.href });
        page.postMessage({ wcId: 'w2', type: 'wc:ping', url: location.href });
        await settle();
        return heard.join(',');
        """)
        XCTAssertEqual(heard, "wc:hello:w2@https://app.fastmail.com/,wc:ping:w2")
    }

    // Fastmail first joins a roll call for no account in particular, and
    // leaves it for the account's own once it knows who is signed in.
    func testOpeningPassesOverARollCallThePageHasLeft() async throws {
        try await loadPooledPage()
        let heard = try await run("""
        const early = new BroadcastChannel('owm:broadcast');
        early.postMessage({ wcId: 'w2', type: 'wc:hello', url: location.href });
        early.postMessage({ wcId: 'w2', type: 'wc:bye' });
        early.close();
        const page = new BroadcastChannel('owm:u1:broadcast');
        page.postMessage({ wcId: 'w2', type: 'wc:hello', url: location.href });
        await settle();
        window.fmshellLeavePool();
        await settle();
        return heard.join(',');
        """)
        XCTAssertEqual(
            heard,
            "wc:hello:w2@https://app.fastmail.com/,wc:bye:w2,wc:hello:w2@https://app.fastmail.com/"
        )
    }
}
