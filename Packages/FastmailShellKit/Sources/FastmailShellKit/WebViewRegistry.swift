import WebKit

#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

@MainActor
public final class WebViewRegistry {
    public static let shared = WebViewRegistry()

    private struct WeakBox {
        weak var view: WKWebView?
        var subject: String?
    }

    private var entries: [WeakBox] = []

    public init() {}

    public func register(_ view: WKWebView) {
        prune()
        guard !entries.contains(where: { $0.view === view }) else { return }
        entries.append(WeakBox(view: view))
    }

    public var views: [WKWebView] {
        prune()
        return entries.compactMap(\.view)
    }

    public var active: WKWebView? {
        #if canImport(UIKit)
        return views.last
        #else
        return Self.resolve(
            views: views,
            keyWindow: NSApp?.keyWindow,
            mainWindow: NSApp?.mainWindow
        )
        #endif
    }

    static func resolve(
        views: [WKWebView],
        keyWindow: AnyObject?,
        mainWindow: AnyObject?
    ) -> WKWebView? {
        if let keyWindow, let match = views.first(where: { $0.window === keyWindow }) {
            return match
        }
        if let mainWindow, let match = views.first(where: { $0.window === mainWindow }) {
            return match
        }
        return views.first
    }

    public func setSubject(_ subject: String?, for view: WKWebView) {
        prune()
        guard let index = entries.firstIndex(where: { $0.view === view }) else { return }
        entries[index].subject = subject
    }

    public func subject(for view: WKWebView) -> String? {
        entries.first(where: { $0.view === view })?.subject
    }

    private func prune() {
        entries.removeAll { $0.view == nil }
    }
}
