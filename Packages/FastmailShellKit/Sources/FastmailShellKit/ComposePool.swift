import Foundation

public enum ComposeURL {
    // The compose window is its own window, so it gets Fastmail's minimal
    // chrome: no sidebar, no list, just the message — ui=minimal. Built
    // from components rather than pasted, so the account and the flag are
    // encoded the same way whichever is present.
    public static func url(for profile: Profile) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = profile.backend.host
        components.path = "/mail/Inbox/compose"
        var items: [URLQueryItem] = []
        if let accountID = profile.accountID {
            items.append(URLQueryItem(name: "u", value: accountID))
        }
        items.append(URLQueryItem(name: "ui", value: "minimal"))
        components.queryItems = items
        return components.url!
    }
}

@MainActor
public final class ComposePool<Window: AnyObject> {
    private(set) var pooled: Window?
    private let create: () -> Window
    private let prepare: (Window) -> Void

    public init(create: @escaping () -> Window, prepare: @escaping (Window) -> Void) {
        self.create = create
        self.prepare = prepare
    }

    public func preload() {
        guard pooled == nil else { return }
        let window = create()
        prepare(window)
        pooled = window
    }

    public func take() -> Window {
        if let pooled {
            self.pooled = nil
            return pooled
        }
        let window = create()
        prepare(window)
        return window
    }

    public func shouldRecycle(_ window: Window) -> Bool {
        guard pooled == nil else { return false }
        prepare(window)
        pooled = window
        return true
    }
}

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

@MainActor
public final class ComposeWindows: NSObject, NSWindowDelegate {
    public static let shared = ComposeWindows()

    private var pool: ComposePool<NSWindow>?
    private var configuredURL: URL?
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []

    // Called again when the backend changes. A pooled window has already been
    // preloaded with the old server's compose page, so the pool is rebuilt
    // rather than kept: reusing it would open a window on the server the app
    // is no longer signed in to.
    public func configure(profile: Profile) {
        let composeURL = ComposeURL.url(for: profile)
        guard configuredURL != composeURL else { return }
        configuredURL = composeURL
        pool = ComposePool(
            create: { [weak self] in self?.makeWindow() ?? NSWindow() },
            prepare: { window in
                (window.contentView as? WKWebView)?.load(URLRequest(url: composeURL))
            }
        )
        pool?.preload()
        guard observers.isEmpty else { return }
        observers.append(NotificationCenter.default.addObserver(
            forName: .fmshellCompose, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { ComposeWindows.shared.compose() }
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    public func compose() {
        guard let pool else { return }
        let window = pool.take()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func makeWindow() -> NSWindow {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isInspectable = true
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.title = "New Message"
        window.contentView = view
        window.delegate = self
        window.center()
        return window
    }

    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let pool, sender.delegate === self else { return true }
        if pool.shouldRecycle(sender) {
            sender.orderOut(nil)
            return false
        }
        return true
    }
}
#endif
