import XCTest
import WebKit
@testable import FastmailShellKit

// The share extension's files reach a message by being handed to Fastmail's
// compose page as File objects, the way a drop hands them over. The page
// here stands in for Fastmail's: a compose node, a view found from it, and a
// controller a level up that records what attachFiles was given.
@MainActor
final class ComposeAttachmentsTests: XCTestCase {
    private var webView: WKWebView!
    private var folder: URL!

    override func setUp() async throws {
        folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("ComposeAttachmentsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        webView = nil
        try? FileManager.default.removeItem(at: folder)
    }

    private static let composePage = """
    <html><body><div class="v-Compose"></div><script>
    window.attached = [];
    var controller = { attachFiles: function (files) { for (var i = 0; i < files.length; i += 1) { window.attached.push(files[i]); } } };
    var parent = { get: function (key) { return key === 'controller' ? controller : null; } };
    var leaf = { get: function (key) { return key === 'parentView' ? parent : null; } };
    window.FastMail = { getViewFromNode: function () { return leaf; } };
    </script></body></html>
    """

    /// Hears from a page that it was marked stale. The page is gone by the
    /// time a test could ask it, so it says so as it happens.
    private final class StaleMarks: NSObject, WKScriptMessageHandler {
        var count = 0

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            count += 1
        }
    }

    /// A compose page that reports being marked stale, and still reads as
    /// marked afterwards.
    private static let reportingComposePage = composePage.replacingOccurrences(
        of: "window.attached = [];",
        with: """
        window.attached = [];
        var stale = false;
        Object.defineProperty(window, '__fmshellStale', {
            get: function () { return stale; },
            set: function (value) { stale = value; window.webkit.messageHandlers.stale.postMessage(true); }
        });
        """
    )

    private func load(_ html: String, hearing marks: StaleMarks? = nil) async throws {
        let configuration = WKWebViewConfiguration()
        if let marks { configuration.userContentController.add(marks, name: "stale") }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.loadHTMLString(html, baseURL: URL(string: "https://app.fastmail.com/")!)
        // The window's first, empty page is "complete" too; only the page
        // loaded here has the base URL's host.
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if try await webView.evaluateJavaScript(
                "document.readyState === 'complete' && location.host === 'app.fastmail.com'"
            ) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("page did not load")
    }

    private func file(named name: String, type: String, bytes: Data) throws -> SharedPayload.Attachment {
        let url = folder.appendingPathComponent(UUID().uuidString)
        try bytes.write(to: url)
        return SharedPayload.Attachment(url: url, name: name, type: type)
    }

    /// Name, type, size and the sum of the bytes of everything attached.
    private func attached() async throws -> [[String: Any]] {
        let result = try await webView.callAsyncJavaScript("""
        const out = [];
        for (const f of window.attached) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            let sum = 0;
            for (const b of bytes) { sum += b; }
            out.push({ name: f.name, type: f.type, size: f.size, sum: sum, isFile: f instanceof File });
        }
        return out;
        """, contentWorld: .page)
        return result as? [[String: Any]] ?? []
    }

    private func pattern(_ count: Int) -> Data {
        Data((0..<count).map { UInt8($0 % 251) })
    }

    private func sum(_ data: Data) -> Int {
        data.reduce(0) { $0 + Int($1) }
    }

    func testAFileLargerThanAChunkArrivesWhole() async throws {
        try await load(Self.composePage)
        let bytes = pattern(ComposeAttachments.chunkSize + 10)
        let failed = await ComposeAttachments.attach(
            [try file(named: "report.pdf", type: "application/pdf", bytes: bytes)], to: webView
        )
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files[0]["name"] as? String, "report.pdf")
        XCTAssertEqual(files[0]["type"] as? String, "application/pdf")
        XCTAssertEqual(files[0]["size"] as? Int, bytes.count)
        XCTAssertEqual(files[0]["sum"] as? Int, sum(bytes))
        XCTAssertEqual(files[0]["isFile"] as? Bool, true)
    }

    func testSeveralFilesArriveInOrder() async throws {
        try await load(Self.composePage)
        let failed = await ComposeAttachments.attach([
            try file(named: "IMG_0001.jpg", type: "image/jpeg", bytes: Data([1, 2, 3])),
            try file(named: "IMG_0001.jpg", type: "image/jpeg", bytes: Data([4, 5])),
            try file(named: "notes.txt", type: "text/plain", bytes: Data([6])),
        ], to: webView)
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.map { $0["name"] as? String }, ["IMG_0001.jpg", "IMG_0001.jpg", "notes.txt"])
        XCTAssertEqual(files.map { $0["sum"] as? Int }, [6, 9, 6])
    }

    func testEmptyAndChunkAlignedFilesArriveWhole() async throws {
        try await load(Self.composePage)
        let aligned = pattern(ComposeAttachments.chunkSize * 2)
        let failed = await ComposeAttachments.attach([
            try file(named: "empty.txt", type: "text/plain", bytes: Data()),
            try file(named: "aligned.bin", type: "application/octet-stream", bytes: aligned),
        ], to: webView)
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.map { $0["size"] as? Int }, [0, aligned.count])
        XCTAssertEqual(files[1]["sum"] as? Int, sum(aligned))
    }

    func testAwkwardFileNameArrivesUnchanged() async throws {
        try await load(Self.composePage)
        let name = "Überweisung \"final\" 'v2' \\ `x` ${y} 日本.pdf"
        let failed = await ComposeAttachments.attach(
            [try file(named: name, type: "application/pdf", bytes: Data([7]))], to: webView
        )
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.first?["name"] as? String, name)
    }

    func testAPageWithoutAComposeControllerReportsEveryFile() async throws {
        try await load("<html><body><p>Not compose</p></body></html>")
        let failed = await ComposeAttachments.attach([
            try file(named: "a.txt", type: "text/plain", bytes: Data([1])),
            try file(named: "b.txt", type: "text/plain", bytes: Data([2])),
        ], to: webView, timeout: 0.5)
        XCTAssertEqual(failed, ["a.txt", "b.txt"])
    }

    func testAPageMarkedStaleIsNotAttachedTo() async throws {
        try await load(Self.composePage)
        _ = try await webView.callAsyncJavaScript(ComposeAttachments.staleScript, contentWorld: .page)
        let failed = await ComposeAttachments.attach(
            [try file(named: "a.txt", type: "text/plain", bytes: Data([1]))], to: webView, timeout: 0.5
        )
        XCTAssertEqual(failed, ["a.txt"])
        let files = try await attached()
        XCTAssertEqual(files.count, 0)
    }

    func testAFileThatCannotBeReadIsReportedAndTheRestAttach() async throws {
        try await load(Self.composePage)
        let missing = SharedPayload.Attachment(
            url: folder.appendingPathComponent("gone"), name: "gone.txt", type: "text/plain"
        )
        let failed = await ComposeAttachments.attach(
            [missing, try file(named: "here.txt", type: "text/plain", bytes: Data([1]))], to: webView
        )
        XCTAssertEqual(failed, ["gone.txt"])
        let files = try await attached()
        XCTAssertEqual(files.map { $0["name"] as? String }, ["here.txt"])
    }

    func testNothingIsAttachedOnceTheMessageIsNoLongerWanted() async throws {
        try await load(Self.composePage)
        let failed = await ComposeAttachments.attach(
            [try file(named: "a.txt", type: "text/plain", bytes: Data([1]))],
            to: webView,
            stillWanted: { false }
        )
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.count, 0)
    }

    func testAHandOverStopsWhenThePageIsReplacedMidway() async throws {
        try await load(Self.composePage)
        let bytes = pattern(ComposeAttachments.chunkSize * 4)
        // Asked before each thing sent to the page: the ready check, the
        // start of the file, then each chunk. The fourth is the second chunk.
        var asked = 0
        let failed = await ComposeAttachments.attach(
            [
                try file(named: "big.bin", type: "application/octet-stream", bytes: bytes),
                try file(named: "after.txt", type: "text/plain", bytes: Data([1])),
            ],
            to: webView,
            stillWanted: {
                asked += 1
                return asked <= 3
            }
        )
        XCTAssertEqual(failed, [])
        XCTAssertEqual(asked, 4, "nothing is asked, or sent, after the answer was no")
        let files = try await attached()
        XCTAssertEqual(files.count, 0)
    }

    func testLoadAttachesOnlyToThePageItBrings() async throws {
        let marks = StaleMarks()
        try await load(Self.reportingComposePage, hearing: marks)
        // The second page comes from a file: a request cannot carry a page's
        // text, and a file is a different place from the first page's, as the
        // message's page is a different document from the pooled one.
        let second = folder.appendingPathComponent("second.html")
        try Self.composePage.write(to: second, atomically: true, encoding: .utf8)
        let bytes = Data([1, 2, 3])
        let failed = await ComposeAttachments.load(
            URLRequest(url: second),
            attaching: [try file(named: "a.txt", type: "text/plain", bytes: bytes)],
            in: webView,
            stillWanted: { true }
        )
        XCTAssertEqual(failed, [])
        XCTAssertGreaterThanOrEqual(marks.count, 1, "the first page was marked stale")
        let isSecond = try await webView.evaluateJavaScript("location.protocol === 'file:'") as? Bool
        XCTAssertEqual(isSecond, true)
        let files = try await attached()
        XCTAssertEqual(files.map { $0["name"] as? String }, ["a.txt"])
        XCTAssertEqual(files.first?["sum"] as? Int, sum(bytes))
    }
}
