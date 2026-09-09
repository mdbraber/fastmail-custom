import Combine
import SwiftUI
import WebKit

#if canImport(UIKit)
import UIKit
#endif

/// What the page says it looks like: the colour to paint the window with, and
/// whether Fastmail calls its own theme dark.
public struct PageTint: Equatable, Sendable {
    public let color: String
    public let isDark: Bool?

    public init(color: String, isDark: Bool?) {
        self.color = color
        self.isDark = isDark
    }
}

@MainActor
public final class ShellModel: ObservableObject {
    @Published public var banner: String?
    @Published public var tint: PageTint?
    @Published public var dragRect: CGRect = .zero
    @Published public var noDragRects: [CGRect] = []
    @Published public var shareRequest: ShareRequest?
    @Published public var pendingLoad: URL?
    /// The page this window is showing, and the message on it when there is
    /// one. Watched so the page can be offered to another device.
    @Published public var pageURL: URL?
    @Published public var pageSubject: String?

    public init() {}

    public func show(_ message: String) {
        banner = message
    }
}

@MainActor
public struct WebContainer {
    // Fastmail's service worker hands notifications to the page instead of
    // showing them itself when it sees Electron/ in the user agent; the mark
    // of Fastmail's own desktop app.
    public static let electronUserAgentToken = "Electron/0.0.0 FastmailShell"

    /// Which layout the page is asked for. An iPad asks for the desktop site
    /// unless it is told otherwise.
    static var preferredContentMode: WKWebpagePreferences.ContentMode {
        #if os(iOS)
        .mobile
        #else
        .recommended
        #endif
    }

    let profile: Profile
    let model: ShellModel
    let loader: ResourceLoading
    let loadURL: URL

    public init(
        profile: Profile,
        model: ShellModel,
        loader: ResourceLoading = BundleResourceLoader(),
        loadURL: URL? = nil
    ) {
        self.profile = profile
        self.model = model
        self.loader = loader
        self.loadURL = loadURL ?? profile.startURL
    }

    func makeWebView(
        coordinator: WebCoordinator,
        beforeLoad: ((WKUserContentController) -> Void)? = nil,
        makeView: (WKWebViewConfiguration) -> WKWebView = { WKWebView(frame: .zero, configuration: $0) }
    ) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        #if os(macOS)
        // Fastmail's service worker hands notifications to the page instead of
        // showing them itself when it sees Electron/ in the user agent, the
        // mark of Fastmail's own desktop app, and the page then calls
        // window.electron.showNotification, which the harness provides.
        configuration.applicationNameForUserAgent = Self.electronUserAgentToken
        #endif

        configuration.defaultWebpagePreferences.preferredContentMode =
            Self.preferredContentMode

        let bridge = NativeBridge(
            // The page this view is being built for, not the profile's
            // default: the two differ the moment a backend is chosen, and a
            // bridge expecting the wrong host refuses every message the page
            // sends.
            expectedHost: loadURL.host ?? "",
            onLog: { message in print("[userscript] \(message)") },
            onError: { [model] message in model.show(message) },
            onTheme: { [model] color, isDark in
                Task { @MainActor in model.tint = PageTint(color: color, isDark: isDark) }
            },
            onDragRegions: { [model] drag, noDrag in
                Task { @MainActor in
                    model.dragRect = drag
                    model.noDragRects = noDrag
                }
            },
            onShare: { [model] request in model.shareRequest = request },
            onBadge: { count in BadgeController.shared.apply(count) },
            onActions: { names in
                UserDefaults.standard.set(names, forKey: IntentSupport.actionNamesKey)
            },
            onOpenSettings: { SettingsPresenter.shared.open() },
            onNotify: { notification in
                #if os(macOS)
                NotificationPresenter.shared.show(notification)
                #endif
            },
            onDismissNotifications: { ids in
                #if os(macOS)
                NotificationPresenter.shared.dismiss(ids: ids)
                #endif
            },
            onShowWindow: {
                #if os(macOS)
                NotificationPresenter.shared.showWindow()
                #endif
            },
            onSubject: { [model] subject in model.pageSubject = subject },
            onCompose: { asked in
                #if os(macOS)
                return ComposeCommands.open(asked: asked)
                #else
                // A phone has one window and no tabs; every message is written
                // in the page.
                return ComposeMode.inline.rawValue
                #endif
            }
        )
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "native"
        )

        // Settings go in ahead of every other script: the userscript reads
        // window.__customModeSettings the moment it starts.
        configuration.userContentController.addUserScript(
            CustomModeSettings.bootstrapScript()
        )

        do {
            let scripts = try ScriptStore(
                loader: loader,
                overlayName: profile.overlayScriptName
            ).load()
            let injected = try ScriptInjector.userScripts(from: scripts, url: loadURL)
            if !injected.userScriptIncluded {
                let message = "User script @match does not cover \(loadURL.absoluteString)"
                Task { @MainActor in model.show(message) }
            }
            for script in injected.scripts {
                configuration.userContentController.addUserScript(script)
            }
        } catch {
            let message = "User script not loaded: \(error)"
            Task { @MainActor in model.show(message) }
        }

        beforeLoad?(configuration.userContentController)

        let webView = makeView(configuration)
        WebViewRegistry.shared.register(webView)
        webView.isInspectable = true
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        coordinator.settingsPusher = CustomModeSettingsPusher(webView: webView)
        coordinator.sharePresenter = SharePresenter(model: model, webView: webView)
        coordinator.linkLoader = LinkLoader(model: model, webView: webView)
        coordinator.pageWatcher = PageWatcher(model: model, webView: webView)
        #if !canImport(UIKit)
        coordinator.commandRelay = CommandRelay(model: model, webView: webView)
        #endif
        coordinator.badgePuller = BadgePuller(webView: webView)
        DownloadManager.shared.onFinished = { item in
            guard let fileURL = item.fileURL else { return }
            AttachmentOpener.handle(fileURL: fileURL)
        }
        DownloadManager.shared.onIssue = { [model] message in
            model.banner = message
        }
        webView.load(URLRequest(url: loadURL))
        return webView
    }
}

public extension Notification.Name {
    static let fmshellReload = Notification.Name("fmshellReload")
    static let fmshellShare = Notification.Name("fmshellShare")
    static let fmshellCompose = Notification.Name("fmshellCompose")
    static let fmshellComposeInTab = Notification.Name("fmshellComposeInTab")
}

// External URLs land in the model from onOpenURL; the web view they should
// drive only exists in here, so this relay carries them across, the same shape
// as SharePresenter.
@MainActor
final class LinkLoader {
    private weak var webView: WKWebView?
    private let model: ShellModel
    private var subscription: AnyCancellable?

    init(model: ShellModel, webView: WKWebView) {
        self.model = model
        self.webView = webView
        subscription = model.$pendingLoad
            .compactMap { $0 }
            .sink { [weak self] url in
                self?.load(url)
            }
    }

    private func load(_ url: URL) {
        model.pendingLoad = nil
        guard let webView else { return }
        guard let step = Self.step(from: webView.url, to: url) else {
            webView.load(URLRequest(url: url))
            return
        }
        webView.callAsyncJavaScript(
            Self.stepScript,
            arguments: ["path": step],
            in: nil,
            in: .page
        ) { result in
            // The page answers false when it is not the mail app: a login
            // screen, or an app that has not started yet. Then it is loaded.
            let steered = (try? result.get()) as? Bool ?? false
            guard !steered else { return }
            MainActor.assumeIsolated {
                webView.load(URLRequest(url: url))
            }
        }
    }

    /// The step inside the page that reaches `target`, or nothing when the
    /// page has to be loaded. Fastmail's router takes a pushed address and
    /// swaps the view, exactly as it does for a link clicked in the page;
    /// loading throws away the running app and builds it again.
    nonisolated static func step(from current: URL?, to target: URL) -> String? {
        guard
            let current,
            let here = URLComponents(url: current, resolvingAgainstBaseURL: false),
            let there = URLComponents(url: target, resolvingAgainstBaseURL: false),
            here.scheme?.lowercased() == "https",
            there.scheme?.lowercased() == "https",
            let host = there.host,
            LinkRouter.isFastmailHost(host),
            here.host?.caseInsensitiveCompare(host) == .orderedSame,
            // A message to write is handed over whole; the router opens no
            // window for a pushed compose address.
            !(there.queryItems ?? []).contains(where: { $0.name == "mailto" })
        else { return nil }
        var step = there.path.isEmpty ? "/" : there.path
        if let query = there.query, !query.isEmpty { step += "?" + query }
        if let fragment = there.fragment, !fragment.isEmpty { step += "#" + fragment }
        return step
    }

    /// Pushed rather than assigned to `location`, which would load the page.
    /// The popstate is what the router listens for, the same event the back
    /// button sends.
    nonisolated static let stepScript = """
    if (!window.FastMail || !window.FastMail.store) { return false; }
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
    """
}

/// Fastmail moves between mailboxes and messages without loading anything, so
/// the address is watched rather than read once when a page finishes.
@MainActor
final class PageWatcher {
    private var observation: NSKeyValueObservation?

    init(model: ShellModel, webView: WKWebView) {
        observation = webView.observe(\.url, options: [.initial, .new]) { [weak model] view, _ in
            MainActor.assumeIsolated {
                model?.pageURL = view.url
            }
        }
    }
}

#if !canImport(UIKit)
// Menu-bar commands act on whichever window's web view is key.
@MainActor
final class CommandRelay {
    private weak var webView: WKWebView?
    private let model: ShellModel
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []

    init(model: ShellModel, webView: WKWebView) {
        self.model = model
        self.webView = webView
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: .fmshellReload, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.ifKey { $0.reload() } }
        })
        observers.append(center.addObserver(
            forName: .fmshellShare, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.shareCurrentMessage() }
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func ifKey(_ act: (WKWebView) -> Void) {
        guard let webView, webView.window?.isKeyWindow == true else { return }
        act(webView)
    }

    private func shareCurrentMessage() {
        ifKey { webView in
            webView.callAsyncJavaScript(
                "return await window.native.currentLink();",
                arguments: [:],
                in: nil,
                in: .page
            ) { [model] result in
                switch result {
                case .success(let value):
                    let link = value as? [String: Any]
                    // What is shared is the production address, not this
                    // shell's beta one, which opens for nobody else
                    let url = (link?["url"] as? String).flatMap(URL.init(string:)).map(Backend.canonical)
                    let title = link?["title"] as? String
                    guard url != nil || title != nil else {
                        model.banner = "No message open"
                        return
                    }
                    model.shareRequest = ShareRequest(
                        url: url, text: title, sourceRect: nil, completion: {}
                    )
                case .failure:
                    model.banner = "No message open"
                }
            }
        }
    }
}
#endif

// The page pushes badge counts as they change, but a backgrounded app misses
// those pushes, so returning to the foreground asks the page for a fresh count
// rather than trusting the last one that arrived.
@MainActor
final class BadgePuller {
    private weak var webView: WKWebView?
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []

    init(webView: WKWebView) {
        self.webView = webView
        #if canImport(UIKit)
        let name = UIApplication.didBecomeActiveNotification
        #else
        let name = NSApplication.didBecomeActiveNotification
        #endif
        observers.append(NotificationCenter.default.addObserver(
            forName: name, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.pull() }
        })
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func pull() {
        webView?.callAsyncJavaScript(
            "return window.native && window.native.badgeCount ? await window.native.badgeCount() : null;",
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            if case .success(let value) = result {
                BadgeController.shared.apply(value as? Int)
            }
        }
    }
}

/// Pushes changed Custom mode settings into a running page, the way the Safari
/// extension's storage listener does for its tabs.
@MainActor
final class CustomModeSettingsPusher {
    private weak var webView: WKWebView?
    // Written once in init, read again only from deinit; never concurrently
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []
    private var pushTask: Task<Void, Never>?

    init(webView: WKWebView) {
        self.webView = webView
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush() }
        })
        #if canImport(UIKit)
        observers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush() }
        })
        #endif
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // Applying settings makes the page drop caches and re-ask the server for
    // counts, so a keystroke-by-keystroke stream of changes is coalesced into
    // one push once the writing pauses.
    private func schedulePush() {
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            self?.webView?.evaluateJavaScript(
                CustomModeSettings.applyScriptSource(),
                completionHandler: nil
            )
        }
    }
}
