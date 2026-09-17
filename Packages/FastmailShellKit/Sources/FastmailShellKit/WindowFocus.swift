#if os(macOS)
import AppKit
import WebKit

/// Fastmail's desktop app brings one of its other windows forward, such as
/// the compose window a draft is open in, by opening that window's address
/// under the window's own name, and Electron answers with the window already
/// carrying it. WebKit only looks among the windows a page opened itself, and
/// a compose window comes from the pool, so it made a new window instead.
/// Here every window's page is asked its name.
@MainActor
public enum WindowFocus {
    @discardableResult
    public static func focus(named name: String) async -> Bool {
        for window in NSApp.windows where isOnScreen(window) {
            guard let view = webView(in: window.contentView) else { continue }
            let pageName = try? await view.evaluateJavaScript("window.name") as? String
            guard pageName == name else { continue }
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.tabGroup?.selectedWindow = window
            window.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return true
        }
        return false
    }

    /// Shown, in the Dock, or a tab behind another; not a pool window waiting
    /// out of sight, whose page Fastmail has not been told about.
    static func isOnScreen(_ window: NSWindow) -> Bool {
        if window.isVisible || window.isMiniaturized { return true }
        guard let group = window.tabGroup else { return false }
        return group.windows.count > 1 && group.windows.contains(window)
    }

    static func webView(in view: NSView?) -> WKWebView? {
        guard let view else { return nil }
        if let web = view as? WKWebView { return web }
        for subview in view.subviews {
            if let web = webView(in: subview) { return web }
        }
        return nil
    }
}
#endif
