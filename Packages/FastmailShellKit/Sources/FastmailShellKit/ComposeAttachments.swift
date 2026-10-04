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
    static func load(
        _ request: URLRequest, attaching files: [SharedPayload.Attachment], in view: WKWebView
    ) async -> [String] {
        _ = try? await view.callAsyncJavaScript(staleScript, contentWorld: .page)
        view.load(request)
        return await attach(files, to: view)
    }

    /// The names of the files that could not be handed to the page.
    static func attach(
        _ files: [SharedPayload.Attachment], to view: WKWebView, timeout: TimeInterval = 15
    ) async -> [String] {
        guard await waitForController(in: view, timeout: timeout) else {
            return files.map(\.name)
        }
        var failed: [String] = []
        for file in files {
            if !(await attach(file, to: view)) { failed.append(file.name) }
        }
        return failed
    }

    private static func waitForController(in view: WKWebView, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if (try? await view.callAsyncJavaScript(readyScript, contentWorld: .page)) as? Bool == true {
                return true
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        } while Date() < deadline
        return false
    }

    private static func attach(_ file: SharedPayload.Attachment, to view: WKWebView) async -> Bool {
        guard let data = try? Data(contentsOf: file.url, options: .mappedIfSafe) else { return false }
        let key = UUID().uuidString
        do {
            _ = try await view.callAsyncJavaScript(beginScript, arguments: ["key": key], contentWorld: .page)
            var offset = 0
            while offset < data.count {
                let end = min(offset + chunkSize, data.count)
                let chunk = data.subdata(in: offset..<end).base64EncodedString()
                _ = try await view.callAsyncJavaScript(
                    appendScript, arguments: ["key": key, "chunk": chunk], contentWorld: .page
                )
                offset = end
            }
            let handed = try await view.callAsyncJavaScript(
                finishScript,
                arguments: ["key": key, "name": file.name, "type": file.type],
                contentWorld: .page
            )
            return handed as? Bool == true
        } catch {
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
