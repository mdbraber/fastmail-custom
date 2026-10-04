#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

/// Hands files to Fastmail's compose page. A file dropped on a message ends
/// in the compose controller's attachFiles, and nothing else; so files that
/// arrived from the share extension are rebuilt in the page as File objects
/// and given to that same function, and the page uploads them as its own.
@MainActor
public enum ComposeAttachments {
    /// How much of a file goes to the page at a time. The bytes cross as
    /// base64 text, and one string for a whole 50 MB file is more than a
    /// single message to the page should carry.
    static let chunkSize = 512 * 1024

    /// The compose controller, found from the compose node the way the page
    /// finds a view from any node. A page marked stale is one about to be
    /// navigated away from; its controller is not the message's.
    private static let findController = """
    function fmshellComposeController() {
        if (window.__fmshellStale) { return null; }
        var F = window.FastMail;
        var node = document.querySelector('.v-Compose');
        if (!F || !F.getViewFromNode || !node) { return null; }
        var view = F.getViewFromNode(node);
        while (view && view.get) {
            var controller = view.get('controller');
            if (controller && typeof controller.attachFiles === 'function') { return controller; }
            view = view.get('parentView');
        }
        return null;
    }
    """

    static let staleScript = "window.__fmshellStale = true;"

    private static let readyScript = findController + "return !!fmshellComposeController();"

    private static let beginScript = """
    window.__fmshellShare = window.__fmshellShare || {};
    window.__fmshellShare[key] = [];
    """

    private static let appendScript = """
    var binary = atob(chunk);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
    window.__fmshellShare[key].push(bytes);
    """

    private static let finishScript = findController + """
    var parts = (window.__fmshellShare || {})[key];
    if (window.__fmshellShare) { delete window.__fmshellShare[key]; }
    var controller = fmshellComposeController();
    if (!parts || !controller) { return false; }
    controller.attachFiles([new File(parts, name, { type: type })]);
    return true;
    """

    /// Loads the message, then attaches. The page already in the window is a
    /// compose page too, with a controller of its own, so it is marked first:
    /// only the page that the load brings is attached to.
    ///
    /// `stillWanted` answers whether the window still holds the message the
    /// files were shared into. It is asked before anything is sent to the
    /// page, and once it says no the hand-over stops: a window closed early
    /// goes back to the pool with a fresh compose page in this same view, and
    /// the files are not that page's. Stopping is not a failure, so the names
    /// returned are then none at all; there is nothing to tell anyone.
    static func load(
        _ request: URLRequest, attaching files: [SharedPayload.Attachment], in view: WKWebView,
        stillWanted: @MainActor () -> Bool
    ) async -> [String] {
        guard stillWanted() else { return [] }
        _ = try? await view.callAsyncJavaScript(staleScript, contentWorld: .page)
        guard stillWanted() else { return [] }
        view.load(request)
        // Marked again, with nothing in between. A window fresh from the
        // pool may still have been loading its blank compose page, and the
        // first mark then fell on the empty document before it; that page
        // could arrive while the mark was on its way back. The page takes
        // what it is sent in order: either the blank compose page is there
        // by now and this marks it, or it was still on its way and the load
        // above has called it off. The page the load brings cannot be the
        // one marked, as no page arrives without first asking here whether
        // it may. This does not lean on what address the page ends up at.
        _ = try? await view.callAsyncJavaScript(staleScript, contentWorld: .page)
        return await attach(files, to: view, stillWanted: stillWanted)
    }

    /// The names of the files that could not be handed to the page; none
    /// when `stillWanted` said no along the way, as `load` explains, whatever
    /// had or had not been handed over by then.
    static func attach(
        _ files: [SharedPayload.Attachment], to view: WKWebView, timeout: TimeInterval = 15,
        stillWanted: @MainActor () -> Bool = { true }
    ) async -> [String] {
        do {
            guard try await waitForController(in: view, timeout: timeout, stillWanted: stillWanted) else {
                // A page that never became ready because its window was
                // closed meanwhile is a stop, not a failure.
                return stillWanted() ? files.map(\.name) : []
            }
            var failed: [String] = []
            for file in files {
                if !(try await attach(file, to: view, stillWanted: stillWanted)) { failed.append(file.name) }
            }
            return failed
        } catch {
            return []
        }
    }

    /// Thrown to leave a hand-over that is no longer wanted.
    private struct NoLongerWanted: Error {}

    private static func waitForController(
        in view: WKWebView, timeout: TimeInterval, stillWanted: @MainActor () -> Bool
    ) async throws -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            guard stillWanted() else { throw NoLongerWanted() }
            if (try? await view.callAsyncJavaScript(readyScript, contentWorld: .page)) as? Bool == true {
                return true
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        } while Date() < deadline
        return false
    }

    /// Whether the file was handed over. Throws only NoLongerWanted; a page
    /// that refuses what it is sent is a file that failed, unless the window
    /// was closed under it, which is why it refused.
    private static func attach(
        _ file: SharedPayload.Attachment, to view: WKWebView, stillWanted: @MainActor () -> Bool
    ) async throws -> Bool {
        guard let data = try? Data(contentsOf: file.url, options: .mappedIfSafe) else { return false }
        let key = UUID().uuidString
        do {
            guard stillWanted() else { throw NoLongerWanted() }
            _ = try await view.callAsyncJavaScript(beginScript, arguments: ["key": key], contentWorld: .page)
            var offset = 0
            while offset < data.count {
                let end = min(offset + chunkSize, data.count)
                let chunk = data.subdata(in: offset..<end).base64EncodedString()
                guard stillWanted() else { throw NoLongerWanted() }
                _ = try await view.callAsyncJavaScript(
                    appendScript, arguments: ["key": key, "chunk": chunk], contentWorld: .page
                )
                offset = end
            }
            guard stillWanted() else { throw NoLongerWanted() }
            let handed = try await view.callAsyncJavaScript(
                finishScript,
                arguments: ["key": key, "name": file.name, "type": file.type],
                contentWorld: .page
            )
            return handed as? Bool == true
        } catch {
            guard !(error is NoLongerWanted), stillWanted() else { throw NoLongerWanted() }
            return false
        }
    }

    /// Says which files did not make it. The message itself is open, with
    /// its subject and text, and the files are still where they were shared
    /// from, so they can be attached by hand.
    public static func report(notAttached names: [String]) {
        guard !names.isEmpty else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = names.count == 1
            ? "A file could not be attached"
            : "\(names.count) files could not be attached"
        alert.informativeText = names.joined(separator: "\n")
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
#endif
