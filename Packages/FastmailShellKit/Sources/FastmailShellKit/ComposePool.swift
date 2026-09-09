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

extension ComposeURL {
    // A window opened for a mailto takes the path that is known to carry a
    // message, with the minimal chrome a window of its own wants: no sidebar,
    // no list, just what you are writing.
    public static func url(for profile: Profile, mailto: String) -> URL {
        LinkRouter.composeURL(
            mailto: mailto,
            accountID: profile.accountID,
            backend: profile.backend,
            minimalChrome: true
        )
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
                ComposeWindows.readyForPool(window)
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
        observers.append(NotificationCenter.default.addObserver(
            forName: .fmshellComposeInTab, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                ComposeWindows.shared.compose(inTabOf: NSApp.keyWindow)
            }
        })
    }

    /// Where a compose tab can go. A compose window will not host one — they
    /// refuse tabs — so a message asked for from inside one opens on its own.
    static func tabHost(_ window: NSWindow?) -> NSWindow? {
        guard let window, window.tabbingMode != .disallowed else { return nil }
        return window
    }

    /// Compose windows are reused, so being a tab is undone before one goes
    /// back to the pool: it leaves the group and refuses tabs again, or the
    /// next message would turn up somewhere nobody put it.
    static func readyForPool(_ window: NSWindow) {
        window.tabGroup?.removeWindow(window)
        window.tabbingMode = .disallowed
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

    /// The same window, opened on a message someone asked to write — a mailto
    /// link clicked anywhere on the Mac. The pooled window was preloaded blank,
    /// so this one has a page to fetch before it can be typed in.
    ///
    /// The profile comes with the message rather than being remembered from
    /// setup: a mailto can be what launched the app, arriving before the shell
    /// has appeared and configured anything, and a message that quietly went
    /// nowhere would be the worst way to find that out. Configuring twice is
    /// free — it returns on the second call.
    public func compose(mailto: String, profile: Profile) {
        configure(profile: profile)
        guard let pool else { return }
        let window = pool.take()
        (window.contentView as? WKWebView)?
            .load(URLRequest(url: ComposeURL.url(for: profile, mailto: mailto)))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// The same message, written in a tab of the window it was asked from.
    /// The page is Fastmail's minimal one either way, and the window keeps its
    /// ordinary title bar, so the message sits below the tab bar rather than
    /// behind it.
    public func compose(inTabOf host: NSWindow?) {
        guard let pool else { return }
        guard let host = Self.tabHost(host) else {
            compose()
            return
        }
        let window = pool.take()
        window.tabbingMode = .preferred
        host.addTabbedWindow(window, ordered: .above)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    private func makeWindow() -> NSWindow {
        let configuration = WKWebViewConfiguration()
        #if os(macOS)
        // Its service worker takes its user agent from whichever client
        // started it. Without this token a compose window can restart
        // Fastmail's worker into the branch that hands the main window's
        // notifications to a WKWebView that never shows them.
        configuration.applicationNameForUserAgent = WebContainer.electronUserAgentToken
        #endif
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
